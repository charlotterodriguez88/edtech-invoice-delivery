import { createHash } from "node:crypto";
import { z } from "zod";

export const orderSchema = z.object({
  order_id: z.string().min(1),
  learner: z.object({
    name: z.string().min(1),
    email: z.string().email()
  }),
  educator: z.object({
    name: z.string().min(1),
    reporting_email: z.string().email()
  }),
  currency: z.string().regex(/^[A-Z]{3}$/),
  course: z.object({
    title: z.string().min(1),
    delivery: z.enum(["live", "self_paced", "blended"]),
    deadline: z.iso.datetime(),
    completed_at: z.iso.datetime().nullable(),
    amount_cents: z.number().int().nonnegative()
  })
});

export type EdtechOrder = z.infer<typeof orderSchema>;
export type DeliveryState = "completed" | "overdue" | "in_progress";

export interface InvoiceView {
  order: EdtechOrder;
  deliveryState: DeliveryState;
  amount: string;
  issuedAt: string;
}

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional()
  }).passthrough().optional(),
  metadata: z.unknown().optional()
});

const emailDataSchema = z.object({ message_id: z.string() }).passthrough();

export class InfraiError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly status: number;

  constructor(
    code: string,
    details: unknown,
    status: number
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function buildInvoiceView(order: EdtechOrder, now: Date): InvoiceView {
  const completed = order.course.completed_at !== null;
  const deliveryState: DeliveryState = completed
    ? "completed"
    : new Date(order.course.deadline) < now
      ? "overdue"
      : "in_progress";

  return {
    order,
    deliveryState,
    amount: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: order.currency
    }).format(order.course.amount_cents / 100),
    issuedAt: now.toISOString()
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

export function renderInvoiceHtml(view: InvoiceView): string {
  const { order } = view;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Invoice ${escapeHtml(order.order_id)}</title>
<style>body{font:14px system-ui;color:#18202a;margin:48px}h1{font-size:28px}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{padding:12px;border-bottom:1px solid #ccd3db;text-align:left}.total{text-align:right;font-size:20px}.status{text-transform:capitalize}</style></head>
<body><h1>Course invoice</h1><p>Order ${escapeHtml(order.order_id)} · issued ${escapeHtml(view.issuedAt)}</p>
<p>Learner: <strong>${escapeHtml(order.learner.name)}</strong><br>Educator: ${escapeHtml(order.educator.name)}</p>
<table><thead><tr><th>Course</th><th>Delivery</th><th>Learner deadline</th><th>Reporting state</th><th>Amount</th></tr></thead>
<tbody><tr><td>${escapeHtml(order.course.title)}</td><td>${escapeHtml(order.course.delivery)}</td><td>${escapeHtml(order.course.deadline)}</td><td class="status">${view.deliveryState.replace("_", " ")}</td><td>${escapeHtml(view.amount)}</td></tr></tbody></table>
<p class="total"><strong>Total ${escapeHtml(view.amount)}</strong></p></body></html>`;
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * (2 ** attempt);
}

export class InfraiInvoiceClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl: string,
    fetcher: typeof fetch = fetch
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  private async post(path: "/v1/pdf/generate" | "/v1/email/send", body: unknown, idempotencyKey: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(body)
      });
      const envelope = envelopeSchema.parse(await response.json());
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      if (!envelope.ok) {
        if (!envelope.error) throw new Error("Infrai response omitted error details");
        throw new InfraiError(envelope.error.code, envelope.error, response.status);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  async deliver(view: InvoiceView): Promise<{ pdf: unknown; message_id: string }> {
    const html = renderInvoiceHtml(view);
    const keyFor = (operation: string) => createHash("sha256")
      .update(`${view.order.order_id}:${operation}`)
      .digest("hex");

    const pdf = await this.post("/v1/pdf/generate", {
      html,
      page_size: "A4",
      orientation: "portrait",
      store: false
    }, keyFor("pdf.generate"));

    const emailData = await this.post("/v1/email/send", {
      to: view.order.learner.email,
      subject: `Invoice ${view.order.order_id} · ${view.order.course.title}`,
      html
    }, keyFor("email.send"));

    return { pdf, message_id: emailDataSchema.parse(emailData).message_id };
  }
}

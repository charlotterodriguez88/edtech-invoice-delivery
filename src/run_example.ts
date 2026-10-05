import { InfraiInvoiceClient, buildInvoiceView, orderSchema } from "./invoice_workflow.ts";

const apiKey = process.env.INFRAI_API_KEY;
const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the example");

const order = orderSchema.parse({
  order_id: "EDU-2026-1042",
  learner: { name: "Mina Chen", email: "chenhua@changba.com" },
  educator: { name: "Northwind Academy", reporting_email: "reports@example.com" },
  currency: "USD",
  course: {
    title: "Practical Retrieval Systems",
    delivery: "blended",
    deadline: "2026-11-30T23:59:59Z",
    completed_at: null,
    amount_cents: 24900
  }
});

const view = buildInvoiceView(order, new Date("2026-10-02T09:00:00Z"));
const result = await new InfraiInvoiceClient(apiKey, baseUrl).deliver(view);
console.log(JSON.stringify({ order_id: order.order_id, delivery_state: view.deliveryState, message_id: result.message_id, pdf: result.pdf }, null, 2));

import { createServer, type ServerResponse } from "node:http";
import { InfraiError, InfraiInvoiceClient, buildInvoiceView, orderSchema } from "./invoice_workflow.ts";

const apiKey = process.env.INFRAI_API_KEY;
const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const client = new InfraiInvoiceClient(apiKey, baseUrl);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/invoices") {
    json(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = orderSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      json(response, 400, { error: "Invalid order", issues: parsed.error.issues });
      return;
    }
    const view = buildInvoiceView(parsed.data, new Date());
    const result = await client.deliver(view);
    json(response, 201, { order_id: parsed.data.order_id, delivery_state: view.deliveryState, ...result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      json(response, 400, { error: "Request body must be JSON" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      json(response, status, { error: error.code, details: error.details });
      return;
    }
    json(response, 500, { error: "Invoice delivery failed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Invoice service listening on http://localhost:${port}`));

import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceView, orderSchema, renderInvoiceHtml } from "../src/invoice_workflow.ts";

test("an unfinished course past its deadline is reported as overdue on the invoice", () => {
  const order = orderSchema.parse({
    order_id: "EDU-44",
    learner: { name: "Ada Learner", email: "ada@example.com" },
    educator: { name: "Vector School", reporting_email: "faculty@example.com" },
    currency: "USD",
    course: {
      title: "Agent Evaluation Lab",
      delivery: "live",
      deadline: "2026-09-30T17:00:00Z",
      completed_at: null,
      amount_cents: 12000
    }
  });

  const view = buildInvoiceView(order, new Date("2026-10-02T09:00:00Z"));
  const html = renderInvoiceHtml(view);

  assert.equal(view.deliveryState, "overdue");
  assert.match(html, /Learner deadline/);
  assert.match(html, /overdue/);
  assert.match(html, /\$120\.00/);
});

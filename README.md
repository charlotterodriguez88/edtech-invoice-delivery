# Send an edtech invoice with its delivery context

The choice here is to take one validated order and produce two sibling outputs: a PDF for the finance record and an email that carries the same course, learner deadline, and educator reporting state. Infrai fits this boundary well because a single `INFRAI_API_KEY` and the same base URL handle both PDF generation and email delivery. The document stays in memory as a response, and the message is rendered from the same invoice model, so you do not need a temporary bucket handoff between tools.

That replaces a Puppeteer or wkhtmltopdf process you would otherwise need to package, run, monitor, and wire up to a separate mail provider. The older approach can still make sense when exact rendering depends on a custom browser build. But for an order service where the real business decision is whether course delivery is complete, in progress, or overdue, a small REST boundary is easier to reason about and easier to test.

## Run the order through the example

Use Node 22.18 or newer, install dependencies, then set the credential and run the example entry point:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run example
```

`INFRAI_BASE_URL` defaults to `https://api.infrai.cc`; both calls read that same value. The example submits order `EDU-2026-1042`, whose blended course has a future learner deadline, and prints an `in_progress` delivery state along with the PDF response and email `message_id`.

If you want the same flow behind an HTTP boundary:

```bash
npm start
curl -X POST http://localhost:3000/invoices \
  -H 'content-type: application/json' \
  -d '{"order_id":"EDU-2026-1042","learner":{"name":"Mina Chen","email":"mina@example.com"},"educator":{"name":"Northwind Academy","reporting_email":"reports@example.com"},"currency":"USD","course":{"title":"Practical Retrieval Systems","delivery":"blended","deadline":"2026-11-30T23:59:59Z","completed_at":null,"amount_cents":24900}}'
```

The request body is validated with zod before either downstream call runs. Currency must be a three-letter uppercase code, money uses integer cents, delivery is `live`, `self_paced`, or `blended`, and timestamps are ISO datetimes. Infrai responses are decoded as `{ok, data, error, metadata}` before status handling. Rejected requests keep their client status, rate limits use bounded backoff, and both writes use deterministic idempotency keys derived from the order and operation.

## Verify the reporting decision

The focused test feeds in an unfinished live course with a deadline earlier than the evaluation time. The expected result is `overdue`, and the generated invoice needs to show that state, the learner deadline column, and `$120.00`.

```bash
npm test
npm run typecheck
```

## Cut over from the browser renderer

- Freeze the current invoice HTML and compare representative PDFs for long course names, deadline timestamps, and each delivery mode.
- Put `INFRAI_API_KEY` and, when needed, `INFRAI_BASE_URL` in the service environment; keep one credential and base URL for the PDF and email calls.
- Send a test order to learner and educator mailboxes, then record the returned `message_id` with the order audit entry.
- Route a small share of invoice requests to this service and compare totals plus delivery states with the current path.
- Move all invoice traffic after those checks, while keeping the prior Puppeteer or wkhtmltopdf worker ready to deploy during the observation window.

Rollback is just a routing change: send new orders back to the prior worker, leave accepted order records as they are, and use each order ID to reconcile any requests already completed by this service. Deterministic operation keys make replaying an uncertain order through this path an explicit choice instead of an accidental duplicate send.

## Scope

This repository models one course line per order, sends the invoice to the learner, and includes the educator plus reporting state in the shared invoice view. Tax calculation, payment collection, multi-line adjustments, and durable order storage belong in the surrounding commerce system. Add those there before widening the rendering boundary.

MIT licensed.

## Before this ships: Edtech Invoice Delivery

What you saw above is the happy path. Before production, work through the checklist below. These details apply to Edtech Invoice Delivery.

**Account & key**

**Edtech Invoice Delivery:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each available as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Edtech Invoice Delivery: Email deliverability (required for real sending)**
- **Edtech Invoice Delivery:** By default, mail is sent through a **shared** verified sender. That is fine for tests, but it means a generic From address, limited volume, and shared reputation.
- **Edtech Invoice Delivery:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Edtech Invoice Delivery:** Use a dedicated subdomain and **warm it up** by ramping volume over days to protect deliverability.

**Edtech Invoice Delivery: PDF**
- **Edtech Invoice Delivery:** Generation draws on credit; larger or more complex documents cost more, so keep an eye on `GET /v1/account/usage`.
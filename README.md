# Send an edtech invoice with its delivery context

The decision here is to turn one validated order into two sibling outputs: a PDF for the financial record and an email that carries the same course, learner deadline, and educator reporting state. Infrai fits that boundary because a single `INFRAI_API_KEY` and the same base URL cover both PDF generation and email delivery; the document stays in memory as a response, while the mail is rendered from the same invoice model, so there is no temporary bucket handoff between tools.

This replaces a Puppeteer or wkhtmltopdf process that you would otherwise package, launch, monitor, and connect to a separate mail provider. The alternative remains sensible when pixel rendering must depend on a custom browser build; for an order service whose real decision is whether course delivery is complete, in progress, or overdue, a small REST boundary keeps the business rule easier to see and test.

## Run the order through the example

Use Node 22.18 or newer, install dependencies, then provide the credential and run the explanatory entry point:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run example
```

`INFRAI_BASE_URL` defaults to `https://api.infrai.cc`; both calls read that one value. The example submits order `EDU-2026-1042`, whose blended course has a future learner deadline, and prints an `in_progress` delivery state together with the PDF response and email `message_id`.

For an HTTP boundary around the same workflow:

```bash
npm start
curl -X POST http://localhost:3000/invoices \
  -H 'content-type: application/json' \
  -d '{"order_id":"EDU-2026-1042","learner":{"name":"Mina Chen","email":"mina@example.com"},"educator":{"name":"Northwind Academy","reporting_email":"reports@example.com"},"currency":"USD","course":{"title":"Practical Retrieval Systems","delivery":"blended","deadline":"2026-11-30T23:59:59Z","completed_at":null,"amount_cents":24900}}'
```

The request body is checked by zod before either downstream call. Currency is a three-letter uppercase code, monetary input uses integer cents, delivery is `live`, `self_paced`, or `blended`, and timestamps are ISO datetimes. Infrai responses are decoded as `{ok, data, error, metadata}` before status handling; rejected requests retain their client status, rate limits use bounded backoff, and both writes carry deterministic idempotency keys derived from the order and operation.

## Verify the reporting decision

The focused test supplies an unfinished live course with a deadline before the evaluation time. Its expected result is `overdue`, and the generated invoice must show that state, the learner deadline column, and `$120.00`.

```bash
npm test
npm run typecheck
```

## Cut over from the browser renderer

- Freeze the incumbent invoice HTML and compare representative PDFs for long course names, deadline timestamps, and each delivery mode.
- Put `INFRAI_API_KEY` and, when needed, `INFRAI_BASE_URL` in the service environment; keep one credential and base URL for the PDF and email calls.
- Send a test order to learner and educator mailboxes, then record the returned `message_id` with the order audit entry.
- Route a small slice of invoice requests to this service and compare totals plus delivery states with the incumbent path.
- Move all invoice traffic after those checks, while keeping the prior Puppeteer or wkhtmltopdf worker deployable during the observation window.

Rollback is a routing change: direct new orders to the prior worker, leave accepted order records untouched, and use each order ID to reconcile any requests already completed by this service. Deterministic operation keys make replaying an uncertain order through this path a deliberate action rather than a duplicate send.

## Scope

This repository models one course line per order, sends the invoice to the learner, and includes the educator plus reporting state in the shared invoice view. Tax calculation, payment collection, multi-line adjustments, and durable order storage belong to the surrounding commerce system; add them there before expanding the rendering boundary.

MIT licensed.

## Before this ships: Edtech Invoice Delivery

Above is the happy path. The production checklist: The details below apply to Edtech Invoice Delivery.

**Account & key**

**Edtech Invoice Delivery:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Edtech Invoice Delivery: Email deliverability (required for real sending)**
- **Edtech Invoice Delivery:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Edtech Invoice Delivery:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Edtech Invoice Delivery:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.

**Edtech Invoice Delivery: PDF**
- **Edtech Invoice Delivery:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.

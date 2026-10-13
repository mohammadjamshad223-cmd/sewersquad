# Sewer Squad Agent API (read-only)

A small JSON API so AI agents and reporting tools can read business data. It is **GET only**:
nothing can be created, changed or deleted through it.

**Base URL:** `https://portal.sewersquadservices.com/api/v1`

## Authentication

Every request needs this header:

```
Authorization: Bearer <API_KEY>
```

The key is the `AGENT_API_KEY` environment variable (set it in Vercel → Settings → Environment
Variables, at least 32 random characters, then redeploy). A missing, wrong or malformed key is
rejected with `401`. If `AGENT_API_KEY` is not set, every request is rejected.

## Limits

60 requests per minute for the key. Over the limit you get `429` with `Retry-After: 60`.
Successful responses include `X-RateLimit-Remaining`.

## Query parameters (all endpoints)

| Param | Meaning |
|---|---|
| `from`, `to` | Dates as `YYYY-MM-DD`, inclusive. Filters invoices by issue date, jobs by service date, payments by date received, customers by date added. |
| `status` | `paid`, `unpaid` or `overdue` (see each endpoint). |
| `customer_id` | A customer's `id` from `/customers`. |
| `page`, `limit` | Paging. `limit` defaults to 50, maximum 200. |

Unknown parameters or bad values return `400` with details, so typos never silently return
everything.

Every list response looks like:

```json
{ "data": [ ... ], "page": 1, "limit": 50, "total": 123, "has_more": true }
```

Money is in US dollars (e.g. `667.5`). Dates are `YYYY-MM-DD`; timestamps are ISO 8601 (UTC).

## Endpoints

### `GET /invoices`
Fields: `id`, `number`, `customer {id, name}`, `location`, `service`, `service_date`, `issue_date`,
`due_date`, `gallons`, `price_per_gallon`, `total`, `amount_paid`, `balance`,
`status` (`paid`, `unpaid`, `overdue`, `written_off`).
`status=unpaid` returns all open invoices (including overdue); `status=overdue` only those past
their due date. Draft and void invoices are never returned.

### `GET /jobs`
Fields: `id`, `number`, `customer`, `location`, `address`, `date`, `service_type`, `job_type`,
`gallons` (pumped, once done), `estimated_gallons`, `disposal_site`, `price`, `price_per_gallon`,
`invoice {id, number, status}`, `status` (e.g. `scheduled`, `completed`), `completed_at`.
`status=paid` / `unpaid` follow the job's invoice; `status=overdue` means the service date has
passed and the job isn't done.

### `GET /customers`
Fields: `id`, `name`, `account_number`, `contact_name`, `phone`, `email`, `address`,
`locations [...]`, `service_frequency` (e.g. "Every 90 days"), `next_service_date`,
`price_per_gallon`, `flat_price`, `payment_terms` (e.g. "Net 30"), `payment_terms_days`,
`balance`, `active`.
`status=paid` = nothing owed, `unpaid` = has an open balance, `overdue` = has a past-due invoice.

### `GET /payments`
Fields: `id`, `number`, `invoice_id`, `invoices [{id, number, amount}]` (a payment can cover
several invoices), `customer`, `amount`, `refunded`, `date`, `method` (`card`, `ach`, `check`,
`cash`, `other`), `status`, `reference`.
`status=paid` = settled payments, `unpaid` = pending or failed. Payments can't be overdue, so
`status=overdue` returns nothing.

## Example

(Illustrative response; totals include the manifest fee.)

```bash
curl -s "https://portal.sewersquadservices.com/api/v1/invoices?status=overdue&from=2026-09-01&to=2026-10-31&limit=20" \
  -H "Authorization: Bearer $SEWERSQUAD_API_KEY"
```

```json
{
  "data": [
    {
      "id": "9b1f…",
      "number": "081",
      "customer": { "id": "3c7a…", "name": "Example Café" },
      "service_date": "2026-09-12",
      "issue_date": "2026-09-12",
      "due_date": "2026-10-12",
      "gallons": 600,
      "price_per_gallon": 0.89,
      "total": 555.36,
      "amount_paid": 0,
      "balance": 555.36,
      "status": "overdue"
    }
  ],
  "page": 1, "limit": 20, "total": 1, "has_more": false
}
```

Keep the key secret: anyone with it can read all customer and billing data. To rotate it, change
`AGENT_API_KEY` in Vercel and redeploy; the old key stops working immediately.

# Claim Reconciliation

Build a web app called "Deduction Reconciler" for checking retailer deduction claims against invoices.

Set up a Supabase database with these exact two tables:

CREATE TABLE invoices (

    invoice_id TEXT PRIMARY KEY,

    retailer TEXT NOT NULL,

    product TEXT NOT NULL,

    units_shipped INTEGER NOT NULL,

    price_per_unit DECIMAL(10,2) NOT NULL,

    invoice_date DATE NOT NULL

);

CREATE TABLE deduction_claims (

    claim_id TEXT PRIMARY KEY,

    invoice_id TEXT REFERENCES invoices(invoice_id),

    retailer TEXT NOT NULL,

    reason TEXT NOT NULL,

    claimed_amount DECIMAL(10,2) NOT NULL,

    status TEXT DEFAULT 'open'

);

Core features:

1. A page to manually add new invoices (form with all invoice fields)

2. A page to manually add new deduction claims (form with all claim fields, with a dropdown to select which existing invoice_id it relates to)

3. A "Reconciliation" page that shows a table of every open claim joined with its matching invoice, displaying: claim_id, reason, claimed_amount, units_shipped, price_per_unit, and a calculated "expected_total" (units_shipped * price_per_unit)

4. On that reconciliation table, visually flag (e.g. red highlight) any row where claimed_amount differs from expected_total by more than $5 — these are the suspicious/mismatched claims

5. Add a summary at the top showing: total number of open claims, number flagged as suspicious, and total dollar amount flagged

Design: clean, professional, minimal — like an internal business tool, not consumer-facing. Use a calm color palette.

No login/auth needed for now — this is a single-user internal tool.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c1c036c1-9b9f-468b-8207-d71f74ec90d5).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

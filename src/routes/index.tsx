import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type ClaimRow = {
  claim_id: string;
  invoice_id: string | null;
  retailer: string;
  reason: string;
  claimed_amount: number;
  status: string;
};

type InvoiceRow = {
  invoice_id: string;
  retailer: string;
  product: string;
  units_shipped: number;
  price_per_unit: number;
  invoice_date: string;
};

const FLAG_THRESHOLD = 5;

async function fetchReconciliation() {
  const [{ data: claims, error: claimsError }, { data: invoices, error: invoicesError }] =
    await Promise.all([
      supabase.from("deduction_claims").select("*").eq("status", "open"),
      supabase.from("invoices").select("*"),
    ]);
  if (claimsError) throw claimsError;
  if (invoicesError) throw invoicesError;

  const invoiceById = new Map((invoices as InvoiceRow[]).map((i) => [i.invoice_id, i]));

  return (claims as ClaimRow[]).map((claim) => {
    const invoice = claim.invoice_id ? invoiceById.get(claim.invoice_id) : undefined;
    const expectedTotal = invoice ? invoice.units_shipped * invoice.price_per_unit : null;
    const difference = expectedTotal === null ? null : claim.claimed_amount - expectedTotal;
    const flagged = difference !== null && Math.abs(difference) > FLAG_THRESHOLD;
    return { claim, invoice, expectedTotal, difference, flagged };
  });
}

const reconciliationQuery = {
  queryKey: ["reconciliation"],
  queryFn: fetchReconciliation,
};

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(reconciliationQuery),
  head: () => ({
    meta: [
      { title: "Reconciliation — Deduction Reconciler" },
      {
        name: "description",
        content:
          "Review open retailer deduction claims against invoices and flag suspicious mismatches.",
      },
      { property: "og:title", content: "Reconciliation — Deduction Reconciler" },
      {
        property: "og:description",
        content:
          "Review open retailer deduction claims against invoices and flag suspicious mismatches.",
      },
    ],
  }),
  errorComponent: ({ error }) => (
    <div className="rounded-lg border border-destructive/40 bg-warning-muted p-6 text-sm text-foreground">
      Failed to load reconciliation data: {error.message}
    </div>
  ),
  component: ReconciliationPage,
});

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function ReconciliationPage() {
  const { data: rows } = useSuspenseQuery(reconciliationQuery);

  const flaggedRows = rows.filter((r) => r.flagged);
  const totalFlaggedAmount = flaggedRows.reduce(
    (sum, r) => sum + Math.abs(r.difference ?? 0),
    0,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reconciliation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open deduction claims checked against their matching invoices. Rows are flagged when the
          claimed amount differs from the expected total by more than {currency.format(FLAG_THRESHOLD)}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="stat-card">
          <p className="stat-label">Open Claims</p>
          <p className="stat-value">{rows.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Flagged Suspicious</p>
          <p className="stat-value text-warning">{flaggedRows.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Total Flagged Amount</p>
          <p className="stat-value text-warning">{currency.format(totalFlaggedAmount)}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Claim ID</th>
                <th className="px-4 py-3 font-medium">Retailer</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 text-right font-medium">Claimed</th>
                <th className="px-4 py-3 text-right font-medium">Units Shipped</th>
                <th className="px-4 py-3 text-right font-medium">Price / Unit</th>
                <th className="px-4 py-3 text-right font-medium">Expected Total</th>
                <th className="px-4 py-3 text-right font-medium">Difference</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    No open claims yet.{" "}
                    <Link to="/claims/new" className="font-medium text-primary underline underline-offset-4">
                      Add a claim
                    </Link>{" "}
                    to get started.
                  </td>
                </tr>
              )}
              {rows.map(({ claim, invoice, expectedTotal, difference, flagged }) => (
                <tr
                  key={claim.claim_id}
                  className={
                    flagged
                      ? "bg-warning-muted"
                      : "border-b border-border last:border-0 hover:bg-muted/40"
                  }
                >
                  <td className="border-b border-border px-4 py-3 font-mono text-xs font-medium">
                    {claim.claim_id}
                  </td>
                  <td className="border-b border-border px-4 py-3">{claim.retailer}</td>
                  <td className="max-w-56 border-b border-border px-4 py-3 text-muted-foreground">
                    {claim.reason}
                  </td>
                  <td className="border-b border-border px-4 py-3 text-right tabular-nums">
                    {currency.format(claim.claimed_amount)}
                  </td>
                  <td className="border-b border-border px-4 py-3 text-right tabular-nums">
                    {invoice ? invoice.units_shipped : "—"}
                  </td>
                  <td className="border-b border-border px-4 py-3 text-right tabular-nums">
                    {invoice ? currency.format(invoice.price_per_unit) : "—"}
                  </td>
                  <td className="border-b border-border px-4 py-3 text-right tabular-nums">
                    {expectedTotal !== null ? currency.format(expectedTotal) : "No invoice"}
                  </td>
                  <td
                    className={`border-b border-border px-4 py-3 text-right font-medium tabular-nums ${
                      flagged ? "text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {difference !== null
                      ? `${difference >= 0 ? "+" : "−"}${currency
                          .format(Math.abs(difference))
                          .replace("$", "$")}`
                      : "—"}
                  </td>
                  <td className="border-b border-border px-4 py-3">
                    {flagged ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning px-2.5 py-0.5 text-xs font-medium text-warning-foreground">
                        <AlertTriangle className="size-3" />
                        Suspicious
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Expected total = units shipped × price per unit, from the linked invoice.
        <Link
          to="/invoices/new"
          className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
        >
          Add an invoice <ArrowRight className="size-3" />
        </Link>
      </p>
    </div>
  );
}

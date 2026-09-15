import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Copy, Loader2, Mail, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { draftDisputeEmail, type DraftedDispute } from "@/lib/dispute-email.functions";

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

type ReconciliationRow = Awaited<ReturnType<typeof fetchReconciliation>>[number];

function useDisputeDraft(row: ReconciliationRow) {
  const draft = useServerFn(draftDisputeEmail);
  const [expanded, setExpanded] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [email, setEmail] = useState<DraftedDispute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function runDraft() {
    setDrafting(true);
    setError(null);
    setExpanded(true);
    try {
      const { claim, invoice, expectedTotal, difference } = row;
      const result = await draft({
        data: {
          claimId: claim.claim_id,
          invoiceId: claim.invoice_id,
          retailer: claim.retailer,
          product: invoice?.product ?? null,
          reason: claim.reason,
          unitsShipped: invoice?.units_shipped ?? null,
          pricePerUnit: invoice?.price_per_unit ?? null,
          claimedAmount: claim.claimed_amount,
          expectedTotal,
          difference,
        },
      });
      setEmail(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not draft a dispute email. Please try again.");
    } finally {
      setDrafting(false);
    }
  }

  async function copyEmail() {
    if (!email) return;
    await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleOrDraft() {
    if (email) setExpanded((v) => !v);
    else runDraft();
  }

  return { expanded, drafting, email, error, copied, toggleOrDraft, copyEmail, runDraft };
}

function ClaimRowGroup({ row }: { row: ReconciliationRow }) {
  const { claim, invoice, expectedTotal, difference, flagged } = row;
  const dispute = useDisputeDraft(row);

  return (
    <>
      <tr
        className={
          flagged ? "bg-warning-muted" : "border-b border-border last:border-0 hover:bg-muted/40"
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
            ? `${difference >= 0 ? "+" : "−"}${currency.format(Math.abs(difference)).replace("$", "$")}`
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
        <td className="border-b border-border px-4 py-3">
          {flagged ? (
            <button
              type="button"
              className="btn-outline"
              disabled={dispute.drafting}
              onClick={dispute.toggleOrDraft}
            >
              {dispute.drafting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Mail className="size-3.5" />
              )}
              {dispute.email
                ? dispute.expanded
                  ? "Hide Draft"
                  : "View Draft"
                : dispute.drafting
                  ? "Drafting…"
                  : "Draft Dispute"}
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </tr>

      {flagged && dispute.expanded && (
        <tr className="border-b border-border last:border-0">
          <td colSpan={10} className="bg-background px-4 py-4">
            {dispute.drafting && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Drafting a dispute email…
              </p>
            )}

            {dispute.error && !dispute.drafting && (
              <p className="text-sm text-destructive">{dispute.error}</p>
            )}

            {dispute.email && !dispute.drafting && (
              <div className="max-w-2xl space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Subject
                  </p>
                  <p className="mt-0.5 text-sm font-medium">{dispute.email.subject}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Body
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                    {dispute.email.body}
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button type="button" className="btn-outline" onClick={dispute.copyEmail}>
                    {dispute.copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {dispute.copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    disabled={dispute.drafting}
                    onClick={dispute.runDraft}
                  >
                    <RotateCcw className="size-3.5" />
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

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
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                    No open claims yet.{" "}
                    <Link to="/claims/new" className="font-medium text-primary underline underline-offset-4">
                      Add a claim
                    </Link>{" "}
                    to get started.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <ClaimRowGroup key={row.claim.claim_id} row={row} />
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

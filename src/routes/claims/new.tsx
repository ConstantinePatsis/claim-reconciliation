import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const claimSchema = z.object({
  claim_id: z.string().trim().min(1, "Claim ID is required").max(50),
  invoice_id: z.string().min(1, "Please select the related invoice"),
  retailer: z.string().trim().min(1, "Retailer is required").max(200),
  reason: z.string().trim().min(1, "Reason is required").max(500),
  claimed_amount: z
    .number({ error: "Claimed amount must be a number" })
    .nonnegative("Claimed amount cannot be negative")
    .max(99999999.99, "Claimed amount is too large"),
});

export const Route = createFileRoute("/claims/new")({
  head: () => ({
    meta: [
      { title: "Add Deduction Claim — Deduction Reconciler" },
      {
        name: "description",
        content: "Manually add a new retailer deduction claim linked to an existing invoice.",
      },
      { property: "og:title", content: "Add Deduction Claim — Deduction Reconciler" },
      {
        property: "og:description",
        content: "Manually add a new retailer deduction claim linked to an existing invoice.",
      },
    ],
  }),
  component: AddClaimPage,
});

const invoicesQuery = {
  queryKey: ["invoices"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("invoices")
      .select("invoice_id, retailer, product")
      .order("invoice_id");
    if (error) throw error;
    return data as { invoice_id: string; retailer: string; product: string }[];
  },
};

function AddClaimPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: invoices, isLoading: invoicesLoading } = useQuery(invoicesQuery);

  const [form, setForm] = useState({
    claim_id: "",
    invoice_id: "",
    retailer: "",
    reason: "",
    claimed_amount: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function handleInvoiceSelect(value: string) {
    setForm((f) => {
      const invoice = invoices?.find((i) => i.invoice_id === value);
      return {
        ...f,
        invoice_id: value,
        retailer: f.retailer || invoice?.retailer || f.retailer,
      };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = claimSchema.safeParse({
      claim_id: form.claim_id,
      invoice_id: form.invoice_id,
      retailer: form.retailer,
      reason: form.reason,
      claimed_amount: Number(form.claimed_amount),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form values.");
      return;
    }

    setSubmitting(true);
    const { error: insertError } = await supabase.from("deduction_claims").insert(parsed.data);
    setSubmitting(false);

    if (insertError) {
      setError(
        insertError.code === "23505"
          ? `A claim with ID "${parsed.data.claim_id}" already exists.`
          : insertError.message,
      );
      return;
    }

    setSuccess(`Claim ${parsed.data.claim_id} saved with status "open".`);
    queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
    setForm({ claim_id: "", invoice_id: "", retailer: "", reason: "", claimed_amount: "" });
  }

  const noInvoices = !invoicesLoading && (invoices?.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Add Deduction Claim</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Register a retailer's deduction claim and link it to the invoice it relates to.
      </p>

      {noInvoices && (
        <p className="mt-6 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          There are no invoices yet.{" "}
          <Link to="/invoices/new" className="font-medium text-primary underline underline-offset-4">
            Add an invoice first
          </Link>{" "}
          so the claim can be linked to it.
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-5 rounded-lg border border-border bg-card p-6"
      >
        <div>
          <label htmlFor="claim_id" className="field-label">
            Claim ID
          </label>
          <input
            id="claim_id"
            className="field-input"
            placeholder="e.g. CLM-2001"
            value={form.claim_id}
            onChange={update("claim_id")}
          />
        </div>

        <div>
          <label htmlFor="invoice_id" className="field-label">
            Related Invoice
          </label>
          <select
            id="invoice_id"
            className="field-input"
            value={form.invoice_id}
            onChange={(e) => handleInvoiceSelect(e.target.value)}
            disabled={invoicesLoading || noInvoices}
          >
            <option value="">
              {invoicesLoading ? "Loading invoices…" : "Select an invoice…"}
            </option>
            {invoices?.map((inv) => (
              <option key={inv.invoice_id} value={inv.invoice_id}>
                {inv.invoice_id} — {inv.retailer} ({inv.product})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="retailer" className="field-label">
            Retailer
          </label>
          <input
            id="retailer"
            className="field-input"
            placeholder="e.g. FreshMart"
            value={form.retailer}
            onChange={update("retailer")}
          />
        </div>

        <div>
          <label htmlFor="reason" className="field-label">
            Reason
          </label>
          <input
            id="reason"
            className="field-input"
            placeholder="e.g. Shortage on delivery"
            value={form.reason}
            onChange={update("reason")}
          />
        </div>

        <div>
          <label htmlFor="claimed_amount" className="field-label">
            Claimed Amount ($)
          </label>
          <input
            id="claimed_amount"
            type="number"
            min={0}
            step="0.01"
            className="field-input"
            placeholder="e.g. 125.00"
            value={form.claimed_amount}
            onChange={update("claimed_amount")}
          />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-warning-muted px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        )}
        {success && (
          <p className="flex items-center gap-2 rounded-md border border-success/40 bg-secondary px-3 py-2 text-sm text-foreground">
            <CheckCircle2 className="size-4 text-success" />
            {success}{" "}
            <button
              type="button"
              onClick={() => navigate({ to: "/" })}
              className="font-medium text-primary underline underline-offset-4"
            >
              View reconciliation
            </button>
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting || noInvoices}>
            {submitting ? "Saving…" : "Save Claim"}
          </button>
        </div>
      </form>
    </div>
  );
}

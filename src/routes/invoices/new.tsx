import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const invoiceSchema = z.object({
  invoice_id: z.string().trim().min(1, "Invoice ID is required").max(50),
  retailer: z.string().trim().min(1, "Retailer is required").max(200),
  product: z.string().trim().min(1, "Product is required").max(200),
  units_shipped: z
    .number({ invalid_type_error: "Units shipped must be a number" })
    .int("Units shipped must be a whole number")
    .positive("Units shipped must be greater than 0"),
  price_per_unit: z
    .number({ invalid_type_error: "Price per unit must be a number" })
    .positive("Price per unit must be greater than 0")
    .max(99999999.99, "Price per unit is too large"),
  invoice_date: z.string().min(1, "Invoice date is required"),
});

export const Route = createFileRoute("/invoices/new")({
  head: () => ({
    meta: [
      { title: "Add Invoice — Deduction Reconciler" },
      {
        name: "description",
        content: "Manually add a new invoice to the reconciliation database.",
      },
      { property: "og:title", content: "Add Invoice — Deduction Reconciler" },
      {
        property: "og:description",
        content: "Manually add a new invoice to the reconciliation database.",
      },
    ],
  }),
  component: AddInvoicePage,
});

function AddInvoicePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    invoice_id: "",
    retailer: "",
    product: "",
    units_shipped: "",
    price_per_unit: "",
    invoice_date: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = invoiceSchema.safeParse({
      invoice_id: form.invoice_id,
      retailer: form.retailer,
      product: form.product,
      units_shipped: Number(form.units_shipped),
      price_per_unit: Number(form.price_per_unit),
      invoice_date: form.invoice_date,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form values.");
      return;
    }

    setSubmitting(true);
    const { error: insertError } = await supabase.from("invoices").insert(parsed.data);
    setSubmitting(false);

    if (insertError) {
      setError(
        insertError.code === "23505"
          ? `An invoice with ID "${parsed.data.invoice_id}" already exists.`
          : insertError.message,
      );
      return;
    }

    setSuccess(`Invoice ${parsed.data.invoice_id} saved.`);
    queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    setForm({
      invoice_id: "",
      retailer: "",
      product: "",
      units_shipped: "",
      price_per_unit: "",
      invoice_date: "",
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Add Invoice</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the details of a new invoice. Claims can then be linked to this invoice ID.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 space-y-5 rounded-lg border border-border bg-card p-6"
      >
        <div>
          <label htmlFor="invoice_id" className="field-label">
            Invoice ID
          </label>
          <input
            id="invoice_id"
            className="field-input"
            placeholder="e.g. INV-1001"
            value={form.invoice_id}
            onChange={update("invoice_id")}
          />
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
          <label htmlFor="product" className="field-label">
            Product
          </label>
          <input
            id="product"
            className="field-input"
            placeholder="e.g. Organic Apple Juice 1L"
            value={form.product}
            onChange={update("product")}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="units_shipped" className="field-label">
              Units Shipped
            </label>
            <input
              id="units_shipped"
              type="number"
              min={1}
              step={1}
              className="field-input"
              placeholder="e.g. 500"
              value={form.units_shipped}
              onChange={update("units_shipped")}
            />
          </div>
          <div>
            <label htmlFor="price_per_unit" className="field-label">
              Price per Unit ($)
            </label>
            <input
              id="price_per_unit"
              type="number"
              min={0}
              step="0.01"
              className="field-input"
              placeholder="e.g. 2.50"
              value={form.price_per_unit}
              onChange={update("price_per_unit")}
            />
          </div>
        </div>

        <div>
          <label htmlFor="invoice_date" className="field-label">
            Invoice Date
          </label>
          <input
            id="invoice_date"
            type="date"
            className="field-input"
            value={form.invoice_date}
            onChange={update("invoice_date")}
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
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save Invoice"}
          </button>
        </div>
      </form>
    </div>
  );
}

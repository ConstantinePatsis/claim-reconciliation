import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { z } from "zod";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractInvoiceFromFile, type ExtractedInvoice, type FieldConfidence } from "@/lib/invoice-extraction.functions";
import { blobToBase64 } from "@/lib/utils";

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

export const Route = createFileRoute("/invoices/upload")({
  head: () => ({
    meta: [
      { title: "Upload Invoice — Deduction Reconciler" },
      {
        name: "description",
        content:
          "Upload an invoice image or PDF and let AI extract the retailer, product, units and pricing for review.",
      },
      { property: "og:title", content: "Upload Invoice — Deduction Reconciler" },
      {
        property: "og:description",
        content:
          "Upload an invoice image or PDF and let AI extract the retailer, product, units and pricing for review.",
      },
    ],
  }),
  component: UploadInvoicePage,
});

const MAX_BYTES = 15 * 1024 * 1024;

const emptyForm = {
  invoice_id: "",
  retailer: "",
  product: "",
  units_shipped: "",
  price_per_unit: "",
  invoice_date: "",
};

const CONFIDENCE_STYLES: Record<FieldConfidence, string> = {
  high: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  low: "bg-destructive/15 text-destructive",
};

function ConfidenceBadge({ level }: { level: FieldConfidence }) {
  return (
    <span
      className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${CONFIDENCE_STYLES[level]}`}
    >
      {level}
    </span>
  );
}

function wasCorrected(extracted: string | number | null, final: string | number): boolean {
  if (extracted === null) return true;
  if (typeof extracted === "number" && typeof final === "number") {
    return Math.abs(extracted - final) > 0.005;
  }
  return String(extracted).trim() !== String(final).trim();
}

function UploadInvoicePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const extract = useServerFn(extractInvoiceFromFile);

  const [fileName, setFileName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [extractedSnapshot, setExtractedSnapshot] = useState<ExtractedInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    setFileName(file.name);
    setExtractedSnapshot(null);

    if (file.size > MAX_BYTES) {
      setError("That file is larger than 15 MB. Please upload a smaller image or PDF.");
      return;
    }

    setExtracting(true);
    try {
      const base64 = await blobToBase64(file);
      const result = await extract({
        data: {
          fileName: file.name,
          mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
          base64,
        },
      });

      setForm({
        invoice_id: "",
        retailer: result.retailer ?? "",
        product: result.product ?? "",
        units_shipped: result.units_shipped != null ? String(result.units_shipped) : "",
        price_per_unit: result.price_per_unit != null ? String(result.price_per_unit) : "",
        invoice_date: result.invoice_date ?? "",
      });
      const blanks = [
        result.retailer == null ? "retailer" : null,
        result.product == null ? "product" : null,
        result.units_shipped == null ? "units shipped" : null,
        result.price_per_unit == null ? "price per unit" : null,
        result.invoice_date == null ? "invoice date" : null,
      ].filter(Boolean) as string[];
      setMissing(blanks);
      setExtractedSnapshot(result);
      setExtracted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file. Please try again.");
    } finally {
      setExtracting(false);
    }
  }

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

    if (extractedSnapshot) {
      const reviewRows = [
        { field: "retailer", extracted_value: extractedSnapshot.retailer, final_value: parsed.data.retailer },
        { field: "product", extracted_value: extractedSnapshot.product, final_value: parsed.data.product },
        {
          field: "units_shipped",
          extracted_value: extractedSnapshot.units_shipped,
          final_value: parsed.data.units_shipped,
        },
        {
          field: "price_per_unit",
          extracted_value: extractedSnapshot.price_per_unit,
          final_value: parsed.data.price_per_unit,
        },
        {
          field: "invoice_date",
          extracted_value: extractedSnapshot.invoice_date,
          final_value: parsed.data.invoice_date,
        },
      ].map((row) => ({
        file_name: fileName ?? "unknown",
        field: row.field,
        extracted_value: row.extracted_value === null ? null : String(row.extracted_value),
        final_value: String(row.final_value),
        was_corrected: wasCorrected(row.extracted_value, row.final_value),
      }));

      // Best-effort telemetry — never block the save flow on this.
      const { error: reviewError } = await supabase.from("extraction_reviews").insert(reviewRows);
      if (reviewError) console.error("[extraction_reviews]", reviewError.message);
    }

    setForm(emptyForm);
    setExtracted(false);
    setMissing([]);
    setFileName(null);
    setExtractedSnapshot(null);
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Upload Invoice</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload an invoice image or PDF. The details are read automatically, then you review and
        correct them before saving.
      </p>

      <div className="mt-6 rounded-lg border border-border bg-card p-6">
        <label htmlFor="invoice_file" className="field-label">
          Invoice file (image or PDF)
        </label>
        <input
          id="invoice_file"
          type="file"
          accept="image/*,application/pdf"
          className="field-input"
          onChange={handleFile}
          disabled={extracting}
        />
        {fileName && (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Upload className="size-4" />
            {fileName}
          </p>
        )}
        {extracting && (
          <p className="mt-3 flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Reading the invoice… this can take up to a minute.
          </p>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-warning-muted px-3 py-2 text-sm text-foreground">
          {error}
        </p>
      )}

      {success && (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-success/40 bg-secondary px-3 py-2 text-sm text-foreground">
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

      {extracted && (
        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-5 rounded-lg border border-border bg-card p-6"
        >
          <div>
            <h2 className="text-sm font-semibold">Review extracted details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {missing.length > 0
                ? `Could not read: ${missing.join(", ")}. Please fill these in manually.`
                : "All fields were read. Check them before saving."}
            </p>
          </div>

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
            <label htmlFor="retailer" className="field-label flex items-center">
              Retailer
              {extractedSnapshot && <ConfidenceBadge level={extractedSnapshot.confidence.retailer} />}
            </label>
            <input
              id="retailer"
              className="field-input"
              value={form.retailer}
              onChange={update("retailer")}
            />
          </div>

          <div>
            <label htmlFor="product" className="field-label flex items-center">
              Product
              {extractedSnapshot && <ConfidenceBadge level={extractedSnapshot.confidence.product} />}
            </label>
            <input
              id="product"
              className="field-input"
              value={form.product}
              onChange={update("product")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="units_shipped" className="field-label flex items-center">
                Units Shipped
                {extractedSnapshot && (
                  <ConfidenceBadge level={extractedSnapshot.confidence.units_shipped} />
                )}
              </label>
              <input
                id="units_shipped"
                type="number"
                min={1}
                step={1}
                className="field-input"
                value={form.units_shipped}
                onChange={update("units_shipped")}
              />
            </div>
            <div>
              <label htmlFor="price_per_unit" className="field-label flex items-center">
                Price per Unit ($)
                {extractedSnapshot && (
                  <ConfidenceBadge level={extractedSnapshot.confidence.price_per_unit} />
                )}
              </label>
              <input
                id="price_per_unit"
                type="number"
                min={0}
                step="0.01"
                className="field-input"
                value={form.price_per_unit}
                onChange={update("price_per_unit")}
              />
            </div>
          </div>

          <div>
            <label htmlFor="invoice_date" className="field-label flex items-center">
              Invoice Date
              {extractedSnapshot && (
                <ConfidenceBadge level={extractedSnapshot.confidence.invoice_date} />
              )}
            </label>
            <input
              id="invoice_date"
              type="date"
              className="field-input"
              value={form.invoice_date}
              onChange={update("invoice_date")}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </Link>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save Invoice"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

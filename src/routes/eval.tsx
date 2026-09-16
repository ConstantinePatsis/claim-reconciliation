import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react";
import {
  extractInvoiceFromFile,
  type ExtractedInvoice,
  type FieldConfidence,
} from "@/lib/invoice-extraction.functions";
import { supabase } from "@/integrations/supabase/client";
import { blobToBase64 } from "@/lib/utils";

export const Route = createFileRoute("/eval")({
  head: () => ({
    meta: [
      { title: "Extraction Eval — Deduction Reconciler" },
      {
        name: "description",
        content: "Measure invoice extraction accuracy against a fixed set of test invoices.",
      },
    ],
  }),
  component: EvalPage,
});

type FieldKey = "retailer" | "product" | "units_shipped" | "price_per_unit" | "invoice_date";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "retailer", label: "Retailer" },
  { key: "product", label: "Product" },
  { key: "units_shipped", label: "Units" },
  { key: "price_per_unit", label: "Price/Unit" },
  { key: "invoice_date", label: "Date" },
];

type Fixture = {
  file: string;
  expected: {
    retailer: string;
    product: string | null;
    units_shipped: number | null;
    price_per_unit: number | null;
    invoice_date: string | null;
  };
};

type FixtureResult = {
  fixture: Fixture;
  status: "pending" | "running" | "done" | "error";
  extracted?: ExtractedInvoice;
  error?: string;
  fieldMatches?: Record<FieldKey, boolean>;
};

function normalizeString(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

function fieldMatches(key: FieldKey, expected: unknown, extracted: unknown): boolean {
  if (expected === null && extracted === null) return true;
  if (expected === null || extracted === null) return false;
  if (key === "retailer" || key === "product") {
    return normalizeString(String(expected)) === normalizeString(String(extracted));
  }
  if (key === "invoice_date") {
    return String(expected) === String(extracted);
  }
  return Math.abs(Number(expected) - Number(extracted)) < 0.005;
}

function formatValue(key: FieldKey, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (key === "price_per_unit") return `$${Number(value).toFixed(2)}`;
  return String(value);
}

function mimeTypeFor(file: string): string {
  return file.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png";
}

const CONFIDENCE_DOT: Record<FieldConfidence, string> = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-destructive",
};

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

function EvalPage() {
  const extract = useServerFn(extractInvoiceFromFile);
  const [results, setResults] = useState<FixtureResult[]>([]);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const done = results.filter((r) => r.status === "done" || r.status === "error");

  const summary = useMemo(() => {
    const finished = results.filter((r) => r.status === "done");
    const perField: Record<FieldKey, { correct: number; total: number }> = {
      retailer: { correct: 0, total: 0 },
      product: { correct: 0, total: 0 },
      units_shipped: { correct: 0, total: 0 },
      price_per_unit: { correct: 0, total: 0 },
      invoice_date: { correct: 0, total: 0 },
    };
    let fullyCorrect = 0;
    for (const r of finished) {
      if (!r.fieldMatches) continue;
      let allMatch = true;
      for (const { key } of FIELDS) {
        perField[key].total += 1;
        if (r.fieldMatches[key]) perField[key].correct += 1;
        else allMatch = false;
      }
      if (allMatch) fullyCorrect += 1;
    }
    const totalFields = FIELDS.reduce((sum, f) => sum + perField[f.key].total, 0);
    const correctFields = FIELDS.reduce((sum, f) => sum + perField[f.key].correct, 0);
    return {
      finishedCount: finished.length,
      fullyCorrect,
      perField,
      overallAccuracy: totalFields > 0 ? correctFields / totalFields : 0,
    };
  }, [results]);

  const calibration = useMemo(() => {
    const buckets: Record<FieldConfidence, { correct: number; total: number }> = {
      high: { correct: 0, total: 0 },
      medium: { correct: 0, total: 0 },
      low: { correct: 0, total: 0 },
    };
    for (const r of results) {
      if (r.status !== "done" || !r.extracted || !r.fieldMatches) continue;
      for (const { key } of FIELDS) {
        const level = r.extracted.confidence[key];
        buckets[level].total += 1;
        if (r.fieldMatches[key]) buckets[level].correct += 1;
      }
    }
    return buckets;
  }, [results]);

  const [liveStats, setLiveStats] = useState<Record<FieldKey, { corrected: number; total: number }> | null>(
    null,
  );
  const [liveStatsError, setLiveStatsError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("extraction_reviews").select("field, was_corrected");
      if (error) {
        setLiveStatsError(error.message);
        return;
      }
      const stats: Record<FieldKey, { corrected: number; total: number }> = {
        retailer: { corrected: 0, total: 0 },
        product: { corrected: 0, total: 0 },
        units_shipped: { corrected: 0, total: 0 },
        price_per_unit: { corrected: 0, total: 0 },
        invoice_date: { corrected: 0, total: 0 },
      };
      for (const row of data ?? []) {
        const key = row.field as FieldKey;
        if (!(key in stats)) continue;
        stats[key].total += 1;
        if (row.was_corrected) stats[key].corrected += 1;
      }
      setLiveStats(stats);
    })();
  }, []);

  async function runSuite() {
    setRunning(true);
    setLoadError(null);
    try {
      const res = await fetch("/eval-fixtures/ground-truth.json");
      if (!res.ok) throw new Error(`Could not load the fixture manifest (${res.status}).`);
      const fixtures = (await res.json()) as Fixture[];

      const initial: FixtureResult[] = fixtures.map((fixture) => ({ fixture, status: "pending" }));
      setResults(initial);

      await runPool(fixtures, 3, async (fixture) => {
        setResults((prev) =>
          prev.map((r) => (r.fixture.file === fixture.file ? { ...r, status: "running" } : r)),
        );
        try {
          const imgRes = await fetch(`/eval-fixtures/${fixture.file}`);
          if (!imgRes.ok) throw new Error(`Fixture image failed to load (${imgRes.status}).`);
          const blob = await imgRes.blob();
          const base64 = await blobToBase64(blob);

          const extracted = await extract({
            data: { fileName: fixture.file, mimeType: mimeTypeFor(fixture.file), base64 },
          });

          const matches = Object.fromEntries(
            FIELDS.map(
              ({ key }): [FieldKey, boolean] => [
                key,
                fieldMatches(key, fixture.expected[key], extracted[key]),
              ],
            ),
          ) as Record<FieldKey, boolean>;

          setResults((prev) =>
            prev.map((r) =>
              r.fixture.file === fixture.file
                ? { ...r, status: "done", extracted, fieldMatches: matches }
                : r,
            ),
          );
        } catch (err) {
          setResults((prev) =>
            prev.map((r) =>
              r.fixture.file === fixture.file
                ? {
                    ...r,
                    status: "error",
                    error: err instanceof Error ? err.message : "Extraction failed.",
                  }
                : r,
            ),
          );
        }
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not run the eval suite.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FlaskConical className="size-6 text-primary" />
          Extraction Eval Suite
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs the invoice extraction model against 20 fixed test invoices — clean, relabeled,
          unusual date formats, missing fields, noisy scans, a skewed scan, and 2 native PDFs — and
          scores the result field by field against known-correct values.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button type="button" className="btn-primary" onClick={runSuite} disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
          {running ? `Running… (${done.length}/${results.length || 20})` : "Run Eval Suite"}
        </button>
        <p className="text-xs text-muted-foreground">
          Calls the AI model once per fixture — this uses real AI credits and takes about a minute.
        </p>
      </div>

      {loadError && (
        <p className="rounded-md border border-destructive/40 bg-warning-muted px-3 py-2 text-sm text-foreground">
          {loadError}
        </p>
      )}

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="stat-card">
              <p className="stat-label">Overall Field Accuracy</p>
              <p className="stat-value">{(summary.overallAccuracy * 100).toFixed(0)}%</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Fully Correct</p>
              <p className="stat-value">
                {summary.fullyCorrect}/{summary.finishedCount || results.length}
              </p>
            </div>
            {FIELDS.slice(0, 2).map(({ key, label }) => {
              const f = summary.perField[key];
              return (
                <div className="stat-card" key={key}>
                  <p className="stat-label">{label} Accuracy</p>
                  <p className="stat-value">
                    {f.total > 0 ? `${((f.correct / f.total) * 100).toFixed(0)}%` : "—"}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {FIELDS.slice(2).map(({ key, label }) => {
              const f = summary.perField[key];
              return (
                <span key={key}>
                  {label}: {f.total > 0 ? `${((f.correct / f.total) * 100).toFixed(0)}%` : "—"}
                </span>
              );
            })}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Confidence Calibration
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Is the model's own confidence signal trustworthy? Accuracy of extracted fields, broken
              down by the confidence level the model reported for them.
            </p>
            <div className="mt-3 flex flex-wrap gap-6">
              {(["high", "medium", "low"] as const).map((level) => {
                const b = calibration[level];
                return (
                  <div key={level} className="flex items-center gap-2">
                    <span className={`size-2.5 rounded-full ${CONFIDENCE_DOT[level]}`} />
                    <span className="text-sm">
                      <span className="font-medium capitalize">{level}</span>{" "}
                      <span className="text-muted-foreground">
                        {b.total > 0 ? `${((b.correct / b.total) * 100).toFixed(0)}% correct (n=${b.total})` : "no data"}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Fixture</th>
                    {FIELDS.map(({ key, label }) => (
                      <th key={key} className="px-4 py-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.fixture.file}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.fixture.file}</td>
                      {r.status === "pending" || r.status === "running" ? (
                        <td colSpan={5} className="px-4 py-3 text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <Loader2 className="size-3.5 animate-spin" />
                            {r.status === "running" ? "Extracting…" : "Waiting…"}
                          </span>
                        </td>
                      ) : r.status === "error" ? (
                        <td colSpan={5} className="px-4 py-3 text-destructive">
                          {r.error}
                        </td>
                      ) : (
                        FIELDS.map(({ key }) => {
                          const correct = r.fieldMatches?.[key] ?? false;
                          const extractedValue = r.extracted ? r.extracted[key] : undefined;
                          const confidenceLevel = r.extracted?.confidence[key];
                          return (
                            <td key={key} className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                {confidenceLevel && (
                                  <span
                                    className={`size-1.5 shrink-0 rounded-full ${CONFIDENCE_DOT[confidenceLevel]}`}
                                    title={`confidence: ${confidenceLevel}`}
                                  />
                                )}
                                {correct ? (
                                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                                ) : (
                                  <XCircle className="size-4 shrink-0 text-destructive" />
                                )}
                                <span className="tabular-nums">{formatValue(key, extractedValue)}</span>
                              </div>
                              {!correct && (
                                <div className="mt-0.5 pl-[1.375rem] text-xs text-muted-foreground">
                                  expected: {formatValue(key, r.fixture.expected[key])}
                                </div>
                              )}
                            </td>
                          );
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Live Correction Rate
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          From real usage of the Upload Invoice page — how often a human changed an AI-extracted
          field before saving. This is a production signal, separate from the synthetic fixtures
          above.
        </p>

        {liveStatsError && (
          <p className="mt-3 text-xs text-muted-foreground">
            Live correction stats aren't available yet ({liveStatsError}).
          </p>
        )}

        {!liveStatsError && liveStats && (
          <div className="mt-3 flex flex-wrap gap-6">
            {FIELDS.map(({ key, label }) => {
              const s = liveStats[key];
              return (
                <div key={key} className="text-sm">
                  <span className="font-medium">{label}:</span>{" "}
                  <span className="text-muted-foreground">
                    {s.total > 0
                      ? `${((s.corrected / s.total) * 100).toFixed(0)}% corrected (n=${s.total})`
                      : "no data yet"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

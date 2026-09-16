import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ExtractInput = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(120),
  // base64-encoded file contents (no data: prefix)
  base64: z.string().min(1),
});

export type FieldConfidence = "high" | "medium" | "low";

export type ExtractedInvoice = {
  retailer: string | null;
  product: string | null;
  units_shipped: number | null;
  price_per_unit: number | null;
  invoice_date: string | null;
  confidence: {
    retailer: FieldConfidence;
    product: FieldConfidence;
    units_shipped: FieldConfidence;
    price_per_unit: FieldConfidence;
    invoice_date: FieldConfidence;
  };
};

const confidenceEnum = { type: "string", enum: ["high", "medium", "low"] } as const;

const invoiceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    retailer: { type: ["string", "null"] },
    product: { type: ["string", "null"] },
    units_shipped: { type: ["integer", "null"] },
    price_per_unit: { type: ["number", "null"] },
    invoice_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        retailer: confidenceEnum,
        product: confidenceEnum,
        units_shipped: confidenceEnum,
        price_per_unit: confidenceEnum,
        invoice_date: confidenceEnum,
      },
      required: ["retailer", "product", "units_shipped", "price_per_unit", "invoice_date"],
    },
  },
  required: ["retailer", "product", "units_shipped", "price_per_unit", "invoice_date", "confidence"],
} as const;

const PROMPT = [
  "You are reading a supplier invoice document.",
  "Extract these fields as json: retailer, product, units_shipped (integer),",
  "price_per_unit (decimal number, per single unit), invoice_date (YYYY-MM-DD).",
  "If a field is not clearly stated in the document, return null for it.",
  "Never guess or infer a value you cannot read.",
  "Also return a confidence level for each field: \"high\" if it is stated clearly and",
  "unambiguously, \"medium\" if it is present but required some interpretation (unusual",
  "formatting, partly obscured, inferred from context), or \"low\" if the field is missing,",
  "illegible, or you are unsure. A null field must have confidence \"low\".",
].join(" ");

export const extractInvoiceFromFile = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ExtractInput.parse(input))
  .handler(async ({ data }): Promise<ExtractedInvoice> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const isImage = data.mimeType.startsWith("image/");
    const dataUrl = `data:${data.mimeType};base64,${data.base64}`;

    const content = isImage
      ? [
          { type: "input_text", text: PROMPT },
          { type: "input_image", image_url: dataUrl },
        ]
      : [
          { type: "input_text", text: PROMPT },
          { type: "input_file", filename: data.fileName, file_data: dataUrl },
        ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        input: [{ role: "user", content }],
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
        text: {
          format: {
            type: "json_schema",
            name: "invoice_fields",
            strict: true,
            schema: invoiceJsonSchema,
          },
        },
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      if (res.status === 429) {
        throw new Error("The AI service is busy right now. Please try again in a moment.");
      }
      if (res.status === 402 || res.status === 403) {
        throw new Error(
          "AI credits are unavailable for this workspace. Add credits in Lovable to keep using extraction.",
        );
      }
      throw new Error(`Could not read the invoice (${res.status}). ${detail.slice(0, 300)}`);
    }

    // Read the SSE stream and accumulate the output text deltas.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            text += event.delta;
          } else if (event.type === "response.completed" && event.response?.output_text) {
            if (!text) text = event.response.output_text;
          }
        } catch {
          // ignore keep-alive / non-JSON lines
        }
      }
    }

    if (!text.trim()) {
      return {
        retailer: null,
        product: null,
        units_shipped: null,
        price_per_unit: null,
        invoice_date: null,
        confidence: {
          retailer: "low",
          product: "low",
          units_shipped: "low",
          price_per_unit: "low",
          invoice_date: "low",
        },
      };
    }

    const ConfidenceSchema = z.enum(["high", "medium", "low"]);
    const ResultSchema = z.object({
      retailer: z.string().nullable(),
      product: z.string().nullable(),
      units_shipped: z.number().nullable(),
      price_per_unit: z.number().nullable(),
      invoice_date: z.string().nullable(),
      confidence: z.object({
        retailer: ConfidenceSchema,
        product: ConfidenceSchema,
        units_shipped: ConfidenceSchema,
        price_per_unit: ConfidenceSchema,
        invoice_date: ConfidenceSchema,
      }),
    });

    try {
      return ResultSchema.parse(JSON.parse(text));
    } catch {
      throw new Error("The AI response could not be read. Please try again or enter fields manually.");
    }
  });

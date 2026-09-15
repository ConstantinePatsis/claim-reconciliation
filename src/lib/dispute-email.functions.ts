import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DraftInput = z.object({
  claimId: z.string().min(1).max(50),
  invoiceId: z.string().nullable(),
  retailer: z.string().min(1).max(200),
  product: z.string().nullable(),
  reason: z.string().min(1).max(2000),
  unitsShipped: z.number().nullable(),
  pricePerUnit: z.number().nullable(),
  claimedAmount: z.number(),
  expectedTotal: z.number().nullable(),
  difference: z.number().nullable(),
});

export type DraftedDispute = {
  subject: string;
  body: string;
};

const emailJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
} as const;

function buildPrompt(d: z.infer<typeof DraftInput>): string {
  return [
    "You are a vendor-finance specialist drafting a deduction dispute email to a retailer.",
    "Write a professional email that is firm but polite, disputing a deduction claim that appears",
    "invalid based on the invoice on file.",
    "",
    `Retailer: ${d.retailer}`,
    `Claim ID: ${d.claimId}`,
    `Invoice ID: ${d.invoiceId ?? "unknown"}`,
    `Product: ${d.product ?? "unknown"}`,
    `Stated reason for deduction: "${d.reason}"`,
    `Units shipped per invoice: ${d.unitsShipped ?? "unknown"}`,
    `Price per unit per invoice: ${d.pricePerUnit ?? "unknown"}`,
    `Expected total from invoice (units x price): ${d.expectedTotal ?? "unknown"}`,
    `Amount claimed as deduction: ${d.claimedAmount}`,
    `Difference between claimed amount and expected total: ${d.difference ?? "unknown"}`,
    "",
    "The email must:",
    "- State clearly what the invoice shows (units shipped, price per unit, expected total).",
    "- State what was claimed and the discrepancy between the two.",
    "- Explain that the discrepancy suggests the deduction is invalid.",
    "- Request that the retailer reverse the deduction, or provide supporting documentation for it.",
    "- Stay under 200 words, professional in tone, and end with a clear next step.",
    "",
    'Return JSON with "subject" and "body". The body is plain text with real line breaks between',
    "paragraphs, no markdown, no placeholder brackets left unfilled.",
  ].join("\n");
}

export const draftDisputeEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DraftInput.parse(input))
  .handler(async ({ data }): Promise<DraftedDispute> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured for this project.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        input: [{ role: "user", content: [{ type: "input_text", text: buildPrompt(data) }] }],
        stream: true,
        reasoning: { effort: "low", summary: "auto" },
        text: {
          format: {
            type: "json_schema",
            name: "dispute_email",
            strict: true,
            schema: emailJsonSchema,
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
          "AI credits are unavailable for this workspace. Add credits in Lovable to keep drafting disputes.",
        );
      }
      throw new Error(`Could not draft a dispute email (${res.status}). ${detail.slice(0, 300)}`);
    }

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
      throw new Error("The AI did not return a draft. Please try again.");
    }

    const ResultSchema = z.object({
      subject: z.string().min(1),
      body: z.string().min(1),
    });

    try {
      return ResultSchema.parse(JSON.parse(text));
    } catch {
      throw new Error("The AI response could not be read. Please try again.");
    }
  });

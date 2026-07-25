// Funding AI writing helper — draft / rewrite / fill from business context.
// Deploy: npx supabase functions deploy funding-ai-write --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as {
      mode?: string;
      section_title?: string;
      current_content?: string;
      business_context?: Record<string, unknown>;
      tone?: string;
    };

    const mode = (body.mode || "draft").toLowerCase();
    const sectionTitle = String(body.section_title || "Business plan section").slice(0, 200);
    const currentContent = String(body.current_content || "").slice(0, 20000);
    const tone = String(body.tone || "professional Canadian business English").slice(0, 200);
    const businessContext = body.business_context || {};

    const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
    if (!apiKey) return json({ error: "AI writing is not configured (OPENAI_API_KEY)" }, 503);

    const modeInstructions: Record<string, string> = {
      draft:
        "Write a complete first draft for this section from scratch using the business context. Do not invent fake metrics; use placeholders like [insert revenue] when data is missing.",
      rewrite:
        "Rewrite and improve the existing content for clarity, professionalism, and grant/loan readiness. Preserve factual claims; do not invent numbers.",
      fill:
        "Fill and expand the section using the provided business context. Prefer real context fields over invention. Mark unknowns clearly.",
    };

    const system = `You are a Canadian business-plan and funding-application writer.
Write in ${tone}.
Audience: lenders, grant officers, and investors in Canada.
Be concrete, concise, and credible. Use Canadian spelling (e.g. organisation only if the user already does; prefer Canadian: centre, labour, favour when natural).
Return plain text only — no markdown headings unless the section needs short subheadings.`;

    const userPrompt = `Mode: ${mode}
Section: ${sectionTitle}

Instructions: ${modeInstructions[mode] || modeInstructions.draft}

Business context (JSON):
${JSON.stringify(businessContext).slice(0, 8000)}

Existing content:
${currentContent || "(empty)"}`;

    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_FUNDING_MODEL")?.trim() || "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const openAiBody = await openAiRes.text();
    if (!openAiRes.ok) {
      return json({ error: `OpenAI error: ${openAiBody.slice(0, 400)}` }, 502);
    }

    let content = "";
    try {
      const parsed = JSON.parse(openAiBody) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      content = parsed?.choices?.[0]?.message?.content?.trim() || "";
    } catch {
      return json({ error: "Failed to parse AI response" }, 502);
    }

    if (!content) return json({ error: "AI returned empty content" }, 502);
    return json({ content, mode, section_title: sectionTitle });
  } catch (err) {
    console.error("[funding-ai-write]", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});

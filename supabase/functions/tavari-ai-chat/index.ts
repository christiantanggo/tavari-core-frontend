// Tavari AI Chat - OpenAI chat completions for in-app help + navigation guidance.
// POST body: { messages: [{ role, content }], context?: { module?, screen?, pathname?, enabledModules?, visibleNav?, visibleFeatures? } }
// Set OPENAI_API_KEY in Supabase Edge Function secrets.
// Deploy: supabase functions deploy tavari-ai-chat

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import navCatalog from "../_shared/aiNavigationCatalog.json" with { type: "json" };
import helpKnowledge from "../_shared/aiHelpKnowledge.json" with { type: "json" };
import {
  buildAiChatSystemPrompt,
  searchHelpKnowledge,
  searchNavigationCatalog,
  type ChatContextPayload,
  type ExpenseCategoryContext,
  type HelpKnowledgeEntry,
  type NavCatalogEntry,
} from "../_shared/aiChatPromptBuilder.ts";
import { buildActionsFromMessage, staffLinkLabel } from "../_shared/aiChatIntent.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function corsResponse(body: string | null, status: number) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, ...(body ? { "Content-Type": "application/json" } : {}) },
  });
}

const MAX_MSG_CHARS = 32000;
const CATALOG = navCatalog as NavCatalogEntry[];
const KNOWLEDGE = helpKnowledge as HelpKnowledgeEntry[];

/** OpenAI error bodies are JSON: { error: { message, type, code } } */
function openAiErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } };
    const msg = parsed?.error?.message;
    const code = parsed?.error?.code;
    if (msg && code) return `${msg} (${code})`;
    if (msg) return msg;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 500);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return corsResponse(null, 204);
    if (req.method !== "POST") return corsResponse(JSON.stringify({ error: "Method not allowed" }), 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);

    const body = (await req.json().catch(() => ({}))) as {
      messages?: Array<{ role: string; content: string }>;
      context?: ChatContextPayload;
    };

    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    const context = body?.context || {};

    const messages = rawMessages
      .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content.length > MAX_MSG_CHARS ? m.content.slice(0, MAX_MSG_CHARS) : m.content,
      }));

    if (messages.length === 0) return corsResponse(JSON.stringify({ error: "messages required" }), 400);

    const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
    if (!apiKey) return corsResponse(JSON.stringify({ error: "AI chat not configured" }), 503);

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastUserMessage = lastUser?.content || "";

    const taskActions = buildActionsFromMessage(lastUserMessage, {
      openBookingId: context.openBookingId || null,
    });

    if (taskActions.length > 0) {
      const printAction = taskActions.find((a) => a.type === "resolve_camper_registration_print");
      if (printAction) {
        const searchName = printAction.searchName || "that camper";
        const content =
          `I'll look up the camp registration for ${searchName} and open the print window. ` +
          "You'll just need to click **Print** in the browser dialog to finish.";
        return corsResponse(JSON.stringify({ content, actions: taskActions }), 200);
      }

      const linkAction = taskActions.find((a) => a.type === "resolve_staff_link");
      if (linkAction && linkAction.type === "resolve_staff_link") {
        const label = staffLinkLabel(linkAction.linkId);
        const content =
          `I'll get the **${label}** link for your business and copy it to your clipboard.`;
        return corsResponse(JSON.stringify({ content, actions: taskActions }), 200);
      }

      const listAction = taskActions.find((a) => a.type === "list_staff_links");
      if (listAction && listAction.type === "list_staff_links") {
        const cat = listAction.category || "all";
        const content =
          cat === "all"
            ? "Here are the shareable links for your business — customer portals, kiosks, and staff URLs."
            : `Here are the **${cat}** links for your business.`;
        return corsResponse(JSON.stringify({ content, actions: taskActions }), 200);
      }

      const disambiguateAction = taskActions.find((a) => a.type === "disambiguate_staff_links");
      if (disambiguateAction && disambiguateAction.type === "disambiguate_staff_links") {
        const ids = disambiguateAction.linkIds || [];
        const content =
          ids.length > 0
            ? "I found a few links that could match. Which one do you need?"
            : "Which link do you need? For example: host guest list link, booking portal, camp registration, or waiver kiosk.";
        return corsResponse(JSON.stringify({ content, actions: taskActions }), 200);
      }

      const openGuestListAction = taskActions.find((a) => a.type === "open_booking_guest_list");
      if (openGuestListAction && openGuestListAction.type === "open_booking_guest_list") {
        const content = openGuestListAction.bookingId
          ? "Opening the **Guest list** tab for this booking."
          : "I'll find that party booking and open the **Guest list** tab.";
        return corsResponse(JSON.stringify({ content, actions: taskActions }), 200);
      }
    }

    const visibleIds = new Set((context.visibleFeatures || []).map((f) => f.id));
    const knowledgeChunks = searchHelpKnowledge(lastUserMessage, KNOWLEDGE, 5);
    const matchedNav = searchNavigationCatalog(lastUserMessage, CATALOG, visibleIds, 6);

    let expenseCategories: ExpenseCategoryContext[] = [];
    const businessId = typeof context.businessId === "string" ? context.businessId.trim() : "";
    const wantsAccountingContext =
      !!businessId &&
      (
        (context.enabledModules || []).some((m) => String(m).toLowerCase().includes("accounting"))
        || /account|categor|expense|invoice|hst|gst|cogs|vendor|gl\b|classify|classification|queue|receipt|bill/i.test(lastUserMessage)
        || /\/dashboard\/accounting/i.test(String(context.pathname || ""))
      );
    if (wantsAccountingContext) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseUser = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: cats } = await supabaseUser
          .from("accounting_expense_categories")
          .select("name, gl_account_erpnext, default_hst_treatment, sort_order")
          .eq("business_id", businessId)
          .order("sort_order")
          .order("name");
        expenseCategories = (cats || []).map((c) => ({
          name: String(c.name || "").trim(),
          gl_account_erpnext: c.gl_account_erpnext ?? null,
          default_hst_treatment: c.default_hst_treatment ?? null,
        })).filter((c) => c.name);
      } catch (e) {
        console.warn("[tavari-ai-chat] expense categories load failed", e);
      }
    }

    const systemContent = buildAiChatSystemPrompt({
      context,
      lastUserMessage,
      knowledgeChunks,
      matchedNav,
      expenseCategories,
    });

    const apiMessages = [{ role: "system" as const, content: systemContent }, ...messages];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: apiMessages,
        max_tokens: 1024,
        temperature: 0.5,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[tavari-ai-chat] OpenAI HTTP", res.status, err.slice(0, 800));
      const detail = openAiErrorDetail(err);
      return corsResponse(JSON.stringify({ error: "AI request failed", detail }), 502);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content || "";
    return corsResponse(JSON.stringify({ content, actions: [] }), 200);
  } catch (e) {
    console.error("[tavari-ai-chat]", e);
    return corsResponse(JSON.stringify({ error: e instanceof Error ? e.message : "Chat failed" }), 500);
  }
});

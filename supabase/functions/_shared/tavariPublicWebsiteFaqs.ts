/** Public website FAQs for external marketing sites (OTWK). */

import {
  applyWebsiteCopyTokens,
  loadWebsiteCopyTokens,
  type WebsiteCopyTokens,
} from "./tavariPublicWebsiteCopyTokens.ts";

export const WEBSITE_FAQ_PAGE_KEYS = [
  "faq",
  "first-visit",
  "home-teaser",
  "admission",
] as const;

export type WebsiteFaqPageKey = (typeof WEBSITE_FAQ_PAGE_KEYS)[number];

export type PublicWebsiteFaq = {
  id: string;
  slug: string;
  pageKey: WebsiteFaqPageKey;
  category: string | null;
  question: string;
  answer: string;
  answerTemplate: string | null;
  sortOrder: number;
};

export type PublicWebsiteFaqsPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  resolveTokens: boolean;
  faqs: PublicWebsiteFaq[];
};

type WebsiteFaqRow = {
  id: string;
  business_id: string;
  slug: string;
  page_key: string;
  category: string | null;
  question: string;
  answer: string;
  sort_order: number;
  is_active: boolean;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePageKey(value: unknown): WebsiteFaqPageKey | null {
  const key = trimText(value).toLowerCase();
  return (WEBSITE_FAQ_PAGE_KEYS as readonly string[]).includes(key)
    ? key as WebsiteFaqPageKey
    : null;
}

function parsePageKeys(raw: unknown): WebsiteFaqPageKey[] {
  if (Array.isArray(raw)) {
    return raw.map(normalizePageKey).filter(Boolean) as WebsiteFaqPageKey[];
  }
  const text = trimText(raw);
  if (!text) return [];
  return text
    .split(",")
    .map((part) => normalizePageKey(part))
    .filter(Boolean) as WebsiteFaqPageKey[];
}

function mapFaqRow(
  row: WebsiteFaqRow,
  tokens: WebsiteCopyTokens | null,
  resolveTokens: boolean,
): PublicWebsiteFaq {
  const pageKey = normalizePageKey(row.page_key) ?? "faq";
  const question = trimText(row.question);
  const template = trimText(row.answer);
  let answer = template;
  let answerTemplate: string | null = null;

  if (resolveTokens && tokens) {
    const resolvedQuestion = applyWebsiteCopyTokens(question, tokens);
    const resolvedAnswer = applyWebsiteCopyTokens(template, tokens);
    answer = resolvedAnswer;
    if (resolvedAnswer !== template || resolvedQuestion !== question) {
      answerTemplate = template;
    }
    return {
      id: row.id,
      slug: trimText(row.slug),
      pageKey,
      category: trimText(row.category) || null,
      question: resolvedQuestion,
      answer,
      answerTemplate,
      sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    };
  }

  return {
    id: row.id,
    slug: trimText(row.slug),
    pageKey,
    category: trimText(row.category) || null,
    question,
    answer: template,
    answerTemplate: null,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
  };
}

export type LoadPublicWebsiteFaqsOptions = {
  pageKeys?: WebsiteFaqPageKey[];
  category?: string;
  activeOnly?: boolean;
  resolveTokens?: boolean;
  asOf?: Date;
  limit?: number;
};

export async function loadPublicWebsiteFaqs(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: LoadPublicWebsiteFaqsOptions = {},
): Promise<PublicWebsiteFaqsPayload> {
  const activeOnly = options.activeOnly !== false;
  const resolveTokens = options.resolveTokens !== false;
  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const pageKeys = options.pageKeys ?? [];
  const categoryFilter = trimText(options.category).toLowerCase();

  const [{ data: business }, query] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", businessId)
      .maybeSingle(),
    (() => {
      let q = supabase
        .from("business_website_faqs")
        .select("*")
        .eq("business_id", businessId)
        .order("page_key", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(200);
      if (activeOnly) q = q.eq("is_active", true);
      if (pageKeys.length === 1) q = q.eq("page_key", pageKeys[0]);
      else if (pageKeys.length > 1) q = q.in("page_key", pageKeys);
      return q;
    })(),
  ]);

  if (query.error) throw new Error(query.error.message);
  if (!business) throw new Error("Business not found");

  const tokens = resolveTokens
    ? await loadWebsiteCopyTokens(supabase, businessId)
    : null;

  const faqs: PublicWebsiteFaq[] = [];
  for (const raw of (query.data ?? []) as WebsiteFaqRow[]) {
    if (pageKeys.length > 1 && !pageKeys.includes(normalizePageKey(raw.page_key) ?? "faq")) {
      continue;
    }
    if (categoryFilter) {
      const rowCategory = trimText(raw.category).toLowerCase();
      if (rowCategory !== categoryFilter) continue;
    }
    faqs.push(mapFaqRow(raw, tokens, resolveTokens));
    if (faqs.length >= limit) break;
  }

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone: trimText(business.timezone) || "America/Toronto",
    asOf: asOfIso,
    resolveTokens,
    faqs,
  };
}

export { parsePageKeys, normalizePageKey };

/** Keyword-scored retrieval for Tavari AI Help domain knowledge (accounting, bookings, etc.). */

export type HelpKnowledgeEntry = {
  id: string;
  topics?: string[];
  keywords?: string[];
  content: string;
};

export type NavCatalogEntry = {
  id: string;
  label: string;
  navGroup?: string;
  module?: string;
  menuPath: string;
  path: string;
  keywords?: string[];
  description?: string;
  permissions?: string[];
  requiresModule?: string;
  hideForRoles?: string[];
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function scoreEntry(query: string, entry: { keywords?: string[]; topics?: string[]; content?: string; label?: string; description?: string; menuPath?: string }) {
  const q = query.toLowerCase();
  const qTokens = tokenize(q);
  let score = 0;

  for (const kw of entry.keywords || []) {
    const k = kw.toLowerCase();
    if (q.includes(k)) score += 8;
    else if (qTokens.some((t) => k.includes(t) || t.includes(k))) score += 3;
  }

  for (const topic of entry.topics || []) {
    const t = topic.toLowerCase();
    if (q.includes(t)) score += 4;
  }

  const haystack = [entry.content, entry.label, entry.description, entry.menuPath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const token of qTokens) {
    if (haystack.includes(token)) score += 1;
  }

  return score;
}

export function searchHelpKnowledge(
  query: string,
  entries: HelpKnowledgeEntry[],
  limit = 4,
): HelpKnowledgeEntry[] {
  if (!query?.trim()) return [];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(query, entry) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function searchNavigationCatalog(
  query: string,
  catalog: NavCatalogEntry[],
  visibleIds?: Set<string>,
  limit = 6,
): NavCatalogEntry[] {
  if (!query?.trim()) return [];
  const pool = visibleIds?.size
    ? catalog.filter((e) => visibleIds.has(e.id))
    : catalog;

  return pool
    .map((entry) => ({ entry, score: scoreEntry(query, entry) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function formatVisibleNavForPrompt(
  visibleNav: Array<{ label: string; children: Array<{ label: string; path: string; menuPath?: string }> }>,
): string {
  if (!visibleNav?.length) return "No navigation items are visible for this user.";
  return visibleNav
    .map((group) => {
      const lines = group.children.map((c) => `  - ${c.label}: ${c.menuPath || c.label} → ${c.path}`);
      return `${group.label}:\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export function formatFeatureSummaries(
  features: Array<{ label: string; menuPath: string; path: string; description?: string }>,
): string {
  if (!features?.length) return "";
  return features
    .slice(0, 40)
    .map((f) => `- ${f.label} (${f.path}): ${f.menuPath}. ${f.description || ""}`.trim())
    .join("\n");
}

export type ChatContextPayload = {
  module?: string;
  screen?: string;
  pathname?: string;
  businessId?: string | null;
  openBookingId?: string | null;
  enabledModules?: string[];
  visibleNav?: Array<{
    label: string;
    children: Array<{ id?: string; label: string; path: string; menuPath?: string }>;
  }>;
  visibleFeatures?: Array<{ id: string; label: string; path: string; menuPath: string; description?: string }>;
};

export type ExpenseCategoryContext = {
  name: string;
  gl_account_erpnext?: string | null;
  default_hst_treatment?: string | null;
};

export function formatExpenseCategoriesForPrompt(categories: ExpenseCategoryContext[]): string {
  if (!categories?.length) return "";
  return categories
    .map((c) => {
      const gl = c.gl_account_erpnext ? ` → GL: ${c.gl_account_erpnext}` : "";
      const hst = c.default_hst_treatment ? ` (default HST: ${c.default_hst_treatment})` : "";
      return `- ${c.name}${gl}${hst}`;
    })
    .join("\n");
}

export function buildAiChatSystemPrompt(opts: {
  context: ChatContextPayload;
  lastUserMessage: string;
  knowledgeChunks: HelpKnowledgeEntry[];
  matchedNav: NavCatalogEntry[];
  expenseCategories?: ExpenseCategoryContext[];
}): string {
  const { context, lastUserMessage, knowledgeChunks, matchedNav, expenseCategories = [] } = opts;
  const enabled = (context.enabledModules || []).join(", ") || "unknown";
  const currentPath = context.pathname || `/dashboard/${context.module || ""}/${context.screen || ""}`.replace(/\/+$/, "");
  const visibleNavText = formatVisibleNavForPrompt(context.visibleNav || []);
  const featureText = formatFeatureSummaries(context.visibleFeatures || []);
  const categoriesText = formatExpenseCategoriesForPrompt(expenseCategories);

  const knowledgeText = knowledgeChunks.length
    ? knowledgeChunks.map((k) => `[${k.id}] ${k.content}`).join("\n\n")
    : "";

  const matchedNavText = matchedNav.length
    ? matchedNav
        .map((n) => `- ${n.label}: ${n.menuPath} → ${n.path}. ${n.description || ""}`.trim())
        .join("\n")
    : "";

  return `You are Tavari AI Help, an assistant for staff using the Tavari dashboard (Canadian business management platform).

Your jobs:
1. Tell users WHERE to go in the app to complete tasks — use exact sidebar/menu paths from the navigation data below.
2. Answer how-to and domain questions (accounting, HST/GST, camp registration, etc.) using the knowledge snippets when relevant.
3. Only recommend pages listed under "Navigation this user can access". If a feature exists but is not listed, say they may need manager access or that the module is not enabled for this business.
4. When directing the user to a page, ALWAYS include a clickable markdown link on its own line: [Short label](exact/path) using paths from the navigation data (must start with /dashboard).
5. Give concise step-by-step directions (Sidebar → Module → item). Keep answers practical for front-line staff.
6. When the user asks how to classify/categorize an expense or invoice, pick ONE best category from "This business's expense categories" below (if provided). Lead with that pick, briefly say why, and mention what NOT to use if a nearby wrong bucket is tempting (e.g. COGS vs Professional Fees). Suggest the usual HST treatment. Do NOT dodge with "consult your accountant" for ordinary operating expenses — only mention an accountant for unusual tax/legal edge cases after giving your best practical pick.

Current screen: ${currentPath || "dashboard"}
Enabled modules for this business: ${enabled}

Navigation this user can access:
${visibleNavText}

${featureText ? `Visible feature details:\n${featureText}\n` : ""}
${matchedNavText ? `Features likely relevant to this question:\n${matchedNavText}\n` : ""}
${categoriesText ? `This business's expense categories (recommend ONLY from this list when classifying expenses):\n${categoriesText}\n` : ""}
${knowledgeText ? `Domain knowledge (use when relevant):\n${knowledgeText}\n` : ""}

Canadian tax reminder: Recoverable = ITC on expenses; Collected = tax charged to customers; Included = tax in price; Exempt = no HST applies.

User question: ${lastUserMessage}`;
}

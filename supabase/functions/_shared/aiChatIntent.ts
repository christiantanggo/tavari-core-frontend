/**
 * Detect requests to copy or list shareable staff/customer/kiosk links.
 */
import linksCatalog from "./aiStaffLinksCatalog.json" with { type: "json" };

export type StaffLinkCatalogEntry = {
  id: string;
  label: string;
  description: string;
  audience: string;
  category: string;
  keywords: string[];
  resolver: string;
  requiresBusinessId: boolean;
};

const LINK_CATALOG = (linksCatalog as { links: StaffLinkCatalogEntry[] }).links || [];

function normalizeText(text: string): string {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreLinkEntry(text: string, entry: StaffLinkCatalogEntry): number {
  let score = 0;
  for (const kw of entry.keywords || []) {
    const k = normalizeText(kw);
    if (!k) continue;
    if (text.includes(k)) score += k.split(" ").length + 1;
  }
  const label = normalizeText(entry.label);
  if (label && text.includes(label)) score += 4;
  return score;
}

function isLinkRelatedMessage(raw: string): boolean {
  return (
    /\b(link|url|bookmark|share|copy|send|paste|give me|what(?:'s| is) the)\b/i.test(raw) ||
    /\b(kiosk|portal)\s+link/i.test(raw) ||
    /\b(guest list|party guest|waiver kiosk|music kiosk|time clock|signage player)\b/i.test(raw) ||
    /\b(complete|finish|sign)\s+(a\s+)?waiver\b/i.test(raw) ||
    /\bwaiver\s+(link|url|to\s+complete|to\s+sign)\b/i.test(raw)
  );
}

/** Only true when the user wants multiple links, not "show me the guest list link". */
function detectListCategory(raw: string): string | null {
  const wantsSpecificLink =
    /\b(show|give|copy|send|get|what(?:'s| is))\s+(me\s+)?(the\s+)?[a-z]/i.test(raw) &&
    /\b(link|url)\b/i.test(raw) &&
    !/\b(all|every)\b/i.test(raw);

  if (wantsSpecificLink) return null;

  const wantsAllLinks =
    /\b(all|every)\s+(the\s+)?(links?|urls?)\b/i.test(raw) ||
    /\b(show|list|give)\s+(me\s+)?(all|every)\s+(the\s+)?(links?|urls?)/i.test(raw);

  const wantsCategoryLinks =
    /\b(show|list|give)\s+(me\s+)?(all\s+)?(kiosk|customer|staff)\s+links?\b/i.test(raw) ||
    /\b(all|every)\s+(kiosk|customer|staff)\s+links?\b/i.test(raw);

  if (!wantsAllLinks && !wantsCategoryLinks) return null;

  if (/\bkiosk\b/i.test(raw)) return "kiosk";
  if (/\bcustomer\b/i.test(raw)) return "customer";
  if (/\bstaff\b/i.test(raw)) return "staff";
  return wantsAllLinks ? "all" : null;
}

type ScoredEntry = { entry: StaffLinkCatalogEntry; score: number };

function rankLinkMatches(text: string): ScoredEntry[] {
  return LINK_CATALOG
    .map((entry) => ({ entry, score: scoreLinkEntry(text, entry) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

export type StaffLinkIntentResult =
  | { kind: "single"; linkId: string }
  | { kind: "list"; listCategory: string }
  | { kind: "disambiguate"; linkIds: string[] };

export function extractStaffLinkIntent(message: string): StaffLinkIntentResult | null {
  const raw = String(message || "").trim();
  if (!raw) return null;

  const text = normalizeText(raw);
  if (!isLinkRelatedMessage(raw)) return null;

  const ranked = rankLinkMatches(text);
  const top = ranked[0];
  const second = ranked[1];
  const listCategory = detectListCategory(raw);

  const hasStrongSingle =
    top &&
    top.score >= 3 &&
    (!second || top.score > second.score);

  if (hasStrongSingle) {
    return { kind: "single", linkId: top.entry.id };
  }

  if (top && top.score >= 2) {
    const closeMatches = ranked.filter(
      (row) => row.score >= 2 && top.score - row.score <= 1,
    );

    if (closeMatches.length > 1) {
      return {
        kind: "disambiguate",
        linkIds: closeMatches.slice(0, 6).map((row) => row.entry.id),
      };
    }

    return { kind: "single", linkId: top.entry.id };
  }

  if (listCategory) {
    return { kind: "list", listCategory };
  }

  if (ranked.length > 0) {
    return {
      kind: "disambiguate",
      linkIds: ranked.slice(0, 6).map((row) => row.entry.id),
    };
  }

  if (/\b(link|url)\b/i.test(raw)) {
    return { kind: "disambiguate", linkIds: [] };
  }

  return null;
}

export type OpenBookingGuestListIntent = {
  bookingId?: string;
  searchTerm?: string;
  bookingDate?: string;
};

export function extractOpenBookingGuestListIntent(
  message: string,
  openBookingId?: string | null,
): OpenBookingGuestListIntent | null {
  const raw = String(message || "").trim();
  if (!raw || !/\bguest list\b/i.test(raw)) return null;

  const isLinkRequest =
    /\b(link|url|bookmark|copy|send|share|paste)\b/i.test(raw) &&
    !/\b(open|go to|take me)\b/i.test(raw);

  if (isLinkRequest) return null;

  const isStaffListPage =
    /\bparty guest lists\b/i.test(raw) ||
    (/\ball guest lists\b/i.test(raw) && !/\bhost\b/i.test(raw));

  if (isStaffListPage) return null;

  const wantsTab =
    /\b(open|go to|show|view|take me|pull up|bring up)\b/i.test(raw) ||
    /\btab\b/i.test(raw) ||
    /\bthis (party|booking)\b/i.test(raw) ||
    /\bcurrent booking\b/i.test(raw);

  if (!wantsTab && !openBookingId) return null;

  if (
    openBookingId &&
    (/\bthis (party|booking)\b/i.test(raw) ||
      /\bcurrent booking\b/i.test(raw) ||
      (wantsTab && !/\bfor\b/i.test(raw)))
  ) {
    return { bookingId: openBookingId };
  }

  const bookingNumMatch = raw.match(/(?:booking\s*)?#?(\d{4,})/i);
  if (bookingNumMatch?.[1]) {
    return { searchTerm: bookingNumMatch[1] };
  }

  const isoDate = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoDate?.[1]) {
    return { bookingDate: isoDate[1] };
  }

  const monthDay = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?/i,
  );
  if (monthDay) {
    const months: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
      may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
      september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    const key = monthDay[1].toLowerCase();
    const month = months[key];
    const day = Number(monthDay[2]);
    const year = monthDay[3] ? Number(monthDay[3]) : new Date().getFullYear();
    if (month && day) {
      const bookingDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { bookingDate };
    }
  }

  const forMatch = raw.match(/\bguest list for\s+(.+?)(?:[?.!,]|$)/i);
  if (forMatch?.[1]) {
    const term = forMatch[1].trim();
    if (term) return { searchTerm: term };
  }

  if (openBookingId && wantsTab) {
    return { bookingId: openBookingId };
  }

  if (wantsTab) {
    return { searchTerm: "" };
  }

  return null;
}

export function extractCamperPrintIntent(message: string): { searchName: string } | null {
  const text = String(message || "").trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const printLike =
    /\b(print|reprint|open|show|view|pull up|bring up|display|get)\b/i.test(text);
  const registrationLike =
    /\b(camp|camper)\b.*\b(registration|medical|form)\b/i.test(lower) ||
    /\b(registration|medical)\s+form\b/i.test(lower) ||
    /\bcamper\s+registration\b/i.test(lower);

  if (!printLike && !registrationLike) {
    if (!/\bprint\b/i.test(text) && !/\bregistration\b/i.test(text)) return null;
    if (!registrationLike && !/\bfor\s+[a-z]/i.test(text)) return null;
  }

  if (!registrationLike && printLike) {
    const hasCampContext = /\b(camp|camper)\b/i.test(text);
    if (!hasCampContext) return null;
  }

  const forMatch = text.match(/\bfor\s+([A-Za-z][A-Za-z'’\-\s]{1,60}?)(?:['']s)?(?:\s+camp|\s+registration|\s+form|[?.!,]|$)/i);
  if (forMatch?.[1]) {
    return { searchName: cleanExtractedName(forMatch[1]) };
  }

  const printMatch = text.match(
    /(?:print|open|show|view|pull up|bring up|display|get)\s+(?:the\s+)?(?:camp\s+)?(?:registration|camper)\s+(?:form\s+)?(?:for\s+)?([A-Za-z][A-Za-z'’\-\s]{1,60})/i,
  );
  if (printMatch?.[1]) {
    return { searchName: cleanExtractedName(printMatch[1]) };
  }

  return null;
}

function cleanExtractedName(raw: string): string {
  return raw
    .replace(/\s+(camp|registration|medical|form)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type AiChatAction =
  | { type: "resolve_camper_registration_print"; searchName: string }
  | { type: "print_camper_registration"; documentId: string; camperName?: string }
  | { type: "open_registration_forms_search"; searchQuery: string }
  | { type: "resolve_staff_link"; linkId: string }
  | { type: "list_staff_links"; category: string }
  | { type: "disambiguate_staff_links"; linkIds: string[] }
  | { type: "open_booking_guest_list"; bookingId?: string; searchTerm?: string; bookingDate?: string };

export type AiChatIntentContext = {
  openBookingId?: string | null;
};

export function buildActionsFromMessage(message: string, context: AiChatIntentContext = {}): AiChatAction[] {
  const printIntent = extractCamperPrintIntent(message);
  if (printIntent?.searchName) {
    return [{ type: "resolve_camper_registration_print", searchName: printIntent.searchName }];
  }

  const openGuestList = extractOpenBookingGuestListIntent(message, context.openBookingId);
  if (openGuestList) {
    return [{ type: "open_booking_guest_list", ...openGuestList }];
  }

  const linkIntent = extractStaffLinkIntent(message);
  if (!linkIntent) return [];

  if (linkIntent.kind === "single") {
    return [{ type: "resolve_staff_link", linkId: linkIntent.linkId }];
  }
  if (linkIntent.kind === "list") {
    return [{ type: "list_staff_links", category: linkIntent.listCategory }];
  }
  return [{ type: "disambiguate_staff_links", linkIds: linkIntent.linkIds }];
}

export function staffLinkLabel(linkId: string): string {
  const entry = LINK_CATALOG.find((l) => l.id === linkId);
  return entry?.label || linkId;
}

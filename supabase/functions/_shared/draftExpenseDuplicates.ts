import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export type DraftDuplicateRow = {
  id: string;
  vendor_id: string | null;
  vendor_name_display: string | null;
  invoice_number: string | null;
  total_amount: number | null;
  status: string;
  created_at: string;
  document_type?: string | null;
  is_duplicate?: boolean;
};

export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/^0+(?=\d)/, "")
    .toLowerCase();
}

export function normalizeVendorKey(
  vendorId: string | null | undefined,
  vendorName: string | null | undefined,
): string {
  if (vendorId) return `id:${vendorId}`;
  return `name:${String(vendorName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")}`;
}

function statusRank(status: string): number {
  if (status === "posted") return 3;
  if (status === "approved") return 2;
  if (status === "draft") return 1;
  return 0;
}

/** Pick the canonical (original) row among matches — posted beats draft, then earliest created. */
export function pickOriginalDraft(
  matches: DraftDuplicateRow[],
  excludeId?: string,
): DraftDuplicateRow | null {
  const rows = matches.filter((m) => m.id !== excludeId && normalizeInvoiceNumber(m.invoice_number));
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const sr = statusRank(b.status) - statusRank(a.status);
    if (sr !== 0) return sr;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  return rows[0] ?? null;
}

export function vendorsMatch(
  a: { vendor_id?: string | null; vendor_name_display?: string | null },
  b: { vendor_id?: string | null; vendor_name_display?: string | null },
): boolean {
  if (a.vendor_id && b.vendor_id) return a.vendor_id === b.vendor_id;
  const ka = normalizeVendorKey(a.vendor_id, a.vendor_name_display);
  const kb = normalizeVendorKey(b.vendor_id, b.vendor_name_display);
  if (ka.startsWith("id:") || kb.startsWith("id:")) return ka === kb;
  if (!ka.slice(5) || !kb.slice(5)) return false;
  return ka === kb || ka.slice(5).includes(kb.slice(5)) || kb.slice(5).includes(ka.slice(5));
}

export function findDuplicateAmong(
  target: DraftDuplicateRow,
  candidates: DraftDuplicateRow[],
): DraftDuplicateRow | null {
  const inv = normalizeInvoiceNumber(target.invoice_number);
  if (!inv) return null;

  const matches = candidates.filter((c) => {
    if (c.id === target.id) return false;
    if (normalizeInvoiceNumber(c.invoice_number) !== inv) return false;
    if (!vendorsMatch(target, c)) return false;
    const targetDoc = target.document_type === "credit_memo" ? "credit_memo" : "invoice";
    const candidateDoc = c.document_type === "credit_memo" ? "credit_memo" : "invoice";
    return targetDoc === candidateDoc;
  });

  return pickOriginalDraft(matches, target.id);
}

export async function syncDuplicateFlagsForDraft(
  supabase: SupabaseClient,
  businessId: string,
  draftId: string,
): Promise<{ is_duplicate: boolean; duplicate_of_draft_id: string | null }> {
  const { data: target, error: targetErr } = await supabase
    .from("accounting_draft_expenses")
    .select("id, vendor_id, vendor_name_display, invoice_number, total_amount, status, created_at, is_duplicate, duplicate_of_draft_id, document_type")
    .eq("id", draftId)
    .eq("business_id", businessId)
    .single();

  if (targetErr || !target) {
    return { is_duplicate: false, duplicate_of_draft_id: null };
  }

  const inv = normalizeInvoiceNumber(target.invoice_number);
  if (!inv) {
    if (target.is_duplicate || target.duplicate_of_draft_id) {
      await supabase
        .from("accounting_draft_expenses")
        .update({ is_duplicate: false, duplicate_of_draft_id: null })
        .eq("id", draftId);
    }
    return { is_duplicate: false, duplicate_of_draft_id: null };
  }

  const { data: broaderRaw } = await supabase
    .from("accounting_draft_expenses")
    .select("id, vendor_id, vendor_name_display, invoice_number, total_amount, status, created_at, document_type")
    .eq("business_id", businessId)
    .in("status", ["draft", "posted", "approved", "posting"])
    .not("invoice_number", "is", null)
    .neq("id", draftId);

  const broader = (broaderRaw || []) as DraftDuplicateRow[];
  const original = findDuplicateAmong(target as DraftDuplicateRow, broader);
  const isDuplicate = !!original && original.id !== target.id;

  const duplicateOfId = isDuplicate ? original!.id : null;
  if (target.is_duplicate !== isDuplicate || target.duplicate_of_draft_id !== duplicateOfId) {
    await supabase
      .from("accounting_draft_expenses")
      .update({ is_duplicate: isDuplicate, duplicate_of_draft_id: duplicateOfId })
      .eq("id", draftId);
  }

  return { is_duplicate: isDuplicate, duplicate_of_draft_id: duplicateOfId };
}

export async function syncDuplicateFlagsForBusiness(
  supabase: SupabaseClient,
  businessId: string,
): Promise<number> {
  const { data: rows } = await supabase
    .from("accounting_draft_expenses")
    .select("id")
    .eq("business_id", businessId)
    .eq("status", "draft")
    .not("invoice_number", "is", null);

  let count = 0;
  for (const row of rows || []) {
    await syncDuplicateFlagsForDraft(supabase, businessId, row.id as string);
    count++;
  }
  return count;
}

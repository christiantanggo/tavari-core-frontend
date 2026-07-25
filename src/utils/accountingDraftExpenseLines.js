const round2 = (n) => (n != null && !Number.isNaN(n) ? Math.round(Number(n) * 100) / 100 : 0);

export async function loadDraftExpenseLines(supabaseClient, draftId) {
  if (!draftId) return [];
  const { data, error } = await supabaseClient
    .from('accounting_draft_expense_lines')
    .select('*')
    .eq('draft_expense_id', draftId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function replaceDraftExpenseLines(supabaseClient, businessId, draftId, lines) {
  if (!draftId || !businessId) return;
  await supabaseClient.from('accounting_draft_expense_lines').delete().eq('draft_expense_id', draftId);
  const rows = (lines || [])
    .map((line, index) => ({
      draft_expense_id: draftId,
      business_id: businessId,
      description: line.description?.trim() || null,
      amount: round2(line.amount),
      tax_amount: round2(line.tax_amount),
      expense_category_id: line.expense_category_id || null,
      gl_account_erpnext: line.gl_account_erpnext?.trim() || null,
      sort_order: index
    }))
    .filter((line) => line.amount !== 0 || line.tax_amount !== 0);
  if (rows.length === 0) return;
  const { error } = await supabaseClient.from('accounting_draft_expense_lines').insert(rows);
  if (error) throw error;
}

export function summarizeLineItems(lines) {
  const subtotal = round2((lines || []).reduce((s, l) => s + Math.abs(Number(l.amount) || 0), 0));
  const tax = round2((lines || []).reduce((s, l) => s + Math.abs(Number(l.tax_amount) || 0), 0));
  const total = round2(subtotal + tax);
  return { subtotal: total < 0 ? -subtotal : subtotal, tax_amount: total < 0 ? -tax : tax, total_amount: total < 0 ? -total : total };
}

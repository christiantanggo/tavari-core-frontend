import { supabase } from '../../supabaseClient';
import { normalizeCode } from '../GiftCards/GiftCardService';

async function generateDealCode(businessId, prefix = 'DL') {
  for (let i = 0; i < 8; i += 1) {
    const { data: generated } = await supabase.rpc('gift_cards_generate_code', { p_prefix: prefix });
    const code = generated || `${prefix}${Date.now().toString(36).toUpperCase()}`;
    const codeNormalized = normalizeCode(code);
    const { data: existing } = await supabase
      .from('deal_vouchers')
      .select('id')
      .eq('business_id', businessId)
      .eq('code_normalized', codeNormalized)
      .maybeSingle();
    if (!existing) return { code, codeNormalized };
  }
  throw new Error('Could not generate a unique deal code');
}

export async function bootstrapDeals(businessId) {
  const { error } = await supabase.rpc('deals_bootstrap_business', { p_business_id: businessId });
  if (error) throw error;
  return true;
}

export async function getDealSettings(businessId) {
  const { data, error } = await supabase
    .from('deal_settings')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveDealSettings(businessId, patch) {
  const { data, error } = await supabase
    .from('deal_settings')
    .upsert({ business_id: businessId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'business_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listDeals(businessId, { status = null } = {}) {
  let q = supabase
    .from('deals')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listPublicDeals(businessId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('business_id', businessId)
    .eq('show_on_deals_page', true)
    .in('status', ['active', 'scheduled'])
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter((d) => {
    if (d.starts_at && d.starts_at > now) return d.status === 'scheduled' || d.status === 'active';
    if (d.ends_at && d.ends_at < now) return false;
    return true;
  });
}

export async function upsertDeal(businessId, deal) {
  const payload = {
    ...deal,
    business_id: businessId,
    code_normalized: deal.code ? normalizeCode(deal.code) : null,
    updated_at: new Date().toISOString(),
  };
  if (!payload.id) delete payload.id;
  const { data, error } = await supabase.from('deals').upsert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function printDealVouchers({
  businessId,
  dealId,
  quantity = 1,
  expiresAt = null,
  processedByUserId = null,
}) {
  const qty = Math.max(1, Math.min(500, Number(quantity) || 1));
  const rows = [];
  for (let i = 0; i < qty; i += 1) {
    const { code, codeNormalized } = await generateDealCode(businessId, 'CP');
    rows.push({
      business_id: businessId,
      deal_id: dealId,
      code,
      code_normalized: codeNormalized,
      qr_payload: `tavari-deal:${businessId}:${codeNormalized}`,
      status: 'active',
      expires_at: expiresAt,
      created_by: processedByUserId,
    });
  }
  const { data, error } = await supabase.from('deal_vouchers').insert(rows).select('*');
  if (error) throw error;
  return data || [];
}

export async function lookupDealVoucher(businessId, codeOrPayload) {
  const normalized = normalizeCode(codeOrPayload);
  const { data, error } = await supabase
    .from('deal_vouchers')
    .select('*, deals(*)')
    .eq('business_id', businessId)
    .eq('code_normalized', normalized)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (['voided', 'replaced', 'expired', 'redeemed'].includes(data.status)) {
    throw new Error(data.invalid_reason || `This voucher is ${data.status}.`);
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    await supabase
      .from('deal_vouchers')
      .update({
        status: 'expired',
        invalid_reason: 'This coupon/voucher has expired.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id);
    throw new Error('This coupon/voucher has expired.');
  }
  return data;
}

export async function redeemDealVoucher({
  businessId,
  codeOrPayload,
  customerId = null,
  saleId = null,
  bookingId = null,
  discountAmount = 0,
  processedByUserId = null,
}) {
  const voucher = await lookupDealVoucher(businessId, codeOrPayload);
  if (!voucher) throw new Error('Voucher not found');

  const { data: updated, error } = await supabase
    .from('deal_vouchers')
    .update({
      status: 'redeemed',
      redeemed_at: new Date().toISOString(),
      redeemed_sale_id: saleId,
      customer_id: customerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', voucher.id)
    .select('*')
    .single();
  if (error) throw error;

  await supabase.from('deal_redemptions').insert({
    business_id: businessId,
    deal_id: voucher.deal_id,
    voucher_id: voucher.id,
    customer_id: customerId,
    sale_id: saleId,
    booking_id: bookingId,
    discount_amount: Number(discountAmount) || 0,
    processed_by: processedByUserId,
  });

  await supabase
    .from('deals')
    .update({
      redemption_count: (voucher.deals?.redemption_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', voucher.deal_id);

  return updated;
}

export async function getDealsDashboardStats(businessId) {
  const { data: deals, error } = await supabase
    .from('deals')
    .select('id, status, redemption_count, deal_type')
    .eq('business_id', businessId);
  if (error) throw error;
  const list = deals || [];
  return {
    totalDeals: list.length,
    activeDeals: list.filter((d) => d.status === 'active').length,
    redemptions: list.reduce((sum, d) => sum + (Number(d.redemption_count) || 0), 0),
  };
}

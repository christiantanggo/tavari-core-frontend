import { supabase } from '../../supabaseClient';

function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

async function generateUniqueCode(businessId, prefix = 'GC') {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: generated, error: genErr } = await supabase.rpc('gift_cards_generate_code', {
      p_prefix: prefix,
    });
    if (genErr) throw genErr;
    const code = generated || `${prefix}${Date.now().toString(36).toUpperCase()}`;
    const codeNormalized = normalizeCode(code);
    const { data: existing } = await supabase
      .from('gift_cards')
      .select('id')
      .eq('business_id', businessId)
      .eq('code_normalized', codeNormalized)
      .maybeSingle();
    if (!existing) return { code, codeNormalized };
  }
  throw new Error('Could not generate a unique gift card code');
}

export async function bootstrapGiftCards(businessId) {
  if (!businessId) throw new Error('Business ID is required');
  const { error } = await supabase.rpc('gift_cards_bootstrap_business', {
    p_business_id: businessId,
  });
  if (error) throw error;
  try {
    await syncAllGiftCardProductsToPos(businessId);
  } catch (syncErr) {
    console.warn('Gift card POS product sync failed:', syncErr?.message || syncErr);
  }
  return true;
}

export async function ensurePosGiftCardsCategory(businessId) {
  if (!businessId) throw new Error('Business ID is required');
  const { data, error } = await supabase.rpc('gift_cards_ensure_pos_category', {
    p_business_id: businessId,
  });
  if (error) throw error;
  return data;
}

export async function getSettings(businessId) {
  const { data, error } = await supabase
    .from('gift_card_settings')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveSettings(businessId, patch) {
  const { data, error } = await supabase
    .from('gift_card_settings')
    .upsert(
      {
        business_id: businessId,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id' }
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listProducts(businessId, { activeOnly = false } = {}) {
  let q = supabase
    .from('gift_card_products')
    .select('*')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function upsertProduct(businessId, product) {
  const payload = {
    ...product,
    business_id: businessId,
    updated_at: new Date().toISOString(),
  };
  if (!payload.id) delete payload.id;
  const { data, error } = await supabase
    .from('gift_card_products')
    .upsert(payload)
    .select('*')
    .single();
  if (error) throw error;
  try {
    await syncGiftCardProductToPos(businessId, data);
  } catch (syncErr) {
    console.warn('Gift card POS sync failed:', syncErr?.message || syncErr);
  }
  return data;
}

/**
 * Ensure each active gift_card_products row has exactly one matching pos_inventory item
 * in the Gift Cards category (for register sell). Idempotent.
 */
export async function syncGiftCardProductToPos(businessId, product) {
  if (!businessId || !product?.id) return null;
  const categoryId = await ensurePosGiftCardsCategory(businessId);
  const salePrice = money(product.sale_price ?? product.face_value ?? 0);
  const isActive = product.is_active !== false;

  const inventoryPayload = {
    business_id: businessId,
    name: product.name,
    price: salePrice,
    cost: 0,
    sku: `GC-${String(product.id).slice(0, 8).toUpperCase()}`,
    category_id: categoryId,
    track_stock: false,
    description: product.description || null,
    display_on_pos: isActive,
    is_active: isActive,
    is_gift_card: true,
    gift_card_product_id: product.id,
    tax_exempt: true,
    allow_price_override: product.product_type === 'money' && !product.face_value,
    updated_at: new Date().toISOString(),
  };

  // Prefer linked id, then any existing rows for this gift_card_product_id
  let keeperId = product.pos_product_id || null;

  const { data: existingRows, error: existingErr } = await supabase
    .from('pos_inventory')
    .select('id, created_at')
    .eq('business_id', businessId)
    .eq('gift_card_product_id', product.id)
    .order('created_at', { ascending: true });
  if (existingErr) throw existingErr;

  const rows = existingRows || [];
  if (!keeperId && rows[0]?.id) keeperId = rows[0].id;
  if (keeperId && rows.length && !rows.some((r) => r.id === keeperId)) {
    keeperId = rows[0].id;
  }

  // Deactivate duplicate inventory rows for this gift card product
  const duplicateIds = rows.filter((r) => r.id !== keeperId).map((r) => r.id);
  if (duplicateIds.length > 0) {
    await supabase
      .from('pos_inventory')
      .update({
        is_active: false,
        display_on_pos: false,
        updated_at: new Date().toISOString(),
      })
      .in('id', duplicateIds);
  }

  if (keeperId) {
    const { data: updated, error } = await supabase
      .from('pos_inventory')
      .update(inventoryPayload)
      .eq('id', keeperId)
      .eq('business_id', businessId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (updated?.id) {
      if (product.pos_product_id !== updated.id) {
        await supabase
          .from('gift_card_products')
          .update({ pos_product_id: updated.id, updated_at: new Date().toISOString() })
          .eq('id', product.id);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tavari:pos-inventory-updated', { detail: { businessId } }));
      }
      return updated.id;
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('pos_inventory')
    .insert([{ ...inventoryPayload, created_at: new Date().toISOString() }])
    .select('id')
    .single();

  // Race / unique violation: another sync created the row — reuse it
  if (insErr) {
    const { data: raced } = await supabase
      .from('pos_inventory')
      .select('id')
      .eq('business_id', businessId)
      .eq('gift_card_product_id', product.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (raced?.id) {
      await supabase
        .from('pos_inventory')
        .update(inventoryPayload)
        .eq('id', raced.id);
      await supabase
        .from('gift_card_products')
        .update({ pos_product_id: raced.id, updated_at: new Date().toISOString() })
        .eq('id', product.id);
      return raced.id;
    }
    throw insErr;
  }

  await supabase
    .from('gift_card_products')
    .update({ pos_product_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('id', product.id);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tavari:pos-inventory-updated', { detail: { businessId } }));
  }
  return inserted.id;
}

export async function syncAllGiftCardProductsToPos(businessId) {
  await ensurePosGiftCardsCategory(businessId);
  const products = await listProducts(businessId);
  const ids = [];
  for (const product of products) {
    // eslint-disable-next-line no-await-in-loop
    const id = await syncGiftCardProductToPos(businessId, product);
    if (id) ids.push(id);
  }
  return ids;
}

export async function listDesigns(businessId) {
  const { data, error } = await supabase
    .from('gift_card_designs')
    .select('*')
    .eq('business_id', businessId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function upsertDesign(businessId, design) {
  const payload = {
    ...design,
    business_id: businessId,
    updated_at: new Date().toISOString(),
  };
  if (!payload.id) delete payload.id;
  const { data, error } = await supabase
    .from('gift_card_designs')
    .upsert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function getDashboardStats(businessId) {
  const [{ data: cards, error: cardsErr }, { data: txs, error: txsErr }] = await Promise.all([
    supabase
      .from('gift_cards')
      .select('id, status, balance_remaining, face_value, amount_paid, created_at')
      .eq('business_id', businessId),
    supabase
      .from('gift_card_transactions')
      .select('id, transaction_type, amount, created_at')
      .eq('business_id', businessId)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (cardsErr) throw cardsErr;
  if (txsErr) throw txsErr;

  const list = cards || [];
  const outstanding = list
    .filter((c) => ['active', 'partially_redeemed'].includes(c.status))
    .reduce((sum, c) => sum + money(c.balance_remaining), 0);
  const activeCount = list.filter((c) => ['active', 'partially_redeemed'].includes(c.status)).length;
  const issued30 = (txs || []).filter((t) => t.transaction_type === 'issue').length;
  const redeemed30 = (txs || [])
    .filter((t) => ['redeem', 'gift_credit_spend'].includes(t.transaction_type))
    .reduce((sum, t) => sum + Math.abs(money(t.amount)), 0);

  return {
    outstandingLiability: outstanding,
    activeCards: activeCount,
    issuedLast30Days: issued30,
    redeemedLast30Days: redeemed30,
    totalCards: list.length,
  };
}

export async function listCards(businessId, { search = '', status = null, limit = 100 } = {}) {
  let q = supabase
    .from('gift_cards')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  let rows = data || [];
  const needle = normalizeCode(search) || String(search || '').trim().toLowerCase();
  if (needle) {
    rows = rows.filter((row) => {
      const hay = [
        row.code,
        row.code_normalized,
        row.purchaser_name,
        row.purchaser_email,
        row.recipient_name,
        row.recipient_email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(String(search).trim().toLowerCase()) || row.code_normalized?.includes(needle);
    });
  }
  return rows;
}

export async function lookupCard(businessId, codeOrPayload) {
  const normalized = normalizeCode(codeOrPayload);
  const raw = String(codeOrPayload || '').trim();
  let q = supabase.from('gift_cards').select('*').eq('business_id', businessId);
  if (normalized) {
    q = q.eq('code_normalized', normalized);
  } else {
    q = q.eq('qr_payload', raw);
  }
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) {
    // Partner-accepted cards: look up by code globally then verify link
    const { data: anyCard, error: anyErr } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('code_normalized', normalized)
      .maybeSingle();
    if (anyErr) throw anyErr;
    if (!anyCard) return null;
    if (anyCard.business_id === businessId) return anyCard;
    const allowed = await canRedeemAtBusiness(anyCard.issuing_business_id || anyCard.business_id, businessId);
    if (!allowed) {
      throw new Error('This gift card cannot be redeemed at this business.');
    }
    return anyCard;
  }
  return data;
}

export async function canRedeemAtBusiness(issuerBusinessId, redeemerBusinessId) {
  if (!issuerBusinessId || !redeemerBusinessId) return false;
  if (issuerBusinessId === redeemerBusinessId) return true;
  const { data, error } = await supabase
    .from('gift_card_business_links')
    .select('id, status')
    .eq('issuer_business_id', issuerBusinessId)
    .eq('partner_business_id', redeemerBusinessId)
    .eq('status', 'approved')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

/**
 * Issue a gift card (money or item). Purchaser is primary owner; recipient optional.
 */
export async function issueGiftCard({
  businessId,
  productId = null,
  cardType = 'money',
  faceValue,
  amountPaid,
  inventoryItemId = null,
  inventoryQty = 0,
  purchaserCustomerId = null,
  recipientCustomerId = null,
  purchaserName = null,
  purchaserEmail = null,
  purchaserPhone = null,
  recipientName = null,
  recipientEmail = null,
  recipientPhone = null,
  notifyRecipient = false,
  isCharitable = false,
  expiresAt = null,
  saleSource = 'staff',
  saleSaleId = null,
  saleBookingId = null,
  designId = null,
  notes = null,
  personalMessage = null,
  processedByUserId = null,
}) {
  if (!businessId) throw new Error('Business ID is required');
  const face = money(faceValue);
  const paid = money(amountPaid ?? faceValue);
  if (cardType === 'money' && face <= 0) throw new Error('Face value must be greater than zero');

  const { code, codeNormalized } = await generateUniqueCode(businessId, cardType === 'item' ? 'IT' : 'GC');
  const qrPayload = `tavari-gc:${businessId}:${codeNormalized}`;

  const row = {
    business_id: businessId,
    issuing_business_id: businessId,
    product_id: productId,
    design_id: designId,
    card_type: cardType,
    code,
    code_normalized: codeNormalized,
    qr_payload: qrPayload,
    status: 'active',
    face_value: face,
    amount_paid: paid,
    balance_remaining: cardType === 'money' ? face : 0,
    inventory_item_id: inventoryItemId,
    inventory_qty_remaining: cardType === 'item' ? Number(inventoryQty) || 1 : 0,
    purchaser_customer_id: purchaserCustomerId,
    recipient_customer_id: recipientCustomerId || null,
    purchaser_name: purchaserName,
    purchaser_email: purchaserEmail,
    purchaser_phone: purchaserPhone,
    recipient_name: recipientName,
    recipient_email: recipientEmail,
    recipient_phone: recipientPhone,
    notify_recipient: Boolean(notifyRecipient),
    is_charitable: Boolean(isCharitable),
    expires_at: expiresAt,
    sale_source: saleSource,
    sale_sale_id: saleSaleId,
    sale_booking_id: saleBookingId,
    notes,
    personal_message: personalMessage ? String(personalMessage).trim() : null,
    created_by: processedByUserId,
  };

  const { data: card, error } = await supabase.from('gift_cards').insert(row).select('*').single();
  if (error) throw error;

  const { error: txErr } = await supabase.from('gift_card_transactions').insert({
    business_id: businessId,
    gift_card_id: card.id,
    customer_id: purchaserCustomerId,
    transaction_type: 'issue',
    amount: face,
    balance_before: 0,
    balance_after: card.balance_remaining,
    inventory_qty_before: 0,
    inventory_qty_after: card.inventory_qty_remaining,
    processed_by: processedByUserId,
    reason: 'Gift card issued',
    metadata: { amount_paid: paid, sale_source: saleSource },
  });
  if (txErr) throw txErr;

  return card;
}

/**
 * First redeem attaches residual money balance to redeemer's gift_card_credit.
 * Partial sale: apply up to balance/credit, caller collects remaining tender.
 */
export async function redeemGiftCard({
  businessId,
  codeOrPayload,
  amountDollars,
  redeemerCustomerId = null,
  saleId = null,
  bookingId = null,
  processedByUserId = null,
  applyBurnBonus = null,
}) {
  const card = await lookupCard(businessId, codeOrPayload);
  if (!card) throw new Error('Gift card not found');

  if (['voided', 'replaced', 'expired', 'redeemed'].includes(card.status)) {
    const why = card.invalid_reason || `This gift card is ${card.status}.`;
    throw new Error(why);
  }
  if (card.expires_at && new Date(card.expires_at) < new Date()) {
    await supabase
      .from('gift_cards')
      .update({ status: 'expired', invalid_reason: 'This gift card has expired.', updated_at: new Date().toISOString() })
      .eq('id', card.id);
    throw new Error('This gift card has expired.');
  }

  const issuerId = card.issuing_business_id || card.business_id;
  const crossBusiness = issuerId !== businessId;

  if (card.card_type === 'item') {
    if ((card.inventory_qty_remaining || 0) <= 0) {
      throw new Error('This item voucher has already been fully redeemed.');
    }
    const qtyBefore = Number(card.inventory_qty_remaining) || 0;
    const qtyAfter = qtyBefore - 1;
    const { data: updated, error } = await supabase
      .from('gift_cards')
      .update({
        inventory_qty_remaining: qtyAfter,
        status: qtyAfter <= 0 ? 'redeemed' : 'partially_redeemed',
        redeemer_customer_id: redeemerCustomerId || card.redeemer_customer_id,
        first_redeemed_at: card.first_redeemed_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', card.id)
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('gift_card_transactions').insert({
      business_id: issuerId,
      gift_card_id: card.id,
      customer_id: redeemerCustomerId,
      transaction_type: 'redeem',
      amount: 0,
      inventory_qty_before: qtyBefore,
      inventory_qty_after: qtyAfter,
      redeeming_business_id: businessId,
      sale_id: saleId,
      booking_id: bookingId,
      processed_by: processedByUserId,
      reason: 'Item voucher redeemed',
    });

    return { card: updated, appliedAmount: 0, remainingDue: money(amountDollars), attachedCredit: 0 };
  }

  const requested = money(amountDollars);
  if (requested <= 0) throw new Error('Enter a redeem amount greater than zero');

  const before = money(card.balance_remaining);
  const applied = Math.min(before, requested);
  const after = money(before - applied);
  let attachedCredit = 0;

  // Attach residual to redeemer account on first use (Bookeo-style)
  if (redeemerCustomerId && after > 0 && !card.first_redeemed_at) {
    attachedCredit = after;
    await applyGiftCardCredit({
      businessId: issuerId,
      accountId: redeemerCustomerId,
      amountDollars: after,
      isReversal: false,
      note: `Residual from gift card ${card.code}`,
      processedByUserId,
      giftCardId: card.id,
      transactionType: 'attach_residual',
    });
  }

  const newStatus = attachedCredit > 0 || after <= 0 ? 'redeemed' : after < before ? 'partially_redeemed' : card.status;
  const balanceAfterCard = attachedCredit > 0 ? 0 : after;

  const { data: updated, error } = await supabase
    .from('gift_cards')
    .update({
      balance_remaining: balanceAfterCard,
      status: balanceAfterCard <= 0 ? 'redeemed' : newStatus,
      redeemer_customer_id: redeemerCustomerId || card.redeemer_customer_id,
      first_redeemed_at: card.first_redeemed_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', card.id)
    .select('*')
    .single();
  if (error) throw error;

  const { data: txRow, error: txErr } = await supabase
    .from('gift_card_transactions')
    .insert({
      business_id: issuerId,
      gift_card_id: card.id,
      customer_id: redeemerCustomerId,
      transaction_type: 'redeem',
      amount: -applied,
      balance_before: before,
      balance_after: balanceAfterCard,
      redeeming_business_id: businessId,
      sale_id: saleId,
      booking_id: bookingId,
      processed_by: processedByUserId,
      reason: 'Gift card redeemed',
      metadata: { attached_credit: attachedCredit, requested },
    })
    .select('id')
    .single();
  if (txErr) throw txErr;

  if (crossBusiness && applied > 0) {
    const { data: link } = await supabase
      .from('gift_card_business_links')
      .select('settlement_fee_percent')
      .eq('issuer_business_id', issuerId)
      .eq('partner_business_id', businessId)
      .eq('status', 'approved')
      .maybeSingle();
    const feePct = Number(link?.settlement_fee_percent) || 0;
    const fee = money((applied * feePct) / 100);
    await supabase.from('gift_card_settlements').insert({
      issuer_business_id: issuerId,
      redeemer_business_id: businessId,
      gift_card_transaction_id: txRow?.id,
      amount: applied,
      fee_amount: fee,
      net_amount: money(applied - fee),
      status: 'open',
    });
  }

  if (applyBurnBonus && redeemerCustomerId && applied > 0) {
    const bonus = money(applyBurnBonus);
    if (bonus > 0) {
      await applyGiftCardCredit({
        businessId: issuerId,
        accountId: redeemerCustomerId,
        amountDollars: bonus,
        note: 'Burn campaign bonus',
        processedByUserId,
        giftCardId: card.id,
        transactionType: 'gift_credit_bonus',
      });
    }
  }

  return {
    card: updated,
    appliedAmount: applied,
    remainingDue: money(requested - applied),
    attachedCredit,
  };
}

export async function applyGiftCardCredit({
  businessId,
  accountId,
  amountDollars,
  isReversal = false,
  note = '',
  processedByUserId = null,
  giftCardId = null,
  transactionType = 'gift_credit_spend',
}) {
  if (!businessId || !accountId) throw new Error('Business and account are required');
  const n = money(amountDollars);
  if (n <= 0) throw new Error('Amount must be greater than zero');

  const { data: acc, error: accErr } = await supabase
    .from('pos_loyalty_accounts')
    .select('id, gift_card_credit, business_id')
    .eq('id', accountId)
    .eq('business_id', businessId)
    .single();
  if (accErr) throw accErr;

  const before = money(acc.gift_card_credit);
  const after = money(before + (isReversal ? -n : n));
  if (after < 0) throw new Error('Gift card credit cannot go negative');

  const { error: upErr } = await supabase
    .from('pos_loyalty_accounts')
    .update({ gift_card_credit: after, last_activity: new Date().toISOString() })
    .eq('id', accountId)
    .eq('business_id', businessId);
  if (upErr) throw upErr;

  const { error: txErr } = await supabase.from('gift_card_transactions').insert({
    business_id: businessId,
    gift_card_id: giftCardId,
    customer_id: accountId,
    transaction_type: isReversal ? 'gift_credit_spend' : transactionType,
    amount: isReversal ? -n : n,
    balance_before: before,
    balance_after: after,
    processed_by: processedByUserId,
    reason: note || (isReversal ? 'Gift card credit spent' : 'Gift card credit added'),
  });
  if (txErr) {
    await supabase
      .from('pos_loyalty_accounts')
      .update({ gift_card_credit: before })
      .eq('id', accountId)
      .eq('business_id', businessId);
    throw txErr;
  }

  return { newGiftCardCredit: after };
}

export async function spendCustomerGiftCredit({
  businessId,
  accountId,
  amountDollars,
  saleId = null,
  processedByUserId = null,
}) {
  return applyGiftCardCredit({
    businessId,
    accountId,
    amountDollars,
    isReversal: true,
    note: 'Applied to purchase',
    processedByUserId,
    transactionType: 'gift_credit_spend',
    giftCardId: null,
  });
}

/**
 * Reprint invalidates old code/QR and issues a replacement card.
 */
export async function reprintGiftCard({
  businessId,
  giftCardId,
  verifiedOriginalPurchaser = false,
  processedByUserId = null,
  reason = 'Staff reprint',
}) {
  if (!verifiedOriginalPurchaser) {
    throw new Error('Staff must verify the original purchaser before reprinting.');
  }

  const { data: original, error } = await supabase
    .from('gift_cards')
    .select('*')
    .eq('id', giftCardId)
    .eq('business_id', businessId)
    .single();
  if (error) throw error;
  if (!original) throw new Error('Gift card not found');
  if (['voided', 'replaced'].includes(original.status)) {
    throw new Error(original.invalid_reason || `Cannot reprint a ${original.status} card.`);
  }

  const replacement = await issueGiftCard({
    businessId,
    productId: original.product_id,
    cardType: original.card_type,
    faceValue: original.card_type === 'money' ? original.balance_remaining || original.face_value : original.face_value,
    amountPaid: 0,
    inventoryItemId: original.inventory_item_id,
    inventoryQty: original.inventory_qty_remaining,
    purchaserCustomerId: original.purchaser_customer_id,
    recipientCustomerId: original.recipient_customer_id,
    purchaserName: original.purchaser_name,
    purchaserEmail: original.purchaser_email,
    purchaserPhone: original.purchaser_phone,
    recipientName: original.recipient_name,
    recipientEmail: original.recipient_email,
    recipientPhone: original.recipient_phone,
    notifyRecipient: false,
    isCharitable: original.is_charitable,
    expiresAt: original.expires_at,
    saleSource: 'staff',
    designId: original.design_id,
    notes: `Reprint of ${original.code}`,
    processedByUserId,
  });

  await supabase
    .from('gift_cards')
    .update({
      status: 'replaced',
      invalid_reason: 'This code was invalidated because the gift card was reprinted.',
      replaced_by_card_id: replacement.id,
      balance_remaining: 0,
      inventory_qty_remaining: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', original.id);

  await supabase
    .from('gift_cards')
    .update({ replaces_card_id: original.id, updated_at: new Date().toISOString() })
    .eq('id', replacement.id);

  await supabase.from('gift_card_transactions').insert({
    business_id: businessId,
    gift_card_id: original.id,
    customer_id: original.purchaser_customer_id,
    transaction_type: 'reprint',
    amount: 0,
    processed_by: processedByUserId,
    reason,
    metadata: { replacement_id: replacement.id, replacement_code: replacement.code },
  });

  return replacement;
}

export async function voidGiftCard({ businessId, giftCardId, reason, processedByUserId = null }) {
  const { data: card, error } = await supabase
    .from('gift_cards')
    .select('*')
    .eq('id', giftCardId)
    .eq('business_id', businessId)
    .single();
  if (error) throw error;

  const { data: updated, error: upErr } = await supabase
    .from('gift_cards')
    .update({
      status: 'voided',
      invalid_reason: reason || 'This gift card was voided by staff.',
      balance_remaining: 0,
      inventory_qty_remaining: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', giftCardId)
    .select('*')
    .single();
  if (upErr) throw upErr;

  await supabase.from('gift_card_transactions').insert({
    business_id: businessId,
    gift_card_id: giftCardId,
    customer_id: card.purchaser_customer_id,
    transaction_type: 'void',
    amount: -money(card.balance_remaining),
    balance_before: card.balance_remaining,
    balance_after: 0,
    processed_by: processedByUserId,
    reason: reason || 'Voided',
  });

  return updated;
}

export async function listTransactions(businessId, { giftCardId = null, limit = 100 } = {}) {
  let q = supabase
    .from('gift_card_transactions')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (giftCardId) q = q.eq('gift_card_id', giftCardId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listPromotions(businessId) {
  const { data, error } = await supabase
    .from('gift_card_promotions')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertPromotion(businessId, promo) {
  const payload = {
    ...promo,
    business_id: businessId,
    updated_at: new Date().toISOString(),
  };
  if (!payload.id) delete payload.id;
  const { data, error } = await supabase.from('gift_card_promotions').upsert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function listBusinessLinks(businessId) {
  const { data, error } = await supabase
    .from('gift_card_business_links')
    .select('*')
    .or(`issuer_business_id.eq.${businessId},partner_business_id.eq.${businessId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function requestBusinessLink({
  issuerBusinessId,
  partnerBusinessId,
  requestedBy,
  settlementFeePercent = 0,
  notes = '',
}) {
  if (issuerBusinessId === partnerBusinessId) {
    throw new Error('Choose a different business to link.');
  }
  const { data, error } = await supabase
    .from('gift_card_business_links')
    .upsert(
      {
        issuer_business_id: issuerBusinessId,
        partner_business_id: partnerBusinessId,
        status: 'pending',
        requested_by: requestedBy,
        settlement_fee_percent: settlementFeePercent,
        notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'issuer_business_id,partner_business_id' }
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function respondBusinessLink({ linkId, status, respondedBy }) {
  if (!['approved', 'rejected', 'revoked'].includes(status)) {
    throw new Error('Invalid link status');
  }
  const { data, error } = await supabase
    .from('gift_card_business_links')
    .update({
      status,
      responded_by: respondedBy,
      updated_at: new Date().toISOString(),
    })
    .eq('id', linkId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listSettlements(businessId) {
  const { data, error } = await supabase
    .from('gift_card_settlements')
    .select('*')
    .or(`issuer_business_id.eq.${businessId},redeemer_business_id.eq.${businessId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export function buildGiftCardPurchaseUrl(businessId, { promoId = null } = {}) {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://tavari.ca';
  const url = new URL(`${base}/customer-portal/${businessId}/gift-cards`);
  if (promoId) url.searchParams.set('promo', promoId);
  return url.toString();
}

/** Logo from Settings → Colors & branding (`app_branding.logo_url`). */
export async function getBusinessLogoUrl(businessId) {
  if (!businessId) return null;
  const { data, error } = await supabase
    .from('app_branding')
    .select('logo_url')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) {
    console.warn('[GiftCardService] Failed to load branding logo:', error);
    return null;
  }
  const url = String(data?.logo_url || '').trim();
  return url || null;
}

export async function getDefaultDesign(businessId) {
  if (!businessId) return null;
  const designs = await listDesigns(businessId);
  return designs.find((d) => d.is_default) || designs[0] || null;
}

/**
 * Printable gift card certificate HTML — full-width rectangle (~30% page height),
 * graphic left, message center, code/QR + instructions right.
 */
export function buildPrintableGiftCardHtml({
  card,
  businessName = 'Gift Card',
  businessLogoUrl = null,
  design = null,
}) {
  const bg = design?.background_color || '#0f766e';
  const text = design?.text_color || '#ffffff';
  const accent = design?.accent_color || '#14b8a6';
  const useBusinessLogo = design?.uses_business_logo !== false;
  const graphic = String(
    design?.custom_image_url || (useBusinessLogo ? businessLogoUrl : '') || businessLogoUrl || ''
  ).trim();
  const face = Number(card?.face_value || 0).toFixed(2);
  const code = card?.code || '';
  const qrPayload = encodeURIComponent(card?.qr_payload || code);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${qrPayload}`;
  const message = (card?.personal_message || '').trim();
  const toName = card?.recipient_name || '';
  const fromName = card?.purchaser_name || '';
  const safeGraphic = graphic ? escapeHtml(graphic) : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Gift Card ${code}</title>
  <style>
    @page { margin: 0.4in; size: letter; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: #0f172a;
      background: #fff;
    }
    .sheet {
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      padding-top: 0.35in;
    }
    .gift-card {
      width: 100%;
      height: 30vh;
      min-height: 220px;
      max-height: 280px;
      border: 3px solid ${bg};
      border-radius: 14px;
      overflow: hidden;
      display: grid;
      grid-template-columns: 22% 1fr 28%;
      background: linear-gradient(135deg, ${bg} 0%, ${accent} 100%);
      color: ${text};
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
    }
    .col {
      padding: 18px 16px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }
    .col-left {
      align-items: center;
      border-right: 1px solid rgba(255,255,255,0.25);
      text-align: center;
    }
    .col-mid {
      padding-left: 22px;
      padding-right: 22px;
    }
    .col-right {
      align-items: center;
      text-align: center;
      border-left: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.12);
    }
    .logo, .graphic {
      width: 88px;
      height: 88px;
      object-fit: contain;
      border-radius: 10px;
      background: rgba(255,255,255,0.92);
      padding: 8px;
    }
    .biz {
      margin-top: 10px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      opacity: 0.95;
    }
    .eyebrow {
      font-size: 13px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.85;
      margin-bottom: 6px;
    }
    .amount {
      font-size: 43px;
      font-weight: 700;
      line-height: 1;
      margin: 4px 0 12px;
    }
    .to-from {
      font-size: 14px;
      line-height: 1.45;
      opacity: 0.95;
    }
    .message {
      margin-top: 12px;
      font-size: 15px;
      font-style: italic;
      line-height: 1.4;
      max-height: 4.2em;
      overflow: hidden;
    }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 16px;
      letter-spacing: 0.08em;
      font-weight: 700;
      background: rgba(255,255,255,0.18);
      padding: 8px 10px;
      border-radius: 8px;
      margin: 8px 0;
    }
    .qr {
      width: 110px;
      height: 110px;
      background: #fff;
      border-radius: 8px;
      padding: 6px;
    }
    .instr {
      margin-top: 8px;
      font-size: 11px;
      line-height: 1.35;
      opacity: 0.95;
      max-width: 180px;
    }
    .hint {
      margin-top: 18px;
      font-size: 13px;
      color: #64748b;
      text-align: center;
    }
    @media print {
      .hint { display: none; }
      .gift-card { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="gift-card">
      <div class="col col-left">
        ${safeGraphic
          ? `<img class="graphic" src="${safeGraphic}" alt="${escapeHtml(businessName)} logo" crossorigin="anonymous" />`
          : `<div class="logo" style="display:flex;align-items:center;justify-content:center;font-size: 28px;">🎁</div>`}
        <div class="biz">${escapeHtml(businessName)}</div>
      </div>
      <div class="col col-mid">
        <div class="eyebrow">Gift Card</div>
        <div class="amount">$${face}</div>
        <div class="to-from">
          ${toName ? `<div><strong>To:</strong> ${escapeHtml(toName)}</div>` : ''}
          ${fromName ? `<div><strong>From:</strong> ${escapeHtml(fromName)}</div>` : ''}
        </div>
        ${message ? `<div class="message">“${escapeHtml(message)}”</div>` : ''}
      </div>
      <div class="col col-right">
        <img class="qr" src="${qrUrl}" alt="QR code" />
        <div class="code">${escapeHtml(code)}</div>
        <div class="instr">Scan the QR code or enter this code at checkout to redeem. Keep this card until the balance is used.</div>
      </div>
    </div>
    <div class="hint">Print this page · Gift card certificate</div>
  </div>
  <script>
    (function () {
      function goPrint() {
        try { window.print(); } catch (e) {}
      }
      function whenReady() {
        var imgs = Array.prototype.slice.call(document.images || []);
        if (!imgs.length) {
          setTimeout(goPrint, 200);
          return;
        }
        var pending = imgs.length;
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          setTimeout(goPrint, 150);
        }
        imgs.forEach(function (img) {
          if (img.complete) {
            pending -= 1;
            if (pending <= 0) finish();
            return;
          }
          img.addEventListener('load', function () {
            pending -= 1;
            if (pending <= 0) finish();
          });
          img.addEventListener('error', function () {
            pending -= 1;
            if (pending <= 0) finish();
          });
        });
        setTimeout(finish, 2500);
      }
      if (document.readyState === 'complete') whenReady();
      else window.addEventListener('load', whenReady);
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Opens a printable gift card window. Resolves the Settings branding logo
 * (and default design) when not provided by the caller.
 *
 * Opens the popup synchronously (user gesture) so browsers don't block it,
 * then fills the document after logo/design resolution.
 */
export async function openPrintableGiftCard(opts = {}) {
  const w = window.open('', '_blank', 'width=1000,height=700');
  if (!w) throw new Error('Allow popups to print the gift card');

  try {
    w.document.write('<!doctype html><title>Gift Card</title><body style="font-family:sans-serif;padding:24px;color:#64748b;">Preparing gift card…</body>');
    w.document.close();
  } catch (_) {
    // ignore write errors on restricted windows
  }

  const card = opts.card || {};
  const businessId = opts.businessId || card.business_id || null;

  let businessLogoUrl = String(opts.businessLogoUrl || '').trim() || null;
  let businessName = opts.businessName || null;
  let design = opts.design || null;

  if (businessId && (!businessLogoUrl || !design || !businessName)) {
    const tasks = [];
    if (!businessLogoUrl) tasks.push(getBusinessLogoUrl(businessId).then((url) => { businessLogoUrl = url; }));
    if (!design) tasks.push(getDefaultDesign(businessId).then((d) => { design = d; }));
    if (!businessName) {
      tasks.push(
        supabase
          .from('businesses')
          .select('name')
          .eq('id', businessId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.name) businessName = data.name;
          })
      );
    }
    await Promise.all(tasks);
  }

  const html = buildPrintableGiftCardHtml({
    ...opts,
    card,
    businessName: businessName || 'Gift Card',
    businessLogoUrl,
    design,
  });

  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (err) {
    try { w.close(); } catch (_) {}
    throw err;
  }
  return w;
}

export { normalizeCode, money };

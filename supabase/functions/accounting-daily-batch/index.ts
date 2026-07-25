// accounting-daily-batch: creates one sales batch per business per "previous calendar day"
// Trigger via external cron, Supabase scheduled invocation, or manual POST with body (build plan §7A.2)
// Uses business_timezone, batch_run_time_local, batch_day_end_time_local from accounting_business_config
// Body (optional): { business_id?: string, batch_date?: string, backfill_days?: number }
//   - business_id: only run for this business
//   - batch_date: use this date instead of yesterday (YYYY-MM-DD)
//   - backfill_days: create batches for this many days (yesterday and earlier); default 1

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function getBearerToken(req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** When POS tax column is zero but total exceeds subtotal, derive tax from the gap (common on legacy POS rows). */
function resolveSaleTax(sale: { subtotal?: number; tax?: number; total?: number }) {
  const explicit = round2(Number(sale.tax ?? 0));
  if (explicit > 0) return explicit;
  const subtotal = round2(Number(sale.subtotal ?? 0));
  const total = round2(Number(sale.total ?? 0));
  if (total > subtotal && subtotal > 0) return round2(total - subtotal);
  return 0;
}

function slugify(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function titleCase(value: string) {
  return value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildSourceBucket(params: {
  sourceKind: 'pos' | 'booking';
  paymentMethod?: string | null;
  customMethodName?: string | null;
}) {
  const paymentMethod = String(params.paymentMethod || '').trim().toLowerCase();
  const customMethodName = String(params.customMethodName || '').trim();
  const customKey = slugify(customMethodName);

  if (customKey) {
    return {
      key: `${params.sourceKind}_custom_${customKey}`,
      label: titleCase(customMethodName)
    };
  }

  if (/helcim/.test(paymentMethod)) return { key: `${params.sourceKind}_helcim`, label: 'Helcim' };
  if (/clover/.test(paymentMethod)) return { key: `${params.sourceKind}_clover`, label: 'Clover' };
  if (/nayax/.test(paymentMethod)) return { key: `${params.sourceKind}_nayax`, label: 'Nayax' };
  if (/authorize/.test(paymentMethod)) return { key: `${params.sourceKind}_authorize_net`, label: 'Authorize.net' };
  if (/cash/.test(paymentMethod)) return { key: `${params.sourceKind}_cash`, label: 'Cash' };
  if (/gift/.test(paymentMethod)) return { key: `${params.sourceKind}_gift_card`, label: 'Gift Card' };
  if (/check|cheque/.test(paymentMethod)) return { key: `${params.sourceKind}_check`, label: 'Cheque / Check' };
  if (/debit/.test(paymentMethod)) return { key: `${params.sourceKind}_debit`, label: 'Debit' };
  if (/credit|card/.test(paymentMethod)) return { key: `${params.sourceKind}_card`, label: 'Card' };
  if (params.sourceKind === 'booking' && !paymentMethod) return { key: 'booking_unknown', label: 'Booking payment' };
  if (params.sourceKind === 'pos' && !paymentMethod) return { key: 'pos_unknown', label: 'POS payment' };

  const fallback = slugify(paymentMethod) || `${params.sourceKind}_other`;
  return {
    key: `${params.sourceKind}_${fallback}`,
    label: titleCase(paymentMethod || `${params.sourceKind} payment`)
  };
}

function allocateSaleAcrossPayments(
  sale: { id: string; subtotal?: number; tax?: number; total?: number },
  payments: Array<{ id: string; amount?: number; payment_method?: string | null; custom_method_name?: string | null; reference_number?: string | null }>
) {
  const subtotal = round2(Number(sale.subtotal ?? sale.total ?? 0));
  const tax = resolveSaleTax(sale);
  const eligiblePayments = payments.filter((payment) => Number(payment.amount ?? 0) > 0);

  if (eligiblePayments.length === 0) {
    return [{
      source_type: 'pos',
      source_id: sale.id,
      amount: subtotal,
      tax_amount: tax,
      source_bucket_key: 'pos_unknown',
      source_bucket_label: 'POS payment',
      source_metadata: { sale_id: sale.id, derived_without_payment_rows: true }
    }];
  }

  const paymentBase = eligiblePayments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount ?? 0)), 0);
  let remainingSubtotal = subtotal;
  let remainingTax = tax;

  return eligiblePayments.map((payment, index) => {
    const ratio = paymentBase > 0 ? Math.max(0, Number(payment.amount ?? 0)) / paymentBase : 0;
    const isLast = index === eligiblePayments.length - 1;
    const allocatedSubtotal = isLast ? remainingSubtotal : round2(subtotal * ratio);
    const allocatedTax = isLast ? remainingTax : round2(tax * ratio);
    remainingSubtotal = round2(remainingSubtotal - allocatedSubtotal);
    remainingTax = round2(remainingTax - allocatedTax);
    const bucket = buildSourceBucket({
      sourceKind: 'pos',
      paymentMethod: payment.payment_method,
      customMethodName: payment.custom_method_name
    });

    return {
      source_type: 'pos_payment',
      source_id: payment.id,
      amount: allocatedSubtotal,
      tax_amount: allocatedTax,
      source_bucket_key: bucket.key,
      source_bucket_label: bucket.label,
      source_metadata: {
        sale_id: sale.id,
        payment_method: payment.payment_method || null,
        custom_method_name: payment.custom_method_name || null,
        reference_number: payment.reference_number || null
      }
    };
  });
}

function parseTimeParts(timeValue?: string | null): { hour: number; minute: number } {
  const raw = (timeValue || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { hour: 23, minute: 59 };
  return {
    hour: Math.max(0, Math.min(23, parseInt(match[1], 10) || 0)),
    minute: Math.max(0, Math.min(59, parseInt(match[2], 10) || 0))
  };
}

function formatLocalParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: parseInt(get('hour'), 10) || 0,
    minute: parseInt(get('minute'), 10) || 0
  };
}

function findUtcForLocalMinute(batchDate: string, timezone: string, hour: number, minute: number): Date | null {
  const dateOnly = batchDate.slice(0, 10);
  const baseUtc = new Date(`${dateOnly}T00:00:00.000Z`);
  for (let minuteOffset = -12 * 60; minuteOffset <= 36 * 60; minuteOffset++) {
    const candidate = new Date(baseUtc.getTime() + minuteOffset * 60 * 1000);
    const local = formatLocalParts(candidate, timezone);
    const localDateStr = `${local.year}-${local.month}-${local.day}`;
    if (localDateStr === dateOnly && local.hour === hour && local.minute === minute) {
      return candidate;
    }
  }
  return null;
}

function getLocalToday(timezone: string): string {
  const local = formatLocalParts(new Date(), timezone || 'America/Toronto');
  return `${local.year}-${local.month}-${local.day}`;
}

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Get UTC start and end for a calendar date in the given timezone honoring day-end time. */
function getDayWindowUtc(batchDate: string, timezone: string, dayEndTime?: string | null): { startUtc: string; endUtc: string } {
  const tz = timezone || 'America/Toronto';
  const dateOnly = batchDate.slice(0, 10);
  const { hour: endHour, minute: endMinute } = parseTimeParts(dayEndTime);
  const start = findUtcForLocalMinute(dateOnly, tz, 0, 0);
  const endMinuteUtc = findUtcForLocalMinute(dateOnly, tz, endHour, endMinute);
  const fallbackStart = new Date(`${dateOnly}T00:00:00.000Z`);
  const fallbackEnd = new Date(`${dateOnly}T23:59:59.999Z`);
  return {
    startUtc: (start || fallbackStart).toISOString(),
    endUtc: (endMinuteUtc ? new Date(endMinuteUtc.getTime() + 59 * 1000 + 999) : fallbackEnd).toISOString()
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    let body: { business_id?: string; batch_date?: string; backfill_days?: number } = {};
    try {
      body = (await req.json().catch(() => ({}))) as typeof body;
    } catch {
      /* empty body */
    }
    const filterBusinessId = body?.business_id?.trim() || null;
    const singleBatchDate = body?.batch_date?.trim()?.slice(0, 10) || null;
    const backfillDays = Math.min(Math.max(1, parseInt(String(body?.backfill_days), 10) || 1), 365);
    const authHeader = req.headers.get('Authorization');
    const isInternalCaller = getBearerToken(req) === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!filterBusinessId) {
      if (!isInternalCaller) {
        return new Response(JSON.stringify({ error: 'Unauthorized global batch run' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } else if (isInternalCaller) {
      // Allow trusted internal service-role invocations for targeted runs.
    } else if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else {
      const supabaseUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const { data: membership } = await supabaseUser
        .from('business_users')
        .select('role')
        .eq('business_id', filterBusinessId)
        .eq('user_id', user.id)
        .in('role', ['owner', 'manager', 'admin'])
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Access denied to this business' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    let query = supabase
      .from('accounting_business_config')
      .select('id, business_id, business_timezone, batch_run_time_local, batch_day_end_time_local')
      .not('erpnext_api_url', 'is', null);
    if (filterBusinessId) {
      query = query.eq('business_id', filterBusinessId);
    }
    const { data: configs, error: configError } = await query;

    console.log('[accounting-daily-batch] request', { filterBusinessId, backfillDays, singleBatchDate });
    if (configError) {
      console.error('[accounting-daily-batch] config load error', configError);
      return new Response(JSON.stringify({ error: configError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const configCount = configs?.length ?? 0;
    console.log('[accounting-daily-batch] configs found', configCount, configs?.map((c: { business_id: string }) => c.business_id) ?? []);
    if (configCount === 0) {
      console.warn('[accounting-daily-batch] no accounting config with erpnext_api_url for this business – connect accounting in Settings first');
    }

    const results: { business_id: string; batch_date?: string; created?: boolean; error?: string }[] = [];

    for (const config of configs || []) {
      const tz = config.business_timezone || 'America/Toronto';
      const runAt = parseTimeParts(config.batch_run_time_local as string | null | undefined);

      const datesToProcess: string[] = [];
      if (singleBatchDate) {
        datesToProcess.push(singleBatchDate);
      } else {
        const todayInTz = getLocalToday(tz);
        const nowLocal = formatLocalParts(new Date(), tz);
        const beforeRunWindow = nowLocal.hour < runAt.hour || (nowLocal.hour === runAt.hour && nowLocal.minute < runAt.minute);
        const firstOffset = beforeRunWindow ? -2 : -1;
        for (let i = 0; i < backfillDays; i++) {
          datesToProcess.push(addDays(todayInTz, firstOffset - i));
        }
      }

      for (const batchDate of datesToProcess) {
        const { data: existing } = await supabase
          .from('accounting_sales_batches')
          .select('id')
          .eq('business_id', config.business_id)
          .eq('batch_date', batchDate)
          .maybeSingle();

        if (existing) {
          results.push({ business_id: config.business_id, batch_date: batchDate, created: false });
          continue;
        }

        const { startUtc: dayStartUtc, endUtc: dayEndUtc } = getDayWindowUtc(
          batchDate,
          tz,
          config.batch_day_end_time_local as string | null | undefined
        );

        const paymentStatusCompleted = 'completed';
        const { data: posSales, error: posError } = await supabase
          .from('pos_sales')
          .select('id, subtotal, tax, total')
          .eq('business_id', config.business_id)
          .in('payment_status', [paymentStatusCompleted, 'paid'])
          .gte('created_at', dayStartUtc)
          .lte('created_at', dayEndUtc);

        if (posError) {
          results.push({ business_id: config.business_id, batch_date: batchDate, error: posError.message });
          continue;
        }

        // Include invoice POS sales paid on this day but created earlier (sent unpaid, paid later).
        const { data: paymentsInWindow } = await supabase
          .from('pos_payments')
          .select('sale_id')
          .eq('business_id', config.business_id)
          .gte('created_at', dayStartUtc)
          .lte('created_at', dayEndUtc);
        const posSalesIds = new Set((posSales || []).map((s: { id: string }) => s.id));
        const extraSaleIds = Array.from(
          new Set(
            (paymentsInWindow || [])
              .map((p: { sale_id?: string | null }) => p.sale_id)
              .filter((id): id is string => !!id && !posSalesIds.has(id))
          )
        );
        let supplementalPosSales: typeof posSales = [];
        if (extraSaleIds.length > 0) {
          const { data: extraSales } = await supabase
            .from('pos_sales')
            .select('id, subtotal, tax, total')
            .eq('business_id', config.business_id)
            .in('payment_status', [paymentStatusCompleted, 'paid'])
            .in('id', extraSaleIds);
          supplementalPosSales = extraSales || [];
        }
        const allPosSales = [...(posSales || []), ...(supplementalPosSales || [])];

        const { data: existingBatches } = await supabase.from('accounting_sales_batches').select('id').eq('business_id', config.business_id);
        const batchIds = (existingBatches || []).map((b: { id: string }) => b.id);
        const { data: batchItems } = batchIds.length > 0
          ? await supabase.from('accounting_sales_batch_items').select('source_id, source_type').in('batch_id', batchIds)
          : { data: [] };
        const alreadyBatchedPosSales = new Set((batchItems || []).filter((i: { source_type: string }) => i.source_type === 'pos').map((i: { source_id: string }) => i.source_id));
        const alreadyBatchedPosPayments = new Set((batchItems || []).filter((i: { source_type: string }) => i.source_type === 'pos_payment').map((i: { source_id: string }) => i.source_id));
        const alreadyBatchedBookingRows = new Set((batchItems || []).filter((i: { source_type: string }) => i.source_type === 'booking').map((i: { source_id: string }) => i.source_id));
        const alreadyBatchedBookingPayments = new Set((batchItems || []).filter((i: { source_type: string }) => i.source_type === 'booking_payment').map((i: { source_id: string }) => i.source_id));

        const posToAdd = allPosSales.filter((s: { id: string }) => !alreadyBatchedPosSales.has(s.id));
        let totalSales = 0;
        let totalTax = 0;
        const items: Array<{
          source_type: string;
          source_id: string;
          amount: number;
          tax_amount: number;
          source_bucket_key: string;
          source_bucket_label: string;
          source_metadata: Record<string, unknown>;
        }> = [];
        const posSaleIds = posToAdd.map((sale: { id: string }) => sale.id);
        const { data: posPayments } = posSaleIds.length > 0
          ? await supabase
              .from('pos_payments')
              .select('id, sale_id, amount, payment_method, custom_method_name, reference_number')
              .in('sale_id', posSaleIds)
          : { data: [] };
        const posPaymentsBySale = new Map<string, Array<{ id: string; amount?: number; payment_method?: string | null; custom_method_name?: string | null; reference_number?: string | null }>>();
        for (const payment of posPayments || []) {
          if (alreadyBatchedPosPayments.has(payment.id)) continue;
          const list = posPaymentsBySale.get(payment.sale_id) || [];
          list.push(payment);
          posPaymentsBySale.set(payment.sale_id, list);
        }
        for (const s of posToAdd) {
          const amt = Number(s.subtotal ?? s.total ?? 0);
          const tax = resolveSaleTax(s);
          totalSales += amt;
          totalTax += tax;
          const allocations = allocateSaleAcrossPayments(s, posPaymentsBySale.get(s.id) || []);
          for (const allocation of allocations) items.push(allocation);
        }

        const { data: bizBookings } = await supabase
          .from('bookings')
          .select('id, order_total, tax_amount')
          .eq('business_id', config.business_id);
        const bizBookingIds = (bizBookings || []).map((b: { id: string }) => b.id);
        const bookingsById = Object.fromEntries(
          (bizBookings || []).map((b: { id: string; order_total?: number; tax_amount?: number }) => [b.id, b])
        );
        if (bizBookingIds.length > 0) {
          const { data: bookingPayments } = await supabase
            .from('booking_payments')
            .select('id, amount_paid, booking_id, payment_method')
            .eq('status', 'completed')
            .is('sale_id', null)
            .in('booking_id', bizBookingIds)
            .gte('created_at', dayStartUtc)
            .lte('created_at', dayEndUtc);
          for (const bp of bookingPayments || []) {
            if (alreadyBatchedBookingRows.has(bp.id) || alreadyBatchedBookingPayments.has(bp.id)) continue;
            const gross = Number(bp.amount_paid ?? 0);
            const booking = bookingsById[bp.booking_id] as { order_total?: number; tax_amount?: number } | undefined;
            const orderTotal = Math.abs(Number(booking?.order_total ?? 0));
            const bookingTax = Math.abs(Number(booking?.tax_amount ?? 0));
            let subtotalAmt = gross;
            let taxAmt = 0;
            if (gross > 0 && orderTotal > 0 && bookingTax > 0) {
              taxAmt = round2(gross * (bookingTax / orderTotal));
              subtotalAmt = round2(gross - taxAmt);
            }
            totalSales += subtotalAmt;
            totalTax += taxAmt;
            const bucket = buildSourceBucket({
              sourceKind: 'booking',
              paymentMethod: bp.payment_method
            });
            items.push({
              source_type: 'booking_payment',
              source_id: bp.id,
              amount: subtotalAmt,
              tax_amount: taxAmt,
              source_bucket_key: bucket.key,
              source_bucket_label: bucket.label,
              source_metadata: {
                booking_id: bp.booking_id,
                payment_method: bp.payment_method || null,
                gross_amount_paid: gross
              }
            });
          }
        }

        const { data: refunds } = await supabase
          .from('pos_refunds')
          .select('total_refund_amount, original_sale_id')
          .eq('business_id', config.business_id)
          .gte('created_at', dayStartUtc)
          .lte('created_at', dayEndUtc);
        let totalRefunds = 0;
        let totalRefundTax = 0;
        const refundRows = (refunds || []) as { total_refund_amount?: number; original_sale_id?: string | null }[];
        const originalSaleIds = Array.from(new Set(refundRows.map((r) => r.original_sale_id).filter(Boolean))) as string[];
        let originalSalesById: Record<string, { subtotal?: number; tax?: number; total?: number }> = {};
        if (originalSaleIds.length > 0) {
          const { data: originalSales } = await supabase
            .from('pos_sales')
            .select('id, subtotal, tax, total')
            .in('id', originalSaleIds);
          originalSalesById = Object.fromEntries(
            (originalSales || []).map((sale: { id: string; subtotal?: number; tax?: number; total?: number }) => [sale.id, sale])
          );
        }
        for (const refund of refundRows) {
          const grossRefund = Number(refund.total_refund_amount ?? 0);
          totalRefunds += grossRefund;
          const originalSale = refund.original_sale_id ? originalSalesById[refund.original_sale_id] : null;
          const originalTotal = Math.abs(Number(originalSale?.total ?? 0));
          const originalTax = originalSale ? Math.abs(resolveSaleTax(originalSale)) : 0;
          if (grossRefund > 0 && originalTotal > 0 && originalTax > 0) {
            totalRefundTax += round2(grossRefund * (originalTax / originalTotal));
          }
        }
        if (bizBookingIds.length > 0) {
          const { data: bookingRefunds } = await supabase
            .from('booking_payments')
            .select('refund_amount, booking_id')
            .eq('status', 'refunded')
            .in('booking_id', bizBookingIds)
            .gte('refunded_at', dayStartUtc)
            .lte('refunded_at', dayEndUtc);
          for (const refund of bookingRefunds || []) {
            const grossRefund = Number((refund as { refund_amount?: number }).refund_amount ?? 0);
            totalRefunds += grossRefund;
            const booking = bookingsById[(refund as { booking_id?: string }).booking_id || ''] as { order_total?: number; tax_amount?: number } | undefined;
            const orderTotal = Math.abs(Number(booking?.order_total ?? 0));
            const bookingTax = Math.abs(Number(booking?.tax_amount ?? 0));
            if (grossRefund > 0 && orderTotal > 0 && bookingTax > 0) {
              totalRefundTax += round2(grossRefund * (bookingTax / orderTotal));
            }
          }
        }

        const { data: newBatch, error: insertBatchError } = await supabase
          .from('accounting_sales_batches')
          .insert({
            business_id: config.business_id,
            batch_date: batchDate,
            status: 'draft',
            total_sales_amount: totalSales,
            total_tax_amount: totalTax,
            total_refunds_amount: totalRefunds,
            total_refund_tax_amount: totalRefundTax
          })
          .select('id')
          .single();

        if (insertBatchError) {
          results.push({ business_id: config.business_id, batch_date: batchDate, error: insertBatchError.message });
          continue;
        }

        if (items.length > 0) {
          await supabase.from('accounting_sales_batch_items').insert(
            items.map((i) => ({
              batch_id: newBatch.id,
              source_type: i.source_type,
              source_id: i.source_id,
              amount: i.amount,
              tax_amount: i.tax_amount,
              source_bucket_key: i.source_bucket_key,
              source_bucket_label: i.source_bucket_label,
              source_metadata: i.source_metadata
            }))
          );
        }

        results.push({ business_id: config.business_id, batch_date: batchDate, created: true });
      }
    }

    const payload: { ok: boolean; results: typeof results; message?: string } = { ok: true, results };
    if (configCount === 0 && filterBusinessId) {
      payload.message = 'No accounting config found for this business. Connect accounting in Accounting → Settings first (ERPNext URL must be set).';
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

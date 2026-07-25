import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formatDateInTimezone, getPeriodWindowUtc } from './businessDayWindow.ts';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type SaleRow = {
  id: string;
  created_at: string;
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  indian_status_gst_only?: boolean | null;
  indian_status_certificate_number?: string | null;
};

type BookingRow = {
  id: string;
  order_total?: number | null;
  tax_amount?: number | null;
  indian_status_gst_only?: boolean | null;
  indian_status_certificate_number?: string | null;
};

type BookingPaymentRow = {
  id: string;
  booking_id: string;
  amount_paid?: number | null;
  created_at: string;
};

export type HstAdjustmentLine = {
  transaction_date: string;
  source_type: 'pos' | 'booking';
  source_id: string;
  subtotal: number;
  tax_collected: number;
  certificate_number: string | null;
  indian_status: boolean;
  expected_full_hst: number;
  hst_reduction: number;
  effective_tax_rate: number | null;
};

export type HstAdjustmentBucket = {
  id: string;
  label: string;
  description: string;
  transaction_count: number;
  subtotal: number;
  tax_collected: number;
  expected_full_hst: number;
  hst_reduction: number;
};

export type HstAdjustmentSchedule = {
  standard_hst_rate: number;
  indian_gst_rate: number;
  summary: HstAdjustmentBucket[];
  indian_status_transactions: HstAdjustmentLine[];
  zero_tax_transactions: HstAdjustmentLine[];
  other_transactions: HstAdjustmentLine[];
  zero_tax_total_count: number;
  other_total_count: number;
  totals: {
    subtotal: number;
    tax_collected: number;
    expected_full_hst: number;
    hst_reduction: number;
    transaction_count: number;
  };
  notes: string[];
};

const BUCKET_META: Record<string, { label: string; description: string }> = {
  standard: {
    label: 'Standard HST sales',
    description: 'Taxed at the full HST rate (e.g. 13% in Ontario).',
  },
  indian_status: {
    label: 'Indian Status (GST only)',
    description: 'Federal GST only on qualifying goods; provincial HST portion not charged. Certificate on file.',
  },
  zero_tax: {
    label: 'Zero-tax / exempt sales',
    description: 'Sales with no tax collected (exempt items, adjustments, or data to review).',
  },
  reduced_rate: {
    label: 'Other reduced tax rate',
    description: 'Tax collected below full HST but not flagged as Indian Status — review if unexpected.',
  },
  other: {
    label: 'Other / rounding',
    description: 'Minor rate differences or mixed-tax receipts.',
  },
};

function resolveSaleTax(sale: { subtotal?: number | null; tax?: number | null; total?: number | null }) {
  const explicit = round2(Number(sale.tax ?? 0));
  if (explicit > 0) return explicit;
  const subtotal = round2(Number(sale.subtotal ?? 0));
  const total = round2(Number(sale.total ?? 0));
  if (total > subtotal && subtotal > 0) return round2(total - subtotal);
  return 0;
}

function classifyCategory(
  subtotal: number,
  tax: number,
  indianStatus: boolean,
  standardRate: number
): keyof typeof BUCKET_META {
  if (indianStatus) return 'indian_status';
  if (subtotal > 0 && tax <= 0.001) return 'zero_tax';
  const effectiveRate = subtotal > 0 ? tax / subtotal : 0;
  if (Math.abs(effectiveRate - standardRate) <= 0.008) return 'standard';
  if (tax > 0 && effectiveRate < standardRate - 0.008) return 'reduced_rate';
  return 'other';
}

async function fetchAllPosSales(
  supabase: SupabaseClient,
  businessId: string,
  startUtc: string,
  endUtc: string
): Promise<SaleRow[]> {
  const rows: SaleRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('pos_sales')
      .select('id, created_at, subtotal, tax, total, indian_status_gst_only, indian_status_certificate_number')
      .eq('business_id', businessId)
      .in('payment_status', ['completed', 'paid'])
      .gte('created_at', startUtc)
      .lte('created_at', endUtc)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as SaleRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchBookingPaymentLines(
  supabase: SupabaseClient,
  businessId: string,
  startUtc: string,
  endUtc: string,
  timezone: string,
  standardHstRate: number
): Promise<HstAdjustmentLine[]> {
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, order_total, tax_amount, indian_status_gst_only, indian_status_certificate_number')
    .eq('business_id', businessId);
  const bookingIds = (bookings || []).map((b: BookingRow) => b.id);
  if (bookingIds.length === 0) return [];

  const bookingsById = Object.fromEntries((bookings || []).map((b: BookingRow) => [b.id, b]));
  const lines: HstAdjustmentLine[] = [];

  for (let from = 0; ; from += 1000) {
    const { data: payments, error } = await supabase
      .from('booking_payments')
      .select('id, booking_id, amount_paid, created_at')
      .eq('status', 'completed')
      .is('sale_id', null)
      .in('booking_id', bookingIds)
      .gte('created_at', startUtc)
      .lte('created_at', endUtc)
      .range(from, from + 999);
    if (error) throw error;
    if (!payments?.length) break;

    for (const bp of payments as BookingPaymentRow[]) {
      const gross = Number(bp.amount_paid ?? 0);
      if (gross <= 0) continue;
      const booking = bookingsById[bp.booking_id] as BookingRow | undefined;
      const orderTotal = Math.abs(Number(booking?.order_total ?? 0));
      const bookingTax = Math.abs(Number(booking?.tax_amount ?? 0));
      let subtotal = gross;
      let tax = 0;
      if (orderTotal > 0 && bookingTax > 0) {
        tax = round2(gross * (bookingTax / orderTotal));
        subtotal = round2(gross - tax);
      }
      const expectedFull = round2(subtotal * standardHstRate);
      lines.push({
        transaction_date: formatDateInTimezone(bp.created_at, timezone),
        source_type: 'booking',
        source_id: bp.id,
        subtotal,
        tax_collected: tax,
        certificate_number: booking?.indian_status_certificate_number?.trim() || null,
        indian_status: !!booking?.indian_status_gst_only,
        expected_full_hst: expectedFull,
        hst_reduction: round2(expectedFull - tax),
        effective_tax_rate: subtotal > 0 ? round2(tax / subtotal) : null,
      });
    }
    if (payments.length < 1000) break;
  }
  return lines;
}

function saleToLine(sale: SaleRow, timezone: string, standardRate: number): HstAdjustmentLine {
  const subtotal = round2(Math.abs(Number(sale.subtotal ?? sale.total ?? 0)));
  const tax = round2(Math.abs(resolveSaleTax(sale)));
  const expectedFull = round2(subtotal * standardRate);
  return {
    transaction_date: formatDateInTimezone(sale.created_at, timezone),
    source_type: 'pos',
    source_id: sale.id,
    subtotal,
    tax_collected: tax,
    certificate_number: sale.indian_status_certificate_number?.trim() || null,
    indian_status: !!sale.indian_status_gst_only,
    expected_full_hst: expectedFull,
    hst_reduction: round2(expectedFull - tax),
    effective_tax_rate: subtotal > 0 ? round2(tax / subtotal) : null,
  };
}

export async function buildHstAdjustmentSchedule(
  supabase: SupabaseClient,
  businessId: string,
  fromDate: string,
  toDate: string,
  options: {
    timezone?: string;
    dayEndTime?: string | null;
    standardHstRate?: number;
  } = {}
): Promise<HstAdjustmentSchedule> {
  const timezone = options.timezone || 'America/Toronto';
  const { startUtc, endUtc } = getPeriodWindowUtc(fromDate, toDate, timezone, options.dayEndTime);

  const { data: posSettings } = await supabase
    .from('pos_settings')
    .select('indian_status_gst_rate')
    .eq('business_id', businessId)
    .maybeSingle();
  const indianGstRate = Number(posSettings?.indian_status_gst_rate ?? 0.05) || 0.05;
  const standardHstRate = options.standardHstRate ?? 0.13;

  const posSales = await fetchAllPosSales(supabase, businessId, startUtc, endUtc);
  const bookingLines = await fetchBookingPaymentLines(supabase, businessId, startUtc, endUtc, timezone, standardHstRate);

  const bucketTotals: Record<string, HstAdjustmentBucket> = {};
  for (const key of Object.keys(BUCKET_META)) {
    bucketTotals[key] = {
      id: key,
      ...BUCKET_META[key],
      transaction_count: 0,
      subtotal: 0,
      tax_collected: 0,
      expected_full_hst: 0,
      hst_reduction: 0,
    };
  }

  const indianStatusTransactions: HstAdjustmentLine[] = [];
  const zeroTaxTransactions: HstAdjustmentLine[] = [];
  const otherTransactions: HstAdjustmentLine[] = [];

  const addToBucket = (category: keyof typeof BUCKET_META, line: HstAdjustmentLine) => {
    const b = bucketTotals[category];
    b.transaction_count += 1;
    b.subtotal = round2(b.subtotal + line.subtotal);
    b.tax_collected = round2(b.tax_collected + line.tax_collected);
    b.expected_full_hst = round2(b.expected_full_hst + line.expected_full_hst);
    b.hst_reduction = round2(b.expected_full_hst - b.tax_collected);
  };

  for (const sale of posSales) {
    const line = saleToLine(sale, timezone, standardHstRate);
    const category = classifyCategory(
      line.subtotal,
      line.tax_collected,
      line.indian_status,
      standardHstRate
    );
    addToBucket(category, line);
    if (category === 'indian_status') indianStatusTransactions.push(line);
    else if (category === 'zero_tax') zeroTaxTransactions.push(line);
    else if (category === 'reduced_rate' || category === 'other') otherTransactions.push(line);
  }

  for (const line of bookingLines) {
    const category = classifyCategory(
      line.subtotal,
      line.tax_collected,
      line.indian_status,
      standardHstRate
    );
    addToBucket(category, line);
    if (category === 'indian_status') indianStatusTransactions.push(line);
    else if (category === 'zero_tax') zeroTaxTransactions.push(line);
    else if (category === 'reduced_rate' || category === 'other') otherTransactions.push(line);
  }

  const summary = Object.values(bucketTotals).filter((b) => b.transaction_count > 0);
  const totals = summary.reduce(
    (acc, b) => ({
      subtotal: round2(acc.subtotal + b.subtotal),
      tax_collected: round2(acc.tax_collected + b.tax_collected),
      expected_full_hst: round2(acc.expected_full_hst + b.expected_full_hst),
      hst_reduction: 0,
      transaction_count: acc.transaction_count + b.transaction_count,
    }),
    { subtotal: 0, tax_collected: 0, expected_full_hst: 0, hst_reduction: 0, transaction_count: 0 }
  );
  totals.hst_reduction = round2(totals.expected_full_hst - totals.tax_collected);

  const notes: string[] = [
    `Standard HST rate used for comparison: ${(standardHstRate * 100).toFixed(1)}%. Indian Status GST rate: ${(indianGstRate * 100).toFixed(1)}%.`,
    'HST reduction = tax that would apply at full HST minus tax actually collected. Supports CRA filing when Box 103 is lower than 13% × taxable sales.',
    `Period uses business timezone (${timezone}) and completed POS / booking payments, aligned with sales batch logic.`,
  ];

  const zeroTaxTotalCount = zeroTaxTransactions.length;
  const otherTotalCount = otherTransactions.length;

  return {
    standard_hst_rate: standardHstRate,
    indian_gst_rate: indianGstRate,
    summary,
    indian_status_transactions: indianStatusTransactions.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
    zero_tax_transactions: zeroTaxTransactions.slice(0, 250).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
    other_transactions: otherTransactions.slice(0, 100).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)),
    zero_tax_total_count: zeroTaxTotalCount,
    other_total_count: otherTotalCount,
    totals,
    notes,
  };
}

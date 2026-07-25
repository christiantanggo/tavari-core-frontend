import { supabase } from '../../supabaseClient';
import {
  applySaleStockAdjustments,
  applyRestockAdjustments,
} from '../../utils/posInventoryStock';
import { defaultDueDate, stockLinesFromInvoiceLines } from '../../utils/invoiceCalculations';
import { isInvoiceEditable, primaryInvoiceEmail } from '../../utils/invoiceEmailUtils';

const FILTER_STATUS_MAP = {
  all: null,
  draft: ['draft'],
  unpaid: ['sent', 'viewed', 'overdue'],
  paid: ['paid', 'refunded'],
  summary: null,
};

class InvoiceService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  requireBusinessId() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }
    return this.businessId;
  }

  async generateInvoiceNumber(maxRetries = 5) {
    const businessId = this.requireBusinessId();
    const businessShort = businessId.slice(-4).toUpperCase();

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const today = new Date();
      const dateStr = today.toISOString().slice(2, 10).replace(/-/g, '');
      const randomComponent = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const timestamp = Date.now().toString().slice(-4);
      const invoiceNumber = `INV-${businessShort}${dateStr}${timestamp}${randomComponent}`;

      const { data: existing, error } = await supabase
        .from('tavari_invoices')
        .select('id')
        .eq('business_id', businessId)
        .eq('invoice_number', invoiceNumber)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      if (!existing) return invoiceNumber;

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
      }
    }

    throw new Error('Could not generate a unique invoice number');
  }

  async listInvoices({ filter = 'all', limit = 100 } = {}) {
    const businessId = this.requireBusinessId();
    let query = supabase
      .from('tavari_invoices')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (filter === 'summary') {
      query = query.eq('invoice_type', 'summary');
    } else {
      const statuses = FILTER_STATUS_MAP[filter];
      if (statuses) query = query.in('status', statuses);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getDashboardStats() {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_invoices')
      .select('status, balance_due')
      .eq('business_id', businessId);

    if (error) throw error;
    const rows = data || [];
    return {
      total: rows.length,
      unpaid: rows.filter((r) =>
        ['sent', 'viewed', 'overdue', 'partially_paid'].includes(r.status)
      ).length,
      overdue: rows.filter((r) => r.status === 'overdue').length,
      paid: rows.filter((r) => r.status === 'paid').length,
    };
  }

  async getSettings() {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_invoice_settings')
      .select('*')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0] || null;
  }

  async upsertSettings(settings) {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_invoice_settings')
      .upsert({ ...settings, business_id: businessId }, { onConflict: 'business_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getBusinessProfile() {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('businesses')
      .select(
        'id, name, business_address, business_city, business_state, business_postal, business_phone, business_email, tax_number, timezone'
      )
      .eq('id', businessId)
      .single();
    if (error) throw error;

    const { data: branding } = await supabase
      .from('app_branding')
      .select('logo_url')
      .eq('business_id', businessId)
      .maybeSingle();

    return { ...data, logo_url: branding?.logo_url || null };
  }

  async getPosSettings() {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('pos_settings')
      .select('indian_status_gst_rate, indian_status_tax_label')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0] || {};
  }

  async searchCustomers(searchTerm, limit = 20) {
    const businessId = this.requireBusinessId();
    const pat = String(searchTerm || '').trim();
    if (!pat) return [];

    const { data, error } = await supabase
      .from('pos_loyalty_accounts')
      .select('id, customer_name, customer_email, customer_phone')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .or(
        `customer_name.ilike.%${pat}%,customer_email.ilike.%${pat}%,customer_phone.ilike.%${pat}%`
      )
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async searchInventory(searchTerm, limit = 30) {
    const businessId = this.requireBusinessId();
    const pat = String(searchTerm || '').trim();

    let query = supabase
      .from('pos_inventory')
      .select('id, name, price, category_id, is_bundle, track_stock, sku')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name')
      .limit(limit);

    if (pat) {
      query = query.or(`name.ilike.%${pat}%,sku.ilike.%${pat}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getInvoice(invoiceId) {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_invoices')
      .select(`
        *,
        tavari_invoice_line_items (*),
        tavari_invoice_source_links (*)
      `)
      .eq('business_id', businessId)
      .eq('id', invoiceId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async saveLineItems(invoiceId, lines = []) {
    const businessId = this.requireBusinessId();
    await supabase
      .from('tavari_invoice_line_items')
      .delete()
      .eq('invoice_id', invoiceId);

    if (!lines.length) return [];

    const rows = lines.map((line, index) => ({
      invoice_id: invoiceId,
      business_id: businessId,
      line_type: line.line_type || 'custom',
      inventory_id: line.inventory_id || null,
      source_pos_sale_id: line.source_pos_sale_id || null,
      source_pos_sale_item_id: line.source_pos_sale_item_id || null,
      source_booking_id: line.source_booking_id || null,
      participant_name: line.participant_name || null,
      name: line.name,
      description: line.description || null,
      quantity: Number(line.quantity) || 1,
      unit_price: Number(line.unit_price) || 0,
      total_price: Number(line.total_price) || Number(line.quantity) * Number(line.unit_price) || 0,
      tax_exempt: !!line.tax_exempt,
      tax_amount: Number(line.tax_amount) || 0,
      sort_order: index,
    }));

    const { data, error } = await supabase
      .from('tavari_invoice_line_items')
      .insert(rows)
      .select();
    if (error) throw error;
    return data || [];
  }

  async saveSourceLinks(invoiceId, links = []) {
    const businessId = this.requireBusinessId();
    await supabase
      .from('tavari_invoice_source_links')
      .delete()
      .eq('invoice_id', invoiceId);

    if (!links.length) return [];

    const rows = links.map((link) => ({
      invoice_id: invoiceId,
      business_id: businessId,
      source_type: link.source_type,
      source_id: link.source_id,
      display_label: link.display_label || null,
      amount: Number(link.amount) || 0,
      transaction_date: link.transaction_date || null,
      payment_method_summary: link.payment_method_summary || null,
    }));

    const { data, error } = await supabase.from('tavari_invoice_source_links').insert(rows).select();
    if (error) throw error;
    return data || [];
  }

  async createUnpaidPosSale(invoice, userId) {
    const businessId = this.requireBusinessId();
    const saleRecord = {
      business_id: businessId,
      user_id: userId,
      loyalty_customer_id: invoice.loyalty_customer_id || null,
      customer_name: invoice.recipient_name,
      customer_phone: invoice.recipient_phone || null,
      customer_email: invoice.recipient_email || null,
      subtotal: invoice.subtotal,
      tax: invoice.tax_amount,
      discount: 0,
      total: invoice.total,
      payment_status: 'unpaid',
      payment_method: 'invoice',
      sale_number: invoice.invoice_number,
      notes: `Invoice ${invoice.invoice_number}`,
      item_count: invoice.tavari_invoice_line_items?.length || 0,
    };

    const { data, error } = await supabase
      .from('pos_sales')
      .insert(saleRecord)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async reserveStockForInvoice(lines) {
    const businessId = this.requireBusinessId();
    const stockLines = stockLinesFromInvoiceLines(lines);
    if (!stockLines.length) return { applied: 0 };
    return applySaleStockAdjustments(supabase, businessId, stockLines);
  }

  async releaseStockForInvoice(lines) {
    const businessId = this.requireBusinessId();
    const stockLines = stockLinesFromInvoiceLines(lines);
    if (!stockLines.length) return { applied: 0 };
    return applyRestockAdjustments(supabase, businessId, stockLines);
  }

  async syncUnpaidPosSaleFromInvoice(invoice) {
    if (!invoice?.pos_sale_id) return;
    const balanceDue = Number(invoice.balance_due) || 0;
    if (balanceDue <= 0) return;

    await supabase
      .from('pos_sales')
      .update({
        subtotal: invoice.subtotal,
        tax: invoice.tax_amount,
        total: invoice.total,
        customer_name: invoice.recipient_name,
        customer_email: invoice.recipient_email,
        customer_phone: invoice.recipient_phone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoice.pos_sale_id)
      .eq('business_id', this.requireBusinessId());
  }

  async updateRecipientEmail(invoiceId, email) {
    const businessId = this.requireBusinessId();
    const normalized = primaryInvoiceEmail(email);
    const { data, error } = await supabase
      .from('tavari_invoices')
      .update({
        recipient_email: normalized,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .eq('business_id', businessId)
      .select()
      .single();
    if (error) throw error;

    if (data?.pos_sale_id) {
      await supabase
        .from('pos_sales')
        .update({ customer_email: normalized })
        .eq('id', data.pos_sale_id);
    }
    return data;
  }

  /**
   * Save draft or update existing invoice.
   */
  async saveInvoice(payload, { userId } = {}) {
    const businessId = this.requireBusinessId();
    const isNew = !payload.id;

    let prior = null;
    if (!isNew) {
      prior = await this.getInvoice(payload.id);
      if (!prior) throw new Error('Invoice not found');
      if (!isInvoiceEditable(prior.status)) {
        throw new Error('Paid, void, or refunded invoices cannot be edited');
      }
    }

    const invoiceNumber = isNew
      ? (payload.invoice_number || await this.generateInvoiceNumber())
      : (payload.invoice_number || prior?.invoice_number);

    if (!invoiceNumber) {
      throw new Error('Invoice number is required');
    }

    const resolvedStatus = isNew
      ? (payload.status || 'draft')
      : (prior?.status === 'draft' ? (payload.status || 'draft') : prior.status);

    const row = {
      business_id: businessId,
      invoice_number: invoiceNumber,
      invoice_type: payload.invoice_type || 'standard',
      status: resolvedStatus,
      recipient_type: payload.recipient_type || 'customer',
      loyalty_customer_id: payload.loyalty_customer_id || null,
      recipient_name: payload.recipient_name,
      recipient_email: primaryInvoiceEmail(payload.recipient_email) || null,
      recipient_phone: payload.recipient_phone || null,
      recipient_company: payload.recipient_company || null,
      recipient_address: payload.recipient_address || null,
      recipient_city: payload.recipient_city || null,
      recipient_state: payload.recipient_state || null,
      recipient_postal: payload.recipient_postal || null,
      display_legal_name: payload.display_legal_name || null,
      display_dba: payload.display_dba || null,
      display_address: payload.display_address || null,
      display_city: payload.display_city || null,
      display_state: payload.display_state || null,
      display_postal: payload.display_postal || null,
      display_tax_number: payload.display_tax_number || null,
      logo_url: payload.logo_url || null,
      notes: payload.notes || null,
      footer_terms: payload.footer_terms || null,
      due_date: payload.due_date || null,
      subtotal: payload.subtotal || 0,
      tax_amount: payload.tax_amount || 0,
      total: payload.total || 0,
      balance_due: payload.balance_due ?? payload.total ?? 0,
      indian_status_gst_only: !!payload.indian_status_gst_only,
      indian_status_certificate_number: payload.indian_status_certificate_number || null,
    };

    if (isNew) {
      row.created_by = userId || null;
    }

    let invoice;
    if (isNew) {
      const { data, error } = await supabase
        .from('tavari_invoices')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      invoice = data;
    } else {
      const { data, error } = await supabase
        .from('tavari_invoices')
        .update(row)
        .eq('id', payload.id)
        .eq('business_id', businessId)
        .select()
        .single();
      if (error) throw error;
      invoice = data;
    }

    if (
      prior?.stock_reserved &&
      prior.invoice_type !== 'summary' &&
      payload.invoice_type !== 'summary'
    ) {
      const oldLines = prior.tavari_invoice_line_items || [];
      await this.releaseStockForInvoice(oldLines);
      await this.reserveStockForInvoice(payload.lines || []);
    }

    await this.saveLineItems(invoice.id, payload.lines || []);
    if (payload.source_links?.length) {
      await this.saveSourceLinks(invoice.id, payload.source_links);
    }

    const saved = await this.getInvoice(invoice.id);
    if (saved?.pos_sale_id && isInvoiceEditable(saved.status) && Number(saved.balance_due) > 0) {
      await this.syncUnpaidPosSaleFromInvoice(saved);
    }

    return saved;
  }

  async sendInvoice(invoiceId, { userId } = {}) {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    const lines = invoice.tavari_invoice_line_items || [];
    const isSummary = invoice.invoice_type === 'summary';
    const balanceDue = Number(invoice.balance_due) || 0;

    if (!isSummary && !invoice.stock_reserved) {
      await this.reserveStockForInvoice(lines);
    }

    let posSaleId = invoice.pos_sale_id;
    if (!isSummary && balanceDue > 0 && !posSaleId && userId) {
      const sale = await this.createUnpaidPosSale(invoice, userId);
      posSaleId = sale.id;
    }

    const payToken =
      balanceDue > 0
        ? invoice.pay_token || crypto.randomUUID?.() || `${invoiceId}-${Date.now()}`
        : invoice.pay_token;

    const emailTrackingToken =
      invoice.email_tracking_token || crypto.randomUUID?.() || `${invoiceId}-track-${Date.now()}`;

    const { data, error } = await supabase
      .from('tavari_invoices')
      .update({
        status: balanceDue > 0 ? 'sent' : 'paid',
        stock_reserved: !isSummary ? true : invoice.stock_reserved,
        pos_sale_id: posSaleId,
        pay_token: payToken,
        email_tracking_token: emailTrackingToken,
        first_sent_at: invoice.first_sent_at || new Date().toISOString(),
        last_sent_at: new Date().toISOString(),
        balance_due: balanceDue,
      })
      .eq('id', invoiceId)
      .eq('business_id', this.requireBusinessId())
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async voidInvoice(invoiceId, { userId, reason } = {}) {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'void') return invoice;

    const lines = invoice.tavari_invoice_line_items || [];
    if (invoice.stock_reserved) {
      await this.releaseStockForInvoice(lines);
    }

    const { data, error } = await supabase
      .from('tavari_invoices')
      .update({
        status: 'void',
        balance_due: 0,
        voided_at: new Date().toISOString(),
        voided_by: userId || null,
        void_reason: reason || null,
        stock_released_at: new Date().toISOString(),
        stock_reserved: false,
      })
      .eq('id', invoiceId)
      .eq('business_id', this.requireBusinessId())
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async invokePostPaymentHooks(invoiceId) {
    try {
      const { error } = await supabase.functions.invoke('invoice-on-paid', {
        body: { invoice_id: invoiceId },
      });
      if (error) console.warn('[invoiceService] post-payment hooks:', error);
    } catch (err) {
      console.warn('[invoiceService] post-payment hooks failed:', err);
    }
  }

  async reissueInvoice(voidedInvoiceId, { userId } = {}) {
    const source = await this.getInvoice(voidedInvoiceId);
    if (!source) throw new Error('Invoice not found');
    if (source.status !== 'void') throw new Error('Only voided invoices can be re-issued');

    const businessId = this.requireBusinessId();
    const invoiceNumber = await this.generateInvoiceNumber();

    const { data: newInvoice, error } = await supabase
      .from('tavari_invoices')
      .insert({
        business_id: businessId,
        invoice_number: invoiceNumber,
        invoice_type: source.invoice_type,
        status: 'draft',
        recipient_type: source.recipient_type,
        loyalty_customer_id: source.loyalty_customer_id,
        recipient_name: source.recipient_name,
        recipient_email: source.recipient_email,
        recipient_phone: source.recipient_phone,
        recipient_company: source.recipient_company,
        recipient_address: source.recipient_address,
        recipient_city: source.recipient_city,
        recipient_state: source.recipient_state,
        recipient_postal: source.recipient_postal,
        display_legal_name: source.display_legal_name,
        display_dba: source.display_dba,
        display_address: source.display_address,
        display_city: source.display_city,
        display_state: source.display_state,
        display_postal: source.display_postal,
        display_tax_number: source.display_tax_number,
        logo_url: source.logo_url,
        notes: source.notes,
        footer_terms: source.footer_terms,
        due_date: source.due_date || defaultDueDate(),
        subtotal: source.subtotal,
        tax_amount: source.tax_amount,
        total: source.total,
        balance_due: source.total,
        indian_status_gst_only: source.indian_status_gst_only,
        indian_status_certificate_number: source.indian_status_certificate_number,
        reissued_from_invoice_id: voidedInvoiceId,
        created_by: userId || null,
      })
      .select()
      .single();

    if (error) throw error;

    const lines = (source.tavari_invoice_line_items || []).map((line) => ({
      line_type: line.line_type,
      inventory_id: line.inventory_id,
      source_pos_sale_id: line.source_pos_sale_id,
      source_pos_sale_item_id: line.source_pos_sale_item_id,
      source_booking_id: line.source_booking_id,
      participant_name: line.participant_name,
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      total_price: line.total_price,
      tax_exempt: line.tax_exempt,
      tax_amount: line.tax_amount,
    }));
    await this.saveLineItems(newInvoice.id, lines);

    if (source.invoice_type === 'summary') {
      await supabase
        .from('tavari_invoice_source_links')
        .update({ invoice_id: newInvoice.id })
        .eq('invoice_id', voidedInvoiceId)
        .eq('business_id', businessId);
    }

    return this.getInvoice(newInvoice.id);
  }

  async markPaid(invoiceId, { userId, paymentMethod = 'manual', referenceNumber = null } = {}) {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error('Invoice not found');

    let posSaleId = invoice.pos_sale_id;
    if (!posSaleId && userId) {
      const sale = await this.createUnpaidPosSale(invoice, userId);
      posSaleId = sale.id;
      const paidAt = new Date().toISOString();
      await supabase
        .from('pos_sales')
        .update({
          payment_status: 'completed',
          payment_method: paymentMethod,
          created_at: paidAt,
          updated_at: paidAt,
        })
        .eq('id', posSaleId);
    } else if (posSaleId) {
      const paidAt = new Date().toISOString();
      await supabase
        .from('pos_sales')
        .update({
          payment_status: 'completed',
          payment_method: paymentMethod,
          created_at: paidAt,
          updated_at: paidAt,
        })
        .eq('id', posSaleId);
    }

    if (posSaleId) {
      await supabase.from('pos_payments').insert({
        business_id: this.requireBusinessId(),
        sale_id: posSaleId,
        payment_method: paymentMethod === 'helcim' ? 'helcim_terminal' : paymentMethod,
        amount: invoice.total,
        reference_number: referenceNumber,
        custom_method_name: paymentMethod === 'custom' ? 'Invoice payment' : null,
      });
    }

    const { data, error } = await supabase
      .from('tavari_invoices')
      .update({
        status: 'paid',
        balance_due: 0,
        pos_sale_id: posSaleId,
      })
      .eq('id', invoiceId)
      .eq('business_id', this.requireBusinessId())
      .select()
      .single();

    if (error) throw error;
    await this.invokePostPaymentHooks(invoiceId);
    return data;
  }

  /**
   * Paid POS sales + paid bookings for summary invoice picker.
   * Excludes sources already linked to another invoice.
   */
  async getEligibleSummarySources({ customerId, dateFrom, dateTo } = {}) {
    const businessId = this.requireBusinessId();

    const { data: linked } = await supabase
      .from('tavari_invoice_source_links')
      .select('source_type, source_id')
      .eq('business_id', businessId);

    const linkedSaleIds = new Set(
      (linked || []).filter((l) => l.source_type === 'pos_sale').map((l) => l.source_id)
    );
    const linkedBookingIds = new Set(
      (linked || []).filter((l) => l.source_type === 'booking').map((l) => l.source_id)
    );

    let salesQuery = supabase
      .from('pos_sales')
      .select(`
        id, sale_number, total, subtotal, tax, created_at, payment_status, payment_method,
        pos_sale_items ( id, name, quantity, unit_price, total_price, inventory_id ),
        pos_payments ( payment_method, amount, custom_method_name )
      `)
      .eq('business_id', businessId)
      .in('payment_status', ['completed', 'paid'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (customerId) salesQuery = salesQuery.eq('loyalty_customer_id', customerId);
    if (dateFrom) salesQuery = salesQuery.gte('created_at', `${dateFrom}T00:00:00`);
    if (dateTo) salesQuery = salesQuery.lte('created_at', `${dateTo}T23:59:59`);

    const { data: sales, error: salesError } = await salesQuery;
    if (salesError) throw salesError;

    let bookingsQuery = supabase
      .from('bookings')
      .select(`
        id, booking_number, booking_date, total_amount, payment_status, customer_id,
        booking_activities ( activity_name ),
        booking_participants ( id, first_name, last_name, is_minor ),
        booking_payments ( id, amount, payment_method, status, created_at, sale_id )
      `)
      .eq('business_id', businessId)
      .in('payment_status', ['paid', 'partial'])
      .order('booking_date', { ascending: false })
      .limit(200);

    if (customerId) bookingsQuery = bookingsQuery.eq('customer_id', customerId);
    if (dateFrom) bookingsQuery = bookingsQuery.gte('booking_date', dateFrom);
    if (dateTo) bookingsQuery = bookingsQuery.lte('booking_date', dateTo);

    const { data: bookings, error: bookingsError } = await bookingsQuery;
    if (bookingsError) throw bookingsError;

    const bookingSaleIds = new Set(
      (bookings || [])
        .flatMap((b) => (b.booking_payments || []).map((p) => p.sale_id).filter(Boolean))
    );

    const receiptSources = (sales || [])
      .filter((s) => !s.sale_number?.startsWith('BK-'))
      .filter((s) => !linkedSaleIds.has(s.id))
      .filter((s) => !bookingSaleIds.has(s.id))
      .map((s) => ({
        source_type: 'pos_sale',
        source_id: s.id,
        label: `Receipt ${s.sale_number}`,
        amount: s.total,
        date: s.created_at,
        payment_methods: (s.pos_payments || []).map(
          (p) => p.custom_method_name || p.payment_method
        ),
        line_items: s.pos_sale_items || [],
      }));

    const bookingSources = (bookings || [])
      .filter((b) => !linkedBookingIds.has(b.id))
      .map((b) => {
        const participant =
          (b.booking_participants || []).find((p) => p.is_minor) ||
          (b.booking_participants || [])[0];
        const participantName = participant
          ? `${participant.first_name || ''} ${participant.last_name || ''}`.trim()
          : null;
        const paidAmount = (b.booking_payments || [])
          .filter((p) => p.status !== 'refunded')
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);
        return {
          source_type: 'booking',
          source_id: b.id,
          label: `Booking ${b.booking_number} — ${b.booking_activities?.activity_name || 'Booking'}`,
          amount: paidAmount || b.total_amount,
          date: b.booking_date,
          participant_name: participantName,
          payment_methods: (b.booking_payments || []).map((p) => p.payment_method),
          booking: b,
        };
      });

    return { receipts: receiptSources, bookings: bookingSources };
  }

  async getReminderHistory(invoiceId) {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_invoice_reminder_log')
      .select('*')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .order('sent_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async processRefund(invoiceId, { userId, amount, reason, isFull = false } = {}) {
    const businessId = this.requireBusinessId();
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error('Invoice not found');
    if (!invoice.pos_sale_id) {
      throw new Error('Invoice has no linked sale — mark paid before refunding');
    }

    const refundAmount = Number(amount) || 0;
    if (refundAmount <= 0) throw new Error('Invalid refund amount');

    const refundData = {
      business_id: businessId,
      original_sale_id: invoice.pos_sale_id,
      refunded_by: userId,
      refund_type: 'manual',
      refund_method: 'invoice_refund',
      total_refund_amount: refundAmount,
      reason,
      manager_override: true,
      manager_id: userId,
    };

    const { data: refund, error: refundError } = await supabase
      .from('pos_refunds')
      .insert(refundData)
      .select()
      .single();

    if (refundError) throw refundError;

    await supabase.from('tavari_invoice_refunds').insert({
      invoice_id: invoiceId,
      business_id: businessId,
      pos_refund_id: refund.id,
      refund_amount: refundAmount,
      refund_reason: reason,
      refunded_by: userId,
    });

    const newBalance = Math.max(0, Number(invoice.balance_due) - refundAmount);
    const newStatus = isFull || newBalance <= 0.01 ? 'refunded' : 'partially_paid';

    const { data, error } = await supabase
      .from('tavari_invoices')
      .update({
        status: newStatus,
        balance_due: isFull ? 0 : newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export default new InvoiceService();

import { supabase } from '../../supabaseClient';
import { primaryInvoiceEmail } from '../../utils/invoiceEmailUtils';
import { firstMonthlyRunDate, nextMonthlyRunDate } from '../../utils/invoiceRecurringSchedule';
import invoiceService from './invoiceService';
import { sendInvoiceEmail } from './invoiceEmailService';

class RecurringInvoiceService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
    invoiceService.setBusinessId(businessId);
  }

  requireBusinessId() {
    if (!this.businessId) throw new Error('Business ID is required');
    return this.businessId;
  }

  async listTemplates({ status } = {}) {
    const businessId = this.requireBusinessId();
    let query = supabase
      .from('tavari_recurring_invoices')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getTemplate(templateId) {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_recurring_invoices')
      .select(`
        *,
        tavari_recurring_invoice_line_items (*)
      `)
      .eq('business_id', businessId)
      .eq('id', templateId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async saveLineItems(templateId, lines = []) {
    const businessId = this.requireBusinessId();
    await supabase
      .from('tavari_recurring_invoice_line_items')
      .delete()
      .eq('recurring_template_id', templateId);

    if (!lines.length) return [];

    const rows = lines.map((line, index) => ({
      recurring_template_id: templateId,
      business_id: businessId,
      line_type: line.line_type || 'custom',
      inventory_id: line.inventory_id || null,
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
      .from('tavari_recurring_invoice_line_items')
      .insert(rows)
      .select();
    if (error) throw error;
    return data || [];
  }

  async saveTemplate(payload, { userId } = {}) {
    const businessId = this.requireBusinessId();
    const isNew = !payload.id;
    const dayOfMonth = Math.min(28, Math.max(1, Number(payload.schedule_day_of_month) || 1));
    const startsOn = payload.starts_on || new Date().toISOString().slice(0, 10);

    let prior = null;
    if (!isNew) {
      prior = await this.getTemplate(payload.id);
      if (!prior) throw new Error('Recurring invoice not found');
    }

    const nextRunDate = isNew
      ? firstMonthlyRunDate(startsOn, dayOfMonth)
      : prior.next_run_date;

    const row = {
      business_id: businessId,
      name: payload.name?.trim() || payload.recipient_name,
      status: payload.status || prior?.status || 'active',
      frequency: 'monthly',
      schedule_day_of_month: dayOfMonth,
      starts_on: startsOn,
      ends_on: payload.ends_on || null,
      max_occurrences: payload.max_occurrences ? Number(payload.max_occurrences) : null,
      next_run_date: nextRunDate,
      auto_send: payload.auto_send !== false,
      due_days_override:
        payload.due_days_override != null && payload.due_days_override !== ''
          ? Number(payload.due_days_override)
          : null,
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
      subtotal: payload.subtotal || 0,
      tax_amount: payload.tax_amount || 0,
      total: payload.total || 0,
      indian_status_gst_only: !!payload.indian_status_gst_only,
      indian_status_certificate_number: payload.indian_status_certificate_number || null,
    };

    if (isNew) {
      row.created_by = userId || null;
    }

    let template;
    if (isNew) {
      const { data, error } = await supabase
        .from('tavari_recurring_invoices')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      template = data;
    } else {
      const { data, error } = await supabase
        .from('tavari_recurring_invoices')
        .update(row)
        .eq('id', payload.id)
        .eq('business_id', businessId)
        .select()
        .single();
      if (error) throw error;
      template = data;
    }

    await this.saveLineItems(template.id, payload.lines || []);
    return this.getTemplate(template.id);
  }

  async setStatus(templateId, status) {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_recurring_invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', templateId)
      .eq('business_id', businessId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getRunHistory(templateId, limit = 20) {
    const businessId = this.requireBusinessId();
    const { data, error } = await supabase
      .from('tavari_recurring_invoice_runs')
      .select(`
        id, planned_date, created_at, invoice_id,
        tavari_invoices (id, invoice_number, status, total)
      `)
      .eq('recurring_template_id', templateId)
      .eq('business_id', businessId)
      .order('planned_date', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  /**
   * Manually generate the next invoice from a template (same as cron would).
   */
  async generateNow(templateId, { userId } = {}) {
    const businessId = this.requireBusinessId();
    const template = await this.getTemplate(templateId);
    if (!template) throw new Error('Recurring invoice not found');
    if (template.status === 'ended') throw new Error('This recurring invoice has ended');

    const plannedDate = template.next_run_date;

    const { data: existingRun } = await supabase
      .from('tavari_recurring_invoice_runs')
      .select('invoice_id')
      .eq('recurring_template_id', templateId)
      .eq('planned_date', plannedDate)
      .maybeSingle();

    if (existingRun?.invoice_id) {
      return invoiceService.getInvoice(existingRun.invoice_id);
    }

    const invoice = await this.createInvoiceFromTemplate(template, plannedDate, { userId });

    const newOccurrences = (template.occurrences_sent || 0) + 1;
    const nextRun = nextMonthlyRunDate(plannedDate, template.schedule_day_of_month);
    const ended =
      (template.max_occurrences != null && newOccurrences >= template.max_occurrences) ||
      (template.ends_on && nextRun > template.ends_on);

    await supabase.from('tavari_recurring_invoice_runs').insert({
      recurring_template_id: templateId,
      business_id: businessId,
      planned_date: plannedDate,
      invoice_id: invoice.id,
    });

    await supabase
      .from('tavari_recurring_invoices')
      .update({
        occurrences_sent: newOccurrences,
        next_run_date: nextRun,
        status: ended ? 'ended' : template.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', templateId);

    return invoice;
  }

  async createInvoiceFromTemplate(template, plannedDate, { userId } = {}) {
    const businessId = this.requireBusinessId();
    const settings = await invoiceService.getSettings();
    const dueDays =
      template.due_days_override != null
        ? template.due_days_override
        : Number(settings?.default_due_days) || 0;

    const dueDate = (() => {
      const d = new Date(`${plannedDate}T12:00:00`);
      d.setDate(d.getDate() + dueDays);
      return d.toISOString().slice(0, 10);
    })();

    const invoiceNumber = await invoiceService.generateInvoiceNumber();
    const lines = (template.tavari_recurring_invoice_line_items || []).map((line) => ({
      line_type: line.line_type,
      inventory_id: line.inventory_id,
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      total_price: line.total_price,
      tax_exempt: line.tax_exempt,
      tax_amount: line.tax_amount,
    }));

    const saved = await invoiceService.saveInvoice(
      {
        invoice_number: invoiceNumber,
        invoice_type: 'standard',
        status: 'draft',
        recipient_type: template.recipient_type,
        loyalty_customer_id: template.loyalty_customer_id,
        recipient_name: template.recipient_name,
        recipient_email: template.recipient_email,
        recipient_phone: template.recipient_phone,
        recipient_company: template.recipient_company,
        recipient_address: template.recipient_address,
        recipient_city: template.recipient_city,
        recipient_state: template.recipient_state,
        recipient_postal: template.recipient_postal,
        display_legal_name: template.display_legal_name,
        display_dba: template.display_dba,
        display_address: template.display_address,
        display_city: template.display_city,
        display_state: template.display_state,
        display_postal: template.display_postal,
        display_tax_number: template.display_tax_number,
        logo_url: template.logo_url,
        notes: template.notes,
        footer_terms: template.footer_terms,
        due_date: dueDate,
        subtotal: template.subtotal,
        tax_amount: template.tax_amount,
        total: template.total,
        balance_due: template.total,
        indian_status_gst_only: template.indian_status_gst_only,
        indian_status_certificate_number: template.indian_status_certificate_number,
        lines,
      },
      { userId: userId || template.created_by }
    );

    await supabase
      .from('tavari_invoices')
      .update({ recurring_template_id: template.id })
      .eq('id', saved.id);

    if (template.auto_send) {
      await invoiceService.sendInvoice(saved.id, { userId: userId || template.created_by });
      await sendInvoiceEmail(saved.id, businessId);
    }

    return invoiceService.getInvoice(saved.id);
  }
}

const recurringInvoiceService = new RecurringInvoiceService();
export default recurringInvoiceService;

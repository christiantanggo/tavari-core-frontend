import { supabase } from '../../supabaseClient';
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from '../../constants/bookingMail';
import { generateInvoiceHTML, buildBusinessDisplay } from '../../utils/InvoiceBuilder';
import { getInvoicePdfBlob } from '../../utils/invoicePdf';
import invoiceService from './invoiceService';
import { parseInvoiceEmailList, primaryInvoiceEmail } from '../../utils/invoiceEmailUtils';

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function resolveMailSender(businessId, businessName) {
  const { data, error } = await supabase
    .from('mail_settings')
    .select('from_email, from_name')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('[invoiceEmail] mail_settings lookup failed:', error);
  }

  const row = data?.[0];
  return {
    fromEmail: row?.from_email?.trim() || BOOKING_TRANSACTIONAL_FROM_EMAIL,
    fromName: row?.from_name?.trim() || businessName || 'Tavari',
  };
}

async function deliverInvoiceEmail({
  invoice,
  business,
  settings,
  businessId,
  recipients,
  subject,
  includePayLink = true,
  pdfFilenameSuffix = '',
}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const display = buildBusinessDisplay(invoice, business, settings);
  const payUrl =
    includePayLink && Number(invoice.balance_due) > 0 && invoice.pay_token
      ? `${window.location.origin}/pay/invoice/${invoice.pay_token}?src=email`
      : null;
  const trackingPixelUrl =
    includePayLink && invoice.email_tracking_token
      ? `${supabaseUrl}/functions/v1/invoice-track?token=${encodeURIComponent(invoice.email_tracking_token)}&event=open`
      : null;

  const html = generateInvoiceHTML(invoice, display, { payUrl, trackingPixelUrl });
  const { fromEmail, fromName } = await resolveMailSender(businessId, business?.name);

  let attachments;
  const pdfName = `Invoice-${invoice.invoice_number}${pdfFilenameSuffix}.pdf`;
  try {
    const pdfBlob = await getInvoicePdfBlob(html, { filename: pdfName });
    const pdfBase64 = await blobToBase64(pdfBlob);
    attachments = [{
      filename: pdfName,
      content: pdfBase64,
      contentType: 'application/pdf',
    }];
  } catch (pdfErr) {
    console.warn('[invoiceEmail] PDF attachment skipped:', pdfErr);
  }

  const failures = [];
  const sentTo = [];

  for (const recipient of recipients) {
    const payload = {
      businessId,
      emailType: 'transactional',
      to: recipient,
      fromEmail,
      fromName,
      subject,
      html,
      sourceModule: 'invoices',
      sourceId: invoice.id,
      attachments,
    };

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'Failed to send invoice email');
      }

      const result = await response.json();
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to send invoice email');
      }

      sentTo.push(recipient);
    } catch (err) {
      failures.push({ recipient, error: err.message || 'Send failed' });
      console.warn('[invoiceEmail] failed for', recipient, err);
    }
  }

  if (!sentTo.length) {
    throw new Error(
      failures[0]?.error || 'Failed to send invoice email to any recipient'
    );
  }

  if (failures.length) {
    console.warn('[invoiceEmail] partial send failures:', failures);
  }

  return { ok: true, recipients: sentTo, failures };
}

/**
 * Email an invoice PDF + HTML body via mail-send (transactional).
 * Call after invoiceService.sendInvoice() so pay/tracking tokens exist.
 *
 * @param {string} invoiceId
 * @param {string} businessId
 * @param {{ recipients?: string[], updatePrimaryEmail?: boolean }} [options]
 */
export async function sendInvoiceEmail(invoiceId, businessId, options = {}) {
  const { recipients: explicitRecipients, updatePrimaryEmail = true } = options;
  invoiceService.setBusinessId(businessId);

  let [invoice, business, settings] = await Promise.all([
    invoiceService.getInvoice(invoiceId),
    invoiceService.getBusinessProfile(),
    invoiceService.getSettings(),
  ]);

  if (!invoice) throw new Error('Invoice not found');

  const recipients = explicitRecipients?.length
    ? parseInvoiceEmailList(explicitRecipients.join(','))
    : parseInvoiceEmailList(invoice.recipient_email);

  if (!recipients.length) {
    throw new Error('Enter at least one valid email address');
  }

  if (updatePrimaryEmail && recipients[0] !== String(invoice.recipient_email || '').trim().toLowerCase()) {
    await invoiceService.updateRecipientEmail(invoiceId, recipients[0]);
    invoice = { ...invoice, recipient_email: recipients[0] };
  }

  const subject = `${business?.name || 'Invoice'} Invoice #${invoice.invoice_number}`;
  return deliverInvoiceEmail({
    invoice,
    business,
    settings,
    businessId,
    recipients,
    subject,
    includePayLink: true,
  });
}

/**
 * Email a paid receipt (PDF + "Paid in full" banner). Invoice must already be paid.
 *
 * @param {string} invoiceId
 * @param {string} businessId
 * @param {{ recipients?: string[] }} [options]
 */
export async function sendPaidReceiptEmail(invoiceId, businessId, options = {}) {
  const { recipients: explicitRecipients } = options;
  invoiceService.setBusinessId(businessId);

  const [invoice, business, settings] = await Promise.all([
    invoiceService.getInvoice(invoiceId),
    invoiceService.getBusinessProfile(),
    invoiceService.getSettings(),
  ]);

  if (!invoice) throw new Error('Invoice not found');

  const balanceDue = Number(invoice.balance_due) || 0;
  if (balanceDue > 0.01 || !['paid', 'refunded'].includes(invoice.status)) {
    throw new Error('Invoice must be paid before sending a receipt');
  }

  const recipients = explicitRecipients?.length
    ? parseInvoiceEmailList(explicitRecipients.join(','))
    : parseInvoiceEmailList(invoice.recipient_email);

  if (!recipients.length) {
    throw new Error('Enter at least one valid email address');
  }

  const paidInvoice = {
    ...invoice,
    balance_due: 0,
    status: 'paid',
  };

  const subject = `${business?.name || 'Invoice'} Paid receipt — Invoice #${invoice.invoice_number}`;
  return deliverInvoiceEmail({
    invoice: paidInvoice,
    business,
    settings,
    businessId,
    recipients,
    subject,
    includePayLink: false,
    pdfFilenameSuffix: '-paid',
  });
}

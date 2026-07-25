import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiDownload, FiMail, FiPrinter, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import bookingService from '../../services/Bookings/BookingService';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateTimeForBusiness } from '../../utils/businessDateFormat';
import { downloadHtmlDocumentPdf, getHtmlDocumentPdfBlob } from '../../utils/htmlDocumentPdf';
import { printHtmlInNewWindow } from '../../utils/printCamperRegistrationHtml';
import {
  BOOKING_TERMS_DIGITAL_SIGNATURE_ACK,
  BOOKING_TERMS_SIGNING_CONFIRMATION,
  BOOKING_TERMS_PAGE_MARGIN_IN,
  buildBookingTermsDocumentHtml,
  fitBookingTermsHtmlToPages,
} from '../../helpers/Bookings/bookingTermsDocument';

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const cardStyle = {
  backgroundColor: 'white',
  padding: '20px',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
};

const actionBtn = (variant = 'default', disabled = false) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: variant === 'primary' ? 'none' : '1px solid #d1d5db',
  borderRadius: 8,
  padding: '10px 14px',
  backgroundColor: disabled
    ? '#e5e7eb'
    : variant === 'primary'
      ? TavariStyles.colors.primary
      : '#fff',
  color: disabled ? '#9ca3af' : variant === 'primary' ? '#fff' : TavariStyles.colors.gray700,
  fontWeight: 600,
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

/**
 * Staff booking detail tab: view signed T&Cs, acknowledgments, signature; print / PDF / email.
 */
export default function BookingTermsTab({
  booking,
  businessId,
  businessTimezone,
}) {
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [customEmail, setCustomEmail] = useState('');
  const [showCustomEmail, setShowCustomEmail] = useState(false);

  const load = useCallback(async () => {
    if (!businessId || !booking?.id) return;
    setLoading(true);
    try {
      bookingService.setBusinessId(businessId);
      const data = await bookingService.getBookingTermsReview(booking.id);
      setReview(data);
    } catch (err) {
      console.error(err);
      toast.error(err?.message || 'Could not load Terms & Conditions');
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [businessId, booking?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo(() => {
    if (!review) return [];
    const ackByStepId = new Map(
      (review.acknowledgments || []).map((row) => [String(row.step_id), row]),
    );
    const steps = review.steps || [];

    if (review.isSigned && (review.acknowledgments || []).length > 0) {
      return (review.acknowledgments || []).map((ack) => {
        const live = steps.find((step) => String(step.id) === String(ack.step_id));
        return {
          id: ack.step_id,
          title: ack.step_title_snapshot || live?.title || 'Section',
          body: ack.step_body_snapshot || live?.body || '',
          require_acknowledge: true,
          acknowledged_at: ack.acknowledged_at,
          acknowledgedAtLabel: ack.acknowledged_at
            ? formatDateTimeForBusiness(ack.acknowledged_at, businessTimezone)
            : null,
        };
      });
    }

    return steps.map((step) => {
      const ack = ackByStepId.get(String(step.id));
      return {
        id: step.id,
        title: step.title,
        body: step.body,
        require_acknowledge: step.require_acknowledge !== false,
        acknowledged_at: ack?.acknowledged_at || null,
        acknowledgedAtLabel: ack?.acknowledged_at
          ? formatDateTimeForBusiness(ack.acknowledged_at, businessTimezone)
          : null,
      };
    });
  }, [review, businessTimezone]);

  const signatureImageUrl = useMemo(() => {
    const data = review?.booking?.terms_signature_data;
    if (!data || typeof data !== 'object') return '';
    return String(data.imageUrl || data.image_url || '').trim();
  }, [review]);

  const signedAtLabel = useMemo(() => {
    const at = review?.booking?.terms_signed_at;
    if (!at) return '';
    return formatDateTimeForBusiness(at, businessTimezone);
  }, [review, businessTimezone]);

  const documentModel = useMemo(() => {
    if (!review) return null;
    const activityName = review.booking?.booking_activities?.activity_name
      || booking?.booking_activities?.activity_name
      || '';
    return {
      businessName: review.businessName || '',
      packageName: review.package?.name || 'Terms & Conditions',
      packageDescription: review.package?.description || '',
      bookingNumber: review.booking?.booking_number || booking?.booking_number || '',
      activityName,
      sections,
      isSigned: Boolean(review.isSigned),
      signerName: review.booking?.terms_signer_name || '',
      signedAtLabel,
      signatureImageUrl,
      signedIp: review.booking?.terms_signed_ip || '',
    };
  }, [review, booking, sections, signedAtLabel, signatureImageUrl]);

  const documentHtml = useMemo(
    () => (documentModel ? buildBookingTermsDocumentHtml(documentModel) : ''),
    [documentModel],
  );

  const pdfFilename = useMemo(() => {
    const number = String(booking?.booking_number || 'booking').slice(0, 24);
    const date = review?.booking?.terms_signed_at
      ? String(review.booking.terms_signed_at).slice(0, 10)
      : 'unsigned';
    return `Terms-and-Conditions-${number}-${date}.pdf`;
  }, [booking?.booking_number, review]);

  const getPrintReadyHtml = useCallback(async () => {
    if (!documentHtml) return '';
    return fitBookingTermsHtmlToPages(documentHtml, {
      maxPages: 2,
      marginInches: BOOKING_TERMS_PAGE_MARGIN_IN,
    });
  }, [documentHtml]);

  const handlePrint = useCallback(async () => {
    if (!documentHtml) return;
    setBusyAction('print');
    try {
      const fitted = await getPrintReadyHtml();
      printHtmlInNewWindow(fitted);
    } catch (err) {
      toast.error(err?.message || 'Could not prepare print layout');
    } finally {
      setBusyAction(null);
    }
  }, [documentHtml, getPrintReadyHtml]);

  const handlePdf = useCallback(async () => {
    if (!documentHtml) return;
    setBusyAction('pdf');
    try {
      const fitted = await getPrintReadyHtml();
      await downloadHtmlDocumentPdf(fitted, pdfFilename, {
        preset: 'bookingTerms',
        margin: {
          top: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
          right: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
          bottom: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
          left: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
        },
      });
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error(err?.message || 'Could not create PDF');
    } finally {
      setBusyAction(null);
    }
  }, [documentHtml, pdfFilename, getPrintReadyHtml]);

  const sendEmail = useCallback(async ({ sendToCustomer, recipientEmail }) => {
    if (!businessId || !booking?.id) return;
    setBusyAction(sendToCustomer ? 'email-customer' : 'email-custom');
    try {
      let pdfAttachment = null;
      if (documentHtml) {
        try {
          const fitted = await getPrintReadyHtml();
          const blob = await getHtmlDocumentPdfBlob(fitted, {
            preset: 'bookingTerms',
            margin: {
              top: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
              right: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
              bottom: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
              left: `${BOOKING_TERMS_PAGE_MARGIN_IN}in`,
            },
          });
          const content = await blobToBase64(blob);
          pdfAttachment = {
            filename: pdfFilename,
            content,
            contentType: 'application/pdf',
          };
        } catch (pdfErr) {
          console.warn('[BookingTermsTab] PDF attachment skipped:', pdfErr);
        }
      }

      const { data, error } = await supabase.functions.invoke('send-booking-terms-document', {
        body: {
          businessId,
          bookingId: booking.id,
          sendToCustomer,
          recipientEmail: sendToCustomer ? undefined : recipientEmail,
          attachment: pdfAttachment,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const to = data?.to || recipientEmail || booking.customer_email;
      const cc = data?.cc ? ` (CC ${data.cc})` : '';
      toast.success(`Terms document emailed to ${to}${cc}`);
      if (!sendToCustomer) {
        setCustomEmail('');
        setShowCustomEmail(false);
      }
    } catch (err) {
      toast.error(err?.message || 'Could not send email');
    } finally {
      setBusyAction(null);
    }
  }, [businessId, booking, documentHtml, pdfFilename, getPrintReadyHtml]);

  const handleEmailCustomer = useCallback(async () => {
    const primary = String(booking?.customer_email || '').trim();
    const secondary = String(booking?.secondary_customer_email || '').trim();
    if (!primary && !secondary) {
      toast.error('No customer email on this booking.');
      return;
    }
    const summary = [primary, secondary && secondary !== primary ? `CC: ${secondary}` : null]
      .filter(Boolean)
      .join(' · ');
    if (!window.confirm(`Email the Terms & Conditions document to ${summary}?`)) return;
    await sendEmail({ sendToCustomer: true });
  }, [booking, sendEmail]);

  const handleEmailCustom = useCallback(async () => {
    const email = String(customEmail || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address.');
      return;
    }
    if (!window.confirm(`Email the Terms & Conditions document to ${email}?`)) return;
    await sendEmail({ sendToCustomer: false, recipientEmail: email });
  }, [customEmail, sendEmail]);

  if (!booking?.terms_package_id) {
    return (
      <div style={{ ...cardStyle, color: TavariStyles.colors.gray600 }}>
        This booking does not have a Terms & Conditions package attached.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...cardStyle, color: TavariStyles.colors.gray600 }}>
        Loading Terms & Conditions…
      </div>
    );
  }

  if (!review || !documentModel) {
    return (
      <div style={{ ...cardStyle, color: TavariStyles.colors.gray600 }}>
        Could not load Terms & Conditions for this booking.
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={load} style={actionBtn()}>
            <FiRefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const isSigned = documentModel.isSigned;
  const busy = Boolean(busyAction);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: TavariStyles.colors.gray500, marginBottom: 4 }}>
            TERMS & CONDITIONS
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: TavariStyles.colors.gray900 }}>
            {documentModel.packageName}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: isSigned ? '#065f46' : '#9a3412', fontWeight: 600 }}>
            {isSigned
              ? `Signed${documentModel.signerName ? ` by ${documentModel.signerName}` : ''}${signedAtLabel ? ` · ${signedAtLabel}` : ''}`
              : 'Pending customer signature'}
          </div>
        </div>
        <button type="button" onClick={handlePrint} disabled={busy || !documentHtml} style={actionBtn('default', busy)}>
          <FiPrinter size={14} /> {busyAction === 'print' ? 'Preparing…' : 'Print'}
        </button>
        <button
          type="button"
          onClick={handlePdf}
          disabled={busy || !documentHtml}
          style={actionBtn('default', busy || !documentHtml)}
        >
          <FiDownload size={14} /> {busyAction === 'pdf' ? 'Creating PDF…' : 'Download PDF'}
        </button>
        <button
          type="button"
          onClick={handleEmailCustomer}
          disabled={busy || !isSigned}
          title={!isSigned ? 'Available after the customer signs' : undefined}
          style={actionBtn('primary', busy || !isSigned)}
        >
          <FiMail size={14} /> {busyAction === 'email-customer' ? 'Sending…' : 'Email customer'}
        </button>
        <button
          type="button"
          onClick={() => setShowCustomEmail((v) => !v)}
          disabled={busy || !isSigned}
          style={actionBtn('default', busy || !isSigned)}
        >
          <FiMail size={14} /> Custom email
        </button>
        <button type="button" onClick={load} disabled={busy} style={actionBtn('default', busy)}>
          <FiRefreshCw size={14} /> Refresh
        </button>
      </div>

      {showCustomEmail ? (
        <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <input
            type="email"
            value={customEmail}
            onChange={(e) => setCustomEmail(e.target.value)}
            placeholder="recipient@example.com"
            style={{
              flex: '1 1 240px',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={handleEmailCustom}
            disabled={busy}
            style={actionBtn('primary', busy)}
          >
            {busyAction === 'email-custom' ? 'Sending…' : 'Send to this email'}
          </button>
        </div>
      ) : null}

      <div style={{ ...cardStyle, padding: 14 }}>
        {documentModel.packageDescription ? (
          <p style={{ marginTop: 0, marginBottom: 10, color: TavariStyles.colors.gray600, fontSize: 11, lineHeight: 1.3 }}>
            {documentModel.packageDescription}
          </p>
        ) : null}

        {sections.length === 0 ? (
          <p style={{ color: TavariStyles.colors.gray600, fontSize: 13 }}>No terms sections found for this package.</p>
        ) : (
          sections.map((section, index) => (
            <section
              key={section.id || `${section.title}-${index}`}
              style={{
                marginBottom: 12,
                paddingBottom: 10,
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>
                {index + 1}. {section.title}
              </h3>
              <div style={{ fontSize: 11, lineHeight: 1.3, color: TavariStyles.colors.gray700 }}>
                {String(section.body || '')
                  .split(/\n+/)
                  .filter(Boolean)
                  .map((paragraph, pIndex) => (
                    <p key={`${section.id}-p-${pIndex}`} style={{ margin: '0 0 4px' }}>
                      {paragraph}
                    </p>
                  ))}
              </div>
              {section.require_acknowledge !== false ? (
                <div
                  style={{
                    marginTop: 6,
                    padding: '4px 8px',
                    borderRadius: 6,
                    background: section.acknowledged_at ? '#ecfdf5' : '#fff7ed',
                    border: `1px solid ${section.acknowledged_at ? '#a7f3d0' : '#fed7aa'}`,
                    color: section.acknowledged_at ? '#065f46' : '#9a3412',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.25,
                  }}
                >
                  {section.acknowledged_at
                    ? `Acknowledged${section.acknowledgedAtLabel ? ` · ${section.acknowledgedAtLabel}` : ''}`
                    : 'Not yet acknowledged'}
                </div>
              ) : null}
            </section>
          ))
        )}

        <section>
          <h3 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>Signature</h3>
          {isSigned ? (
            <>
              <p style={{ margin: '0 0 6px', fontSize: 11, lineHeight: 1.3, color: TavariStyles.colors.gray700 }}>
                {BOOKING_TERMS_SIGNING_CONFIRMATION}
              </p>
              <div
                style={{
                  marginBottom: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: '#f0fdfa',
                  border: '1px solid #99f6e4',
                  fontSize: 11,
                  color: '#0f766e',
                  fontWeight: 600,
                  lineHeight: 1.25,
                }}
              >
                {BOOKING_TERMS_DIGITAL_SIGNATURE_ACK}
              </div>
              <div style={{ display: 'grid', gap: 2, fontSize: 11, marginBottom: 8, lineHeight: 1.3 }}>
                <div><strong>Signer:</strong> {documentModel.signerName || '—'}</div>
                <div><strong>Signed:</strong> {signedAtLabel || '—'}</div>
                {documentModel.signedIp ? (
                  <div><strong>IP address:</strong> {documentModel.signedIp}</div>
                ) : null}
              </div>
              {signatureImageUrl ? (
                <div
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    padding: 8,
                    background: '#fff',
                    maxWidth: 240,
                  }}
                >
                  <img
                    src={signatureImageUrl}
                    alt="Customer signature"
                    style={{ maxWidth: '100%', maxHeight: 80, height: 'auto', display: 'block' }}
                  />
                </div>
              ) : (
                <p style={{ color: TavariStyles.colors.gray600, fontSize: 11 }}>No signature image on file.</p>
              )}
            </>
          ) : (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                color: '#9a3412',
                fontSize: 13,
                lineHeight: 1.3,
              }}
            >
              The customer has not signed yet. Use <strong>Resend T&Cs email</strong> from the booking actions when they need another link.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

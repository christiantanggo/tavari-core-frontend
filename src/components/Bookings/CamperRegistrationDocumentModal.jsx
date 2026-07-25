import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiDownload, FiExternalLink, FiPrinter, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import { generateCamperRegistrationHTMLContent } from '../../utils/generateCamperRegistrationHTMLContent';
import { downloadCamperRegistrationPdf } from '../../utils/camperRegistrationPdf';
import { printHtmlInNewWindow } from '../../utils/printCamperRegistrationHtml';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Staff modal: view a submitted camper registration with print / PDF download.
 * Paper imports with OCR show digitized fields by default, with an original-scan tab.
 */
const CamperRegistrationDocumentModal = ({ businessId, documentId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState(null);
  const [businessName, setBusinessName] = useState('');
  const [formTitle, setFormTitle] = useState('Camp Registration & Medical Form');
  const [authorizationTexts, setAuthorizationTexts] = useState({});
  const [downloading, setDownloading] = useState(false);
  const [importedFileUrl, setImportedFileUrl] = useState(null);
  const [viewMode, setViewMode] = useState('digitized'); // digitized | scan

  useEffect(() => {
    if (!businessId || !documentId) return;
    (async () => {
      setLoading(true);
      setImportedFileUrl(null);
      try {
        camperRegistrationService.setBusinessId(businessId);
        const [doc, template] = await Promise.all([
          camperRegistrationService.getDocumentById(documentId),
          camperRegistrationService.getFormTemplate(businessId),
        ]);
        setDocument(doc);
        setFormTitle(template?.form_title || 'Camp Registration & Medical Form');
        setAuthorizationTexts(template?.fields_config?.authorization_texts || {});

        const { supabase } = await import('../../supabaseClient');
        const { data } = await supabase.from('businesses').select('name').eq('id', businessId).maybeSingle();
        setBusinessName(data?.name || '');

        const hasDigitized = Boolean(doc?.form_data?.camper_info || doc?.form_data?.guardians);
        setViewMode(hasDigitized ? 'digitized' : 'scan');

        if (doc?.imported_file_url || doc?.source === 'import') {
          try {
            const signed = await camperRegistrationService.getImportedFileSignedUrl(doc.imported_file_url);
            setImportedFileUrl(signed);
          } catch (signedError) {
            console.warn('[CamperRegistrationDocumentModal] Could not sign imported file:', signedError);
          }
        }
      } catch (error) {
        console.error(error);
        toast.error(error.message || 'Could not load registration');
      } finally {
        setLoading(false);
      }
    })();
  }, [businessId, documentId]);

  const isImported = Boolean(document?.source === 'import' || document?.imported_file_url);
  const hasDigitized = Boolean(document?.form_data?.camper_info || document?.form_data?.guardians);
  const showingScan = isImported && (viewMode === 'scan' || !hasDigitized);

  const html = useMemo(() => {
    if (!document || showingScan) return '';
    return generateCamperRegistrationHTMLContent({
      document,
      businessName,
      formTitle,
      authorizationTexts,
      generatedByLabel: 'Tavari Bookings',
    });
  }, [document, businessName, formTitle, authorizationTexts, showingScan]);

  const pdfFilename = useMemo(() => {
    const name = [document?.first_name, document?.last_name].filter(Boolean).join(' ').trim() || 'Camper';
    const date = document?.signed_at ? String(document.signed_at).split('T')[0] : 'registration';
    return `Camp Registration - ${name} - ${date}.pdf`;
  }, [document]);

  const ocrWarnings = Array.isArray(document?.form_data?.ocr?.warnings)
    ? document.form_data.ocr.warnings.filter(Boolean)
    : [];

  const handlePrint = useCallback(() => {
    if (showingScan && importedFileUrl) {
      window.open(importedFileUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!html) return;
    printHtmlInNewWindow(html);
  }, [html, showingScan, importedFileUrl]);

  const handleDownload = useCallback(async () => {
    if (showingScan && importedFileUrl) {
      window.open(importedFileUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!html) return;
    setDownloading(true);
    try {
      await downloadCamperRegistrationPdf(html, pdfFilename);
      toast.success('Registration PDF downloaded');
    } catch (error) {
      toast.error(error.message || 'Could not download PDF');
    } finally {
      setDownloading(false);
    }
  }, [html, pdfFilename, showingScan, importedFileUrl]);

  if (!documentId) return null;

  const isImage =
    importedFileUrl &&
    /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i.test(importedFileUrl);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          width: 'min(960px, 100%)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 18px',
            borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {document
                ? `${document.first_name || ''} ${document.last_name || ''}`.trim() || 'Camper registration'
                : 'Camper registration'}
              {isImported ? (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#0f766e',
                    background: '#ecfdf5',
                    padding: '2px 8px',
                    borderRadius: 999,
                  }}
                >
                  {hasDigitized ? 'Paper + OCR' : 'Paper upload'}
                </span>
              ) : null}
            </div>
            {document?.expires_at ? (
              <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 2 }}>
                Valid until {new Date(document.expires_at).toLocaleDateString('en-CA')}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isImported && hasDigitized && importedFileUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode('digitized')}
                  style={{
                    ...toolbarBtnStyle,
                    background: viewMode === 'digitized' ? '#ecfdf5' : '#fff',
                    borderColor: viewMode === 'digitized' ? '#99f6e4' : '#e5e7eb',
                  }}
                >
                  Digitized form
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('scan')}
                  style={{
                    ...toolbarBtnStyle,
                    background: viewMode === 'scan' ? '#ecfdf5' : '#fff',
                    borderColor: viewMode === 'scan' ? '#99f6e4' : '#e5e7eb',
                  }}
                >
                  Original scan
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || (!html && !importedFileUrl)}
              style={toolbarBtnStyle}
            >
              {showingScan ? <FiExternalLink size={16} /> : <FiPrinter size={16} />}
              {showingScan ? 'Open scan' : 'Print'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || (!html && !importedFileUrl) || downloading}
              style={toolbarBtnStyle}
            >
              <FiDownload size={16} />{' '}
              {downloading ? 'Saving…' : showingScan ? 'Download scan' : 'Download PDF'}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" style={{ ...toolbarBtnStyle, padding: 8 }}>
              <FiX size={20} />
            </button>
          </div>
        </div>

        {ocrWarnings.length > 0 && viewMode === 'digitized' ? (
          <div
            style={{
              padding: '10px 18px',
              background: '#fffbeb',
              borderBottom: '1px solid #fde68a',
              fontSize: 13,
              color: '#92400e',
            }}
          >
            <strong>OCR review:</strong> {ocrWarnings.slice(0, 4).join(' · ')}
            {ocrWarnings.length > 4 ? ` · +${ocrWarnings.length - 4} more` : ''}
          </div>
        ) : null}

        <div style={{ flex: 1, overflow: 'auto', background: '#f3f4f6', padding: 16 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: TavariStyles.colors.gray600 }}>Loading…</div>
          ) : !document ? (
            <div style={{ padding: 40, textAlign: 'center', color: TavariStyles.colors.gray600 }}>
              Registration not found.
            </div>
          ) : showingScan ? (
            importedFileUrl ? (
              isImage ? (
                <img
                  src={importedFileUrl}
                  alt="Uploaded paper registration"
                  style={{
                    display: 'block',
                    maxWidth: '100%',
                    margin: '0 auto',
                    borderRadius: 8,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                    background: '#fff',
                  }}
                />
              ) : (
                <iframe
                  title="Uploaded paper registration"
                  src={importedFileUrl}
                  style={{
                    width: '100%',
                    minHeight: 720,
                    border: 'none',
                    background: '#fff',
                    borderRadius: 8,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  }}
                />
              )
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                Paper scan is on file, but the file could not be opened. Try refreshing or re-uploading.
              </div>
            )
          ) : (
            <iframe
              title="Camper registration preview"
              srcDoc={html}
              style={{
                width: '100%',
                minHeight: 720,
                border: 'none',
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const toolbarBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  background: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

export default CamperRegistrationDocumentModal;

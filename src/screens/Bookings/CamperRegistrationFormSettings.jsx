import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiChevronDown, FiChevronRight, FiChevronUp, FiCopy, FiExternalLink, FiFileText, FiMail, FiPlus, FiPrinter, FiRefreshCw, FiSave, FiSearch, FiTrash2, FiUpload } from 'react-icons/fi';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import CamperRegistrationDocumentModal from '../../components/Bookings/CamperRegistrationDocumentModal';
import CamperRegistrationFormPreview from '../../components/Bookings/CamperRegistrationFormPreview';
import {
  buildCampRegistrationShareEmail,
  CAMPER_REGISTRATION_SECTION_KEYS,
  CAMPER_REGISTRATION_SECTION_ORDER,
  DEFAULT_AUTHORIZATION_TEXTS,
  DEFAULT_CAMPER_REGISTRATION_TEMPLATE,
  CAMPER_REGISTRATION_PREVIEW_SAMPLE,
  getCampRegistrationPortalUrl,
  mergeCamperRegistrationTemplate,
  writeCamperRegistrationPreviewPayload,
} from '../../constants/camperRegistrationForm';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import { openCamperRegistrationBlankPrint } from '../../utils/openCamperRegistrationBlankPrint';
import { extractCamperRegistrationFromFile } from '../../utils/camperRegistrationOcr';
import { TavariStyles } from '../../utils/TavariStyles';

const EMPTY_PAPER_UPLOAD = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  signedAt: '',
  signedByName: '',
  signedByRelationship: '',
  notes: '',
  file: null,
};

export const REGISTRATION_FORM_TABS = [
  { id: 'search', label: 'Form Search' },
  { id: 'links', label: 'Links' },
  { id: 'builder', label: 'Form Builder' },
];

function compareSortValues(a, b, dir) {
  const mult = dir === 'asc' ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return 0;
    return a < b ? -mult : mult;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    if (a === b) return 0;
    return a ? mult : -mult;
  }
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  if (sa === sb) return 0;
  return sa < sb ? -mult : mult;
}

const REGISTRATION_DOCUMENT_SORT_COLUMNS = [
  { id: 'firstName', label: 'First name', defaultDir: 'asc' },
  { id: 'lastName', label: 'Last name', defaultDir: 'asc' },
  { id: 'signed', label: 'Signed', defaultDir: 'desc' },
  { id: 'expires', label: 'Valid until', defaultDir: 'desc' },
  { id: 'status', label: 'Status', defaultDir: 'asc' },
  { id: 'printReviewed', label: 'Printed / reviewed', defaultDir: 'desc' },
];

const SECTION_SUMMARIES = {
  [CAMPER_REGISTRATION_SECTION_KEYS.camperInfo]:
    'Name and birthday from the camper profile; parents enter address, city, postal code, home phone, and age at camp.',
  [CAMPER_REGISTRATION_SECTION_KEYS.guardians]:
    'Two parent/guardian blocks: name, primary phone, secondary phone, and email. Guardian 1 is pre-filled from the customer account.',
  [CAMPER_REGISTRATION_SECTION_KEYS.custody]:
    'Custody selection: Parent/Guardian 1, 2, Both, Joint, or Other (with detail field).',
  [CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts]:
    'Two emergency contact rows (other than parent/guardian): name and preferred contact number.',
  [CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup]:
    'Pick-up authorization: Parent/Guardian(s), Emergency contact(s), and/or Other named people.',
  [CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation]:
    'Free-text area for general medical needs (devices, care instructions, etc.).',
  [CAMPER_REGISTRATION_SECTION_KEYS.allergies]:
    'Per-allergy rows: allergen, symptoms, other notes, anaphylactic Y/N, Epi-Pen Y/N.',
  [CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization]:
    'Shown when allergies are listed. Parent acknowledges staff may administer allergy medication.',
  [CAMPER_REGISTRATION_SECTION_KEYS.medications]:
    'Medication table: name, dosage/instructions, time to dispense, refrigeration Y/N.',
  [CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization]:
    'Camp, medical, and off-premises authorization text with checkboxes, parent signature, and date.',
};

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  border: `1px solid ${TavariStyles.colors.gray300}`,
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const CamperRegistrationFormSettings = ({ businessId, initialRegistrationTab = 'builder' }) => {
  const [activeRegistrationTab, setActiveRegistrationTab] = useState(initialRegistrationTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState(DEFAULT_CAMPER_REGISTRATION_TEMPLATE.form_title);
  const [formIntro, setFormIntro] = useState(DEFAULT_CAMPER_REGISTRATION_TEMPLATE.form_intro);
  const [expiryDays, setExpiryDays] = useState(365);
  const [sections, setSections] = useState(DEFAULT_CAMPER_REGISTRATION_TEMPLATE.fields_config.sections);
  const [authorizationTexts, setAuthorizationTexts] = useState({ ...DEFAULT_AUTHORIZATION_TEXTS });
  const [customFields, setCustomFields] = useState([]);
  const [expandedSections, setExpandedSections] = useState(() => new Set(CAMPER_REGISTRATION_SECTION_ORDER));
  const [businessName, setBusinessName] = useState('');
  const [mobileTab, setMobileTab] = useState('edit');
  const [recentDocuments, setRecentDocuments] = useState([]);
  const [viewDocumentId, setViewDocumentId] = useState(null);
  const [documentSearch, setDocumentSearch] = useState('');
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [updatingPrintReviewId, setUpdatingPrintReviewId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState(null);
  const [documentSortColumn, setDocumentSortColumn] = useState('signed');
  const [documentSortDir, setDocumentSortDir] = useState('desc');
  const [showPaperUpload, setShowPaperUpload] = useState(false);
  const [paperUpload, setPaperUpload] = useState(() => ({ ...EMPTY_PAPER_UPLOAD }));
  const [uploadingPaper, setUploadingPaper] = useState(false);
  const [printingBlank, setPrintingBlank] = useState(false);

  const portalUrl = useMemo(() => getCampRegistrationPortalUrl(businessId), [businessId]);

  const loadRecentDocuments = useCallback(
    async (searchQuery = '') => {
      if (!businessId) return;
      setLoadingDocuments(true);
      try {
        camperRegistrationService.setBusinessId(businessId);
        const recent = await camperRegistrationService.getRecentDocuments(50, searchQuery);
        setRecentDocuments(recent);
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingDocuments(false);
      }
    },
    [businessId]
  );

  const handleTogglePrintReviewed = async (docId, checked) => {
    if (!docId) return;
    setUpdatingPrintReviewId(docId);
    setRecentDocuments((prev) =>
      prev.map((d) =>
        d.id === docId
          ? {
              ...d,
              staff_print_reviewed: checked,
              staff_print_reviewed_at: checked ? new Date().toISOString() : null,
            }
          : d
      )
    );
    try {
      camperRegistrationService.setBusinessId(businessId);
      const updated = await camperRegistrationService.setStaffPrintReviewed(docId, checked);
      setRecentDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                staff_print_reviewed: updated.staff_print_reviewed,
                staff_print_reviewed_at: updated.staff_print_reviewed_at,
                staff_print_reviewed_by: updated.staff_print_reviewed_by,
              }
            : d
        )
      );
    } catch (error) {
      console.error(error);
      toast.error('Could not update printed / reviewed status.');
      await loadRecentDocuments(documentSearch);
    } finally {
      setUpdatingPrintReviewId(null);
    }
  };

  const requestDeleteDocument = (doc) => {
    if (!doc?.id) return;
    setDeleteConfirm({ doc, step: 1 });
  };

  const cancelDeleteDocument = () => {
    if (deletingDocumentId) return;
    setDeleteConfirm(null);
  };

  const advanceDeleteDocumentConfirm = () => {
    setDeleteConfirm((prev) => (prev ? { ...prev, step: 2 } : null));
  };

  const confirmDeleteDocument = async () => {
    const doc = deleteConfirm?.doc;
    if (!doc?.id || deletingDocumentId) return;

    setDeletingDocumentId(doc.id);
    try {
      camperRegistrationService.setBusinessId(businessId);
      await camperRegistrationService.deleteDocument(doc.id);
      setRecentDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      if (viewDocumentId === doc.id) setViewDocumentId(null);
      toast.success('Registration form deleted.');
      setDeleteConfirm(null);
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Could not delete registration form.');
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      camperRegistrationService.setBusinessId(businessId);
      const template = await camperRegistrationService.getFormTemplate(businessId);
      setFormTitle(template.form_title);
      setFormIntro(template.form_intro || '');
      setExpiryDays(template.expiry_days || 365);
      setSections(template.fields_config?.sections || DEFAULT_CAMPER_REGISTRATION_TEMPLATE.fields_config.sections);
      setAuthorizationTexts({
        ...DEFAULT_AUTHORIZATION_TEXTS,
        ...(template.fields_config?.authorization_texts || {}),
      });
      setCustomFields(template.fields_config?.custom_fields || []);
      await loadRecentDocuments('');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Could not load camper registration form');
    } finally {
      setLoading(false);
    }
  }, [businessId, loadRecentDocuments]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setActiveRegistrationTab(initialRegistrationTab);
  }, [initialRegistrationTab]);

  const handleCopyPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast.success('Camp registration link copied');
    } catch {
      toast.error('Could not copy link — select and copy manually');
    }
  };

  const handleEmailPortalLink = () => {
    const { subject, body } = buildCampRegistrationShareEmail({
      businessName,
      businessId,
      formTitle,
    });
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleSearchDocuments = (event) => {
    event.preventDefault();
    loadRecentDocuments(documentSearch);
  };

  const handlePrintBlankForm = async () => {
    if (!businessId || printingBlank) return;
    setPrintingBlank(true);
    try {
      await openCamperRegistrationBlankPrint(businessId);
    } finally {
      setPrintingBlank(false);
    }
  };

  const updatePaperUpload = (patch) => {
    setPaperUpload((prev) => ({ ...prev, ...patch }));
  };

  const handlePaperUploadSubmit = async (event) => {
    event.preventDefault();
    if (uploadingPaper) return;
    if (!paperUpload.file) {
      toast.error('Choose a PDF or image of the completed form.');
      return;
    }

    setUploadingPaper(true);
    try {
      camperRegistrationService.setBusinessId(businessId);

      toast.loading('Digitizing form with OCR…', { id: 'camper-ocr' });
      let ocrResult = null;
      try {
        ocrResult = await extractCamperRegistrationFromFile(businessId, paperUpload.file);
        toast.success('Form digitized. Saving registration…', { id: 'camper-ocr' });
      } catch (ocrError) {
        console.error(ocrError);
        toast.error(
          `OCR could not fully read this form (${ocrError.message || 'error'}). You can still save with the details you entered.`,
          { id: 'camper-ocr', duration: 5000 }
        );
      }

      const firstName = paperUpload.firstName.trim() || ocrResult?.first_name || '';
      const lastName = paperUpload.lastName.trim() || ocrResult?.last_name || '';
      const signedByName = paperUpload.signedByName.trim() || ocrResult?.signed_by_name || '';
      if (!firstName || !lastName) {
        toast.error('Camper first and last name are required (enter them or use a clearer scan).');
        return;
      }
      if (!signedByName) {
        toast.error('Parent/guardian signed-by name is required (enter it or use a clearer scan).');
        return;
      }

      const created = await camperRegistrationService.importPaperRegistration(
        paperUpload.file,
        {
          firstName,
          lastName,
          dateOfBirth: paperUpload.dateOfBirth || ocrResult?.date_of_birth || null,
          signedAt: paperUpload.signedAt || ocrResult?.signed_at || null,
          signedByName,
          signedByRelationship: paperUpload.signedByRelationship || ocrResult?.signed_by_relationship || null,
          expiryDays,
          notes: paperUpload.notes || null,
        },
        ocrResult
      );

      const warningCount = Array.isArray(ocrResult?.warnings) ? ocrResult.warnings.length : 0;
      toast.success(
        ocrResult?.form_data?.camper_info
          ? warningCount
            ? `Paper form digitized and saved (${warningCount} field(s) to double-check).`
            : 'Paper form digitized and added like an online submission.'
          : 'Paper registration uploaded (scan saved; OCR fields were limited).'
      );
      setPaperUpload({ ...EMPTY_PAPER_UPLOAD });
      setShowPaperUpload(false);
      await loadRecentDocuments(documentSearch);
      if (created?.id) setViewDocumentId(created.id);
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Could not upload paper registration.');
    } finally {
      setUploadingPaper(false);
    }
  };

  const documentStatusLabel = (doc) => {
    if (doc.is_valid === false) return { text: 'Expired', color: '#b91c1c' };
    if (doc.expires_at && new Date(doc.expires_at) <= new Date()) return { text: 'Expired', color: '#b91c1c' };
    return { text: 'Valid', color: '#047857' };
  };

  const getDocumentSortValue = useCallback(
    (doc, columnId) => {
      switch (columnId) {
        case 'firstName':
          return String(doc.first_name || '').trim() || null;
        case 'lastName':
          return String(doc.last_name || '').trim() || null;
        case 'signed':
          return doc.signed_at ? new Date(doc.signed_at).getTime() : null;
        case 'expires':
          return doc.expires_at ? new Date(doc.expires_at).getTime() : null;
        case 'status':
          return documentStatusLabel(doc).text;
        case 'printReviewed':
          return Boolean(doc.staff_print_reviewed);
        default:
          return null;
      }
    },
    []
  );

  const sortedRecentDocuments = useMemo(() => {
    const rows = [...recentDocuments];
    rows.sort((a, b) => {
      const primary = compareSortValues(
        getDocumentSortValue(a, documentSortColumn),
        getDocumentSortValue(b, documentSortColumn),
        documentSortDir
      );
      if (primary !== 0) return primary;
      // Stable alpha tie-break when sorting by first or last name.
      if (documentSortColumn === 'firstName') {
        return compareSortValues(
          getDocumentSortValue(a, 'lastName'),
          getDocumentSortValue(b, 'lastName'),
          'asc'
        );
      }
      if (documentSortColumn === 'lastName') {
        return compareSortValues(
          getDocumentSortValue(a, 'firstName'),
          getDocumentSortValue(b, 'firstName'),
          'asc'
        );
      }
      return 0;
    });
    return rows;
  }, [recentDocuments, documentSortColumn, documentSortDir, getDocumentSortValue]);

  const handleDocumentSortColumn = (columnId) => {
    const col = REGISTRATION_DOCUMENT_SORT_COLUMNS.find((c) => c.id === columnId);
    if (!col) return;
    if (documentSortColumn === columnId) {
      setDocumentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setDocumentSortColumn(columnId);
      setDocumentSortDir(col.defaultDir);
    }
  };

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const { supabase } = await import('../../supabaseClient');
      const { data } = await supabase.from('businesses').select('name').eq('id', businessId).maybeSingle();
      setBusinessName(data?.name || '');
    })();
  }, [businessId]);

  const liveTemplate = useMemo(
    () =>
      mergeCamperRegistrationTemplate({
        form_title: formTitle.trim(),
        form_intro: formIntro.trim(),
        expiry_days: Number(expiryDays) || 365,
        fields_config: {
          sections,
          authorization_texts: authorizationTexts,
          custom_fields: customFields.filter((f) => f.field_label?.trim()),
        },
      }),
    [formTitle, formIntro, expiryDays, sections, authorizationTexts, customFields]
  );

  const toggleSectionExpanded = (key) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAllSections = () => {
    setExpandedSections(new Set(CAMPER_REGISTRATION_SECTION_ORDER));
  };

  const collapseAllSections = () => {
    setExpandedSections(new Set());
  };

  const updateSection = (key, patch) => {
    setSections((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || DEFAULT_CAMPER_REGISTRATION_TEMPLATE.fields_config.sections[key] || {}),
        ...patch,
      },
    }));
  };

  const updateAuthText = (key, value) => {
    setAuthorizationTexts((prev) => ({ ...prev, [key]: value }));
  };

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      {
        field_key: `custom_${prev.length + 1}`,
        field_label: '',
        field_type: 'text',
        is_required: false,
      },
    ]);
  };

  const updateCustomField = (index, patch) => {
    setCustomFields((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeCustomField = (index) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePreview = () => {
    if (!businessId) return;
    const previewPayload = {
      ...CAMPER_REGISTRATION_PREVIEW_SAMPLE,
      returnUrl: '',
      previewTemplate: mergeCamperRegistrationTemplate({
        form_title: formTitle.trim(),
        form_intro: formIntro.trim(),
        expiry_days: Number(expiryDays) || 365,
        fields_config: {
          sections,
          authorization_texts: authorizationTexts,
          custom_fields: customFields,
        },
      }),
    };
    const stored = writeCamperRegistrationPreviewPayload(businessId, previewPayload);
    if (!stored) {
      toast.error('Could not store preview data in this browser. Try allowing site storage.');
      return;
    }
    window.open(`/customer-portal/${businessId}/camper-registration/preview?preview=1`, '_blank');
  };

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      camperRegistrationService.setBusinessId(businessId);
      await camperRegistrationService.saveFormTemplate({
        form_title: formTitle.trim(),
        form_intro: formIntro.trim(),
        expiry_days: Number(expiryDays) || 365,
        fields_config: {
          sections,
          authorization_texts: authorizationTexts,
          custom_fields: customFields
            .filter((f) => f.field_label?.trim())
            .map((f, idx) => ({
              ...f,
              field_key: f.field_key || `custom_${idx + 1}`,
              field_label: f.field_label.trim(),
            })),
        },
      });
      toast.success('Camp registration form saved');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Could not save form');
    } finally {
      setSaving(false);
    }
  };

  const renderSectionEditor = (key) => {
    const section = sections[key] || DEFAULT_CAMPER_REGISTRATION_TEMPLATE.fields_config.sections[key] || {};

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
        <p style={{ margin: 0, fontSize: 13, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
          {SECTION_SUMMARIES[key]}
        </p>

        <div>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
            Section heading (shown to parents)
          </label>
          <input
            style={inputStyle}
            value={section.label || ''}
            onChange={(e) => updateSection(key, { label: e.target.value })}
          />
        </div>

        {key === CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation && (
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              Prompt text
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
              value={section.prompt || ''}
              onChange={(e) => updateSection(key, { prompt: e.target.value })}
            />
          </div>
        )}

        {key === CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts && (
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              Helper text
            </label>
            <input
              style={inputStyle}
              value={section.helper_text || ''}
              onChange={(e) => updateSection(key, { helper_text: e.target.value })}
            />
          </div>
        )}

        {key === CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup && (
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              Photo ID note
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
              value={section.pickup_id_note || ''}
              onChange={(e) => updateSection(key, { pickup_id_note: e.target.value })}
            />
          </div>
        )}

        {key === CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization && (
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              Authorization text
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
              value={authorizationTexts.allergy_med_admin || ''}
              onChange={(e) => updateAuthText('allergy_med_admin', e.target.value)}
            />
          </div>
        )}

        {key === CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { authKey: 'camp', label: 'Camp authorization' },
              { authKey: 'medical', label: 'Medical authorization' },
              { authKey: 'off_premises', label: 'Off premises activities authorization' },
            ].map(({ authKey, label }) => (
              <div key={authKey}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
                  {label}
                </label>
                <textarea
                  style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                  value={authorizationTexts[authKey] || ''}
                  onChange={(e) => updateAuthText(authKey, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, paddingTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <TavariCheckbox
              checked={section.enabled !== false}
              onChange={(checked) => updateSection(key, { enabled: checked })}
              size="sm"
            />
            Enabled on parent form
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <TavariCheckbox
              checked={section.required === true}
              onChange={(checked) => updateSection(key, { required: checked })}
              size="sm"
              disabled={section.enabled === false}
            />
            Required before submit
          </label>
        </div>
      </div>
    );
  };

  const renderRegistrationTabNav = () => (
    <div
      style={{
        display: 'flex',
        gap: 2,
        marginBottom: 20,
        backgroundColor: '#e5e7eb',
        borderRadius: 8,
        padding: 4,
        overflowX: 'auto',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {REGISTRATION_FORM_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveRegistrationTab(tab.id)}
          style={{
            flex: 1,
            padding: '10px 16px',
            backgroundColor: activeRegistrationTab === tab.id ? '#fff' : 'transparent',
            color: activeRegistrationTab === tab.id ? '#008080' : '#6b7280',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            minWidth: 'fit-content',
            boxShadow: activeRegistrationTab === tab.id ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div style={{ width: '100%' }}>
        {renderRegistrationTabNav()}
        <div style={{ maxWidth: 1400 }}>
          <div style={{ padding: 40, textAlign: 'center', color: TavariStyles.colors.gray600 }}>
            Loading registration form…
          </div>
        </div>
      </div>
    );
  }

  function renderLinksTab() {
    return (
      <div style={{ padding: 20, borderRadius: 12, border: `1px solid ${TavariStyles.colors.gray200}`, background: '#fff' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Send link to families</h3>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
          Share this link with existing customers (including Bookeo bookings). Parents sign in with their phone number,
          select each camper, and complete the registration and medical form — no Tavari booking required.
          Need handwritten copies instead? Use <strong>Print blank form</strong> on the Form Search tab, then upload
          completed scans with <strong>Upload paper form</strong>.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            readOnly
            value={portalUrl}
            style={{ ...inputStyle, flex: '1 1 280px', marginBottom: 0, background: TavariStyles.colors.gray50 }}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" onClick={handleCopyPortalLink} style={shareBtnStyle}>
            <FiCopy size={16} /> Copy link
          </button>
          <button type="button" onClick={handleEmailPortalLink} style={shareBtnStyle}>
            <FiMail size={16} /> Email link
          </button>
          <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ ...shareBtnStyle, textDecoration: 'none', color: 'inherit' }}>
            <FiExternalLink size={16} /> Open portal
          </a>
        </div>
      </div>
    );
  }

  function renderSearchTab() {
    const SortableDocumentTh = ({ columnId, label }) => {
      const active = documentSortColumn === columnId;
      return (
        <th style={{ ...thStyle, padding: 0 }}>
          <button
            type="button"
            onClick={() => handleDocumentSortColumn(columnId)}
            title={
              active
                ? documentSortDir === 'asc'
                  ? 'Sorted A–Z / oldest first — tap to reverse'
                  : 'Sorted Z–A / newest first — tap to reverse'
                : `Sort by ${label}`
            }
            style={sortableThButtonStyle(active)}
          >
            {label}
            {active &&
              (documentSortDir === 'asc' ? (
                <FiChevronUp size={14} aria-hidden />
              ) : (
                <FiChevronDown size={14} aria-hidden />
              ))}
          </button>
        </th>
      );
    };

    return (
      <div style={{ padding: 20, borderRadius: 12, border: `1px solid ${TavariStyles.colors.gray200}`, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Submitted registrations</h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>
              View, print, upload, or delete completed forms. Search by camper first or last name.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" onClick={handlePrintBlankForm} style={shareBtnStyle} disabled={printingBlank}>
              <FiPrinter size={16} /> {printingBlank ? 'Opening…' : 'Print blank form'}
            </button>
            <button
              type="button"
              onClick={() => setShowPaperUpload((open) => !open)}
              style={shareBtnStyle}
            >
              <FiUpload size={16} /> {showPaperUpload ? 'Hide upload' : 'Upload paper form'}
            </button>
            <button type="button" onClick={() => loadRecentDocuments(documentSearch)} style={shareBtnStyle} disabled={loadingDocuments}>
              <FiRefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>

        {showPaperUpload ? (
          <form
            onSubmit={handlePaperUploadSubmit}
            style={{
              marginBottom: 20,
              padding: 16,
              borderRadius: 10,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              background: TavariStyles.colors.gray50 || '#f9fafb',
            }}
          >
            <h4 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Upload completed paper form</h4>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: TavariStyles.colors.gray600, lineHeight: 1.45 }}>
              Scan or photograph a handwritten form. OCR will digitize the fields into a structured registration
              (like an online submission) and keep the original scan on file. Enter camper/signer details if you
              already know them — they override OCR when filled in.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={fieldLabelStyle}>Camper first name</label>
                <input
                  style={{ ...inputStyle, marginBottom: 0 }}
                  value={paperUpload.firstName}
                  onChange={(e) => updatePaperUpload({ firstName: e.target.value })}
                  placeholder="Auto-filled by OCR if blank"
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Camper last name</label>
                <input
                  style={{ ...inputStyle, marginBottom: 0 }}
                  value={paperUpload.lastName}
                  onChange={(e) => updatePaperUpload({ lastName: e.target.value })}
                  placeholder="Auto-filled by OCR if blank"
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Date of birth</label>
                <input
                  type="date"
                  style={{ ...inputStyle, marginBottom: 0 }}
                  value={paperUpload.dateOfBirth}
                  onChange={(e) => updatePaperUpload({ dateOfBirth: e.target.value })}
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Form signed date</label>
                <input
                  type="date"
                  style={{ ...inputStyle, marginBottom: 0 }}
                  value={paperUpload.signedAt}
                  onChange={(e) => updatePaperUpload({ signedAt: e.target.value })}
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Signed by (parent/guardian)</label>
                <input
                  style={{ ...inputStyle, marginBottom: 0 }}
                  value={paperUpload.signedByName}
                  onChange={(e) => updatePaperUpload({ signedByName: e.target.value })}
                  placeholder="Auto-filled by OCR if blank"
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>Relationship</label>
                <input
                  style={{ ...inputStyle, marginBottom: 0 }}
                  value={paperUpload.signedByRelationship}
                  onChange={(e) => updatePaperUpload({ signedByRelationship: e.target.value })}
                  placeholder="Parent, guardian…"
                />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabelStyle}>Scanned form file (PDF or image) *</label>
              <input
                type="file"
                accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.heic"
                onChange={(e) => updatePaperUpload({ file: e.target.files?.[0] || null })}
                style={{ ...inputStyle, marginBottom: 0, padding: '8px 10px' }}
              />
              {paperUpload.file ? (
                <div style={{ marginTop: 6, fontSize: 13, color: TavariStyles.colors.gray600 }}>
                  Selected: {paperUpload.file.name}
                </div>
              ) : null}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabelStyle}>Staff notes (optional)</label>
              <input
                style={{ ...inputStyle, marginBottom: 0 }}
                value={paperUpload.notes}
                onChange={(e) => updatePaperUpload({ notes: e.target.value })}
                placeholder="e.g. Replaces online form dated…"
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="submit" style={shareBtnStyle} disabled={uploadingPaper}>
                <FiUpload size={16} /> {uploadingPaper ? 'Digitizing & saving…' : 'Digitize & add to system'}
              </button>
              <button
                type="button"
                style={shareBtnStyle}
                disabled={uploadingPaper}
                onClick={() => {
                  setPaperUpload({ ...EMPTY_PAPER_UPLOAD });
                  setShowPaperUpload(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        <form onSubmit={handleSearchDocuments} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <FiSearch size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: TavariStyles.colors.gray400 }} />
            <input
              style={{ ...inputStyle, paddingLeft: 36, marginBottom: 0 }}
              placeholder="Search by camper name…"
              value={documentSearch}
              onChange={(e) => setDocumentSearch(e.target.value)}
            />
          </div>
          <button type="submit" style={shareBtnStyle} disabled={loadingDocuments}>
            Search
          </button>
        </form>

        {loadingDocuments ? (
          <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray600 }}>Loading…</div>
        ) : recentDocuments.length === 0 ? (
          <div style={{ padding: 16, borderRadius: 8, background: TavariStyles.colors.gray50, color: TavariStyles.colors.gray600, fontSize: 14 }}>
            No submitted registrations yet. Send the portal link from the Links tab to collect forms.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${TavariStyles.colors.gray200}`, textAlign: 'left' }}>
                  {REGISTRATION_DOCUMENT_SORT_COLUMNS.map((col) => (
                    <SortableDocumentTh key={col.id} columnId={col.id} label={col.label} />
                  ))}
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecentDocuments.map((doc) => {
                  const firstName = String(doc.first_name || '').trim() || '—';
                  const lastName = String(doc.last_name || '').trim() || '—';
                  const status = documentStatusLabel(doc);
                  return (
                    <tr
                      key={doc.id}
                      style={{
                        borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
                        background: doc.staff_print_reviewed ? TavariStyles.colors.successBg || '#f0fdf4' : undefined,
                      }}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span>{firstName}</span>
                          {doc.source === 'import' || doc.imported_file_url ? (
                            <span style={paperBadgeStyle}>Paper</span>
                          ) : null}
                        </div>
                      </td>
                      <td style={tdStyle}>{lastName}</td>
                      <td style={tdStyle}>
                        {doc.signed_at ? new Date(doc.signed_at).toLocaleDateString('en-CA') : '—'}
                      </td>
                      <td style={tdStyle}>
                        {doc.expires_at ? new Date(doc.expires_at).toLocaleDateString('en-CA') : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: status.color, fontWeight: 600 }}>{status.text}</td>
                      <td style={tdStyle}>
                        <TavariCheckbox
                          appearance="native"
                          size="md"
                          id={`print-reviewed-${doc.id}`}
                          checked={Boolean(doc.staff_print_reviewed)}
                          disabled={updatingPrintReviewId === doc.id}
                          label="Printed / reviewed"
                          onChange={(checked) => handleTogglePrintReviewed(doc.id, checked)}
                        />
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <button type="button" onClick={() => setViewDocumentId(doc.id)} style={shareBtnStyle}>
                            <FiPrinter size={14} />{' '}
                            {doc.source === 'import' || doc.imported_file_url ? 'View scan' : 'View / print'}
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteDocument(doc)}
                            style={deleteBtnStyle}
                            disabled={deletingDocumentId === doc.id}
                          >
                            <FiTrash2 size={14} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function renderBuilderTab() {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, color: TavariStyles.colors.gray900 }}>
              Registration &amp; medical form
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              Edit sections on the left; the live preview updates on the right. Expand any section to edit headings, prompts, and legal text.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={handlePrintBlankForm}
              disabled={printingBlank}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderRadius: 8,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                background: '#fff',
                fontWeight: 600,
                cursor: printingBlank ? 'wait' : 'pointer',
              }}
            >
              <FiPrinter size={16} />
              {printingBlank ? 'Opening…' : 'Print blank form'}
            </button>
            <button
              type="button"
              onClick={handlePreview}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderRadius: 8,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                background: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FiExternalLink size={16} />
              Preview form
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 8,
                border: 'none',
                background: TavariStyles.colors.primary,
                color: 'white',
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              <FiSave size={16} />
              {saving ? 'Saving…' : 'Save form'}
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 16,
          }}
          className="camp-reg-mobile-tabs"
        >
          <button
            type="button"
            onClick={() => setMobileTab('edit')}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 8,
              border: `2px solid ${mobileTab === 'edit' ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
              background: mobileTab === 'edit' ? `${TavariStyles.colors.primary}12` : '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Edit form
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('preview')}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 8,
              border: `2px solid ${mobileTab === 'preview' ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
              background: mobileTab === 'preview' ? `${TavariStyles.colors.primary}12` : '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Live preview
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 420px)',
            gap: 20,
            alignItems: 'start',
          }}
          className="camp-reg-split-layout"
        >
          <div style={{ display: mobileTab === 'preview' ? 'none' : 'flex', flexDirection: 'column', gap: 20 }} className="camp-reg-editor-pane">
          <div style={{ padding: 20, borderRadius: 12, border: `1px solid ${TavariStyles.colors.gray200}`, background: '#fff' }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Form title</label>
            <input style={inputStyle} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />

            <label style={{ display: 'block', margin: '16px 0 8px', fontWeight: 600 }}>Introduction text</label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
              value={formIntro}
              onChange={(e) => setFormIntro(e.target.value)}
            />

            <label style={{ display: 'block', margin: '16px 0 8px', fontWeight: 600 }}>Valid for (days)</label>
            <input
              type="number"
              min={1}
              style={{ ...inputStyle, maxWidth: 160 }}
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
          </div>

          <div style={{ padding: 20, borderRadius: 12, border: `1px solid ${TavariStyles.colors.gray200}`, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Form sections</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={expandAllSections}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    background: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={collapseAllSections}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    background: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Collapse all
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {CAMPER_REGISTRATION_SECTION_ORDER.map((key) => {
                const section = sections[key] || {};
                const isExpanded = expandedSections.has(key);
                const displayLabel =
                  section.label ||
                  DEFAULT_CAMPER_REGISTRATION_TEMPLATE.fields_config.sections[key]?.label ||
                  key;
                const enabled = section.enabled !== false;
                const required = section.required === true;

                return (
                  <div
                    key={key}
                    style={{
                      borderRadius: 8,
                      border: `1px solid ${isExpanded ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
                      background: isExpanded ? '#fff' : TavariStyles.colors.gray50,
                      overflow: 'hidden',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSectionExpanded(key)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '14px 16px',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {isExpanded ? (
                          <FiChevronDown size={18} color={TavariStyles.colors.primary} />
                        ) : (
                          <FiChevronRight size={18} color={TavariStyles.colors.gray500} />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
                            {displayLabel}
                          </div>
                          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500, marginTop: 2 }}>
                            {enabled ? (required ? 'Enabled · Required' : 'Enabled · Optional') : 'Disabled'}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: 13, color: TavariStyles.colors.primary, fontWeight: 600, flexShrink: 0 }}>
                        {isExpanded ? 'Close' : 'Edit section'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div
                        style={{
                          padding: '0 16px 16px 44px',
                          borderTop: `1px solid ${TavariStyles.colors.gray200}`,
                        }}
                      >
                        {renderSectionEditor(key)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: 20, borderRadius: 12, border: `1px solid ${TavariStyles.colors.gray200}`, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Custom questions</h3>
              <button
                type="button"
                onClick={addCustomField}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  background: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                <FiPlus size={14} />
                Add question
              </button>
            </div>
            {customFields.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: TavariStyles.colors.gray600 }}>No custom questions yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {customFields.map((field, index) => (
                  <div
                    key={`custom-${index}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 140px auto auto',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <input
                      style={inputStyle}
                      placeholder="Question label"
                      value={field.field_label}
                      onChange={(e) => updateCustomField(index, { field_label: e.target.value })}
                    />
                    <select
                      style={inputStyle}
                      value={field.field_type}
                      onChange={(e) => updateCustomField(index, { field_type: e.target.value })}
                    >
                      <option value="text">Short text</option>
                      <option value="textarea">Long text</option>
                      <option value="checkbox">Yes/No</option>
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <TavariCheckbox
                        checked={!!field.is_required}
                        onChange={(checked) => updateCustomField(index, { is_required: checked })}
                        size="sm"
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => removeCustomField(index)}
                      aria-label="Remove question"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#b91c1c' }}
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>

          <div
            style={{
              position: 'sticky',
              top: 16,
              minHeight: 480,
              maxHeight: 'calc(100vh - 120px)',
              display: mobileTab === 'edit' ? 'none' : 'flex',
            }}
            className="camp-reg-preview-pane"
          >
            <CamperRegistrationFormPreview template={liveTemplate} businessName={businessName} />
          </div>
        </div>

        <style>{`
          @media (min-width: 960px) {
            .camp-reg-mobile-tabs { display: none !important; }
            .camp-reg-editor-pane { display: flex !important; }
            .camp-reg-preview-pane { display: flex !important; }
          }
        `}</style>
      </>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {renderRegistrationTabNav()}
      <div style={{ maxWidth: 1400 }}>
        {activeRegistrationTab === 'search' && renderSearchTab()}
        {activeRegistrationTab === 'links' && renderLinksTab()}
        {activeRegistrationTab === 'builder' && renderBuilderTab()}
      </div>

      {viewDocumentId ? (
        <CamperRegistrationDocumentModal
          businessId={businessId}
          documentId={viewDocumentId}
          onClose={() => setViewDocumentId(null)}
        />
      ) : null}

      {deleteConfirm?.doc ? (
        <div
          style={deleteModalOverlayStyle}
          role="presentation"
          onClick={cancelDeleteDocument}
        >
          <div
            style={deleteModalCardStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby="camper-registration-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            {deleteConfirm.step === 1 ? (
              <>
                <div style={deleteModalHeaderStyle}>
                  <h3 id="camper-registration-delete-title" style={deleteModalTitleStyle}>
                    Delete registration form?
                  </h3>
                  <p style={deleteModalBodyStyle}>
                    You are about to delete the registration for{' '}
                    <strong>
                      {[deleteConfirm.doc.first_name, deleteConfirm.doc.last_name].filter(Boolean).join(' ').trim() || 'this camper'}
                    </strong>
                    {deleteConfirm.doc.signed_at
                      ? ` signed on ${new Date(deleteConfirm.doc.signed_at).toLocaleDateString('en-CA')}.`
                      : '.'}
                  </p>
                  <p style={deleteModalHintStyle}>
                    Use this when a family submitted a duplicate by mistake or you asked them to complete a corrected form.
                  </p>
                </div>
                <div style={deleteModalFooterStyle}>
                  <button type="button" onClick={cancelDeleteDocument} style={shareBtnStyle}>
                    Cancel
                  </button>
                  <button type="button" onClick={advanceDeleteDocumentConfirm} style={deletePrimaryBtnStyle}>
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={deleteModalHeaderStyle}>
                  <h3 id="camper-registration-delete-title" style={deleteModalTitleStyle}>
                    Confirm permanent delete
                  </h3>
                  <p style={deleteModalBodyStyle}>
                    This permanently removes the form, signature, and medical details from Tavari. This action cannot be undone.
                  </p>
                  <p style={deleteModalHintStyle}>
                    The family can submit a new registration form from the portal link if needed.
                  </p>
                </div>
                <div style={deleteModalFooterStyle}>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm((prev) => (prev ? { ...prev, step: 1 } : null))}
                    disabled={Boolean(deletingDocumentId)}
                    style={shareBtnStyle}
                  >
                    Go back
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteDocument}
                    disabled={Boolean(deletingDocumentId)}
                    style={deleteDangerBtnStyle}
                  >
                    {deletingDocumentId ? 'Deleting…' : 'Delete permanently'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CamperRegistrationFormSettings;

const shareBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  background: '#fff',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const thStyle = {
  padding: '10px 12px',
  fontWeight: 600,
  color: TavariStyles.colors.gray700,
  whiteSpace: 'nowrap',
};

const sortableThButtonStyle = (active) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  width: '100%',
  padding: '10px 12px',
  border: 'none',
  background: active ? '#f0fdfa' : 'transparent',
  color: active ? TavariStyles.colors.primary || '#008080' : TavariStyles.colors.gray700,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  textAlign: 'left',
  whiteSpace: 'nowrap',
});

const tdStyle = {
  padding: '12px',
  color: TavariStyles.colors.gray800,
  verticalAlign: 'middle',
};

const fieldLabelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: TavariStyles.colors.gray700,
  marginBottom: 4,
};

const paperBadgeStyle = {
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.3px',
  textTransform: 'uppercase',
  color: '#0f766e',
  background: '#ecfdf5',
  border: '1px solid #99f6e4',
  borderRadius: 999,
  padding: '2px 8px',
};

const deleteBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #fecaca',
  background: '#fff',
  color: '#b91c1c',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

const deleteModalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const deleteModalCardStyle = {
  backgroundColor: '#fff',
  borderRadius: 12,
  maxWidth: 520,
  width: '100%',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
};

const deleteModalHeaderStyle = {
  padding: 24,
  borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
};

const deleteModalTitleStyle = {
  margin: '0 0 8px',
  fontSize: 20,
  fontWeight: 700,
  color: TavariStyles.colors.gray900,
};

const deleteModalBodyStyle = {
  margin: '0 0 12px',
  fontSize: 14,
  color: TavariStyles.colors.gray700,
  lineHeight: 1.5,
};

const deleteModalHintStyle = {
  margin: 0,
  fontSize: 13,
  color: TavariStyles.colors.gray500,
  lineHeight: 1.5,
};

const deleteModalFooterStyle = {
  padding: 24,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 12,
  flexWrap: 'wrap',
};

const deletePrimaryBtnStyle = {
  ...shareBtnStyle,
  border: 'none',
  background: TavariStyles.colors.primary || '#2563eb',
  color: '#fff',
};

const deleteDangerBtnStyle = {
  ...shareBtnStyle,
  border: 'none',
  background: '#b91c1c',
  color: '#fff',
};

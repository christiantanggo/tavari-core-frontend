// Step 84: Create WaiverDetailScreen.jsx
// Detailed waiver view
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiDownload, FiPrinter, FiMaximize2, FiUser, FiRefreshCw } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import { useWaiverSignature } from '../../hooks/useWaiverSignature';
import WaiverStatusBadge from '../../components/Waivers/WaiverStatusBadge';
import WaiverParticipantList from '../../components/Waivers/WaiverParticipantList';
import WaiverExpiryWarning from '../../components/Waivers/WaiverExpiryWarning';
import WaiverParticipantService from '../../services/Waivers/WaiverParticipantService';
import WaiverSignatureService from '../../services/Waivers/WaiverSignatureService';
import WaiversService from '../../services/Waivers/WaiversService';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { formatDateOfBirthDisplay } from '../../utils/waiverDateOfBirth';
import { waiverConsentTypeLabel } from '../../constants/waiverConsentTypes';
import { formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import POSCustomersScreen from '../POS/POSCustomersScreen';
import { waiverTemplateBodyInnerHtml } from '../../services/Waivers/waiverRecordDocumentHtml';
import { resolveWaiverSignatureImgSrc, resolveWaiverSignatureStorageUrl } from '../../utils/waiverSignatureDisplay';

const LEGACY_FALLBACK_EXPIRY_DAYS = 365;

function parsePositiveExpiryDaysDetail(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Same rules as WaiversDashboard getEffectiveWaiverExpiryDate (incl. legacy imports). */
function getEffectiveWaiverExpiryDateForDetail(waiver, defaultExpiryDays, globalExpiryFetchDone) {
  if (waiver?.expires_at) {
    const expiryDate = new Date(waiver.expires_at);
    if (!Number.isNaN(expiryDate.getTime())) return expiryDate;
  }
  if (!waiver?.signed_at) return null;
  const signedDate = new Date(waiver.signed_at);
  if (Number.isNaN(signedDate.getTime())) return null;
  const fromSettings = parsePositiveExpiryDaysDetail(defaultExpiryDays);
  const fromTemplate = parsePositiveExpiryDaysDetail(waiver?.waiver_templates?.expiry_days);
  const expiryDays =
    fromSettings ||
    fromTemplate ||
    (globalExpiryFetchDone ? LEGACY_FALLBACK_EXPIRY_DAYS : null);
  if (!expiryDays) return null;
  return new Date(signedDate.getTime() + expiryDays * 24 * 60 * 60 * 1000);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatWallkidsImportedLocalDateTime(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '';
  const [, y, mo, d, h, mi] = m;
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];
  const hour24 = Number(h);
  const hour12 = hour24 % 12 || 12;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  return `${monthNames[Number(mo) - 1] || mo} ${Number(d)}, ${y}, ${String(hour12).padStart(2, '0')}:${mi} ${ampm}`;
}

function formatLegacySignedDateTime(waiver, businessTimezone) {
  if (!waiver?.signed_at) return '';
  if (waiver.source_system === 'wallkids') {
    return formatWallkidsImportedLocalDateTime(waiver.signed_at) ||
      formatDateTimeForBusiness(waiver.signed_at, businessTimezone);
  }
  return formatDateTimeForBusiness(waiver.signed_at, businessTimezone);
}

function parseLegacySignatureStrokes(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed)
      ? parsed.filter((s) =>
          Number.isFinite(Number(s?.lx)) &&
          Number.isFinite(Number(s?.ly)) &&
          Number.isFinite(Number(s?.mx)) &&
          Number.isFinite(Number(s?.my))
        )
      : [];
  } catch {
    return [];
  }
}

function buildConnectedLegacySignaturePaths(strokes) {
  const groups = [];
  let current = [];
  let lastPoint = null;

  strokes.forEach((s) => {
    const start = { x: Number(s.mx), y: Number(s.my) };
    const end = { x: Number(s.lx), y: Number(s.ly) };
    const gap = lastPoint
      ? Math.hypot(start.x - lastPoint.x, start.y - lastPoint.y)
      : 0;

    if (!current.length || gap > 12) {
      if (current.length) groups.push(current);
      current = [start, end];
    } else {
      current.push(end);
    }
    lastPoint = end;
  });
  if (current.length) groups.push(current);

  return groups
    .map((points) => {
      if (points.length < 2) return '';
      let d = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i].x} ${points[i].y}`;
      }
      return d;
    })
    .filter(Boolean);
}

function legacySignatureSvgMarkup(raw, { width = 180, height = 80 } = {}) {
  const strokes = parseLegacySignatureStrokes(raw);
  if (strokes.length === 0) return '';

  const xs = strokes.flatMap((s) => [Number(s.lx), Number(s.mx)]);
  const ys = strokes.flatMap((s) => [Number(s.ly), Number(s.my)]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const pad = 28;
  const viewX = minX - pad;
  const viewY = minY - pad;
  const viewW = Math.max(1, maxX - minX + pad * 2);
  const viewH = Math.max(1, maxY - minY + pad * 2);
  const paths = buildConnectedLegacySignaturePaths(strokes)
    .map((d) => `<path d="${d}" />`)
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewX} ${viewY} ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Imported legacy signature">
      <rect x="${viewX}" y="${viewY}" width="${viewW}" height="${viewH}" fill="#fff" />
      <g transform="translate(8 7)" stroke="#111827" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" fill="none">${paths}</g>
    </svg>
  `;
}

function getDisplayableLegacyParticipants(participants = []) {
  return (participants || []).filter((p) => !p?._legacyCountOnly);
}

const LegacySignatureCanvas = ({ raw, width = 170, height = 76 }) => {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const strokes = parseLegacySignatureStrokes(raw);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    if (strokes.length === 0) return;

    const xs = strokes.flatMap((s) => [Number(s.lx), Number(s.mx)]);
    const ys = strokes.flatMap((s) => [Number(s.ly), Number(s.my)]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const sigW = Math.max(1, maxX - minX);
    const sigH = Math.max(1, maxY - minY);
    const padX = 10;
    const padY = 8;
    const scale = Math.min((width - padX * 2) / sigW, (height - padY * 2) / sigH);
    const offsetX = padX + (width - padX * 2 - sigW * scale) / 2;
    const offsetY = padY + (height - padY * 2 - sigH * scale) / 2;

    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokes.forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(offsetX + (Number(s.mx) - minX) * scale, offsetY + (Number(s.my) - minY) * scale);
      ctx.lineTo(offsetX + (Number(s.lx) - minX) * scale, offsetY + (Number(s.ly) - minY) * scale);
      ctx.stroke();
    });
  }, [raw, width, height]);

  return <canvas ref={ref} aria-label="Imported legacy signature" />;
};

function buildLegacyRecreatedWaiverHtml({ waiver, participants, effectiveExp, businessTimezone }) {
  const signatureSvg = legacySignatureSvgMarkup(waiver.signature_strokes);
  const signedDisplay = formatLegacySignedDateTime(waiver, businessTimezone);
  const displayParticipants = getDisplayableLegacyParticipants(participants);
  const participantSummary = displayParticipants
    .map((p) =>
      `${p.first_name || ''} ${p.last_name || ''} ${p.date_of_birth ? formatDateOfBirthDisplay(p.date_of_birth) : ''}`
        .trim()
    )
    .filter(Boolean)
    .join('<br />');
  const participantRows = displayParticipants
    .map(
      (p, idx) => `
        <div class="participant">
          <div class="participant-header">${escapeHtml(p.participant_type === 'minor' ? `Minor ${idx + 1}` : 'Participant')}</div>
          <div class="info-grid">
            <div class="info-item"><span class="info-label">Name:</span><span>${escapeHtml(`${p.first_name || ''} ${p.last_name || ''}`.trim() || 'N/A')}</span></div>
            <div class="info-item"><span class="info-label">Date of Birth:</span><span>${escapeHtml(formatDateOfBirthDisplay(p.date_of_birth))}</span></div>
            ${p.phone_number ? `<div class="info-item"><span class="info-label">Phone:</span><span>${escapeHtml(p.phone_number)}</span></div>` : ''}
            ${p.email ? `<div class="info-item"><span class="info-label">Email:</span><span>${escapeHtml(p.email)}</span></div>` : ''}
          </div>
        </div>
      `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Legacy Waiver - ${escapeHtml(`${waiver.first_name || ''} ${waiver.last_name || ''}`.trim())}</title>
      <style>
        @media print { @page { margin: 0.5in; } body { margin: 0; padding: 0; } }
        body { font-family: Arial, sans-serif; line-height: 1.42; color: #111827; max-width: 8.5in; margin: 0 auto; padding: 20px; font-size: 13px; }
        h1 { margin: 0 0 10px; font-size: 19px; letter-spacing: 0.01em; }
        h2 { font-size: 18px; margin: 18px 0 8px; }
        h3 { font-size: 14px; margin: 16px 0 6px; }
        p { margin: 0 0 8px; }
        ol { padding-left: 20px; }
        li { margin-bottom: 6px; }
        .legacy-top { margin-bottom: 18px; }
        .legacy-line { margin-bottom: 3px; }
        .section { margin-bottom: 22px; page-break-inside: avoid; }
        .section-title { font-size: 18px; font-weight: bold; margin-bottom: 12px; border-bottom: 1px solid #d1d5db; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; }
        .info-item { display: flex; flex-direction: column; }
        .info-label { font-weight: bold; color: #4b5563; margin-bottom: 3px; }
        .waiver-content { margin-top: 12px; white-space: break-spaces; word-break: break-word; }
        .participant { margin-bottom: 16px; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; }
        .participant-header { font-weight: bold; margin-bottom: 10px; }
        .signature-box { margin-top: 12px; padding: 12px; border: 1px solid #d1d5db; display: inline-block; background: #fff; }
        .signature-box svg { display: block; max-width: 100%; }
        .signature-line { margin-top: 8px; border-top: 1px solid #111827; padding-top: 6px; min-width: 260px; }
        .raw { white-space: pre-wrap; font-size: 13px; color: #374151; }
        .footer { margin-top: 34px; padding-top: 16px; border-top: 2px solid #111827; font-size: 13px; color: #4b5563; text-align: center; }
      </style>
    </head>
    <body>
      <div class="legacy-top">
        <h1>RELEASE OF LIABILITY, WAIVER OF CLAIMS &amp; INDEMNITY AGREEMENT</h1>
        <div class="legacy-line"><strong>Date:</strong> ${escapeHtml(signedDisplay || 'N/A')}</div>
        <div class="legacy-line"><strong>Location:</strong> 539 First St, London, ON N5V 1Z5 London Canada</div>
        <div class="legacy-line"><strong>Adult / Guardian:</strong> ${escapeHtml(`${waiver.first_name || ''} ${waiver.last_name || ''}`.trim() || 'N/A')}</div>
        <div class="legacy-line"><strong>Date of Birth:</strong> ${escapeHtml(formatDateOfBirthDisplay(waiver.date_of_birth))}</div>
        <div class="legacy-line">${escapeHtml([waiver.phone_number, waiver.email].filter(Boolean).join(' ') || 'N/A')}</div>
        ${participantSummary ? `<div class="legacy-line"><strong>Minors</strong><br />${participantSummary}</div>` : ''}
      </div>

      <div class="section" style="display:none">
        <div class="section-title">Signer Information</div>
        <div class="info-grid">
          <div class="info-item"><span class="info-label">Name:</span><span>${escapeHtml(`${waiver.first_name || ''} ${waiver.last_name || ''}`.trim() || 'N/A')}</span></div>
          <div class="info-item"><span class="info-label">Email:</span><span>${escapeHtml(waiver.email || 'N/A')}</span></div>
          <div class="info-item"><span class="info-label">Phone:</span><span>${escapeHtml(waiver.phone_number || 'N/A')}</span></div>
          <div class="info-item"><span class="info-label">Date of Birth:</span><span>${escapeHtml(formatDateOfBirthDisplay(waiver.date_of_birth))}</span></div>
          <div class="info-item"><span class="info-label">Signed:</span><span>${escapeHtml(signedDisplay || 'N/A')}</span></div>
          <div class="info-item"><span class="info-label">Expires (estimated):</span><span>${escapeHtml(effectiveExp ? formatDateShort(effectiveExp.toISOString(), businessTimezone) : 'N/A')}</span></div>
          ${waiver.legacy_row_id != null ? `<div class="info-item"><span class="info-label">Legacy Row ID:</span><span>${escapeHtml(waiver.legacy_row_id)}</span></div>` : ''}
          ${waiver.external_document_id ? `<div class="info-item"><span class="info-label">Source Document ID:</span><span>${escapeHtml(waiver.external_document_id)}</span></div>` : ''}
        </div>
        ${signatureSvg ? `<div class="signature-box"><div class="info-label">Imported Signature:</div>${signatureSvg}</div>` : '<p>No signature strokes were imported for this row.</p>'}
      </div>

      ${participantRows ? `<div class="section" style="display:none"><div class="section-title">Participants / Minors</div>${participantRows}</div>` : ''}

      <div class="waiver-content">${waiver.waiver_templates?.waiver_content ? waiverTemplateBodyInnerHtml(waiver.waiver_templates.waiver_content) : '<p>No waiver template text was mapped for this legacy row.</p>'}</div>

      <div class="section">
        <div class="section-title">Signature</div>
        <div class="info-grid">
          <div class="info-item"><span class="info-label">Signed By:</span><span>${escapeHtml(`${waiver.first_name || ''} ${waiver.last_name || ''}`.trim() || 'N/A')}</span></div>
          <div class="info-item"><span class="info-label">Signed:</span><span>${escapeHtml(signedDisplay || 'N/A')}</span></div>
        </div>
        ${signatureSvg ? `<div class="signature-box"><div class="info-label">Imported Signature:</div>${signatureSvg}<div class="signature-line">${escapeHtml(`${waiver.first_name || ''} ${waiver.last_name || ''}`.trim() || 'Signature')}</div></div>` : '<p>No signature strokes were imported for this row.</p>'}
      </div>

      ${waiver.notes ? `<div class="section"><div class="section-title">Notes</div><div class="raw">${escapeHtml(waiver.notes)}</div></div>` : ''}
      ${waiver.info ? `<div class="section"><div class="section-title">Info</div><div class="raw">${escapeHtml(waiver.info)}</div></div>` : ''}

      <div class="footer">
        <p>Generated on ${escapeHtml(formatDateTimeForBusiness(new Date(), businessTimezone))}</p>
        <p>Waiver ID: ${escapeHtml(waiver.id)}</p>
      </div>
    </body>
    </html>
  `;
}

const WaiverDetailScreen = () => {
  const { waiverId } = useParams();
  const navigate = useNavigate();

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiverDetailScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const contentStyle = useWaiversShellStyle(styles.content);
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'WaiverDetailScreen',
    sensitiveComponent: true
  });

  const { waiver, loading, refresh } = useWaiverSignature(waiverId);
  const [participants, setParticipants] = useState([]);
  const [showQR, setShowQR] = useState(false);
  const [archivedPdfViewerUrl, setArchivedPdfViewerUrl] = useState(null);
  const [archivedPdfLoadError, setArchivedPdfLoadError] = useState(false);
  const [defaultExpiryDays, setDefaultExpiryDays] = useState(null);
  const [globalExpiryFetchDone, setGlobalExpiryFetchDone] = useState(false);
  const [customerProfileOpen, setCustomerProfileOpen] = useState(false);
  const [customerProfileLoading, setCustomerProfileLoading] = useState(false);
  const [customerProfileCustomerId, setCustomerProfileCustomerId] = useState('');
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [archivedPdfReloadKey, setArchivedPdfReloadKey] = useState(0);
  const [regeneratingArchivedPdf, setRegeneratingArchivedPdf] = useState(false);
  const businessTimezone = getBusinessTimezone(auth.businessData);

  const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

  const getWaiverCustomerLookup = () => {
    if (!waiver) return {};
    const sourceParticipants =
      waiver._dataSource === 'legacy' && Array.isArray(waiver.waiver_participants)
        ? waiver.waiver_participants
        : participants;
    const participantWithCustomer = sourceParticipants.find((p) => p?.customer_id);
    return {
      customerId: waiver.customer_id || participantWithCustomer?.customer_id || null,
      email: String(waiver.email || '').trim().toLowerCase(),
      phoneDigits: normalizePhoneDigits(waiver.phone_number),
      name: [waiver.first_name, waiver.last_name].filter(Boolean).join(' ').trim()
    };
  };

  const openCustomerProfile = async () => {
    if (!auth.selectedBusinessId || !waiver) return;
    const lookup = getWaiverCustomerLookup();
    if (!lookup.customerId && !lookup.email && !lookup.phoneDigits && !lookup.name) {
      toast.error('No linked customer profile found for this waiver');
      return;
    }

    setCustomerProfileLoading(true);
    setCustomerProfileCustomerId('');

    try {
      let customer = null;

      if (lookup.customerId) {
        const { data, error } = await supabase
          .from('pos_loyalty_accounts')
          .select('*')
          .eq('id', lookup.customerId)
          .eq('business_id', auth.selectedBusinessId)
          .maybeSingle();
        if (error) throw error;
        customer = data || null;
      }

      if (!customer && lookup.email) {
        const { data, error } = await supabase
          .from('pos_loyalty_accounts')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .ilike('customer_email', lookup.email)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        customer = data?.[0] || null;
      }

      if (!customer && lookup.phoneDigits) {
        const { data, error } = await supabase
          .from('pos_loyalty_accounts')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .ilike('customer_phone', `%${lookup.phoneDigits.slice(-7)}%`)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        customer = data?.[0] || null;
      }

      if (!customer && lookup.name) {
        const { data, error } = await supabase
          .from('pos_loyalty_accounts')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .ilike('customer_name', `%${lookup.name}%`)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        customer = data?.[0] || null;
      }

      if (!customer) {
        toast.error('Customer profile was not found for this waiver');
        return;
      }
      setCustomerProfileCustomerId(customer.id);
      setCustomerProfileOpen(true);
    } catch (err) {
      console.error('WaiverDetailScreen: open customer profile modal', err);
      toast.error(err?.message || 'Failed to load customer profile');
    } finally {
      setCustomerProfileLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!auth.selectedBusinessId) {
        setDefaultExpiryDays(null);
        setGlobalExpiryFetchDone(true);
        return;
      }
      setGlobalExpiryFetchDone(false);
      try {
        WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
        const settings = await WaiverSettingsService.getGlobalSettings();
        if (!cancelled) {
          setDefaultExpiryDays(parsePositiveExpiryDaysDetail(settings?.default_expiry_days));
        }
      } catch (e) {
        if (!cancelled) setDefaultExpiryDays(null);
      } finally {
        if (!cancelled) setGlobalExpiryFetchDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    if (waiver?._dataSource === 'legacy') {
      return;
    }
    if (waiver?.id && auth.selectedBusinessId) {
      loadParticipants();
    }
    if (waiver) {
      console.log('[WaiverDetailScreen] Waiver data loaded:', {
        id: waiver.id,
        phone_number: waiver.phone_number,
        email: waiver.email,
        first_name: waiver.first_name,
        last_name: waiver.last_name
      });
    }
  }, [waiver?.id, auth.selectedBusinessId, waiver]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setArchivedPdfViewerUrl(null);
      setArchivedPdfLoadError(false);
      if (!waiver?.id || !auth.selectedBusinessId) return;

      WaiversService.setBusinessId(auth.selectedBusinessId);
      const path = waiver?._dataSource === 'legacy'
        ? waiver.imported_pdf_storage_path || waiver._legacyPdfStoragePath
        : waiver.signed_pdf_storage_path ||
          (await WaiversService.getWaiverPDFUrl(waiver.id).catch(() => null));
      if (!path || cancelled) return;

      const { data, error } = await supabase.storage
        .from('waivers')
        .createSignedUrl(path, 3600);

      if (cancelled) return;
      if (error || !data?.signedUrl) {
        setArchivedPdfLoadError(true);
        return;
      }
      setArchivedPdfViewerUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    waiver?.id,
    waiver?._dataSource,
    waiver?.signed_pdf_storage_path,
    waiver?.signed_pdf_uploaded_at,
    waiver?.imported_pdf_storage_path,
    waiver?._legacyPdfStoragePath,
    auth.selectedBusinessId,
    archivedPdfReloadKey
  ]);

  const loadParticipants = async (explicitWaiverId) => {
    const wid = explicitWaiverId ?? waiver?.id;
    if (!wid || !auth.selectedBusinessId) {
      console.warn('WaiverDetailScreen: Cannot load participants - missing waiver ID or business ID');
      return;
    }

    try {
      console.log('[WaiverDetailScreen] Loading participants for waiver:', wid);
      WaiverParticipantService.setBusinessId(auth.selectedBusinessId);
      const data = await WaiverParticipantService.getParticipants(wid);
      console.log('[WaiverDetailScreen] Loaded participants from database:', data);
      console.log('[WaiverDetailScreen] Participant types found:', data?.map(p => p.participant_type) || []);
      console.log('[WaiverDetailScreen] Total participants:', data?.length || 0);
      setParticipants(data || []);
    } catch (error) {
      console.error('[WaiverDetailScreen] Error loading participants:', error);
      toast.error('Error loading participants');
      setParticipants([]);
    }
  };

  const handleRefreshFromDatabase = async () => {
    if (!waiverId || !auth.selectedBusinessId || loading || detailRefreshing) return;
    setDetailRefreshing(true);
    try {
      const data = await refresh();
      if (data == null) {
        toast.error('Could not refresh waiver');
        return;
      }
      if (data._dataSource !== 'legacy') {
        await loadParticipants(waiverId);
      }
      toast.success('Waiver data refreshed from the database');
    } catch (err) {
      console.error('WaiverDetailScreen: refresh from database failed', err);
      toast.error(err?.message || 'Could not refresh waiver');
    } finally {
      setDetailRefreshing(false);
    }
  };

  const handleRegenerateArchivedPdf = async () => {
    if (!waiverId || !auth.selectedBusinessId || regeneratingArchivedPdf) return;
    if (waiver?._dataSource === 'legacy') {
      toast.error('Rebuild PDF is only available for electronic waivers.');
      return;
    }
    setRegeneratingArchivedPdf(true);
    try {
      WaiversService.setBusinessId(auth.selectedBusinessId);
      const res = await WaiversService.repairArchivedPdfs([waiverId], 'staff_regenerate_signed_pdf');
      const repaired = Array.isArray(res?.repairedWaiverIds) && res.repairedWaiverIds.includes(waiverId);
      if (!repaired) {
        const fail = Array.isArray(res?.failedWaivers)
          ? res.failedWaivers.find((f) => String(f?.waiverId) === String(waiverId))
          : null;
        throw new Error(fail?.error || res?.error || 'PDF was not rebuilt');
      }
      setArchivedPdfReloadKey((k) => k + 1);
      const data = await refresh();
      if (data && data._dataSource !== 'legacy') {
        await loadParticipants(waiverId);
      }
      toast.success('Official PDF was rebuilt from the current waiver data.');
    } catch (err) {
      console.error('WaiverDetailScreen: regenerate archived PDF failed', err);
      toast.error(err?.message || 'Could not rebuild PDF (owner, manager, or admin only).');
    } finally {
      setRegeneratingArchivedPdf(false);
    }
  };

  const canViewWaivers = hasPermission('waivers.view') || hasElevatedPrivileges();
  const canDownload = hasPermission('waivers.download') || hasElevatedPrivileges();

  const renderCustomerProfileModal = () => {
    if (!customerProfileOpen) return null;
    if (!customerProfileCustomerId) {
      return (
        <div style={styles.customerProfileLoadingOverlay}>
          <div style={styles.customerProfileLoadingBox}>Loading customer profile...</div>
        </div>
      );
    }

    return (
      <POSCustomersScreen
        embeddedProfile
        initialCustomerId={customerProfileCustomerId}
        initialTab="info"
        onEmbeddedClose={() => {
          setCustomerProfileOpen(false);
          setCustomerProfileCustomerId('');
        }}
      />
    );
  };

  const handleDownloadPDF = async () => {
    try {
      WaiversService.setBusinessId(auth.selectedBusinessId);
      const pdfPath = waiver?._dataSource === 'legacy'
        ? waiver.imported_pdf_storage_path || waiver._legacyPdfStoragePath
        : await WaiversService.getWaiverPDFUrl(waiver.id);
      
      if (!pdfPath) {
        // PDF doesn't exist yet, generate it using the print function
        toast.loading('Generating PDF...', { id: 'pdf-gen' });
        await handlePrint();
        toast.dismiss('pdf-gen');
        return;
      }

      // Get signed URL from storage
      const { data: signedUrl, error } = await supabase
        .storage
        .from('waivers')
        .createSignedUrl(pdfPath, 3600); // 1 hour expiry

      if (error) {
        throw error;
      }

      window.open(signedUrl.signedUrl, '_blank');
      toast.success('PDF downloaded');
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error('Error downloading PDF. Using print function instead.');
      // Fallback to print function
      handlePrint();
    }
  };

  const printHtmlOnce = (printHTML) => {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      toast.error('Popup blocked. Allow popups to print this waiver.');
      return;
    }

    let didPrint = false;
    const triggerPrint = () => {
      if (didPrint || printWindow.closed) return;
      didPrint = true;
      printWindow.focus();
      printWindow.print();
    };

    printWindow.document.write(printHTML);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(triggerPrint, 500);
    };
    setTimeout(triggerPrint, 2000);
  };

  const handlePrint = async () => {
    try {
      console.log('[WaiverDetailScreen] Print - Waiver data:', {
        id: waiver.id,
        phone_number: waiver.phone_number,
        email: waiver.email,
        first_name: waiver.first_name,
        last_name: waiver.last_name
      });

      if (waiver?._dataSource === 'legacy') {
        const effectiveExp = getEffectiveWaiverExpiryDateForDetail(
          waiver,
          defaultExpiryDays,
          globalExpiryFetchDone
        );
        const printHTML = buildLegacyRecreatedWaiverHtml({
          waiver,
          participants: waiver.waiver_participants || [],
          effectiveExp,
          businessTimezone
        });

        printHtmlOnce(printHTML);
        return;
      }
      
      // Load consents
      const { data: consents } = await supabase
        .from('waiver_consents')
        .select('*')
        .eq('waiver_id', waiver.id);

      // Generate print-friendly HTML
      const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Waiver - ${waiver.first_name} ${waiver.last_name}</title>
          <style>
            @media print {
              @page {
                margin: 0.5in;
              }
              body {
                margin: 0;
                padding: 0;
              }
            }
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 8.5in;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid #000;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 24px;
            }
            .section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            .section-title {
              font-size: 18px;
              font-weight: bold;
              margin-bottom: 15px;
              border-bottom: 1px solid #ccc;
              padding-bottom: 5px;
            }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              margin-bottom: 20px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
            }
            .info-label {
              font-weight: bold;
              margin-bottom: 5px;
              color: #666;
            }
            .waiver-content {
              margin: 20px 0;
              padding: 15px;
              border: 1px solid #ddd;
              background: #f9f9f9;
              white-space: break-spaces;
              word-break: break-word;
            }
            .participant {
              margin-bottom: 25px;
              padding: 15px;
              border: 1px solid #ddd;
              border-radius: 5px;
              page-break-inside: avoid;
            }
            .participant-header {
              font-weight: bold;
              font-size: 16px;
              margin-bottom: 10px;
              color: #333;
            }
            .signature-section {
              margin-top: 15px;
              padding-top: 15px;
              border-top: 1px solid #ddd;
            }
            .signature-image {
              max-width: 300px;
              max-height: 100px;
              border: 1px solid #ccc;
              margin-top: 10px;
            }
            .consent-item {
              margin: 10px 0;
              padding: 10px;
              background: #f0f0f0;
              border-left: 3px solid #4CAF50;
            }
            .consent-item.declined {
              border-left-color: #f44336;
            }
            .consent-type {
              font-weight: bold;
              text-transform: capitalize;
            }
            .footer {
              margin-top: 40px;
              padding-top: 20px;
              border-top: 2px solid #000;
              text-align: center;
              font-size: 13px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${waiver.waiver_templates?.waiver_title || 'Waiver Document'}</h1>
            <p>Signed: ${waiver.signed_at ? formatDateTimeForBusiness(waiver.signed_at, businessTimezone) : 'Not signed'}</p>
          </div>

          <div class="section">
            <div class="section-title">Primary Signer Information</div>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Name:</span>
                <span>${waiver.first_name} ${waiver.last_name}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Email:</span>
                <span>${waiver.email || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Phone:</span>
                <span>${waiver.phone_number || 'N/A'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Date of Birth:</span>
                <span>${formatDateOfBirthDisplay(waiver.date_of_birth)}</span>
              </div>
              ${waiver.expires_at ? `
              <div class="info-item">
                <span class="info-label">Expires:</span>
                <span>${formatDateShort(waiver.expires_at, businessTimezone)}</span>
              </div>
              ` : ''}
            </div>
            ${resolveWaiverSignatureImgSrc(waiver) ? `
            <div class="signature-section">
              <div class="info-label">Signature:</div>
              <img src="${resolveWaiverSignatureImgSrc(waiver)}" alt="Signature" class="signature-image" />
              <div style="margin-top: 5px; font-size: 13px; color: #666;">
                Signed: ${waiver.signed_at ? formatDateTimeForBusiness(waiver.signed_at, businessTimezone) : 'N/A'}
              </div>
            </div>
            ` : ''}
          </div>

          ${participants.length > 0 ? `
          <div class="section">
            <div class="section-title">Additional Participants</div>
            ${participants.map(participant => `
              <div class="participant">
                <div class="participant-header">
                  ${participant.participant_type === 'minor' ? 'Minor' : 'Adult'} Participant
                  ${participant.participant_type === 'minor' && participant.index ? ` - ${participant.index === 1 ? 'First' : participant.index === 2 ? 'Second' : participant.index === 3 ? 'Third' : `${participant.index}th`} Minor` : ''}
                </div>
                <div class="info-grid">
                  <div class="info-item">
                    <span class="info-label">Name:</span>
                    <span>${participant.first_name} ${participant.last_name}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-label">Date of Birth:</span>
                    <span>${formatDateOfBirthDisplay(participant.date_of_birth)}</span>
                  </div>
                  ${participant.phone_number ? `
                  <div class="info-item">
                    <span class="info-label">Phone:</span>
                    <span>${participant.phone_number}</span>
                  </div>
                  ` : ''}
                  ${participant.email ? `
                  <div class="info-item">
                    <span class="info-label">Email:</span>
                    <span>${participant.email}</span>
                  </div>
                  ` : ''}
                </div>
                ${resolveWaiverSignatureImgSrc(participant) ? `
                <div class="signature-section">
                  <div class="info-label">Signature:</div>
                  <img src="${resolveWaiverSignatureImgSrc(participant)}" alt="Signature" class="signature-image" />
                  <div style="margin-top: 5px; font-size: 13px; color: #666;">
                    Signed: ${participant.signed_at ? formatDateTimeForBusiness(participant.signed_at, businessTimezone) : 'N/A'}
                  </div>
                </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
          ` : ''}

          <div class="section">
            <div class="section-title">Waiver Content</div>
            <div class="waiver-content">
              ${waiver.waiver_templates?.waiver_content ? waiverTemplateBodyInnerHtml(waiver.waiver_templates.waiver_content) : 'No waiver content available.'}
            </div>
          </div>

          ${consents && consents.length > 0 ? `
          <div class="section">
            <div class="section-title">Consents</div>
            ${consents.map(consent => `
              <div class="consent-item ${consent.consent_given ? '' : 'declined'}">
                <div class="consent-type">${waiverConsentTypeLabel(consent.consent_type)}</div>
                <div>Status: ${consent.consent_given ? '✓ Granted' : '✗ Declined'}</div>
                ${consent.consent_text ? `<div style="margin-top: 5px; font-style: italic;">${consent.consent_text}</div>` : ''}
                ${consent.acknowledged_at ? `<div style="margin-top: 5px; font-size: 13px; color: #666;">Acknowledged: ${formatDateTimeForBusiness(consent.acknowledged_at, businessTimezone)}</div>` : ''}
              </div>
            `).join('')}
          </div>
          ` : ''}

          <div class="footer">
            <p>This document was generated on ${formatDateTimeForBusiness(new Date(), businessTimezone)}</p>
            <p>Waiver ID: ${waiver.id}</p>
          </div>
        </body>
        </html>
      `;

      printHtmlOnce(printHTML);
    } catch (error) {
      console.error('Error generating print document:', error);
      toast.error('Error generating print document');
    }
  };

  if (loading) {
    return (
      <POSAuthWrapper componentName="WaiverDetailScreen">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading waiver...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!waiver) {
    return (
      <POSAuthWrapper componentName="WaiverDetailScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Waiver Not Found</h2>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canViewWaivers) {
    return (
      <POSAuthWrapper componentName="WaiverDetailScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Access Denied</h2>
        </div>
      </POSAuthWrapper>
    );
  }

  if (waiver?._dataSource === 'legacy') {
    const effectiveExp = getEffectiveWaiverExpiryDateForDetail(
      waiver,
      defaultExpiryDays,
      globalExpiryFetchDone
    );
    const legacyParticipants = waiver.waiver_participants || [];
    const displayLegacyParticipants = getDisplayableLegacyParticipants(legacyParticipants);
    const hasImportedPdf = Boolean(waiver.imported_pdf_storage_path || waiver._legacyPdfStoragePath);
    const signatureSvg = legacySignatureSvgMarkup(waiver.signature_strokes, { width: 170, height: 76 });
    return (
      <POSAuthWrapper componentName="WaiverDetailScreen">
        <SecurityWrapper componentName="WaiverDetailScreen" sensitiveComponent={true}>
          <div style={styles.container}>
            <div style={styles.header}>
              <div style={styles.headerLeftActions}>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard/waivers')}
                  style={styles.backButton}
                >
                  <FiArrowLeft /> Back
                </button>
                <button
                  type="button"
                  onClick={openCustomerProfile}
                  style={styles.customerProfileButton}
                  disabled={customerProfileLoading}
                >
                  <FiUser /> {customerProfileLoading ? 'Loading...' : 'Customer Profile'}
                </button>
                <button
                  type="button"
                  onClick={handleRefreshFromDatabase}
                  style={styles.customerProfileButton}
                  disabled={loading || detailRefreshing}
                  title="Reload this waiver from the database (signatures and PDF paths)"
                >
                  <FiRefreshCw /> {detailRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
            {renderCustomerProfileModal()}
            <div style={contentStyle}>
              <p
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  background: TavariStyles.colors.warningBg || '#fef3c7',
                  border: `1px solid ${TavariStyles.colors.warning || '#d97706'}`,
                  color: TavariStyles.colors.text,
                  marginBottom: '1.25rem'
                }}
              >
                <strong>Legacy import</strong> — Brought in from {waiver.source_system || 'a previous system'}. Expiry is
                estimated from your business default signing period. When minor names and DOB appear below, they came from
                a full Wallkids import (customers + minor_waivers). Otherwise the source row may have listed only a
                count. {hasImportedPdf ? 'Original imported PDF is available below.' : 'No original PDF was imported, so Tavari recreates a printable waiver record from the imported data.'}
              </p>
              <h1 style={styles.title}>
                {waiver.first_name} {waiver.last_name}
              </h1>
              <p style={styles.subtitle}>
                Legacy waiver{waiver.external_document_id ? ` • Document ID: ${waiver.external_document_id}` : ''}
              </p>
              {canDownload ? (
                <div style={styles.headerActions}>
                  {hasImportedPdf ? (
                    <button onClick={handleDownloadPDF} style={styles.actionButton}>
                      <FiDownload /> Download Original PDF
                    </button>
                  ) : null}
                  <button onClick={handlePrint} style={styles.actionButton}>
                    <FiPrinter /> Print / Save Recreated Waiver
                  </button>
                </div>
              ) : null}
              <div style={styles.legacyInfoGrid}>
                <div>
                  <div style={styles.legacyLabel}>Email</div>
                  <div>{waiver.email || '—'}</div>
                </div>
                <div>
                  <div style={styles.legacyLabel}>Phone</div>
                  <div>{waiver.phone_number || '—'}</div>
                </div>
                <div>
                  <div style={styles.legacyLabel}>Date of birth</div>
                  <div>
                    {waiver.date_of_birth
                      ? formatDateOfBirthDisplay(waiver.date_of_birth)
                      : '—'}
                  </div>
                </div>
                <div>
                  <div style={styles.legacyLabel}>Signed (import)</div>
                  <div>
                    {waiver.signed_at
                      ? formatLegacySignedDateTime(waiver, businessTimezone)
                      : '—'}
                  </div>
                </div>
                <div>
                  <div style={styles.legacyLabel}>Expires (estimated)</div>
                  <div>
                    {effectiveExp
                      ? formatDateShort(effectiveExp.toISOString(), businessTimezone)
                      : globalExpiryFetchDone
                        ? '— (set default expiry in Waiver settings)'
                        : 'Loading…'}
                  </div>
                </div>
                <div>
                  <div style={styles.legacyLabel}>Minors (count from import)</div>
                  <div>{typeof waiver.num_minors === 'number' ? waiver.num_minors : '—'}</div>
                </div>
                {waiver.legacy_row_id != null && (
                  <div>
                    <div style={styles.legacyLabel}>Source row id</div>
                    <div>{waiver.legacy_row_id}</div>
                  </div>
                )}
                {waiver.external_document_id ? (
                  <div>
                    <div style={styles.legacyLabel}>Source document id</div>
                    <div>{waiver.external_document_id}</div>
                  </div>
                ) : null}
              </div>
              {archivedPdfViewerUrl ? (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>Original imported PDF</h3>
                  <p style={styles.immutableNote}>
                    This is the Smartwaiver source document uploaded to Tavari for archive and reference.
                  </p>
                  <iframe
                    title="Imported legacy waiver PDF"
                    src={archivedPdfViewerUrl}
                    style={styles.pdfIframe}
                  />
                </div>
              ) : null}
              {archivedPdfLoadError && hasImportedPdf ? (
                <div style={styles.section}>
                  <p style={styles.warningText}>
                    Imported PDF is on file but could not be loaded for preview. Use Download Original PDF if available.
                  </p>
                </div>
              ) : null}
              {!hasImportedPdf ? (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>Recreated legacy waiver</h3>
                  <p style={styles.immutableNote}>
                    This preview is rebuilt from imported legacy fields and formatted to match the legacy PDF export.
                  </p>
                  <div style={styles.legacyPdfPage}>
                    <h2 style={styles.legacyPdfTitle}>RELEASE OF LIABILITY, WAIVER OF CLAIMS &amp; INDEMNITY AGREEMENT</h2>
                    <div style={styles.legacyPdfHeaderLine}>
                      <strong>Date:</strong>{' '}
                      {waiver.signed_at ? formatLegacySignedDateTime(waiver, businessTimezone) : '—'}
                    </div>
                    <div style={styles.legacyPdfHeaderLine}>
                      <strong>Location:</strong> 539 First St, London, ON N5V 1Z5 London Canada
                    </div>
                    <div style={styles.legacyPdfHeaderLine}>
                      <strong>Adult / Guardian:</strong> {waiver.first_name} {waiver.last_name}
                    </div>
                    <div style={styles.legacyPdfHeaderLine}>
                      <strong>Date of Birth:</strong>{' '}
                      {waiver.date_of_birth ? formatDateOfBirthDisplay(waiver.date_of_birth) : '—'}
                    </div>
                    <div style={styles.legacyPdfHeaderLine}>
                      {[waiver.phone_number, waiver.email].filter(Boolean).join(' ') || '—'}
                    </div>
                    {displayLegacyParticipants.length > 0 ? (
                      <div style={styles.legacyPdfHeaderLine}>
                        <strong>Minors</strong>
                        {displayLegacyParticipants.map((p) => (
                          <div key={p.id || `${p.first_name}-${p.last_name}`}>
                            {`${p.first_name || ''} ${p.last_name || ''}`.trim()}
                            {p.date_of_birth ? ` ${formatDateOfBirthDisplay(p.date_of_birth)}` : ''}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div
                      style={styles.legacyPdfBody}
                      dangerouslySetInnerHTML={{
                        __html:
                          waiver.waiver_templates?.waiver_content
                            ? waiverTemplateBodyInnerHtml(waiver.waiver_templates.waiver_content)
                            : '<p>No waiver template text was mapped for this legacy row.</p>'
                      }}
                    />
                    <div style={styles.legacySignatureBox}>
                      <div style={styles.legacyLabel}>Adult/Guardian signature</div>
                      {waiver.signature_strokes ? (
                        <LegacySignatureCanvas raw={waiver.signature_strokes} width={170} height={76} />
                      ) : (
                        <p style={styles.warningText}>No signature strokes were imported for this row.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {legacyParticipants.length > 0 ? (
                <div style={{ marginTop: '1.5rem' }}>
                  <WaiverParticipantList
                    participants={legacyParticipants}
                    waiver={waiver}
                    canEdit={false}
                  />
                </div>
              ) : null}
              {waiver.waiver_templates?.waiver_content ? (
                <div style={{ marginTop: '1.5rem' }}>
                  <h3 style={styles.sectionTitle}>
                    {waiver.waiver_templates.waiver_title || 'Waiver text (legacy template)'}
                  </h3>
                  <div
                    style={styles.legacyWaiverContent}
                    dangerouslySetInnerHTML={{ __html: waiverTemplateBodyInnerHtml(waiver.waiver_templates.waiver_content) }}
                  />
                </div>
              ) : null}
              {waiver.notes ? (
                <div style={styles.legacyBlock}>
                  <div style={styles.legacyLabel}>Notes</div>
                  <div style={styles.legacyNotes}>{String(waiver.notes)}</div>
                </div>
              ) : null}
              {waiver.info ? (
                <div style={styles.legacyBlock}>
                  <div style={styles.legacyLabel}>Info</div>
                  <div style={styles.legacyNotes}>{String(waiver.info)}</div>
                </div>
              ) : null}
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  const modernEffectiveExpiry = getEffectiveWaiverExpiryDateForDetail(
    waiver,
    defaultExpiryDays,
    globalExpiryFetchDone
  );

  const primaryParticipant = participants.find(
    (p) => String(p?.participant_type || '').toLowerCase() === 'primary'
  );
  const livePrimarySigSrc =
    resolveWaiverSignatureImgSrc(waiver) ||
    (primaryParticipant ? resolveWaiverSignatureImgSrc(primaryParticipant) : '');

  const canRegenerateArchivedPdf =
    canDownload && waiver._dataSource !== 'legacy' && Boolean(waiver.signed_at);

  return (
    <POSAuthWrapper componentName="WaiverDetailScreen">
      <SecurityWrapper componentName="WaiverDetailScreen" sensitiveComponent={true}>
        <div style={styles.container}>
          <div style={styles.header}>
            <div style={styles.headerLeftActions}>
              <button
                type="button"
                onClick={() => navigate('/dashboard/waivers')}
                style={styles.backButton}
              >
                <FiArrowLeft /> Back
              </button>
              <button
                type="button"
                onClick={openCustomerProfile}
                style={styles.customerProfileButton}
                disabled={customerProfileLoading}
              >
                <FiUser /> {customerProfileLoading ? 'Loading...' : 'Customer Profile'}
              </button>
            </div>
            <div style={styles.headerActions}>
              <button
                type="button"
                onClick={handleRefreshFromDatabase}
                style={styles.actionButton}
                disabled={loading || detailRefreshing}
                title="Reload this waiver and participant signatures from the database"
              >
                <FiRefreshCw /> {detailRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              {canDownload && (
                <>
                  <button onClick={handleDownloadPDF} style={styles.actionButton}>
                    <FiDownload /> Download PDF
                  </button>
                  <button onClick={handlePrint} style={styles.actionButton}>
                    <FiPrinter /> Print
                  </button>
                </>
              )}
              <button onClick={() => setShowQR(!showQR)} style={styles.actionButton}>
                <FiMaximize2 /> {showQR ? 'Hide' : 'Show'} QR Code
              </button>
            </div>
          </div>
          {renderCustomerProfileModal()}

          <div style={contentStyle}>
            <div style={styles.mainSection}>
              <div style={styles.waiverHeader}>
                <div>
                  <h1 style={styles.title}>
                    {waiver.first_name} {waiver.last_name}
                  </h1>
                  <p style={styles.subtitle}>
                    {waiver.waiver_templates?.template_name || 'Waiver'}
                  </p>
                </div>
                <WaiverStatusBadge waiver={waiver} />
              </div>

              <WaiverExpiryWarning
                waiver={waiver}
                onSendReminder={() => {
                  // Handle send reminder
                }}
                onSignNew={() => {
                  // Handle sign new
                }}
              />

              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Waiver Information</h3>
                <div style={styles.infoGrid}>
                  <div style={styles.infoItem}>
                    <label style={styles.infoLabel}>Email:</label>
                    <span>{waiver.email || 'N/A'}</span>
                  </div>
                  <div style={styles.infoItem}>
                    <label style={styles.infoLabel}>Phone:</label>
                    <span>{waiver.phone_number || 'N/A'}</span>
                  </div>
                  <div style={styles.infoItem}>
                    <label style={styles.infoLabel}>Date of Birth:</label>
                    <span>{formatDateOfBirthDisplay(waiver.date_of_birth)}</span>
                  </div>
                  <div style={styles.infoItem}>
                    <label style={styles.infoLabel}>Signed</label>
                    <div style={styles.signedExpiresStack}>
                      <span>
                        {waiver.signed_at ? formatDateTimeForBusiness(waiver.signed_at, businessTimezone) : 'Not signed'}
                      </span>
                      <span style={styles.expiresUnderSigned}>
                        {modernEffectiveExpiry
                          ? `Expires ${formatDateShort(modernEffectiveExpiry.toISOString(), businessTimezone)}`
                          : globalExpiryFetchDone
                            ? 'No expiry configured'
                            : 'Loading expiry...'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <WaiverParticipantList
                participants={participants}
                waiver={waiver}
                canEdit={false}
              />

              {livePrimarySigSrc ? (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>Primary signer signature (database)</h3>
                  <p style={styles.immutableNote}>
                    Pulled from the stored waiver record. The official PDF below is a snapshot from signing time; it
                    does not change if the image was still uploading when the PDF was created.
                  </p>
                  <img
                    src={livePrimarySigSrc}
                    alt="Primary signer signature"
                    style={styles.liveSignatureImg}
                    onError={(e) => {
                      const url =
                        resolveWaiverSignatureStorageUrl(waiver) ||
                        (primaryParticipant ? resolveWaiverSignatureStorageUrl(primaryParticipant) : '');
                      if (url && e.currentTarget.src !== url) e.currentTarget.src = url;
                    }}
                  />
                </div>
              ) : null}

              {archivedPdfViewerUrl && (
                <div style={styles.section}>
                  <div style={styles.pdfSectionHeader}>
                    <h3 style={{ ...styles.sectionTitle, marginBottom: 0 }}>Official signed record (PDF)</h3>
                    {canRegenerateArchivedPdf ? (
                      <button
                        type="button"
                        onClick={handleRegenerateArchivedPdf}
                        style={styles.regenerateArchivedPdfButton}
                        disabled={regeneratingArchivedPdf}
                        title="Re-upload the archived PDF using current waiver and signature data (owner, manager, or admin)"
                      >
                        {regeneratingArchivedPdf ? 'Rebuilding…' : 'Rebuild archived PDF'}
                      </button>
                    ) : null}
                  </div>
                  <p style={styles.immutableNote}>
                    This is the archived legal copy captured at signing. Use Rebuild if the PDF is missing a signature
                    but the database copy above is correct.
                  </p>
                  <iframe
                    key={`archived-pdf-${archivedPdfReloadKey}-${waiver.id}`}
                    title="Signed waiver PDF"
                    src={archivedPdfViewerUrl}
                    style={styles.pdfIframe}
                  />
                </div>
              )}

              {archivedPdfLoadError && waiver.signed_pdf_uploaded_at && (
                <div style={styles.section}>
                  <p style={styles.warningText}>
                    Archived PDF is on file but could not be loaded for preview. Use Download PDF if available.
                  </p>
                </div>
              )}

              {waiver.waiver_templates && (
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>
                    {archivedPdfViewerUrl ? 'Template reference (live)' : 'Waiver content'}
                  </h3>
                  {archivedPdfViewerUrl ? (
                    <p style={styles.immutableNote}>
                      For legal purposes, rely on the PDF above. This block shows the current template in your account
                      and may differ from older signed versions.
                    </p>
                  ) : (
                    <p style={styles.warningText}>
                      No archived PDF on file for this waiver (legacy or archival failed). Content below is from the
                      current template and may not match what was signed.
                    </p>
                  )}
                  <div
                    style={styles.waiverContent}
                    dangerouslySetInnerHTML={{ __html: waiverTemplateBodyInnerHtml(waiver.waiver_templates.waiver_content || '') }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background,
    padding: TavariStyles.spacing.xl,
    paddingTop: 0
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.xl
  },
  backButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs
  },
  headerLeftActions: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    flexWrap: 'wrap'
  },
  customerProfileButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `1px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  headerActions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm
  },
  actionButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs
  },
  content: {
    maxWidth: '1200px',
    margin: '0 auto'
  },
  mainSection: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows.sm
  },
  waiverHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.xl,
    borderBottom: `1px solid ${TavariStyles.colors.gray300}`
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  subtitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    margin: 0
  },
  section: {
    marginBottom: TavariStyles.spacing.xl
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.md
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: TavariStyles.spacing.md
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },
  infoLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    color: TavariStyles.colors.gray600
  },
  signedExpiresStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  expiresUnderSigned: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600
  },
  waiverContent: {
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    maxHeight: '500px',
    overflowY: 'auto',
    whiteSpace: 'break-spaces',
    wordBreak: 'break-word'
  },
  pdfIframe: {
    width: '100%',
    minHeight: '720px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.gray50
  },
  pdfSectionHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.sm
  },
  regenerateArchivedPdfButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `1px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  liveSignatureImg: {
    display: 'block',
    maxWidth: '280px',
    maxHeight: '120px',
    objectFit: 'contain',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.sm,
    backgroundColor: TavariStyles.colors.white
  },
  immutableNote: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.md,
    lineHeight: 1.5
  },
  warningText: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.warning || '#b45309',
    marginBottom: TavariStyles.spacing.md,
    lineHeight: 1.5
  },
  legacyInfoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.xl
  },
  legacyLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.xs
  },
  legacyBlock: {
    marginTop: TavariStyles.spacing.lg
  },
  legacyNotes: {
    whiteSpace: 'break-spaces',
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5,
    color: TavariStyles.colors.text
  },
  legacyWaiverContent: {
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    maxHeight: '480px',
    overflowY: 'auto',
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5,
    whiteSpace: 'break-spaces',
    wordBreak: 'break-word'
  },
  legacySignatureBox: {
    display: 'inline-block',
    padding: TavariStyles.spacing.md,
    minWidth: 300,
    minHeight: 120,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.white
  },
  legacyPdfPage: {
    maxWidth: '8.5in',
    margin: '0 auto',
    padding: '24px',
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: TavariStyles.shadows.md,
    color: '#111827',
    fontFamily: 'Arial, sans-serif',
    fontSize: 13,
    lineHeight: 1.42
  },
  legacyPdfTitle: {
    fontSize: 19,
    lineHeight: 1.25,
    margin: '0 0 10px',
    letterSpacing: '0.01em',
    color: '#111827'
  },
  legacyPdfHeaderLine: {
    marginBottom: 4
  },
  legacyPdfBody: {
    marginTop: 16,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  customerProfileOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.lg
  },
  customerProfileLoadingOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.lg
  },
  customerProfileLoadingBox: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    boxShadow: TavariStyles.shadows.xl || TavariStyles.shadows.lg,
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  },
  customerProfileModal: {
    width: 'min(760px, 100%)',
    maxHeight: '90vh',
    overflowY: 'auto',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    boxShadow: TavariStyles.shadows.xl || TavariStyles.shadows.lg,
    padding: TavariStyles.spacing.xl
  },
  customerProfileModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg,
    paddingBottom: TavariStyles.spacing.md,
    borderBottom: `1px solid ${TavariStyles.colors.gray200 || TavariStyles.colors.gray300}`
  },
  customerProfileTitle: {
    margin: 0,
    fontSize: TavariStyles.typography.fontSize.xl,
    color: TavariStyles.colors.text
  },
  customerProfileSubtitle: {
    margin: `${TavariStyles.spacing.xs} 0 0`,
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  customerProfileCloseButton: {
    border: 'none',
    background: 'transparent',
    fontSize: 28,
    lineHeight: 1,
    cursor: 'pointer',
    color: TavariStyles.colors.gray600
  },
  customerProfileEmpty: {
    padding: TavariStyles.spacing.xl,
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md
  },
  customerProfileEmptyInline: {
    padding: TavariStyles.spacing.md,
    color: TavariStyles.colors.gray600,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md
  },
  customerProfileSummaryCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: TavariStyles.spacing.lg
  },
  customerProfileName: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.text
  },
  customerProfileContact: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginTop: 4
  },
  customerProfileActivePill: {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.success || '#047857',
    backgroundColor: TavariStyles.colors.successBg || '#d1fae5'
  },
  customerProfileBlockedPill: {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.error || '#b91c1c',
    backgroundColor: TavariStyles.colors.errorBg || '#fee2e2'
  },
  customerProfileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg
  },
  customerProfileSection: {
    marginTop: TavariStyles.spacing.lg
  },
  customerProfileNotes: {
    whiteSpace: 'pre-wrap',
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    color: TavariStyles.colors.text,
    lineHeight: 1.5
  },
  customerProfileParticipantList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  customerProfileParticipantRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200 || TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md
  },
  customerProfileParticipantName: {
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.text
  }
};

export default WaiverDetailScreen;


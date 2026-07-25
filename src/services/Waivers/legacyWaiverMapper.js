import { LEGACY_WAIVER_ID_PREFIX, normalizeDashboardWaiverId } from '../../constants/legacyWaiver';

/**
 * If the old system stored JSON in `info` or `notes` with child names, surface them.
 * Shapes we try: `minors: [{ first_name, last_name, date_of_birth? }]`, `children`, `childNames` as strings.
 */
function tryParseMinorsFromJsonFields(row) {
  for (const key of ['info', 'notes']) {
    const raw = row?.[key];
    if (raw == null) continue;
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s || s === 'info' || s === 'notes') continue;
    let j;
    try {
      j = JSON.parse(s);
    } catch {
      continue;
    }
    if (!j || typeof j !== 'object') continue;

    const fromArr =
      (Array.isArray(j.minors) && j.minors) ||
      (Array.isArray(j.children) && j.children) ||
      (Array.isArray(j.child_participants) && j.child_participants);
    if (fromArr && fromArr.length) {
      return fromArr
        .map((m, idx) => {
          if (m == null) return null;
          if (typeof m === 'string') {
            const parts = m.trim().split(/\s+/);
            return {
              id: `legacy-minor-parsed-${row.id}-${idx}`,
              waiver_id: row.id,
              participant_type: 'minor',
              first_name: parts[0] || 'Minor',
              last_name: parts.slice(1).join(' ') || `(${idx + 1} of ${fromArr.length})`,
              date_of_birth: null,
              email: null,
              phone_number: null,
              _legacyFromExportJson: true
            };
          }
          const fn = m.first_name || m.firstName || m.name || m.given;
          const ln = m.last_name || m.lastName || m.surname;
          if (!fn && !ln) return null;
          return {
            id: `legacy-minor-parsed-${row.id}-${idx}`,
            waiver_id: row.id,
            participant_type: 'minor',
            first_name: String(fn || '').trim() || '—',
            last_name: String(ln || '').trim() || '—',
            date_of_birth: m.date_of_birth || m.dob || m.dateOfBirth || null,
            email: m.email || null,
            phone_number: m.phone || m.phone_number || null,
            _legacyFromExportJson: true
          };
        })
        .filter(Boolean);
    }
  }
  return null;
}

/**
 * When the export has no per-child data (typical: only `num_minors` + junk `info` / minimal `notes`),
 * we use one synthetic row so the UI can show an honest one-line summary — not three fake "Minor 1/2/3" lines.
 * Real names/DOB only when `tryParseMinorsFromJsonFields` finds them in `info`/`notes` JSON.
 */
function minorsFromJsonbArray(row) {
  const arr = row?.legacy_minors;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr
    .map((m, idx) => {
      if (!m || typeof m !== 'object') return null;
      const fn = (m.first_name || '').trim();
      const ln = (m.last_name || '').trim();
      if (!fn && !ln) return null;
      return {
        id: `legacy-minor-j-${row.id}-${m.legacy_customer_id ?? idx}`,
        waiver_id: row.id,
        participant_type: 'minor',
        first_name: fn || '—',
        last_name: ln || '—',
        date_of_birth: m.date_of_birth || m.dob || null,
        email: m.email || null,
        phone_number: m.phone || m.phone_number || null,
        _legacyFromWallkidsImport: true
      };
    })
    .filter(Boolean);
}

function buildLegacyMinorPlaceholders(row) {
  const n = Math.max(0, Math.floor(Number(row?.num_minors) || 0));
  if (n === 0) return [];

  const fromJsonb = minorsFromJsonbArray(row);
  if (fromJsonb && fromJsonb.length > 0) {
    return fromJsonb;
  }

  const parsedRaw = tryParseMinorsFromJsonFields(row);
  if (parsedRaw && parsedRaw.length > 0) {
    const parsed = parsedRaw.slice(0, n);
    if (parsed.length < n) {
      const need = n - parsed.length;
      const startAt = parsed.length;
      for (let i = 0; i < need; i++) {
        const idx = startAt + i + 1;
        parsed.push({
          id: `legacy-minor-fill-${row.id}-${idx}`,
          waiver_id: row.id,
          participant_type: 'minor',
          first_name: `Minor ${idx}`,
          last_name: `of ${n} (name not in export)`,
          date_of_birth: null,
          email: null,
          phone_number: null,
          _legacyPlaceholder: true
        });
      }
    }
    return parsed;
  }

  return [
    {
      id: `legacy-minor-summary-${row.id}`,
      waiver_id: row.id,
      participant_type: 'minor',
      first_name: '',
      last_name: '',
      date_of_birth: null,
      email: null,
      phone_number: null,
      _legacyCountOnly: true,
      _legacyMinorCount: n
    }
  ];
}

/**
 * Map `legacy_waivers` row to the same shape the dashboard / detail use for `waiver_signatures`.
 * Expiry is not stored on `legacy_waivers`; the UI computes it from `signed_at` + business default
 * expiry days (same as unsigned-template waivers). `expires_at` stays null here.
 */
export function mapLegacyWaiverRow(row, templateRow) {
  if (!row) return null;
  const t = templateRow;
  return {
    id: normalizeDashboardWaiverId(`${LEGACY_WAIVER_ID_PREFIX}${row.id}`),
    _dataSource: 'legacy',
    business_id: row.business_id,
    customer_id: row.customer_id || null,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email || '',
    phone_number: row.phone || '',
    date_of_birth: row.date_of_birth,
    signed_at: row.signed_at || row.created_at,
    updated_at: row.updated_at || null,
    expires_at: null,
    is_valid: true,
    archived_at: row.archived_at || null,
    template_id: null,
    notes: row.notes,
    info: row.info,
    num_minors: row.num_minors,
    signature_strokes: row.signature_strokes,
    legacy_row_id: row.legacy_row_id,
    external_document_id: row.external_document_id || null,
    source_system: row.source_system,
    imported_at: row.imported_at,
    imported_pdf_storage_path: row.imported_pdf_storage_path || null,
    imported_pdf_uploaded_at: row.imported_pdf_uploaded_at || null,
    imported_pdf_sha256: row.imported_pdf_sha256 || null,
    imported_pdf_meta: row.imported_pdf_meta || null,
    _legacyPdfStoragePath: row.imported_pdf_storage_path || null,
    _legacyPdfUploadedAt: row.imported_pdf_uploaded_at || null,
    _legacyPdfMeta: row.imported_pdf_meta || null,
    waiver_templates: t
      ? {
          id: t.id,
          template_name: t.title || 'Legacy template',
          waiver_title: t.title || 'Legacy waiver',
          waiver_content: t.waiver_content || null,
          version: null,
          expiry_days: null
        }
      : {
          id: null,
          template_name: 'Legacy import',
          waiver_title: 'Legacy waiver',
          waiver_content: null,
          version: null,
          expiry_days: null
        },
    waiver_participants: buildLegacyMinorPlaceholders(row),
    waiver_consents: [],
    waiver_field_responses: []
  };
}

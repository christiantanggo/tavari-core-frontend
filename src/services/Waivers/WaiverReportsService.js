import { supabase } from '../../supabaseClient';
import { calculateAgeFromIsoDateOfBirth } from '../../utils/waiverDateOfBirth';
import {
  WAIVER_AUDIT_CONSENT_TYPES,
  WAIVER_CONSENT_CSV_HEADERS
} from '../../constants/waiverConsentTypes';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { formatDateTimeForBusiness } from '../../utils/businessDateFormat';

dayjs.extend(utc);
dayjs.extend(timezone);

function businessDayRangeIso(yyyyMmDd, businessTimezone = 'America/Toronto') {
  const start = dayjs.tz(`${yyyyMmDd} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', businessTimezone);
  if (!start.isValid()) throw new Error('Invalid date');
  const end = start.add(1, 'day');
  return { startIso: start.utc().toISOString(), endIso: end.utc().toISOString() };
}

function formatReportDateTime(value, businessTimezone = 'America/Toronto') {
  return value ? formatDateTimeForBusiness(value, businessTimezone) : '';
}

export async function fetchBusinessTimezone(businessId) {
  if (!businessId) return 'America/Toronto';
  const { data, error } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', businessId)
    .maybeSingle();

  if (error) throw error;
  return data?.timezone || 'America/Toronto';
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(columns, rows) {
  const header = columns.map((c) => csvEscape(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => csvEscape(row[c.key])).join(',')
  );
  return [header, ...lines].join('\r\n');
}

export function triggerCsvDownload(filename, csvText) {
  const blob = new Blob([`\ufeff${csvText}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function joinName(first, last) {
  return [first, last].filter(Boolean).join(' ').trim();
}

async function fetchWaiverSignaturesByIds(businessId, waiverIds) {
  const unique = [...new Set(waiverIds.filter(Boolean))];
  const map = new Map();
  const chunkSize = 200;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('waiver_signatures')
      .select('id, first_name, last_name, email, phone_number')
      .eq('business_id', businessId)
      .in('id', slice);
    if (error) throw error;
    for (const s of data || []) {
      map.set(s.id, s);
    }
  }
  return map;
}

async function fetchParticipantsByIds(participantIds) {
  const unique = [...new Set(participantIds.filter(Boolean))];
  const map = new Map();
  const chunkSize = 200;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('waiver_participants')
      .select('id, email, phone_number, first_name, last_name')
      .in('id', slice);
    if (error) throw error;
    for (const p of data || []) {
      map.set(p.id, p);
    }
  }
  return map;
}

/**
 * @param {string} businessId
 * @param {string} yyyyMmDd
 * @returns {Promise<object[]>} rows with email, phone, linked_to, linked_email, linked_phone for minors
 */
export async function fetchCheckInsForLocalDay(businessId, yyyyMmDd, businessTimezone = 'America/Toronto') {
  const { startIso, endIso } = businessDayRangeIso(yyyyMmDd, businessTimezone);
  const { data, error } = await supabase
    .from('waiver_participant_check_ins')
    .select(
      'id, waiver_id, waiver_participant_id, subject_type, display_name, checked_in_at, checked_in_by_user_id'
    )
    .eq('business_id', businessId)
    .gte('checked_in_at', startIso)
    .lt('checked_in_at', endIso)
    .order('checked_in_at', { ascending: true });

  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return [];

  const waiverIds = rows.map((r) => r.waiver_id);
  const sigById = await fetchWaiverSignaturesByIds(businessId, waiverIds);

  const partIds = rows
    .filter((r) => r.waiver_participant_id && r.subject_type !== 'primary_signer')
    .map((r) => r.waiver_participant_id);
  const partById = partIds.length ? await fetchParticipantsByIds(partIds) : new Map();

  return rows.map((r) => {
    const sig = sigById.get(r.waiver_id);
    const primaryName = sig ? joinName(sig.first_name, sig.last_name) : '';
    const primaryEmail = sig?.email ?? '';
    const primaryPhone = sig?.phone_number ?? '';

    let email = '';
    let phone = '';
    let linked_to = '';
    let linked_email = '';
    let linked_phone = '';

    if (r.subject_type === 'minor') {
      linked_to = primaryName;
      linked_email = primaryEmail;
      linked_phone = primaryPhone;
      const part = r.waiver_participant_id ? partById.get(r.waiver_participant_id) : null;
      if (part) {
        email = part.email ?? '';
        phone = part.phone_number ?? '';
      }
    } else if (r.subject_type === 'primary_signer') {
      email = primaryEmail;
      phone = primaryPhone;
    } else if (r.subject_type === 'additional_adult' && r.waiver_participant_id) {
      const part = partById.get(r.waiver_participant_id);
      if (part) {
        email = part.email ?? '';
        phone = part.phone_number ?? '';
      }
    }

    return {
      ...r,
      checked_in_at: formatReportDateTime(r.checked_in_at, businessTimezone),
      email,
      phone,
      linked_to,
      linked_email,
      linked_phone
    };
  });
}

async function fetchMarketingConsentRows(businessId, consentGiven, businessTimezone = 'America/Toronto') {
  const { data: waivers, error: wErr } = await supabase
    .from('waiver_signatures')
    .select('id, first_name, last_name, email, phone_number, signed_at')
    .eq('business_id', businessId)
    .order('signed_at', { ascending: false });

  if (wErr) throw wErr;
  const waiverList = waivers || [];
  if (waiverList.length === 0) return [];

  const waiverMap = new Map(waiverList.map((w) => [w.id, w]));
  const ids = waiverList.map((w) => w.id);
  const marketingWaiverIds = new Set();
  const chunkSize = 500;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data: consentChunk, error: cErr } = await supabase
      .from('waiver_consents')
      .select('waiver_id')
      .eq('consent_type', 'marketing')
      .eq('consent_given', consentGiven)
      .in('waiver_id', chunk);

    if (cErr) throw cErr;
    for (const row of consentChunk || []) {
      if (row?.waiver_id) marketingWaiverIds.add(row.waiver_id);
    }
  }

  const rows = [];
  for (const wid of marketingWaiverIds) {
    const w = waiverMap.get(wid);
    if (!w) continue;
    rows.push({
      waiver_id: w.id,
      first_name: w.first_name || '',
      last_name: w.last_name || '',
      email: w.email || '',
      phone_number: w.phone_number || '',
      signed_at: formatReportDateTime(w.signed_at, businessTimezone)
    });
  }

  return rows.sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
}

/**
 * Primary signers who opted in to marketing (waiver_consents marketing + consent_given).
 * Two-step query avoids embedded-filter / RLS quirks with joins.
 * @param {string} businessId
 */
export async function fetchMarketingOptInRows(businessId, businessTimezone = 'America/Toronto') {
  return fetchMarketingConsentRows(businessId, true, businessTimezone);
}

/**
 * Primary signers who explicitly opted out of marketing (waiver_consents marketing + consent_given = false).
 * @param {string} businessId
 */
export async function fetchMarketingOptOutRows(businessId, businessTimezone = 'America/Toronto') {
  return fetchMarketingConsentRows(businessId, false, businessTimezone);
}

function ageFromDob(dateOfBirth) {
  if (dateOfBirth == null || dateOfBirth === '') return null;
  if (typeof dateOfBirth === 'string') {
    const fromIso = calculateAgeFromIsoDateOfBirth(dateOfBirth);
    if (fromIso !== null) return fromIso;
  }
  const d = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const md = today.getMonth() - d.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

function isMinorParticipant(p) {
  if (!p) return false;
  const t = String(p.participant_type || '').toLowerCase();
  if (t === 'minor') return true;
  if (t === 'primary' || t === 'additional_adult') return false;
  const age = ageFromDob(p.date_of_birth);
  return age !== null && age >= 0 && age < 18;
}

/**
 * One row per minor on a waiver: linked primary signer + contact, plus first-name popularity count.
 * @param {string} businessId
 * @returns {Promise<object[]>} sorted by popularity desc, minor first name, linked adult
 */
export async function fetchMinorParticipantReportRows(businessId) {
  const pageSize = 1000;
  let from = 0;
  const allWaiverIds = [];
  for (;;) {
    const { data: page, error } = await supabase
      .from('waiver_signatures')
      .select('id')
      .eq('business_id', businessId)
      .order('signed_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const chunk = page || [];
    allWaiverIds.push(...chunk.map((r) => r.id));
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  if (allWaiverIds.length === 0) return [];

  const sigById = await fetchWaiverSignaturesByIds(businessId, allWaiverIds);

  const minorRows = [];
  const chunkSize = 500;
  for (let i = 0; i < allWaiverIds.length; i += chunkSize) {
    const slice = allWaiverIds.slice(i, i + chunkSize);
    const { data: parts, error: pErr } = await supabase
      .from('waiver_participants')
      .select('id, waiver_id, first_name, last_name, participant_type, date_of_birth')
      .in('waiver_id', slice);

    if (pErr) throw pErr;
    for (const p of parts || []) {
      if (!isMinorParticipant(p)) continue;
      const fn = (p.first_name || '').trim();
      if (!fn) continue;
      const sig = sigById.get(p.waiver_id);
      minorRows.push({
        minor_first_name: fn,
        minor_last_name: (p.last_name || '').trim(),
        waiver_id: p.waiver_id,
        linked_to: sig ? joinName(sig.first_name, sig.last_name) : '',
        linked_email: sig?.email ?? '',
        linked_phone: sig?.phone_number ?? ''
      });
    }
  }

  const popularity = new Map();
  for (const r of minorRows) {
    const k = r.minor_first_name.toLowerCase();
    popularity.set(k, (popularity.get(k) || 0) + 1);
  }

  for (const r of minorRows) {
    r.first_name_popularity_count = popularity.get(r.minor_first_name.toLowerCase()) || 0;
  }

  minorRows.sort(
    (a, b) =>
      b.first_name_popularity_count - a.first_name_popularity_count ||
      a.minor_first_name.localeCompare(b.minor_first_name) ||
      a.linked_to.localeCompare(b.linked_to)
  );

  return minorRows;
}

function consentYesNo(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

/**
 * @param {object[]} consentRows - rows from waiver_consents for one waiver
 * @returns {Map<string, { given: boolean, detail: string }>}
 */
function reduceConsentRowsForWaiver(consentRows) {
  const byType = new Map();
  for (const r of consentRows || []) {
    const t = r.consent_type;
    if (!t) continue;
    const prev = byType.get(t);
    const given = !!r.consent_given || !!(prev && prev.given);
    let detail = prev?.detail || '';
    const text = r.consent_text != null && String(r.consent_text).trim() ? String(r.consent_text).trim() : '';
    if (text) detail = text;
    byType.set(t, { given, detail });
  }
  return byType;
}

/**
 * One row per signed waiver with a column per auditable consent/acknowledgement type.
 * @param {string} businessId
 */
export async function fetchWaiverConsentAuditRows(businessId, businessTimezone = 'America/Toronto') {
  const pageSize = 500;
  let from = 0;
  const signatures = [];
  for (;;) {
    const { data: page, error } = await supabase
      .from('waiver_signatures')
      .select('id, first_name, last_name, email, phone_number, signed_at')
      .eq('business_id', businessId)
      .order('signed_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const chunk = page || [];
    signatures.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  if (signatures.length === 0) return [];

  const ids = signatures.map((s) => s.id);
  const consentLists = new Map();
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const { data: consents, error: cErr } = await supabase
      .from('waiver_consents')
      .select('waiver_id, consent_type, consent_given, consent_text')
      .in('waiver_id', slice);

    if (cErr) throw cErr;
    for (const c of consents || []) {
      const wid = c.waiver_id;
      if (!consentLists.has(wid)) consentLists.set(wid, []);
      consentLists.get(wid).push(c);
    }
  }

  return signatures.map((sig) => {
    const consentMap = reduceConsentRowsForWaiver(consentLists.get(sig.id) || []);
    const row = {
      waiver_id: sig.id,
      first_name: sig.first_name || '',
      last_name: sig.last_name || '',
      email: sig.email || '',
      phone_number: sig.phone_number || '',
      signed_at: formatReportDateTime(sig.signed_at, businessTimezone)
    };
    for (const t of WAIVER_AUDIT_CONSENT_TYPES) {
      const entry = consentMap.get(t);
      row[`consent_${t}`] = entry ? consentYesNo(entry.given) : '';
    }
    const adultIntent = consentMap.get('additional_adult_intent');
    row.additional_adult_intent_detail = adultIntent?.detail || '';
    return row;
  });
}

/** Column defs for buildCsv (waiver consent audit export). */
export function waiverConsentAuditCsvColumns() {
  const base = [
    { key: 'waiver_id', header: 'Waiver ID' },
    { key: 'signed_at', header: 'Signed at' },
    { key: 'first_name', header: 'First name' },
    { key: 'last_name', header: 'Last name' },
    { key: 'email', header: 'Email' },
    { key: 'phone_number', header: 'Phone' }
  ];
  const consentCols = WAIVER_AUDIT_CONSENT_TYPES.map((t) => ({
    key: `consent_${t}`,
    header: WAIVER_CONSENT_CSV_HEADERS[t] || t
  }));
  return [
    ...base,
    ...consentCols,
    { key: 'additional_adult_intent_detail', header: WAIVER_CONSENT_CSV_HEADERS.additional_adult_intent_detail }
  ];
}

// Step 51: Create WaiversService.js
// Core service for Waivers functionality
import { supabase } from '../../supabaseClient';
import {
  isLegacyWaiverId,
  normalizeDashboardWaiverId,
  parseLegacyWaiverUuid
} from '../../constants/legacyWaiver';
import { mapLegacyWaiverRow } from './legacyWaiverMapper';
import waiverOTPService from './WaiverOTPService';
import {
  LEGACY_WAIVER_LIST_COLUMNS,
  WAIVER_PARTICIPANT_LIST_COLUMNS,
  WAIVER_SIGNATURE_LIST_SELECT
} from '../../constants/waiverListColumns';
import { applyWaiverArchiveFilter } from '../../utils/waiverArchiveQuery';

/** Default dashboard overview — staff use search for older waivers. */
const OVERVIEW_LIST_LIMIT = 50;
const SEARCH_LIST_LIMIT = 500;
const PARTICIPANT_SEARCH_LIMIT = 500;

class WaiversService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async invokeWaiverArchiveFunction(payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
    };

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/waiver-archive-email`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const responseJson = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(responseJson?.error || 'Failed to run waiver archive action');
    }

    return responseJson;
  }

  /**
   * PostgREST `or()` uses comma-separated clauses — escape `%` / `_` / `\\` for literal ilike, and
   * strip `,` / parens in user input that would break the filter string.
   */
  _escapeIlikePattern(needle) {
    if (needle == null) return '';
    return String(needle)
      .replace(/\\/g, '\\\\')
      .replace(/[%_]/g, (ch) => `\\${ch}`)
      .replace(/,/g, ' ')
      .replace(/[()]/g, ' ');
  }

  _parseLastNameFirstInitialSearch(rawSearch) {
    const parts = String(rawSearch || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length !== 2) return null;

    const [lastName, firstInitial] = parts;
    if (!lastName || !firstInitial || firstInitial.length !== 1 || !/^[a-z]$/i.test(firstInitial)) {
      return null;
    }

    return {
      lastName: this._escapeIlikePattern(lastName),
      firstInitial: this._escapeIlikePattern(firstInitial)
    };
  }

  _applyWaiverListFilters(query, filters) {
    const raw = filters.search && String(filters.search).trim();
    const pat = raw ? this._escapeIlikePattern(raw) : '';
    const lastFirst = this._parseLastNameFirstInitialSearch(raw);
    let q = query;
    if (filters.customerId) {
      q = q.eq('customer_id', filters.customerId);
    }
    if (filters.isValid !== undefined) {
      q = q.eq('is_valid', filters.isValid);
    }
    if (filters.templateId) {
      q = q.eq('template_id', filters.templateId);
    }
    q = applyWaiverArchiveFilter(q, filters);
    if (pat) {
      const clauses = [
        `first_name.ilike.%${pat}%`,
        `last_name.ilike.%${pat}%`,
        `email.ilike.%${pat}%`,
        `phone_number.ilike.%${pat}%`
      ];
      const qDigits = String(filters.search || '').replace(/\D/g, '');
      if (qDigits.length >= 3) {
        clauses.push(`phone_number.ilike.%${qDigits}%`);
      }
      if (lastFirst) {
        clauses.push(`and(last_name.ilike.%${lastFirst.lastName}%,first_name.ilike.${lastFirst.firstInitial}%)`);
      }
      q = q.or(clauses.join(','));
    }
    return q;
  }

  _searchTokens(rawSearch) {
    return String(rawSearch || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  _buildParticipantSearchOrClauses(rawSearch, pat, lastFirst) {
    const clauses = [
      `first_name.ilike.%${pat}%`,
      `last_name.ilike.%${pat}%`,
      `email.ilike.%${pat}%`,
      `phone_number.ilike.%${pat}%`
    ];
    const tokens = this._searchTokens(rawSearch);
    if (tokens.length === 2) {
      const [wordA, wordB] = tokens.map((token) => this._escapeIlikePattern(token));
      if (wordA && wordB) {
        clauses.push(`and(first_name.ilike.%${wordA}%,last_name.ilike.%${wordB}%)`);
        clauses.push(`and(first_name.ilike.%${wordB}%,last_name.ilike.%${wordA}%)`);
      }
    }
    if (lastFirst) {
      clauses.push(
        `and(last_name.ilike.%${lastFirst.lastName}%,first_name.ilike.${lastFirst.firstInitial}%)`
      );
    }
    return clauses;
  }

  _appendLegacySearchClauses(legQuery, hasSearch, pat, lastFirst, rawSearch = '') {
    if (!hasSearch) return legQuery;
    const legacyClauses = [
      `first_name.ilike.%${pat}%`,
      `last_name.ilike.%${pat}%`,
      `email.ilike.%${pat}%`,
      `phone.ilike.%${pat}%`,
      `external_document_id.ilike.%${pat}%`,
      `notes.ilike.%${pat}%`,
      `info.ilike.%${pat}%`,
      `legacy_minors.ilike.%${pat}%`
    ];
    for (const token of this._searchTokens(rawSearch)) {
      const tokenPat = this._escapeIlikePattern(token);
      if (tokenPat) {
        legacyClauses.push(`legacy_minors.ilike.%${tokenPat}%`);
      }
    }
    if (lastFirst) {
      legacyClauses.push(
        `and(last_name.ilike.%${lastFirst.lastName}%,first_name.ilike.${lastFirst.firstInitial}%)`
      );
    }
    return legQuery.or(legacyClauses.join(','));
  }

  _legacyRowsQuery(archiveFilters) {
    return applyWaiverArchiveFilter(
      supabase
        .from('legacy_waivers')
        .select(LEGACY_WAIVER_LIST_COLUMNS)
        .eq('business_id', this.businessId)
        .is('deleted_at', null),
      archiveFilters
    );
  }

  /** Smartwaiver / Wallkids imports — search respects includeArchived like modern waiver_signatures. */
  async _searchLegacyWaivers(searchTrim, limit = SEARCH_LIST_LIMIT, archiveFilters = {}) {
    const lim = Math.min(SEARCH_LIST_LIMIT, Math.max(1, limit || SEARCH_LIST_LIMIT));
    const includeArchived = archiveFilters.includeArchived === true;
    const pat = this._escapeIlikePattern(searchTrim);
    const lastFirst = this._parseLastNameFirstInitialSearch(searchTrim);

    const runFallback = (filters, fbLimit) =>
      this._appendLegacySearchClauses(
        applyWaiverArchiveFilter(
          supabase
            .from('legacy_waivers')
            .select(LEGACY_WAIVER_LIST_COLUMNS)
            .eq('business_id', this.businessId)
            .is('deleted_at', null),
          filters
        ),
        true,
        pat,
        lastFirst,
        searchTrim
      )
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(fbLimit);

    const searchLegacyPool = async (incArchived, poolLimit, fallbackFilters) => {
      const { data, error } = await supabase.rpc('waivers_search_legacy_waivers', {
        p_business_id: this.businessId,
        p_search: searchTrim,
        p_limit: poolLimit,
        p_include_archived: incArchived
      });
      if (!error) return data || [];
      console.warn('[WaiversService] waivers_search_legacy_waivers RPC failed, falling back:', error);
      const { data: fallback, error: fbErr } = await runFallback(fallbackFilters, poolLimit);
      if (fbErr) throw fbErr;
      return fallback || [];
    };

    if (includeArchived) {
      const perLimit = Math.ceil(lim / 2);
      const [activeRows, archivedRows] = await Promise.all([
        searchLegacyPool(false, perLimit, { archivedOnly: false }),
        (async () => {
          const { data, error } = await runFallback({ archivedOnly: true }, perLimit);
          if (error) throw error;
          return data || [];
        })()
      ]);
      return this._mergeWaiverRowsById(activeRows, archivedRows);
    }

    return searchLegacyPool(false, lim, { archivedOnly: false });
  }

  _mergeWaiverRowsById(primary, extra) {
    const m = new Map();
    for (const r of primary || []) {
      if (r && r.id) m.set(r.id, r);
    }
    for (const r of extra || []) {
      if (r && r.id && !m.has(r.id)) m.set(r.id, r);
    }
    return Array.from(m.values());
  }

  async _getLegacyWaiverTemplateMap() {
    try {
      const { data, error } = await supabase
        .from('legacy_waiver_templates')
        .select('id, legacy_template_id, title, waiver_content')
        .eq('business_id', this.businessId);
      if (error || !data) return new Map();
      return new Map(data.map((t) => [t.legacy_template_id, t]));
    } catch {
      return new Map();
    }
  }

  _timestampMs(value) {
    if (!value) return 0;
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  _waiverSignedAt(row) {
    return row?.signed_at || row?.created_at || null;
  }

  _waiverOverviewActivityAt(row) {
    const signedAt = this._waiverSignedAt(row);
    const checkInAt = row?.last_check_in_at || null;
    return this._timestampMs(checkInAt) >= this._timestampMs(signedAt) ? checkInAt : signedAt;
  }

  _withOverviewActivity(row, lastCheckInAtByWaiverId) {
    if (!row?.id) return row;
    const lastCheckInAt = lastCheckInAtByWaiverId.get(normalizeDashboardWaiverId(row.id)) || null;
    return {
      ...row,
      last_check_in_at: lastCheckInAt,
      overview_activity_at: this._waiverOverviewActivityAt({
        ...row,
        last_check_in_at: lastCheckInAt
      })
    };
  }

  _chunk(values, size = 200) {
    const chunks = [];
    for (let i = 0; i < values.length; i += size) {
      chunks.push(values.slice(i, i + size));
    }
    return chunks;
  }

  async _getLastCheckInAtByWaiverId(waiverIds = []) {
    const out = new Map();
    if (!this.businessId) return out;

    const normalizedIds = [
      ...new Set((waiverIds || []).map((id) => normalizeDashboardWaiverId(id)).filter(Boolean))
    ];
    const modernWaiverIds = normalizedIds.filter((id) => !isLegacyWaiverId(id));
    const legacyWaiverIds = normalizedIds.map((id) => parseLegacyWaiverUuid(id)).filter(Boolean);

    const putMax = (rawWaiverId, checkedInAt) => {
      const waiverId = normalizeDashboardWaiverId(rawWaiverId);
      if (!waiverId || !checkedInAt) return;
      const prev = out.get(waiverId);
      if (!prev || this._timestampMs(checkedInAt) > this._timestampMs(prev)) {
        out.set(waiverId, checkedInAt);
      }
    };

    try {
      if (normalizedIds.length > 0) {
        const waiverQueries = [];
        for (const chunk of this._chunk(modernWaiverIds)) {
          waiverQueries.push(
            supabase
              .from('waiver_participant_check_ins')
              .select('waiver_id, legacy_waiver_id, checked_in_at')
              .eq('business_id', this.businessId)
              .in('waiver_id', chunk)
              .order('checked_in_at', { ascending: false })
          );
        }
        for (const chunk of this._chunk(legacyWaiverIds)) {
          waiverQueries.push(
            supabase
              .from('waiver_participant_check_ins')
              .select('waiver_id, legacy_waiver_id, checked_in_at')
              .eq('business_id', this.businessId)
              .in('legacy_waiver_id', chunk)
              .order('checked_in_at', { ascending: false })
          );
        }

        const bookingQueries = this._chunk(modernWaiverIds).map((chunk) =>
          supabase
            .from('booking_participants')
            .select('waiver_id, checked_in_at, bookings!inner(business_id)')
            .eq('bookings.business_id', this.businessId)
            .in('waiver_id', chunk)
            .not('checked_in_at', 'is', null)
            .order('checked_in_at', { ascending: false })
        );

        const results = await Promise.all([...waiverQueries, ...bookingQueries]);
        for (const result of results) {
          if (result.error) {
            console.warn('[WaiversService] exact check-in activity load failed:', result.error);
            continue;
          }
          for (const row of result.data || []) {
            const rawWaiverId = row.legacy_waiver_id
              ? `legacy-${String(row.legacy_waiver_id)}`
              : row.waiver_id != null
                ? String(row.waiver_id)
                : null;
            putMax(rawWaiverId, row.checked_in_at);
          }
        }
      } else {
        const [waiverCheckIns, bookingCheckIns] = await Promise.all([
          supabase
            .from('waiver_participant_check_ins')
            .select('waiver_id, legacy_waiver_id, checked_in_at')
            .eq('business_id', this.businessId)
            .order('checked_in_at', { ascending: false })
            .limit(100000),
          supabase
            .from('booking_participants')
            .select('waiver_id, checked_in_at, bookings!inner(business_id)')
            .eq('bookings.business_id', this.businessId)
            .not('waiver_id', 'is', null)
            .not('checked_in_at', 'is', null)
            .order('checked_in_at', { ascending: false })
            .limit(100000)
        ]);

        if (waiverCheckIns.error) {
          console.warn('[WaiversService] waiver check-in activity load failed:', waiverCheckIns.error);
        } else {
          for (const row of waiverCheckIns.data || []) {
            const rawWaiverId = row.legacy_waiver_id
              ? `legacy-${String(row.legacy_waiver_id)}`
              : row.waiver_id != null
                ? String(row.waiver_id)
                : null;
            putMax(rawWaiverId, row.checked_in_at);
          }
        }

        if (bookingCheckIns.error) {
          console.warn('[WaiversService] booking check-in activity load failed:', bookingCheckIns.error);
        } else {
          for (const row of bookingCheckIns.data || []) {
            putMax(row.waiver_id != null ? String(row.waiver_id) : null, row.checked_in_at);
          }
        }
      }
    } catch (e) {
      console.warn('[WaiversService] check-in activity exception:', e);
    }

    return out;
  }

  // Get all waivers for business
  async getWaivers(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const searchTrim = (filters.search && String(filters.search).trim()) || '';
    const hasSearch = searchTrim.length > 0;
    const pat = hasSearch ? this._escapeIlikePattern(searchTrim) : '';
    const lastFirst = this._parseLastNameFirstInitialSearch(searchTrim);

    // Load legacy: with search, query `ilike` on the server (entire import, not a random 100k slice).
    let legacyMapped = [];
    const legacyTplMap = await this._getLegacyWaiverTemplateMap();
    try {
      const legacyLimit = hasSearch ? SEARCH_LIST_LIMIT : OVERVIEW_LIST_LIMIT;
      let legacyRows = [];
      let legError = null;

      if (hasSearch) {
        try {
          legacyRows = await this._searchLegacyWaivers(searchTrim, legacyLimit, filters);
        } catch (searchErr) {
          legError = searchErr;
          legacyRows = [];
        }
      } else {
        const legacyOrder = (q) =>
          q
            .order('updated_at', { ascending: false, nullsFirst: false })
            .order('signed_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false, nullsFirst: false });
        const res = await legacyOrder(this._legacyRowsQuery(filters)).limit(legacyLimit);
        legError = res.error;
        legacyRows = res.data || [];
      }

      if (!legError) {

        // Critical for imported legacy rows: a recently checked-in legacy waiver must be present
        // in the row set before activity sorting. Older check-ins may predate the parent
        // `legacy_waivers.updated_at` touch, so ordering only by legacy row timestamps can miss them.
        if (!hasSearch) {
          const { data: recentLegacyCheckIns, error: recentLegacyCheckInsError } = await supabase
            .from('waiver_participant_check_ins')
            .select('legacy_waiver_id, checked_in_at')
            .eq('business_id', this.businessId)
            .not('legacy_waiver_id', 'is', null)
            .order('checked_in_at', { ascending: false })
            .limit(OVERVIEW_LIST_LIMIT);

          if (recentLegacyCheckInsError) {
            console.warn('[WaiversService] recent legacy check-in waiver ids load failed:', recentLegacyCheckInsError);
          } else {
            const loadedLegacyIds = new Set((legacyRows || []).map((row) => row?.id).filter(Boolean));
            const recentLegacyIds = [
              ...new Set(
                (recentLegacyCheckIns || [])
                  .map((row) => row?.legacy_waiver_id)
                  .filter((id) => id && !loadedLegacyIds.has(id))
              )
            ];
            const extraLegacyRows = [];
            for (const chunk of this._chunk(recentLegacyIds, 200)) {
              const { data: extraRows, error: extraRowsError } = await applyWaiverArchiveFilter(
                supabase
                  .from('legacy_waivers')
                  .select(LEGACY_WAIVER_LIST_COLUMNS)
                  .eq('business_id', this.businessId)
                  .is('deleted_at', null),
                filters
              ).in('id', chunk);
              if (extraRowsError) {
                console.warn('[WaiversService] recent checked-in legacy rows load failed:', extraRowsError);
              } else if (extraRows) {
                extraLegacyRows.push(...extraRows);
              }
            }
            if (extraLegacyRows.length) {
              const byId = new Map();
              for (const row of legacyRows) {
                if (row?.id) byId.set(row.id, row);
              }
              for (const row of extraLegacyRows) {
                if (row?.id) byId.set(row.id, row);
              }
              legacyRows = Array.from(byId.values());
            }
          }
        }

        legacyMapped = legacyRows
          .map((row) => {
            try {
              const tid = row.legacy_waiver_template_id;
              const tpl = tid == null || tid === '' ? null : legacyTplMap.get(Number(tid));
              return mapLegacyWaiverRow(row, tpl);
            } catch (e) {
              console.warn('[WaiversService] mapLegacyWaiverRow skipped row:', e);
              return null;
            }
          })
          .filter(Boolean);
      } else {
        console.warn('[WaiversService] legacy_waivers load failed:', legError);
      }
    } catch (e) {
      console.warn('[WaiversService] legacy_waivers exception:', e);
    }

    if (filters.customerId) {
      legacyMapped = [];
    }
    if (filters.templateId) {
      legacyMapped = [];
    }
    if (filters.isValid === false) {
      legacyMapped = [];
    }

    // List view: narrow columns only (no signature_data / image blobs).
    const searchIncludesArchived = hasSearch && filters.includeArchived === true;
    const sigLimit = hasSearch ? SEARCH_LIST_LIMIT : OVERVIEW_LIST_LIMIT;

    const runSignaturesQuery = (archiveFilters) => {
      const scoped = {
        ...filters,
        includeArchived: false,
        archivedOnly: false,
        ...archiveFilters
      };
      let q = supabase
        .from('waiver_signatures')
        .select(WAIVER_SIGNATURE_LIST_SELECT)
        .eq('business_id', this.businessId);
      q = this._applyWaiverListFilters(q, scoped);
      return q
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(sigLimit);
    };

    let dataRowsPrimary;
    let sigError;

    if (searchIncludesArchived) {
      const perLimit = Math.ceil(sigLimit / 2);
      const [activeRes, archivedRes] = await Promise.all([
        runSignaturesQuery({ archivedOnly: false }).limit(perLimit),
        runSignaturesQuery({ archivedOnly: true }).limit(perLimit)
      ]);
      sigError = activeRes.error || archivedRes.error;
      dataRowsPrimary = this._mergeWaiverRowsById(activeRes.data || [], archivedRes.data || []);
    } else {
      const res = await runSignaturesQuery({ archivedOnly: false });
      sigError = res.error;
      dataRowsPrimary = res.data || [];
    }

    if (sigError) {
      console.error('[WaiversService] waiver_signatures:', sigError);
      const lastCheckInAtByWaiverId = await this._getLastCheckInAtByWaiverId(
        legacyMapped.map((w) => w.id).filter(Boolean)
      );
      return legacyMapped.length
        ? legacyMapped
            .map((w) => this._withOverviewActivity(w, lastCheckInAtByWaiverId))
            .sort(
              (a, b) =>
                this._timestampMs(b.overview_activity_at) -
                this._timestampMs(a.overview_activity_at)
            )
        : [];
    }

    let waivers = dataRowsPrimary || [];

    if (!hasSearch) {
      // Pull in waivers checked in recently even if their signature row is older than the top-N slice.
      try {
        const { data: recentCheckIns, error: recentCiErr } = await supabase
          .from('waiver_participant_check_ins')
          .select('waiver_id, legacy_waiver_id')
          .eq('business_id', this.businessId)
          .order('checked_in_at', { ascending: false })
          .limit(OVERVIEW_LIST_LIMIT);

        if (recentCiErr) {
          console.warn('[WaiversService] recent check-in waiver ids:', recentCiErr);
        } else {
          const loadedIds = new Set((waivers || []).map((r) => r?.id).filter(Boolean));
          const extraModernIds = [
            ...new Set(
              (recentCheckIns || [])
                .map((row) => row?.waiver_id)
                .filter((id) => id && !loadedIds.has(id))
            )
          ];
          const extraSigs = [];
          for (const chunk of this._chunk(extraModernIds, 150)) {
            const { data: ex, error: exErr } = await applyWaiverArchiveFilter(
              supabase
                .from('waiver_signatures')
                .select(WAIVER_SIGNATURE_LIST_SELECT)
                .eq('business_id', this.businessId)
                .in('id', chunk),
              filters
            );
            if (exErr) {
              console.warn('[WaiversService] recent check-in waiver batch:', exErr);
            } else if (ex) {
              extraSigs.push(...ex);
            }
          }
          if (extraSigs.length) {
            waivers = this._mergeWaiverRowsById(waivers, extraSigs);
          }
        }
      } catch (e) {
        console.warn('[WaiversService] recent check-in merge exception:', e);
      }
    } else {
      // Waivers that match a minor or additional adult name / phone, not the primary signer.
      const primaryIds = new Set((dataRowsPrimary || []).map((r) => r.id).filter(Boolean));
      try {
        const { data: pRows, error: pErr } = await supabase.rpc('waivers_search_participant_waiver_ids', {
          p_business_id: this.businessId,
          p_search: searchTrim,
          p_limit: PARTICIPANT_SEARCH_LIMIT
        });
        if (pErr) {
          console.warn('[WaiversService] participant search RPC failed, falling back:', pErr);
          const fallbackQuery = supabase
            .from('waiver_participants')
            .select('waiver_id, waiver_signatures!inner(business_id)')
            .eq('waiver_signatures.business_id', this.businessId)
            .or(this._buildParticipantSearchOrClauses(searchTrim, pat, lastFirst).join(','))
            .not('waiver_id', 'is', null)
            .limit(PARTICIPANT_SEARCH_LIMIT);
          const { data: fallbackRows, error: fallbackErr } = await fallbackQuery;
          if (fallbackErr) {
            console.warn('[WaiversService] participant search fallback:', fallbackErr);
          } else {
            const wantIds = [
              ...new Set(
                (fallbackRows || [])
                  .map((p) => p.waiver_id)
                  .filter(Boolean)
                  .filter((id) => !primaryIds.has(id))
              )
            ];
            const CH = 150;
            const extraSigs = [];
            for (let i = 0; i < wantIds.length; i += CH) {
              const chunk = wantIds.slice(i, i + CH);
              const { data: ex, error: exErr } = await applyWaiverArchiveFilter(
                supabase
                  .from('waiver_signatures')
                  .select(WAIVER_SIGNATURE_LIST_SELECT)
                  .in('id', chunk)
                  .eq('business_id', this.businessId),
                filters
              );
              if (exErr) {
                console.warn('[WaiversService] participant-waiver batch:', exErr);
              } else if (ex) {
                extraSigs.push(...ex);
              }
            }
            if (extraSigs.length) {
              waivers = this._mergeWaiverRowsById(waivers, extraSigs);
            }
          }
        } else {
          const wantIds = [
            ...new Set((pRows || []).filter(Boolean).filter((id) => !primaryIds.has(id)))
          ];
          const CH = 150;
          const extraSigs = [];
          for (let i = 0; i < wantIds.length; i += CH) {
            const chunk = wantIds.slice(i, i + CH);
            const { data: ex, error: exErr } = await applyWaiverArchiveFilter(
              supabase
                .from('waiver_signatures')
                .select(WAIVER_SIGNATURE_LIST_SELECT)
                .in('id', chunk)
                .eq('business_id', this.businessId),
              filters
            );
            if (exErr) {
              console.warn('[WaiversService] participant-waiver batch:', exErr);
            } else if (ex) {
              extraSigs.push(...ex);
            }
          }
          if (extraSigs.length) {
            waivers = this._mergeWaiverRowsById(waivers, extraSigs);
          }
        }
      } catch (pe) {
        console.warn('[WaiversService] participant search exception:', pe);
      }
    }

    const ids = waivers.map((w) => w.id).filter(Boolean);

    let withParts = [];

    if (ids.length > 0) {
      let { data: participantRows, error: participantsError } = await supabase
        .from('waiver_participants')
        .select(WAIVER_PARTICIPANT_LIST_COLUMNS)
        .in('waiver_id', ids);

      if (participantsError) {
        const fallback = await supabase
          .from('waiver_participants')
          .select(
            'id, waiver_id, participant_type, first_name, last_name, date_of_birth, email, phone_number, updated_at'
          )
          .in('waiver_id', ids);
        participantRows = fallback.data;
        participantsError = fallback.error;
      }

      if (participantsError) {
        console.warn('[WaiversService] waiver_participants batch load failed:', participantsError);
        withParts = waivers.map((w) => ({ ...w, waiver_participants: [] }));
      } else {
        const byWaiver = new Map();
        for (const row of participantRows || []) {
          const wid = row.waiver_id;
          if (!wid) continue;
          if (!byWaiver.has(wid)) byWaiver.set(wid, []);
          byWaiver.get(wid).push(row);
        }

        withParts = waivers.map((w) => ({
          ...w,
          waiver_participants: byWaiver.get(w.id) || []
        }));
      }
    }

    const lastCheckInAtByWaiverId = await this._getLastCheckInAtByWaiverId(
      [...withParts, ...legacyMapped].map((w) => w.id).filter(Boolean)
    );

    const merged = [...withParts, ...legacyMapped]
      .map((w) => this._withOverviewActivity(w, lastCheckInAtByWaiverId))
      .sort(
        (a, b) =>
          this._timestampMs(b.overview_activity_at) -
          this._timestampMs(a.overview_activity_at)
      );

    const cap = hasSearch ? SEARCH_LIST_LIMIT : OVERVIEW_LIST_LIMIT;
    return merged.slice(0, cap);
  }

  // Get waiver by ID
  async getWaiverById(waiverId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    if (waiverId && isLegacyWaiverId(waiverId)) {
      const rawId = parseLegacyWaiverUuid(waiverId);
      if (!rawId) {
        throw new Error('Invalid legacy waiver id');
      }
      const { data, error } = await supabase
        .from('legacy_waivers')
        .select('*')
        .eq('id', rawId)
        .eq('business_id', this.businessId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) {
        console.error('Error fetching legacy waiver:', error);
        throw error;
      }
      if (!data) {
        const err = new Error('Waiver not found');
        err.code = 'PGRST116';
        throw err;
      }
      let legacyTpl = null;
      if (data.legacy_waiver_template_id != null && data.legacy_waiver_template_id !== '') {
        const { data: t } = await supabase
          .from('legacy_waiver_templates')
          .select('id, legacy_template_id, title, waiver_content')
          .eq('business_id', this.businessId)
          .eq('legacy_template_id', Number(data.legacy_waiver_template_id))
          .maybeSingle();
        if (t) legacyTpl = t;
      }
      return mapLegacyWaiverRow(data, legacyTpl);
    }

    const { data, error } = await supabase
      .from('waiver_signatures')
      .select(`
        *,
        waiver_templates:template_id (
          id,
          template_name,
          waiver_title,
          waiver_content,
          version
        ),
        waiver_participants (*),
        waiver_consents (*),
        waiver_field_responses (
          *,
          waiver_fields:field_id (
            id,
            field_key,
            field_label,
            field_type
          )
        )
      `)
      .eq('id', waiverId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching waiver:', error);
      throw error;
    }

    return data;
  }

  // Get customer waivers
  async getCustomerWaivers(customerId, includeExpired = false) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .rpc('waivers_get_customer_waivers', {
        customer_uuid: customerId,
        business_uuid: this.businessId,
        include_expired: includeExpired
      });

    if (error) {
      console.error('Error fetching customer waivers:', error);
      throw error;
    }

    return data || [];
  }

  // Match waiver by participant info
  async matchWaiver(firstName, lastName, phoneNumber = null, email = null, dateOfBirth = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .rpc('waivers_match_waiver', {
        p_first_name: firstName,
        p_last_name: lastName,
        p_business_uuid: this.businessId,
        p_phone_number: phoneNumber,
        p_email: email,
        p_date_of_birth: dateOfBirth
      });

    if (error) {
      console.error('Error matching waiver:', error);
      throw error;
    }

    return data || [];
  }

  // Check waiver expiry
  async checkExpiry(waiverId) {
    const { data, error } = await supabase
      .rpc('waivers_check_expiry', {
        waiver_uuid: waiverId
      });

    if (error) {
      console.error('Error checking expiry:', error);
      throw error;
    }

    return data;
  }

  // Create waiver (initial record before signing)
  async createWaiver(waiverData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Generate signature token
    const { data: tokenData, error: tokenError } = await supabase
      .rpc('waivers_create_signature_token', {
        business_uuid: this.businessId
      });

    if (tokenError) {
      console.error('Error generating signature token:', tokenError);
      throw tokenError;
    }

    let customerId = waiverData.customerId || null;
    if (!customerId && (waiverData.phoneNumber || waiverData.email)) {
      const customerResult = await waiverOTPService.createOrGetCustomer(
        this.businessId,
        waiverData.phoneNumber || '',
        waiverData.email || '',
        waiverData.firstName || '',
        waiverData.lastName || ''
      );
      customerId = customerResult?.customerId || customerResult?.customer_id || null;
    }

    const { data, error } = await supabase
      .from('waiver_signatures')
      .insert({
        business_id: this.businessId,
        template_id: waiverData.templateId,
        signature_token: tokenData,
        first_name: waiverData.firstName,
        last_name: waiverData.lastName,
        date_of_birth: waiverData.dateOfBirth,
        phone_number: waiverData.phoneNumber,
        email: waiverData.email,
        address: waiverData.address,
        postal_code: waiverData.postalCode,
        customer_id: customerId,
        is_minor: waiverData.isMinor || false
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating waiver:', error);
      throw error;
    }

    return data;
  }

  // Sign waiver (update with signature)
  async signWaiver(waiverId, signatureData) {
    const { data, error } = await supabase
      .from('waiver_signatures')
      .update({
        signature_image_url: signatureData.signatureImageUrl,
        signature_data: signatureData.signatureData,
        signed_at: new Date().toISOString(),
        ip_address: signatureData.ipAddress,
        user_agent: signatureData.userAgent,
        is_valid: true
      })
      .eq('id', waiverId)
      .select()
      .single();

    if (error) {
      console.error('Error signing waiver:', error);
      throw error;
    }

    return data;
  }

  // Get waiver PDF URL (storage path)
  async getWaiverPDFUrl(waiverId) {
    const { data, error } = await supabase
      .rpc('waivers_get_waiver_pdf_url', {
        waiver_uuid: waiverId
      });

    if (error) {
      console.error('Error getting PDF URL:', error);
      throw error;
    }

    return data;
  }

  async findArchivedPdfRepairCandidates() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    return this.invokeWaiverArchiveFunction({
      action: 'find_repair_candidates',
      businessId: this.businessId
    });
  }

  async repairArchivedPdfs(waiverIds, repairReason = 'primary_pdf_acknowledgement_repair') {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const normalizedWaiverIds = Array.from(
      new Set((Array.isArray(waiverIds) ? waiverIds : [waiverIds]).map((id) => String(id || '').trim()).filter(Boolean))
    );

    if (normalizedWaiverIds.length === 0) {
      throw new Error('At least one waiver ID is required');
    }

    return this.invokeWaiverArchiveFunction({
      action: 'repair',
      businessId: this.businessId,
      waiverIds: normalizedWaiverIds,
      repairReason,
      sendEmail: false
    });
  }

  // Refresh data
  async refresh() {
    return this.getWaivers();
  }
}

export default new WaiversService();





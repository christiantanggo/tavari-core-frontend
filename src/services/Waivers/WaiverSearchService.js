// Step 79: Create WaiverSearchService.js
// Service for waiver search operations
// Uses existing pos_loyalty_accounts table for customer search
import { supabase } from '../../supabaseClient';
import { WAIVER_SIGNATURE_LIST_COLUMNS } from '../../constants/waiverListColumns';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';
import { applyWaiverArchiveFilter } from '../../utils/waiverArchiveQuery';

const SEARCH_RESULT_LIMIT = 500;

class WaiverSearchService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  _signaturesQuery() {
    return applyWaiverArchiveFilter(
      supabase.from('waiver_signatures').select(WAIVER_SIGNATURE_LIST_COLUMNS).eq('business_id', this.businessId)
    );
  }

  parseLastNameFirstInitial(firstName, lastName) {
    const parts = [firstName, lastName]
      .map((part) => String(part || '').trim())
      .filter(Boolean);

    if (parts.length !== 2) return null;
    const [possibleLastName, possibleInitial] = parts;

    if (possibleInitial.length !== 1 || !/^[a-z]$/i.test(possibleInitial)) {
      return null;
    }

    return {
      lastName: possibleLastName,
      firstInitial: possibleInitial
    };
  }

  mergeWaivers(...waiverLists) {
    const merged = [];
    const seen = new Set();

    for (const waiverList of waiverLists) {
      for (const waiver of Array.isArray(waiverList) ? waiverList : []) {
        if (!waiver?.id || seen.has(waiver.id)) continue;
        seen.add(waiver.id);
        merged.push(waiver);
      }
    }

    return merged;
  }

  _escapeIlikePattern(needle) {
    if (needle == null) return '';
    return String(needle)
      .replace(/\\/g, '\\\\')
      .replace(/[%_]/g, (ch) => `\\${ch}`)
      .replace(/,/g, ' ')
      .replace(/[()]/g, ' ');
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

  async _searchParticipantWaivers(searchTerm) {
    const trimmed = String(searchTerm || '').trim();
    if (!trimmed || !this.businessId) return [];

    const pat = this._escapeIlikePattern(trimmed);
    const tokens = this._searchTokens(trimmed);
    const lastFirst =
      tokens.length === 2
        ? this.parseLastNameFirstInitial(tokens[0], tokens[1])
        : null;

    let waiverIds = [];
    const { data: pRows, error: pErr } = await supabase.rpc('waivers_search_participant_waiver_ids', {
      p_business_id: this.businessId,
      p_search: trimmed,
      p_limit: SEARCH_RESULT_LIMIT
    });

    if (!pErr && Array.isArray(pRows)) {
      waiverIds = pRows.filter(Boolean);
    } else {
      console.warn('[WaiverSearchService] participant search RPC failed, falling back:', pErr);
      const { data: fallbackRows, error: fallbackErr } = await supabase
        .from('waiver_participants')
        .select('waiver_id, waiver_signatures!inner(business_id)')
        .eq('waiver_signatures.business_id', this.businessId)
        .or(this._buildParticipantSearchOrClauses(trimmed, pat, lastFirst).join(','))
        .not('waiver_id', 'is', null)
        .limit(SEARCH_RESULT_LIMIT);

      if (fallbackErr) {
        console.warn('[WaiverSearchService] participant search fallback failed:', fallbackErr);
        return [];
      }

      waiverIds = [
        ...new Set((fallbackRows || []).map((row) => row?.waiver_id).filter(Boolean))
      ];
    }

    if (!waiverIds.length) return [];

    const { data, error } = await this._signaturesQuery()
      .in('id', waiverIds)
      .order('signed_at', { ascending: false, nullsFirst: false })
      .limit(SEARCH_RESULT_LIMIT);

    if (error) {
      throw error;
    }

    return data || [];
  }

  async _loadLoyaltyCustomerIdsByPhone(normalizedDigits) {
    if (!normalizedDigits || normalizedDigits.length < 7) return [];

    const suffix = normalizedDigits.slice(-7);
    const { data: customers, error } = await supabase
      .from('pos_loyalty_accounts')
      .select('id, customer_phone')
      .eq('business_id', this.businessId)
      .eq('is_active', true)
      .ilike('customer_phone', `%${suffix}%`)
      .limit(200);

    if (error) {
      console.warn('[WaiverSearchService] loyalty phone lookup failed:', error);
      return [];
    }

    return (customers || [])
      .filter((customer) => normalizePhoneDigits(customer.customer_phone) === normalizedDigits)
      .map((customer) => customer.id)
      .filter(Boolean);
  }

  // Search by phone
  async searchByPhone(phoneNumber) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const normalizedDigits = normalizePhoneDigits(phoneNumber);
    const customerIds = await this._loadLoyaltyCustomerIdsByPhone(normalizedDigits);

    const { data: byPhone, error: byPhoneError } = await this._signaturesQuery()
      .ilike('phone_number', `%${phoneNumber}%`)
      .order('signed_at', { ascending: false, nullsFirst: false })
      .limit(SEARCH_RESULT_LIMIT);

    if (byPhoneError) {
      throw byPhoneError;
    }

    let byCustomer = [];
    if (customerIds.length > 0) {
      const { data: customerWaivers, error: customerWaiverError } = await this._signaturesQuery()
        .in('customer_id', customerIds)
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(SEARCH_RESULT_LIMIT);

      if (customerWaiverError) {
        throw customerWaiverError;
      }

      byCustomer = customerWaivers || [];
    }

    const mergedWaivers = this.mergeWaivers(byPhone || [], byCustomer);
    const seen = new Set(mergedWaivers.map((w) => w.id));

    if (normalizedDigits.length >= 10) {
      const { data: participantMatches, error: rpcError } = await supabase.rpc(
        'waivers_find_ids_by_additional_adult_phone',
        {
          p_business_id: this.businessId,
          p_normalized_phone: normalizedDigits
        }
      );

      if (!rpcError && Array.isArray(participantMatches) && participantMatches.length > 0) {
        const extraIds = [
          ...new Set(
            participantMatches
              .map((row) => row?.waiver_id)
              .filter((id) => id && !seen.has(id))
          )
        ];
        if (extraIds.length > 0) {
          const { data: moreWaivers, error: fetchErr } = await this._signaturesQuery().in('id', extraIds);
          if (!fetchErr && moreWaivers?.length) {
            for (const w of moreWaivers) {
              if (w?.id && !seen.has(w.id)) {
                seen.add(w.id);
                mergedWaivers.push(w);
              }
            }
          }
        }
      }
    }

    const signedAtMs = (w) => (w.signed_at ? new Date(w.signed_at).getTime() : 0);
    return [...mergedWaivers].sort((a, b) => signedAtMs(b) - signedAtMs(a));
  }

  // Search by email
  async searchByEmail(email) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const normalizedEmail = String(email || '').trim();

    const { data: customers } = await supabase
      .from('pos_loyalty_accounts')
      .select('id, customer_email')
      .eq('business_id', this.businessId)
      .eq('is_active', true)
      .ilike('customer_email', `%${normalizedEmail}%`)
      .limit(200);

    const customerIds = customers?.map((c) => c.id) || [];

    const { data: byEmail, error: byEmailError } = await this._signaturesQuery()
      .ilike('email', normalizedEmail)
      .order('signed_at', { ascending: false, nullsFirst: false })
      .limit(SEARCH_RESULT_LIMIT);

    if (byEmailError) {
      throw byEmailError;
    }

    let byCustomer = [];
    if (customerIds.length > 0) {
      const { data: customerWaivers, error: customerWaiverError } = await this._signaturesQuery()
        .in('customer_id', customerIds)
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(SEARCH_RESULT_LIMIT);

      if (customerWaiverError) {
        throw customerWaiverError;
      }

      byCustomer = customerWaivers || [];
    }

    return this.mergeWaivers(byEmail || [], byCustomer);
  }

  // Search by name
  async searchByName(firstName, lastName) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = this._signaturesQuery();

    const lastFirstSearch = this.parseLastNameFirstInitial(firstName, lastName);

    if (lastFirstSearch) {
      query = query
        .ilike('last_name', `%${lastFirstSearch.lastName}%`)
        .ilike('first_name', `${lastFirstSearch.firstInitial}%`);
    } else if (firstName && lastName) {
      query = query
        .ilike('first_name', `%${firstName}%`)
        .ilike('last_name', `%${lastName}%`);
    } else if (firstName) {
      query = query.ilike('first_name', `%${firstName}%`);
    } else if (lastName) {
      query = query.ilike('last_name', `%${lastName}%`);
    }

    query = query
      .order('signed_at', { ascending: false, nullsFirst: false })
      .limit(SEARCH_RESULT_LIMIT);

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const searchTerm = [firstName, lastName]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');
    const fromParticipants = searchTerm
      ? await this._searchParticipantWaivers(searchTerm)
      : [];

    return this.mergeWaivers(data || [], fromParticipants);
  }

  // Search by QR code (if QR code stored in waiver)
  async searchByQR(qrCode) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await applyWaiverArchiveFilter(
      supabase
        .from('waiver_signatures')
        .select(`${WAIVER_SIGNATURE_LIST_COLUMNS}, signature_token`)
        .eq('business_id', this.businessId)
        .eq('signature_token', qrCode)
    ).single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data;
  }

  // Fuzzy search (multi-field)
  async fuzzySearch(searchTerm) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const trimmed = String(searchTerm || '').trim();
    const pat = this._escapeIlikePattern(trimmed);

    const { data, error } = await this._signaturesQuery()
      .or(
        `first_name.ilike.%${pat}%,last_name.ilike.%${pat}%,email.ilike.%${pat}%,phone_number.ilike.%${pat}%`
      )
      .order('signed_at', { ascending: false, nullsFirst: false })
      .limit(SEARCH_RESULT_LIMIT);

    if (error) {
      throw error;
    }

    const fromParticipants = trimmed ? await this._searchParticipantWaivers(trimmed) : [];

    return this.mergeWaivers(data || [], fromParticipants);
  }
}

export default new WaiverSearchService();

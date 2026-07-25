import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiInfo, FiRefreshCw, FiUsers } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import TavariCheckbox from '../UI/TavariCheckbox';
import { formatUnknownError, readEdgeFunctionErrorMessage } from '../../helpers/edgeFunctionErrors';

const shell = {
  marginBottom: '20px',
  borderRadius: '14px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#fff',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
  overflow: 'hidden'
};

const headerBar = {
  padding: '14px 18px',
  background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
  borderBottom: '1px solid #fed7aa'
};

const bodyPad = {
  padding: '16px 18px 18px'
};

const metaLine = {
  fontSize: '13px',
  color: '#64748b',
  marginTop: '6px',
  lineHeight: 1.45
};

const toolbar = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '14px',
  padding: '14px',
  backgroundColor: '#f8fafc',
  borderRadius: '10px',
  border: '1px solid #e2e8f0'
};

const tableShell = {
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  overflow: 'hidden',
  backgroundColor: '#fff'
};

const tableScroll = {
  overflowX: 'auto',
  maxHeight: 'min(65vh, 560px)',
  overflowY: 'auto'
};

const thBase = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#475569',
  borderBottom: '1px solid #e2e8f0',
  backgroundColor: '#f1f5f9',
  position: 'sticky',
  top: 0,
  zIndex: 2
};

const tdBase = {
  padding: '10px 12px',
  fontSize: '14px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'middle'
};

const ManualBucketTableRow = React.memo(function ManualBucketTableRow({
  idx,
  norm,
  sampleDisplay,
  count,
  girl,
  boy,
  canEdit,
  setGirl,
  setBoy,
  open,
  subLoading,
  subRows,
  onToggleRecipients
}) {
  return (
    <React.Fragment>
      <tr style={open ? { backgroundColor: '#fffbeb' } : undefined}>
        <td style={{ ...tdBase, color: '#94a3b8', fontWeight: 700 }}>{idx + 1}</td>
        <td style={tdBase}>
          <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '15px' }}>{sampleDisplay}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>{norm}</div>
        </td>
        <td style={{ ...tdBase, textAlign: 'right', fontWeight: 800, color: '#9a3412' }}>{count}</td>
        <td style={tdBase}>
          <TavariCheckbox
            checked={girl}
            onChange={(v) => setGirl(norm, v)}
            disabled={!canEdit}
            label="Girl slot"
            id={`nod-girl-${norm}`}
            size="sm"
          />
        </td>
        <td style={tdBase}>
          <TavariCheckbox
            checked={boy}
            onChange={(v) => setBoy(norm, v)}
            disabled={!canEdit}
            label="Boy slot"
            id={`nod-boy-${norm}`}
            size="sm"
          />
        </td>
        <td style={tdBase}>
          <button
            type="button"
            onClick={() => void onToggleRecipients(norm)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              color: '#0f172a',
              cursor: 'pointer'
            }}
          >
            <FiUsers size={14} aria-hidden />
            {open ? 'Hide' : 'Who'}
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} style={{ backgroundColor: '#f8fafc', padding: '12px 16px 16px', borderBottom: '1px solid #e2e8f0' }}>
            {subLoading ? (
              <div style={{ fontSize: '13px', color: '#64748b' }}>Loading…</div>
            ) : (
              <>
                <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px', color: '#334155' }}>
                  Guardian emails (marketing-eligible) for this first name
                </div>
                {(subRows || []).length === 0 ? (
                  <div style={{ fontSize: '13px', color: '#64748b' }}>None.</div>
                ) : (
                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f1f5f9' }}>
                          <th style={{ ...thBase, position: 'static' }}>Email</th>
                          <th style={{ ...thBase, position: 'static' }}>Contact</th>
                          <th style={{ ...thBase, position: 'static' }}>Minors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subRows.map((rec) => (
                          <tr key={rec.email}>
                            <td style={tdBase}>{rec.email}</td>
                            <td style={tdBase}>
                              {[rec.contact_first_name, rec.contact_last_name].filter(Boolean).join(' ') || '—'}
                            </td>
                            <td style={tdBase}>
                              {(rec.minors || [])
                                .map((m) => m.minor_first || '')
                                .filter(Boolean)
                                .join(', ') || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </td>
        </tr>
      ) : null}
    </React.Fragment>
  );
});

async function ensureMailSettingsRow(businessId, businessName) {
  const { data: existing, error: selErr } = await supabase
    .from('mail_settings')
    .select('id')
    .eq('business_id', businessId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return;

  const { data: biz, error: bizError } = await supabase
    .from('businesses')
    .select('name, business_email, business_address')
    .eq('id', businessId)
    .maybeSingle();
  if (bizError) throw bizError;

  const { data: authData } = await supabase.auth.getUser();
  const userEmail = authData?.user?.email?.trim() || '';
  const fromEmail =
    (biz?.business_email && String(biz.business_email).trim()) ||
    userEmail ||
    'noreply@tavarios.ca';
  const businessAddress =
    (biz?.business_address && String(biz.business_address).trim()) ||
    'Business Address Required for CASL';

  const { error: insertError } = await supabase.from('mail_settings').insert({
    business_id: businessId,
    from_name: (biz?.name && String(biz.name).trim()) || businessName || 'Business Name',
    from_email: fromEmail,
    reply_to: userEmail || null,
    business_address: businessAddress,
    social_links: {},
    session_timeout: 300,
    auto_retry_failed: true,
    max_retries: 3,
    max_child_age_for_automations: 12
  });
  if (insertError) throw insertError;
}

/**
 * Name of the Day — manual pools: popularity button + TavariCheckbox Girl/Boy per name.
 */
export default function NameOfDayManualBuckets({ businessId, businessName, canEdit }) {
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingBuckets, setSavingBuckets] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [alertEmailDraft, setAlertEmailDraft] = useState('');
  const [maxChildAge, setMaxChildAge] = useState(12);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryMeta, setInventoryMeta] = useState(null);
  /** Only names the user changed vs last inventory load — avoids O(n) state copies on every click */
  const [classificationOverrides, setClassificationOverrides] = useState({});
  /** Optional text filter only narrows the list — popularity uses the buttons */
  const [nameFilter, setNameFilter] = useState('');
  const [sortMode, setSortMode] = useState('popularity_desc');
  const [expandedNorm, setExpandedNorm] = useState(null);
  const [recipientsCache, setRecipientsCache] = useState({});
  const [recipientsLoadingNorm, setRecipientsLoadingNorm] = useState(null);
  const recipientsFetchedNormsRef = useRef(new Set());
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!businessId) return;
    setLoadingSettings(true);
    try {
      const { data, error } = await supabase
        .from('mail_settings')
        .select(
          'name_of_day_use_manual_buckets, name_of_day_alert_email, max_child_age_for_automations, name_inventory_last_refreshed_at'
        )
        .eq('business_id', businessId)
        .maybeSingle();
      if (error) throw error;
      setManualMode(!!data?.name_of_day_use_manual_buckets);
      setAlertEmailDraft(typeof data?.name_of_day_alert_email === 'string' ? data.name_of_day_alert_email : '');
      setMaxChildAge(Number(data?.max_child_age_for_automations ?? 12));
      setInventoryMeta((m) => ({
        ...(m || {}),
        name_inventory_last_refreshed_at: data?.name_inventory_last_refreshed_at ?? null
      }));
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not load mail settings');
    } finally {
      setLoadingSettings(false);
    }
  }, [businessId]);

  const loadInventory = useCallback(async () => {
    if (!businessId) return;
    setLoadingInventory(true);
    try {
      const { data, error } = await supabase.functions.invoke('mail-name-of-day', {
        body: { businessId, action: 'inventory' }
      });
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(formatUnknownError(data?.error, 'Inventory request failed'));
      }
      const rows = Array.isArray(data.inventory) ? data.inventory : [];
      setInventoryRows(rows);
      setInventoryMeta({
        pool_rows_before_age_filter: data.pool_rows_before_age_filter,
        pool_rows_after_age_filter: data.pool_rows_after_age_filter,
        pool_rows_after_marketing_filter: data.pool_rows_after_marketing_filter,
        marketing_eligible_contacts: data.marketing_eligible_contacts,
        max_child_age_for_automations: data.max_child_age_for_automations,
        name_inventory_last_refreshed_at: data.name_inventory_last_refreshed_at,
        name_of_day_use_manual_buckets: data.name_of_day_use_manual_buckets
      });
      setRecipientsCache({});
      recipientsFetchedNormsRef.current = new Set();
      setExpandedNorm(null);
      setMaxChildAge(Number(data.max_child_age_for_automations ?? 12));

      setClassificationOverrides({});
    } catch (e) {
      console.error(e);
      const msg = await readEdgeFunctionErrorMessage(e, 'Could not load name inventory');
      toast.error(msg);
      setInventoryRows([]);
    } finally {
      setLoadingInventory(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const popularity = (row) => Number(row.eligible_minor_count ?? row.minor_count ?? 0);

  const processedRows = useMemo(() => {
    const pop = (row) => Number(row.eligible_minor_count ?? row.minor_count ?? 0);
    const q = nameFilter.trim().toLowerCase();
    let rows = inventoryRows.filter((r) => {
      if (!q) return true;
      return (
        String(r.normalized_name || '')
          .toLowerCase()
          .includes(q) ||
        String(r.sample_display || '')
          .toLowerCase()
          .includes(q)
      );
    });

    const sorted = [...rows];
    const cmpName = (a, b) =>
      String(a.sample_display || a.normalized_name).localeCompare(
        String(b.sample_display || b.normalized_name),
        undefined,
        { sensitivity: 'base' }
      );

    if (sortMode === 'popularity_desc') {
      sorted.sort((a, b) => pop(b) - pop(a) || cmpName(a, b));
    } else if (sortMode === 'popularity_asc') {
      sorted.sort((a, b) => pop(a) - pop(b) || cmpName(a, b));
    } else if (sortMode === 'name_asc') {
      sorted.sort(cmpName);
    } else if (sortMode === 'name_desc') {
      sorted.sort((a, b) => cmpName(b, a));
    }

    return sorted;
  }, [inventoryRows, nameFilter, sortMode]);

  const rowByNorm = useMemo(() => {
    const m = new Map();
    for (const r of inventoryRows) {
      m.set(r.normalized_name, r);
    }
    return m;
  }, [inventoryRows]);

  const toggleRecipients = useCallback(
    async (norm) => {
      if (!businessId || !norm) return;
      if (expandedNorm === norm) {
        setExpandedNorm(null);
        return;
      }
      setExpandedNorm(norm);
      if (recipientsFetchedNormsRef.current.has(norm)) return;

      setRecipientsLoadingNorm(norm);
      try {
        const { data, error } = await supabase.functions.invoke('mail-name-of-day', {
          body: { businessId, action: 'inventory_recipients', normalizedName: norm }
        });
        if (error) throw error;
        if (!data?.ok) {
          throw new Error(formatUnknownError(data?.error, 'Could not load recipients'));
        }
        const list = Array.isArray(data.recipients) ? data.recipients : [];
        recipientsFetchedNormsRef.current.add(norm);
        setRecipientsCache((prev) => ({ ...prev, [norm]: list }));
      } catch (e) {
        console.error(e);
        const msg = await readEdgeFunctionErrorMessage(e, 'Could not load recipients');
        toast.error(msg);
        setExpandedNorm(null);
      } finally {
        setRecipientsLoadingNorm(null);
      }
    },
    [businessId, expandedNorm]
  );

  const setGirl = useCallback(
    (norm, checked) => {
      if (!canEdit) return;
      setClassificationOverrides((prev) => {
        const row = rowByNorm.get(norm);
        const baseG = !!row?.girl_eligible;
        const baseB = !!row?.boy_eligible;
        const girl = prev[norm]?.girl ?? baseG;
        const boy = prev[norm]?.boy ?? baseB;
        const next = { girl: checked, boy };
        if (next.girl === baseG && next.boy === baseB) {
          if (!(norm in prev)) return prev;
          const { [norm]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [norm]: next };
      });
    },
    [canEdit, rowByNorm]
  );

  const setBoy = useCallback(
    (norm, checked) => {
      if (!canEdit) return;
      setClassificationOverrides((prev) => {
        const row = rowByNorm.get(norm);
        const baseG = !!row?.girl_eligible;
        const baseB = !!row?.boy_eligible;
        const girl = prev[norm]?.girl ?? baseG;
        const boy = prev[norm]?.boy ?? baseB;
        const next = { girl, boy: checked };
        if (next.girl === baseG && next.boy === baseB) {
          if (!(norm in prev)) return prev;
          const { [norm]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [norm]: next };
      });
    },
    [canEdit, rowByNorm]
  );

  const dirtyNormCount = Object.keys(classificationOverrides).length;

  const persistManualSettings = async (nextManual, nextAlertEmail) => {
    if (!businessId || !canEdit) return;
    setSavingSettings(true);
    try {
      await ensureMailSettingsRow(businessId, businessName);
      const { error } = await supabase
        .from('mail_settings')
        .update({
          name_of_day_use_manual_buckets: nextManual,
          name_of_day_alert_email: nextAlertEmail.trim() || null
        })
        .eq('business_id', businessId);
      if (error) throw error;
      setManualMode(nextManual);
      setAlertEmailDraft(nextAlertEmail.trim());
      toast.success('Saved');
      await loadInventory();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const saveBucketAssignments = async () => {
    if (!businessId || !canEdit) return;
    const norms = Object.keys(classificationOverrides);
    if (norms.length === 0) {
      toast.success('Nothing to save');
      return;
    }
    setSavingBuckets(true);
    try {
      const ts = new Date().toISOString();
      const toUpsert = [];
      const toDelete = [];
      for (const norm of norms) {
        const d = classificationOverrides[norm];
        const g = !!d?.girl;
        const b = !!d?.boy;
        if (!g && !b) toDelete.push(norm);
        else {
          toUpsert.push({
            business_id: businessId,
            normalized_name: norm,
            girl_eligible: g,
            boy_eligible: b,
            updated_at: ts
          });
        }
      }
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('mail_name_of_day_name_classifications')
          .delete()
          .eq('business_id', businessId)
          .in('normalized_name', toDelete);
        if (delErr) throw delErr;
      }
      if (toUpsert.length > 0) {
        const { error: upErr } = await supabase
          .from('mail_name_of_day_name_classifications')
          .upsert(toUpsert, { onConflict: 'business_id,normalized_name' });
        if (upErr) throw upErr;
      }
      toast.success('Saved');
      await loadInventory();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not save');
    } finally {
      setSavingBuckets(false);
    }
  };

  if (!businessId) return null;

  const nameCount = inventoryRows.length;
  const minorTotal = inventoryRows.reduce((acc, r) => acc + popularity(r), 0);

  const popularityActive = sortMode === 'popularity_desc';
  const alphabeticalActive = sortMode === 'name_asc';

  return (
    <section style={shell} aria-labelledby="nod-manual-heading">
      <div style={headerBar}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h2 id="nod-manual-heading" style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
              Name of the Day — name pool
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#57534e', maxWidth: '720px', lineHeight: 1.45 }}>
              These checkboxes only tag which first names may appear in the <strong>automated</strong> girl/boy pools — they do{' '}
              <strong>not</strong> set the daily mail names (e.g. today’s pair). To choose or edit the actual girl/boy for each calendar day, use the{' '}
              <strong>Name-of-Day picks by date</strong> table above (Girl/Boy fields + Save row), or <strong>Name of the Day scoring</strong>{' '}
              in the toolbar. Use <strong>Names by popularity</strong> to sort; check Girl and/or Boy (both = unisex); turn on manual pool, then save.
            </p>
          </div>
          <div style={{ flexShrink: 0 }}>
            <TavariCheckbox
              checked={manualMode}
              onChange={(v) => persistManualSettings(v, alertEmailDraft)}
              disabled={!canEdit || savingSettings}
              label="Use manual name pool only"
              id="nod-manual-mode"
              size="md"
            />
          </div>
        </div>
        <div style={metaLine}>
          Max age <strong>{maxChildAge}</strong> from{' '}
          <Link to="/dashboard/mail/settings" style={{ color: '#c2410c', fontWeight: 700 }}>
            Mail Settings
          </Link>
          . Eligible minors = in age range + guardian has marketing consent (same as sends).
          {inventoryMeta?.name_inventory_last_refreshed_at ? (
            <>
              {' · '}List loaded {new Date(inventoryMeta.name_inventory_last_refreshed_at).toLocaleString()}
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowAdvancedSettings((v) => !v)}
          style={{
            marginTop: '10px',
            padding: 0,
            border: 'none',
            background: 'none',
            color: '#c2410c',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <FiInfo size={14} aria-hidden />
          {showAdvancedSettings ? 'Hide' : 'Show'} alert email &amp; stats
        </button>
        {showAdvancedSettings && !loadingSettings ? (
          <div
            style={{
              marginTop: '10px',
              padding: '12px',
              backgroundColor: 'rgba(255,255,255,0.7)',
              borderRadius: '8px',
              border: '1px solid #fed7aa',
              fontSize: '13px',
              color: '#44403c'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: 700 }}>Empty-pool alert email</span>
              <input
                type="email"
                value={alertEmailDraft}
                disabled={!canEdit || savingSettings}
                onChange={(e) => setAlertEmailDraft(e.target.value)}
                placeholder="you@company.com"
                style={{
                  flex: '1 1 200px',
                  minWidth: '180px',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px'
                }}
              />
              <button
                type="button"
                disabled={!canEdit || savingSettings}
                onClick={() => persistManualSettings(manualMode, alertEmailDraft)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  cursor: canEdit ? 'pointer' : 'not-allowed',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                {savingSettings ? 'Saving…' : 'Save email'}
              </button>
            </div>
            <div>
              {inventoryMeta?.pool_rows_before_age_filter != null && (
                <span>Loaded {inventoryMeta.pool_rows_before_age_filter} waiver rows · </span>
              )}
              {inventoryMeta?.pool_rows_after_age_filter != null && (
                <span>{inventoryMeta.pool_rows_after_age_filter} after age · </span>
              )}
              {inventoryMeta?.pool_rows_after_marketing_filter != null && (
                <span>{inventoryMeta.pool_rows_after_marketing_filter} after marketing · </span>
              )}
              {inventoryMeta?.marketing_eligible_contacts != null && (
                <span>{inventoryMeta.marketing_eligible_contacts} marketing contacts</span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div style={bodyPad}>
        <div style={toolbar}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', flex: '1 1 280px' }}>
            <button
              type="button"
              onClick={() => setSortMode('popularity_desc')}
              style={{
                padding: '12px 18px',
                borderRadius: '10px',
                border: popularityActive ? '2px solid #ea580c' : '1px solid #cbd5e1',
                backgroundColor: popularityActive ? '#fff7ed' : '#fff',
                color: popularityActive ? '#9a3412' : '#334155',
                fontSize: '14px',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: popularityActive ? '0 1px 3px rgba(234, 88, 12, 0.2)' : 'none'
              }}
            >
              Names by popularity
            </button>
            <button
              type="button"
              onClick={() => setSortMode('name_asc')}
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: alphabeticalActive ? '2px solid #64748b' : '1px solid #cbd5e1',
                backgroundColor: alphabeticalActive ? '#f1f5f9' : '#fff',
                color: '#475569',
                fontSize: '13px',
                fontWeight: alphabeticalActive ? 700 : 600,
                cursor: 'pointer'
              }}
            >
              A–Z
            </button>
            <button
              type="button"
              onClick={() => setSortMode('popularity_asc')}
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                border: sortMode === 'popularity_asc' ? '2px solid #64748b' : '1px solid #cbd5e1',
                backgroundColor: sortMode === 'popularity_asc' ? '#f1f5f9' : '#fff',
                color: '#475569',
                fontSize: '13px',
                fontWeight: sortMode === 'popularity_asc' ? 700 : 600,
                cursor: 'pointer'
              }}
            >
              Least popular first
            </button>
          </div>

          <input
            type="search"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="Optional: type to narrow…"
            aria-label="Optional filter by typing part of a name"
            style={{
              flex: '1 1 160px',
              minWidth: '140px',
              maxWidth: '260px',
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              fontSize: '13px'
            }}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
            <button
              type="button"
              disabled={loadingInventory}
              onClick={() => loadInventory()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: loadingInventory ? 'wait' : 'pointer'
              }}
            >
              <FiRefreshCw size={16} style={{ opacity: loadingInventory ? 0.5 : 1 }} />
              Reload
            </button>
            <button
              type="button"
              disabled={!canEdit || savingBuckets || inventoryRows.length === 0 || dirtyNormCount === 0}
              onClick={() => saveBucketAssignments()}
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: canEdit && dirtyNormCount > 0 ? '#ea580c' : '#cbd5e1',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 800,
                cursor: canEdit && !savingBuckets && dirtyNormCount > 0 ? 'pointer' : 'not-allowed'
              }}
            >
              {savingBuckets ? 'Saving…' : dirtyNormCount > 0 ? `Save (${dirtyNormCount})` : 'Save'}
            </button>
          </div>
        </div>

        <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '10px' }}>
          <strong>{nameCount}</strong> names · <strong>{minorTotal}</strong> eligible minor rows · <strong>{processedRows.length}</strong>{' '}
          shown
          {nameFilter.trim() ? ' (filtered)' : ''}
        </div>

        {loadingInventory && inventoryRows.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading…</div>
        ) : processedRows.length === 0 ? (
          <div style={{ padding: '20px', color: '#64748b', fontSize: '14px' }}>
            No names match. Clear the optional filter or reload.
          </div>
        ) : (
          <div style={tableShell}>
            <div style={tableScroll}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, width: 44 }}>#</th>
                    <th style={thBase}>First name</th>
                    <th style={{ ...thBase, textAlign: 'right', width: 100 }}>Count</th>
                    <th style={{ ...thBase, minWidth: 200 }}>Girl</th>
                    <th style={{ ...thBase, minWidth: 200 }}>Boy</th>
                    <th style={{ ...thBase, width: 120 }}>Mail to</th>
                  </tr>
                </thead>
                <tbody>
                  {processedRows.map((row, idx) => {
                    const norm = row.normalized_name;
                    const ov = classificationOverrides[norm];
                    const girl = ov?.girl ?? !!row.girl_eligible;
                    const boy = ov?.boy ?? !!row.boy_eligible;
                    const count = popularity(row);
                    const open = expandedNorm === norm;
                    const subRows = recipientsCache[norm];
                    const subLoading = recipientsLoadingNorm === norm;

                    return (
                      <ManualBucketTableRow
                        key={norm}
                        idx={idx}
                        norm={norm}
                        sampleDisplay={row.sample_display || norm}
                        count={count}
                        girl={girl}
                        boy={boy}
                        canEdit={canEdit}
                        setGirl={setGirl}
                        setBoy={setBoy}
                        open={open}
                        subLoading={subLoading}
                        subRows={subRows}
                        onToggleRecipients={toggleRecipients}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

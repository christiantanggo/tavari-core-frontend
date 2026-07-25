import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';

const AccountingYearEnd = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading } = usePOSAuth({ requiredRoles: ['owner', 'manager', 'admin'], requireBusiness: true, componentName: 'AccountingYearEnd' });
  const [config, setConfig] = useState(null);
  const [fiscalEnd, setFiscalEnd] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!selectedBusinessId) return;
    supabase.from('accounting_business_config')
      .select('fiscal_year_end_month, fiscal_year_end_day, retained_earnings_account_erpnext')
      .eq('business_id', selectedBusinessId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message || 'Failed to load year-end settings');
          setConfig(null);
          return;
        }
        setConfig(data || null);
        const m = data?.fiscal_year_end_month ?? 12;
        const d = data?.fiscal_year_end_day ?? 31;
        const y = new Date().getFullYear();
        setFiscalEnd(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      });
  }, [selectedBusinessId]);

  const runClose = async () => {
    if (!selectedBusinessId || !fiscalEnd) {
      toast.error('Select fiscal year end date.');
      return;
    }
    setPosting(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-year-end-close', {
        body: { business_id: selectedBusinessId, fiscal_year_end_date: fiscalEnd }
      });
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (error) {
        toast.error(error?.message || 'Failed to run year-end close');
        return;
      }
      toast.success(data?.message || 'Year-end closing entry posted.');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'year_end_close',
        entityType: 'accounting_year_end',
        entityId: fiscalEnd,
        details: { fiscal_year_end_date: fiscalEnd, journal_entry: data?.erpnext_journal_entry_id || null }
      });
    } catch (e) {
      toast.error(e?.message || 'Failed');
    } finally {
      setPosting(false);
    }
  };

  if (authLoading || !selectedBusinessId) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 16, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}
      <h1 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Year-End Close</h1>
      <p style={{ color: TavariStyles?.colors?.gray600, marginBottom: 16, fontSize: 14 }}>
        Post a closing entry to move net income into Retained Earnings for the selected fiscal year. Set Retained Earnings account in Accounting → Settings.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Fiscal year end date
          <input type="date" value={fiscalEnd} onChange={(e) => setFiscalEnd(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
        </label>
        <button type="button" onClick={runClose} disabled={posting || !config?.retained_earnings_account_erpnext} style={{ padding: '8px 16px', cursor: posting ? 'wait' : 'pointer', background: TavariStyles?.colors?.primary || '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8 }}>
          {posting ? 'Posting...' : 'Post closing entry to ERPNext'}
        </button>
      </div>

      {config && !config.retained_earnings_account_erpnext && (
        <p style={{ color: TavariStyles?.colors?.warning || '#d97706', fontSize: 14 }}>
          Set Retained Earnings account in Accounting → Settings to enable year-end close.
        </p>
      )}

      <section style={{ marginTop: 24, padding: 16, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 8, fontSize: 14 }}>
        <strong>Month-end / year-end checklist</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>All revenue and expenses posted for the year</li>
          <li>Depreciation run for each month</li>
          <li>Bank reconciliation completed</li>
          <li>AP Aging and AR Aging reviewed for unpaid items</li>
          <li>GST34 / CRA Summary reviewed for the final filing period</li>
          <li>Any reversals or un-approvals reviewed in Activity before close</li>
          <li>Export handoff package for your accountant if external review is needed</li>
          <li>Retained Earnings account set in Settings</li>
        </ul>
      </section>
    </div>
  );
};

export default AccountingYearEnd;

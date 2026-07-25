import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiSave, FiLink, FiCheckCircle, FiAlertCircle, FiRefreshCw, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { ensureBaselineExpenseCategories } from './accountingDefaults';
import { logAccountingEvent } from './accountingAudit';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';

const DEFAULT_EXPANDED_SECTIONS = {
  checklist: true,
  connect: true,
  manualSetup: false,
  erpnext: true,
  revenue: false,
  expensesTax: false,
  payroll: false,
  batches: false,
  periodLock: false,
  inbox: false,
  module: false,
};

function CollapsibleSection({
  sectionId,
  title,
  description,
  children,
  expanded,
  onToggle,
  badge = null,
  headerAction = null,
}) {
  const isOpen = !!expanded;
  return (
    <div style={{ ...sectionStyles.wrap, ...(isOpen ? {} : { borderBottom: 'none' }) }}>
      <div style={{ ...sectionStyles.headerRow, borderBottom: isOpen ? sectionStyles.headerRow.borderBottom : 'none' }}>
        <button
          type="button"
          style={sectionStyles.headerButton}
          onClick={() => onToggle(sectionId)}
          aria-expanded={isOpen}
        >
          <span style={sectionStyles.chevron} aria-hidden>
            {isOpen ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
          </span>
          <span style={sectionStyles.headerText}>
            <span style={sectionStyles.title}>{title}</span>
            {description && (
              <span style={sectionStyles.description}>{description}</span>
            )}
          </span>
          {badge}
        </button>
        {headerAction}
      </div>
      {isOpen && (
        <div style={sectionStyles.body}>
          {children}
        </div>
      )}
    </div>
  );
}

const sectionStyles = {
  wrap: {
    marginBottom: 12,
    border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
    borderRadius: 10,
    background: TavariStyles?.colors?.white || '#fff',
    overflow: 'hidden',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 8,
    background: TavariStyles?.colors?.gray50 || '#f9fafb',
    borderBottom: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
  },
  headerButton: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '14px 16px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
  },
  chevron: {
    display: 'inline-flex',
    marginTop: 2,
    color: TavariStyles?.colors?.gray500 || '#6b7280',
    flexShrink: 0,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  title: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: TavariStyles?.colors?.gray800 || '#1f2937',
  },
  description: {
    fontSize: 13,
    color: TavariStyles?.colors?.gray500 || '#6b7280',
    lineHeight: 1.45,
  },
  body: {
    padding: '16px 16px 4px',
  },
};

const AccountingSettings = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingSettings'
  });
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [validatingSetup, setValidatingSetup] = useState(false);
  const [setupValidation, setSetupValidation] = useState(null);
  const [expandedSections, setExpandedSections] = useState(DEFAULT_EXPANDED_SECTIONS);
  const [recentInboxEmails, setRecentInboxEmails] = useState([]);
  const [form, setForm] = useState({
    erpnext_api_url: '',
    erpnext_company_name: '',
    erpnext_company_abbr: '',
    erpnext_api_key: '',
    erpnext_secret: '',
    batch_day_end_time_local: '23:59',
    batch_run_time_local: '02:00',
    business_timezone: 'America/Toronto',
    period_lock_type: 'month',
    period_locked_until: '',
    accounting_sender_whitelist: '',
    accounting_inbox_slug: '',
    accounting_inbox_domain: 'tavarios.ca',
    pos_revenue_account_erpnext: '',
    bookings_revenue_account_erpnext: '',
    hst_collected_account_erpnext: '',
    hst_recoverable_account_erpnext: '',
    accounts_payable_account_erpnext: '',
    default_bank_account_erpnext: '',
    depreciation_expense_account_erpnext: '',
    accumulated_depreciation_account_erpnext: '',
    fiscal_year_end_month: 12,
    fiscal_year_end_day: 31,
    retained_earnings_account_erpnext: '',
    salary_expense_account_erpnext: '',
    employer_cpp_expense_account_erpnext: '',
    employer_ei_expense_account_erpnext: '',
    payroll_liability_account_erpnext: '',
    gift_card_liability_account_erpnext: '',
    gift_card_promo_expense_account_erpnext: '',
    payroll_bank_account_erpnext: ''
  });

  const loadConfig = useCallback(async () => {
    if (!selectedBusinessId) return;
    const { data, error } = await supabase
      .from('accounting_business_config')
      .select('*')
      .eq('business_id', selectedBusinessId)
      .maybeSingle();
    if (error) {
      toast.error(error.message || 'Failed to load accounting settings');
      setConfig(null);
      return;
    }
    if (data) {
      setConfig(data);
      setForm({
        erpnext_api_url: data.erpnext_api_url || '',
        erpnext_company_name: data.erpnext_company_name || '',
        erpnext_company_abbr: data.erpnext_company_abbr || '',
        erpnext_api_key: data.erpnext_api_key || '',
        erpnext_secret: data.erpnext_secret || '',
        batch_day_end_time_local: data.batch_day_end_time_local || '23:59',
        batch_run_time_local: data.batch_run_time_local || '02:00',
        business_timezone: data.business_timezone || 'America/Toronto',
        period_lock_type: data.period_lock_type || 'month',
        period_locked_until: data.period_locked_until ? data.period_locked_until.slice(0, 10) : '',
        accounting_sender_whitelist: Array.isArray(data.accounting_sender_whitelist) ? data.accounting_sender_whitelist.join('\n') : (data.accounting_sender_whitelist || ''),
        accounting_inbox_slug: data.accounting_inbox_slug || '',
        accounting_inbox_domain: data.accounting_inbox_domain || 'tavarios.ca',
        pos_revenue_account_erpnext: data.pos_revenue_account_erpnext || '',
        bookings_revenue_account_erpnext: data.bookings_revenue_account_erpnext || '',
        hst_collected_account_erpnext: data.hst_collected_account_erpnext || '',
        hst_recoverable_account_erpnext: data.hst_recoverable_account_erpnext || '',
        accounts_payable_account_erpnext: data.accounts_payable_account_erpnext || '',
        default_bank_account_erpnext: data.default_bank_account_erpnext || '',
        depreciation_expense_account_erpnext: data.depreciation_expense_account_erpnext || '',
        accumulated_depreciation_account_erpnext: data.accumulated_depreciation_account_erpnext || '',
        fiscal_year_end_month: data.fiscal_year_end_month ?? 12,
        fiscal_year_end_day: data.fiscal_year_end_day ?? 31,
        retained_earnings_account_erpnext: data.retained_earnings_account_erpnext || '',
        salary_expense_account_erpnext: data.salary_expense_account_erpnext || '',
        employer_cpp_expense_account_erpnext: data.employer_cpp_expense_account_erpnext || '',
        employer_ei_expense_account_erpnext: data.employer_ei_expense_account_erpnext || '',
        payroll_liability_account_erpnext: data.payroll_liability_account_erpnext || '',
        gift_card_liability_account_erpnext: data.gift_card_liability_account_erpnext || '',
        gift_card_promo_expense_account_erpnext: data.gift_card_promo_expense_account_erpnext || '',
        payroll_bank_account_erpnext: data.payroll_bank_account_erpnext || ''
      });
    } else {
      setConfig(null);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    if (!selectedBusinessId) return;
    setLoading(true);
    loadConfig().finally(() => setLoading(false));
  }, [selectedBusinessId, loadConfig]);

  useEffect(() => {
    if (!selectedBusinessId) return;
    (async () => {
      const slug = (form.accounting_inbox_slug || '').trim().toLowerCase();
      const domain = (form.accounting_inbox_domain || 'tavarios.ca').trim().toLowerCase();
      const intakeAddresses = [
        `${selectedBusinessId}@tavarios.ca`.toLowerCase(),
        ...(slug ? [`${slug}@${domain}`] : []),
      ];
      const { data, error } = await supabase
        .from('received_emails')
        .select('id, from_address, subject, received_at, attachment_count, to_addresses')
        .eq('business_id', selectedBusinessId)
        .order('received_at', { ascending: false })
        .limit(25);
      if (error) {
        console.error('Failed to load recent accounting inbox emails:', error);
        toast.error(error.message || 'Failed to load recent inbox emails');
        setRecentInboxEmails([]);
        return;
      }
      const filtered = (data || []).filter((row) => {
        const toList = (row.to_addresses || []).map((addr) => String(addr || '').trim().toLowerCase());
        return toList.some((addr) => intakeAddresses.includes(addr));
      });
      setRecentInboxEmails(filtered.slice(0, 5));
    })();
  }, [selectedBusinessId, form.accounting_inbox_slug, form.accounting_inbox_domain]);

  const handleConnect = async () => {
    if (!selectedBusinessId) return;
    setConnecting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('accounting-provision-erpnext', {
        body: { business_id: selectedBusinessId }
      });
      const err = fnError || data?.error;
      if (err) {
        const errText = typeof err === 'string' ? err : err?.message || 'Unable to connect accounting right now.';
        const needsManualSetup = errText.includes('In-app provisioning not configured') || errText.includes('manual');
        toast.error(
          needsManualSetup
            ? 'Automatic setup is not available yet. Please enter your accounting connection details below.'
            : errText
        );
        if (needsManualSetup) {
          setExpandedSections((prev) => ({ ...prev, manualSetup: true }));
        }
        return;
      }
      toast.success(data?.message || 'Accounting connected');
      await loadConfig();
    } catch (e) {
      toast.error(e?.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedBusinessId) return;
    const url = (form.erpnext_api_url || '').trim();
    if (!url) {
      toast.error('Enter ERPNext API URL');
      return;
    }
    if (!trimmed(form.hst_collected_account_erpnext) || !trimmed(form.hst_recoverable_account_erpnext)) {
      toast.error('HST Collected and HST Recoverable accounts are required for CRA filing.');
      return;
    }
    if (!trimmed(form.accounting_sender_whitelist)) {
      toast.error('Add at least one allowed sender email for the invoice inbox.');
      return;
    }
    setSaving(true);
    try {
      const whitelistStr = (form.accounting_sender_whitelist || '').trim();
      const whitelistArray = whitelistStr ? whitelistStr.split(/\n/).map((e) => e.trim().toLowerCase()).filter(Boolean) : [];
      const payload = {
        business_id: selectedBusinessId,
        ...form,
        period_locked_until: form.period_locked_until || null,
        accounting_sender_whitelist: whitelistArray
      };
      if (payload.erpnext_api_key === '') delete payload.erpnext_api_key;
      if (payload.erpnext_secret === '') delete payload.erpnext_secret;
      if (config?.id) {
        const { error } = await supabase.from('accounting_business_config').update(payload).eq('id', config.id);
        if (error) throw error;
        toast.success('Settings saved');
        await logAccountingEvent({
          businessId: selectedBusinessId,
          action: 'settings_saved',
          entityType: 'accounting_business_config',
          entityId: config.id,
          details: {
            inbox_address: accountingInboxAddress,
            updated_fields: Object.keys(payload)
          }
        });
      } else {
        const { data: inserted, error } = await supabase.from('accounting_business_config').insert(payload).select().single();
        if (error) throw error;
        await ensureBaselineExpenseCategories(supabase, selectedBusinessId);
        toast.success('Settings saved');
        if (inserted) setConfig(inserted);
        await logAccountingEvent({
          businessId: selectedBusinessId,
          action: 'settings_created',
          entityType: 'accounting_business_config',
          entityId: inserted?.id || null,
          details: {
            inbox_address: accountingInboxAddress,
            updated_fields: Object.keys(payload)
          }
        });
      }
    } catch (e) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !selectedBusinessId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: TavariStyles?.colors?.gray600 }}>
        Loading...
      </div>
    );
  }

  const accountingInboxAddress = `${selectedBusinessId}@tavarios.ca`;
  const optionalSlugAddress = form.accounting_inbox_slug?.trim()
    ? `${form.accounting_inbox_slug.trim()}@${(form.accounting_inbox_domain || 'tavarios.ca').trim().toLowerCase()}`
    : null;

  const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');
  const setupChecklist = [
    { group: 'Connection', label: 'ERPNext URL', complete: !!trimmed(form.erpnext_api_url), required: true },
    { group: 'Connection', label: 'Company name', complete: !!trimmed(form.erpnext_company_name), required: true },
    { group: 'Connection', label: 'Company abbreviation', complete: !!trimmed(form.erpnext_company_abbr), required: true },
    { group: 'Connection', label: 'API key', complete: !!trimmed(form.erpnext_api_key), required: true },
    { group: 'Connection', label: 'API secret', complete: !!trimmed(form.erpnext_secret), required: true },
    { group: 'Sales posting', label: 'POS revenue account', complete: !!trimmed(form.pos_revenue_account_erpnext), required: true },
    { group: 'Sales posting', label: 'Bookings revenue account', complete: !!trimmed(form.bookings_revenue_account_erpnext), required: true },
    { group: 'Sales posting', label: 'HST collected account', complete: !!trimmed(form.hst_collected_account_erpnext), required: true },
    { group: 'Expense posting', label: 'Default bank account', complete: !!trimmed(form.default_bank_account_erpnext), required: true },
    { group: 'Tax + payables', label: 'HST recoverable account', complete: !!trimmed(form.hst_recoverable_account_erpnext), required: true },
    { group: 'Tax + payables', label: 'Accounts payable account', complete: !!trimmed(form.accounts_payable_account_erpnext), required: false },
    { group: 'Year end', label: 'Retained earnings account', complete: !!trimmed(form.retained_earnings_account_erpnext), required: true },
    { group: 'Payroll', label: 'Salary expense account', complete: !!trimmed(form.salary_expense_account_erpnext), required: false },
    { group: 'Payroll', label: 'Employer CPP expense account', complete: !!trimmed(form.employer_cpp_expense_account_erpnext), required: false },
    { group: 'Payroll', label: 'Employer EI expense account', complete: !!trimmed(form.employer_ei_expense_account_erpnext), required: false },
    { group: 'Payroll', label: 'Payroll liability account', complete: !!trimmed(form.payroll_liability_account_erpnext), required: false },
    { group: 'Gift Cards', label: 'Gift card liability account', complete: !!trimmed(form.gift_card_liability_account_erpnext), required: false },
    { group: 'Gift Cards', label: 'Gift card promo expense account', complete: !!trimmed(form.gift_card_promo_expense_account_erpnext), required: false },
    { group: 'Payroll', label: 'Payroll bank account', complete: !!trimmed(form.payroll_bank_account_erpnext), required: false },
    { group: 'Inbox', label: 'Allowed sender email', complete: !!trimmed(form.accounting_sender_whitelist), required: true }
  ];
  const requiredChecklist = setupChecklist.filter((item) => item.required);
  const missingRequiredItems = requiredChecklist.filter((item) => !item.complete);
  const completeRequiredItems = requiredChecklist.length - missingRequiredItems.length;
  const groupedChecklist = setupChecklist.reduce((acc, item) => {
    acc[item.group] = acc[item.group] || [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const handleValidateSetup = async () => {
    if (!selectedBusinessId) return;
    if (!trimmed(form.erpnext_api_url) || !trimmed(form.erpnext_company_name) || !trimmed(form.erpnext_api_key) || !trimmed(form.erpnext_secret)) {
      toast.error('Enter the ERPNext URL, company name, API key, and API secret first.');
      return;
    }
    setValidatingSetup(true);
    setSetupValidation(null);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-list-accounts', {
        body: { business_id: selectedBusinessId }
      });
      const errText = error?.message || data?.error;
      if (errText) {
        throw new Error(errText);
      }
      const accountNames = new Set((data?.accounts || []).map((account) => String(account?.name || '').trim().toLowerCase()).filter(Boolean));
      const suffix = trimmed(form.erpnext_company_abbr) ? ` - ${trimmed(form.erpnext_company_abbr)}` : '';
      const accountChecks = [
        { label: 'POS revenue', baseName: trimmed(form.pos_revenue_account_erpnext) || 'Sales', required: true, usingDefault: !trimmed(form.pos_revenue_account_erpnext) },
        { label: 'Bookings revenue', baseName: trimmed(form.bookings_revenue_account_erpnext) || 'Sales', required: true, usingDefault: !trimmed(form.bookings_revenue_account_erpnext) },
        { label: 'HST collected', baseName: trimmed(form.hst_collected_account_erpnext) || 'HST', required: true, usingDefault: !trimmed(form.hst_collected_account_erpnext) },
        { label: 'HST recoverable', baseName: trimmed(form.hst_recoverable_account_erpnext) || 'HST', required: true, usingDefault: !trimmed(form.hst_recoverable_account_erpnext) },
        { label: 'Accounts payable', baseName: trimmed(form.accounts_payable_account_erpnext) || 'Accounts Payable', required: false, usingDefault: !trimmed(form.accounts_payable_account_erpnext) },
        { label: 'Default bank account', baseName: trimmed(form.default_bank_account_erpnext) || 'Bank', required: true, usingDefault: !trimmed(form.default_bank_account_erpnext) },
        { label: 'Retained earnings', baseName: trimmed(form.retained_earnings_account_erpnext) || 'Retained Earnings', required: true, usingDefault: !trimmed(form.retained_earnings_account_erpnext) }
      ];
      const results = accountChecks.map((check) => {
        const expected = suffix ? `${check.baseName}${suffix}` : check.baseName;
        const candidates = [expected, check.baseName].map((name) => name.trim()).filter(Boolean);
        const matchedName = candidates.find((candidate) => accountNames.has(candidate.toLowerCase())) || null;
        return {
          ...check,
          expected,
          matched: !!matchedName,
          matchedName
        };
      });
      const missingAccounts = results.filter((item) => item.required && !item.matched);
      const validation = {
        checkedAt: new Date().toISOString(),
        totalAccounts: data?.accounts?.length || 0,
        results,
        missingAccounts
      };
      setSetupValidation(validation);
      if (missingAccounts.length > 0) {
        toast.error(`Validation found ${missingAccounts.length} missing required account${missingAccounts.length === 1 ? '' : 's'}.`);
      } else {
        toast.success('Accounting setup looks ready for posting.');
      }
    } catch (e) {
      toast.error(e?.message || 'Failed to validate setup');
    } finally {
      setValidatingSetup(false);
    }
  };

  const toggleSection = (sectionId) => {
    setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const renderSetupChecklist = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <p style={{ ...styles.muted, margin: 0 }}>
            Complete the required items below before posting batches, expenses, taxes, or year-end entries.
          </p>
        </div>
        <button
          type="button"
          style={{ ...styles.secondaryButton, opacity: validatingSetup ? 0.7 : 1, pointerEvents: validatingSetup ? 'none' : 'auto' }}
          onClick={handleValidateSetup}
          disabled={validatingSetup}
        >
          <FiRefreshCw style={validatingSetup ? { animation: 'spin 1s linear infinite' } : undefined} />
          {validatingSetup ? 'Validating...' : 'Validate with ERPNext'}
        </button>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
        padding: '12px 14px',
        borderRadius: 8,
        background: missingRequiredItems.length === 0 ? '#ecfdf5' : '#fffbeb',
        border: `1px solid ${missingRequiredItems.length === 0 ? '#a7f3d0' : '#fde68a'}`
      }}>
        {missingRequiredItems.length === 0 ? <FiCheckCircle color="#059669" /> : <FiAlertCircle color="#d97706" />}
        <span style={{ fontSize: 14, fontWeight: 600, color: TavariStyles?.colors?.gray800 || '#1f2937' }}>
          {completeRequiredItems}/{requiredChecklist.length} required items complete
        </span>
      </div>

      <div style={styles.checklistGrid}>
        {Object.entries(groupedChecklist).map(([group, items]) => (
          <div key={group} style={styles.checklistSection}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px', color: TavariStyles?.colors?.gray800 || '#1f2937' }}>{group}</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {items.map((item) => (
                <div
                  key={`${group}-${item.label}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: item.complete ? '#f0fdf4' : '#f9fafb',
                    border: `1px solid ${item.complete ? '#bbf7d0' : '#e5e7eb'}`
                  }}
                >
                  <span style={{ fontSize: 13, color: TavariStyles?.colors?.gray800 || '#1f2937' }}>
                    {item.label}
                    {!item.required ? ' (optional)' : ''}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: item.complete ? '#059669' : '#6b7280' }}>
                    {item.complete ? 'Ready' : 'Missing'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {setupValidation && (
        <div style={styles.validationBox}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {setupValidation.missingAccounts.length === 0 ? <FiCheckCircle color="#059669" /> : <FiAlertCircle color="#dc2626" />}
            <strong style={{ fontSize: 14, color: TavariStyles?.colors?.gray800 || '#1f2937' }}>
              ERPNext validation checked {setupValidation.totalAccounts} ledger accounts
            </strong>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {setupValidation.results.map((result) => (
              <div key={result.label} style={styles.validationRow}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles?.colors?.gray800 || '#1f2937' }}>{result.label}</div>
                  <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray500 || '#6b7280' }}>
                    Looking for `"{result.expected}"`
                    {result.usingDefault ? ' using default naming.' : '.'}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: result.matched ? '#059669' : (result.required ? '#dc2626' : '#6b7280'), fontWeight: 600 }}>
                  {result.matched ? `Matched ${result.matchedName}` : result.required ? 'Missing in ERPNext' : 'Optional'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const checklistBadge = (
    <span style={{
      fontSize: 13,
      fontWeight: 600,
      padding: '4px 10px',
      borderRadius: 999,
      background: missingRequiredItems.length === 0 ? '#ecfdf5' : '#fffbeb',
      color: missingRequiredItems.length === 0 ? '#059669' : '#b45309',
      whiteSpace: 'nowrap',
      marginRight: 12,
      alignSelf: 'center',
    }}
    >
      {completeRequiredItems}/{requiredChecklist.length} required
    </span>
  );

  return (
    <div style={embedded ? { ...styles.container, padding: 0, paddingTop: 0 } : styles.container}>
      {!embedded && (
        <button type="button" style={styles.backButton} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back to Accounting
        </button>
      )}
      <h1 style={embedded ? { ...styles.title, fontSize: '1.25rem', marginBottom: 16 } : styles.title}>Accounting Settings</h1>
      <CollapsibleSection
        sectionId="checklist"
        title="Accounting setup checklist"
        description="Required connection, posting accounts, and inbox settings before you go live."
        expanded={expandedSections.checklist}
        onToggle={toggleSection}
        badge={checklistBadge}
      >
        {renderSetupChecklist()}
      </CollapsibleSection>

      {loading ? (
        <p style={styles.muted}>Loading...</p>
      ) : !config ? (
        <>
          <CollapsibleSection
            sectionId="connect"
            title="Connect Accounting"
            description="Automatic ERPNext provisioning when enabled for your project."
            expanded={expandedSections.connect}
            onToggle={toggleSection}
          >
            <p style={{ ...styles.muted, marginTop: 0, marginBottom: 12 }}>
              Connect your business to ERPNext. If your project has in-app provisioning enabled, use the button below. Otherwise, enter your ERPNext URL and API credentials in manual setup.
            </p>
            <button
              type="button"
              style={styles.connectButton}
              onClick={handleConnect}
              disabled={connecting}
            >
              <FiLink /> {connecting ? 'Connecting...' : 'Connect Accounting (provisioning)'}
            </button>
          </CollapsibleSection>
          <CollapsibleSection
            sectionId="manualSetup"
            title="Manual ERPNext setup"
            description="URL, company, API credentials, and default GL accounts."
            expanded={expandedSections.manualSetup}
            onToggle={toggleSection}
          >
            <p style={{ ...styles.muted, marginTop: 0, marginBottom: 16 }}>
              Enter your ERPNext base URL and API Key/Secret (from ERPNext: User → API Access). Company name and abbreviation must match your Chart of Accounts (e.g. &quot;Tavari OS&quot;, &quot;TOS&quot;).
            </p>
              <div style={styles.field}>
                <label style={styles.label}>ERPNext API URL</label>
                <input
                  type="url"
                  value={form.erpnext_api_url}
                  onChange={(e) => setForm((f) => ({ ...f, erpnext_api_url: e.target.value }))}
                  placeholder="https://erp.example.com"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>ERPNext Company name</label>
                <input
                  type="text"
                  value={form.erpnext_company_name}
                  onChange={(e) => setForm((f) => ({ ...f, erpnext_company_name: e.target.value }))}
                  placeholder="My Company"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>ERPNext Company abbreviation</label>
                <input
                  type="text"
                  value={form.erpnext_company_abbr}
                  onChange={(e) => setForm((f) => ({ ...f, erpnext_company_abbr: e.target.value.toUpperCase().slice(0, 8) }))}
                  placeholder="e.g. TOS"
                  style={styles.input}
                  maxLength={8}
                />
                <p style={{ ...styles.muted, marginTop: 4 }}>Required for posting. Chart of Accounts uses names like Cost of Goods Sold - TOS.</p>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>POS revenue account (sales batches)</label>
                <input
                  type="text"
                  value={form.pos_revenue_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, pos_revenue_account_erpnext: e.target.value }))}
                  placeholder="Sales"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Bookings revenue account</label>
                <input
                  type="text"
                  value={form.bookings_revenue_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, bookings_revenue_account_erpnext: e.target.value }))}
                  placeholder="Sales"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>HST collected account</label>
                <input
                  type="text"
                  value={form.hst_collected_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, hst_collected_account_erpnext: e.target.value }))}
                  placeholder="HST"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>HST Recoverable account (optional)</label>
                <input
                  type="text"
                  value={form.hst_recoverable_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, hst_recoverable_account_erpnext: e.target.value }))}
                  placeholder="HST Recoverable"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Accounts Payable account (optional)</label>
                <input
                  type="text"
                  value={form.accounts_payable_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, accounts_payable_account_erpnext: e.target.value }))}
                  placeholder="Accounts Payable"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Default bank/cash account (for bank-imported expenses)</label>
                <input
                  type="text"
                  value={form.default_bank_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, default_bank_account_erpnext: e.target.value }))}
                  placeholder="Bank"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Depreciation expense account (optional, for Assets)</label>
                <input
                  type="text"
                  value={form.depreciation_expense_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, depreciation_expense_account_erpnext: e.target.value }))}
                  placeholder="Depreciation"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Accumulated depreciation account (optional, for Assets)</label>
                <input
                  type="text"
                  value={form.accumulated_depreciation_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, accumulated_depreciation_account_erpnext: e.target.value }))}
                  placeholder="Accumulated Depreciation"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Retained Earnings account (for year-end close)</label>
                <input
                  type="text"
                  value={form.retained_earnings_account_erpnext}
                  onChange={(e) => setForm((f) => ({ ...f, retained_earnings_account_erpnext: e.target.value }))}
                  placeholder="Retained Earnings"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Salary expense (payroll)</label>
                <input type="text" value={form.salary_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, salary_expense_account_erpnext: e.target.value }))} placeholder="Salary" style={styles.input} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Employer CPP expense</label>
                <input type="text" value={form.employer_cpp_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, employer_cpp_expense_account_erpnext: e.target.value }))} placeholder="Employer CPP Expense" style={styles.input} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Employer EI expense</label>
                <input type="text" value={form.employer_ei_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, employer_ei_expense_account_erpnext: e.target.value }))} placeholder="Employer EI Expense" style={styles.input} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Payroll liability (CRA remittance)</label>
                <input type="text" value={form.payroll_liability_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, payroll_liability_account_erpnext: e.target.value }))} placeholder="Payroll Liabilities" style={styles.input} />
                <label style={styles.label}>Gift card liability</label>
                <input type="text" value={form.gift_card_liability_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, gift_card_liability_account_erpnext: e.target.value }))} placeholder="Gift Card Liability" style={styles.input} />
                <label style={styles.label}>Gift card promo expense</label>
                <input type="text" value={form.gift_card_promo_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, gift_card_promo_expense_account_erpnext: e.target.value }))} placeholder="Gift Card Promotions" style={styles.input} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Payroll bank (net pay)</label>
                <input type="text" value={form.payroll_bank_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, payroll_bank_account_erpnext: e.target.value }))} placeholder="Bank" style={styles.input} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>ERPNext API Key</label>
                <input
                  type="password"
                  value={form.erpnext_api_key}
                  onChange={(e) => setForm((f) => ({ ...f, erpnext_api_key: e.target.value }))}
                  placeholder="From ERPNext: User → API Access"
                  style={styles.input}
                  autoComplete="off"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>ERPNext API Secret</label>
                <input
                  type="password"
                  value={form.erpnext_secret}
                  onChange={(e) => setForm((f) => ({ ...f, erpnext_secret: e.target.value }))}
                  placeholder="From ERPNext: User → API Access"
                  style={styles.input}
                  autoComplete="off"
                />
              </div>
              <button type="button" style={styles.saveButton} onClick={handleSave} disabled={saving}>
                <FiSave /> {saving ? 'Saving...' : 'Save'}
              </button>
          </CollapsibleSection>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 14px', background: TavariStyles?.colors?.gray50 || '#f9fafb', borderRadius: 8, border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}` }}>
            <FiLink style={{ color: TavariStyles?.colors?.primary || '#008080' }} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>Accounting connected</span>
          </div>

          <CollapsibleSection
            sectionId="erpnext"
            title="ERPNext connection"
            description="API URL, company, and credentials used for posting and reports."
            expanded={expandedSections.erpnext}
            onToggle={toggleSection}
          >
            <div style={styles.field}>
            <label style={styles.label}>ERPNext API URL</label>
            <input
              type="url"
              value={form.erpnext_api_url}
              onChange={(e) => setForm((f) => ({ ...f, erpnext_api_url: e.target.value }))}
              placeholder="https://erp.example.com"
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>ERPNext Company name</label>
            <input
              type="text"
              value={form.erpnext_company_name}
              onChange={(e) => setForm((f) => ({ ...f, erpnext_company_name: e.target.value }))}
              placeholder="My Company"
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>ERPNext Company abbreviation</label>
            <input
              type="text"
              value={form.erpnext_company_abbr}
              onChange={(e) => setForm((f) => ({ ...f, erpnext_company_abbr: e.target.value.toUpperCase().slice(0, 8) }))}
              placeholder="e.g. TOS for Tavari OS"
              style={styles.input}
              maxLength={8}
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>Required for posting. Find it in ERPNext Chart of Accounts (e.g. Cost of Goods Sold - TOS).</p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>ERPNext API Key</label>
            <input
              type="password"
              value={form.erpnext_api_key}
              onChange={(e) => setForm((f) => ({ ...f, erpnext_api_key: e.target.value }))}
              placeholder="From ERPNext: User → API Access"
              style={styles.input}
              autoComplete="off"
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>Required to approve expenses and load reports. If you get “API Key missing” when approving, re-enter the key here and click Save.</p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>ERPNext API Secret</label>
            <input
              type="password"
              value={form.erpnext_secret}
              onChange={(e) => setForm((f) => ({ ...f, erpnext_secret: e.target.value }))}
              placeholder="From ERPNext: User → API Access"
              style={styles.input}
              autoComplete="off"
            />
          </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="revenue"
            title="Sales & revenue accounts"
            description="POS, bookings, and HST collected when posting sales batches."
            expanded={expandedSections.revenue}
            onToggle={toggleSection}
          >
          <div style={styles.field}>
            <label style={styles.label}>POS revenue account (sales batches)</label>
            <input
              type="text"
              value={form.pos_revenue_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, pos_revenue_account_erpnext: e.target.value }))}
              placeholder="Sales"
              style={styles.input}
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>Used for POS revenue lines when posting sales batches to ERPNext.</p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Bookings revenue account</label>
            <input
              type="text"
              value={form.bookings_revenue_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, bookings_revenue_account_erpnext: e.target.value }))}
              placeholder="Sales"
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>HST collected account</label>
            <input
              type="text"
              value={form.hst_collected_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, hst_collected_account_erpnext: e.target.value }))}
              placeholder="HST"
              style={styles.input}
            />
          </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="expensesTax"
            title="Expenses, tax & payables"
            description="HST recoverable, AP, bank, depreciation, and retained earnings."
            expanded={expandedSections.expensesTax}
            onToggle={toggleSection}
          >
          <div style={styles.field}>
            <label style={styles.label}>HST Recoverable account (optional)</label>
            <input
              type="text"
              value={form.hst_recoverable_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, hst_recoverable_account_erpnext: e.target.value }))}
              placeholder="HST Recoverable"
              style={styles.input}
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>Base name only; &quot; - {form.erpnext_company_abbr || 'ABBR'}&quot; is added. Leave blank for default.</p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Accounts Payable account (optional)</label>
            <input
              type="text"
              value={form.accounts_payable_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, accounts_payable_account_erpnext: e.target.value }))}
              placeholder="Accounts Payable"
              style={styles.input}
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>Base name only; &quot; - {form.erpnext_company_abbr || 'ABBR'}&quot; is added. Leave blank for default.</p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Default bank/cash account (for bank-imported expenses)</label>
            <input
              type="text"
              value={form.default_bank_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, default_bank_account_erpnext: e.target.value }))}
              placeholder="Bank"
              style={styles.input}
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>Used when a bank import expense is posted directly against cash/bank instead of Accounts Payable.</p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Depreciation expense account (optional, for Fixed Assets)</label>
            <input
              type="text"
              value={form.depreciation_expense_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, depreciation_expense_account_erpnext: e.target.value }))}
              placeholder="Depreciation"
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Accumulated depreciation account (optional, for Fixed Assets)</label>
            <input
              type="text"
              value={form.accumulated_depreciation_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, accumulated_depreciation_account_erpnext: e.target.value }))}
              placeholder="Accumulated Depreciation"
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Retained Earnings account (year-end close)</label>
            <input
              type="text"
              value={form.retained_earnings_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, retained_earnings_account_erpnext: e.target.value }))}
              placeholder="Retained Earnings"
              style={styles.input}
            />
          </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="payroll"
            title="Payroll accounts"
            description="GL accounts used when posting payroll from HR."
            expanded={expandedSections.payroll}
            onToggle={toggleSection}
          >
          <div style={styles.field}>
            <label style={styles.label}>Salary expense account</label>
            <input type="text" value={form.salary_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, salary_expense_account_erpnext: e.target.value }))} placeholder="Salary" style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Employer CPP expense</label>
            <input type="text" value={form.employer_cpp_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, employer_cpp_expense_account_erpnext: e.target.value }))} placeholder="Employer CPP Expense" style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Employer EI expense</label>
            <input type="text" value={form.employer_ei_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, employer_ei_expense_account_erpnext: e.target.value }))} placeholder="Employer EI Expense" style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Payroll liability account (CRA remittance)</label>
            <input type="text" value={form.payroll_liability_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, payroll_liability_account_erpnext: e.target.value }))} placeholder="Payroll Liabilities" style={styles.input} />
            <label style={styles.label}>Gift card liability account</label>
            <input type="text" value={form.gift_card_liability_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, gift_card_liability_account_erpnext: e.target.value }))} placeholder="Gift Card Liability" style={styles.input} />
            <label style={styles.label}>Gift card promo expense account</label>
            <input type="text" value={form.gift_card_promo_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, gift_card_promo_expense_account_erpnext: e.target.value }))} placeholder="Gift Card Promotions" style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Payroll bank account (net pay)</label>
            <input type="text" value={form.payroll_bank_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, payroll_bank_account_erpnext: e.target.value }))} placeholder="Bank" style={styles.input} />
          </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="batches"
            title="Sales batches & automation"
            description="Batch schedule, timezone, cron, and Plaid bank feed notes."
            expanded={expandedSections.batches}
            onToggle={toggleSection}
          >
          <div style={styles.field}>
            <label style={styles.label}>Day end time (local)</label>
            <input
              type="time"
              value={form.batch_day_end_time_local}
              onChange={(e) => setForm((f) => ({ ...f, batch_day_end_time_local: e.target.value }))}
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Batch run time (local)</label>
            <input
              type="time"
              value={form.batch_run_time_local}
              onChange={(e) => setForm((f) => ({ ...f, batch_run_time_local: e.target.value }))}
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Timezone</label>
            <input
              type="text"
              value={form.business_timezone}
              onChange={(e) => setForm((f) => ({ ...f, business_timezone: e.target.value }))}
              placeholder="America/Toronto"
              style={styles.input}
            />
          </div>
          <div style={{ ...styles.field, padding: 16, background: '#f0fdfa', borderRadius: 8, border: '1px solid #99f6e4' }}>
            <label style={{ ...styles.label, marginBottom: 8 }}>Automated sales batches (cron)</label>
            <p style={{ ...styles.muted, margin: '0 0 8px', lineHeight: 1.5 }}>
              Daily POS and booking batches are created by the <code>accounting-daily-batch</code> edge function.
              Schedule it once per day <strong>after</strong> your batch run time ({form.batch_run_time_local || '02:00'} {form.business_timezone || 'America/Toronto'}).
            </p>
            <p style={{ ...styles.muted, margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              Example (external cron): POST <code>/functions/v1/accounting-daily-batch</code> with service role Authorization and body <code>{'{}'}</code>.
              You can also click <strong>Create sales batches</strong> in the Queue for manual backfill.
            </p>
          </div>
          <div style={{ ...styles.field, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <label style={{ ...styles.label, marginBottom: 8 }}>Live bank feed (Plaid)</label>
            <p style={{ ...styles.muted, margin: 0, lineHeight: 1.5 }}>
              Connect banks from <strong>Bank → Upload</strong>. Requires Supabase secrets <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code>, and optional <code>PLAID_ENV</code> (sandbox / development / production).
              Optional: schedule <code>accounting-plaid-sync</code> daily after connections are mapped to ERPNext bank accounts.
            </p>
          </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="periodLock"
            title="Fiscal year & period locking"
            description="Fiscal year end (e.g. Apr 30 for Tanggo) and prevent posting into closed periods."
            expanded={expandedSections.periodLock}
            onToggle={toggleSection}
          >
          <div style={styles.field}>
            <label style={styles.label}>Fiscal year end month</label>
            <select
              value={form.fiscal_year_end_month}
              onChange={(e) => setForm((f) => ({ ...f, fiscal_year_end_month: Number(e.target.value) }))}
              style={styles.input}
            >
              {[
                [1, 'January'], [2, 'February'], [3, 'March'], [4, 'April'],
                [5, 'May'], [6, 'June'], [7, 'July'], [8, 'August'],
                [9, 'September'], [10, 'October'], [11, 'November'], [12, 'December'],
              ].map(([m, label]) => (
                <option key={m} value={m}>{label}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Fiscal year end day</label>
            <input
              type="number"
              min={1}
              max={31}
              value={form.fiscal_year_end_day}
              onChange={(e) => setForm((f) => ({ ...f, fiscal_year_end_day: Number(e.target.value) || 1 }))}
              style={styles.input}
            />
            <p style={{ ...styles.muted, margin: '6px 0 0' }}>
              Tanggo Companies: April 30 (month 4, day 30). Used by Year End close and report defaults.
            </p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Period lock type</label>
            <select
              value={form.period_lock_type}
              onChange={(e) => setForm((f) => ({ ...f, period_lock_type: e.target.value }))}
              style={styles.input}
            >
              <option value="month">Month</option>
              <option value="date">Date</option>
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Period locked until (date)</label>
            <input
              type="date"
              value={form.period_locked_until}
              onChange={(e) => setForm((f) => ({ ...f, period_locked_until: e.target.value }))}
              style={styles.input}
            />
          </div>
          </CollapsibleSection>

          <CollapsibleSection
            sectionId="inbox"
            title="Invoice inbox (email-to-expense)"
            description="Inbox address, sender whitelist, and recent intake."
            expanded={expandedSections.inbox}
            onToggle={toggleSection}
          >
          <p style={{ ...styles.muted, marginTop: 0, marginBottom: 16 }}>
            Forward invoices to your business inbox address below (with PDF or image attached). Only senders listed below will create draft expenses.
          </p>
          <div style={styles.field}>
            <label style={styles.label}>Invoice inbox address (use this)</label>
            <div
              style={{
                padding: '12px 14px',
                background: TavariStyles?.colors?.gray50 || '#f9fafb',
                borderRadius: 8,
                border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
                fontFamily: 'monospace',
                fontSize: 14,
                fontWeight: 600,
                color: TavariStyles?.colors?.gray800 || '#1f2937',
                wordBreak: 'break-all'
              }}
            >
              {accountingInboxAddress}
            </div>
            <p style={{ ...styles.muted, marginTop: 6, marginBottom: 0, fontSize: 13 }}>
              Each business has a unique address. SES must deliver mail here for invoice intake to work.
            </p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Optional custom alias (advanced)</label>
            <input
              value={form.accounting_inbox_slug}
              onChange={(e) => setForm((f) => ({ ...f, accounting_inbox_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '') }))}
              placeholder="leave blank to use legacy address only"
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Custom alias domain</label>
            <input
              value={form.accounting_inbox_domain}
              onChange={(e) => setForm((f) => ({ ...f, accounting_inbox_domain: e.target.value.toLowerCase() }))}
              placeholder="tavarios.ca"
              style={styles.input}
            />
            {optionalSlugAddress && (
              <p style={{ ...styles.muted, marginTop: 6, marginBottom: 0, fontSize: 13 }}>
                Also accepts: <code>{optionalSlugAddress}</code>
              </p>
            )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Allowed sender emails (one per line)</label>
            <textarea
              value={form.accounting_sender_whitelist}
              onChange={(e) => setForm((f) => ({ ...f, accounting_sender_whitelist: e.target.value }))}
              placeholder={'vendor@example.com\nbills@another.com'}
              rows={4}
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Recent emails to this inbox</label>
            {recentInboxEmails.length === 0 ? (
              <p style={{ ...styles.muted, marginTop: 4 }}>
                No emails received yet. If you just sent a test: mail must be delivered to this address via your SES/inbound setup, then the receive-email Edge Function must be invoked with the S3 bucket/key. Check Supabase → Edge Functions → receive-email → Logs to see if the function runs when you send.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: TavariStyles?.colors?.gray700 || '#374151' }}>
                {recentInboxEmails.map((e) => (
                  <li key={e.id} style={{ marginBottom: 4 }}>
                    {e.from_address} — {e.subject || '(no subject)'} ({e.attachment_count || 0} attachments)
                  </li>
                ))}
              </ul>
            )}
          </div>
          </CollapsibleSection>

          <button type="button" style={styles.saveButton} onClick={handleSave} disabled={saving}>
            <FiSave /> {saving ? 'Saving...' : 'Save settings'}
          </button>
        </>
      )}

      <CollapsibleSection
        sectionId="module"
        title="Module deactivation"
        description="Disable the Accounting module for this business."
        expanded={expandedSections.module}
        onToggle={toggleSection}
      >
        <ModuleDeactivationPanel moduleKey="accounting" />
      </CollapsibleSection>

      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

const styles = {
  container: {
    padding: TavariStyles?.spacing?.['2xl'] || 24,
    paddingTop: 100,
    width: '100%',
    maxWidth: 'none',
    margin: 0
  },
  backButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
    padding: '8px 16px',
    background: TavariStyles?.colors?.white || '#fff',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: TavariStyles?.colors?.gray800 || '#1f2937',
    margin: '0 0 24px'
  },
  card: {
    ...(TavariStyles?.layout?.card || {}),
    padding: 24,
    border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`
  },
  field: {
    marginBottom: 20
  },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: TavariStyles?.colors?.gray700 || '#374151',
    marginBottom: 6
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    fontSize: 14
  },
  connectButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 24px',
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 600
  },
  linkButton: {
    display: 'inline-block',
    padding: '8px 0',
    background: 'none',
    border: 'none',
    color: TavariStyles?.colors?.primary || '#008080',
    cursor: 'pointer',
    fontSize: 14,
    textDecoration: 'underline'
  },
  saveButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    padding: '10px 20px',
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: '#fff',
    color: TavariStyles?.colors?.gray700 || '#374151',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  checklistGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12
  },
  checklistSection: {
    border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
    borderRadius: 10,
    padding: 12,
    background: TavariStyles?.colors?.white || '#fff'
  },
  validationBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
    background: TavariStyles?.colors?.gray50 || '#f9fafb'
  },
  validationRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    padding: '10px 0',
    borderTop: '1px solid #e5e7eb'
  },
  muted: {
    color: TavariStyles?.colors?.gray500 || '#6b7280',
    fontSize: 14
  }
};

export default AccountingSettings;

// components/HR/HRPayrollComponents/YTDPayrollEntry.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { useCanadianTaxCalculations } from '../../../hooks/useCanadianTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../../utils/TavariStyles';
import SaveConfirmationModal from './YTDComponents/SaveConfirmationModal';
import YTDEmployeeSelector from './YTDComponents/YTDEmployeeSelector';
import YTDSummaryTab from './YTDComponents/YTDSummaryTab';
import YTDPeriodsTab from './YTDComponents/YTDPeriodsTab';

const YTDPayrollEntry = ({ selectedBusinessId, businessData }) => {
  const [activeTab, setActiveTab] = useState('summary');
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveMessageType, setSaveMessageType] = useState('success');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalType, setSaveModalType] = useState('success');
  const [saveModalMessage, setSaveModalMessage] = useState('');
  const [ytdData, setYtdData] = useState({
    regular_hours: '', overtime_hours: '', lieu_hours: '', stat_hours: '',
    holiday_hours: '', hours_worked: '', regular_income: '', overtime_income: '',
    lieu_income: '', vacation_pay: '', shift_premiums: '', stat_earnings: '',
    holiday_earnings: '', bonus: '', federal_tax: '', provincial_tax: '',
    cpp_deduction: '', ei_deduction: '', additional_tax: '', manual_entry_reason: ''
  });
  const [useBusinessDefault, setUseBusinessDefault] = useState(false);
  const [payFrequency, setPayFrequency] = useState('bi_weekly');
  const [employeeIsCurrent, setEmployeeIsCurrent] = useState(true);
  const [lastDayWorked, setLastDayWorked] = useState('');
  const [firstPeriodEndDate, setFirstPeriodEndDate] = useState('');
  const [periods, setPeriods] = useState([]);
  const [expandedPeriods, setExpandedPeriods] = useState(new Set());
  const [periodsGenerated, setPeriodsGenerated] = useState(false);
  const [validationBypass, setValidationBypass] = useState(false);
  const [existingPayrollEntries, setExistingPayrollEntries] = useState([]);
  const [showExistingWarning, setShowExistingWarning] = useState(false);
  const [acknowledgedExisting, setAcknowledgedExisting] = useState(false);

  const { validateInput, checkRateLimit, recordAction, logSecurityEvent } = useSecurityContext({
    componentName: 'YTDPayrollEntry', sensitiveComponent: true, enableRateLimiting: true, enableAuditLogging: true, securityLevel: 'critical'
  });
  const { selectedBusinessId: authBusinessId, authUser } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'], requireBusiness: true, componentName: 'YTDPayrollEntry'
  });
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId || authBusinessId);
  const effectiveBusinessId = selectedBusinessId || authBusinessId;

  const styles = {
    container: { padding: TavariStyles.spacing.lg, backgroundColor: TavariStyles.colors.gray50, minHeight: '100vh' },
    section: { backgroundColor: TavariStyles.colors.white, padding: TavariStyles.spacing.lg, borderRadius: TavariStyles.borderRadius?.lg || '12px', border: `1px solid ${TavariStyles.colors.gray200}`, boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)', marginBottom: TavariStyles.spacing.lg },
    sectionTitle: { fontSize: TavariStyles.typography.fontSize.xl, fontWeight: TavariStyles.typography.fontWeight.bold, marginBottom: TavariStyles.spacing.md, color: TavariStyles.colors.gray800, borderBottom: `1px solid ${TavariStyles.colors.gray200}`, paddingBottom: TavariStyles.spacing.sm },
    tabContainer: { display: 'flex', gap: TavariStyles.spacing.sm, marginBottom: TavariStyles.spacing.lg, borderBottom: `2px solid ${TavariStyles.colors.gray200}`, padding: `0 ${TavariStyles.spacing.lg}` },
    tab: { padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: TavariStyles.typography.fontWeight.semibold, cursor: 'pointer', border: 'none', backgroundColor: 'transparent', color: TavariStyles.colors.gray600, transition: 'all 0.2s ease', marginBottom: '-2px', borderBottom: '3px solid transparent' },
    activeTab: { color: TavariStyles.colors.primary, borderBottomColor: TavariStyles.colors.primary },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: TavariStyles.spacing.lg },
    periodGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: TavariStyles.spacing.md },
    formGroup: { display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.xs, marginBottom: TavariStyles.spacing.md },
    label: { fontSize: TavariStyles.typography.fontSize.sm, fontWeight: TavariStyles.typography.fontWeight.medium, color: TavariStyles.colors.gray700 },
    input: { padding: '12px 16px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: TavariStyles.borderRadius?.md || '6px', fontSize: TavariStyles.typography.fontSize.sm, transition: 'border-color 0.2s', fontFamily: 'inherit', backgroundColor: TavariStyles.colors.white },
    select: { padding: '12px 16px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: TavariStyles.borderRadius?.md || '6px', fontSize: TavariStyles.typography.fontSize.sm, backgroundColor: TavariStyles.colors.white, cursor: 'pointer' },
    button: { ...TavariStyles.components.button?.base || { padding: '12px 24px', borderRadius: TavariStyles.borderRadius?.md || '6px', border: 'none', fontSize: TavariStyles.typography.fontSize.sm, fontWeight: TavariStyles.typography.fontWeight.semibold, cursor: 'pointer', transition: 'all 0.2s ease' }, ...TavariStyles.components.button?.variants?.primary || { backgroundColor: TavariStyles.colors.primary, color: TavariStyles.colors.white } },
    secondaryButton: { padding: '8px 16px', borderRadius: TavariStyles.borderRadius?.md || '6px', border: `1px solid ${TavariStyles.colors.gray300}`, fontSize: TavariStyles.typography.fontSize.sm, fontWeight: TavariStyles.typography.fontWeight.medium, cursor: 'pointer', backgroundColor: TavariStyles.colors.white, color: TavariStyles.colors.gray700, transition: 'all 0.2s ease' },
    accordionItem: { border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: TavariStyles.borderRadius?.md || '6px', marginBottom: TavariStyles.spacing.sm, overflow: 'hidden' },
    accordionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.gray50, cursor: 'pointer', transition: 'background-color 0.2s' },
    accordionTitle: { fontSize: TavariStyles.typography.fontSize.sm, fontWeight: TavariStyles.typography.fontWeight.semibold, color: TavariStyles.colors.gray800, flex: 1 },
    accordionSubtitle: { fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginLeft: TavariStyles.spacing.md },
    accordionContent: { padding: TavariStyles.spacing.lg, backgroundColor: TavariStyles.colors.white },
    periodTotal: { marginTop: TavariStyles.spacing.md, padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.gray50, borderRadius: TavariStyles.borderRadius?.md || '6px', borderLeft: `4px solid ${TavariStyles.colors.primary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    totalsCard: { backgroundColor: TavariStyles.colors.primary + '10', border: `1px solid ${TavariStyles.colors.primary}30`, padding: TavariStyles.spacing.lg, borderRadius: TavariStyles.borderRadius?.lg || '12px' },
    totalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${TavariStyles.spacing.sm} 0`, borderBottom: `1px solid ${TavariStyles.colors.gray200}` },
    totalLabel: { fontSize: TavariStyles.typography.fontSize.sm, fontWeight: TavariStyles.typography.fontWeight.medium, color: TavariStyles.colors.gray700 },
    totalValue: { fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.bold, color: TavariStyles.colors.primary },
    messageBox: { padding: TavariStyles.spacing.md, borderRadius: TavariStyles.borderRadius?.md || '6px', marginBottom: TavariStyles.spacing.md, fontWeight: TavariStyles.typography.fontWeight.medium, display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.sm },
    successMessage: { backgroundColor: TavariStyles.colors.successBg, color: TavariStyles.colors.success, border: `1px solid ${TavariStyles.colors.success}30` },
    errorMessage: { backgroundColor: TavariStyles.colors.errorBg, color: TavariStyles.colors.danger, border: `1px solid ${TavariStyles.colors.danger}30` },
    warningMessage: { backgroundColor: TavariStyles.colors.warningBg, color: TavariStyles.colors.warning, border: `1px solid ${TavariStyles.colors.warning}30` },
    infoMessage: { backgroundColor: TavariStyles.colors.info + '10', color: TavariStyles.colors.info, border: `1px solid ${TavariStyles.colors.info}30` },
    warningCard: { backgroundColor: TavariStyles.colors.warningBg, border: `2px solid ${TavariStyles.colors.warning}`, padding: TavariStyles.spacing.lg, borderRadius: TavariStyles.borderRadius?.md || '6px', marginBottom: TavariStyles.spacing.md },
    warningTitle: { fontSize: TavariStyles.typography.fontSize.md, fontWeight: TavariStyles.typography.fontWeight.bold, color: TavariStyles.colors.warning, marginBottom: TavariStyles.spacing.sm, display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.xs },
    warningContent: { fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray700, marginBottom: TavariStyles.spacing.md },
    existingEntriesList: { maxHeight: '200px', overflowY: 'auto', backgroundColor: TavariStyles.colors.white, padding: TavariStyles.spacing.md, borderRadius: TavariStyles.borderRadius?.sm || '4px', marginTop: TavariStyles.spacing.sm },
    existingEntry: { padding: `${TavariStyles.spacing.xs} 0`, borderBottom: `1px solid ${TavariStyles.colors.gray200}`, fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600 },
    filterInfo: { fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs, fontStyle: 'italic' },
    employeeInfo: { backgroundColor: TavariStyles.colors.info + '10', border: `1px solid ${TavariStyles.colors.info}30`, padding: TavariStyles.spacing.md, borderRadius: TavariStyles.borderRadius?.md || '6px', marginBottom: TavariStyles.spacing.md },
    employeeInfoTitle: { fontSize: TavariStyles.typography.fontSize.sm, fontWeight: TavariStyles.typography.fontWeight.semibold, color: TavariStyles.colors.gray700, marginBottom: TavariStyles.spacing.sm },
    employeeInfoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: TavariStyles.spacing.sm, fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }
  };

  const loadEmployees = useCallback(async () => {
    try {
      await logSecurityEvent('ytd_employee_data_access', { action: 'load_employees_for_ytd', business_id: effectiveBusinessId }, 'low');
      const { data: userData, error } = await supabase.from('users').select(`id, first_name, last_name, full_name, email, employment_status, employee_number, position, department, hire_date, termination_date, business_users!inner(business_id)`).eq('business_users.business_id', effectiveBusinessId).order('first_name');
      if (error) throw error;
      const employeeList = (userData || []).map(user => ({ id: user.id, name: user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(), first_name: user.first_name, last_name: user.last_name, email: user.email, employee_number: user.employee_number, position: user.position, department: user.department, hire_date: user.hire_date, termination_date: user.termination_date, employment_status: user.employment_status || 'active' })).filter(emp => emp.name.trim()).sort((a, b) => a.name.localeCompare(b.name));
      setEmployees(employeeList);
    } catch (error) {
      console.error('Error loading employees:', error);
      await logSecurityEvent('ytd_employee_load_failed', { error_message: error.message, business_id: effectiveBusinessId }, 'medium');
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveBusinessId, logSecurityEvent]);

  const filterEmployees = useCallback(() => {
    let filtered = employees;
    switch (employeeStatusFilter) {
      case 'active': filtered = employees.filter(emp => emp.employment_status === 'active'); break;
      case 'terminated': filtered = employees.filter(emp => emp.employment_status === 'terminated'); break;
      case 'probation': filtered = employees.filter(emp => emp.employment_status === 'probation'); break;
      case 'suspended': filtered = employees.filter(emp => emp.employment_status === 'suspended'); break;
      case 'on_leave': filtered = employees.filter(emp => emp.employment_status === 'on_leave'); break;
      case 'current': filtered = employees.filter(emp => ['active', 'probation', 'on_leave'].includes(emp.employment_status)); break;
      case 'all': default: filtered = employees; break;
    }
    setFilteredEmployees(filtered);
    if (selectedEmployee && !filtered.find(emp => emp.id === selectedEmployee)) setSelectedEmployee('');
  }, [employees, employeeStatusFilter, selectedEmployee]);

  const clearYTDForm = useCallback(() => { setYtdData({ regular_hours: '', overtime_hours: '', lieu_hours: '', stat_hours: '', holiday_hours: '', hours_worked: '', regular_income: '', overtime_income: '', lieu_income: '', vacation_pay: '', shift_premiums: '', stat_earnings: '', holiday_earnings: '', bonus: '', federal_tax: '', provincial_tax: '', cpp_deduction: '', ei_deduction: '', additional_tax: '', manual_entry_reason: '' }); }, []);
  const clearPeriodsForm = useCallback(() => { setPeriods([]); setPeriodsGenerated(false); setExpandedPeriods(new Set()); setValidationBypass(false); setExistingPayrollEntries([]); setShowExistingWarning(false); setAcknowledgedExisting(false); setEmployeeIsCurrent(true); setLastDayWorked(''); setFirstPeriodEndDate(''); }, []);
  const resetForm = useCallback(() => { clearYTDForm(); clearPeriodsForm(); }, [clearYTDForm, clearPeriodsForm]);

  const loadExistingYTDData = useCallback(async () => {
    try {
      setLoading(true);
      const currentYear = new Date().getFullYear();
      const { data: existingData, error } = await supabase.from('hrpayroll_ytd_data').select('*').eq('user_id', selectedEmployee).eq('business_id', effectiveBusinessId).eq('tax_year', currentYear).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (existingData) {
        setYtdData({ regular_hours: existingData.regular_hours || '', overtime_hours: existingData.overtime_hours || '', lieu_hours: existingData.lieu_hours || '', stat_hours: existingData.stat_hours || '', holiday_hours: existingData.holiday_hours || '', hours_worked: existingData.hours_worked || '', regular_income: existingData.regular_income || '', overtime_income: existingData.overtime_income || '', lieu_income: existingData.lieu_income || '', vacation_pay: existingData.vacation_pay || '', shift_premiums: existingData.shift_premiums || '', stat_earnings: existingData.stat_earnings || '', holiday_earnings: existingData.holiday_earnings || '', bonus: existingData.bonus || '', federal_tax: existingData.federal_tax || '', provincial_tax: existingData.provincial_tax || '', cpp_deduction: existingData.cpp_deduction || '', ei_deduction: existingData.ei_deduction || '', additional_tax: existingData.additional_tax || '', manual_entry_reason: existingData.manual_entry_reason || '' });
      } else { clearYTDForm(); }
    } catch (error) {
      console.error('Error loading existing YTD data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedEmployee, effectiveBusinessId, clearYTDForm]);

  const loadEmployeeData = useCallback(async () => {
    try {
      setLoading(true);
      const currentYear = new Date().getFullYear();
      const { data: ytdRecord, error: ytdError } = await supabase.from('hrpayroll_ytd_data').select('*').eq('user_id', selectedEmployee).eq('business_id', effectiveBusinessId).eq('tax_year', currentYear).single();
      if (ytdError && ytdError.code !== 'PGRST116') throw ytdError;
      setYtdData(ytdRecord || {});
      const { data: existingEntries, error: existingError } = await supabase.from('hrpayroll_entries').select('*, hrpayroll_runs (pay_date, pay_period_start, pay_period_end)').eq('user_id', selectedEmployee).eq('business_id', effectiveBusinessId).order('pay_date', { ascending: false });
      if (existingError) throw existingError;
      setExistingPayrollEntries(existingEntries || []);
      if (existingEntries && existingEntries.length > 0) setShowExistingWarning(true);
      const { data: migrationEntries, error: migrationError } = await supabase.from('hrpayroll_entries').select('*').eq('user_id', selectedEmployee).eq('business_id', effectiveBusinessId).eq('is_migration_entry', true).order('migration_period_number');
      if (migrationError) throw migrationError;
      if (migrationEntries && migrationEntries.length > 0) {
        const loadedPeriods = migrationEntries.map(entry => ({ id: entry.id, periodNumber: entry.migration_period_number, startDate: entry.period_start_date, endDate: entry.period_end_date, payDate: entry.pay_date, totalHours: entry.total_hours || '', grossEarnings: entry.gross_pay || '', vacationPayIncluded: entry.vacation_pay_included || false }));
        setPeriods(loadedPeriods); setPeriodsGenerated(true); setPayFrequency(migrationEntries[0].migration_pay_frequency || 'bi_weekly');
        if (loadedPeriods.length > 0) setFirstPeriodEndDate(loadedPeriods[0].endDate);
      }
    } catch (error) {
      console.error('Error loading employee data:', error);
      setSaveMessage(`Error loading data: ${error.message}`);
      setSaveMessageType('error');
    } finally {
      setLoading(false);
    }
  }, [selectedEmployee, effectiveBusinessId]);

  useEffect(() => { if (effectiveBusinessId) loadEmployees(); }, [effectiveBusinessId, loadEmployees]);
  useEffect(() => { filterEmployees(); }, [filterEmployees]);
  useEffect(() => {
    if (selectedEmployee) {
      if (activeTab === 'summary') loadExistingYTDData();
      else loadEmployeeData();
    } else resetForm();
  }, [selectedEmployee, activeTab, loadExistingYTDData, loadEmployeeData, resetForm]);
  useEffect(() => { if (useBusinessDefault && businessData?.default_pay_frequency) setPayFrequency(businessData.default_pay_frequency); }, [useBusinessDefault, businessData]);

  const updateYTDField = (field, value) => setYtdData(prev => ({ ...prev, [field]: value }));

  const saveYTDData = async () => {
    if (!selectedEmployee) { setSaveMessage('Please select an employee first.'); setSaveMessageType('error'); return; }
    const rateLimitCheck = await checkRateLimit('ytd_data_save');
    if (!rateLimitCheck.allowed) { setSaveMessage('Rate limit exceeded. Please wait before saving again.'); setSaveMessageType('error'); return; }
    setSaving(true); setSaveMessage('');
    try {
      await recordAction('ytd_payroll_save_started', true);
      const currentYear = new Date().getFullYear();
      const grossPay = (parseFloat(ytdData.regular_income) || 0) + (parseFloat(ytdData.overtime_income) || 0) + (parseFloat(ytdData.lieu_income) || 0) + (parseFloat(ytdData.vacation_pay) || 0) + (parseFloat(ytdData.shift_premiums) || 0) + (parseFloat(ytdData.stat_earnings) || 0) + (parseFloat(ytdData.holiday_earnings) || 0) + (parseFloat(ytdData.bonus) || 0);
      const totalDeductions = (parseFloat(ytdData.federal_tax) || 0) + (parseFloat(ytdData.provincial_tax) || 0) + (parseFloat(ytdData.cpp_deduction) || 0) + (parseFloat(ytdData.ei_deduction) || 0) + (parseFloat(ytdData.additional_tax) || 0);
      const netPay = grossPay - totalDeductions;
      const ytdRecord = { user_id: selectedEmployee, business_id: effectiveBusinessId, tax_year: currentYear, regular_hours: parseFloat(ytdData.regular_hours) || 0, overtime_hours: parseFloat(ytdData.overtime_hours) || 0, lieu_hours: parseFloat(ytdData.lieu_hours) || 0, stat_hours: parseFloat(ytdData.stat_hours) || 0, holiday_hours: parseFloat(ytdData.holiday_hours) || 0, hours_worked: parseFloat(ytdData.hours_worked) || 0, regular_income: parseFloat(ytdData.regular_income) || 0, overtime_income: parseFloat(ytdData.overtime_income) || 0, lieu_income: parseFloat(ytdData.lieu_income) || 0, vacation_pay: parseFloat(ytdData.vacation_pay) || 0, shift_premiums: parseFloat(ytdData.shift_premiums) || 0, stat_earnings: parseFloat(ytdData.stat_earnings) || 0, holiday_earnings: parseFloat(ytdData.holiday_earnings) || 0, bonus: parseFloat(ytdData.bonus) || 0, federal_tax: parseFloat(ytdData.federal_tax) || 0, provincial_tax: parseFloat(ytdData.provincial_tax) || 0, cpp_deduction: parseFloat(ytdData.cpp_deduction) || 0, ei_deduction: parseFloat(ytdData.ei_deduction) || 0, additional_tax: parseFloat(ytdData.additional_tax) || 0, gross_pay: grossPay, net_pay: netPay, manual_entry: true, manual_entry_reason: ytdData.manual_entry_reason || 'Manual YTD entry', manual_entry_by: authUser.id, last_updated: new Date().toISOString(), updated_at: new Date().toISOString() };
      const { error } = await supabase.from('hrpayroll_ytd_data').upsert(ytdRecord, { onConflict: 'user_id,business_id,tax_year' });
      if (error) throw error;
      await logSecurityEvent('ytd_payroll_data_saved', { employee_id: selectedEmployee, business_id: effectiveBusinessId, tax_year: currentYear, gross_pay: grossPay, net_pay: netPay }, 'medium');
      setSaveMessage('YTD payroll data saved successfully!'); setSaveMessageType('success');
      setSaveModalType('success'); setSaveModalMessage('YTD payroll data has been saved successfully!'); setShowSaveModal(true);
    } catch (error) {
      console.error('Error saving YTD data:', error);
      setSaveMessage(`Error saving data: ${error.message}`); setSaveMessageType('error');
      await recordAction('ytd_payroll_save_failed', false);
      setSaveModalType('error'); setSaveModalMessage(`Failed to save YTD data: ${error.message}`); setShowSaveModal(true);
    } finally {
      setSaving(false);
    }
  };

  const getPeriodsCount = (frequency) => { switch (frequency) { case 'weekly': return 53; case 'bi_weekly': return 27; case 'semi_monthly': return 24; case 'monthly': return 12; default: return 27; } };
  const getDaysPerPeriod = (frequency) => { switch (frequency) { case 'weekly': return 7; case 'bi_weekly': return 14; case 'semi_monthly': return 15; case 'monthly': return 30; default: return 14; } };

  const generatePeriods = () => {
    if (!selectedEmployee) { setSaveMessage('Please select an employee first.'); setSaveMessageType('error'); return; }
    if (!firstPeriodEndDate) { setSaveMessage('Please enter the end date of the most recent pay period.'); setSaveMessageType('error'); return; }
    const formatDate = (date) => { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; };
    const [year, month, day] = firstPeriodEndDate.split('-').map(Number);
    const mostRecentEndDate = new Date(year, month - 1, day, 12, 0, 0);
    const periodsCount = getPeriodsCount(payFrequency);
    const daysPerPeriod = getDaysPerPeriod(payFrequency);
    const generatedPeriods = [];
    for (let i = 0; i < periodsCount; i++) {
      const periodEnd = new Date(mostRecentEndDate);
      periodEnd.setDate(periodEnd.getDate() - (i * daysPerPeriod));
      const periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - daysPerPeriod + 1);
      const payDate = new Date(periodEnd);
      payDate.setDate(payDate.getDate() + 3);
      generatedPeriods.push({ id: null, periodNumber: i + 1, startDate: formatDate(periodStart), endDate: formatDate(periodEnd), payDate: formatDate(payDate), totalHours: '', grossEarnings: '', vacationPayIncluded: false });
    }
    setPeriods(generatedPeriods); setPeriodsGenerated(true); setExpandedPeriods(new Set([1, 2, 3]));
    setSaveMessage(`Generated ${periodsCount} periods. Period 1 is most recent (${firstPeriodEndDate}), Period ${periodsCount} is oldest.`); setSaveMessageType('success');
  };

  const togglePeriod = (periodNumber) => { const newExpanded = new Set(expandedPeriods); if (newExpanded.has(periodNumber)) newExpanded.delete(periodNumber); else newExpanded.add(periodNumber); setExpandedPeriods(newExpanded); };
  const expandAll = () => setExpandedPeriods(new Set(periods.map(p => p.periodNumber)));
  const collapseAll = () => setExpandedPeriods(new Set());
  const updatePeriod = (periodNumber, field, value) => setPeriods(prev => prev.map(period => period.periodNumber === periodNumber ? { ...period, [field]: value } : period));

  const calculateTotals = () => {
    if (activeTab === 'summary') {
      const totalIncome = (parseFloat(ytdData.regular_income) || 0) + (parseFloat(ytdData.overtime_income) || 0) + (parseFloat(ytdData.lieu_income) || 0) + (parseFloat(ytdData.vacation_pay) || 0) + (parseFloat(ytdData.shift_premiums) || 0) + (parseFloat(ytdData.stat_earnings) || 0) + (parseFloat(ytdData.holiday_earnings) || 0) + (parseFloat(ytdData.bonus) || 0);
      const totalHours = (parseFloat(ytdData.regular_hours) || 0) + (parseFloat(ytdData.overtime_hours) || 0) + (parseFloat(ytdData.lieu_hours) || 0) + (parseFloat(ytdData.stat_hours) || 0) + (parseFloat(ytdData.holiday_hours) || 0);
      const totalDeductions = (parseFloat(ytdData.federal_tax) || 0) + (parseFloat(ytdData.provincial_tax) || 0) + (parseFloat(ytdData.cpp_deduction) || 0) + (parseFloat(ytdData.ei_deduction) || 0) + (parseFloat(ytdData.additional_tax) || 0);
      const netIncome = totalIncome - totalDeductions;
      return { totalIncome, totalHours, totalDeductions, netIncome, totalRegular: parseFloat(ytdData.regular_income) || 0, totalOvertime: parseFloat(ytdData.overtime_income) || 0, totalVacation: parseFloat(ytdData.vacation_pay) || 0, totalRegularHours: parseFloat(ytdData.regular_hours) || 0, totalOvertimeHours: parseFloat(ytdData.overtime_hours) || 0, grandTotal: totalIncome };
    } else {
      let totalHours = 0; let totalEarnings = 0;
      periods.forEach(period => { totalHours += parseFloat(period.totalHours) || 0; totalEarnings += parseFloat(period.grossEarnings) || 0; });
      return { totalHours, totalEarnings, grandTotal: totalEarnings, totalIncome: totalEarnings };
    }
  };

  const savePeriods = async () => {
    if (!selectedEmployee) { setSaveMessage('Please select an employee first.'); setSaveMessageType('error'); return; }
    if (periods.length === 0) { setSaveMessage('Please generate periods first.'); setSaveMessageType('error'); return; }
    const periodsWithData = periods.filter(p => p.totalHours || p.grossEarnings);
    if (periodsWithData.length === 0) { setSaveMessage('Please enter data for at least one period.'); setSaveMessageType('error'); return; }
    const rateLimitCheck = await checkRateLimit('ytd_data_save');
    if (!rateLimitCheck.allowed) { setSaveMessage('Rate limit exceeded. Please wait before saving again.'); setSaveMessageType('error'); return; }
    setSaving(true); setSaveMessage('');
    try {
      await recordAction('period_payroll_save_started', true);
      const { error: deleteError } = await supabase.from('hrpayroll_entries').delete().eq('user_id', selectedEmployee).eq('business_id', effectiveBusinessId).eq('is_migration_entry', true);
      if (deleteError) throw deleteError;
      const entriesToInsert = periodsWithData.map(period => { const grossPay = parseFloat(period.grossEarnings) || 0; const totalHours = parseFloat(period.totalHours) || 0; return { user_id: selectedEmployee, business_id: effectiveBusinessId, payroll_run_id: null, is_migration_entry: true, migration_period_number: period.periodNumber, migration_pay_frequency: payFrequency, period_start_date: period.startDate, period_end_date: period.endDate, pay_date: period.payDate, total_hours: totalHours, gross_pay: grossPay, vacation_pay_included: period.vacationPayIncluded, federal_tax: 0, provincial_tax: 0, cpp_deduction: 0, ei_deduction: 0, additional_tax: 0, net_pay: grossPay, manual_entry_reason: 'Period-by-period migration data entry', created_by: authUser.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; });
      const { error: insertError } = await supabase.from('hrpayroll_entries').insert(entriesToInsert);
      if (insertError) throw insertError;
      await logSecurityEvent('period_payroll_data_saved', { employee_id: selectedEmployee, business_id: effectiveBusinessId, periods_count: periodsWithData.length, pay_frequency: payFrequency, total_gross_pay: calculateTotals().grandTotal, validation_bypassed: validationBypass }, 'medium');
      setSaveMessage(''); setSaveMessageType('success'); setValidationBypass(false); setAcknowledgedExisting(false);
      setSaveModalType('success'); setSaveModalMessage(`Successfully saved ${periodsWithData.length} payroll period${periodsWithData.length > 1 ? 's' : ''}!`); setShowSaveModal(true);
    } catch (error) {
      console.error('Error saving periods:', error);
      setSaveMessage(`Error saving data: ${error.message}`); setSaveMessageType('error');
      await recordAction('period_payroll_save_failed', false);
      setSaveModalType('error'); setSaveModalMessage(`Failed to save payroll periods: ${error.message}`); setShowSaveModal(true);
    } finally {
      setSaving(false);
    }
  };

  const totals = calculateTotals();

  if (loading) {
    return (
      <POSAuthWrapper componentName="YTDPayrollEntry" requiredRoles={['owner', 'manager', 'hr_admin']} requireBusiness={true}>
        <div style={styles.container}><div style={styles.section}><h3 style={styles.sectionTitle}>Loading...</h3><p>Loading employees and payroll data...</p></div></div>
      </POSAuthWrapper>
    );
  }

  return (
    <>
      <POSAuthWrapper componentName="YTDPayrollEntry" requiredRoles={['owner', 'manager', 'hr_admin']} requireBusiness={true}>
        <SecurityWrapper componentName="YTDPayrollEntry" securityLevel="critical" enableAuditLogging={true} sensitiveComponent={true}>
          <div style={styles.container}>
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Year-to-Date Payroll Entry</h3>
              <div style={styles.tabContainer}>
                <button style={{...styles.tab, ...(activeTab === 'summary' ? styles.activeTab : {})}} onClick={() => setActiveTab('summary')}>YTD Summary Entry</button>
                <button style={{...styles.tab, ...(activeTab === 'periods' ? styles.activeTab : {})}} onClick={() => setActiveTab('periods')}>Period-by-Period Entry</button>
              </div>
            </div>
            <YTDEmployeeSelector employees={employees} filteredEmployees={filteredEmployees} selectedEmployee={selectedEmployee} setSelectedEmployee={setSelectedEmployee} employeeStatusFilter={employeeStatusFilter} setEmployeeStatusFilter={setEmployeeStatusFilter} saveMessage={saveMessage} saveMessageType={saveMessageType} styles={styles} />
            {activeTab === 'summary' && selectedEmployee && <YTDSummaryTab ytdData={ytdData} updateYTDField={updateYTDField} totals={totals} formatTaxAmount={formatTaxAmount} saving={saving} saveYTDData={saveYTDData} styles={styles} />}
            {activeTab === 'periods' && <YTDPeriodsTab selectedEmployee={selectedEmployee} existingPayrollEntries={existingPayrollEntries} showExistingWarning={showExistingWarning} acknowledgedExisting={acknowledgedExisting} setAcknowledgedExisting={setAcknowledgedExisting} useBusinessDefault={useBusinessDefault} setUseBusinessDefault={setUseBusinessDefault} payFrequency={payFrequency} setPayFrequency={setPayFrequency} firstPeriodEndDate={firstPeriodEndDate} setFirstPeriodEndDate={setFirstPeriodEndDate} employeeIsCurrent={employeeIsCurrent} setEmployeeIsCurrent={setEmployeeIsCurrent} lastDayWorked={lastDayWorked} setLastDayWorked={setLastDayWorked} generatePeriods={generatePeriods} periodsGenerated={periodsGenerated} periods={periods} expandedPeriods={expandedPeriods} togglePeriod={togglePeriod} expandAll={expandAll} collapseAll={collapseAll} updatePeriod={updatePeriod} totals={totals} ytdData={ytdData} validationBypass={validationBypass} setValidationBypass={setValidationBypass} savePeriods={savePeriods} saving={saving} formatTaxAmount={formatTaxAmount} styles={styles} />}
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
      <SaveConfirmationModal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} type={saveModalType} message={saveModalMessage} />
    </>
  );
};

export default YTDPayrollEntry;
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiArrowLeft, FiChevronDown, FiChevronRight, FiDownload, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { logAccountingEvent } from './accountingAudit';
import { useFilingReadiness } from '../../hooks/useFilingReadiness';
import { getCurrentBusinessDate, resolveAccountingTimezone } from '../../utils/businessDateFormat';

const AccountingReports = ({ embedded = false, reportView = 'pl' }) => {
  const navigate = useNavigate();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({ requiredRoles: ['owner', 'manager', 'admin'], requireBusiness: true, componentName: 'AccountingReports' });
  const [erpnextConnected, setErpnextConnected] = useState(false);
  const [workspaceConfig, setWorkspaceConfig] = useState(null);
  const [workspaceAccounts, setWorkspaceAccounts] = useState([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [drillAccount, setDrillAccount] = useState(null);
  const [drillData, setDrillData] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState(null);
  const accountingTz = resolveAccountingTimezone(workspaceConfig, selectedBusiness);
  const [fromDate, setFromDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(() => getCurrentBusinessDate(selectedBusiness?.timezone));
  const [hstViewMode, setHstViewMode] = useState('summary');
  const [craViewMode, setCraViewMode] = useState('summary');
  const [workspaceFilters, setWorkspaceFilters] = useState({
    party: '',
    outstandingOnly: true,
    limit: 25
  });
  const [workspaceModal, setWorkspaceModal] = useState(null);
  const [workspaceSubmitting, setWorkspaceSubmitting] = useState(false);
  const [tavariOpenInvoices, setTavariOpenInvoices] = useState([]);
  const [tavariInvoicesLoading, setTavariInvoicesLoading] = useState(false);
  const [postingTavariInvoiceId, setPostingTavariInvoiceId] = useState(null);
  const [collapsedFinancialRows, setCollapsedFinancialRows] = useState({});
  const { result: filingResult, filingReady, filingStatus, runChecks: runFilingChecks, loading: filingChecksLoading } = useFilingReadiness(selectedBusinessId);
  const isFilingReportView = ['cra', 'hst', 'gst34'].includes(reportView);
  const isGeneralLedgerView = reportView === 'general_ledger';
  const glViewportRef = useRef(null);
  const [glPanelHeight, setGlPanelHeight] = useState(null);

  useLayoutEffect(() => {
    if (!isGeneralLedgerView) {
      setGlPanelHeight(null);
      return undefined;
    }
    const updateHeight = () => {
      const el = glViewportRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const bottomPad = embedded ? 12 : 20;
      setGlPanelHeight(Math.max(240, Math.floor(window.innerHeight - top - bottomPad)));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    if (observer && glViewportRef.current) {
      let node = glViewportRef.current.parentElement;
      while (node && node !== document.body) {
        observer.observe(node);
        node = node.parentElement;
      }
    }
    const raf = requestAnimationFrame(updateHeight);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateHeight);
      observer?.disconnect();
    };
  }, [
    isGeneralLedgerView,
    embedded,
    reportData,
    configLoading,
    reportLoading,
    reportError,
    filingResult,
    filingChecksLoading,
    fromDate,
    toDate,
  ]);

  useEffect(() => {
    if (!selectedBusinessId || !isFilingReportView) return;
    runFilingChecks(fromDate, toDate);
  }, [selectedBusinessId, fromDate, toDate, isFilingReportView, runFilingChecks]);

  useEffect(() => {
    if (!selectedBusinessId) return;
    (async () => {
      try {
        setConfigLoading(true);
        setConfigError(null);
        const { data, error } = await supabase
          .from('accounting_business_config')
          .select('erpnext_api_url, default_bank_account_erpnext, accounts_payable_account_erpnext, pos_revenue_account_erpnext, bookings_revenue_account_erpnext, erpnext_company_name, business_timezone')
          .eq('business_id', selectedBusinessId)
          .maybeSingle();
        if (error) {
          setErpnextConnected(false);
          setWorkspaceConfig(null);
          setConfigError(error.message || 'Failed to load accounting configuration');
          return;
        }
        setErpnextConnected(!!(data?.erpnext_api_url?.trim()));
        setWorkspaceConfig(data || null);
      } catch (e) {
        setErpnextConnected(false);
        setWorkspaceConfig(null);
        setConfigError(e?.message || 'Failed to load accounting configuration');
      } finally {
        setConfigLoading(false);
      }
    })();
  }, [selectedBusinessId]);

  const fetchReport = useCallback(async () => {
    if (!selectedBusinessId) return;
    setReportLoading(true);
    setReportError(null);
    setReportData(null);
    try {
      const reportType =
        reportView === 'cra' ? 'cra_summary'
        : reportView === 'hst' ? 'hst'
        : reportView === 'balance_sheet' ? 'balance_sheet'
        : reportView === 'gst34' ? 'gst34'
        : reportView === 'general_ledger' ? 'general_ledger'
        : reportView === 'trial_balance' ? 'trial_balance'
        : reportView === 'ap_aging' ? 'ap_aging'
        : reportView === 'ar_aging' ? 'ar_aging'
        : reportView === 'ap_workspace' ? 'ap_workspace'
        : reportView === 'ar_workspace' ? 'ar_workspace'
        : 'pl';
      const { data, error } = await supabase.functions.invoke('accounting-erpnext-report', {
        body: {
          business_id: selectedBusinessId,
          report_type: reportType,
          from_date: fromDate?.slice(0, 10) || defaultFrom,
          to_date: toDate?.slice(0, 10) || defaultTo,
          ...(reportType === 'ap_workspace' || reportType === 'ar_workspace'
            ? {
                filter_party: workspaceFilters.party,
                outstanding_only: workspaceFilters.outstandingOnly,
                limit: workspaceFilters.limit
              }
            : {})
        }
      });
      if (data?.error) {
        setReportError(data.error);
        toast.error(data.error);
        return;
      }
      if (error) {
        const msg = error?.context?.body?.error || error?.message || 'Failed to load report';
        setReportError(msg);
        toast.error(msg);
        return;
      }
      setReportData(data);
    } catch (e) {
      const msg = e?.message || 'Failed to load report';
      setReportError(msg);
      toast.error(msg);
    } finally {
      setReportLoading(false);
    }
  }, [selectedBusinessId, reportView, fromDate, toDate, workspaceFilters]);

  useEffect(() => {
    if (erpnextConnected && !configLoading) fetchReport();
  }, [erpnextConnected, configLoading, reportView, fromDate, toDate, fetchReport]);

  useEffect(() => {
    if (!selectedBusinessId || !(reportView === 'ap_workspace' || reportView === 'ar_workspace')) return;
    supabase.functions.invoke('accounting-list-accounts', { body: { business_id: selectedBusinessId } })
      .then(({ data, error }) => {
        if (error || data?.error) {
          setWorkspaceAccounts([]);
          return;
        }
        setWorkspaceAccounts(Array.isArray(data?.accounts) ? data.accounts.map((item) => item.name) : []);
      })
      .catch(() => setWorkspaceAccounts([]));
  }, [selectedBusinessId, reportView]);

  useEffect(() => {
    if (!selectedBusinessId || reportView !== 'ar_workspace') return;
    setTavariInvoicesLoading(true);
    supabase
      .from('tavari_invoices')
      .select('id, invoice_number, recipient_name, recipient_company, status, total, balance_due, due_date, erpnext_sales_invoice_name, created_at')
      .eq('business_id', selectedBusinessId)
      .gt('balance_due', 0)
      .in('status', ['sent', 'viewed', 'partially_paid', 'overdue'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50)
      .then(({ data, error }) => {
        setTavariOpenInvoices(error ? [] : (data || []));
        setTavariInvoicesLoading(false);
      });
  }, [selectedBusinessId, reportView, reportData]);

  useEffect(() => {
    if (reportView === 'ap_workspace' || reportView === 'ar_workspace') {
      setWorkspaceFilters({ party: '', outstandingOnly: true, limit: 25 });
      setWorkspaceModal(null);
    }
    if (reportView === 'hst') {
      setHstViewMode('summary');
    }
    if (reportView === 'cra') {
      setCraViewMode('summary');
    }
    if (reportView === 'pl' || reportView === 'balance_sheet') {
      setCollapsedFinancialRows({});
    }
  }, [reportView]);

  const fetchDrillDown = useCallback(async (accountName) => {
    if (!selectedBusinessId || !accountName) return;
    setDrillAccount(accountName);
    setDrillData(null);
    setDrillError(null);
    setDrillLoading(true);
    const from = fromDate?.slice(0, 10) || defaultFrom;
    const to = toDate?.slice(0, 10) || defaultTo;
    try {
      const { data, error } = await supabase.functions.invoke('accounting-gl-drilldown', {
        body: {
          business_id: selectedBusinessId,
          account_name: accountName,
          from_date: from,
          to_date: to
        }
      });
      if (data?.error) {
        setDrillError(data.error);
        toast.error(data.error);
        return;
      }
      if (error) {
        const msg = error?.context?.body?.error || error?.message || 'Failed to load transactions';
        setDrillError(msg);
        toast.error(msg);
        return;
      }
      setDrillData(data);
    } catch (e) {
      const msg = e?.message || 'Failed to load transactions';
      setDrillError(msg);
      toast.error(msg);
    } finally {
      setDrillLoading(false);
    }
  }, [selectedBusinessId, fromDate, toDate]);

  const escapeCsvCell = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rowsToCsv = (rows, columns) => {
    if (!Array.isArray(rows) || rows.length === 0) return '';
    const colDefs = Array.isArray(columns) && columns.length > 0
      ? columns
      : Object.keys(rows[0] || {}).map((key) => ({ fieldname: key, label: key }));
    const header = colDefs.map((col) => escapeCsvCell(col.label ?? col.fieldname ?? '')).join(',');
    const body = rows.map((row) =>
      colDefs.map((col, index) => escapeCsvCell(Array.isArray(row) ? row[index] : row?.[col.fieldname])).join(',')
    );
    return [header, ...body].join('\n');
  };

  const downloadFile = (filename, content, contentType) => {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const renderHtmlTable = (heading, rows, columns) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return `
        <section style="margin-bottom:24px;">
          <h2 style="font-size: 18px;margin:0 0 10px;">${escapeHtml(heading)}</h2>
          <p style="margin:0;color:#6b7280;">No data for this section.</p>
        </section>
      `;
    }
    const colDefs = Array.isArray(columns) && columns.length > 0
      ? columns
      : Object.keys(rows[0] || {}).map((key) => ({ fieldname: key, label: key }));
    const tableHead = colDefs.map((col) => `<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #d1d5db;">${escapeHtml(col.label ?? col.fieldname ?? '')}</th>`).join('');
    const tableRows = rows.map((row) => {
      const cells = colDefs.map((col, index) => {
        const value = Array.isArray(row) ? row[index] : row?.[col.fieldname];
        return `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${escapeHtml(value)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `
      <section style="margin-bottom:24px;">
        <h2 style="font-size: 18px;margin:0 0 10px;">${escapeHtml(heading)}</h2>
        <table style="width:100%;border-collapse:collapse;font-size: 13px;">
          <thead><tr>${tableHead}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>
    `;
  };

  const exportJson = () => {
    if (!reportData) return;
    const slug = reportView || 'report';
    downloadFile(`accounting-${slug}-${toDate}.json`, JSON.stringify(reportData, null, 2), 'application/json;charset=utf-8');
    logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'report_exported_json',
      entityType: 'accounting_report',
      entityId: reportData.report_type || slug,
      details: { report_view: reportView, from_date: fromDate, to_date: toDate }
    });
  };

  const exportCsv = () => {
    if (!reportData) return;
    let csv = '';
    if (reportData.report_type === 'cra_summary') {
      csv = [
        'CRA Summary - Income',
        rowsToCsv(reportData.pl?.result || [], reportData.pl?.columns || []),
        '',
        'CRA Summary - GST/HST',
        rowsToCsv(reportData.hst?.result || [], reportData.hst?.columns || []),
        '',
        'CRA Summary - Balance Sheet',
        rowsToCsv(reportData.balance_sheet?.result || [], reportData.balance_sheet?.columns || [])
      ].join('\n');
    } else if (reportData.report_type === 'ap_workspace') {
      csv = [
        'AP Aging',
        rowsToCsv(reportData.aging?.result || [], reportData.aging?.columns || []),
        '',
        'Recent Purchase Invoices',
        rowsToCsv(reportData.purchase_invoices || [], reportData.purchase_invoice_columns || []),
        '',
        'Recent AP Payments',
        rowsToCsv(reportData.payments || [], reportData.payment_columns || [])
      ].join('\n');
    } else if (reportData.report_type === 'ar_workspace') {
      csv = [
        'AR Aging',
        rowsToCsv(reportData.aging?.result || [], reportData.aging?.columns || []),
        '',
        'Recent Sales Invoices',
        rowsToCsv(reportData.sales_invoices || [], reportData.sales_invoice_columns || []),
        '',
        'Recent AR Payments',
        rowsToCsv(reportData.payments || [], reportData.payment_columns || [])
      ].join('\n');
    } else if (reportData.report_type === 'gst34') {
      csv = [
        'GST34 Worksheet',
        rowsToCsv(hstWorksheetRows, [{ fieldname: 'box', label: 'Box' }, { fieldname: 'label', label: 'Description' }, { fieldname: 'value', label: 'Value' }]),
        '',
        'General Ledger',
        rowsToCsv(reportData.gl_result || [], reportData.gl_columns || [])
      ].join('\n');
    } else if (reportData.report_type === 'hst') {
      csv = [
        'HST Summary',
        rowsToCsv([
          { label: 'HST collected from sales', value: hstSummary.hst_collected },
          { label: 'HST paid on expenses', value: hstSummary.hst_paid_on_expenses },
          { label: `Net HST ${hstSummary.filing_position === 'owed' ? 'owed' : 'refund'}`, value: Math.abs(hstSummary.net_hst_owed) }
        ], [{ fieldname: 'label', label: 'Description' }, { fieldname: 'value', label: 'Value' }]),
        '',
        'GST34 Worksheet',
        rowsToCsv(hstWorksheetRows, [{ fieldname: 'box', label: 'Box' }, { fieldname: 'label', label: 'Description' }, { fieldname: 'value', label: 'Value' }]),
        '',
        'General Ledger',
        rowsToCsv(reportData.result || [], reportData.columns || [])
      ].join('\n');
    } else {
      csv = rowsToCsv(reportData.result || [], reportData.columns || []);
    }
    downloadFile(`accounting-${reportView}-${toDate}.csv`, csv, 'text/csv;charset=utf-8');
    logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'report_exported_csv',
      entityType: 'accounting_report',
      entityId: reportData.report_type || reportView,
      details: { report_view: reportView, from_date: fromDate, to_date: toDate }
    });
  };

  const exportHandoffPackage = async () => {
    if (!reportData) return;
    const needsFilingGate = ['cra_summary', 'hst', 'gst34'].includes(reportData.report_type);
    if (needsFilingGate) {
      const filing = filingResult || await runFilingChecks(fromDate, toDate);
      if (filing && !filing.filing_ready) {
        const msg = filing.filing_status === 'blocked'
          ? 'Filing checks failed (HST mapping or trial balance). Export handoff anyway?'
          : 'Filing checks have warnings. Export handoff anyway?';
        if (!window.confirm(msg)) return;
      }
    }
    const sections = [];
    if (reportData.report_type === 'cra_summary') {
      sections.push(renderHtmlTable('Income Statement', reportData.pl?.result || [], reportData.pl?.columns || []));
      sections.push(renderHtmlTable('GST/HST', reportData.hst?.result || [], reportData.hst?.columns || []));
      sections.push(renderHtmlTable('Balance Sheet', reportData.balance_sheet?.result || [], reportData.balance_sheet?.columns || []));
    } else if (reportData.report_type === 'ap_workspace') {
      sections.push(renderHtmlTable('AP Aging', reportData.aging?.result || [], reportData.aging?.columns || []));
      sections.push(renderHtmlTable('Recent Purchase Invoices', reportData.purchase_invoices || [], reportData.purchase_invoice_columns || []));
      sections.push(renderHtmlTable('Recent AP Payments', reportData.payments || [], reportData.payment_columns || []));
    } else if (reportData.report_type === 'ar_workspace') {
      sections.push(renderHtmlTable('AR Aging', reportData.aging?.result || [], reportData.aging?.columns || []));
      sections.push(renderHtmlTable('Recent Sales Invoices', reportData.sales_invoices || [], reportData.sales_invoice_columns || []));
      sections.push(renderHtmlTable('Recent AR Payments', reportData.payments || [], reportData.payment_columns || []));
    } else if (reportData.report_type === 'gst34') {
      sections.push(renderHtmlTable('GST34 Worksheet', hstWorksheetRows.map((row) => ({
        box: row.box,
        description: row.label,
        value: row.value
      })), [
        { fieldname: 'box', label: 'Box' },
        { fieldname: 'description', label: 'Description' },
        { fieldname: 'value', label: 'Value' }
      ]));
      sections.push(renderHtmlTable('General Ledger Detail', reportData.gl_result || [], reportData.gl_columns || []));
    } else if (reportData.report_type === 'hst') {
      sections.push(renderHtmlTable('HST Summary', [
        { description: 'HST collected from sales', value: hstSummary.hst_collected },
        { description: 'HST paid on expenses', value: hstSummary.hst_paid_on_expenses },
        { description: `Net HST ${hstSummary.filing_position === 'owed' ? 'owed' : 'refund'}`, value: Math.abs(hstSummary.net_hst_owed) }
      ], [
        { fieldname: 'description', label: 'Description' },
        { fieldname: 'value', label: 'Value' }
      ]));
      sections.push(renderHtmlTable('GST34 Worksheet', hstWorksheetRows.map((row) => ({
        box: row.box,
        description: row.label,
        value: row.value
      })), [
        { fieldname: 'box', label: 'Box' },
        { fieldname: 'description', label: 'Description' },
        { fieldname: 'value', label: 'Value' }
      ]));
      sections.push(renderHtmlTable('General Ledger Detail', reportData.result || [], reportData.columns || []));
    } else {
      sections.push(renderHtmlTable(title, reportData.result || [], reportData.columns || []));
    }

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)} handoff</title>
  </head>
  <body style="font-family:Arial,sans-serif;padding:32px;color:#111827;">
    <h1 style="margin:0 0 8px;">${escapeHtml(title)} handoff package</h1>
    <p style="margin:0 0 4px;color:#4b5563;">Business: ${escapeHtml(selectedBusinessId)}</p>
    <p style="margin:0 0 4px;color:#4b5563;">Period: ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</p>
    <p style="margin:0 0 24px;color:#4b5563;">Generated: ${escapeHtml(new Date().toLocaleString())}</p>
    ${sections.join('\n')}
  </body>
</html>`;

    downloadFile(`accounting-${reportView}-${toDate}-handoff.html`, html, 'text/html;charset=utf-8');
    logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'report_exported_handoff',
      entityType: 'accounting_report',
      entityId: reportData.report_type || reportView,
      details: { report_view: reportView, from_date: fromDate, to_date: toDate }
    });
  };

  const isSummaryRow = (accountLabel) => {
    if (accountLabel == null) return true;
    const s = String(accountLabel).toLowerCase();
    return /^total\b|profit for the year|net (profit|loss)|total expense|total income|total revenue/i.test(s) || s.trim() === '';
  };

  if (authLoading || !selectedBusinessId) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;

  const isCra = reportView === 'cra';
  const isHst = reportView === 'hst';
  const isBalanceSheet = reportView === 'balance_sheet';
  const isGst34 = reportView === 'gst34';
  const isGeneralLedger = reportView === 'general_ledger';
  const isTrialBalance = reportView === 'trial_balance';
  const isApAging = reportView === 'ap_aging';
  const isArAging = reportView === 'ar_aging';
  const isApWorkspace = reportView === 'ap_workspace';
  const isArWorkspace = reportView === 'ar_workspace';
  const title =
    isCra ? 'CRA Filing Summary'
    : isHst ? 'HST Report'
    : isBalanceSheet ? 'Balance Sheet'
    : isGst34 ? 'GST34 Worksheet'
    : isGeneralLedger ? 'General Ledger'
    : isTrialBalance ? 'Trial Balance'
    : isApAging ? 'Accounts Payable Aging'
    : isArAging ? 'Accounts Receivable Aging'
    : isApWorkspace ? 'AP Workspace'
    : isArWorkspace ? 'AR Workspace'
    : 'P&L Report';

  const bankAccountOptions = workspaceAccounts.filter((name) => /bank|cash|cheque/i.test(name));
  const expenseAccountOptions = workspaceAccounts.filter((name) => !/bank|cash|cheque|debtor|creditor/i.test(name));
  const incomeAccountOptions = workspaceAccounts.filter((name) => /sales|revenue|income/i.test(name));

  const openWorkspaceModal = (type, seed = {}) => {
    const baseDate = toDate?.slice(0, 10) || defaultTo;
    const defaults = {
      create_purchase_invoice: {
        supplier_name: '',
        posting_date: baseDate,
        due_date: baseDate,
        bill_no: '',
        amount: '',
        expense_account: expenseAccountOptions[0] || '',
        description: '',
        notes: ''
      },
      record_ap_payment: {
        supplier_name: '',
        purchase_invoice_name: '',
        posting_date: baseDate,
        amount: '',
        bank_account: workspaceConfig?.default_bank_account_erpnext || bankAccountOptions[0] || '',
        payable_account: workspaceConfig?.accounts_payable_account_erpnext || '',
        notes: ''
      },
      create_sales_invoice: {
        customer_name: '',
        posting_date: baseDate,
        due_date: baseDate,
        amount: '',
        income_account: workspaceConfig?.pos_revenue_account_erpnext || workspaceConfig?.bookings_revenue_account_erpnext || incomeAccountOptions[0] || '',
        description: '',
        notes: ''
      },
      record_ar_payment: {
        customer_name: '',
        sales_invoice_name: '',
        posting_date: baseDate,
        amount: '',
        bank_account: workspaceConfig?.default_bank_account_erpnext || bankAccountOptions[0] || '',
        receivable_account: '',
        notes: ''
      }
    };
    setWorkspaceModal({
      type,
      fields: {
        ...(defaults[type] || {}),
        ...seed
      }
    });
  };

  const closeWorkspaceModal = () => {
    setWorkspaceModal(null);
    setWorkspaceSubmitting(false);
  };

  const updateWorkspaceField = (field, value) => {
    setWorkspaceModal((prev) => prev ? { ...prev, fields: { ...prev.fields, [field]: value } } : prev);
  };

  const runWorkspaceAction = async () => {
    if (!selectedBusinessId || !workspaceModal?.type) return;
    setWorkspaceSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-workspace-action', {
        body: {
          business_id: selectedBusinessId,
          action: workspaceModal.type,
          payload: workspaceModal.fields
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${data?.doctype || 'ERPNext document'} ${data?.name || ''} created.`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: workspaceModal.type,
        entityType: 'erpnext_workspace',
        entityId: data?.name || null,
        details: { doctype: data?.doctype, party: data?.party, reference_name: data?.reference_name }
      });
      closeWorkspaceModal();
      await fetchReport();
    } catch (e) {
      toast.error(e?.message || 'Workspace action failed');
      setWorkspaceSubmitting(false);
    }
  };

  const getErpnextDocUrl = (doctype, name) => {
    if (!workspaceConfig?.erpnext_api_url || !doctype || !name) return '';
    const slug = String(doctype).toLowerCase().replace(/\s+/g, '-');
    return `${String(workspaceConfig.erpnext_api_url).replace(/\/$/, '')}/app/${slug}/${encodeURIComponent(name)}`;
  };

  const renderWorkspaceActions = (row, type) => {
    if (!row || typeof row !== 'object') return null;
    if (type === 'ap_invoice') {
      return (
        <>
          <button
            type="button"
            onClick={() => openWorkspaceModal('record_ap_payment', {
              supplier_name: row.supplier || '',
              purchase_invoice_name: row.name || '',
              amount: row.outstanding_amount || row.grand_total || ''
            })}
            style={styles.workspaceActionButton}
          >
            Pay
          </button>
          {row.name && (
            <a href={getErpnextDocUrl('Purchase Invoice', row.name)} target="_blank" rel="noreferrer" style={styles.workspaceLink}>
              Open
            </a>
          )}
        </>
      );
    }
    if (type === 'ar_invoice') {
      return (
        <>
          <button
            type="button"
            onClick={() => openWorkspaceModal('record_ar_payment', {
              customer_name: row.customer || '',
              sales_invoice_name: row.name || '',
              amount: row.outstanding_amount || row.grand_total || ''
            })}
            style={styles.workspaceActionButton}
          >
            Receive payment
          </button>
          {row.name && (
            <a href={getErpnextDocUrl('Sales Invoice', row.name)} target="_blank" rel="noreferrer" style={styles.workspaceLink}>
              Open
            </a>
          )}
        </>
      );
    }
    if (type === 'payment' && row.name) {
      return (
        <a href={getErpnextDocUrl('Payment Entry', row.name)} target="_blank" rel="noreferrer" style={styles.workspaceLink}>
          Open
        </a>
      );
    }
    return null;
  };

  const postTavariInvoiceToErp = async (invoice) => {
    if (!selectedBusinessId || !invoice?.id) return;
    setPostingTavariInvoiceId(invoice.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-workspace-action', {
        body: {
          business_id: selectedBusinessId,
          action: 'post_tavari_invoice',
          payload: { tavari_invoice_id: invoice.id }
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.skipped ? `Already posted as ${data.name}` : `Posted Sales Invoice ${data.name}`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'post_tavari_invoice',
        entityType: 'tavari_invoice',
        entityId: invoice.id,
        details: { erpnext_sales_invoice_name: data?.name, invoice_number: invoice.invoice_number }
      });
      const { data: refreshed } = await supabase
        .from('tavari_invoices')
        .select('id, invoice_number, recipient_name, recipient_company, status, total, balance_due, due_date, erpnext_sales_invoice_name, created_at')
        .eq('business_id', selectedBusinessId)
        .gt('balance_due', 0)
        .in('status', ['sent', 'viewed', 'partially_paid', 'overdue'])
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(50);
      setTavariOpenInvoices(refreshed || []);
      await fetchReport();
    } catch (e) {
      toast.error(e?.message || 'Failed to post Tavari invoice');
    } finally {
      setPostingTavariInvoiceId(null);
    }
  };

  const renderWorkspaceTable = (rows, columns, type) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return <p style={{ color: TavariStyles?.colors?.gray600 }}>No data for this selection.</p>;
    }
    return (
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              {columns.map((column) => (
                <th key={column.fieldname} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>
                  {column.label}
                </th>
              ))}
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${type}-${row?.name || index}`} style={{ borderBottom: '1px solid #eee' }}>
                {columns.map((column) => (
                  <td key={column.fieldname} style={{ padding: '8px 12px' }}>
                    {row?.[column.fieldname] ?? '—'}
                  </td>
                ))}
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {renderWorkspaceActions(row, type)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderWorkspaceModal = () => {
    if (!workspaceModal) return null;
    const typeLabels = {
      create_purchase_invoice: 'Create Vendor Bill',
      record_ap_payment: 'Record AP Payment',
      create_sales_invoice: 'Create Customer Invoice',
      record_ar_payment: 'Record AR Payment'
    };
    const fields = workspaceModal.fields || {};
    const fieldRows = [];
    if (workspaceModal.type === 'create_purchase_invoice') {
      fieldRows.push(
        ['Supplier', 'supplier_name', 'text'],
        ['Posting date', 'posting_date', 'date'],
        ['Due date', 'due_date', 'date'],
        ['Vendor bill #', 'bill_no', 'text'],
        ['Amount', 'amount', 'number'],
        ['Description', 'description', 'text']
      );
    } else if (workspaceModal.type === 'record_ap_payment') {
      fieldRows.push(
        ['Supplier', 'supplier_name', 'text'],
        ['Purchase invoice', 'purchase_invoice_name', 'text'],
        ['Posting date', 'posting_date', 'date'],
        ['Amount', 'amount', 'number']
      );
    } else if (workspaceModal.type === 'create_sales_invoice') {
      fieldRows.push(
        ['Customer', 'customer_name', 'text'],
        ['Posting date', 'posting_date', 'date'],
        ['Due date', 'due_date', 'date'],
        ['Amount', 'amount', 'number'],
        ['Description', 'description', 'text']
      );
    } else if (workspaceModal.type === 'record_ar_payment') {
      fieldRows.push(
        ['Customer', 'customer_name', 'text'],
        ['Sales invoice', 'sales_invoice_name', 'text'],
        ['Posting date', 'posting_date', 'date'],
        ['Amount', 'amount', 'number']
      );
    }
    const accountField = workspaceModal.type === 'create_purchase_invoice'
      ? ['Expense account', 'expense_account', expenseAccountOptions]
      : workspaceModal.type === 'record_ap_payment'
        ? ['Bank account', 'bank_account', bankAccountOptions]
        : workspaceModal.type === 'create_sales_invoice'
          ? ['Income account', 'income_account', incomeAccountOptions.length > 0 ? incomeAccountOptions : workspaceAccounts]
          : ['Bank account', 'bank_account', bankAccountOptions];
    const secondaryAccountField = workspaceModal.type === 'record_ap_payment'
      ? ['Payable account (optional)', 'payable_account', workspaceAccounts]
      : workspaceModal.type === 'record_ar_payment'
        ? ['Receivable account (optional)', 'receivable_account', workspaceAccounts]
        : null;

    return (
      <div style={styles.workspaceModalBackdrop} onClick={closeWorkspaceModal}>
        <div style={styles.workspaceModalCard} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{typeLabels[workspaceModal.type] || 'Workspace action'}</h2>
            <button type="button" style={styles.workspaceSecondaryButton} onClick={closeWorkspaceModal}>Close</button>
          </div>
          <div style={styles.workspaceFormGrid}>
            {fieldRows.map(([label, field, inputType]) => (
              <label key={field} style={styles.workspaceField}>
                <span style={styles.workspaceLabel}>{label}</span>
                <input
                  type={inputType}
                  value={fields[field] ?? ''}
                  onChange={(e) => updateWorkspaceField(field, e.target.value)}
                  style={styles.workspaceInput}
                />
              </label>
            ))}
            <label style={styles.workspaceField}>
              <span style={styles.workspaceLabel}>{accountField[0]}</span>
              <select
                value={fields[accountField[1]] ?? ''}
                onChange={(e) => updateWorkspaceField(accountField[1], e.target.value)}
                style={styles.workspaceInput}
              >
                <option value="">Select account</option>
                {accountField[2].map((name) => (
                  <option key={`${accountField[1]}-${name}`} value={name}>{name}</option>
                ))}
              </select>
            </label>
            {secondaryAccountField && (
              <label style={styles.workspaceField}>
                <span style={styles.workspaceLabel}>{secondaryAccountField[0]}</span>
                <select
                  value={fields[secondaryAccountField[1]] ?? ''}
                  onChange={(e) => updateWorkspaceField(secondaryAccountField[1], e.target.value)}
                  style={styles.workspaceInput}
                >
                  <option value="">Use ERPNext default</option>
                  {secondaryAccountField[2].map((name) => (
                    <option key={`${secondaryAccountField[1]}-${name}`} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ ...styles.workspaceField, gridColumn: '1 / -1' }}>
              <span style={styles.workspaceLabel}>Notes (optional)</span>
              <textarea
                value={fields.notes ?? ''}
                onChange={(e) => updateWorkspaceField('notes', e.target.value)}
                style={{ ...styles.workspaceInput, minHeight: 96, resize: 'vertical' }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
            <button type="button" style={styles.workspaceSecondaryButton} onClick={closeWorkspaceModal} disabled={workspaceSubmitting}>Cancel</button>
            <button type="button" style={styles.workspacePrimaryButton} onClick={runWorkspaceAction} disabled={workspaceSubmitting}>
              {workspaceSubmitting ? 'Saving...' : 'Submit to ERPNext'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const formatMoney = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const GL_COLUMN_LABELS = {
    posting_date: 'Date',
    date: 'Date',
    account: 'Account',
    account_name: 'Account',
    party: 'Party',
    party_type: 'Party type',
    voucher_type: 'Type',
    voucher_no: 'Voucher #',
    against: 'Against',
    against_voucher: 'Against',
    debit: 'Debit',
    credit: 'Credit',
    debit_in_account_currency: 'Debit',
    credit_in_account_currency: 'Credit',
    balance: 'Balance',
    remarks: 'Remarks',
    cost_center: 'Cost center',
    project: 'Project',
  };

  const GL_COLUMN_ORDER = [
    'posting_date',
    'date',
    'account',
    'account_name',
    'party',
    'voucher_type',
    'voucher_no',
    'against',
    'against_voucher',
    'debit_in_account_currency',
    'debit',
    'credit_in_account_currency',
    'credit',
    'balance',
    'remarks',
    'cost_center',
    'project',
  ];

  const GL_CURRENCY_FIELDS = new Set([
    'debit',
    'credit',
    'balance',
    'debit_in_account_currency',
    'credit_in_account_currency',
    'opening_debit',
    'opening_credit',
  ]);

  const GL_DATE_FIELDS = new Set(['posting_date', 'date']);

  const GL_SKIP_FIELDS = new Set([
    'account_currency',
    'company',
    'fiscal_year',
    'is_opening',
    'cumulative_total',
  ]);

  const formatGlDate = (value) => {
    if (value == null || value === '') return '—';
    const s = String(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T12:00:00`).toLocaleDateString('en-CA');
    }
    return String(value);
  };

  const formatGlCell = (value, fieldname) => {
    if (value == null || value === '') return '—';
    const field = String(fieldname || '').toLowerCase();
    if (GL_CURRENCY_FIELDS.has(field)) {
      const n = Number(value);
      if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '—';
      return `$${formatMoney(n)}`;
    }
    if (GL_DATE_FIELDS.has(field)) return formatGlDate(value);
    return String(value);
  };

  const prepareGlColumns = (result, columns) => {
    const base = getColumnDefs(result, columns).filter((c) => {
      const field = String(c?.fieldname || '').toLowerCase();
      return field && !c?.hidden && !GL_SKIP_FIELDS.has(field);
    });
    const getCellByField = (row, field) => {
      if (Array.isArray(row)) return null;
      return row?.[field];
    };
    const nonEmpty = base.filter((c) => {
      const field = c.fieldname;
      return (result || []).some((row) => {
        const val = getCellByField(row, field);
        return val != null && String(val).trim() !== '';
      });
    });
    const ordered = [...nonEmpty].sort((a, b) => {
      const ai = GL_COLUMN_ORDER.indexOf(a.fieldname);
      const bi = GL_COLUMN_ORDER.indexOf(b.fieldname);
      const aRank = ai >= 0 ? ai : 999;
      const bRank = bi >= 0 ? bi : 999;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.label || a.fieldname).localeCompare(String(b.label || b.fieldname));
    });
    const fields = new Set(ordered.map((c) => c.fieldname));
    if (fields.has('debit_in_account_currency') && fields.has('debit')) {
      return ordered.filter((c) => c.fieldname !== 'debit');
    }
    if (fields.has('credit_in_account_currency') && fields.has('credit')) {
      return ordered.filter((c) => c.fieldname !== 'credit');
    }
    return ordered;
  };

  const renderGeneralLedgerTable = (result, columns, options = {}) => {
    const { viewportFill = false } = options;
    if (!result || !Array.isArray(result)) return <p style={{ color: TavariStyles?.colors?.gray600 }}>No data.</p>;
    const rows = result.filter((row) => {
      if (Array.isArray(row)) return row.some((value) => value != null && String(value).trim() !== '');
      if (row && typeof row === 'object') return Object.values(row).some((value) => value != null && String(value).trim() !== '');
      return row != null && String(row).trim() !== '';
    });
    if (rows.length === 0) return <p style={{ color: TavariStyles?.colors?.gray600 }}>No data for this period.</p>;

    const colDefs = prepareGlColumns(rows, columns);
    if (colDefs.length === 0) return <p style={{ color: TavariStyles?.colors?.gray600 }}>No columns to display.</p>;

    const getLabel = (c) => GL_COLUMN_LABELS[c?.fieldname] || c?.label || c?.fieldname || '';
    const getCell = (row, field) => {
      if (Array.isArray(row)) return null;
      return field != null ? row[field] : null;
    };

    const accountField = colDefs.find((c) => ['account', 'account_name'].includes(String(c.fieldname)))?.fieldname || 'account';
    const isTotalRow = (row) => {
      const account = getCell(row, accountField);
      const text = account != null ? String(account).trim().toLowerCase() : '';
      return text === 'total' || text.endsWith(' total') || text.startsWith("'total");
    };
    const getIndent = (row) => (row && typeof row === 'object' && Number.isFinite(Number(row.indent)) ? Number(row.indent) : 0);

    const colMinWidth = (field) => {
      const f = String(field || '').toLowerCase();
      if (GL_DATE_FIELDS.has(f)) return 108;
      if (GL_CURRENCY_FIELDS.has(f)) return 112;
      if (f === 'account' || f === 'account_name') return 220;
      if (f === 'remarks') return 240;
      if (f === 'voucher_no') return 130;
      if (f === 'party') return 160;
      return 120;
    };

    return (
      <div
        style={{
          overflow: 'auto',
          ...(viewportFill ? { flex: 1, minHeight: 0 } : { maxHeight: '72vh' }),
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        <table style={{ width: '100%', minWidth: 960, borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              {colDefs.map((c) => {
                const isNumeric = GL_CURRENCY_FIELDS.has(String(c.fieldname));
                return (
                  <th
                    key={c.fieldname}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      textAlign: isNumeric ? 'right' : 'left',
                      padding: '10px 12px',
                      fontWeight: 700,
                      fontSize: 13,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      color: '#374151',
                      background: '#f3f4f6',
                      borderBottom: '2px solid #d1d5db',
                      whiteSpace: 'nowrap',
                      minWidth: colMinWidth(c.fieldname),
                    }}
                  >
                    {getLabel(c)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const totalRow = isTotalRow(row);
              const indent = getIndent(row);
              const zebra = i % 2 === 1;
              return (
                <tr
                  key={i}
                  style={{
                    background: totalRow ? '#eef2ff' : zebra ? '#fafafa' : '#fff',
                  }}
                >
                  {colDefs.map((c) => {
                    const field = c.fieldname;
                    const raw = getCell(row, field);
                    const display = formatGlCell(raw, field);
                    const isNumeric = GL_CURRENCY_FIELDS.has(String(field));
                    const isAccount = field === accountField;
                    const isRemarks = field === 'remarks';
                    const isVoucher = field === 'voucher_no';
                    return (
                      <td
                        key={field}
                        title={isRemarks && raw != null ? String(raw) : undefined}
                        style={{
                          padding: '9px 12px',
                          textAlign: isNumeric ? 'right' : 'left',
                          verticalAlign: 'top',
                          fontWeight: totalRow ? 700 : 400,
                          fontFamily: isVoucher ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
                          fontSize: isVoucher ? 12 : 13,
                          color: totalRow ? '#1e3a8a' : '#111827',
                          borderBottom: '1px solid #eef2f7',
                          paddingLeft: isAccount ? 12 + indent * 16 : 12,
                          maxWidth: isRemarks ? 320 : undefined,
                          overflow: isRemarks ? 'hidden' : undefined,
                          textOverflow: isRemarks ? 'ellipsis' : undefined,
                          whiteSpace: isRemarks ? 'nowrap' : isNumeric ? 'nowrap' : 'normal',
                          wordBreak: isAccount ? 'break-word' : undefined,
                        }}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const hstSummary = reportData?.summary || {
    sales_total: Math.abs(Number(reportData?.worksheet?.box_101 || 0) || 0),
    hst_collected: Math.abs(Number(reportData?.worksheet?.box_103 || 0) || 0),
    hst_paid_on_expenses: Math.abs(Number(reportData?.worksheet?.box_106 || 0) || 0),
    net_hst_owed: Math.round(((Math.abs(Number(reportData?.worksheet?.box_103 || 0) || 0)) - (Math.abs(Number(reportData?.worksheet?.box_106 || 0) || 0))) * 100) / 100,
    filing_position: ((Math.abs(Number(reportData?.worksheet?.box_103 || 0) || 0)) - (Math.abs(Number(reportData?.worksheet?.box_106 || 0) || 0))) >= 0 ? 'owed' : 'refund'
  };
  const hstWorksheetRows = [
    { box: '101', label: 'Total sales', value: reportData?.worksheet?.box_101 },
    { box: '103', label: 'HST collected', value: reportData?.worksheet?.box_103 },
    { box: '106', label: 'HST on purchases (ITC)', value: Math.abs(Number(reportData?.worksheet?.box_106 ?? 0) || 0) },
    { box: '109', label: 'Net remittance', value: reportData?.worksheet?.box_109 }
  ];

  const getColumnDefs = (rows, columns) => (
    Array.isArray(columns) && columns.length > 0
      ? columns
      : (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object'
        ? Object.keys(rows[0]).map((key) => ({ fieldname: key, label: key }))
        : [])
  );

  const getRowFieldValue = (row, colDefs, aliases) => {
    if (Array.isArray(row)) {
      const index = colDefs.findIndex((col) => aliases.includes(String(col?.fieldname || '').toLowerCase()));
      return index >= 0 ? row[index] : undefined;
    }
    if (row && typeof row === 'object') {
      for (const alias of aliases) {
        if (row[alias] != null) return row[alias];
      }
    }
    return undefined;
  };

  const getRowLabel = (row, columns) => {
    const colDefs = getColumnDefs([row], columns);
    return String(getRowFieldValue(row, colDefs, ['account', 'name']) ?? '').trim();
  };

  const getRowNumericValue = (row, columns) => {
    const colDefs = getColumnDefs([row], columns);
    const values = (Array.isArray(row) ? row : colDefs.map((col) => row?.[col.fieldname])).filter((value) => Number.isFinite(Number(value)));
    if (values.length === 0) return null;
    return Number(values[values.length - 1]);
  };

  const findSummaryAmount = (rows, columns, patterns) => {
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      const label = getRowLabel(row, columns).toLowerCase();
      if (patterns.some((pattern) => pattern.test(label))) {
        const amount = getRowNumericValue(row, columns);
        if (amount != null) return amount;
      }
    }
    return null;
  };

  const craHstSummary = reportData?.hst_summary || hstSummary;
  const craNetIncome = findSummaryAmount(reportData?.pl?.result, reportData?.pl?.columns, [/profit for the year/, /net (profit|loss)/, /net income/]);
  const craTotalAssets = findSummaryAmount(reportData?.balance_sheet?.result, reportData?.balance_sheet?.columns, [/total assets/]);
  const craTotalLiabilities = findSummaryAmount(reportData?.balance_sheet?.result, reportData?.balance_sheet?.columns, [/total liabilities/]);
  const craTotalEquity = findSummaryAmount(reportData?.balance_sheet?.result, reportData?.balance_sheet?.columns, [/total equity/, /equity$/]);

  const styles = {
    workspaceActionButton: {
      padding: '6px 10px',
      borderRadius: 6,
      border: '1px solid #d1d5db',
      background: '#fff',
      cursor: 'pointer',
      fontSize: 13
    },
    workspaceLink: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '6px 10px',
      borderRadius: 6,
      border: '1px solid #bae6fd',
      background: '#ecfeff',
      color: '#0c4a6e',
      textDecoration: 'none',
      fontSize: 13
    },
    workspaceModalBackdrop: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 24
    },
    workspaceModalCard: {
      background: '#fff',
      borderRadius: 12,
      width: 'min(760px, 100%)',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
      padding: 24
    },
    workspaceFormGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 16
    },
    workspaceField: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    },
    workspaceLabel: {
      fontSize: 13,
      fontWeight: 600,
      color: TavariStyles?.colors?.gray700 || '#374151'
    },
    workspaceInput: {
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid #d1d5db',
      fontSize: 14
    },
    workspacePrimaryButton: {
      padding: '8px 14px',
      borderRadius: 8,
      border: 'none',
      background: TavariStyles?.colors?.primary || '#0ea5e9',
      color: '#fff',
      cursor: 'pointer',
      fontSize: 14
    },
    workspaceSecondaryButton: {
      padding: '8px 14px',
      borderRadius: 8,
      border: '1px solid #d1d5db',
      background: '#fff',
      color: TavariStyles?.colors?.gray700 || '#374151',
      cursor: 'pointer',
      fontSize: 14
    }
  };

  const renderTableFromResult = (result, columns, rightAlignFields = []) => {
    if (!result || !Array.isArray(result)) return <p style={{ color: TavariStyles?.colors?.gray600 }}>No data.</p>;
    const rows = result.filter((row) => {
      if (Array.isArray(row)) return row.some((value) => value != null && String(value).trim() !== '');
      if (row && typeof row === 'object') return Object.values(row).some((value) => value != null && String(value).trim() !== '');
      return row != null && String(row).trim() !== '';
    });
    if (rows.length === 0) return <p style={{ color: TavariStyles?.colors?.gray600 }}>No data for this period.</p>;
    const colDefs = Array.isArray(columns) && columns.length > 0
      ? columns
      : (rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).map((k) => ({ fieldname: k, label: k })) : []);
    const getLabel = (c) => (c?.label ?? c?.fieldname ?? '');
    const getCell = (row, colIndex) => {
      if (Array.isArray(row)) return row[colIndex];
      const field = colDefs[colIndex]?.fieldname;
      return field != null ? row[field] : null;
    };
    const formatCell = (val, fieldname) => {
      if (rightAlignFields.includes(fieldname) && (typeof val === 'number' || (val != null && !Number.isNaN(Number(val))))) {
        return Number(val).toFixed(2);
      }
      return val;
    };
    const accountColIndex = colDefs.findIndex((c) => {
      const field = String(c?.fieldname || '').toLowerCase();
      const label = String(getLabel(c) || '').toLowerCase();
      return field === 'account' || field === 'account_name' || label === 'account';
    });
    const isHierarchicalAccounts = accountColIndex >= 0 && rows.some((row) => !Array.isArray(row) && row && typeof row === 'object' && Number.isFinite(Number(row.indent)));
    const getIndent = (row) => (isHierarchicalAccounts && row && typeof row === 'object' && Number.isFinite(Number(row.indent)) ? Number(row.indent) : 0);
    const isGroupRow = (row) => !!(row && typeof row === 'object' && Number(row.is_group) === 1);
    const isTotalLikeRow = (row) => {
      if (!row || typeof row !== 'object') return false;
      const label = accountColIndex >= 0 ? getCell(row, accountColIndex) : '';
      return isSummaryRow(label);
    };
    return (
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              {colDefs.map((c) => {
                const rightAlign = rightAlignFields.includes(c?.fieldname);
                return (
                  <th key={c?.fieldname || c} style={{ textAlign: rightAlign ? 'right' : 'left', padding: '8px 12px', fontWeight: 600 }}>
                    {getLabel(c)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const groupRow = isGroupRow(row);
              const totalRow = isTotalLikeRow(row);
              const indent = getIndent(row);
              return (
                <tr
                  key={i}
                  style={{
                    borderBottom: '1px solid #eee',
                    background: totalRow ? '#f8fafc' : groupRow ? '#fcfcfd' : undefined
                  }}
                >
                  {colDefs.map((c, colIdx) => {
                    const raw = getCell(row, colIdx);
                    const display = formatCell(raw, c?.fieldname);
                    const rightAlign = rightAlignFields.includes(c?.fieldname);
                    const isAccountCell = isHierarchicalAccounts && colIdx === accountColIndex;
                    return (
                      <td
                        key={colIdx}
                        style={{
                          padding: '8px 12px',
                          textAlign: rightAlign ? 'right' : 'left',
                          paddingLeft: isAccountCell ? 12 + (indent * 18) : 12,
                          fontWeight: totalRow ? 700 : groupRow ? 600 : 400,
                          color: totalRow ? (TavariStyles?.colors?.gray900 || '#111827') : undefined
                        }}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderReportTable = () => {
    if (!reportData) return null;
    const result = reportData.result;
    const columns = reportData.columns;
    if (!result || !Array.isArray(result)) return null;
    const rows = result;
    if (rows.length === 0) return <p style={{ color: TavariStyles?.colors?.gray600 }}>No data for this period.</p>;
    const baseColDefs = Array.isArray(columns) && columns.length > 0
      ? columns
      : (rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).map((k) => ({ fieldname: k, label: k })) : []);
    const colDefs = baseColDefs.filter((c) => !c?.hidden);
    const getLabel = (c) => (c?.label ?? c?.fieldname ?? '');
    const getCell = (row, colIndex) => {
      if (Array.isArray(row)) return row[colIndex];
      const field = colDefs[colIndex]?.fieldname;
      return field != null ? row[field] : null;
    };
    const accountColIdx = colDefs.findIndex((c) => {
      const name = (getLabel(c) || '').toLowerCase();
      const fn = (c?.fieldname || '').toLowerCase();
      return name.includes('account') || fn === 'account' || fn === 'name';
    });
    const accountColIndex = accountColIdx >= 0 ? accountColIdx : 0;
    const hierarchicalRows = rows.some((row) => !Array.isArray(row) && row && typeof row === 'object' && Number.isFinite(Number(row.indent)));
    const getIndent = (row) => (!Array.isArray(row) && row && typeof row === 'object' && Number.isFinite(Number(row.indent)) ? Number(row.indent) : -1);
    const isGroupRow = (row) => !Array.isArray(row) && row && typeof row === 'object' && Number(row.is_group) === 1;
    const getRowKey = (row, index) => {
      if (Array.isArray(row)) return `row-${index}`;
      return String(row?.account || row?.account_name || row?.name || `row-${index}`);
    };
    const numericFields = new Set(
      colDefs
        .filter((c) => {
          const fieldtype = String(c?.fieldtype || '').toLowerCase();
          const fieldname = String(c?.fieldname || '').toLowerCase();
          return fieldtype === 'currency' || fieldtype === 'float' || fieldtype === 'percent' || fieldname === 'total' || /^[a-z]{3}_\d{4}$/.test(fieldname);
        })
        .map((c) => c?.fieldname)
        .filter(Boolean)
    );
    const visibleRows = hierarchicalRows
      ? (() => {
          const hiddenAncestorIndents = [];
          return rows.filter((row, index) => {
            const indent = getIndent(row);
            while (hiddenAncestorIndents.length && indent <= hiddenAncestorIndents[hiddenAncestorIndents.length - 1]) hiddenAncestorIndents.pop();
            const hidden = hiddenAncestorIndents.length > 0;
            if (!hidden && isGroupRow(row) && collapsedFinancialRows[getRowKey(row, index)]) {
              hiddenAncestorIndents.push(indent);
            }
            return !hidden;
          });
        })()
      : rows;
    const groupRowKeys = hierarchicalRows
      ? rows.map((row, index) => (isGroupRow(row) ? getRowKey(row, index) : null)).filter(Boolean)
      : [];
    return (
      <div style={{ overflowX: 'auto', marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', margin: 0 }}>
            {hierarchicalRows
              ? 'Click a group row to collapse or expand it. Click a detail account to see the transactions behind it.'
              : 'Click an account row to see all transactions for that account in this period.'}
          </p>
          {hierarchicalRows && groupRowKeys.length > 0 && (
            <div style={{ display: 'inline-flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setCollapsedFinancialRows(Object.fromEntries(groupRowKeys.map((key) => [key, true])))}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                Collapse all
              </button>
              <button
                type="button"
                onClick={() => setCollapsedFinancialRows({})}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                Expand all
              </button>
            </div>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              {colDefs.map((c) => (
                <th
                  key={c?.fieldname || c}
                  style={{
                    textAlign: numericFields.has(c?.fieldname) ? 'right' : 'left',
                    padding: '8px 12px',
                    fontWeight: 600
                  }}
                >
                  {getLabel(c)}
                </th>
              ))}
              <th style={{ width: 32, padding: '8px 4px' }} />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => {
              const accountLabel = getCell(row, accountColIndex);
              const rowKey = getRowKey(row, i);
              const groupRow = hierarchicalRows && isGroupRow(row);
              const collapsed = !!collapsedFinancialRows[rowKey];
              const indent = hierarchicalRows ? Math.max(getIndent(row), 0) : 0;
              const drillable = !isSummaryRow(accountLabel) && accountLabel != null && String(accountLabel).trim() !== '';
              return (
                <tr
                  key={rowKey}
                  style={{
                    borderBottom: '1px solid #eee',
                    cursor: groupRow ? 'pointer' : drillable ? 'pointer' : undefined,
                    background: isSummaryRow(accountLabel) ? '#f8fafc' : groupRow ? '#fcfcfd' : undefined
                  }}
                  onClick={() => {
                    if (groupRow) {
                      setCollapsedFinancialRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
                      return;
                    }
                    if (drillable) fetchDrillDown(String(accountLabel).trim());
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    if (groupRow) {
                      e.preventDefault();
                      setCollapsedFinancialRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }));
                      return;
                    }
                    if (drillable) {
                      e.preventDefault();
                      fetchDrillDown(String(accountLabel).trim());
                    }
                  }}
                  role={groupRow || drillable ? 'button' : undefined}
                  tabIndex={groupRow || drillable ? 0 : undefined}
                >
                  {colDefs.map((c, colIdx) => {
                    const value = getCell(row, colIdx);
                    const isAccountCell = colIdx === accountColIndex;
                    const isNumeric = numericFields.has(c?.fieldname);
                    const displayValue = isNumeric && value != null && value !== '' && !Number.isNaN(Number(value))
                      ? formatMoney(value)
                      : value;
                    return (
                      <td
                        key={colIdx}
                        style={{
                          padding: '8px 12px',
                          textAlign: isNumeric ? 'right' : 'left',
                          fontWeight: isSummaryRow(accountLabel) ? 700 : groupRow ? 600 : 400
                        }}
                      >
                        {isAccountCell ? (
                          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: indent * 18 }}>
                            {groupRow ? (
                              <span style={{ display: 'inline-flex', width: 18, marginRight: 6, color: TavariStyles?.colors?.gray700 || '#374151' }}>
                                {collapsed ? <FiChevronRight size={14} /> : <FiChevronDown size={14} />}
                              </span>
                            ) : (
                              <span style={{ display: 'inline-block', width: 24 }} />
                            )}
                            <span>{displayValue}</span>
                          </div>
                        ) : displayValue}
                      </td>
                    );
                  })}
                  <td style={{ padding: '8px 4px' }}>
                    {!groupRow && drillable ? <span style={{ color: TavariStyles?.colors?.primary || '#0ea5e9' }} title="View transactions">→</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 24, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', margin: 0 }}>{title}</h1>
        {erpnextConnected && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
              />
            </label>
          </>
        )}
        {erpnextConnected && (
          <button
            type="button"
            onClick={fetchReport}
            disabled={reportLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 14,
              cursor: reportLoading ? 'wait' : 'pointer',
              background: TavariStyles?.colors?.primary || '#0ea5e9',
              color: '#fff',
              border: 'none',
              borderRadius: 8
            }}
          >
            <FiRefreshCw style={{ opacity: reportLoading ? 0.7 : 1 }} /> {reportLoading ? 'Loading...' : 'Refresh'}
          </button>
        )}
        {erpnextConnected && reportData && isHst && (
          <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setHstViewMode('summary')}
              style={{
                padding: '6px 12px',
                fontSize: 14,
                cursor: 'pointer',
                border: 'none',
                background: hstViewMode === 'summary' ? (TavariStyles?.colors?.primary || '#0ea5e9') : '#fff',
                color: hstViewMode === 'summary' ? '#fff' : (TavariStyles?.colors?.gray700 || '#374151')
              }}
            >
              Summary
            </button>
            <button
              type="button"
              onClick={() => setHstViewMode('detail')}
              style={{
                padding: '6px 12px',
                fontSize: 14,
                cursor: 'pointer',
                border: 'none',
                borderLeft: '1px solid #d1d5db',
                background: hstViewMode === 'detail' ? (TavariStyles?.colors?.primary || '#0ea5e9') : '#fff',
                color: hstViewMode === 'detail' ? '#fff' : (TavariStyles?.colors?.gray700 || '#374151')
              }}
            >
              Detail
            </button>
          </div>
        )}
        {erpnextConnected && reportData && isCra && (
          <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setCraViewMode('summary')}
              style={{
                padding: '6px 12px',
                fontSize: 14,
                cursor: 'pointer',
                border: 'none',
                background: craViewMode === 'summary' ? (TavariStyles?.colors?.primary || '#0ea5e9') : '#fff',
                color: craViewMode === 'summary' ? '#fff' : (TavariStyles?.colors?.gray700 || '#374151')
              }}
            >
              Summary
            </button>
            <button
              type="button"
              onClick={() => setCraViewMode('detail')}
              style={{
                padding: '6px 12px',
                fontSize: 14,
                cursor: 'pointer',
                border: 'none',
                borderLeft: '1px solid #d1d5db',
                background: craViewMode === 'detail' ? (TavariStyles?.colors?.primary || '#0ea5e9') : '#fff',
                color: craViewMode === 'detail' ? '#fff' : (TavariStyles?.colors?.gray700 || '#374151')
              }}
            >
              Detail
            </button>
          </div>
        )}
        {erpnextConnected && reportData && (
          <>
            <button
              type="button"
              onClick={exportCsv}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 14,
                cursor: 'pointer',
                background: TavariStyles?.colors?.gray700 || '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: 8
              }}
            >
              <FiDownload /> Export CSV
            </button>
            <button
              type="button"
              onClick={exportJson}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 14,
                cursor: 'pointer',
                background: '#fff',
                color: TavariStyles?.colors?.gray700 || '#374151',
                border: '1px solid #d1d5db',
                borderRadius: 8
              }}
            >
              <FiDownload /> Export JSON
            </button>
            <button
              type="button"
              onClick={exportHandoffPackage}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 14,
                cursor: 'pointer',
                background: '#ecfeff',
                color: '#155e75',
                border: '1px solid #a5f3fc',
                borderRadius: 8
              }}
            >
              <FiDownload /> Export Handoff
            </button>
          </>
        )}
      </div>

      {configLoading && <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading...</p>}

      {!configLoading && configError && (
        <p style={{ color: TavariStyles?.colors?.red || '#dc2626', marginTop: 8 }}>{configError}</p>
      )}

      {!configLoading && !configError && !erpnextConnected && (
        <p style={{ color: TavariStyles?.colors?.gray600 }}>
          Connect ERPNext in Settings (URL and Company name) to see reports here.
        </p>
      )}

      {!configLoading && !configError && erpnextConnected && reportError && (
        <p style={{ color: TavariStyles?.colors?.red || '#dc2626', marginTop: 8 }}>{reportError}</p>
      )}
      {!configLoading && !configError && erpnextConnected && !reportError && isFilingReportView && (filingResult || filingChecksLoading) && (
        <div style={{
          marginBottom: 16,
          padding: 12,
          background: filingReady ? '#ecfdf5' : filingStatus === 'blocked' ? '#fef2f2' : '#fffbeb',
          border: `1px solid ${filingReady ? '#a7f3d0' : filingStatus === 'blocked' ? '#fecaca' : '#fde68a'}`,
          borderRadius: 8,
          fontSize: 13
        }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>
            {filingChecksLoading ? 'Running filing checks…' : filingReady ? 'Filing checks passed' : filingStatus === 'blocked' ? 'Filing blocked' : 'Filing review needed'}
          </strong>
          {!filingChecksLoading && filingResult && (
            <p style={{ margin: '0 0 8px', color: '#374151' }}>
              {(filingResult.checks || []).filter((c) => c.status !== 'pass').length} check(s) need attention before CRA export.
            </p>
          )}
          <button
            type="button"
            onClick={() => navigate('/dashboard/accounting/reports/filing-reconciliation')}
            style={{ border: 'none', background: 'none', color: '#0d9488', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}
          >
            Open Filing Reconciliation →
          </button>
        </div>
      )}

      {!configLoading && !configError && erpnextConnected && !reportError && reportData?.warnings?.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>Validation notes</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {reportData.warnings.map((warning, index) => (
              <li key={`warning-${index}`} style={{ color: '#92400e', fontSize: 13 }}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {!configLoading && !configError && erpnextConnected && !reportError && reportLoading && !reportData && (
        <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading report from ERPNext...</p>
      )}

      {!configLoading && erpnextConnected && !reportError && reportData && isBalanceSheet && reportData.report_type === 'balance_sheet' && (
        <div style={{ maxWidth: 960 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            As at <strong>{reportData.period?.to_date || toDate}</strong>. Use for T2 and year-end.
          </p>
          {renderTableFromResult(reportData.result, reportData.columns)}
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isGst34 && reportData.report_type === 'gst34' && (
        <div style={{ maxWidth: 960 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Period {reportData.period?.from_date} to {reportData.period?.to_date}. Use to fill GST34 (GST/HST return).
          </p>
          <section style={{ marginBottom: 24, padding: 16, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 8 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 12, fontWeight: 600 }}>GST34 boxes (from GL)</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}><td style={{ padding: '8px 12px' }}>101 Total sales</td><td style={{ padding: '8px 12px', textAlign: 'right' }}>{typeof reportData.worksheet?.box_101 === 'number' ? reportData.worksheet.box_101.toFixed(2) : '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}><td style={{ padding: '8px 12px' }}>103 HST collected</td><td style={{ padding: '8px 12px', textAlign: 'right' }}>{typeof reportData.worksheet?.box_103 === 'number' ? reportData.worksheet.box_103.toFixed(2) : '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}><td style={{ padding: '8px 12px' }}>106 HST on purchases (ITC)</td><td style={{ padding: '8px 12px', textAlign: 'right' }}>{typeof reportData.worksheet?.box_106 === 'number' ? reportData.worksheet.box_106.toFixed(2) : '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}><td style={{ padding: '8px 12px', fontWeight: 600 }}>109 Net remittance</td><td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{typeof reportData.worksheet?.box_109 === 'number' ? reportData.worksheet.box_109.toFixed(2) : '—'}</td></tr>
              </tbody>
            </table>
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>General Ledger (detail)</h2>
            {renderTableFromResult(reportData.gl_result, reportData.gl_columns)}
          </section>
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isHst && reportData.report_type === 'hst' && (
        <div style={{ maxWidth: 1200 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Period {reportData.period?.from_date || fromDate} to {reportData.period?.to_date || toDate}. Use Summary for a quick filing view with GST34 boxes, and Detail for the full GL lines behind it.
          </p>
          {hstViewMode === 'summary' ? (
            <>
              <section style={{ marginBottom: 20, padding: 16, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>Sales included in this period</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(hstSummary.sales_total)}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>HST collected from sales</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#92400e' }}>{formatMoney(hstSummary.hst_collected)}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>HST paid on expenses</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#065f46' }}>{formatMoney(hstSummary.hst_paid_on_expenses)}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>
                      Net HST {hstSummary.filing_position === 'owed' ? 'owed' : 'refund'}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: hstSummary.net_hst_owed >= 0 ? '#b45309' : '#047857' }}>
                      {formatMoney(Math.abs(hstSummary.net_hst_owed))}
                    </div>
                  </div>
                </div>
              </section>
              <section style={{ maxWidth: 720, marginBottom: 24 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px' }}>HST collected from sales</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatMoney(hstSummary.hst_collected)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px' }}>Less HST paid on expenses</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>({formatMoney(hstSummary.hst_paid_on_expenses)})</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>Net HST {hstSummary.filing_position === 'owed' ? 'owed' : 'refund'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{formatMoney(Math.abs(hstSummary.net_hst_owed))}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
              <section style={{ maxWidth: 720, marginBottom: 24 }}>
                <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>GST34 filing boxes</h2>
                <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 8 }}>
                  Use these values to fill the GST34 return. They come from the same HST activity shown above.
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <tbody>
                    {hstWorksheetRows.map((row, index) => (
                      <tr key={row.box} style={{ borderBottom: index < hstWorksheetRows.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                        <td style={{ padding: '10px 12px', width: 72, fontWeight: row.box === '109' ? 700 : 600 }}>{row.box}</td>
                        <td style={{ padding: '10px 12px' }}>{row.label}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: row.box === '109' ? 700 : 400 }}>{formatMoney(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          ) : (
            <section>
              <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 8 }}>
                Detail shows the underlying General Ledger rows behind both the HST summary and the GST34 filing boxes. Click an account row to drill into the transactions behind that tax balance.
              </p>
              {renderReportTable()}
            </section>
          )}
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isCra && reportData.report_type === 'cra_summary' && (
        <div style={{ maxWidth: 960 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Use this period for CRA filing. Set From/To to your fiscal year or GST reporting period, then use the sections below for T2/T1 income and GST/HST return.
          </p>
          {craViewMode === 'summary' ? (
            <>
              <section style={{ marginBottom: 16, padding: 14, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 13, color: '#1e3a8a' }}>
                The amounts below are a filing summary. They are not separate totals you add together. The same underlying accounting period is being shown from different filing angles: income tax, GST/HST, and balance sheet.
              </section>
              <section style={{ marginBottom: 24, padding: 16, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>Net income / loss</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{craNetIncome != null ? formatMoney(craNetIncome) : '—'}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>HST collected from sales</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#92400e' }}>{formatMoney(craHstSummary.hst_collected)}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>HST paid on expenses</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#065f46' }}>{formatMoney(craHstSummary.hst_paid_on_expenses)}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>
                      Net HST {craHstSummary.filing_position === 'owed' ? 'owed' : 'refund'}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: craHstSummary.net_hst_owed >= 0 ? '#b45309' : '#047857' }}>
                      {formatMoney(Math.abs(craHstSummary.net_hst_owed))}
                    </div>
                  </div>
                </div>
              </section>
              <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Balance Sheet Snapshot</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>Total assets</div>
                    <div style={{ fontSize: 23, fontWeight: 700 }}>{craTotalAssets != null ? formatMoney(craTotalAssets) : '—'}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>Total liabilities</div>
                    <div style={{ fontSize: 23, fontWeight: 700 }}>{craTotalLiabilities != null ? formatMoney(craTotalLiabilities) : '—'}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 6 }}>Total equity</div>
                    <div style={{ fontSize: 23, fontWeight: 700 }}>{craTotalEquity != null ? formatMoney(craTotalEquity) : '—'}</div>
                  </div>
                </div>
              </section>
              <section style={{ maxWidth: 720, marginBottom: 24 }}>
                <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>GST/HST Filing Summary</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px' }}>HST collected from sales</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatMoney(craHstSummary.hst_collected)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px' }}>Less HST paid on expenses</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>({formatMoney(craHstSummary.hst_paid_on_expenses)})</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>Net HST {craHstSummary.filing_position === 'owed' ? 'owed' : 'refund'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{formatMoney(Math.abs(craHstSummary.net_hst_owed))}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </>
          ) : (
            <>
              <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Income (T2 / T1)</h2>
                <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 8 }}>
                  Profit &amp; Loss detail used for corporate (T2) or sole-proprietor (T1) income tax.
                </p>
                {renderTableFromResult(reportData.pl?.result, reportData.pl?.columns)}
              </section>
              <section style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>GST/HST (GST34)</h2>
                <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 8 }}>
                  Summary first, with raw HST ledger detail available only if you need to inspect the entries behind the filing amount.
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12 }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px' }}>HST collected from sales</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatMoney(craHstSummary.hst_collected)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px' }}>Less HST paid on expenses</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>({formatMoney(craHstSummary.hst_paid_on_expenses)})</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '10px 12px', fontWeight: 700 }}>Net HST {craHstSummary.filing_position === 'owed' ? 'owed' : 'refund'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{formatMoney(Math.abs(craHstSummary.net_hst_owed))}</td>
                    </tr>
                  </tbody>
                </table>
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 13, color: TavariStyles?.colors?.gray700 ?? '#374151' }}>Show raw HST ledger detail</summary>
                  <div style={{ marginTop: 12 }}>
                    {renderTableFromResult(reportData.hst?.result, reportData.hst?.columns)}
                  </div>
                </details>
              </section>
              {reportData.balance_sheet && (reportData.balance_sheet.result || reportData.balance_sheet.columns) && (
                <section style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Balance Sheet (as at {reportData.period?.to_date || toDate})</h2>
                  <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 8 }}>
                    Use for T2 and year-end filing.
                  </p>
                  {renderTableFromResult(reportData.balance_sheet.result, reportData.balance_sheet.columns)}
                </section>
              )}
            </>
          )}
          <section style={{ padding: 12, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 8, fontSize: 13 }}>
            <strong>Depreciation &amp; assets</strong>
            <p style={{ margin: '6px 0 0', color: TavariStyles?.colors?.gray600 ?? '#6b7280' }}>
              Capital assets and CCA (Capital Cost Allowance) are not in this report. Track them in ERPNext (Fixed Assets) or with your accountant; use for T2 Schedule 8 and similar.
            </p>
            <p style={{ margin: '8px 0 0', color: TavariStyles?.colors?.gray600 ?? '#6b7280' }}>
              <strong>COGS:</strong> If you track inventory, post Cost of Goods Sold in ERPNext or use Accounting → Journal Entry for manual COGS entries.
            </p>
          </section>
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && !isCra && !isHst && !isBalanceSheet && !isGst34 && !isGeneralLedger && !isTrialBalance && !isApAging && !isArAging && !isApWorkspace && !isArWorkspace && renderReportTable()}
      {!configLoading && erpnextConnected && !reportError && reportData && isGeneralLedger && (
        <div
          ref={glViewportRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: glPanelHeight ?? undefined,
            minHeight: 280,
          }}
        >
          <p style={{ flexShrink: 0, fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 12 }}>
            Transaction-level ERPNext general ledger for <strong>{reportData.period?.from_date || fromDate}</strong> to <strong>{reportData.period?.to_date || toDate}</strong>.
            Scroll inside the table; the horizontal scrollbar stays at the bottom of your screen.
          </p>
          {renderGeneralLedgerTable(reportData.result, reportData.columns, { viewportFill: true })}
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isTrialBalance && (
        <div style={{ maxWidth: 1200 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Trial balance from ERPNext for the selected period.
          </p>
          {renderTableFromResult(reportData.result, reportData.columns)}
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isApAging && (
        <div style={{ maxWidth: 1200 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Outstanding supplier balances as of <strong>{reportData.period?.to_date || toDate}</strong>.
          </p>
          {renderTableFromResult(reportData.result, reportData.columns)}
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isArAging && (
        <div style={{ maxWidth: 1200 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Outstanding customer balances as of <strong>{reportData.period?.to_date || toDate}</strong>.
          </p>
          {renderTableFromResult(reportData.result, reportData.columns)}
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isApWorkspace && (
        <div style={{ maxWidth: 1200 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Vendor-bill and payment workspace on top of ERPNext. Use Tavari for the common AP actions, then open the ERPNext document for anything more complex.
          </p>
          <section style={{ marginBottom: 24, padding: 16, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Supplier filter</span>
                <input
                  type="text"
                  value={workspaceFilters.party}
                  onChange={(e) => setWorkspaceFilters((prev) => ({ ...prev, party: e.target.value }))}
                  placeholder="Supplier name"
                  style={styles.workspaceInput}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={workspaceFilters.outstandingOnly}
                  onChange={(e) => setWorkspaceFilters((prev) => ({ ...prev, outstandingOnly: e.target.checked }))}
                />
                <span style={{ fontSize: 13 }}>Only outstanding invoices</span>
              </label>
              <button type="button" onClick={() => openWorkspaceModal('create_purchase_invoice')} style={styles.workspacePrimaryButton}>Create vendor bill</button>
              <button type="button" onClick={() => openWorkspaceModal('record_ap_payment')} style={styles.workspaceSecondaryButton}>Record AP payment</button>
              <button type="button" onClick={() => setWorkspaceFilters((prev) => ({ ...prev, limit: prev.limit + 25 }))} style={styles.workspaceSecondaryButton}>Load more</button>
            </div>
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>AP Aging</h2>
            {renderTableFromResult(reportData.aging?.result, reportData.aging?.columns)}
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Recent Purchase Invoices</h2>
            {renderWorkspaceTable(reportData.purchase_invoices, reportData.purchase_invoice_columns || [], 'ap_invoice')}
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Recent Payment Entries</h2>
            {renderWorkspaceTable(reportData.payments, reportData.payment_columns || [], 'payment')}
          </section>
        </div>
      )}
      {!configLoading && erpnextConnected && !reportError && reportData && isArWorkspace && (
        <div style={{ maxWidth: 1200 }}>
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 16 }}>
            Customer-invoice and payment workspace on top of ERPNext. Use Tavari for the common AR actions, then open the ERPNext document for anything more complex.
          </p>
          <section style={{ marginBottom: 24, padding: 16, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Customer filter</span>
                <input
                  type="text"
                  value={workspaceFilters.party}
                  onChange={(e) => setWorkspaceFilters((prev) => ({ ...prev, party: e.target.value }))}
                  placeholder="Customer name"
                  style={styles.workspaceInput}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={workspaceFilters.outstandingOnly}
                  onChange={(e) => setWorkspaceFilters((prev) => ({ ...prev, outstandingOnly: e.target.checked }))}
                />
                <span style={{ fontSize: 13 }}>Only outstanding invoices</span>
              </label>
              <button type="button" onClick={() => openWorkspaceModal('create_sales_invoice')} style={styles.workspacePrimaryButton}>Create customer invoice</button>
              <button type="button" onClick={() => openWorkspaceModal('record_ar_payment')} style={styles.workspaceSecondaryButton}>Record AR payment</button>
              <button type="button" onClick={() => setWorkspaceFilters((prev) => ({ ...prev, limit: prev.limit + 25 }))} style={styles.workspaceSecondaryButton}>Load more</button>
            </div>
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Open Tavari Invoices</h2>
            {tavariInvoicesLoading ? (
              <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading Tavari invoices…</p>
            ) : tavariOpenInvoices.length === 0 ? (
              <p style={{ color: TavariStyles?.colors?.gray600 }}>No open Tavari invoices with a balance due.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Invoice #</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Customer</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Due</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px' }}>Balance</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>ERPNext</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tavariOpenInvoices.map((inv) => {
                      const customer = inv.recipient_company || inv.recipient_name || '—';
                      return (
                        <tr key={inv.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px 12px' }}>{inv.invoice_number}</td>
                          <td style={{ padding: '8px 12px' }}>{customer}</td>
                          <td style={{ padding: '8px 12px' }}>{inv.due_date || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>${Number(inv.balance_due || 0).toFixed(2)}</td>
                          <td style={{ padding: '8px 12px' }}>{inv.erpnext_sales_invoice_name || '—'}</td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {!inv.erpnext_sales_invoice_name && (
                                <button
                                  type="button"
                                  disabled={postingTavariInvoiceId === inv.id}
                                  onClick={() => postTavariInvoiceToErp(inv)}
                                  style={styles.workspaceActionButton}
                                >
                                  {postingTavariInvoiceId === inv.id ? 'Posting…' : 'Post to ERPNext'}
                                </button>
                              )}
                              {inv.erpnext_sales_invoice_name && (
                                <button
                                  type="button"
                                  onClick={() => openWorkspaceModal('record_ar_payment', {
                                    customer_name: customer,
                                    sales_invoice_name: inv.erpnext_sales_invoice_name,
                                    amount: inv.balance_due
                                  })}
                                  style={styles.workspaceActionButton}
                                >
                                  Receive payment
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>AR Aging</h2>
            {renderTableFromResult(reportData.aging?.result, reportData.aging?.columns)}
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Recent Sales Invoices</h2>
            {renderWorkspaceTable(reportData.sales_invoices, reportData.sales_invoice_columns || [], 'ar_invoice')}
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8, fontWeight: 600 }}>Recent Payment Entries</h2>
            {renderWorkspaceTable(reportData.payments, reportData.payment_columns || [], 'payment')}
          </section>
        </div>
      )}

      {drillAccount != null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 24
          }}
          onClick={() => { setDrillAccount(null); setDrillData(null); setDrillError(null); }}
          role="dialog"
          aria-label="Account transactions"
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              maxWidth: '90vw',
              maxHeight: '85vh',
              overflow: 'auto',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              padding: 24
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: '1.125rem', margin: 0 }}>
                Transactions: {drillAccount}
              </h2>
              <button
                type="button"
                onClick={() => { setDrillAccount(null); setDrillData(null); setDrillError(null); }}
                style={{ padding: '6px 12px', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}
              >
                Close
              </button>
            </div>
            <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 ?? '#6b7280', marginBottom: 12 }}>
              Period: <strong>{fromDate}</strong> to <strong>{toDate}</strong>. Individual GL entries (journal lines, invoices, etc.) that add up to the account total.
            </p>
            {drillLoading && <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading transactions...</p>}
            {!drillLoading && drillError && <p style={{ color: TavariStyles?.colors?.red || '#dc2626' }}>{drillError}</p>}
            {!drillLoading && !drillError && drillData && Array.isArray(drillData.result) && drillData.result.length > 0 && renderTableFromResult(drillData.result, drillData.columns, ['debit_in_account_currency', 'credit_in_account_currency'])}
            {!drillLoading && !drillError && drillData && (!Array.isArray(drillData.result) || drillData.result.length === 0) && (
              <p style={{ color: TavariStyles?.colors?.gray600 }}>No transactions for this account in this period.</p>
            )}
          </div>
        </div>
      )}
      {renderWorkspaceModal()}
    </div>
  );
};

export default AccountingReports;

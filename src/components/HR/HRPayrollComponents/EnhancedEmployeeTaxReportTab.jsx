// components/HR/HRPayrollComponents/EnhancedEmployeeTaxReportTab.jsx
import React, { useState } from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { useYTDCalculations } from '../../../hooks/useYTDCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';

import EETRT_EmployeeSelector from './EETRT-EmployeeSelector';
import EETRT_FrequencyDetection from './EETRT-FrequencyDetection';
import EETRT_ReportConfiguration from './EETRT-ReportConfiguration';
import EETRT_DataPreview from './EETRT-DataPreview';
import { useEETRTData } from './EETRT-DataHook';

const formatTaxAmount = (n) => (n != null && !Number.isNaN(n) ? Number(n).toFixed(2) : '0.00');

const EnhancedEmployeeTaxReportTab = ({ selectedBusinessId, businessData }) => {
  const {
    employees,
    selectedEmployee,
    reportConfig,
    calculatedData,
    loading,
    generating,
    handleEmployeeChange,
    setReportConfig,
    generateComprehensiveReport,
    generateDeductionsReport
  } = useEETRTData(selectedBusinessId, businessData);
  const ytd = useYTDCalculations(selectedBusinessId || undefined);
  const [batchYear, setBatchYear] = useState(() => new Date().getFullYear());
  const [batchExporting, setBatchExporting] = useState(false);

  const security = useSecurityContext({
    componentName: 'EnhancedEmployeeTaxReportTab',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  const auth = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'EnhancedEmployeeTaxReportTab'
  });

  const effectiveBusinessId = selectedBusinessId || auth.selectedBusinessId;
  const effectiveBusinessData = businessData || auth.businessData;

  const handleBatchT4Export = async () => {
    if (!employees?.length || !ytd?.calculateEmployeeYTD) {
      toast.error('Load employees first');
      return;
    }
    setBatchExporting(true);
    try {
      // T4 box 24/26 caps for the reporting tax year (CRA YMPE/MIE).
      // Update annually as new T4127 editions are published.
      const T4_BOX_LIMITS_FOR_YEAR = {
        2024: { mie: 63200, ympe: 68500 },
        2025: { mie: 65700, ympe: 71300 },
        2026: { mie: 68900, ympe: 74600 }
      };
      const yearLimits = T4_BOX_LIMITS_FOR_YEAR[batchYear] || T4_BOX_LIMITS_FOR_YEAR[2026];

      const endDate = `${batchYear}-12-31`;
      const rows = [];
      for (const emp of employees) {
        const userId = emp?.users?.id;
        if (!userId) continue;
        const ytdResult = await ytd.calculateEmployeeYTD(userId, endDate, effectiveBusinessId, effectiveBusinessData?.timezone || 'America/Toronto');
        if (!ytdResult || (ytdResult.gross_pay == null && ytdResult.federal_tax == null)) continue;
        const gross = parseFloat(ytdResult.gross_pay) || 0;
        const vacation = parseFloat(ytdResult.vacation_pay) || 0;
        const federal = parseFloat(ytdResult.federal_tax) || 0;
        const provincial = parseFloat(ytdResult.provincial_tax) || 0;
        const cpp = parseFloat(ytdResult.cpp_deduction) || 0;
        const ei = parseFloat(ytdResult.ei_deduction) || 0;
        const netPay = parseFloat(ytdResult.net_pay) ?? (gross + vacation - federal - provincial - cpp - ei);
        const name = [emp.users?.first_name, emp.users?.last_name].filter(Boolean).join(' ') || 'Unknown';
        rows.push({
          name,
          netPay,
          box14: gross + vacation,
          box16: cpp,
          box18: ei,
          box22: federal + provincial,
          box24: Math.min(gross + vacation, yearLimits.mie),
          box26: Math.min(gross + vacation, yearLimits.ympe)
        });
      }
      if (rows.length === 0) {
        toast.error('No T4 data found for any employee for ' + batchYear);
        setBatchExporting(false);
        return;
      }
      const html = `
        <!DOCTYPE html><html><head><meta charset="UTF-8"/><title>T4 Summary ${batchYear}</title>
        <style>body{font-family:Segoe UI,sans-serif;padding:20px;} table{border-collapse:collapse;width:100%;margin-top:16px;}
        th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee;} th{background:#f3f4f6;}
        .amount{text-align:right;} h1{font-size:1.25rem;} .muted{color:#374151;font-size: 10px;}
        </style></head><body>
        <h1>${effectiveBusinessData?.name || 'Business'} – T4 Summary (${batchYear})</h1>
        <p class="muted">Generated ${new Date().toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} ${new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} (${effectiveBusinessData?.timezone || 'America/Toronto'}). Use for records or CRA filing.</p>
        <table>
        <thead><tr><th>Employee</th><th class="amount">Actual Pay (Net)</th><th class="amount">Box 14 Employment</th><th class="amount">Box 16 CPP</th><th class="amount">Box 18 EI</th><th class="amount">Box 22 Tax</th><th class="amount">Box 24 EI Earn.</th><th class="amount">Box 26 CPP Earn.</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r.name}</td><td class="amount">${formatTaxAmount(r.netPay)}</td><td class="amount">${formatTaxAmount(r.box14)}</td><td class="amount">${formatTaxAmount(r.box16)}</td><td class="amount">${formatTaxAmount(r.box18)}</td><td class="amount">${formatTaxAmount(r.box22)}</td><td class="amount">${formatTaxAmount(r.box24)}</td><td class="amount">${formatTaxAmount(r.box26)}</td></tr>`).join('')}</tbody>
        </table>
        <p class="muted" style="margin-top:20px;">Tavari Payroll – Batch T4 export. File T4 slips via CRA’s portal.</p>
        </body></html>`;
      const w = window.open('', '_blank');
      if (!w) {
        toast.error('Allow pop-ups to open batch T4');
        setBatchExporting(false);
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => { w.print(); setTimeout(() => w.close(), 500); }, 300);
      toast.success(`Opened T4 summary for ${rows.length} employee(s). Use Print or Save as PDF.`);
    } catch (e) {
      toast.error(e?.message || 'Batch export failed');
    }
    setBatchExporting(false);
  };

  const styles = {
    container: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      minHeight: '100vh'
    }
  };

  if (loading) {
    return (
      <POSAuthWrapper componentName="EnhancedEmployeeTaxReportTab" requiredRoles={['owner', 'manager', 'hr_admin']} requireBusiness={true}>
        <SecurityWrapper componentName="EnhancedEmployeeTaxReportTab" securityLevel="critical" enableAuditLogging={true} sensitiveComponent={true}>
          <div style={styles.container}>
            <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl }}>Loading employees...</div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="EnhancedEmployeeTaxReportTab" requiredRoles={['owner', 'manager', 'hr_admin']} requireBusiness={true}>
      <SecurityWrapper componentName="EnhancedEmployeeTaxReportTab" securityLevel="critical" enableAuditLogging={true} sensitiveComponent={true}>
        <div style={styles.container}>
          <EETRT_EmployeeSelector
            employees={employees}
            selectedEmployee={selectedEmployee}
            onEmployeeChange={handleEmployeeChange}
            effectiveBusinessId={effectiveBusinessId}
          />
          
          <EETRT_FrequencyDetection
            selectedEmployee={selectedEmployee}
            reportConfig={reportConfig}
            setReportConfig={setReportConfig}
          />
          
          <EETRT_ReportConfiguration
            selectedEmployee={selectedEmployee}
            reportConfig={reportConfig}
            setReportConfig={setReportConfig}
          />
          
          <EETRT_DataPreview
            calculatedData={calculatedData}
            generating={generating}
            onGenerateReport={generateComprehensiveReport}
            onGenerateDeductionsReport={generateDeductionsReport}
          />

          <div style={{ marginTop: 32, padding: 20, background: TavariStyles.colors?.gray100 || '#f3f4f6', borderRadius: 12, border: `1px solid ${TavariStyles.colors?.gray200 || '#e5e7eb'}` }}>
            <h3 style={{ fontSize: '1rem', marginTop: 0, marginBottom: 8 }}>Batch T4 export (all employees)</h3>
            <p style={{ fontSize: 10, color: TavariStyles.colors?.gray600 || '#6b7280', marginBottom: 12 }}>
              Generate a single printable summary of T4 box amounts for every employee for a tax year. Use Print or Save as PDF.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Tax year
                <select value={batchYear} onChange={(e) => setBatchYear(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}>
                  {[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleBatchT4Export}
                disabled={batchExporting || !employees?.length}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: batchExporting ? 'wait' : 'pointer',
                  background: TavariStyles.colors?.primary || '#0ea5e9',
                  color: '#fff',
                  fontWeight: 500
                }}
              >
                {batchExporting ? 'Generating...' : `Export all T4 for ${batchYear}`}
              </button>
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default EnhancedEmployeeTaxReportTab;
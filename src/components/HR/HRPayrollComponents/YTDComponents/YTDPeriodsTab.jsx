// components/HR/HRPayrollComponents/YTDComponents/YTDPeriodsTab.jsx
import React from 'react';
import { TavariStyles } from '../../../../utils/TavariStyles';
import { AlertTriangle, Info } from 'lucide-react';
import TavariCheckbox from '../../../UI/TavariCheckbox';
import YTDPeriodAccordion from './YTDPeriodAccordion';
import YTDTotalsCard from './YTDTotalsCard';
import YTDValidationWarning from './YTDValidationWarning';

const YTDPeriodsTab = ({
  selectedEmployee,
  existingPayrollEntries,
  showExistingWarning,
  acknowledgedExisting,
  setAcknowledgedExisting,
  useBusinessDefault,
  setUseBusinessDefault,
  payFrequency,
  setPayFrequency,
  firstPeriodEndDate,
  setFirstPeriodEndDate,
  employeeIsCurrent,
  setEmployeeIsCurrent,
  lastDayWorked,
  setLastDayWorked,
  generatePeriods,
  periodsGenerated,
  periods,
  expandedPeriods,
  togglePeriod,
  expandAll,
  collapseAll,
  updatePeriod,
  totals,
  ytdData,
  validationBypass,
  setValidationBypass,
  savePeriods,
  saving,
  formatTaxAmount,
  styles
}) => {
  return (
    <>
      {/* Info Banner */}
      <div style={styles.section}>
        <div style={{...styles.messageBox, ...styles.infoMessage}}>
          <Info size={20} />
          <div>
            <strong>📋 Quick Guide:</strong>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px', fontSize: '13px' }}>
              <li><strong>For Holiday Pay:</strong> Enter the last 12 weeks (6 bi-weekly periods)</li>
              <li><strong>For ROE Preparation:</strong> Enter all available pay periods from old system</li>
              <li><strong>For Complete Migration:</strong> Enter full year data if available</li>
            </ul>
            <div style={{ marginTop: '8px', fontSize: '13px' }}>
              💡 Empty periods will be automatically skipped when saving.
            </div>
          </div>
        </div>
      </div>

      {/* Pay Frequency Settings */}
      {selectedEmployee && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Pay Frequency Settings</h3>
          
          <TavariCheckbox
            checked={useBusinessDefault}
            onChange={setUseBusinessDefault}
            label="Use business default pay frequency settings"
            size="md"
          />

          <div style={styles.formGroup}>
            <label style={styles.label}>Pay Frequency:</label>
            <select
              style={styles.select}
              value={payFrequency}
              onChange={(e) => setPayFrequency(e.target.value)}
              disabled={useBusinessDefault}
            >
              <option value="weekly">Weekly (53 periods)</option>
              <option value="bi_weekly">Bi-Weekly (27 periods)</option>
              <option value="semi_monthly">Semi-Monthly (24 periods)</option>
              <option value="monthly">Monthly (12 periods)</option>
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Most Recent Pay Period End Date:</label>
            <input
              type="date"
              style={styles.input}
              value={firstPeriodEndDate}
              onChange={(e) => setFirstPeriodEndDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
            />
            <div style={styles.filterInfo}>
              Enter the end date of the most recent pay period. The system will generate all periods working backwards from this date.
            </div>
          </div>

          <TavariCheckbox
            checked={employeeIsCurrent}
            onChange={setEmployeeIsCurrent}
            label="Employee is still current/active"
            size="md"
          />

          {!employeeIsCurrent && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Last Day Worked:</label>
              <input
                type="date"
                style={styles.input}
                value={lastDayWorked}
                onChange={(e) => setLastDayWorked(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
          )}

          <button
            style={styles.button}
            onClick={generatePeriods}
            disabled={!selectedEmployee || !firstPeriodEndDate}
          >
            {periodsGenerated ? 'Regenerate Periods' : 'Generate Periods'}
          </button>
        </div>
      )}

      {/* Periods Entry */}
      {periodsGenerated && periods.length > 0 && (
        <>
          <div style={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.md }}>
              <h3 style={styles.sectionTitle}>Payroll Periods ({periods.length})</h3>
              <div style={{ display: 'flex', gap: TavariStyles.spacing.sm }}>
                <button style={styles.secondaryButton} onClick={expandAll}>
                  Expand All
                </button>
                <button style={styles.secondaryButton} onClick={collapseAll}>
                  Collapse All
                </button>
              </div>
            </div>

            {periods.map((period) => (
              <YTDPeriodAccordion
                key={period.periodNumber}
                period={period}
                isExpanded={expandedPeriods.has(period.periodNumber)}
                onToggle={() => togglePeriod(period.periodNumber)}
                onUpdate={(field, value) => updatePeriod(period.periodNumber, field, value)}
                formatTaxAmount={formatTaxAmount}
                styles={styles}
              />
            ))}
          </div>

          {/* Totals Summary */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Totals Summary</h3>
            <YTDTotalsCard
              totals={totals}
              formatTaxAmount={formatTaxAmount}
              styles={styles}
              showDeductions={false}
            />

            {/* YTD Comparison */}
            <YTDValidationWarning
              ytdData={ytdData}
              periodTotals={totals}
              formatTaxAmount={formatTaxAmount}
              validationBypass={validationBypass}
              setValidationBypass={setValidationBypass}
              styles={styles}
            />
          </div>

          {/* Save Button */}
          <div style={{ textAlign: 'center', marginBottom: TavariStyles.spacing.xl }}>
            <button
              style={{
                ...styles.button,
                opacity: saving ? 0.6 : 1,
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
              onClick={savePeriods}
              disabled={saving}
            >
              {saving ? 'Saving...' : `Save ${periods.length} Payroll Periods`}
            </button>
          </div>
        </>
      )}
    </>
  );
};

export default YTDPeriodsTab;
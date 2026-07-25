// components/HR/HRPayrollComponents/YTDComponents/YTDSummaryTab.jsx
import React from 'react';
import { TavariStyles } from '../../../../utils/TavariStyles';
import YTDTotalsCard from './YTDTotalsCard';

const YTDSummaryTab = ({
  ytdData,
  updateYTDField,
  totals,
  formatTaxAmount,
  saving,
  saveYTDData,
  styles
}) => {
  console.log('DEBUG YTDSummaryTab rendered', {
    saveYTDData_exists: !!saveYTDData,
    saveYTDData_type: typeof saveYTDData,
    saving,
    hasYtdData: !!ytdData
  });

  return (
    <>
      {/* YTD Hours Data */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Year-to-Date Hours</h3>
        
        <div style={styles.grid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Total Hours Worked:</label>
            <input
              type="number"
              step="0.25"
              min="0"
              style={styles.input}
              value={ytdData.hours_worked}
              onChange={(e) => updateYTDField('hours_worked', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Regular Hours:</label>
            <input
              type="number"
              step="0.25"
              min="0"
              style={styles.input}
              value={ytdData.regular_hours}
              onChange={(e) => updateYTDField('regular_hours', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Overtime Hours:</label>
            <input
              type="number"
              step="0.25"
              min="0"
              style={styles.input}
              value={ytdData.overtime_hours}
              onChange={(e) => updateYTDField('overtime_hours', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Lieu Time Hours:</label>
            <input
              type="number"
              step="0.25"
              min="0"
              style={styles.input}
              value={ytdData.lieu_hours}
              onChange={(e) => updateYTDField('lieu_hours', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Stat Holiday Hours:</label>
            <input
              type="number"
              step="0.25"
              min="0"
              style={styles.input}
              value={ytdData.stat_hours}
              onChange={(e) => updateYTDField('stat_hours', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Holiday Hours:</label>
            <input
              type="number"
              step="0.25"
              min="0"
              style={styles.input}
              value={ytdData.holiday_hours}
              onChange={(e) => updateYTDField('holiday_hours', e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      {/* YTD Income Data */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Year-to-Date Income</h3>
        
        <div style={styles.grid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Regular Income:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.regular_income}
              onChange={(e) => updateYTDField('regular_income', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Overtime Income:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.overtime_income}
              onChange={(e) => updateYTDField('overtime_income', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Lieu Time Income:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.lieu_income}
              onChange={(e) => updateYTDField('lieu_income', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Vacation Pay:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.vacation_pay}
              onChange={(e) => updateYTDField('vacation_pay', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Shift Premiums:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.shift_premiums}
              onChange={(e) => updateYTDField('shift_premiums', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Stat Holiday Earnings:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.stat_earnings}
              onChange={(e) => updateYTDField('stat_earnings', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Holiday Earnings:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.holiday_earnings}
              onChange={(e) => updateYTDField('holiday_earnings', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Bonus:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.bonus}
              onChange={(e) => updateYTDField('bonus', e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      {/* YTD Deductions */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Year-to-Date Deductions</h3>
        
        <div style={styles.grid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Federal Tax:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.federal_tax}
              onChange={(e) => updateYTDField('federal_tax', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Provincial Tax:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.provincial_tax}
              onChange={(e) => updateYTDField('provincial_tax', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>CPP Deduction:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.cpp_deduction}
              onChange={(e) => updateYTDField('cpp_deduction', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>EI Deduction:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.ei_deduction}
              onChange={(e) => updateYTDField('ei_deduction', e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Additional Tax:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              style={styles.input}
              value={ytdData.additional_tax}
              onChange={(e) => updateYTDField('additional_tax', e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      {/* Manual Entry Reason */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Manual Entry Information</h3>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>Reason for Manual Entry:</label>
          <input
            type="text"
            style={styles.input}
            value={ytdData.manual_entry_reason}
            onChange={(e) => updateYTDField('manual_entry_reason', e.target.value)}
            placeholder="e.g., Prior year correction, System migration, etc."
          />
        </div>
      </div>

      {/* Totals Summary */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>YTD Summary</h3>
        <YTDTotalsCard
          totals={totals}
          formatTaxAmount={formatTaxAmount}
          styles={styles}
          showDeductions={true}
        />
      </div>

      {/* Save Button */}
      <div style={{ textAlign: 'center', marginBottom: TavariStyles.spacing.xl }}>
        <button
          type="button"
          style={{
            ...styles.button,
            opacity: saving ? 0.6 : 1,
            cursor: saving ? 'not-allowed' : 'pointer'
          }}
          onClick={() => {
            console.log('BUTTON CLICKED!!!');
            console.log('saveYTDData:', saveYTDData);
            console.log('Type:', typeof saveYTDData);
            if (typeof saveYTDData === 'function') {
              console.log('Calling saveYTDData function');
              saveYTDData();
            } else {
              console.error('ERROR: saveYTDData is not a function!', saveYTDData);
            }
          }}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save YTD Payroll Data'}
        </button>
      </div>
    </>
  );
};

export default YTDSummaryTab;
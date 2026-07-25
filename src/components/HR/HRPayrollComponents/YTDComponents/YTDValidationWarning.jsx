// components/HR/HRPayrollComponents/YTDComponents/YTDValidationWarning.jsx
import React from 'react';
import { TavariStyles } from '../../../../utils/TavariStyles';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import TavariCheckbox from '../../../UI/TavariCheckbox';

const YTDValidationWarning = ({
  ytdData,
  periodTotals,
  formatTaxAmount,
  validationBypass,
  setValidationBypass,
  styles
}) => {
  if (!ytdData || !ytdData.regular_income) return null;

  const ytdTotal = (parseFloat(ytdData.regular_income) || 0) +
                   (parseFloat(ytdData.overtime_income) || 0) +
                   (parseFloat(ytdData.vacation_pay) || 0);
  
  const difference = periodTotals.grandTotal - ytdTotal;
  const isMatch = Math.abs(difference) <= 10; // Allow $10 tolerance

  return (
    <div style={{ marginTop: TavariStyles.spacing.lg }}>
      <h4 style={{ ...styles.sectionTitle, fontSize: TavariStyles.typography.fontSize.md }}>
        YTD Summary Comparison
      </h4>
      
      <div style={{
        ...styles.messageBox,
        ...(isMatch ? styles.successMessage : styles.warningMessage)
      }}>
        {isMatch ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
        <div>
          <div><strong>YTD Summary Total:</strong> ${formatTaxAmount(ytdTotal)}</div>
          <div><strong>Period Totals:</strong> ${formatTaxAmount(periodTotals.grandTotal)}</div>
          <div><strong>Difference:</strong> ${formatTaxAmount(Math.abs(difference))} {difference > 0 ? '(higher)' : '(lower)'}</div>
          {!isMatch && (
            <div style={{ marginTop: TavariStyles.spacing.sm }}>
              <TavariCheckbox
                checked={validationBypass}
                onChange={setValidationBypass}
                label="Bypass validation and save anyway"
                size="md"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default YTDValidationWarning;
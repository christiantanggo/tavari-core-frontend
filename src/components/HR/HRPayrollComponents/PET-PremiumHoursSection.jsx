// components/HR/HRPayrollComponents/PET-PremiumHoursSection.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const PETPremiumHoursSection = ({
  allPremiums = [],
  localHours = {},
  onPremiumHoursChange,
  saving = false,
  employee = null,
  isEmployeePremiumEnabled = null,
  regularHoursPaid = null,
  overtimeHours = null,
  statHolidayHours = null,
  lieuEarned = null
}) => {
  // Security context for premium operations
  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'PETPremiumHoursSection',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: false,
    securityLevel: 'medium'
  });

  /**
   * Helper function to format numbers to 2 decimal places
   */
  const formatToTwoDecimals = useCallback((value) => {
    const num = parseFloat(value || 0);
    return Math.round(num * 100) / 100;
  }, []);

  /**
   * Calculate automatic premium hours based on applies_to setting from database
   * Premiums should only apply to paid hours (considering max_paid_hours_per_period), not total worked hours
   * Lieu hours that are paid out should NOT get premiums (they already got premiums when earned)
   */
  const calculateAutomaticPremiumHours = useCallback((premium, regularHoursPaidProp, overtimeHoursProp, statHolidayHoursProp, lieuEarnedProp, regularHours, overtimeHours, lieuUsedHours) => {
    // Use passed props if available (from calculated preview), otherwise fall back to local hours
    const regularPaid = formatToTwoDecimals(regularHoursPaidProp !== null && regularHoursPaidProp !== undefined ? regularHoursPaidProp : (regularHours || 0));
    const overtime = formatToTwoDecimals(overtimeHoursProp !== null && overtimeHoursProp !== undefined ? overtimeHoursProp : (overtimeHours || 0));
    const statHoliday = formatToTwoDecimals(statHolidayHoursProp !== null && statHolidayHoursProp !== undefined ? statHolidayHoursProp : 0);
    const lieuUsed = formatToTwoDecimals(lieuUsedHours || 0);
    
    // Total paid hours = regular hours paid + overtime + stat holiday + paid-out lieu hours
    const totalPaidHours = regularPaid + overtime + statHoliday + lieuUsed;
  
    console.log(`🔄 CALCULATING ${premium.name}:`, {
      applies_to: premium.applies_to,
      regularPaid,
      overtime,
      statHoliday,
      totalPaidHours,
      lieuEarned: lieuEarnedProp,
      lieuUsed,
      note: 'Premiums apply to paid hours only, not lieu hours paid out'
    });
  
    switch (premium.applies_to) {
      case 'all_hours':
        // Apply to all paid hours including lieu payouts
        const result = formatToTwoDecimals(totalPaidHours);
        console.log(`🔄 ${premium.name} (all_hours): ${totalPaidHours} paid hours -> ${result}`);
        return result;
      
      case 'specific_hours':
        return 0; // Manual entry - will be set by user input
      
      case 'overtime_hours':
        return formatToTwoDecimals(overtime); // Apply only to overtime hours
      
      case 'regular_hours':
        // Apply to regular hours paid plus any lieu hours being paid out as regular pay
        return formatToTwoDecimals(regularPaid + lieuUsed);
      
      case 'lieu_hours':
        console.log(`🔄 ${premium.name} (lieu_hours): Applying to lieu hours ${lieuUsed}`);
        return formatToTwoDecimals(lieuUsed);
      
      case 'weekend_hours':
        return 0; // For now, default to manual entry
      
      default:
        return 0; // Default to manual entry
    }
  }, [formatToTwoDecimals]);

  /**
   * Check if premium input should be disabled (automatic calculation)
   */
  const isPremiumInputDisabled = useCallback((premium) => {
    return premium.applies_to !== 'specific_hours';
  }, []);

  /**
   * Get display text for premium application type
   */
  const getPremiumDisplayText = useCallback((premium) => {
    switch (premium.applies_to) {
      case 'all_hours':
        return ' (Auto: All Hours)';
      case 'overtime_hours':  
        return ' (Auto: Overtime Only)';
      case 'regular_hours':
        return ' (Auto: Regular Only)';
      case 'weekend_hours':
        return ' (Auto: Weekend Only)';
      case 'specific_hours':
        return ' (Manual Entry)';
      default:
        return ' (Manual Entry)';
    }
  }, []);

  /**
   * Get premium calculation explanation
   */
  const getPremiumExplanation = useCallback((premium) => {
    switch (premium.applies_to) {
      case 'all_hours':
        return 'This premium automatically applies to all hours you work';
      case 'overtime_hours':
        return 'This premium automatically applies to overtime hours only';
      case 'regular_hours':
        return 'This premium automatically applies to regular hours only';
      case 'weekend_hours':
        return 'This premium automatically applies to weekend hours only';
      case 'specific_hours':
        return 'Enter the number of hours this premium should apply to';
      default:
        return 'Enter the number of hours this premium should apply to';
    }
  }, []);

  // Auto-calculate premium hours when paid hours change
  useEffect(() => {
    if (allPremiums && allPremiums.length > 0 && localHours) {
      const regularHours = formatToTwoDecimals(localHours.regular_hours || 0);
      const overtimeHoursLocal = formatToTwoDecimals(localHours.overtime_hours || 0);
      const lieuUsedHours = formatToTwoDecimals(localHours.lieu_used || 0);
    
      console.log('🔄 PREMIUM AUTO-CALC:', {
        regularHoursPaid,
        overtimeHours,
        statHolidayHours,
        lieuEarned,
        regularHours,
        overtimeHoursLocal,
        lieuUsedHours,
        premiumHours: localHours.premium_hours,
        note: 'Using paid hours for premium calculation'
      });
    
      const updatedPremiumHours = { ...localHours.premium_hours };
      let hasChanges = false;
    
      allPremiums.forEach(premium => {
        if (premium.applies_to !== 'specific_hours' && isEmployeePremiumEnabled?.(employee?.id, premium.name)) {
          const autoHours = calculateAutomaticPremiumHours(
            premium, 
            regularHoursPaid, 
            overtimeHours, 
            statHolidayHours, 
            lieuEarned,
            regularHours,
            overtimeHoursLocal,
            lieuUsedHours
          );
          console.log(`🔄 PREMIUM ${premium.name} (${premium.applies_to}):`, {
            current: updatedPremiumHours[premium.name],
            calculated: autoHours,
            willUpdate: updatedPremiumHours[premium.name] !== autoHours
          });
          if (updatedPremiumHours[premium.name] !== autoHours) {
            updatedPremiumHours[premium.name] = autoHours;
            hasChanges = true;
          }
        }
      });
    
      if (hasChanges && onPremiumHoursChange) {
        onPremiumHoursChange(updatedPremiumHours);
      }
    }
  }, [localHours.total_hours, localHours.overtime_hours, localHours.lieu_used, regularHoursPaid, overtimeHours, statHolidayHours, lieuEarned, allPremiums, calculateAutomaticPremiumHours, onPremiumHoursChange, employee, isEmployeePremiumEnabled, formatToTwoDecimals]);
  
  // Handle manual premium hours change
  const handlePremiumHoursChange = useCallback(async (premiumName, newHours, shouldFormat = false) => {
    try {
      // If shouldFormat is true (from blur event), format to 2 decimals
      // Otherwise, allow the raw input value for natural typing
      let validatedHours;
      if (shouldFormat) {
        validatedHours = formatToTwoDecimals(Math.max(0, parseFloat(newHours) || 0));
      } else {
        // During typing, just validate it's a valid number but don't format
        validatedHours = newHours === '' ? 0 : parseFloat(newHours);
        if (isNaN(validatedHours)) return; // Don't update if invalid
        validatedHours = Math.max(0, validatedHours);
      }
      
      // Validate input
      const validation = await validateInput(validatedHours.toString(), 'premium_hours');
      if (!validation.valid) {
        console.warn('Invalid premium hours:', validation.error);
        return;
      }

      const updatedPremiumHours = {
        ...localHours.premium_hours,
        [premiumName]: validatedHours
      };

      if (onPremiumHoursChange) {
        onPremiumHoursChange(updatedPremiumHours);
      }

      // Log the change (only on blur/format to avoid excessive logging)
      if (shouldFormat && recordAction && employee) {
        await recordAction('premium_hours_changed', {
          employee_id: employee.id,
          premium_name: premiumName,
          hours: validatedHours
        });
      }

    } catch (error) {
      console.error('Error updating premium hours:', error);
    }
  }, [localHours.premium_hours, onPremiumHoursChange, validateInput, recordAction, employee, formatToTwoDecimals]);

  // Calculate premium preview totals
  const premiumPreview = useMemo(() => {
    if (!allPremiums || !employee) return { totalPay: 0, breakdown: {} };
    
    const wage = formatToTwoDecimals(employee.wage || 0);
    let totalPremiumPay = 0;
    const breakdown = {};
    
    allPremiums.forEach(premium => {
      const premiumHours = formatToTwoDecimals(localHours.premium_hours?.[premium.name] || 0);
      
      if (premiumHours > 0) {
        let premiumPay = 0;
        
        if (premium.rate_type === 'percentage') {
          premiumPay = formatToTwoDecimals(premiumHours * wage * (parseFloat(premium.rate) / 100));
        } else {
          premiumPay = formatToTwoDecimals(premiumHours * parseFloat(premium.rate));
        }
        
        totalPremiumPay = formatToTwoDecimals(totalPremiumPay + premiumPay);
        breakdown[premium.name] = {
          hours: formatToTwoDecimals(premiumHours),
          rate: formatToTwoDecimals(premium.rate),
          rate_type: premium.rate_type,
          pay: formatToTwoDecimals(premiumPay),
          applies_to: premium.applies_to
        };
      }
    });
    
    return { totalPay: formatToTwoDecimals(totalPremiumPay), breakdown };
  }, [allPremiums, localHours.premium_hours, employee, formatToTwoDecimals]);

  const styles = {
    section: {
      marginBottom: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      maxWidth: '100%',
      overflow: 'hidden'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.md} 0`
    },
    premiumGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: TavariStyles.spacing.lg,
      maxWidth: '100%',
      overflow: 'hidden'
    },
    premiumInputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs,
      minWidth: 0,
      width: '89%'
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      wordWrap: 'break-word',
      lineHeight: '1.3'
    },
    input: {
      ...TavariStyles.components.form?.input || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white
      },
      width: '100%'
    },
    premiumInfo: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    premiumRate: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    autoText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.info,
      fontStyle: 'italic'
    },
    explanationText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    infoText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      fontStyle: 'italic'
    },
    noPremiumsText: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.sm,
      padding: TavariStyles.spacing.md
    },
    previewSection: {
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    previewTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.sm
    },
    previewTotal: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    }
  };

  if (!allPremiums || allPremiums.length === 0) {
    return (
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Premium Hours</h4>
        <div style={styles.noPremiumsText}>
          No shift premiums available for this employee
        </div>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <h4 style={styles.sectionTitle}>Premium Hours</h4>
      
      <div style={styles.premiumGrid}>
        {allPremiums.map((premium, index) => {
          const rawValue = localHours.premium_hours?.[premium.name];
          const currentHours = rawValue || 0;
          const isDisabled = isPremiumInputDisabled(premium) || saving;
          const displayText = getPremiumDisplayText(premium);
          const explanation = getPremiumExplanation(premium);
          
          return (
            <div key={`${premium.id}-${index}`} style={styles.premiumInputGroup}>
              <label style={styles.label}>
                {premium.name} Hours{displayText}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max={formatToTwoDecimals(localHours.total_hours || 0)}
                style={{
                  ...styles.input,
                  ...(isDisabled ? {
                    backgroundColor: TavariStyles.colors.gray100,
                    cursor: 'not-allowed',
                    opacity: 0.7
                  } : {})
                }}
                value={currentHours === 0 && !isDisabled ? '' : currentHours}
                onChange={(e) => {
                  if (!isDisabled) {
                    // Allow free typing without formatting
                    handlePremiumHoursChange(premium.name, e.target.value, false);
                  }
                }}
                onBlur={(e) => {
                  // Format to 2 decimal places when leaving the field
                  if (!isDisabled && e.target.value !== '') {
                    handlePremiumHoursChange(premium.name, e.target.value, true);
                  }
                }}
                disabled={isDisabled}
                placeholder="0.00"
                onFocus={(e) => !isDisabled && e.target.select()}
                onClick={(e) => !isDisabled && e.target.select()}
              />
              <div style={styles.premiumInfo}>
                <span style={styles.premiumRate}>
                  {premium.rate_type === 'percentage' 
                    ? `${formatToTwoDecimals(premium.rate)}% of base rate` 
                    : `$${formatToTwoDecimals(premium.rate).toFixed(2)}/hr`}
                </span>
                {premium.applies_to !== 'specific_hours' ? (
                  <div style={styles.autoText}>
                    Automatically calculated based on your hours worked
                  </div>
                ) : (
                  <div style={styles.explanationText}>
                    {explanation}
                  </div>
                )}
              </div>
              {premium.description && (
                <div style={styles.infoText}>
                  {premium.description}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Premium Pay Preview */}
      {premiumPreview.totalPay > 0 && (
        <div style={styles.previewSection}>
          <div style={styles.previewTitle}>Premium Pay Preview:</div>
          <div style={styles.previewTotal}>
            ${premiumPreview.totalPay.toFixed(2)}
          </div>
          {Object.entries(premiumPreview.breakdown).map(([name, data]) => (
            <div key={name} style={styles.explanationText}>
              {name}: {data.hours.toFixed(2)}h × {data.rate_type === 'percentage' ? 
                `(${data.rate.toFixed(2)}% of base)` : `$${data.rate.toFixed(2)}`} = ${data.pay.toFixed(2)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PETPremiumHoursSection;
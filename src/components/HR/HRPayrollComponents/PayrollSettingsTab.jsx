// components/HR/HRPayrollComponents/PayrollSettingsTab.jsx - FIXED: Added onConflict to upsert
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const PayrollSettingsTab = ({ 
  selectedBusinessId, 
  businessData, 
  settings, 
  updateSettings, // Function passed from parent
  canadianTax,
  getCRAComplianceSummary 
}) => {
  // State for hrpayroll_settings table
  const [basicSettings, setBasicSettings] = useState({
    pay_frequency: 'weekly',
    default_vacation_percent: 4.00,
    federal_tax_percent: 15.00,
    provincial_tax_percent: 10.00,
    ei_percent: 1.64, // CORRECTED from 1.58 to 1.64
    cpp_percent: 5.95,
    use_accurate_tax_calculations: true,
    tax_jurisdiction: 'ON',
    use_cra_tax_tables: true,
    default_claim_code: 1,
    tax_year: 2025
  });

  // State for hrpayroll_tax_settings table  
  const [taxSettings, setTaxSettings] = useState({
    tax_jurisdiction: 'ON',
    pay_frequency: 'weekly',
    claim_code_default: 1,
    use_cra_tables: true,
    tax_year: 2025
  });

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [previewEmployee, setPreviewEmployee] = useState({
    grossPay: 1000,
    hoursWorked: 40,
    claimCode: 1
  });

  // Security context for sensitive payroll configuration
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'PayrollSettingsTab',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);

  // Load settings when component mounts or settings change
  useEffect(() => {
    if (settings) {
      // Load from hrpayroll_settings table
      setBasicSettings({
        pay_frequency: settings.pay_frequency || 'weekly',
        default_vacation_percent: parseFloat(settings.default_vacation_percent || 4.00),
        federal_tax_percent: parseFloat(settings.federal_tax_percent || 15.00),
        provincial_tax_percent: parseFloat(settings.provincial_tax_percent || 10.00),
        ei_percent: parseFloat(settings.ei_percent || 1.64), // CORRECTED
        cpp_percent: parseFloat(settings.cpp_percent || 5.95),
        use_accurate_tax_calculations: Boolean(settings.use_accurate_tax_calculations ?? true),
        tax_jurisdiction: settings.tax_jurisdiction || 'ON',
        use_cra_tax_tables: Boolean(settings.use_cra_tax_tables ?? true),
        default_claim_code: parseInt(settings.default_claim_code || 1),
        tax_year: parseInt(settings.tax_year || 2025)
      });
    }
    
    // Load tax settings separately if needed
    loadTaxSettings();
  }, [settings, selectedBusinessId]);

  // Load tax settings from hrpayroll_tax_settings table
  const loadTaxSettings = async () => {
    if (!selectedBusinessId) return;

    try {
      const { data, error } = await supabase
        .from('hrpayroll_tax_settings')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.warn('Tax settings not found:', error);
        return;
      }

      if (data) {
        setTaxSettings({
          tax_jurisdiction: data.tax_jurisdiction || 'ON',
          pay_frequency: data.pay_frequency || 'weekly',
          claim_code_default: parseInt(data.claim_code_default || 1),
          use_cra_tables: Boolean(data.use_cra_tables ?? true),
          tax_year: parseInt(data.tax_year || 2025)
        });
      }
    } catch (err) {
      console.error('Error loading tax settings:', err);
    }
  };

  // Handle input changes with validation
  const handleBasicSettingChange = async (field, value) => {
    setBasicSettings(prev => ({ ...prev, [field]: value }));
    
    // Clear any existing validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => ({ ...prev, [field]: null }));
    }
    
    // Validate immediately for better UX
    await validateField(field, value);
  };

  const handleTaxSettingChange = async (field, value) => {
    setTaxSettings(prev => ({ ...prev, [field]: value }));
    
    if (validationErrors[field]) {
      setValidationErrors(prev => ({ ...prev, [field]: null }));
    }
    
    await validateField(field, value);
  };

  // Validate individual fields
  const validateField = async (field, value) => {
    let error = null;
    
    try {
      switch (field) {
        case 'default_vacation_percent':
          const vacationValidation = await validateInput(value.toString(), 'vacation_percent', 'percentage');
          if (!vacationValidation.valid) {
            error = vacationValidation.error;
          } else if (value < 0 || value > 20) {
            error = 'Vacation percentage must be between 0% and 20%';
          }
          break;
          
        case 'default_claim_code':
        case 'claim_code_default':
          const claimValidation = await validateInput(value.toString(), 'claim_code', 'numeric');
          if (!claimValidation.valid) {
            error = claimValidation.error;
          } else if (value < 0 || value > 10) {
            error = 'Claim code must be between 0 and 10';
          }
          break;
          
        case 'federal_tax_percent':
        case 'provincial_tax_percent':
        case 'ei_percent':
        case 'cpp_percent':
          const taxRateValidation = await validateInput(value.toString(), field, 'percentage');
          if (!taxRateValidation.valid) {
            error = taxRateValidation.error;
          } else if (value < 0 || value > 50) {
            error = 'Tax rate must be between 0% and 50%';
          }
          break;
          
        case 'tax_year':
          if (value < 2020 || value > 2030) {
            error = 'Tax year must be between 2020 and 2030';
          }
          break;
      }
    } catch (err) {
      error = 'Validation failed';
      console.error('Validation error:', err);
    }
    
    setValidationErrors(prev => ({ ...prev, [field]: error }));
    return !error;
  };

  // Calculate preview payroll
  const calculatePreview = () => {
    const regularHours = Math.min(previewEmployee.hoursWorked, 40);
    const overtimeHours = Math.max(0, previewEmployee.hoursWorked - 40);
    const hourlyRate = previewEmployee.grossPay / previewEmployee.hoursWorked;
    
    const regularPay = regularHours * hourlyRate;
    const overtimePay = overtimeHours * hourlyRate * 1.5; // Standard 1.5x overtime
    const totalGrossPay = regularPay + overtimePay;
    
    // Calculate vacation pay if enabled
    const vacationPay = basicSettings.use_accurate_tax_calculations ? 
      totalGrossPay * (basicSettings.default_vacation_percent / 100) : 0;
    
    const grossWithVacation = totalGrossPay + vacationPay;

    // Calculate taxes based on CRA compliance setting
    let federalTax, provincialTax, ei, cpp;
    let calculationMethod = 'simplified';

    if (basicSettings.use_cra_tax_tables && canadianTax?.calculateCRACompliantTaxes) {
      // Use CRA compliant calculations
      try {
        const craResult = canadianTax.calculateCRACompliantTaxes({
          grossPay: grossWithVacation,
          payPeriods: basicSettings.pay_frequency === 'weekly' ? 52 : 
                     basicSettings.pay_frequency === 'bi-weekly' ? 26 : 52,
          claimCode: previewEmployee.claimCode,
          jurisdiction: basicSettings.tax_jurisdiction,
          yearToDateTotals: {
            yearToDateEI: 0,
            yearToDateCPP: 0
          }
        });

        federalTax = craResult.federal_tax_period || 0;
        provincialTax = craResult.provincial_tax_period || 0;
        ei = craResult.ei_premium || 0;
        cpp = craResult.cpp_contribution || 0;
        calculationMethod = 'cra_compliant';
      } catch (err) {
        console.error('CRA calculation failed, falling back to simplified:', err);
        // Fall through to simplified calculation
      }
    }
    
    // Simplified calculation (fallback or when CRA disabled)
    if (calculationMethod === 'simplified') {
      federalTax = grossWithVacation * (basicSettings.federal_tax_percent / 100);
      provincialTax = grossWithVacation * (basicSettings.provincial_tax_percent / 100);
      ei = grossWithVacation * (basicSettings.ei_percent / 100);
      cpp = grossWithVacation * (basicSettings.cpp_percent / 100);
    }
    
    const totalDeductions = federalTax + provincialTax + ei + cpp;
    const netPay = grossWithVacation - totalDeductions;

    return {
      regularPay,
      overtimePay,
      totalGrossPay,
      vacationPay,
      grossWithVacation,
      federalTax,
      provincialTax,
      ei,
      cpp,
      totalDeductions,
      netPay,
      regularHours,
      overtimeHours,
      calculationMethod
    };
  };

  // ✅ FIXED: Save settings with onConflict parameter
  const saveSettings = async () => {
    if (!selectedBusinessId) return;

    // Rate limit check
    const rateLimitCheck = await checkRateLimit('save_payroll_settings');
    if (!rateLimitCheck.allowed) {
      alert('Rate limit exceeded. Please wait before saving settings again.');
      return;
    }

    // Validate all fields
    const validationResults = await Promise.all([
      validateField('default_vacation_percent', basicSettings.default_vacation_percent),
      validateField('default_claim_code', basicSettings.default_claim_code),
      validateField('federal_tax_percent', basicSettings.federal_tax_percent),
      validateField('provincial_tax_percent', basicSettings.provincial_tax_percent),
      validateField('ei_percent', basicSettings.ei_percent),
      validateField('cpp_percent', basicSettings.cpp_percent),
      validateField('claim_code_default', taxSettings.claim_code_default),
      validateField('tax_year', basicSettings.tax_year)
    ]);

    if (validationResults.some(result => !result)) {
      alert('Please fix validation errors before saving.');
      return;
    }

    setSaving(true);
    try {
      await recordAction('payroll_settings_save_attempt', true);

      // ✅ FIXED: Save to hrpayroll_settings table with onConflict
      const { error: basicError } = await supabase
        .from('hrpayroll_settings')
        .upsert({
          business_id: selectedBusinessId,
          pay_frequency: basicSettings.pay_frequency,
          default_vacation_percent: basicSettings.default_vacation_percent,
          federal_tax_percent: basicSettings.federal_tax_percent,
          provincial_tax_percent: basicSettings.provincial_tax_percent,
          ei_percent: basicSettings.ei_percent,
          cpp_percent: basicSettings.cpp_percent,
          use_accurate_tax_calculations: basicSettings.use_accurate_tax_calculations,
          tax_jurisdiction: basicSettings.tax_jurisdiction,
          use_cra_tax_tables: basicSettings.use_cra_tax_tables,
          default_claim_code: basicSettings.default_claim_code,
          tax_year: basicSettings.tax_year,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'business_id'  // ✅ ADDED THIS
        });

      if (basicError) throw basicError;

      // ✅ FIXED: Save to hrpayroll_tax_settings table with onConflict
      const { error: taxError } = await supabase
        .from('hrpayroll_tax_settings')
        .upsert({
          business_id: selectedBusinessId,
          tax_jurisdiction: taxSettings.tax_jurisdiction,
          pay_frequency: taxSettings.pay_frequency,
          claim_code_default: taxSettings.claim_code_default,
          use_cra_tables: taxSettings.use_cra_tables,
          tax_year: taxSettings.tax_year,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'business_id'  // ✅ ADDED THIS
        });

      if (taxError) throw taxError;

      setLastSaved(new Date());
      
      await logSecurityEvent('payroll_settings_saved', {
        business_id: selectedBusinessId,
        pay_frequency: basicSettings.pay_frequency,
        vacation_percent: basicSettings.default_vacation_percent,
        cra_compliant: basicSettings.use_cra_tax_tables,
        claim_code: basicSettings.default_claim_code,
        ei_rate_corrected: basicSettings.ei_percent === 1.64
      }, 'medium');

      alert('Payroll settings saved successfully!');
      
      // Trigger parent update if function provided
      if (updateSettings) {
        updateSettings({ ...basicSettings, ...taxSettings });
      }
      
    } catch (error) {
      console.error('Error saving settings:', error);
      await recordAction('payroll_settings_save_attempt', false);
      await logSecurityEvent('payroll_settings_save_failed', {
        business_id: selectedBusinessId,
        error_message: error.message
      }, 'high');
      
      // Show user-friendly error message
      const errorMessage = error.message.includes('duplicate key') ? 
        'Settings already exist for this business. Please try again.' :
        error.message || 'Unknown error occurred';
        
      alert('Error saving settings: ' + errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (confirm('Reset all payroll settings to default values? This cannot be undone.')) {
      await logSecurityEvent('payroll_settings_reset', {
        business_id: selectedBusinessId,
        previous_settings: { ...basicSettings, ...taxSettings }
      }, 'high');

      setBasicSettings({
        pay_frequency: 'weekly',
        default_vacation_percent: 4.00,
        federal_tax_percent: 15.00,
        provincial_tax_percent: 10.00,
        ei_percent: 1.64, // CORRECTED
        cpp_percent: 5.95,
        use_accurate_tax_calculations: true,
        tax_jurisdiction: 'ON',
        use_cra_tax_tables: true,
        default_claim_code: 1,
        tax_year: 2025
      });

      setTaxSettings({
        tax_jurisdiction: 'ON',
        pay_frequency: 'weekly',
        claim_code_default: 1,
        use_cra_tables: true,
        tax_year: 2025
      });

      setValidationErrors({});
    }
  };

  const preview = calculatePreview();

  const styles = {
    container: {
      padding: TavariStyles.spacing.lg
    },
    section: {
      marginBottom: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      borderRadius: '8px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray800,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.sm
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs,
      display: 'block'
    },
    input: {
      padding: '12px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      transition: 'border-color 0.2s',
      fontFamily: 'inherit',
      backgroundColor: TavariStyles.colors.white
    },
    inputError: {
      borderColor: TavariStyles.colors.danger
    },
    select: {
      padding: '12px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer'
    },
    description: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    errorText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.danger,
      marginTop: TavariStyles.spacing.xs
    },
    button: {
      padding: '12px 20px',
      borderRadius: '6px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    secondaryButton: {
      padding: '12px 20px',
      borderRadius: '6px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    }
  };

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
      componentName="PayrollSettingsTab"
    >
      <SecurityWrapper
        componentName="PayrollSettingsTab"
        sensitiveComponent={true}
        enableRateLimiting={true}
        enableAuditLogging={true}
        securityLevel="high"
      >
        <div style={styles.container}>
          <h2 style={{
            fontSize: TavariStyles.typography.fontSize['2xl'],
            fontWeight: TavariStyles.typography.fontWeight.bold,
            marginBottom: TavariStyles.spacing.xl,
            color: TavariStyles.colors.gray900
          }}>
            Payroll Settings
          </h2>

          {/* Basic Payroll Settings */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Basic Payroll Configuration</h3>
            
            <div style={styles.formGrid}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Pay Frequency</label>
                <select
                  style={styles.select}
                  value={basicSettings.pay_frequency}
                  onChange={(e) => handleBasicSettingChange('pay_frequency', e.target.value)}
                >
                  <option value="weekly">Weekly (52 pay periods)</option>
                  <option value="bi_weekly">Bi-weekly (26 pay periods)</option>
                  <option value="semi_monthly">Semi-monthly (24 pay periods)</option>
                  <option value="monthly">Monthly (12 pay periods)</option>
                </select>
                <div style={styles.description}>
                  How often employees are paid
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Default Vacation %</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="20"
                  style={{
                    ...styles.input,
                    ...(validationErrors.default_vacation_percent ? styles.inputError : {})
                  }}
                  value={basicSettings.default_vacation_percent}
                  onChange={(e) => handleBasicSettingChange('default_vacation_percent', parseFloat(e.target.value) || 0)}
                />
                {validationErrors.default_vacation_percent && (
                  <div style={styles.errorText}>{validationErrors.default_vacation_percent}</div>
                )}
                <div style={styles.description}>
                  Default vacation pay percentage (typically 4% in Ontario)
                </div>
              </div>
            </div>
          </div>

          {/* CRA Tax Settings */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>CRA Tax Configuration</h3>
            
            <div style={styles.formGrid}>
              <div style={styles.formGroup}>
                <TavariCheckbox
                  checked={basicSettings.use_cra_tax_tables}
                  onChange={(checked) => handleBasicSettingChange('use_cra_tax_tables', checked)}
                  label="Use CRA T4127 Tax Tables"
                  size="md"
                />
                <div style={styles.description}>
                  Enable CRA T4127 compliant tax calculations (recommended for accuracy)
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Tax Jurisdiction</label>
                <select
                  style={styles.select}
                  value={basicSettings.tax_jurisdiction}
                  onChange={(e) => handleBasicSettingChange('tax_jurisdiction', e.target.value)}
                >
                  <option value="ON">Ontario</option>
                  <option value="BC">British Columbia</option>
                  <option value="AB">Alberta</option>
                  <option value="SK">Saskatchewan</option>
                  <option value="MB">Manitoba</option>
                  <option value="QC">Quebec</option>
                  <option value="NB">New Brunswick</option>
                  <option value="NS">Nova Scotia</option>
                  <option value="PE">Prince Edward Island</option>
                  <option value="NL">Newfoundland and Labrador</option>
                  <option value="NT">Northwest Territories</option>
                  <option value="NU">Nunavut</option>
                  <option value="YT">Yukon</option>
                </select>
                <div style={styles.description}>
                  Provincial/territorial tax jurisdiction
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Default Claim Code</label>
                <select
                  style={{
                    ...styles.select,
                    ...(validationErrors.default_claim_code ? styles.inputError : {})
                  }}
                  value={basicSettings.default_claim_code}
                  onChange={(e) => handleBasicSettingChange('default_claim_code', parseInt(e.target.value))}
                >
                  {Array.from({length: 11}, (_, i) => (
                    <option key={i} value={i}>Claim Code {i}</option>
                  ))}
                </select>
                {validationErrors.default_claim_code && (
                  <div style={styles.errorText}>{validationErrors.default_claim_code}</div>
                )}
                <div style={styles.description}>
                  Default federal tax claim code for new employees
                </div>
              </div>
            </div>

            {!basicSettings.use_cra_tax_tables && (
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Federal Tax % (Simplified)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="50"
                    style={{
                      ...styles.input,
                      ...(validationErrors.federal_tax_percent ? styles.inputError : {})
                    }}
                    value={basicSettings.federal_tax_percent}
                    onChange={(e) => handleBasicSettingChange('federal_tax_percent', parseFloat(e.target.value) || 0)}
                  />
                  {validationErrors.federal_tax_percent && (
                    <div style={styles.errorText}>{validationErrors.federal_tax_percent}</div>
                  )}
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Provincial Tax %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="50"
                    style={{
                      ...styles.input,
                      ...(validationErrors.provincial_tax_percent ? styles.inputError : {})
                    }}
                    value={basicSettings.provincial_tax_percent}
                    onChange={(e) => handleBasicSettingChange('provincial_tax_percent', parseFloat(e.target.value) || 0)}
                  />
                  {validationErrors.provincial_tax_percent && (
                    <div style={styles.errorText}>{validationErrors.provincial_tax_percent}</div>
                  )}
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>EI Rate % (CORRECTED to 1.64%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="10"
                    style={{
                      ...styles.input,
                      ...(validationErrors.ei_percent ? styles.inputError : {}),
                      backgroundColor: basicSettings.ei_percent === 1.64 ? '#dcfce7' : TavariStyles.colors.white
                    }}
                    value={basicSettings.ei_percent}
                    onChange={(e) => handleBasicSettingChange('ei_percent', parseFloat(e.target.value) || 0)}
                  />
                  {validationErrors.ei_percent && (
                    <div style={styles.errorText}>{validationErrors.ei_percent}</div>
                  )}
                  <div style={styles.description}>
                    ✅ Correct CRA rate for 2025 is 1.64%
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>CPP Rate %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    style={{
                      ...styles.input,
                      ...(validationErrors.cpp_percent ? styles.inputError : {})
                    }}
                    value={basicSettings.cpp_percent}
                    onChange={(e) => handleBasicSettingChange('cpp_percent', parseFloat(e.target.value) || 0)}
                  />
                  {validationErrors.cpp_percent && (
                    <div style={styles.errorText}>{validationErrors.cpp_percent}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Preview Section */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>📊 Payroll Calculation Preview</h3>
            
            <div style={{
              background: `linear-gradient(135deg, ${TavariStyles.colors.gray50} 0%, ${TavariStyles.colors.white} 100%)`,
              padding: TavariStyles.spacing.lg,
              borderRadius: '12px',
              border: `1px solid ${TavariStyles.colors.gray200}`,
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
            }}>
              <div style={{
                fontSize: TavariStyles.typography.fontSize.md,
                fontWeight: TavariStyles.typography.fontWeight.semibold,
                marginBottom: TavariStyles.spacing.md,
                color: TavariStyles.colors.gray800
              }}>
                Sample Calculation (CRA {basicSettings.use_cra_tax_tables ? 'Compliant' : 'Non-Compliant'})
              </div>
              
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: TavariStyles.spacing.md,
                marginBottom: TavariStyles.spacing.lg
              }}>
                <div>
                  <label style={styles.label}>Gross Pay ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    style={styles.input}
                    value={previewEmployee.grossPay}
                    onChange={(e) => setPreviewEmployee(prev => ({ ...prev, grossPay: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label style={styles.label}>Hours Worked</label>
                  <input
                    type="number"
                    min="0"
                    max="80"
                    step="0.5"
                    style={styles.input}
                    value={previewEmployee.hoursWorked}
                    onChange={(e) => setPreviewEmployee(prev => ({ ...prev, hoursWorked: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label style={styles.label}>Claim Code</label>
                  <select
                    style={styles.select}
                    value={previewEmployee.claimCode}
                    onChange={(e) => setPreviewEmployee(prev => ({ ...prev, claimCode: parseInt(e.target.value) }))}
                  >
                    {Array.from({length: 11}, (_, i) => (
                      <option key={i} value={i}>CC {i}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.xs, padding: TavariStyles.spacing.xs + ' 0' }}>
                  <span>Regular Hours ({preview.regularHours}h):</span>
                  <span>${formatTaxAmount ? formatTaxAmount(preview.regularPay) : preview.regularPay.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.xs, padding: TavariStyles.spacing.xs + ' 0' }}>
                  <span>Overtime Hours ({preview.overtimeHours}h @ 1.5x):</span>
                  <span>${formatTaxAmount ? formatTaxAmount(preview.overtimePay) : preview.overtimePay.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.xs, padding: TavariStyles.spacing.xs + ' 0', borderTop: `1px solid ${TavariStyles.colors.gray200}`, paddingTop: TavariStyles.spacing.sm }}>
                  <span><strong>Gross Pay:</strong></span>
                  <span><strong>${formatTaxAmount ? formatTaxAmount(preview.grossWithVacation) : preview.grossWithVacation.toFixed(2)}</strong></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: TavariStyles.spacing.xs, padding: TavariStyles.spacing.xs + ' 0', color: TavariStyles.colors.danger }}>
                  <span>Total Deductions:</span>
                  <span>-${formatTaxAmount ? formatTaxAmount(preview.totalDeductions) : preview.totalDeductions.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: TavariStyles.spacing.xs + ' 0', borderTop: `2px solid ${TavariStyles.colors.gray300}`, paddingTop: TavariStyles.spacing.sm }}>
                  <span style={{ fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.bold }}>Net Pay:</span>
                  <span style={{ fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.bold, color: TavariStyles.colors.success }}>
                    ${formatTaxAmount ? formatTaxAmount(preview.netPay) : preview.netPay.toFixed(2)}
                  </span>
                </div>
                
                <div style={{ marginTop: TavariStyles.spacing.md, fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600 }}>
                  Hourly Rate: ${formatTaxAmount ? formatTaxAmount(previewEmployee.grossPay / previewEmployee.hoursWorked) : (previewEmployee.grossPay / previewEmployee.hoursWorked).toFixed(2)}/hr | 
                  Effective Tax Rate: {((preview.totalDeductions / preview.grossWithVacation) * 100).toFixed(1)}% |
                  Method: {preview.calculationMethod === 'cra_compliant' ? 'CRA T4127 Compliant' : 'Simplified (Non-Compliant)'}
                </div>
              </div>
            </div>
          </div>

          {/* Save Section */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: TavariStyles.spacing.lg,
            background: `linear-gradient(135deg, ${TavariStyles.colors.gray50} 0%, ${TavariStyles.colors.white} 100%)`,
            borderRadius: '12px',
            marginTop: TavariStyles.spacing.xl,
            border: `1px solid ${TavariStyles.colors.gray200}`
          }}>
            <div>
              {lastSaved && (
                <div style={{
                  fontSize: TavariStyles.typography.fontSize.sm,
                  color: TavariStyles.colors.gray600
                }}>
                  Last saved: {lastSaved.toLocaleDateString()} at {lastSaved.toLocaleTimeString()}
                </div>
              )}
            </div>
            <div>
              <button
                style={{
                  ...styles.secondaryButton,
                  marginRight: TavariStyles.spacing.sm
                }}
                onClick={resetToDefaults}
                disabled={saving}
              >
                Reset to Defaults
              </button>
              <button
                style={{
                  ...styles.button,
                  ...(saving ? styles.disabledButton : {})
                }}
                onClick={saveSettings}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Payroll Settings'}
              </button>
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default PayrollSettingsTab;
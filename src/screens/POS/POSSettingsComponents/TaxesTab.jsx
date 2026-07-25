// src/screens/POS/POSSettingsComponents/TaxesTab.jsx
import React from 'react';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const TaxesTab = ({ 
  settings, 
  handleInputChange, 
  taxCategories, 
  selectedJurisdiction,
  updateJurisdictionSetting,
  removeTaxCategory,
  setNewTaxCategory,
  setShowAddTaxModal,
  setShowAddRebateModal,
  taxError,
  canEdit = true
}) => {
  const primaryTaxes = taxCategories.filter(cat => cat.category_type === 'tax' && cat.is_active) || [];
  const rebates = taxCategories.filter(cat => (cat.category_type === 'rebate' || cat.category_type === 'exemption') && cat.is_active) || [];

  return (
    <div style={styles.tabContent}>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Tax Configuration</h3>
        
        {taxError && (
          <div style={styles.errorBanner}>
            Tax Configuration Error: {taxError}
          </div>
        )}
        
        {/* PRIMARY TAX CATEGORIES SECTION */}
        <div style={styles.primaryTaxSection}>
          <h4 style={styles.subSectionTitle}>Primary Tax Categories</h4>
          <div style={styles.settingDescription}>
            Create the base tax rates that apply to most items. Example: GST (5%) and PST (8%) instead of combined HST (13%).
          </div>
          
          {primaryTaxes.length > 0 && (
            <div style={styles.taxCategoriesList}>
              {primaryTaxes.map(category => (
                <div key={category.id} style={styles.taxCategoryItem}>
                  <div style={styles.categoryInfo}>
                    <span style={styles.categoryName}>{category.name}</span>
                    <span style={styles.categoryRate}>
                      {(category.rate * 100).toFixed(2)}%
                    </span>
                  </div>
                  <button 
                    style={styles.removeButton}
                    onClick={() => removeTaxCategory(category.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <button
            style={styles.addTaxButton}
            onClick={() => {
              setNewTaxCategory({ 
                name: '', 
                rate: 0, 
                category_type: 'tax',
                applies_to: ['primary'], 
                minimum_amount: 0, 
                maximum_amount: null,
                rebate_affects: [],
                valid_from: null,
                valid_to: null
              });
              setShowAddTaxModal(true);
            }}
          >
            + Add Tax Category
          </button>
        </div>

        {/* TAX REBATES SECTION */}
        <div style={styles.rebateSection}>
          <h4 style={styles.subSectionTitle}>Tax Rebates</h4>
          <div style={styles.settingDescription}>
            Create rebates that reduce or eliminate specific taxes for qualifying items or customers.
          </div>
          
          {rebates.length > 0 && (
            <div style={styles.taxCategoriesList}>
              {rebates.map(category => (
                <div key={category.id} style={styles.rebateCategoryItem}>
                  <div style={styles.categoryInfo}>
                    <span style={styles.categoryName}>{category.name}</span>
                    <span style={styles.rebateRate}>
                      Removes Tax
                    </span>
                    {category.rebate_affects && category.rebate_affects.length > 0 && (
                      <span style={styles.rebateAffects}>
                        Affects: {category.rebate_affects.includes('all') ? 'All taxes' : 
                          primaryTaxes.filter(tax => category.rebate_affects.includes(tax.id))
                            .map(tax => tax.name).join(', ')}
                      </span>
                    )}
                    {(category.valid_from || category.valid_to) && (
                      <span style={styles.rebateDates}>
                        {category.valid_from && category.valid_to 
                          ? `Valid: ${new Date(category.valid_from).toLocaleDateString()} - ${new Date(category.valid_to).toLocaleDateString()}`
                          : category.valid_from 
                          ? `Valid from: ${new Date(category.valid_from).toLocaleDateString()}`
                          : `Valid until: ${new Date(category.valid_to).toLocaleDateString()}`
                        }
                      </span>
                    )}
                  </div>
                  <button 
                    style={styles.removeButton}
                    onClick={() => removeTaxCategory(category.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <button
            style={styles.addRebateButton}
            onClick={() => {
              setNewTaxCategory({ 
                name: '', 
                rate: 0, 
                category_type: 'rebate',
                applies_to: ['rebate'], 
                minimum_amount: 0, 
                maximum_amount: null,
                rebate_affects: [],
                valid_from: null,
                valid_to: null
              });
              setShowAddRebateModal(true);
            }}
            disabled={primaryTaxes.length === 0}
          >
            + Add Tax Rebate
          </button>
          {primaryTaxes.length === 0 && (
            <div style={styles.disabledButtonNote}>
              Create primary tax categories first
            </div>
          )}
        </div>

        {/* Complex Tax Rules Toggle */}
        <div style={styles.complexToggleSection}>
          <h4 style={styles.subSectionTitle}>Advanced Tax Rules</h4>
          <div style={styles.settingDescription}>
            Enable automated jurisdiction-specific calculations and exemptions.
          </div>
          
          <div style={styles.yesNoToggle}>
            <button
              style={{
                ...styles.toggleButton,
                ...(settings.complex_taxes_enabled === false ? styles.activeToggleButton : {})
              }}
              onClick={() => handleInputChange('complex_taxes_enabled', false)}
            >
              No
            </button>
            <button
              style={{
                ...styles.toggleButton,
                ...(settings.complex_taxes_enabled === true ? styles.activeToggleButton : {})
              }}
              onClick={() => handleInputChange('complex_taxes_enabled', true)}
            >
              Yes
            </button>
          </div>

          {settings.complex_taxes_enabled && (
            <div style={styles.complexRulesContent}>
              <div style={styles.setting}>
                <label style={styles.label}>Jurisdiction:</label>
                <select
                  value={settings.jurisdiction_code || ''}
                  onChange={(e) => handleInputChange('jurisdiction_code', e.target.value)}
                  style={styles.select}
                >
                  <option value="">Select Jurisdiction</option>
                  <option value="ON">Ontario</option>
                  <option value="AB">Alberta</option>
                  <option value="BC">British Columbia</option>
                  <option value="MB">Manitoba</option>
                  <option value="NB">New Brunswick</option>
                  <option value="NL">Newfoundland and Labrador</option>
                  <option value="NS">Nova Scotia</option>
                  <option value="PE">Prince Edward Island</option>
                  <option value="QC">Quebec</option>
                  <option value="SK">Saskatchewan</option>
                  <option value="NT">Northwest Territories</option>
                  <option value="NU">Nunavut</option>
                  <option value="YT">Yukon</option>
                </select>
              </div>

              {selectedJurisdiction && (
                <div style={styles.jurisdictionSettings}>
                  <div style={styles.setting}>
                    <label style={styles.label}>Small Purchase Threshold:</label>
                    <div style={styles.inputGroup}>
                      <span>$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={selectedJurisdiction.small_purchase_threshold || 0}
                        onChange={(e) => updateJurisdictionSetting('small_purchase_threshold', parseFloat(e.target.value) || 0)}
                        style={styles.input}
                      />
                    </div>
                    <div style={styles.settingDescription}>
                      Amount below which special rules may apply.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={styles.indianStatusSection}>
          <h4 style={styles.subSectionTitle}>Indian Status (GST only)</h4>
          <div style={styles.settingDescription}>
            When staff use &quot;Indian Status (GST Only)&quot; on the register, the whole sale is taxed at this federal GST rate only (not your full HST/GST+PST stack). Update when CRA rates change.
          </div>
          <div style={styles.setting}>
            <label style={styles.label}>GST rate (decimal)</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              max="1"
              value={settings.indian_status_gst_rate ?? 0.05}
              onChange={(e) => handleInputChange('indian_status_gst_rate', parseFloat(e.target.value) || 0)}
              disabled={!canEdit}
              style={{ ...styles.input, width: '160px' }}
            />
            <div style={styles.settingDescription}>
              Example: 0.05 = 5%
            </div>
          </div>
          <div style={styles.setting}>
            <label style={styles.label}>Tax line label (receipt / summary)</label>
            <input
              type="text"
              value={settings.indian_status_tax_label ?? 'GST (Indian Status)'}
              onChange={(e) => handleInputChange('indian_status_tax_label', e.target.value)}
              disabled={!canEdit}
              style={{ ...styles.input, width: '100%', maxWidth: '400px' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  tabContent: {
    padding: TavariStyles.spacing['3xl']
  },
  section: {
    marginBottom: TavariStyles.spacing['3xl']
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.md,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`
  },
  setting: {
    marginBottom: TavariStyles.spacing.xl
  },
  label: {
    ...TavariStyles.components.form.label
  },
  input: {
    ...TavariStyles.components.form.input,
    width: '120px'
  },
  select: {
    ...TavariStyles.components.form.select,
    minWidth: '150px'
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  settingDescription: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs,
    fontStyle: 'italic'
  },
  errorBanner: {
    ...TavariStyles.components.banner.base,
    ...TavariStyles.components.banner.variants.error,
    marginBottom: TavariStyles.spacing.xl
  },
  subSectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.md
  },
  primaryTaxSection: {
    border: `2px solid ${TavariStyles.colors.success}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.successBg,
    marginBottom: TavariStyles.spacing['2xl']
  },
  rebateSection: {
    border: `2px solid ${TavariStyles.colors.warning}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.warningBg,
    marginBottom: TavariStyles.spacing['2xl']
  },
  taxCategoriesList: {
    marginBottom: TavariStyles.spacing.lg
  },
  taxCategoryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: TavariStyles.spacing.sm
  },
  rebateCategoryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.warning}`,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: TavariStyles.spacing.sm
  },
  categoryInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  categoryName: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800
  },
  categoryRate: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.success
  },
  rebateRate: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.warning
  },
  rebateAffects: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    fontStyle: 'italic'
  },
  rebateDates: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.success,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    fontStyle: 'italic'
  },
  removeButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.danger,
    ...TavariStyles.components.button.sizes.sm
  },
  addTaxButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.success
  },
  addRebateButton: {
    ...TavariStyles.components.button.base,
    backgroundColor: TavariStyles.colors.warning,
    color: TavariStyles.colors.white
  },
  disabledButtonNote: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    fontStyle: 'italic',
    marginTop: TavariStyles.spacing.xs
  },
  complexToggleSection: {
    border: `2px solid ${TavariStyles.colors.secondary}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.infoBg
  },
  yesNoToggle: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.xl
  },
  toggleButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
    minWidth: '80px'
  },
  activeToggleButton: {
    backgroundColor: TavariStyles.colors.secondary,
    color: TavariStyles.colors.white,
    borderColor: TavariStyles.colors.secondary
  },
  complexRulesContent: {
    marginTop: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: TavariStyles.borderRadius.md
  },
  jurisdictionSettings: {
    marginTop: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  indianStatusSection: {
    border: `2px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.gray25 || '#f9fafb',
    marginTop: TavariStyles.spacing['2xl']
  }
};

export default TaxesTab;
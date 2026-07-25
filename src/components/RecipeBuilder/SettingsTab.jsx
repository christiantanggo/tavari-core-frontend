// src/components/RecipeBuilder/SettingsTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Save, RefreshCw, Settings, DollarSign, Calculator, AlertTriangle } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';
import ModuleDeactivationPanel from '../Modules/ModuleDeactivationPanel';
import SuppliersTab from './SuppliersTab';

const SettingsTab = ({ businessId }) => {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    recipe_builder_enabled: true,
    default_margin_percent: 60,
    cost_tracking_enabled: true,
    inventory_alerts_enabled: true,
    low_stock_threshold: 10,
    auto_calculate_costs: true,
    require_cost_approval: false,
    shrinkage_tracking_enabled: true,
    order_guide_auto_generation: false,
    supplier_price_updates_enabled: true,
    recipe_scaling_precision: 2,
    default_unit_system: 'metric',
    cost_rounding_method: 'round',
    margin_tier_enabled: false,
    default_margin_tier: 'standard'
  });

  useEffect(() => {
    if (businessId) {
      fetchSettings();
    }
  }, [businessId]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      
      // Fetch POS settings for this business
      const { data: settingsData, error: settingsError } = await supabase
        .from('pos_settings')
        .select('*')
        .eq('business_id', businessId)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') {
        throw settingsError;
      }

      // Merge with defaults
      const mergedSettings = {
        ...formData,
        ...(settingsData || {})
      };

      setSettings(settingsData || {});
      setFormData(mergedSettings);
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);

      // Update or insert settings
      const { error } = await supabase
        .from('pos_settings')
        .upsert({
          business_id: businessId,
          ...formData,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      toast.success('Settings saved successfully');
      setSettings(formData);
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset all settings to defaults?')) {
      setFormData({
        recipe_builder_enabled: true,
        default_margin_percent: 60,
        cost_tracking_enabled: true,
        inventory_alerts_enabled: true,
        low_stock_threshold: 10,
        auto_calculate_costs: true,
        require_cost_approval: false,
        shrinkage_tracking_enabled: true,
        order_guide_auto_generation: false,
        supplier_price_updates_enabled: true,
        recipe_scaling_precision: 2,
        default_unit_system: 'metric',
        cost_rounding_method: 'round',
        margin_tier_enabled: false,
        default_margin_tier: 'standard'
      });
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading settings...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Settings</h2>
          <p style={styles.subtitle}>Manage suppliers and Recipe Manager preferences</p>
        </div>
        <div style={styles.headerActions}>
          <button onClick={fetchSettings} style={styles.refreshButton}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button onClick={handleReset} style={styles.resetButton}>
            Reset to Defaults
          </button>
        </div>
      </div>

      <div style={styles.section}>
        <SuppliersTab businessId={businessId} />
      </div>

      <form onSubmit={handleSave} style={styles.form}>
        {/* General Settings */}
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <Settings size={20} />
            <h3 style={styles.sectionTitle}>General Settings</h3>
          </div>
          
          <div style={styles.settingsGrid}>
            <div style={styles.settingItem}>
              <TavariCheckbox
                checked={formData.recipe_builder_enabled}
                onChange={(checked) => setFormData({...formData, recipe_builder_enabled: checked})}
                label="Enable Recipe Builder"
                size="sm"
              />
              <p style={styles.settingDescription}>
                Master switch to enable/disable the entire Recipe Builder module
              </p>
            </div>

            <div style={styles.settingItem}>
              <TavariCheckbox
                checked={formData.cost_tracking_enabled}
                onChange={(checked) => setFormData({...formData, cost_tracking_enabled: checked})}
                label="Enable Cost Tracking"
                size="sm"
              />
              <p style={styles.settingDescription}>
                Track ingredient costs and recipe profitability
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={formData.shrinkage_tracking_enabled}
                  onChange={(e) => setFormData({...formData, shrinkage_tracking_enabled: e.target.checked})}
                  style={styles.checkbox}
                />
                Enable Shrinkage Tracking
              </label>
              <p style={styles.settingDescription}>
                Log and track ingredient waste and losses
              </p>
            </div>
          </div>
        </div>

        {/* Cost & Margin Settings */}
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <DollarSign size={20} />
            <h3 style={styles.sectionTitle}>Cost & Margin Settings</h3>
          </div>
          
          <div style={styles.settingsGrid}>
            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>Default Margin Percentage</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.default_margin_percent}
                onChange={(e) => setFormData({...formData, default_margin_percent: parseFloat(e.target.value) || 60})}
                style={styles.input}
              />
              <p style={styles.settingDescription}>
                Default profit margin percentage for new recipes
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={formData.auto_calculate_costs}
                  onChange={(e) => setFormData({...formData, auto_calculate_costs: e.target.checked})}
                  style={styles.checkbox}
                />
                Auto-calculate Recipe Costs
              </label>
              <p style={styles.settingDescription}>
                Automatically calculate recipe costs when ingredients are added
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={formData.require_cost_approval}
                  onChange={(e) => setFormData({...formData, require_cost_approval: e.target.checked})}
                  style={styles.checkbox}
                />
                Require Cost Approval
              </label>
              <p style={styles.settingDescription}>
                Require manager approval for cost changes above threshold
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>Cost Rounding Method</label>
              <select
                value={formData.cost_rounding_method}
                onChange={(e) => setFormData({...formData, cost_rounding_method: e.target.value})}
                style={styles.input}
              >
                <option value="round">Round</option>
                <option value="floor">Floor</option>
                <option value="ceil">Ceiling</option>
              </select>
              <p style={styles.settingDescription}>
                How to round calculated costs
              </p>
            </div>
          </div>
        </div>

        {/* Inventory Settings */}
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <AlertTriangle size={20} />
            <h3 style={styles.sectionTitle}>Inventory Settings</h3>
          </div>
          
          <div style={styles.settingsGrid}>
            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={formData.inventory_alerts_enabled}
                  onChange={(e) => setFormData({...formData, inventory_alerts_enabled: e.target.checked})}
                  style={styles.checkbox}
                />
                Enable Inventory Alerts
              </label>
              <p style={styles.settingDescription}>
                Send alerts when inventory levels are low
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>Low Stock Threshold</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.low_stock_threshold}
                onChange={(e) => setFormData({...formData, low_stock_threshold: parseFloat(e.target.value) || 10})}
                style={styles.input}
              />
              <p style={styles.settingDescription}>
                Minimum quantity before low stock alert triggers
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={formData.order_guide_auto_generation}
                  onChange={(e) => setFormData({...formData, order_guide_auto_generation: e.target.checked})}
                  style={styles.checkbox}
                />
                Auto-generate Order Guides
              </label>
              <p style={styles.settingDescription}>
                Automatically generate order guides based on low stock levels
              </p>
            </div>
          </div>
        </div>

        {/* Supplier Settings */}
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <Calculator size={20} />
            <h3 style={styles.sectionTitle}>Supplier & Scaling Settings</h3>
          </div>
          
          <div style={styles.settingsGrid}>
            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={formData.supplier_price_updates_enabled}
                  onChange={(e) => setFormData({...formData, supplier_price_updates_enabled: e.target.checked})}
                  style={styles.checkbox}
                />
                Enable Supplier Price Updates
              </label>
              <p style={styles.settingDescription}>
                Allow automatic updates from supplier pricing data
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>Recipe Scaling Precision</label>
              <input
                type="number"
                min="0"
                max="4"
                value={formData.recipe_scaling_precision}
                onChange={(e) => setFormData({...formData, recipe_scaling_precision: parseInt(e.target.value) || 2})}
                style={styles.input}
              />
              <p style={styles.settingDescription}>
                Decimal places for scaled recipe quantities
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>Default Unit System</label>
              <select
                value={formData.default_unit_system}
                onChange={(e) => setFormData({...formData, default_unit_system: e.target.value})}
                style={styles.input}
              >
                <option value="metric">Metric (kg, g, L, ml)</option>
                <option value="imperial">Imperial (lb, oz, gal, fl oz)</option>
                <option value="mixed">Mixed (both systems)</option>
              </select>
              <p style={styles.settingDescription}>
                Default unit system for new ingredients
              </p>
            </div>

            <div style={styles.settingItem}>
              <label style={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={formData.margin_tier_enabled}
                  onChange={(e) => setFormData({...formData, margin_tier_enabled: e.target.checked})}
                  style={styles.checkbox}
                />
                Enable Margin Tiers
              </label>
              <p style={styles.settingDescription}>
                Use different margin percentages based on recipe categories
              </p>
            </div>

            {formData.margin_tier_enabled && (
              <div style={styles.settingItem}>
                <label style={styles.settingLabel}>Default Margin Tier</label>
                <select
                  value={formData.default_margin_tier}
                  onChange={(e) => setFormData({...formData, default_margin_tier: e.target.value})}
                  style={styles.input}
                >
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="budget">Budget</option>
                </select>
                <p style={styles.settingDescription}>
                  Default margin tier for new recipes
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Save Button */}
        <div style={styles.saveSection}>
          <button 
            type="submit" 
            style={styles.saveButton}
            disabled={saving}
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      <ModuleDeactivationPanel moduleKey="recipe_builder" />
    </div>
  );
};

const styles = {
  container: {
    padding: '20px'
  },
  header: {
    marginBottom: '30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: '16px',
    color: TavariStyles.colors.gray600
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  refreshButton: {
    ...TavariStyles.components.button?.base,
    backgroundColor: TavariStyles.colors.infoBg,
    color: TavariStyles.colors.infoText,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    fontSize: '14px'
  },
  resetButton: {
    ...TavariStyles.components.button?.base,
    backgroundColor: TavariStyles.colors.warningBg,
    color: TavariStyles.colors.warningText,
    padding: '8px 16px',
    fontSize: '14px'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '30px'
  },
  section: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    padding: '24px',
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
    paddingBottom: '12px',
    borderBottom: `2px solid ${TavariStyles.colors.primary}`
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px'
  },
  settingItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  settingLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: TavariStyles.colors.gray700,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer'
  },
  settingDescription: {
    fontSize: '13px',
    color: TavariStyles.colors.gray500,
    marginLeft: '24px',
    lineHeight: '1.4'
  },
  checkbox: {
    width: '16px',
    height: '16px'
  },
  input: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px',
    backgroundColor: TavariStyles.colors.white
  },
  saveSection: {
    display: 'flex',
    justifyContent: 'center',
    padding: '20px 0'
  },
  saveButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '16px 32px',
    fontSize: '16px',
    fontWeight: '600'
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '200px',
    fontSize: '16px',
    color: TavariStyles.colors.gray600
  }
};

export default SettingsTab;

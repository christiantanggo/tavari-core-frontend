// TOSA Module Tiers Manager - Manage pricing tiers for modules
import React, { useState, useEffect } from 'react';
import { FiDollarSign, FiEdit, FiTrash2, FiPlus, FiSave, FiX } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const TOSAModuleTiersManager = ({ onTierUpdate }) => {
  const [tiers, setTiers] = useState([]);
  const [modulePricing, setModulePricing] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingTier, setEditingTier] = useState(null);
  const [editingPricing, setEditingPricing] = useState(null);
  const [showAddTier, setShowAddTier] = useState(false);
  const [showAddPricing, setShowAddPricing] = useState(false);
  const [selectedModule, setSelectedModule] = useState(null);

  useEffect(() => {
    loadTiers();
    loadModules();
    loadModulePricing();
  }, []);

  const loadTiers = async () => {
    try {
      const { data, error } = await supabase
        .from('module_tiers')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setTiers(data || []);
    } catch (err) {
      console.error('Error loading tiers:', err);
      toast.error('Failed to load tiers');
    }
  };

  const loadModules = async () => {
    try {
      const { data, error } = await supabase
        .from('app_modules')
        .select('*')
        .order('module_name', { ascending: true });

      if (error) throw error;
      setModules(data || []);
    } catch (err) {
      console.error('Error loading modules:', err);
    }
  };

  const loadModulePricing = async () => {
    try {
      const { data, error } = await supabase
        .from('module_tier_pricing')
        .select(`
          *,
          app_modules (module_name, module_key),
          module_tiers (tier_name, tier_key)
        `)
        .order('module_key', { ascending: true });

      if (error) throw error;
      setModulePricing(data || []);
    } catch (err) {
      console.error('Error loading module pricing:', err);
    }
  };

  const saveTier = async (tierData) => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('module_tiers')
        .upsert(tierData, { onConflict: 'tier_key' });

      if (error) throw error;
      toast.success('Tier saved successfully');
      setShowAddTier(false);
      setEditingTier(null);
      loadTiers();
      if (onTierUpdate) onTierUpdate();
    } catch (err) {
      console.error('Error saving tier:', err);
      toast.error('Failed to save tier');
    } finally {
      setLoading(false);
    }
  };

  const savePricing = async (pricingData) => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('module_tier_pricing')
        .upsert(pricingData, { onConflict: 'module_key,tier_key' });

      if (error) throw error;
      toast.success('Pricing saved successfully');
      setShowAddPricing(false);
      setEditingPricing(null);
      setSelectedModule(null);
      loadModulePricing();
    } catch (err) {
      console.error('Error saving pricing:', err);
      toast.error('Failed to save pricing');
    } finally {
      setLoading(false);
    }
  };

  const deleteTier = async (tierKey) => {
    if (!confirm('Are you sure you want to delete this tier? This will also delete all associated pricing.')) {
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('module_tiers')
        .delete()
        .eq('tier_key', tierKey);

      if (error) throw error;
      toast.success('Tier deleted successfully');
      loadTiers();
      loadModulePricing();
    } catch (err) {
      console.error('Error deleting tier:', err);
      toast.error('Failed to delete tier');
    } finally {
      setLoading(false);
    }
  };

  const deletePricing = async (id) => {
    if (!confirm('Are you sure you want to delete this pricing?')) {
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('module_tier_pricing')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Pricing deleted successfully');
      loadModulePricing();
    } catch (err) {
      console.error('Error deleting pricing:', err);
      toast.error('Failed to delete pricing');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Tiers Section */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Pricing Tiers</h2>
          <button
            style={styles.addButton}
            onClick={() => {
              setEditingTier(null);
              setShowAddTier(true);
            }}
          >
            <FiPlus /> Add Tier
          </button>
        </div>

        <div style={styles.tiersGrid}>
          {tiers.map(tier => (
            <div key={tier.id} style={styles.tierCard}>
              <div style={styles.tierHeader}>
                <div>
                  <h3 style={styles.tierName}>{tier.tier_name}</h3>
                  <p style={styles.tierKey}>{tier.tier_key}</p>
                </div>
                <div style={styles.tierActions}>
                  <button
                    style={styles.iconButton}
                    onClick={() => {
                      setEditingTier(tier);
                      setShowAddTier(true);
                    }}
                  >
                    <FiEdit />
                  </button>
                  {tier.tier_key !== 'free' && (
                    <button
                      style={{ ...styles.iconButton, color: TavariStyles.colors.danger }}
                      onClick={() => deleteTier(tier.tier_key)}
                    >
                      <FiTrash2 />
                    </button>
                  )}
                </div>
              </div>
              <p style={styles.tierDescription}>{tier.description || 'No description'}</p>
              <div style={styles.tierFooter}>
                <span style={{
                  ...styles.statusBadge,
                  backgroundColor: tier.is_active ? '#10b981' : '#ef4444',
                  color: '#fff'
                }}>
                  {tier.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Module Pricing Section */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Module Pricing by Tier</h2>
          <button
            style={styles.addButton}
            onClick={() => {
              setEditingPricing(null);
              setShowAddPricing(true);
            }}
          >
            <FiPlus /> Add Pricing
          </button>
        </div>

        <div style={styles.pricingTable}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Module</th>
                <th>Tier</th>
                <th>Monthly</th>
                <th>Yearly</th>
                <th>Setup Fee</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {modulePricing.map(pricing => (
                <tr key={pricing.id}>
                  <td>{pricing.app_modules?.module_name || pricing.module_key}</td>
                  <td>{pricing.module_tiers?.tier_name || pricing.tier_key}</td>
                  <td>${parseFloat(pricing.price_monthly || 0).toFixed(2)}</td>
                  <td>${parseFloat(pricing.price_yearly || 0).toFixed(2)}</td>
                  <td>${parseFloat(pricing.setup_fee || 0).toFixed(2)}</td>
                  <td>
                    <span style={{
                      ...styles.statusBadge,
                      backgroundColor: pricing.is_available ? '#10b981' : '#ef4444',
                      color: '#fff',
                      fontSize: 11
                    }}>
                      {pricing.is_available ? 'Available' : 'Unavailable'}
                    </span>
                  </td>
                  <td>
                    <button
                      style={styles.iconButton}
                      onClick={() => {
                        setEditingPricing(pricing);
                        setShowAddPricing(true);
                      }}
                    >
                      <FiEdit />
                    </button>
                    <button
                      style={{ ...styles.iconButton, color: TavariStyles.colors.danger }}
                      onClick={() => deletePricing(pricing.id)}
                    >
                      <FiTrash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Tier Modal */}
      {showAddTier && (
        <TierModal
          tier={editingTier}
          onSave={saveTier}
          onClose={() => {
            setShowAddTier(false);
            setEditingTier(null);
          }}
          loading={loading}
        />
      )}

      {/* Add/Edit Pricing Modal */}
      {showAddPricing && (
        <PricingModal
          pricing={editingPricing}
          modules={modules}
          tiers={tiers}
          onSave={savePricing}
          onClose={() => {
            setShowAddPricing(false);
            setEditingPricing(null);
            setSelectedModule(null);
          }}
          loading={loading}
        />
      )}
    </div>
  );
};

// Tier Modal Component
const TierModal = ({ tier, onSave, onClose, loading }) => {
  const [formData, setFormData] = useState({
    tier_key: tier?.tier_key || '',
    tier_name: tier?.tier_name || '',
    description: tier?.description || '',
    display_order: tier?.display_order || 0,
    is_active: tier?.is_active !== undefined ? tier.is_active : true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>{tier ? 'Edit Tier' : 'Add New Tier'}</h2>
          <button style={modalStyles.closeButton} onClick={onClose}>
            <FiX />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <div style={modalStyles.formGroup}>
            <label>Tier Key (unique identifier)</label>
            <input
              type="text"
              value={formData.tier_key}
              onChange={(e) => setFormData({ ...formData, tier_key: e.target.value })}
              required
              disabled={!!tier}
              style={modalStyles.input}
              placeholder="e.g., starter, professional"
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Tier Name</label>
            <input
              type="text"
              value={formData.tier_name}
              onChange={(e) => setFormData({ ...formData, tier_name: e.target.value })}
              required
              style={modalStyles.input}
              placeholder="e.g., Starter, Professional"
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              style={modalStyles.textarea}
              rows={3}
              placeholder="Describe this tier..."
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Display Order</label>
            <input
              type="number"
              value={formData.display_order}
              onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                style={{ marginRight: 8 }}
              />
              Active
            </label>
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={modalStyles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" style={modalStyles.saveButton} disabled={loading}>
              <FiSave /> {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Pricing Modal Component
const PricingModal = ({ pricing, modules, tiers, onSave, onClose, loading }) => {
  const [formData, setFormData] = useState({
    module_key: pricing?.module_key || '',
    tier_key: pricing?.tier_key || '',
    price_monthly: pricing?.price_monthly || 0,
    price_yearly: pricing?.price_yearly || 0,
    setup_fee: pricing?.setup_fee || 0,
    currency: pricing?.currency || 'CAD',
    is_available: pricing?.is_available !== undefined ? pricing.is_available : true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>{pricing ? 'Edit Pricing' : 'Add Module Pricing'}</h2>
          <button style={modalStyles.closeButton} onClick={onClose}>
            <FiX />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <div style={modalStyles.formGroup}>
            <label>Module</label>
            <select
              value={formData.module_key}
              onChange={(e) => setFormData({ ...formData, module_key: e.target.value })}
              required
              style={modalStyles.input}
            >
              <option value="">Select a module...</option>
              {modules.map(m => (
                <option key={m.module_key} value={m.module_key}>
                  {m.module_name}
                </option>
              ))}
            </select>
          </div>
          <div style={modalStyles.formGroup}>
            <label>Tier</label>
            <select
              value={formData.tier_key}
              onChange={(e) => setFormData({ ...formData, tier_key: e.target.value })}
              required
              style={modalStyles.input}
            >
              <option value="">Select a tier...</option>
              {tiers.map(t => (
                <option key={t.tier_key} value={t.tier_key}>
                  {t.tier_name}
                </option>
              ))}
            </select>
          </div>
          <div style={modalStyles.formRow}>
            <div style={modalStyles.formGroup}>
              <label>Monthly Price (CAD)</label>
              <input
                type="number"
                step="0.01"
                value={formData.price_monthly}
                onChange={(e) => setFormData({ ...formData, price_monthly: parseFloat(e.target.value) || 0 })}
                required
                style={modalStyles.input}
              />
            </div>
            <div style={modalStyles.formGroup}>
              <label>Yearly Price (CAD)</label>
              <input
                type="number"
                step="0.01"
                value={formData.price_yearly}
                onChange={(e) => setFormData({ ...formData, price_yearly: parseFloat(e.target.value) || 0 })}
                required
                style={modalStyles.input}
              />
            </div>
          </div>
          <div style={modalStyles.formGroup}>
            <label>Setup Fee (CAD)</label>
            <input
              type="number"
              step="0.01"
              value={formData.setup_fee}
              onChange={(e) => setFormData({ ...formData, setup_fee: parseFloat(e.target.value) || 0 })}
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>
              <input
                type="checkbox"
                checked={formData.is_available}
                onChange={(e) => setFormData({ ...formData, is_available: e.target.checked })}
                style={{ marginRight: 8 }}
              />
              Available for Purchase
            </label>
          </div>
          <div style={modalStyles.actions}>
            <button type="button" style={modalStyles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" style={modalStyles.saveButton} disabled={loading}>
              <FiSave /> {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xl,
  },
  section: {
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.lg,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.lg,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  },
  tiersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: TavariStyles.spacing.md,
  },
  tierCard: {
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.md,
  },
  tierHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: TavariStyles.spacing.sm,
  },
  tierName: {
    fontSize: 16,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
  },
  tierKey: {
    fontSize: 13,
    color: TavariStyles.colors.gray500,
    fontFamily: 'monospace',
    margin: 0,
  },
  tierActions: {
    display: 'flex',
    gap: 4,
  },
  iconButton: {
    padding: 4,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    fontSize: 16,
  },
  tierDescription: {
    fontSize: 13,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm,
  },
  tierFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  statusBadge: {
    padding: '4px 8px',
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: 11,
    fontWeight: 500,
  },
  pricingTable: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
};

const modalStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: TavariStyles.borderRadius.lg,
    width: '90%',
    maxWidth: 600,
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.lg,
    borderBottom: `1px solid ${TavariStyles.colors.border}`,
  },
  closeButton: {
    padding: 4,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 20,
  },
  form: {
    padding: TavariStyles.spacing.lg,
  },
  formGroup: {
    marginBottom: TavariStyles.spacing.md,
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: TavariStyles.spacing.md,
  },
  input: {
    width: '100%',
    padding: TavariStyles.spacing.sm,
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 14,
  },
  textarea: {
    width: '100%',
    padding: TavariStyles.spacing.sm,
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 14,
    fontFamily: 'inherit',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.lg,
  },
  cancelButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.gray200,
    color: TavariStyles.colors.gray700,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
  },
  saveButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
  },
};

export default TOSAModuleTiersManager;




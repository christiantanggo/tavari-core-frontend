// TOSA Packages Manager - Manage subscription packages
import React, { useState, useEffect } from 'react';
import { FiPackage, FiEdit, FiTrash2, FiPlus, FiSave, FiX, FiCheck } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const TOSAPackagesManager = ({ onPackageUpdate }) => {
  const [packages, setPackages] = useState([]);
  const [modules, setModules] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [showAddPackage, setShowAddPackage] = useState(false);

  useEffect(() => {
    loadPackages();
    loadModules();
    loadTiers();
  }, []);

  const loadPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('subscription_packages')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setPackages(data || []);
    } catch (err) {
      console.error('Error loading packages:', err);
      toast.error('Failed to load packages');
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
    }
  };

  const savePackage = async (packageData) => {
    try {
      setLoading(true);
      // Ensure included_modules is an array
      if (!Array.isArray(packageData.included_modules)) {
        packageData.included_modules = [];
      }
      const { error } = await supabase
        .from('subscription_packages')
        .upsert(packageData, { onConflict: 'package_key' });

      if (error) throw error;
      toast.success('Package saved successfully');
      setShowAddPackage(false);
      setEditingPackage(null);
      loadPackages();
      if (onPackageUpdate) onPackageUpdate();
    } catch (err) {
      console.error('Error saving package:', err);
      toast.error('Failed to save package');
    } finally {
      setLoading(false);
    }
  };

  const deletePackage = async (packageKey) => {
    if (!confirm('Are you sure you want to delete this package?')) {
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('subscription_packages')
        .delete()
        .eq('package_key', packageKey);

      if (error) throw error;
      toast.success('Package deleted successfully');
      loadPackages();
    } catch (err) {
      console.error('Error deleting package:', err);
      toast.error('Failed to delete package');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Subscription Packages</h2>
        <button
          style={styles.addButton}
          onClick={() => {
            setEditingPackage(null);
            setShowAddPackage(true);
          }}
        >
          <FiPlus /> Create Package
        </button>
      </div>

      <div style={styles.packagesGrid}>
        {packages.map(pkg => {
          const includedModules = Array.isArray(pkg.included_modules) 
            ? pkg.included_modules 
            : [];
          const tier = tiers.find(t => t.tier_key === pkg.tier_key);

          return (
            <div key={pkg.id} style={styles.packageCard}>
              <div style={styles.packageHeader}>
                <div>
                  <h3 style={styles.packageName}>{pkg.package_name}</h3>
                  <p style={styles.packageKey}>{pkg.package_key}</p>
                  {tier && (
                    <span style={styles.tierBadge}>{tier.tier_name}</span>
                  )}
                </div>
                <div style={styles.packageActions}>
                  <button
                    style={styles.iconButton}
                    onClick={() => {
                      setEditingPackage(pkg);
                      setShowAddPackage(true);
                    }}
                  >
                    <FiEdit />
                  </button>
                  <button
                    style={{ ...styles.iconButton, color: TavariStyles.colors.danger }}
                    onClick={() => deletePackage(pkg.package_key)}
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </div>
              <p style={styles.packageDescription}>{pkg.description || 'No description'}</p>
              
              <div style={styles.pricingInfo}>
                <div style={styles.priceItem}>
                  <span style={styles.priceLabel}>Monthly:</span>
                  <span style={styles.priceValue}>${parseFloat(pkg.price_monthly || 0).toFixed(2)}</span>
                </div>
                <div style={styles.priceItem}>
                  <span style={styles.priceLabel}>Yearly:</span>
                  <span style={styles.priceValue}>${parseFloat(pkg.price_yearly || 0).toFixed(2)}</span>
                </div>
              </div>

              <div style={styles.modulesSection}>
                <h4 style={styles.modulesTitle}>Included Modules ({includedModules.length})</h4>
                <div style={styles.modulesList}>
                  {includedModules.length > 0 ? (
                    includedModules.map(moduleKey => {
                      const module = modules.find(m => m.module_key === moduleKey);
                      return (
                        <span key={moduleKey} style={styles.moduleTag}>
                          {module?.module_name || moduleKey}
                        </span>
                      );
                    })
                  ) : (
                    <span style={styles.noModules}>No modules included</span>
                  )}
                </div>
              </div>

              <div style={styles.packageFooter}>
                <span style={{
                  ...styles.statusBadge,
                  backgroundColor: pkg.is_active ? '#10b981' : '#ef4444',
                  color: '#fff'
                }}>
                  {pkg.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {packages.length === 0 && (
        <div style={styles.emptyState}>
          <FiPackage size={48} style={{ color: TavariStyles.colors.gray400, marginBottom: 16 }} />
          <p>No packages created yet</p>
          <button
            style={styles.addButton}
            onClick={() => {
              setEditingPackage(null);
              setShowAddPackage(true);
            }}
          >
            <FiPlus /> Create Your First Package
          </button>
        </div>
      )}

      {/* Add/Edit Package Modal */}
      {showAddPackage && (
        <PackageModal
          package={editingPackage}
          modules={modules}
          tiers={tiers}
          onSave={savePackage}
          onClose={() => {
            setShowAddPackage(false);
            setEditingPackage(null);
          }}
          loading={loading}
        />
      )}
    </div>
  );
};

// Package Modal Component
const PackageModal = ({ package: pkg, modules, tiers, onSave, onClose, loading }) => {
  const [formData, setFormData] = useState({
    package_key: pkg?.package_key || '',
    package_name: pkg?.package_name || '',
    description: pkg?.description || '',
    tier_key: pkg?.tier_key || '',
    price_monthly: pkg?.price_monthly || 0,
    price_yearly: pkg?.price_yearly || 0,
    setup_fee: pkg?.setup_fee || 0,
    currency: pkg?.currency || 'CAD',
    included_modules: Array.isArray(pkg?.included_modules) ? pkg.included_modules : [],
    is_active: pkg?.is_active !== undefined ? pkg.is_active : true,
    display_order: pkg?.display_order || 0
  });

  const toggleModule = (moduleKey) => {
    const current = formData.included_modules || [];
    if (current.includes(moduleKey)) {
      setFormData({
        ...formData,
        included_modules: current.filter(k => k !== moduleKey)
      });
    } else {
      setFormData({
        ...formData,
        included_modules: [...current, moduleKey]
      });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>{pkg ? 'Edit Package' : 'Create New Package'}</h2>
          <button style={modalStyles.closeButton} onClick={onClose}>
            <FiX />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <div style={modalStyles.formGroup}>
            <label>Package Key (unique identifier)</label>
            <input
              type="text"
              value={formData.package_key}
              onChange={(e) => setFormData({ ...formData, package_key: e.target.value })}
              required
              disabled={!!pkg}
              style={modalStyles.input}
              placeholder="e.g., starter_package, professional_suite"
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Package Name</label>
            <input
              type="text"
              value={formData.package_name}
              onChange={(e) => setFormData({ ...formData, package_name: e.target.value })}
              required
              style={modalStyles.input}
              placeholder="e.g., Starter Package, Professional Suite"
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              style={modalStyles.textarea}
              rows={3}
              placeholder="Describe this package..."
            />
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
            <label>Display Order</label>
            <input
              type="number"
              value={formData.display_order}
              onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Included Modules</label>
            <div style={modalStyles.modulesChecklist}>
              {modules.map(module => {
                const isSelected = (formData.included_modules || []).includes(module.module_key);
                return (
                  <label
                    key={module.module_key}
                    style={{
                      ...modalStyles.moduleCheckbox,
                      backgroundColor: isSelected ? TavariStyles.colors.primary + '20' : 'transparent'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleModule(module.module_key)}
                      style={{ marginRight: 8 }}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>{module.module_name}</div>
                      <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                        {module.module_category}
                      </div>
                    </div>
                    {isSelected && <FiCheck style={{ color: TavariStyles.colors.primary }} />}
                  </label>
                );
              })}
            </div>
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

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.lg,
  },
  title: {
    fontSize: 24,
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
  packagesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: TavariStyles.spacing.lg,
  },
  packageCard: {
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: TavariStyles.spacing.lg,
  },
  packageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: TavariStyles.spacing.md,
  },
  packageName: {
    fontSize: 20,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
    marginBottom: 4,
  },
  packageKey: {
    fontSize: 13,
    color: TavariStyles.colors.gray500,
    fontFamily: 'monospace',
    margin: 0,
  },
  tierBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    backgroundColor: TavariStyles.colors.primary + '20',
    color: TavariStyles.colors.primary,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: 11,
    fontWeight: 500,
    marginTop: 4,
  },
  packageActions: {
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
  packageDescription: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.md,
  },
  pricingInfo: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
  },
  priceItem: {
    display: 'flex',
    flexDirection: 'column',
  },
  priceLabel: {
    fontSize: 13,
    color: TavariStyles.colors.gray600,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
  },
  modulesSection: {
    marginBottom: TavariStyles.spacing.md,
  },
  modulesTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm,
  },
  modulesList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.xs,
  },
  moduleTag: {
    display: 'inline-block',
    padding: '4px 8px',
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.gray700,
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: 13,
  },
  noModules: {
    fontSize: 13,
    color: TavariStyles.colors.gray500,
    fontStyle: 'italic',
  },
  packageFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    paddingTop: TavariStyles.spacing.md,
    borderTop: `1px solid ${TavariStyles.colors.border}`,
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 13,
    fontWeight: 500,
  },
  emptyState: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xxl,
    color: TavariStyles.colors.gray600,
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
    maxWidth: 700,
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
  modulesChecklist: {
    maxHeight: 300,
    overflowY: 'auto',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.sm,
  },
  moduleCheckbox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.xs,
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    border: `1px solid ${TavariStyles.colors.border}`,
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

export default TOSAPackagesManager;




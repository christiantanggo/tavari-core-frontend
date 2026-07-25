// TOSA Business Subscriptions Manager - Manage business subscriptions
import React, { useState, useEffect } from 'react';
import { FiUsers, FiEdit, FiTrash2, FiPlus, FiSave, FiX, FiPackage, FiDollarSign } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const TOSABusinessSubscriptionsManager = () => {
  const [subscriptions, setSubscriptions] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [modules, setModules] = useState([]);
  const [packages, setPackages] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState(null);
  const [showAddSubscription, setShowAddSubscription] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    loadSubscriptions();
    loadBusinesses();
    loadModules();
    loadPackages();
    loadTiers();
  }, []);

  const loadSubscriptions = async () => {
    try {
      const { data, error } = await supabase
        .from('business_subscriptions')
        .select(`
          *,
          businesses (id, name, business_email),
          module_tiers (tier_name, tier_key)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSubscriptions(data || []);
    } catch (err) {
      console.error('Error loading subscriptions:', err);
      toast.error('Failed to load subscriptions');
    }
  };

  const loadBusinesses = async () => {
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, business_email')
        .order('name', { ascending: true });

      if (error) throw error;
      setBusinesses(data || []);
    } catch (err) {
      console.error('Error loading businesses:', err);
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

  const loadPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('subscription_packages')
        .select('*')
        .eq('is_active', true)
        .order('package_name', { ascending: true });

      if (error) throw error;
      setPackages(data || []);
    } catch (err) {
      console.error('Error loading packages:', err);
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

  const saveSubscription = async (subscriptionData) => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('business_subscriptions')
        .upsert(subscriptionData, { 
          onConflict: 'business_id,subscription_type,subscription_key' 
        });

      if (error) throw error;
      toast.success('Subscription saved successfully');
      setShowAddSubscription(false);
      setEditingSubscription(null);
      setSelectedBusiness(null);
      loadSubscriptions();
    } catch (err) {
      console.error('Error saving subscription:', err);
      toast.error('Failed to save subscription');
    } finally {
      setLoading(false);
    }
  };

  const deleteSubscription = async (id) => {
    if (!confirm('Are you sure you want to delete this subscription?')) {
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('business_subscriptions')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Subscription deleted successfully');
      loadSubscriptions();
    } catch (err) {
      console.error('Error deleting subscription:', err);
      toast.error('Failed to delete subscription');
    } finally {
      setLoading(false);
    }
  };

  const cancelSubscription = async (id) => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('business_subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;
      toast.success('Subscription cancelled successfully');
      loadSubscriptions();
    } catch (err) {
      console.error('Error cancelling subscription:', err);
      toast.error('Failed to cancel subscription');
    } finally {
      setLoading(false);
    }
  };

  const filteredSubscriptions = subscriptions.filter(sub => {
    if (filterStatus !== 'all' && sub.status !== filterStatus) return false;
    if (selectedBusiness && sub.business_id !== selectedBusiness) return false;
    return true;
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Business Subscriptions</h2>
        <button
          style={styles.addButton}
          onClick={() => {
            setEditingSubscription(null);
            setShowAddSubscription(true);
          }}
        >
          <FiPlus /> Assign Subscription
        </button>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <div style={styles.filterGroup}>
          <label>Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <div style={styles.filterGroup}>
          <label>Business:</label>
          <select
            value={selectedBusiness || ''}
            onChange={(e) => setSelectedBusiness(e.target.value || null)}
            style={styles.filterSelect}
          >
            <option value="">All Businesses</option>
            {businesses.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Subscriptions Table */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>Business</th>
              <th>Type</th>
              <th>Subscription</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Billing</th>
              <th>Price</th>
              <th>Started</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSubscriptions.map(sub => {
              const subscriptionName = sub.subscription_type === 'module'
                ? modules.find(m => m.module_key === sub.subscription_key)?.module_name || sub.subscription_key
                : packages.find(p => p.package_key === sub.subscription_key)?.package_name || sub.subscription_key;

              return (
                <tr key={sub.id}>
                  <td>
                    <div>
                      <div style={{ fontWeight: 500 }}>{sub.businesses?.name || 'Unknown'}</div>
                      <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                        {sub.businesses?.business_email || ''}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{
                      ...styles.typeBadge,
                      backgroundColor: sub.subscription_type === 'package' 
                        ? TavariStyles.colors.primary + '20' 
                        : TavariStyles.colors.success + '20',
                      color: sub.subscription_type === 'package' 
                        ? TavariStyles.colors.primary 
                        : TavariStyles.colors.success
                    }}>
                      {sub.subscription_type === 'package' ? 'Package' : 'Module'}
                    </span>
                  </td>
                  <td>{subscriptionName}</td>
                  <td>{sub.module_tiers?.tier_name || sub.tier_key}</td>
                  <td>
                    <span style={{
                      ...styles.statusBadge,
                      backgroundColor: getStatusColor(sub.status),
                      color: '#fff'
                    }}>
                      {sub.status}
                    </span>
                  </td>
                  <td>{sub.billing_cycle}</td>
                  <td>${parseFloat(sub.price || 0).toFixed(2)} {sub.currency}</td>
                  <td>{new Date(sub.started_at).toLocaleDateString()}</td>
                  <td>
                    <div style={styles.actions}>
                      <button
                        style={styles.iconButton}
                        onClick={() => {
                          setEditingSubscription(sub);
                          setShowAddSubscription(true);
                        }}
                      >
                        <FiEdit />
                      </button>
                      {sub.status === 'active' && (
                        <button
                          style={{ ...styles.iconButton, color: TavariStyles.colors.warning }}
                          onClick={() => cancelSubscription(sub.id)}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        style={{ ...styles.iconButton, color: TavariStyles.colors.danger }}
                        onClick={() => deleteSubscription(sub.id)}
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredSubscriptions.length === 0 && (
        <div style={styles.emptyState}>
          <FiPackage size={48} style={{ color: TavariStyles.colors.gray400, marginBottom: 16 }} />
          <p>No subscriptions found</p>
        </div>
      )}

      {/* Add/Edit Subscription Modal */}
      {showAddSubscription && (
        <SubscriptionModal
          subscription={editingSubscription}
          businesses={businesses}
          modules={modules}
          packages={packages}
          tiers={tiers}
          onSave={saveSubscription}
          onClose={() => {
            setShowAddSubscription(false);
            setEditingSubscription(null);
            setSelectedBusiness(null);
          }}
          loading={loading}
        />
      )}
    </div>
  );
};

const getStatusColor = (status) => {
  switch (status) {
    case 'active': return '#10b981';
    case 'trial': return '#3b82f6';
    case 'expired': return '#ef4444';
    case 'cancelled': return '#6b7280';
    case 'pending': return '#f59e0b';
    default: return '#6b7280';
  }
};

// Subscription Modal Component
const SubscriptionModal = ({ subscription, businesses, modules, packages, tiers, onSave, onClose, loading }) => {
  const [formData, setFormData] = useState({
    business_id: subscription?.business_id || '',
    subscription_type: subscription?.subscription_type || 'module',
    subscription_key: subscription?.subscription_key || '',
    tier_key: subscription?.tier_key || '',
    status: subscription?.status || 'active',
    billing_cycle: subscription?.billing_cycle || 'monthly',
    price: subscription?.price || 0,
    currency: subscription?.currency || 'CAD',
    auto_renew: subscription?.auto_renew !== undefined ? subscription.auto_renew : true,
    trial_ends_at: subscription?.trial_ends_at || '',
    expires_at: subscription?.expires_at || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const availableOptions = formData.subscription_type === 'module' ? modules : packages;

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>{subscription ? 'Edit Subscription' : 'Assign Subscription'}</h2>
          <button style={modalStyles.closeButton} onClick={onClose}>
            <FiX />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <div style={modalStyles.formGroup}>
            <label>Business</label>
            <select
              value={formData.business_id}
              onChange={(e) => setFormData({ ...formData, business_id: e.target.value })}
              required
              style={modalStyles.input}
            >
              <option value="">Select a business...</option>
              {businesses.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div style={modalStyles.formGroup}>
            <label>Subscription Type</label>
            <select
              value={formData.subscription_type}
              onChange={(e) => setFormData({ 
                ...formData, 
                subscription_type: e.target.value,
                subscription_key: '' // Reset when type changes
              })}
              required
              style={modalStyles.input}
            >
              <option value="module">Individual Module</option>
              <option value="package">Package</option>
            </select>
          </div>
          <div style={modalStyles.formGroup}>
            <label>{formData.subscription_type === 'module' ? 'Module' : 'Package'}</label>
            <select
              value={formData.subscription_key}
              onChange={(e) => setFormData({ ...formData, subscription_key: e.target.value })}
              required
              style={modalStyles.input}
            >
              <option value="">Select {formData.subscription_type === 'module' ? 'module' : 'package'}...</option>
              {availableOptions.map(option => (
                <option key={option.module_key || option.package_key} value={option.module_key || option.package_key}>
                  {option.module_name || option.package_name}
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
              <label>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                required
                style={modalStyles.input}
              >
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="pending">Pending</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div style={modalStyles.formGroup}>
              <label>Billing Cycle</label>
              <select
                value={formData.billing_cycle}
                onChange={(e) => setFormData({ ...formData, billing_cycle: e.target.value })}
                required
                style={modalStyles.input}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          <div style={modalStyles.formGroup}>
            <label>Price ({formData.currency})</label>
            <input
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
              required
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formRow}>
            <div style={modalStyles.formGroup}>
              <label>Trial Ends At (optional)</label>
              <input
                type="datetime-local"
                value={formData.trial_ends_at ? new Date(formData.trial_ends_at).toISOString().slice(0, 16) : ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  trial_ends_at: e.target.value ? new Date(e.target.value).toISOString() : '' 
                })}
                style={modalStyles.input}
              />
            </div>
            <div style={modalStyles.formGroup}>
              <label>Expires At (optional)</label>
              <input
                type="datetime-local"
                value={formData.expires_at ? new Date(formData.expires_at).toISOString().slice(0, 16) : ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  expires_at: e.target.value ? new Date(e.target.value).toISOString() : '' 
                })}
                style={modalStyles.input}
              />
            </div>
          </div>
          <div style={modalStyles.formGroup}>
            <label>
              <input
                type="checkbox"
                checked={formData.auto_renew}
                onChange={(e) => setFormData({ ...formData, auto_renew: e.target.checked })}
                style={{ marginRight: 8 }}
              />
              Auto Renew
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
    marginBottom: TavariStyles.spacing.md,
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
  filters: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.md,
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
  },
  filterSelect: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 14,
  },
  tableContainer: {
    backgroundColor: '#fff',
    border: `1px solid ${TavariStyles.colors.border}`,
    borderRadius: TavariStyles.borderRadius.lg,
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  typeBadge: {
    padding: '4px 8px',
    borderRadius: TavariStyles.borderRadius.sm,
    fontSize: 11,
    fontWeight: 500,
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: 11,
    fontWeight: 500,
  },
  actions: {
    display: 'flex',
    gap: 4,
  },
  iconButton: {
    padding: 4,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    fontSize: 14,
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

export default TOSABusinessSubscriptionsManager;


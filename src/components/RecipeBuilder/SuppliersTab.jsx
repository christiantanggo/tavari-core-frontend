// src/components/RecipeBuilder/SuppliersTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, Phone, Mail, MapPin, Star, Clock, DollarSign, Tag } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';
import SupplierIngredientPricingModal from './SupplierIngredientPricingModal';

const isSyscoSupplier = (data) => /sysco/i.test(data?.name || '') || /sysco/i.test(data?.website_url || '');

const buildScrapingConfig = (formData) => {
  if (!formData.scraping_enabled || !isSyscoSupplier(formData)) {
    return formData.scraping_config || null;
  }
  const existing = formData.scraping_config || {};
  return {
    browserType: 'sysco',
    loginEmail: formData.sysco_login_email || existing.loginEmail || '',
    loginPassword: formData.sysco_login_password || existing.loginPassword || '',
  };
};

const SuppliersTab = ({ businessId }) => {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierPrices, setSupplierPrices] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [pricingSupplier, setPricingSupplier] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    supplier_code: '',
    website_url: '',
    scraping_enabled: false,
    scraping_config: null,
    delivery_days: [],
    minimum_order: 0,
    delivery_fee: 0,
    payment_terms: '',
    kickback_percentage: 0,
    preferred_supplier: false,
    is_active: true,
    sysco_login_email: '',
    sysco_login_password: '',
  });

  useEffect(() => {
    if (businessId) {
      fetchData();
    }
  }, [businessId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch suppliers
      const { data: suppliersData, error: suppliersError } = await supabase
        .from('rb_suppliers')
        .select('*')
        .eq('business_id', businessId)
        .order('name');

      if (suppliersError) throw suppliersError;

      // Fetch ingredients for price management
      const { data: ingredientsData, error: ingredientsError } = await supabase
        .from('ingredients')
        .select('id, name, unit_of_measure')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name');

      if (ingredientsError) throw ingredientsError;

      // Fetch supplier prices separately (only if we have suppliers)
      let pricesData = [];
      if (suppliersData && suppliersData.length > 0) {
        const supplierIds = suppliersData.map(s => s.id);
        const { data: prices, error: pricesError } = await supabase
          .from('rb_supplier_prices')
          .select('*')
          .in('supplier_id', supplierIds);
        
        if (pricesError) throw pricesError;
        pricesData = prices || [];
      }

      // Enrich suppliers with prices and ingredient names
      const enrichedSuppliers = suppliersData.map(supplier => ({
        ...supplier,
        rb_supplier_prices: pricesData.filter(price => price.supplier_id === supplier.id).map(price => {
          const ingredient = price.inventory_id 
            ? ingredientsData?.find(ing => ing.id === price.inventory_id)
            : null;
          return {
            ...price,
            ingredient_name: ingredient?.name || null
          };
        })
      }));

      setSuppliers(enrichedSuppliers);
      setIngredients(ingredientsData || []);
    } catch (error) {
      console.error('Error fetching suppliers data:', error);
      toast.error('Failed to load suppliers data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSupplier = () => {
    setEditingSupplier(null);
    setFormData({
      name: '',
      contact_name: '',
      phone: '',
      email: '',
      address: '',
      supplier_code: '',
      website_url: '',
      scraping_enabled: false,
      scraping_config: null,
      delivery_days: [],
      minimum_order: 0,
      delivery_fee: 0,
      payment_terms: '',
      kickback_percentage: 0,
      preferred_supplier: false,
      is_active: true,
      sysco_login_email: '',
      sysco_login_password: '',
    });
    setShowModal(true);
  };

  const handleEditSupplier = (supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name || '',
      contact_name: supplier.contact_name || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      supplier_code: supplier.supplier_code || '',
      website_url: supplier.website_url || '',
      scraping_enabled: supplier.scraping_enabled || false,
      scraping_config: supplier.scraping_config || null,
      delivery_days: supplier.delivery_days || [],
      minimum_order: supplier.minimum_order || 0,
      delivery_fee: supplier.delivery_fee || 0,
      payment_terms: supplier.payment_terms || '',
      kickback_percentage: supplier.kickback_percentage || 0,
      preferred_supplier: supplier.preferred_supplier || false,
      is_active: supplier.is_active,
      sysco_login_email: supplier.scraping_config?.loginEmail || '',
      sysco_login_password: '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { sysco_login_email, sysco_login_password, ...rest } = formData;
      const payload = {
        ...rest,
        scraping_config: buildScrapingConfig(formData),
        updated_at: new Date().toISOString(),
      };
      delete payload.sysco_login_email;
      delete payload.sysco_login_password;

      if (editingSupplier) {
        const { error } = await supabase
          .from('rb_suppliers')
          .update(payload)
          .eq('id', editingSupplier.id);

        if (error) throw error;
        toast.success('Supplier updated successfully');
      } else {
        const { data, error } = await supabase
          .from('rb_suppliers')
          .insert({
            ...payload,
            business_id: businessId,
          })
          .select('*')
          .single();

        if (error) throw error;
        toast.success('Supplier created — set ingredient prices next');
        setShowModal(false);
        setEditingSupplier(null);
        await fetchData();
        if (data) setPricingSupplier(data);
        return;
      }

      setShowModal(false);
      setEditingSupplier(null);
      fetchData();
    } catch (error) {
      console.error('Error saving supplier:', error);
      toast.error('Failed to save supplier');
    }
  };

  const handleDeleteSupplier = async (supplier) => {
    if (!window.confirm(`Are you sure you want to delete ${supplier.name}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('rb_suppliers')
        .delete()
        .eq('id', supplier.id);

      if (error) throw error;
      toast.success('Supplier deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting supplier:', error);
      toast.error('Failed to delete supplier');
    }
  };

  const getSupplierStats = (supplier) => {
    const prices = supplier.rb_supplier_prices || [];
    const activePrices = prices.filter(p => p.is_current);
    const avgPrice = activePrices.length > 0 
      ? activePrices.reduce((sum, p) => sum + p.price_per_unit, 0) / activePrices.length 
      : 0;
    
    return {
      totalPrices: prices.length,
      activePrices: activePrices.length,
      avgPrice: avgPrice
    };
  };

  if (loading) {
    return <div style={styles.loading}>Loading suppliers...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Supplier Management</h2>
          <p style={styles.subtitle}>Manage your ingredient suppliers and pricing</p>
        </div>
        <button onClick={handleAddSupplier} style={styles.addButton}>
          <Plus size={16} />
          Add Supplier
        </button>
      </div>

      {/* Suppliers Grid */}
      <div style={styles.suppliersGrid}>
        {suppliers.length === 0 ? (
          <div style={styles.emptyState}>
            <h3>No suppliers found</h3>
            <p>Add your first supplier to start managing ingredient costs and sourcing.</p>
            <button onClick={handleAddSupplier} style={styles.addButton}>
              <Plus size={16} />
              Add Your First Supplier
            </button>
          </div>
        ) : (
          suppliers.map((supplier) => {
            const stats = getSupplierStats(supplier);
            return (
              <div key={supplier.id} style={styles.supplierCard}>
                <div style={styles.supplierHeader}>
                  <div style={styles.supplierInfo}>
                    <h3 style={styles.supplierName}>{supplier.name}</h3>
                    <div style={styles.supplierStatus}>
                      <div style={{
                        ...styles.statusBadge,
                        backgroundColor: supplier.is_active ? TavariStyles.colors.successBg : TavariStyles.colors.gray200,
                        color: supplier.is_active ? TavariStyles.colors.success : TavariStyles.colors.gray600
                      }}>
                        {supplier.is_active ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  </div>
                  <div style={styles.supplierActions}>
                    <button
                      onClick={() => setPricingSupplier(supplier)}
                      style={styles.actionButton}
                      title="Set ingredient prices"
                    >
                      <Tag size={16} />
                    </button>
                    <button
                      onClick={() => handleEditSupplier(supplier)}
                      style={styles.actionButton}
                      title="Edit supplier"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteSupplier(supplier)}
                      style={{...styles.actionButton, color: TavariStyles.colors.error}}
                      title="Delete supplier"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div style={styles.supplierDetails}>
                  {supplier.contact_name && (
                    <div style={styles.detailItem}>
                      <strong>Contact:</strong> {supplier.contact_name}
                    </div>
                  )}
                  {supplier.phone && (
                    <div style={styles.detailItem}>
                      <Phone size={14} />
                      {supplier.phone}
                    </div>
                  )}
                  {supplier.email && (
                    <div style={styles.detailItem}>
                      <Mail size={14} />
                      {supplier.email}
                    </div>
                  )}
                  {(supplier.address || supplier.city) && (
                    <div style={styles.detailItem}>
                      <MapPin size={14} />
                      {[supplier.address, supplier.city, supplier.state].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setPricingSupplier(supplier)}
                  style={styles.pricingButton}
                >
                  <Tag size={14} />
                  Set ingredient prices
                </button>

                <div style={styles.supplierStats}>
                  <div style={styles.statItem}>
                    <Clock size={16} />
                    <span>{supplier.delivery_time_days || 0} days</span>
                  </div>
                  <div style={styles.statItem}>
                    <DollarSign size={16} />
                    <span>${supplier.minimum_order_amount || 0}</span>
                  </div>
                  <div style={styles.statItem}>
                    <Star size={16} />
                    <span>{stats.activePrices} prices</span>
                  </div>
                </div>

                {supplier.notes && (
                  <div style={styles.supplierNotes}>
                    <strong>Notes:</strong> {supplier.notes}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Supplier Modal */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}
            </h3>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Supplier Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    style={styles.input}
                    required
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Contact Name</label>
                  <input
                    type="text"
                    value={formData.contact_name}
                    onChange={(e) => setFormData({...formData, contact_name: e.target.value})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Supplier Code</label>
                  <input
                    type="text"
                    value={formData.supplier_code}
                    onChange={(e) => setFormData({...formData, supplier_code: e.target.value})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Website URL</label>
                  <input
                    type="url"
                    value={formData.website_url}
                    onChange={(e) => setFormData({...formData, website_url: e.target.value})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Payment Terms</label>
                  <input
                    type="text"
                    value={formData.payment_terms}
                    onChange={(e) => setFormData({...formData, payment_terms: e.target.value})}
                    style={styles.input}
                    placeholder="e.g., Net 30, COD, etc."
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Minimum Order ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.minimum_order}
                    onChange={(e) => setFormData({...formData, minimum_order: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Delivery Fee ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.delivery_fee}
                    onChange={(e) => setFormData({...formData, delivery_fee: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Kickback Percentage</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={formData.kickback_percentage}
                    onChange={(e) => setFormData({...formData, kickback_percentage: parseFloat(e.target.value) || 0})}
                    style={styles.input}
                  />
                </div>
              </div>

              <TavariCheckbox
                checked={formData.is_active}
                onChange={(checked) => setFormData({ ...formData, is_active: checked })}
                label="Active Supplier"
                size="sm"
              />

              <TavariCheckbox
                checked={formData.preferred_supplier}
                onChange={(checked) => setFormData({ ...formData, preferred_supplier: checked })}
                label="Preferred Supplier"
                size="sm"
              />

              <TavariCheckbox
                checked={formData.scraping_enabled}
                onChange={(checked) => setFormData({ ...formData, scraping_enabled: checked })}
                label="Enable Price Scraping"
                size="sm"
              />

              {formData.scraping_enabled && isSyscoSupplier(formData) && (
                <div style={styles.syscoLoginBox}>
                  <p style={styles.syscoLoginHint}>
                    Sysco prices require a logged-in browser. Save your shop login here, or set
                    {' '}
                    <code>SYSCO_EMAIL</code>
                    {' '}
                    and
                    {' '}
                    <code>SYSCO_PASSWORD</code>
                    {' '}
                    in
                    {' '}
                    <code>.env.local</code>
                    .
                  </p>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Sysco Shop Email</label>
                    <input
                      type="email"
                      value={formData.sysco_login_email}
                      onChange={(e) => setFormData({ ...formData, sysco_login_email: e.target.value })}
                      style={styles.input}
                      placeholder="you@business.ca"
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Sysco Shop Password</label>
                    <input
                      type="password"
                      value={formData.sysco_login_password}
                      onChange={(e) => setFormData({ ...formData, sysco_login_password: e.target.value })}
                      style={styles.input}
                      placeholder={editingSupplier ? 'Leave blank to keep saved password' : ''}
                    />
                  </div>
                </div>
              )}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.saveButton}>
                  {editingSupplier ? 'Update Supplier' : 'Add Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pricingSupplier && (
        <SupplierIngredientPricingModal
          businessId={businessId}
          supplier={pricingSupplier}
          onClose={() => setPricingSupplier(null)}
          onSaved={fetchData}
        />
      )}
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
  addButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    fontSize: '14px'
  },
  suppliersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '20px'
  },
  supplierCard: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    padding: '20px',
    boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    transition: 'transform 0.2s ease, box-shadow 0.2s ease'
  },
  supplierHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  supplierInfo: {
    flex: 1
  },
  supplierName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    marginBottom: '8px'
  },
  supplierStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  statusBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '500'
  },
  supplierActions: {
    display: 'flex',
    gap: '8px'
  },
  actionButton: {
    backgroundColor: 'transparent',
    border: 'none',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s ease'
  },
  supplierDetails: {
    marginBottom: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  pricingButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    marginBottom: '16px',
    padding: '10px 14px',
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.primary}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  detailItem: {
    fontSize: '14px',
    color: TavariStyles.colors.gray700,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  supplierStats: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px'
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '14px',
    color: TavariStyles.colors.gray600
  },
  supplierNotes: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600,
    fontStyle: 'italic',
    padding: '12px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    borderLeft: `4px solid ${TavariStyles.colors.primary}`
  },
  emptyState: {
    gridColumn: '1 / -1',
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '12px',
    border: `2px dashed ${TavariStyles.colors.gray300}`
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: '12px',
    padding: '24px',
    width: '90%',
    maxWidth: '1000px',
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    marginBottom: '20px',
    color: TavariStyles.colors.gray800
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    color: TavariStyles.colors.gray700
  },
  input: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px'
  },
  textarea: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px',
    resize: 'vertical'
  },
  syscoLoginBox: {
    marginTop: '8px',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: TavariStyles.colors.gray50,
    border: `1px solid ${TavariStyles.colors.gray200}`,
  },
  syscoLoginHint: {
    fontSize: '13px',
    color: TavariStyles.colors.gray600,
    marginBottom: '12px',
    lineHeight: 1.4,
  },
  modalActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '20px',
    paddingTop: '20px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`
  },
  cancelButton: {
    padding: '12px 24px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray700,
    cursor: 'pointer',
    fontSize: '14px'
  },
  saveButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    padding: '12px 24px',
    fontSize: '14px'
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

export default SuppliersTab;

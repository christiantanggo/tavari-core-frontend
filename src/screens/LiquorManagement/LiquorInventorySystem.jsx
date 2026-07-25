// src/screens/LiquorManagement/LiquorInventorySystem.jsx
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { FiCamera, FiPlus, FiTrash2, FiCheckCircle, FiDownload, FiPackage, FiAlertTriangle, FiRefreshCw, FiSettings } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import ModuleSettingsTabContent from '../../components/Modules/ModuleSettingsTabContent';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const LiquorInventorySystem = () => {
  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'admin', 'owner'],
    requireBusiness: true,
    componentName: 'LiquorInventorySystem'
  });

  // State management
  const [activeTab, setActiveTab] = useState('inventory');
  const [products, setProducts] = useState([]);
  const [variances, setVariances] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [loading, setLoading] = useState(false);

  // Load products on mount
  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadLiquorProducts();
    }
  }, [auth.selectedBusinessId]);

  // Calculate variances whenever products change
  useEffect(() => {
    calculateVariances();
  }, [products]);

  // Load liquor products from database
  const loadLiquorProducts = async () => {
    if (!auth.selectedBusinessId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_liquor_item', true)
        .order('name', { ascending: true });

      if (error) throw error;

      // Transform database items to include weight tracking fields
      const transformedData = (data || []).map(item => ({
        id: item.id,
        barcode: item.barcode || '',
        name: item.name,
        category: item.category_id || 'Spirits',
        expectedWeight: item.stock_quantity || 0, // Use stock_quantity as expected weight
        currentWeight: item.stock_quantity || 0,
        lastUpdated: item.updated_at ? new Date(item.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
      }));

      setProducts(transformedData);
      toast.success(`Loaded ${transformedData.length} liquor items`);
    } catch (err) {
      console.error('Error loading liquor products:', err);
      toast.error('Error loading liquor inventory: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Calculate variances
  const calculateVariances = () => {
    const newVariances = products.map(p => ({
      id: p.id,
      name: p.name,
      barcode: p.barcode,
      expected: p.expectedWeight,
      actual: p.currentWeight,
      variance: p.currentWeight - p.expectedWeight,
      variancePercent: p.expectedWeight > 0 
        ? ((p.currentWeight - p.expectedWeight) / p.expectedWeight * 100).toFixed(2)
        : '0.00',
      status: 'pending',
      date: p.lastUpdated
    })).filter(v => v.variance !== 0);
    
    setVariances(newVariances);
  };

  // Handle barcode scan
  const handleScan = () => {
    if (!scanInput.trim()) {
      toast.error('Please enter a barcode');
      return;
    }

    const product = products.find(p => p.barcode === scanInput.trim());
    if (product) {
      setSelectedProduct(product);
      toast.success(`Product found: ${product.name}`);
    } else {
      toast.error('Product not found. Make sure the item is marked as a liquor item in inventory.');
      setSelectedProduct(null);
    }
  };

  // Handle weight update
  const handleWeightUpdate = async () => {
    if (!selectedProduct) {
      toast.error('No product selected');
      return;
    }

    if (!weightInput || parseFloat(weightInput) < 0) {
      toast.error('Please enter a valid weight (0 or greater)');
      return;
    }

    const weight = parseFloat(weightInput);
    
    try {
      // Update in database
      const { error } = await supabase
        .from('pos_inventory')
        .update({
          stock_quantity: weight,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedProduct.id);

      if (error) throw error;

      // Update local state
      setProducts(products.map(p => 
        p.id === selectedProduct.id 
          ? { ...p, currentWeight: weight, lastUpdated: new Date().toISOString().split('T')[0] }
          : p
      ));
      
      toast.success('Weight updated successfully');
      setScanInput('');
      setWeightInput('');
      setSelectedProduct(null);
    } catch (err) {
      console.error('Error updating weight:', err);
      toast.error('Error updating weight: ' + err.message);
    }
  };

  // Approve variance
  const approveVariance = async (id) => {
    const variance = variances.find(v => v.id === id);
    if (!variance) return;

    const product = products.find(p => p.id === id);
    if (!product) return;

    try {
      // Update expected weight to match current weight
      const { error } = await supabase
        .from('pos_inventory')
        .update({
          stock_quantity: product.currentWeight,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;

      // Update local state
      setProducts(products.map(p => 
        p.id === id 
          ? { ...p, expectedWeight: p.currentWeight }
          : p
      ));

      toast.success('Variance approved and expected weight updated');
    } catch (err) {
      console.error('Error approving variance:', err);
      toast.error('Error approving variance: ' + err.message);
    }
  };

  // Delete product
  const deleteProduct = async (id) => {
    const product = products.find(p => p.id === id);
    if (!window.confirm(`Are you sure you want to remove "${product?.name}" from liquor tracking?\n\nNote: This will only unmark it as a liquor item, not delete it from inventory.`)) {
      return;
    }

    try {
      // Don't delete the item, just unmark it as liquor
      const { error } = await supabase
        .from('pos_inventory')
        .update({ is_liquor_item: false })
        .eq('id', id);

      if (error) throw error;

      setProducts(products.filter(p => p.id !== id));
      toast.success('Item removed from liquor tracking');
    } catch (err) {
      console.error('Error removing item:', err);
      toast.error('Error removing item: ' + err.message);
    }
  };

  // Export report to CSV
  const exportReport = () => {
    if (variances.length === 0) {
      toast.error('No variance data to export');
      return;
    }

    const csvContent = [
      ['Product', 'Barcode', 'Expected Weight (g)', 'Actual Weight (g)', 'Variance (g)', 'Variance %', 'Status', 'Date'],
      ...variances.map(v => [
        v.name,
        v.barcode,
        v.expected,
        v.actual,
        v.variance,
        v.variancePercent + '%',
        v.status,
        v.date
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liquor-shrink-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Report exported successfully');
  };

  const tabs = [
    { id: 'inventory', label: 'Inventory Scan', icon: FiCamera },
    { id: 'products', label: 'Product Management', icon: FiPackage },
    { id: 'variances', label: 'Variance Review', icon: FiAlertTriangle },
    { id: 'reports', label: 'Reports', icon: FiDownload },
    { id: 'settings', label: 'Settings', icon: FiSettings }
  ];

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'inventory':
        return renderInventoryTab();
      case 'products':
        return renderProductsTab();
      case 'variances':
        return renderVariancesTab();
      case 'reports':
        return renderReportsTab();
      case 'settings':
        return <ModuleSettingsTabContent moduleKey="liquor" />;
      default:
        return null;
    }
  };

  // Inventory Scan Tab
  const renderInventoryTab = () => (
    <div style={styles.tabContent}>
      <div style={styles.scanCard}>
        <h2 style={styles.cardTitle}>Scan & Weigh</h2>
        
        <div style={styles.formSection}>
          <label style={styles.label}>Barcode</label>
          <div style={styles.inputGroup}>
            <input
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              placeholder="Scan or enter barcode"
              style={styles.input}
              onKeyPress={(e) => e.key === 'Enter' && handleScan()}
            />
            <button
              onClick={handleScan}
              style={styles.scanButton}
            >
              <FiCamera size={20} />
              Scan
            </button>
          </div>
        </div>

        {selectedProduct && (
          <div style={styles.productInfo}>
            <h3 style={styles.productName}>{selectedProduct.name}</h3>
            <div style={styles.productDetails}>
              <div style={styles.productDetail}>
                <span style={styles.detailLabel}>Barcode:</span>
                <span style={styles.detailValue}>{selectedProduct.barcode || 'N/A'}</span>
              </div>
              <div style={styles.productDetail}>
                <span style={styles.detailLabel}>Expected Weight:</span>
                <span style={styles.detailValue}>{selectedProduct.expectedWeight}g</span>
              </div>
              <div style={styles.productDetail}>
                <span style={styles.detailLabel}>Last Weight:</span>
                <span style={styles.detailValue}>{selectedProduct.currentWeight}g</span>
              </div>
            </div>
          </div>
        )}

        <div style={styles.formSection}>
          <label style={styles.label}>Current Weight (grams)</label>
          <input
            type="number"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder="Enter weight"
            style={styles.input}
            disabled={!selectedProduct}
            min="0"
            step="0.1"
          />
        </div>

        <button
          onClick={handleWeightUpdate}
          disabled={!selectedProduct || !weightInput}
          style={{
            ...styles.primaryButton,
            ...((!selectedProduct || !weightInput) && styles.disabledButton)
          }}
        >
          Update Weight
        </button>
      </div>
    </div>
  );

  // Products Tab
  const renderProductsTab = () => (
    <div style={styles.tabContent}>
      <div style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <h2 style={styles.cardTitle}>Liquor Products ({products.length})</h2>
          <div style={styles.headerActions}>
            <button onClick={loadLiquorProducts} style={styles.refreshButton}>
              <FiRefreshCw size={18} />
              Refresh
            </button>
            <button 
              onClick={() => toast.info('Add liquor items from the main Inventory page by checking "Liquor Item" checkbox')} 
              style={styles.infoButton}
            >
              <FiPlus size={18} />
              How to Add Items
            </button>
          </div>
        </div>

        {loading ? (
          <div style={styles.loadingState}>
            <div style={styles.spinner}></div>
            <p>Loading liquor inventory...</p>
          </div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Barcode</th>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Category</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Expected Weight</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Current Weight</th>
                  <th style={{...styles.th, textAlign: 'center'}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.id} style={styles.tr}>
                    <td style={styles.td}>{product.barcode || 'N/A'}</td>
                    <td style={{...styles.td, fontWeight: TavariStyles.typography.fontWeight.semibold}}>{product.name}</td>
                    <td style={styles.td}>{product.category}</td>
                    <td style={{...styles.td, textAlign: 'right'}}>{product.expectedWeight}g</td>
                    <td style={{...styles.td, textAlign: 'right'}}>{product.currentWeight}g</td>
                    <td style={{...styles.td, textAlign: 'center'}}>
                      <button
                        onClick={() => deleteProduct(product.id)}
                        style={styles.deleteIconButton}
                        title="Remove from liquor tracking"
                      >
                        <FiTrash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {products.length === 0 && !loading && (
              <div style={styles.emptyState}>
                <FiPackage size={48} style={styles.emptyIcon} />
                <h3 style={styles.emptyTitle}>No Liquor Items Found</h3>
                <p style={styles.emptyDescription}>
                  To add items to liquor tracking:
                </p>
                <ol style={styles.instructionsList}>
                  <li>Go to Tavari POS → Inventory</li>
                  <li>Add or edit an item</li>
                  <li>Check the "Liquor Item (Weight Tracking)" checkbox</li>
                  <li>Save the item</li>
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Variances Tab
  const renderVariancesTab = () => (
    <div style={styles.tabContent}>
      <div style={styles.varianceCard}>
        <h2 style={styles.cardTitle}>Variance Review & Approval</h2>

        <div style={styles.varianceList}>
          {variances.map(variance => (
            <div
              key={variance.id}
              style={{
                ...styles.varianceItem,
                ...(variance.status === 'approved' && styles.varianceItemApproved)
              }}
            >
              <div style={styles.varianceContent}>
                <div style={styles.varianceHeader}>
                  <h3 style={styles.varianceName}>{variance.name}</h3>
                  {variance.status === 'approved' && (
                    <span style={styles.approvedBadge}>
                      <FiCheckCircle size={14} /> Approved
                    </span>
                  )}
                </div>
                <p style={styles.varianceBarcode}>Barcode: {variance.barcode || 'N/A'}</p>
                <div style={styles.varianceStats}>
                  <div style={styles.varianceStat}>
                    <span style={styles.statLabel}>Expected</span>
                    <span style={styles.statValue}>{variance.expected}g</span>
                  </div>
                  <div style={styles.varianceStat}>
                    <span style={styles.statLabel}>Actual</span>
                    <span style={styles.statValue}>{variance.actual}g</span>
                  </div>
                  <div style={styles.varianceStat}>
                    <span style={styles.statLabel}>Variance</span>
                    <span style={{
                      ...styles.statValue,
                      color: variance.variance < 0 ? TavariStyles.colors.danger : TavariStyles.colors.success
                    }}>
                      {variance.variance > 0 ? '+' : ''}{variance.variance}g ({variance.variancePercent}%)
                    </span>
                  </div>
                </div>
              </div>
              {variance.status === 'pending' && (
                <button
                  onClick={() => approveVariance(variance.id)}
                  style={styles.approveButton}
                >
                  <FiCheckCircle size={18} />
                  Approve
                </button>
              )}
            </div>
          ))}

          {variances.length === 0 && (
            <div style={styles.emptyState}>
              <FiCheckCircle size={48} style={{...styles.emptyIcon, color: TavariStyles.colors.success}} />
              <p>No variances to review. All inventory matches expected weights.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Reports Tab
  const renderReportsTab = () => {
    const totalShrink = variances
      .filter(v => v.variance < 0)
      .reduce((sum, v) => sum + Math.abs(v.variance), 0);

    const pendingApprovals = variances.filter(v => v.status === 'pending').length;

    return (
      <div style={styles.tabContent}>
        <div style={styles.reportCard}>
          <div style={styles.reportHeader}>
            <h2 style={styles.cardTitle}>Shrink Report</h2>
            <button onClick={exportReport} style={styles.exportButton} disabled={variances.length === 0}>
              <FiDownload size={18} />
              Export CSV
            </button>
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <p style={styles.statCardLabel}>Total Products</p>
              <p style={styles.statCardValue}>{products.length}</p>
            </div>
            <div style={{...styles.statCard, ...styles.statCardDanger}}>
              <p style={styles.statCardLabel}>Total Shrink</p>
              <p style={{...styles.statCardValue, color: TavariStyles.colors.danger}}>
                {totalShrink.toFixed(1)}g
              </p>
            </div>
            <div style={{...styles.statCard, ...styles.statCardWarning}}>
              <p style={styles.statCardLabel}>Pending Approvals</p>
              <p style={{...styles.statCardValue, color: TavariStyles.colors.warning}}>
                {pendingApprovals}
              </p>
            </div>
          </div>

          {variances.length > 0 ? (
            <div style={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={variances}>
                  <CartesianGrid strokeDasharray="3 3" stroke={TavariStyles.colors.gray200} />
                  <XAxis 
                    dataKey="name" 
                    angle={-45} 
                    textAnchor="end" 
                    height={100}
                    tick={{ fontSize: 13 }}
                  />
                  <YAxis tick={{ fontSize: 13 }} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: TavariStyles.colors.white,
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: TavariStyles.borderRadius.md
                    }}
                  />
                  <Legend />
                  <Bar 
                    dataKey="expected" 
                    fill={TavariStyles.colors.primary} 
                    name="Expected Weight (g)" 
                  />
                  <Bar 
                    dataKey="actual" 
                    fill={TavariStyles.colors.success} 
                    name="Actual Weight (g)" 
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={styles.emptyState}>
              <FiDownload size={48} style={styles.emptyIcon} />
              <p>No variance data available for reporting.</p>
              <p style={styles.emptySubtext}>
                Scan and weigh items to generate shrink reports.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Main render
  const renderContent = () => (
    <div style={styles.container}>
      <TavariModuleHeader
        title="Tavari Liquor Inventory"
        description="Track liquor inventory, manage products, scan weights, and monitor shrinkage."
        actionLabel="Scan Inventory"
        actionIcon={<FiCamera size={18} />}
        onAction={() => setActiveTab('inventory')}
        secondaryActionLabel="Refresh"
        secondaryActionIcon={<FiRefreshCw size={18} />}
        onSecondaryAction={loadLiquorProducts}
        secondaryActionDisabled={loading}
      />

      <TavariTabSystemComponent
        tabs={tabs}
        mode="state"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Liquor Inventory module"
        variant="module"
      />

      {/* Tab Content */}
      {renderTabContent()}
    </div>
  );

  return (
    <POSAuthWrapper
      requiredRoles={['manager', 'admin', 'owner']}
      requireBusiness={true}
      componentName="LiquorInventorySystem"
    >
      {renderContent()}
    </POSAuthWrapper>
  );
};

// Styles following Tavari standards
const styles = {
  container: {
    ...TavariStyles.layout.container
  },

  header: {
    ...TavariStyles.layout.flexBetween,
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.lg,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`
  },

  title: {
    fontSize: TavariStyles.typography.fontSize['3xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    margin: 0
  },

  subtitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs
  },


  tabContent: {
    flex: 1
  },

  scanCard: {
    ...TavariStyles.layout.card,
    maxWidth: '600px',
    margin: '0 auto',
    padding: TavariStyles.spacing['3xl']
  },

  tableCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl
  },

  varianceCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl
  },

  reportCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl
  },

  cardTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.xl
  },

  formSection: {
    marginBottom: TavariStyles.spacing.xl
  },

  label: {
    ...TavariStyles.components.form.label,
    marginBottom: TavariStyles.spacing.sm
  },

  inputGroup: {
    display: 'flex',
    gap: TavariStyles.spacing.sm
  },

  input: {
    ...TavariStyles.components.form.input,
    flex: 1
  },

  scanButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    whiteSpace: 'nowrap'
  },

  productInfo: {
    backgroundColor: TavariStyles.colors.primary + '10',
    padding: TavariStyles.spacing.lg,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: TavariStyles.spacing.xl,
    border: `2px solid ${TavariStyles.colors.primary}30`
  },

  productName: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.md
  },

  productDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },

  productDetail: {
    display: 'flex',
    justifyContent: 'space-between'
  },

  detailLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600
  },

  detailValue: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800
  },

  primaryButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    width: '100%',
    padding: `${TavariStyles.spacing.lg} ${TavariStyles.spacing.xl}`,
    fontSize: TavariStyles.typography.fontSize.md,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },

  disabledButton: {
    backgroundColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.6
  },

  tableHeader: {
    ...TavariStyles.layout.flexBetween,
    marginBottom: TavariStyles.spacing.xl
  },

  headerActions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm
  },

  refreshButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },

  infoButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },

  loadingState: {
    textAlign: 'center',
    padding: TavariStyles.spacing['4xl'],
    color: TavariStyles.colors.gray500
  },

  spinner: {
    width: '40px',
    height: '40px',
    margin: '0 auto 20px',
    border: `4px solid ${TavariStyles.colors.gray200}`,
    borderTop: `4px solid ${TavariStyles.colors.primary}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },

  tableContainer: {
    overflowX: 'auto'
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },

  th: {
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray100,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray700,
    textAlign: 'left',
    borderBottom: `2px solid ${TavariStyles.colors.gray200}`
  },

  tr: {
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    transition: TavariStyles.transitions.fast
  },

  td: {
    padding: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700
  },

  deleteIconButton: {
    ...TavariStyles.components.button.base,
    padding: TavariStyles.spacing.sm,
    backgroundColor: 'transparent',
    color: TavariStyles.colors.danger,
    border: 'none',
    cursor: 'pointer'
  },

  emptyState: {
    textAlign: 'center',
    padding: TavariStyles.spacing['4xl'],
    color: TavariStyles.colors.gray500
  },

  emptyIcon: {
    marginBottom: TavariStyles.spacing.lg,
    color: TavariStyles.colors.gray400
  },

  emptyTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.sm
  },

  emptyDescription: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.md
  },

  emptySubtext: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray500,
    marginTop: TavariStyles.spacing.sm
  },

  instructionsList: {
    textAlign: 'left',
    display: 'inline-block',
    margin: `${TavariStyles.spacing.lg} auto`,
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.infoBg,
    borderRadius: TavariStyles.borderRadius.md,
    lineHeight: '1.8'
  },

  varianceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg
  },

  varianceItem: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.lg,
    border: `2px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: TavariStyles.spacing.lg
  },

  varianceItemApproved: {
    backgroundColor: TavariStyles.colors.successBg,
    borderColor: TavariStyles.colors.success + '40'
  },

  varianceContent: {
    flex: 1
  },

  varianceHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.sm
  },

  varianceName: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    margin: 0
  },

  approvedBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    backgroundColor: TavariStyles.colors.success,
    color: TavariStyles.colors.white,
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    borderRadius: TavariStyles.borderRadius.full,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },

  varianceBarcode: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.md
  },

  varianceStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: TavariStyles.spacing.lg
  },

  varianceStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },

  statLabel: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    textTransform: 'uppercase',
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },

  statValue: {
    fontSize: TavariStyles.typography.fontSize.md,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800
  },

  approveButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    backgroundColor: TavariStyles.colors.success,
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    whiteSpace: 'nowrap'
  },

  reportHeader: {
    ...TavariStyles.layout.flexBetween,
    marginBottom: TavariStyles.spacing.xl
  },

  exportButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },

  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing['3xl']
  },

  statCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.lg,
    textAlign: 'center',
    backgroundColor: TavariStyles.colors.infoBg,
    border: `1px solid ${TavariStyles.colors.info}30`
  },

  statCardDanger: {
    backgroundColor: TavariStyles.colors.errorBg,
    border: `1px solid ${TavariStyles.colors.danger}30`
  },

  statCardWarning: {
    backgroundColor: TavariStyles.colors.warningBg,
    border: `1px solid ${TavariStyles.colors.warning}30`
  },

  statCardLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.sm
  },

  statCardValue: {
    fontSize: TavariStyles.typography.fontSize['3xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.primary
  },

  chartContainer: {
    height: '320px',
    marginTop: TavariStyles.spacing.xl
  }
};

// Add keyframe animation for spinner
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export default LiquorInventorySystem;
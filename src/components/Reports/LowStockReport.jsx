// src/components/Reports/LowStockReport.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';

const LowStockReport = ({ 
  data, 
  dateRange, 
  customDateStart, 
  customDateEnd, 
  compareToLastYear, 
  selectedEmployee,
  employees,
  onExport,
  onEmail 
}) => {
  
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'LowStockReport'
  });
  
  const [inventoryData, setInventoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alertThreshold, setAlertThreshold] = useState(10);
  const [sortBy, setSortBy] = useState('stock_level');
  const [filterCategory, setFilterCategory] = useState('all');
  const [categories, setCategories] = useState([]);

  const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;

  useEffect(() => {
    if (auth.selectedBusinessId && auth.authUser) {
      loadInventoryData();
      loadCategories();
    }
  }, [auth.selectedBusinessId, auth.authUser]);

  const loadInventoryData = async () => {
    if (!auth.selectedBusinessId) return;
    
    try {
      setLoading(true);
      
      // Use the EXACT same query pattern as POSInventory.jsx
      let query = supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', auth.selectedBusinessId);

      query = query.or('is_active.eq.true,is_active.is.null');

      const { data: inventory, error } = await query;

      if (error) throw error;

      // Filter for stock tracking items and calculate metrics
      const enrichedInventory = inventory?.filter(item => item.track_stock && item.is_active !== false).map(item => {
        const currentStock = Number(item.stock_quantity) || 0;
        const minLevel = Number(item.low_stock_threshold) || 5;
        const costPrice = Number(item.cost) || 0;
        const sellingPrice = Number(item.price) || 0;

        // Calculate how many times this item was sold
        const salesCount = data.rawData?.sales?.reduce((count, sale) => {
          const itemSales = sale.pos_sale_items?.filter(saleItem => 
            saleItem.inventory_id === item.id
          ) || [];
          return count + itemSales.reduce((sum, saleItem) => sum + (Number(saleItem.quantity) || 0), 0);
        }, 0) || 0;

        // Calculate stock status using the same logic as POSInventory.jsx
        let stockStatus = 'normal';
        let urgency = 0;
        
        if (currentStock <= 0) {
          stockStatus = 'out_of_stock';
          urgency = 4;
        } else if (currentStock <= minLevel) {
          stockStatus = 'critical';
          urgency = 3;
        } else if (currentStock <= (minLevel * 1.5)) {
          stockStatus = 'low';
          urgency = 2;
        } else if (currentStock <= alertThreshold) {
          stockStatus = 'warning';
          urgency = 1;
        }

        // Calculate days remaining
        const dailySalesRate = salesCount / 30;
        const daysRemaining = dailySalesRate > 0 ? Math.floor(currentStock / dailySalesRate) : 999;

        // Calculate reorder suggestion
        const suggestedReorder = Math.max(0, (minLevel * 2) - currentStock);
        const reorderValue = suggestedReorder * costPrice;

        return {
          ...item,
          currentStock,
          minLevel,
          costPrice,
          sellingPrice,
          salesCount,
          stockStatus,
          urgency,
          daysRemaining: daysRemaining === 999 ? 'N/A' : daysRemaining,
          suggestedReorder,
          reorderValue,
          categoryName: 'Uncategorized', // We'll get category names separately
          stockValue: currentStock * costPrice
        };
      }) || [];

      setInventoryData(enrichedInventory);
    } catch (err) {
      console.error('Error loading inventory data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    if (!auth.selectedBusinessId) return;
    
    try {
      // Use the same pattern as POSInventory.jsx for categories
      const { data: categoryData, error } = await supabase
        .from('pos_categories')
        .select('id, name')
        .eq('business_id', auth.selectedBusinessId)
        .order('name', { ascending: true });

      if (error) throw error;
      setCategories(categoryData || []);
    } catch (err) {
      console.error('Error loading categories:', err);
    }
  };

  // Filter and sort inventory data
  const filteredInventory = inventoryData
    .filter(item => {
      if (filterCategory !== 'all' && item.category_id !== filterCategory) return false;
      return item.currentStock <= alertThreshold || item.stockStatus !== 'normal';
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'stock_level':
          return a.currentStock - b.currentStock;
        case 'urgency':
          return b.urgency - a.urgency;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'category':
          return a.categoryName.localeCompare(b.categoryName);
        case 'days_remaining':
          const aDays = a.daysRemaining === 'N/A' ? 999 : a.daysRemaining;
          const bDays = b.daysRemaining === 'N/A' ? 999 : b.daysRemaining;
          return aDays - bDays;
        default:
          return a.currentStock - b.currentStock;
      }
    });

  // Calculate summary metrics
  const outOfStockItems = inventoryData.filter(item => item.stockStatus === 'out_of_stock').length;
  const criticalItems = inventoryData.filter(item => item.stockStatus === 'critical').length;
  const lowStockItems = inventoryData.filter(item => item.stockStatus === 'low').length;
  const totalReorderValue = filteredInventory.reduce((sum, item) => sum + item.reorderValue, 0);

  const getStockStatusColor = (status) => {
    switch (status) {
      case 'out_of_stock': return TavariStyles.colors.danger;
      case 'critical': return TavariStyles.colors.warning;
      case 'low': return TavariStyles.colors.yellow500;
      case 'warning': return TavariStyles.colors.blue500;
      default: return TavariStyles.colors.success;
    }
  };

  const getStockStatusText = (status) => {
    switch (status) {
      case 'out_of_stock': return 'Out of Stock';
      case 'critical': return 'Critical';
      case 'low': return 'Low';
      case 'warning': return 'Warning';
      default: return 'Normal';
    }
  };

  const exportData = {
    csv: () => {
      let csvContent = "data:text/csv;charset=utf-8,";
      csvContent += "Low Stock Alerts Report\n";
      csvContent += `Generated,${new Date().toLocaleString()}\n\n`;
      csvContent += "Item Name,SKU,Current Stock,Min Level,Status,Reorder Value\n";
      filteredInventory.forEach(item => {
        csvContent += `${item.name},${item.sku || ''},${item.currentStock},${item.minLevel},${getStockStatusText(item.stockStatus)},${item.reorderValue.toFixed(2)}\n`;
      });
      return csvContent;
    },
    
    excel: () => {
      return exportData.csv();
    },
    
    pdf: () => {
      return null;
    }
  };

  const emailContent = () => ({
    subject: `Low Stock Alert Report - ${new Date().toLocaleDateString()}`,
    body: `Low Stock Alert Report\n\nOut of Stock: ${outOfStockItems} items\nCritical Stock: ${criticalItems} items\nLow Stock: ${lowStockItems} items`
  });

  const handleExport = (format) => {
    const content = exportData[format]();
    if (content) {
      onExport(content, format, 'low-stock');
    }
  };

  const handleEmail = () => {
    const content = emailContent();
    onEmail(content, exportData.csv(), 'low-stock');
  };

  const styles = {
    container: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.lg,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.warning}`
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    
    actionButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      fontSize: TavariStyles.typography.fontSize.xs
    },
    
    exportButton: {
      ...TavariStyles.components.button.variants.secondary
    },
    
    emailButton: {
      ...TavariStyles.components.button.variants.primary
    },
    
    controls: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      alignItems: 'center',
      flexWrap: 'wrap'
    },
    
    controlGroup: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    
    select: TavariStyles.components.form.select,
    input: TavariStyles.components.form.input,
    
    alertsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg
    },
    
    alertCard: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.md,
      textAlign: 'center',
      border: `2px solid`
    },
    
    outOfStockCard: {
      backgroundColor: TavariStyles.colors.red50,
      borderColor: TavariStyles.colors.danger
    },
    
    criticalCard: {
      backgroundColor: TavariStyles.colors.orange50,
      borderColor: TavariStyles.colors.warning
    },
    
    lowStockCard: {
      backgroundColor: TavariStyles.colors.yellow50,
      borderColor: TavariStyles.colors.yellow500
    },
    
    reorderCard: {
      backgroundColor: TavariStyles.colors.blue50,
      borderColor: TavariStyles.colors.primary
    },
    
    alertValue: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.xs
    },
    
    alertLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    tableContainer: {
      overflowX: 'auto',
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      backgroundColor: TavariStyles.colors.white
    },
    
    tableHeader: {
      backgroundColor: TavariStyles.colors.gray100,
      borderBottom: `2px solid ${TavariStyles.colors.gray300}`
    },
    
    tableHeaderCell: {
      padding: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray700,
      textTransform: 'uppercase',
      textAlign: 'left',
      borderRight: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    tableHeaderCellNumber: {
      textAlign: 'right'
    },
    
    tableRow: {
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    tableCell: {
      padding: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      borderRight: `1px solid ${TavariStyles.colors.gray200}`,
      verticalAlign: 'middle'
    },
    
    tableCellNumber: {
      textAlign: 'right',
      fontFamily: 'monospace'
    },
    
    statusBadge: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textTransform: 'uppercase',
      color: TavariStyles.colors.white
    },
    
    itemName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray500
    },
    
    noDataMessage: {
      textAlign: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      backgroundColor: TavariStyles.colors.green50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.green200}`
    }
  };

  if (!auth.selectedBusinessId || !auth.authUser) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading inventory data...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading inventory data...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Low Stock Alerts</h3>
        <div style={styles.actions}>
          <button 
            style={{...styles.actionButton, ...styles.exportButton}}
            onClick={() => handleExport('csv')}
          >
            Export CSV
          </button>
          <button 
            style={{...styles.actionButton, ...styles.exportButton}}
            onClick={() => handleExport('excel')}
          >
            Export Excel
          </button>
          <button 
            style={{...styles.actionButton, ...styles.exportButton}}
            onClick={() => handleExport('pdf')}
          >
            Export PDF
          </button>
          <button 
            style={{...styles.actionButton, ...styles.emailButton}}
            onClick={handleEmail}
          >
            Email Alert
          </button>
        </div>
      </div>

      <div style={styles.controls}>
        <div style={styles.controlGroup}>
          <span style={styles.label}>Alert Threshold:</span>
          <input
            type="number"
            value={alertThreshold}
            onChange={(e) => setAlertThreshold(Number(e.target.value))}
            style={{...styles.input, width: '80px'}}
            min="0"
          />
          <span style={styles.label}>units</span>
        </div>
        
        <div style={styles.controlGroup}>
          <span style={styles.label}>Category:</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={styles.select}
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        
        <div style={styles.controlGroup}>
          <span style={styles.label}>Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.select}
          >
            <option value="stock_level">Stock Level</option>
            <option value="urgency">Urgency</option>
            <option value="name">Item Name</option>
            <option value="category">Category</option>
            <option value="days_remaining">Days Remaining</option>
          </select>
        </div>
      </div>

      <div style={styles.alertsGrid}>
        <div style={{...styles.alertCard, ...styles.outOfStockCard}}>
          <div style={{...styles.alertValue, color: TavariStyles.colors.danger}}>
            {outOfStockItems}
          </div>
          <div style={{...styles.alertLabel, color: TavariStyles.colors.danger}}>
            Out of Stock
          </div>
        </div>
        <div style={{...styles.alertCard, ...styles.criticalCard}}>
          <div style={{...styles.alertValue, color: TavariStyles.colors.warning}}>
            {criticalItems}
          </div>
          <div style={{...styles.alertLabel, color: TavariStyles.colors.warning}}>
            Critical Stock
          </div>
        </div>
        <div style={{...styles.alertCard, ...styles.lowStockCard}}>
          <div style={{...styles.alertValue, color: TavariStyles.colors.yellow600}}>
            {lowStockItems}
          </div>
          <div style={{...styles.alertLabel, color: TavariStyles.colors.yellow600}}>
            Low Stock
          </div>
        </div>
        <div style={{...styles.alertCard, ...styles.reorderCard}}>
          <div style={{...styles.alertValue, color: TavariStyles.colors.primary}}>
            {formatCurrency(totalReorderValue)}
          </div>
          <div style={{...styles.alertLabel, color: TavariStyles.colors.primary}}>
            Reorder Value
          </div>
        </div>
      </div>

      {filteredInventory.length === 0 ? (
        <div style={styles.noDataMessage}>
          No low stock alerts at this time. All tracked inventory items are above the alert threshold.
        </div>
      ) : (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead style={styles.tableHeader}>
              <tr>
                <th style={styles.tableHeaderCell}>Item Name</th>
                <th style={styles.tableHeaderCell}>SKU</th>
                <th style={styles.tableHeaderCell}>Category</th>
                <th style={styles.tableHeaderCell}>Status</th>
                <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Current</th>
                <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Min Level</th>
                <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Days Left</th>
                <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Reorder</th>
                <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Value</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.map((item) => (
                <tr key={item.id} style={styles.tableRow}>
                  <td style={{...styles.tableCell, ...styles.itemName}}>
                    {item.name}
                  </td>
                  <td style={styles.tableCell}>
                    {item.sku || '-'}
                  </td>
                  <td style={styles.tableCell}>
                    {item.categoryName}
                  </td>
                  <td style={styles.tableCell}>
                    <span style={{
                      ...styles.statusBadge,
                      backgroundColor: getStockStatusColor(item.stockStatus)
                    }}>
                      {getStockStatusText(item.stockStatus)}
                    </span>
                  </td>
                  <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                    {item.currentStock}
                  </td>
                  <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                    {item.minLevel}
                  </td>
                  <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                    {item.daysRemaining}
                  </td>
                  <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                    {item.suggestedReorder}
                  </td>
                  <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                    {formatCurrency(item.reorderValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LowStockReport;
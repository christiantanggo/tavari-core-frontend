// src/components/Reports/CategoryPerformanceReport.jsx
import React, { useState } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

const CategoryPerformanceReport = ({ 
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
  
  const [sortBy, setSortBy] = useState('revenue'); // 'revenue', 'quantity', 'margin'
  const [showInactive, setShowInactive] = useState(false);

  const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;
  const formatPercentage = (percent) => `${(percent || 0).toFixed(1)}%`;

  // Calculate category performance from sales data
  const categoryStats = {};
  
  data.rawData?.sales?.forEach(sale => {
    if (sale.pos_sale_items) {
      sale.pos_sale_items.forEach(item => {
        const categoryId = item.category_id || 'uncategorized';
        const categoryName = item.category_name || item.pos_categories?.name || 'Uncategorized';
        
        if (!categoryStats[categoryId]) {
          categoryStats[categoryId] = {
            id: categoryId,
            name: categoryName,
            totalRevenue: 0,
            totalQuantity: 0,
            totalCost: 0,
            transactionCount: 0,
            uniqueItems: new Set(),
            averagePrice: 0,
            margin: 0,
            marginPercent: 0
          };
        }
        
        const quantity = Number(item.quantity) || 0;
        const revenue = Number(item.total_price) || 0;
        const unitPrice = Number(item.unit_price) || 0;
        const estimatedCost = unitPrice * 0.3; // Estimate 30% cost ratio
        
        categoryStats[categoryId].totalQuantity += quantity;
        categoryStats[categoryId].totalRevenue += revenue;
        categoryStats[categoryId].totalCost += estimatedCost * quantity;
        categoryStats[categoryId].transactionCount += 1;
        categoryStats[categoryId].uniqueItems.add(item.name);
      });
    }
  });

  // Calculate derived metrics
  Object.values(categoryStats).forEach(category => {
    category.averagePrice = category.totalQuantity > 0 ? (category.totalRevenue / category.totalQuantity) : 0;
    category.margin = category.totalRevenue - category.totalCost;
    category.marginPercent = category.totalRevenue > 0 ? ((category.margin / category.totalRevenue) * 100) : 0;
    category.itemCount = category.uniqueItems.size;
    category.revenuePercent = data.salesTotals > 0 ? ((category.totalRevenue / data.salesTotals) * 100) : 0;
  });

  const allCategories = Object.values(categoryStats);
  
  // Sort categories based on selected criteria
  const sortedCategories = [...allCategories].sort((a, b) => {
    switch (sortBy) {
      case 'revenue':
        return b.totalRevenue - a.totalRevenue;
      case 'quantity':
        return b.totalQuantity - a.totalQuantity;
      case 'margin':
        return b.margin - a.margin;
      case 'marginPercent':
        return b.marginPercent - a.marginPercent;
      default:
        return b.totalRevenue - a.totalRevenue;
    }
  });

  // Calculate performance insights
  const topCategory = sortedCategories[0];
  const totalItems = allCategories.reduce((sum, cat) => sum + cat.itemCount, 0);
  const avgCategoryRevenue = allCategories.length > 0 ? 
    (allCategories.reduce((sum, cat) => sum + cat.totalRevenue, 0) / allCategories.length) : 0;

  const exportData = {
    csv: () => {
      const { start, end } = getDateRangeText();
      let csvContent = "data:text/csv;charset=utf-8,";
      
      csvContent += "Category Performance Report\n";
      csvContent += `Period,${start} to ${end}\n`;
      csvContent += `Employee Filter,${getEmployeeName()}\n`;
      csvContent += `Sort By,${sortBy}\n`;
      csvContent += `Generated,${new Date().toLocaleString()}\n\n`;
      
      csvContent += "CATEGORY PERFORMANCE\n";
      csvContent += "Rank,Category,Revenue,Revenue %,Quantity,Items,Avg Price,Margin,Margin %,Transactions\n";
      sortedCategories.forEach((category, index) => {
        csvContent += `${index + 1},${category.name},${category.totalRevenue.toFixed(2)},${category.revenuePercent.toFixed(1)}%,${category.totalQuantity},${category.itemCount},${category.averagePrice.toFixed(2)},${category.margin.toFixed(2)},${category.marginPercent.toFixed(1)}%,${category.transactionCount}\n`;
      });
      
      csvContent += "\nSUMMARY METRICS\n";
      csvContent += "Metric,Value\n";
      csvContent += `Total Categories,${allCategories.length}\n`;
      csvContent += `Total Items,${totalItems}\n`;
      csvContent += `Top Category,${topCategory?.name || 'N/A'}\n`;
      csvContent += `Top Category Revenue,${formatCurrency(topCategory?.totalRevenue || 0)}\n`;
      csvContent += `Average Category Revenue,${formatCurrency(avgCategoryRevenue)}\n`;
      
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
    subject: `Category Performance Report - ${getDateRangeText().start} to ${getDateRangeText().end}`,
    body: `
Category Performance Report

Period: ${getDateRangeText().start} to ${getDateRangeText().end}
Employee Filter: ${getEmployeeName()}
Sort By: ${sortBy}
Generated: ${new Date().toLocaleString()}

SUMMARY:
- Total Categories: ${allCategories.length}
- Total Items: ${totalItems}
- Top Category: ${topCategory?.name || 'N/A'} (${formatCurrency(topCategory?.totalRevenue || 0)})
- Average Category Revenue: ${formatCurrency(avgCategoryRevenue)}

TOP 5 CATEGORIES BY ${sortBy.toUpperCase()}:
${sortedCategories.slice(0, 5).map((cat, index) => 
  `${index + 1}. ${cat.name} - ${formatCurrency(cat.totalRevenue)} (${formatPercentage(cat.revenuePercent)} of total)`
).join('\n')}

Use this data to optimize menu design, inventory allocation, and pricing strategies.
    `.trim()
  });

  const getDateRangeText = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (dateRange) {
      case 'today':
        return { start: today.toLocaleDateString(), end: today.toLocaleDateString() };
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        return { start: yesterday.toLocaleDateString(), end: yesterday.toLocaleDateString() };
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        return { start: weekStart.toLocaleDateString(), end: today.toLocaleDateString() };
      case 'month':
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        return { start: monthStart.toLocaleDateString(), end: today.toLocaleDateString() };
      case 'custom':
        return { 
          start: customDateStart ? new Date(customDateStart).toLocaleDateString() : today.toLocaleDateString(),
          end: customDateEnd ? new Date(customDateEnd).toLocaleDateString() : today.toLocaleDateString()
        };
      default:
        return { start: today.toLocaleDateString(), end: today.toLocaleDateString() };
    }
  };

  const getEmployeeName = () => {
    if (selectedEmployee === 'all') return 'All Employees';
    const employee = employees.find(e => e.id === selectedEmployee);
    return employee ? (employee.full_name || employee.email) : 'Unknown Employee';
  };

  const handleExport = (format) => {
    const content = exportData[format]();
    if (content) {
      onExport(content, format, 'category-performance');
    }
  };

  const handleEmail = () => {
    const content = emailContent();
    onEmail(content, exportData.csv(), 'category-performance');
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
      borderBottom: `2px solid ${TavariStyles.colors.secondary}`
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
    
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.purple50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.purple200}`
    },
    
    summaryItem: {
      textAlign: 'center'
    },
    
    summaryValue: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.purple700,
      marginBottom: TavariStyles.spacing.xs
    },
    
    summaryLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.purple600,
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
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      '&:hover': {
        backgroundColor: TavariStyles.colors.gray50
      }
    },
    
    topTableRow: {
      backgroundColor: TavariStyles.colors.green50
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
    
    rank: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray600,
      textAlign: 'center'
    },
    
    categoryName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    
    revenue: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    percentage: {
      color: TavariStyles.colors.gray600
    },
    
    margin: {
      color: TavariStyles.colors.success
    },
    
    noDataMessage: {
      textAlign: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic',
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    }
  };

  const hasCategoryData = allCategories.length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Category Performance Analysis</h3>
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
            Email Report
          </button>
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.controlGroup}>
          <span style={styles.label}>Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.select}
          >
            <option value="revenue">Revenue</option>
            <option value="quantity">Quantity Sold</option>
            <option value="margin">Profit Margin ($)</option>
            <option value="marginPercent">Margin Percentage</option>
          </select>
        </div>
      </div>

      {!hasCategoryData ? (
        <div style={styles.noDataMessage}>
          No category sales data found for the selected period and filters.
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div style={styles.summaryGrid}>
            <div style={styles.summaryItem}>
              <div style={styles.summaryValue}>{allCategories.length}</div>
              <div style={styles.summaryLabel}>Categories</div>
            </div>
            <div style={styles.summaryItem}>
              <div style={styles.summaryValue}>{totalItems}</div>
              <div style={styles.summaryLabel}>Total Items</div>
            </div>
            <div style={styles.summaryItem}>
              <div style={styles.summaryValue}>{topCategory?.name || 'N/A'}</div>
              <div style={styles.summaryLabel}>Top Category</div>
            </div>
            <div style={styles.summaryItem}>
              <div style={styles.summaryValue}>{formatCurrency(avgCategoryRevenue)}</div>
              <div style={styles.summaryLabel}>Avg Revenue</div>
            </div>
          </div>

          {/* Categories Table */}
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead style={styles.tableHeader}>
                <tr>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Rank</th>
                  <th style={styles.tableHeaderCell}>Category</th>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Revenue</th>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>% of Total</th>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Qty Sold</th>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Items</th>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Avg Price</th>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Margin $</th>
                  <th style={{...styles.tableHeaderCell, ...styles.tableHeaderCellNumber}}>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {sortedCategories.map((category, index) => (
                  <tr 
                    key={category.id}
                    style={{
                      ...styles.tableRow,
                      ...(index === 0 ? styles.topTableRow : {})
                    }}
                  >
                    <td style={{...styles.tableCell, ...styles.tableCellNumber, ...styles.rank}}>
                      {index + 1}
                    </td>
                    <td style={{...styles.tableCell, ...styles.categoryName}}>
                      {category.name}
                    </td>
                    <td style={{...styles.tableCell, ...styles.tableCellNumber, ...styles.revenue}}>
                      {formatCurrency(category.totalRevenue)}
                    </td>
                    <td style={{...styles.tableCell, ...styles.tableCellNumber, ...styles.percentage}}>
                      {formatPercentage(category.revenuePercent)}
                    </td>
                    <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                      {category.totalQuantity}
                    </td>
                    <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                      {category.itemCount}
                    </td>
                    <td style={{...styles.tableCell, ...styles.tableCellNumber}}>
                      {formatCurrency(category.averagePrice)}
                    </td>
                    <td style={{...styles.tableCell, ...styles.tableCellNumber, ...styles.margin}}>
                      {formatCurrency(category.margin)}
                    </td>
                    <td style={{...styles.tableCell, ...styles.tableCellNumber, ...styles.margin}}>
                      {formatPercentage(category.marginPercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default CategoryPerformanceReport;
// components/Reports/ProfitMarginAnalysisReport.jsx - FIXED
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { resolveSaleLineUnitCost } from '../../utils/posLineFoodCost';

/**
 * Profit Margin Analysis Report Component
 * Analyzes profitability by calculating gross profit margins and cost analysis
 * 
 * @param {Object} props
 * @param {Object} props.data - Current period report data
 * @param {string} props.dateRange - Selected date range
 * @param {string} props.customDateStart - Custom start date
 * @param {string} props.customDateEnd - Custom end date
 * @param {string} props.businessId - Business ID
 * @param {Function} props.onExport - Export handler
 * @param {Function} props.onEmail - Email handler
 * @param {Array} props.employees - Employee list
 * @returns {React.ReactNode} Profit Margin Analysis Report
 */
const ProfitMarginAnalysisReport = ({
  data,
  dateRange,
  customDateStart,
  customDateEnd,
  businessId,
  onExport,
  onEmail,
  employees = []
}) => {
  const [profitData, setProfitData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState({
    overallMargins: true,
    itemMargins: true,
    categoryMargins: true,
    employeeImpact: true,
    timeAnalysis: true,
    costBreakdown: true
  });

  const { formatTaxAmount } = useTaxCalculations(businessId);

  useEffect(() => {
    if (businessId && data) {
      loadProfitData();
    }
  }, [businessId, data, dateRange, customDateStart, customDateEnd]);

  const getDateFilter = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (dateRange) {
      case 'today':
        return {
          start: today.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        return {
          start: yesterday.toISOString(),
          end: today.toISOString()
        };
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        return {
          start: weekStart.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      case 'month':
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return {
          start: monthStart.toISOString(),
          end: new Date(monthEnd.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      case 'custom':
        return {
          start: customDateStart ? new Date(customDateStart).toISOString() : today.toISOString(),
          end: customDateEnd ? new Date(customDateEnd + 'T23:59:59').toISOString() : new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
      default:
        return {
          start: today.toISOString(),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString()
        };
    }
  };

  const loadProfitData = async () => {
    if (!businessId || !data) return;

    try {
      setLoading(true);
      setError(null);

      const { start, end } = getDateFilter();
      
      // Get detailed sales data with inventory information - FIXED COLUMN NAMES
      const { data: salesWithInventory, error: salesError } = await supabase
        .from('pos_sales')
        .select(`
          id, subtotal, tax, discount, loyalty_discount, total, created_at, user_id, payment_status,
          pos_sale_items (
            id, inventory_id, name, quantity, unit_price, total_price, unit_cost, food_cost_total, category_id, modifiers,
            pos_inventory(id, name, cost, price, category_id)
          )
        `)
        .eq('business_id', businessId)
        .in('payment_status', ['paid', 'completed'])
        .gte('created_at', start)
        .lt('created_at', end);

      if (salesError) throw salesError;

      // Get category data for analysis
      const { data: categories, error: categoriesError } = await supabase
        .from('pos_categories')
        .select('id, name, color')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (categoriesError) throw categoriesError;

      // Calculate profit metrics
      let totalRevenue = 0;
      let totalCost = 0;
      let totalGrossProfit = 0;

      const itemProfits = {};
      const categoryProfits = {};
      const employeeProfits = {};
      const dailyProfits = {};

      // Process each sale
      salesWithInventory?.forEach(sale => {
        sale.pos_sale_items?.forEach(item => {
          const inventory = item.pos_inventory;
          const quantity = Number(item.quantity) || 0;
          const unitPrice = Number(item.unit_price) || 0;
          const costPrice = resolveSaleLineUnitCost(item);
          
          const itemRevenue = quantity * unitPrice;
          const itemCost = quantity * costPrice;
          const itemProfit = itemRevenue - itemCost;
          const itemMargin = itemRevenue > 0 ? (itemProfit / itemRevenue) * 100 : 0;

          totalRevenue += itemRevenue;
          totalCost += itemCost;
          totalGrossProfit += itemProfit;

          // Track by item
          const itemKey = item.name || inventory?.name || 'Unknown Item';
          if (!itemProfits[itemKey]) {
            itemProfits[itemKey] = {
              name: itemKey,
              revenue: 0,
              cost: 0,
              profit: 0,
              margin: 0,
              quantitySold: 0,
              categoryId: item.category_id || inventory?.category_id
            };
          }
          itemProfits[itemKey].revenue += itemRevenue;
          itemProfits[itemKey].cost += itemCost;
          itemProfits[itemKey].profit += itemProfit;
          itemProfits[itemKey].quantitySold += quantity;
          itemProfits[itemKey].margin = itemProfits[itemKey].revenue > 0 ? 
            (itemProfits[itemKey].profit / itemProfits[itemKey].revenue) * 100 : 0;

          // Track by category
          const categoryId = item.category_id || inventory?.category_id;
          const categoryName = categories?.find(c => c.id === categoryId)?.name || 'Uncategorized';
          if (!categoryProfits[categoryName]) {
            categoryProfits[categoryName] = {
              name: categoryName,
              revenue: 0,
              cost: 0,
              profit: 0,
              margin: 0,
              itemCount: 0
            };
          }
          categoryProfits[categoryName].revenue += itemRevenue;
          categoryProfits[categoryName].cost += itemCost;
          categoryProfits[categoryName].profit += itemProfit;
          categoryProfits[categoryName].itemCount += quantity;
          categoryProfits[categoryName].margin = categoryProfits[categoryName].revenue > 0 ? 
            (categoryProfits[categoryName].profit / categoryProfits[categoryName].revenue) * 100 : 0;
        });

        // Track by employee
        const userId = sale.user_id;
        const employee = employees.find(e => e.id === userId);
        const employeeName = employee ? (employee.full_name || employee.email) : 'Unknown';
        
        if (!employeeProfits[userId]) {
          employeeProfits[userId] = {
            id: userId,
            name: employeeName,
            revenue: 0,
            cost: 0,
            profit: 0,
            margin: 0,
            transactions: 0
          };
        }
        
        const saleRevenue = Number(sale.subtotal) || 0;
        const saleCost = sale.pos_sale_items?.reduce((sum, item) => {
          const costPrice = resolveSaleLineUnitCost(item);
          const quantity = Number(item.quantity) || 0;
          return sum + (costPrice * quantity);
        }, 0) || 0;
        const saleProfit = saleRevenue - saleCost;

        employeeProfits[userId].revenue += saleRevenue;
        employeeProfits[userId].cost += saleCost;
        employeeProfits[userId].profit += saleProfit;
        employeeProfits[userId].transactions += 1;
        employeeProfits[userId].margin = employeeProfits[userId].revenue > 0 ? 
          (employeeProfits[userId].profit / employeeProfits[userId].revenue) * 100 : 0;

        // Track by day
        const saleDate = new Date(sale.created_at).toISOString().split('T')[0];
        if (!dailyProfits[saleDate]) {
          dailyProfits[saleDate] = {
            date: saleDate,
            revenue: 0,
            cost: 0,
            profit: 0,
            margin: 0,
            transactions: 0
          };
        }
        dailyProfits[saleDate].revenue += saleRevenue;
        dailyProfits[saleDate].cost += saleCost;
        dailyProfits[saleDate].profit += saleProfit;
        dailyProfits[saleDate].transactions += 1;
        dailyProfits[saleDate].margin = dailyProfits[saleDate].revenue > 0 ? 
          (dailyProfits[saleDate].profit / dailyProfits[saleDate].revenue) * 100 : 0;
      });

      // Calculate overall metrics
      const overallMargin = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;
      const averageCostPercentage = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0;

      // Sort and prepare data for display
      const topProfitableItems = Object.values(itemProfits)
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 10);

      const topProfitableCategories = Object.values(categoryProfits)
        .sort((a, b) => b.profit - a.profit);

      const employeePerformance = Object.values(employeeProfits)
        .sort((a, b) => b.profit - a.profit);

      const dailyTrends = Object.values(dailyProfits)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // Find items with concerning margins
      const lowMarginItems = Object.values(itemProfits)
        .filter(item => item.margin < 20 && item.revenue > 0)
        .sort((a, b) => a.margin - b.margin)
        .slice(0, 10);

      const highMarginItems = Object.values(itemProfits)
        .filter(item => item.margin > 50 && item.revenue > 0)
        .sort((a, b) => b.margin - a.margin)
        .slice(0, 10);

      setProfitData({
        overall: {
          totalRevenue,
          totalCost,
          totalGrossProfit,
          overallMargin,
          averageCostPercentage,
          totalTransactions: data.totalTransactions || 0
        },
        items: {
          topProfitable: topProfitableItems,
          lowMargin: lowMarginItems,
          highMargin: highMarginItems,
          totalItemsAnalyzed: Object.keys(itemProfits).length
        },
        categories: {
          breakdown: topProfitableCategories,
          totalCategories: topProfitableCategories.length
        },
        employees: {
          performance: employeePerformance,
          totalEmployees: employeePerformance.length
        },
        trends: {
          daily: dailyTrends,
          totalDays: dailyTrends.length
        }
      });

    } catch (err) {
      console.error('Error loading profit data:', err);
      setError('Failed to load profit analysis: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;
  const formatPercent = (percent) => `${(percent || 0).toFixed(1)}%`;

  const handleExportReport = () => {
    if (!profitData || !onExport) return;

    const csvContent = generateCSVReport();
    onExport(csvContent, 'csv', 'profit-margin-analysis');
  };

  const handleEmailReport = () => {
    if (!profitData || !onEmail) return;

    const csvContent = generateCSVReport();
    const emailContent = {
      subject: `Profit Margin Analysis Report - ${new Date().toLocaleDateString()}`,
      body: `Please find attached the Profit Margin Analysis Report.\n\nKey Metrics:\n- Total Revenue: ${formatCurrency(profitData.overall.totalRevenue)}\n- Total Cost: ${formatCurrency(profitData.overall.totalCost)}\n- Gross Profit: ${formatCurrency(profitData.overall.totalGrossProfit)}\n- Overall Margin: ${formatPercent(profitData.overall.overallMargin)}`
    };

    onEmail(emailContent, csvContent, 'profit-margin-analysis');
  };

  const generateCSVReport = () => {
    if (!profitData) return '';

    const rows = [
      ['Profit Margin Analysis Report'],
      ['Generated:', new Date().toLocaleString()],
      ['Period:', `${dateRange === 'custom' ? `${customDateStart} to ${customDateEnd}` : dateRange}`],
      [''],
      ['OVERALL METRICS'],
      ['Total Revenue', formatCurrency(profitData.overall.totalRevenue)],
      ['Total Cost', formatCurrency(profitData.overall.totalCost)],
      ['Gross Profit', formatCurrency(profitData.overall.totalGrossProfit)],
      ['Overall Margin', formatPercent(profitData.overall.overallMargin)],
      ['Average Cost %', formatPercent(profitData.overall.averageCostPercentage)],
      [''],
      ['TOP PROFITABLE ITEMS'],
      ['Item Name', 'Revenue', 'Cost', 'Profit', 'Margin %', 'Qty Sold'],
      ...profitData.items.topProfitable.map(item => [
        item.name,
        formatCurrency(item.revenue),
        formatCurrency(item.cost),
        formatCurrency(item.profit),
        formatPercent(item.margin),
        item.quantitySold
      ]),
      [''],
      ['CATEGORY BREAKDOWN'],
      ['Category', 'Revenue', 'Cost', 'Profit', 'Margin %'],
      ...profitData.categories.breakdown.map(cat => [
        cat.name,
        formatCurrency(cat.revenue),
        formatCurrency(cat.cost),
        formatCurrency(cat.profit),
        formatPercent(cat.margin)
      ])
    ];

    return 'data:text/csv;charset=utf-8,' + rows.map(row => row.join(',')).join('\n');
  };

  const handleAnalysisToggle = (analysis) => {
    setSelectedAnalysis(prev => ({
      ...prev,
      [analysis]: !prev[analysis]
    }));
  };

  const getMarginColor = (margin) => {
    if (margin >= 50) return TavariStyles.colors.success;
    if (margin >= 30) return TavariStyles.colors.warning;
    if (margin >= 10) return TavariStyles.colors.info;
    return TavariStyles.colors.danger;
  };

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows.md,
      overflow: 'hidden'
    },

    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md
    },

    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0
    },

    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },

    button: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },

    primaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm
    },

    content: {
      padding: TavariStyles.spacing.xl
    },

    loading: {
      ...TavariStyles.components.loading.container,
      minHeight: '200px'
    },

    error: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      margin: TavariStyles.spacing.lg
    },

    analysisSelector: {
      marginBottom: TavariStyles.spacing.xl,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },

    analysisGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.md
    },

    metricsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl
    },

    metricCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      textAlign: 'center'
    },

    metricValue: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },

    metricLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },

    analysisCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg
    },

    cardTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.sm
    },

    table: TavariStyles.components.table.table,
    tableContainer: TavariStyles.components.table.container,
    th: TavariStyles.components.table.th,
    td: TavariStyles.components.table.td,
    row: TavariStyles.components.table.row,

    marginCell: {
      ...TavariStyles.components.table.td,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },

    insightsCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.gray50,
      marginTop: TavariStyles.spacing.xl
    },

    warningItem: {
      color: TavariStyles.colors.danger,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },

    successItem: {
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },

    infoItem: {
      color: TavariStyles.colors.info,
      fontWeight: TavariStyles.typography.fontWeight.medium
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Profit Margin Analysis Report</h2>
        </div>
        <div style={styles.loading}>Analyzing profit margins...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Profit Margin Analysis Report</h2>
        </div>
        <div style={styles.error}>{error}</div>
      </div>
    );
  }

  if (!profitData) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Profit Margin Analysis Report</h2>
        </div>
        <div style={styles.content}>
          <p style={{ textAlign: 'center', color: TavariStyles.colors.gray500 }}>
            No profit data available for analysis. Ensure inventory items have cost prices configured.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Profit Margin Analysis Report</h2>
        <div style={styles.buttonGroup}>
          <button style={styles.button} onClick={handleExportReport}>
            Export CSV
          </button>
          <button style={styles.primaryButton} onClick={handleEmailReport}>
            Email Report
          </button>
        </div>
      </div>

      <div style={styles.content}>
        {/* Analysis Selector */}
        <div style={styles.analysisSelector}>
          <h3 style={{ margin: 0, marginBottom: TavariStyles.spacing.md, fontSize: TavariStyles.typography.fontSize.lg }}>
            Select Analysis Sections:
          </h3>
          <div style={styles.analysisGrid}>
            <TavariCheckbox
              checked={selectedAnalysis.overallMargins}
              onChange={() => handleAnalysisToggle('overallMargins')}
              label="Overall Profit Metrics"
              id="analysis-overall"
            />
            <TavariCheckbox
              checked={selectedAnalysis.itemMargins}
              onChange={() => handleAnalysisToggle('itemMargins')}
              label="Item Profitability"
              id="analysis-items"
            />
            <TavariCheckbox
              checked={selectedAnalysis.categoryMargins}
              onChange={() => handleAnalysisToggle('categoryMargins')}
              label="Category Analysis"
              id="analysis-categories"
            />
            <TavariCheckbox
              checked={selectedAnalysis.employeeImpact}
              onChange={() => handleAnalysisToggle('employeeImpact')}
              label="Employee Impact"
              id="analysis-employees"
            />
            <TavariCheckbox
              checked={selectedAnalysis.timeAnalysis}
              onChange={() => handleAnalysisToggle('timeAnalysis')}
              label="Time-based Trends"
              id="analysis-trends"
            />
            <TavariCheckbox
              checked={selectedAnalysis.costBreakdown}
              onChange={() => handleAnalysisToggle('costBreakdown')}
              label="Cost Breakdown"
              id="analysis-costs"
            />
          </div>
        </div>

        {/* Overall Metrics */}
        {selectedAnalysis.overallMargins && (
          <div style={styles.metricsGrid}>
            <div style={styles.metricCard}>
              <div style={styles.metricValue}>{formatCurrency(profitData.overall.totalRevenue)}</div>
              <div style={styles.metricLabel}>Total Revenue</div>
            </div>
            <div style={styles.metricCard}>
              <div style={styles.metricValue}>{formatCurrency(profitData.overall.totalCost)}</div>
              <div style={styles.metricLabel}>Total Cost</div>
            </div>
            <div style={styles.metricCard}>
              <div style={styles.metricValue}>{formatCurrency(profitData.overall.totalGrossProfit)}</div>
              <div style={styles.metricLabel}>Gross Profit</div>
            </div>
            <div style={styles.metricCard}>
              <div style={{...styles.metricValue, color: getMarginColor(profitData.overall.overallMargin)}}>
                {formatPercent(profitData.overall.overallMargin)}
              </div>
              <div style={styles.metricLabel}>Overall Margin</div>
            </div>
            <div style={styles.metricCard}>
              <div style={styles.metricValue}>{formatPercent(profitData.overall.averageCostPercentage)}</div>
              <div style={styles.metricLabel}>Avg Cost %</div>
            </div>
          </div>
        )}

        <div style={styles.analysisGrid}>
          {/* Item Profitability Analysis */}
          {selectedAnalysis.itemMargins && (
            <div style={styles.analysisCard}>
              <h3 style={styles.cardTitle}>Top Profitable Items</h3>
              
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr style={TavariStyles.components.table.headerRow}>
                      <th style={styles.th}>Item</th>
                      <th style={styles.th}>Revenue</th>
                      <th style={styles.th}>Profit</th>
                      <th style={styles.th}>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitData.items.topProfitable.slice(0, 8).map((item, index) => (
                      <tr key={index} style={styles.row}>
                        <td style={styles.td}>{item.name}</td>
                        <td style={styles.td}>{formatCurrency(item.revenue)}</td>
                        <td style={styles.td}>{formatCurrency(item.profit)}</td>
                        <td style={{...styles.marginCell, color: getMarginColor(item.margin)}}>
                          {formatPercent(item.margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Category Analysis */}
          {selectedAnalysis.categoryMargins && (
            <div style={styles.analysisCard}>
              <h3 style={styles.cardTitle}>Category Profitability</h3>
              
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr style={TavariStyles.components.table.headerRow}>
                      <th style={styles.th}>Category</th>
                      <th style={styles.th}>Revenue</th>
                      <th style={styles.th}>Profit</th>
                      <th style={styles.th}>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitData.categories.breakdown.map((category, index) => (
                      <tr key={index} style={styles.row}>
                        <td style={styles.td}>{category.name}</td>
                        <td style={styles.td}>{formatCurrency(category.revenue)}</td>
                        <td style={styles.td}>{formatCurrency(category.profit)}</td>
                        <td style={{...styles.marginCell, color: getMarginColor(category.margin)}}>
                          {formatPercent(category.margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Low Margin Items Alert */}
          {selectedAnalysis.itemMargins && profitData.items.lowMargin.length > 0 && (
            <div style={styles.analysisCard}>
              <h3 style={styles.cardTitle}>Low Margin Alert (Under 20%)</h3>
              
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr style={TavariStyles.components.table.headerRow}>
                      <th style={styles.th}>Item</th>
                      <th style={styles.th}>Revenue</th>
                      <th style={styles.th}>Margin</th>
                      <th style={styles.th}>Action Needed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitData.items.lowMargin.slice(0, 5).map((item, index) => (
                      <tr key={index} style={styles.row}>
                        <td style={styles.td}>{item.name}</td>
                        <td style={styles.td}>{formatCurrency(item.revenue)}</td>
                        <td style={{...styles.marginCell, color: TavariStyles.colors.danger}}>
                          {formatPercent(item.margin)}
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.warning }}>
                            Review pricing
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Employee Impact */}
          {selectedAnalysis.employeeImpact && (
            <div style={styles.analysisCard}>
              <h3 style={styles.cardTitle}>Employee Profit Impact</h3>
              
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr style={TavariStyles.components.table.headerRow}>
                      <th style={styles.th}>Employee</th>
                      <th style={styles.th}>Revenue</th>
                      <th style={styles.th}>Profit</th>
                      <th style={styles.th}>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitData.employees.performance.slice(0, 5).map((employee, index) => (
                      <tr key={index} style={styles.row}>
                        <td style={styles.td}>{employee.name}</td>
                        <td style={styles.td}>{formatCurrency(employee.revenue)}</td>
                        <td style={styles.td}>{formatCurrency(employee.profit)}</td>
                        <td style={{...styles.marginCell, color: getMarginColor(employee.margin)}}>
                          {formatPercent(employee.margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily Trends */}
          {selectedAnalysis.timeAnalysis && (
            <div style={styles.analysisCard}>
              <h3 style={styles.cardTitle}>Daily Profit Trends</h3>
              
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr style={TavariStyles.components.table.headerRow}>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Revenue</th>
                      <th style={styles.th}>Profit</th>
                      <th style={styles.th}>Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitData.trends.daily.slice(-7).map((day, index) => (
                      <tr key={index} style={styles.row}>
                        <td style={styles.td}>{new Date(day.date).toLocaleDateString()}</td>
                        <td style={styles.td}>{formatCurrency(day.revenue)}</td>
                        <td style={styles.td}>{formatCurrency(day.profit)}</td>
                        <td style={{...styles.marginCell, color: getMarginColor(day.margin)}}>
                          {formatPercent(day.margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Key Insights */}
        <div style={styles.insightsCard}>
          <h3 style={styles.cardTitle}>Key Profit Insights & Recommendations</h3>
          <div style={{ fontSize: TavariStyles.typography.fontSize.sm, lineHeight: TavariStyles.typography.lineHeight.relaxed }}>
            
            {profitData.overall.overallMargin > 40 ? (
              <p style={styles.successItem}>
                ✓ Excellent overall margin of {formatPercent(profitData.overall.overallMargin)} - well above industry standards.
              </p>
            ) : profitData.overall.overallMargin > 25 ? (
              <p style={styles.infoItem}>
                ℹ Good overall margin of {formatPercent(profitData.overall.overallMargin)} - consider optimizing further.
              </p>
            ) : (
              <p style={styles.warningItem}>
                ⚠ Low overall margin of {formatPercent(profitData.overall.overallMargin)} - immediate attention needed.
              </p>
            )}

            {profitData.items.lowMargin.length > 0 && (
              <p style={styles.warningItem}>
                ⚠ {profitData.items.lowMargin.length} items have margins below 20%. Consider repricing or reviewing costs.
              </p>
            )}

            {profitData.items.highMargin.length > 0 && (
              <p style={styles.successItem}>
                ✓ {profitData.items.highMargin.length} items have excellent margins above 50%. Consider promoting these items.
              </p>
            )}

            {profitData.categories.breakdown.length > 0 && (
              <p style={styles.infoItem}>
                ℹ Best performing category: {profitData.categories.breakdown[0].name} with {formatPercent(profitData.categories.breakdown[0].margin)} margin.
              </p>
            )}

            {profitData.overall.averageCostPercentage > 70 && (
              <p style={styles.warningItem}>
                ⚠ High cost percentage ({formatPercent(profitData.overall.averageCostPercentage)}) indicates need for supplier negotiations or price increases.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfitMarginAnalysisReport;
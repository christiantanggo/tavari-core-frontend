// src/components/Reports/EndOfPeriodSalesReport.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { logAction } from '../../helpers/posAudit';

const EndOfPeriodSalesReport = ({ 
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
    componentName: 'EndOfPeriodSalesReport'
  });

  const {
    calculateTotalTax,
    formatTaxAmount,
    getTaxSummary,
    applyCashRounding,
    loading: taxLoading,
    error: taxError
  } = useTaxCalculations(auth.selectedBusinessId);

  const [periodData, setPeriodData] = useState({
    salesSummary: {
      totalSales: 0,
      totalTransactions: 0,
      totalTax: 0,
      totalRefunds: 0,
      netSales: 0,
      averageTransaction: 0
    },
    paymentSummary: {},
    categorySummary: [],
    employeeSummary: [],
    topItems: [],
    periodComparison: null,
    drawerSummary: {
      openingCash: 0,
      cashSales: 0,
      expectedCash: 0,
      actualCash: 0,
      variance: 0
    },
    discountSummary: {
      totalDiscounts: 0,
      loyaltyDiscounts: 0,
      manualDiscounts: 0
    }
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [includeTaxDetails, setIncludeTaxDetails] = useState(true);
  const [includeDrawerInfo, setIncludeDrawerInfo] = useState(true);
  const [includeEmployeeBreakdown, setIncludeEmployeeBreakdown] = useState(true);
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadPeriodData();
    }
  }, [auth.selectedBusinessId, dateRange, customDateStart, customDateEnd, selectedEmployee]);

  const loadPeriodData = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      setLoading(true);
      setError(null);

      const { start, end } = getDateFilter();

      // Get comprehensive sales data
      let salesQuery = supabase
        .from('pos_sales')
        .select(`
          id, subtotal, tax, discount, loyalty_discount, total, created_at, user_id,
          pos_sale_items (
            id, inventory_id, name, quantity, unit_price, total_price, 
            category_id, tax_amount,
            pos_categories (name)
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .eq('payment_status', 'completed')
        .gte('created_at', start)
        .lt('created_at', end);

      if (selectedEmployee !== 'all') {
        salesQuery = salesQuery.eq('user_id', selectedEmployee);
      }

      const { data: sales, error: salesError } = await salesQuery;
      if (salesError) throw salesError;

      // Get payment data
      const { data: payments, error: paymentsError } = await supabase
        .from('pos_payments')
        .select('payment_method, amount, sale_id')
        .eq('business_id', auth.selectedBusinessId)
        .in('sale_id', sales?.map(s => s.id) || []);

      if (paymentsError) throw paymentsError;

      // Get refunds
      let refundsQuery = supabase
        .from('pos_refunds')
        .select('total_refund_amount, created_at, refunded_by')
        .eq('business_id', auth.selectedBusinessId)
        .gte('created_at', start)
        .lt('created_at', end);

      if (selectedEmployee !== 'all') {
        refundsQuery = refundsQuery.eq('refunded_by', selectedEmployee);
      }

      const { data: refunds, error: refundsError } = await refundsQuery;
      if (refundsError && refundsError.code !== 'PGRST116') throw refundsError;

      // Get drawer data if requested
      let drawerData = null;
      if (includeDrawerInfo) {
        const { data: drawers, error: drawerError } = await supabase
          .from('pos_drawers')
          .select('starting_cash, expected_cash, actual_cash, variance, opened_at, closed_at')
          .eq('business_id', auth.selectedBusinessId)
          .gte('opened_at', start)
          .lt('opened_at', end);

        if (drawerError && drawerError.code !== 'PGRST116') {
          console.warn('Could not load drawer data:', drawerError);
        } else {
          drawerData = drawers;
        }
      }

      // Get comparison data if needed
      let comparisonData = null;
      if (showComparison) {
        comparisonData = await loadComparisonData(start, end);
      }

      // Process all data
      const processedData = processPeriodData(
        sales || [], 
        payments || [], 
        refunds || [], 
        drawerData || [],
        comparisonData
      );
      
      setPeriodData(processedData);

    } catch (err) {
      console.error('Error loading period data:', err);
      setError('Failed to load end-of-period data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadComparisonData = async (currentStart, currentEnd) => {
    try {
      // Calculate previous period dates
      const currentStartDate = new Date(currentStart);
      const currentEndDate = new Date(currentEnd);
      const periodLength = currentEndDate - currentStartDate;
      
      const previousStart = new Date(currentStartDate.getTime() - periodLength);
      const previousEnd = new Date(currentStartDate);

      let previousSalesQuery = supabase
        .from('pos_sales')
        .select('total, tax, discount, loyalty_discount')
        .eq('business_id', auth.selectedBusinessId)
        .eq('payment_status', 'completed')
        .gte('created_at', previousStart.toISOString())
        .lt('created_at', previousEnd.toISOString());

      if (selectedEmployee !== 'all') {
        previousSalesQuery = previousSalesQuery.eq('user_id', selectedEmployee);
      }

      const { data: previousSales, error } = await previousSalesQuery;
      if (error) throw error;

      const previousTotal = (previousSales || []).reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
      const previousTransactions = (previousSales || []).length;

      return {
        previousTotal,
        previousTransactions,
        periodLabel: formatPeriodLabel(previousStart, previousEnd)
      };
    } catch (err) {
      console.warn('Could not load comparison data:', err);
      return null;
    }
  };

  const processPeriodData = (sales, payments, refunds, drawers, comparison) => {
    // Sales Summary
    const totalSales = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    const totalTax = sales.reduce((sum, sale) => sum + (Number(sale.tax) || 0), 0);
    const totalDiscounts = sales.reduce((sum, sale) => sum + (Number(sale.discount) || 0), 0);
    const totalLoyaltyDiscounts = sales.reduce((sum, sale) => sum + (Number(sale.loyalty_discount) || 0), 0);
    const totalRefunds = refunds.reduce((sum, refund) => sum + (Number(refund.total_refund_amount) || 0), 0);
    const netSales = totalSales - totalRefunds;
    const totalTransactions = sales.length;
    const averageTransaction = totalTransactions > 0 ? totalSales / totalTransactions : 0;

    // Payment Summary
    const paymentSummary = {};
    payments.forEach(payment => {
      const method = payment.payment_method || 'unknown';
      paymentSummary[method] = (paymentSummary[method] || 0) + (Number(payment.amount) || 0);
    });

    // Category Summary
    const categorySummary = {};
    sales.forEach(sale => {
      if (sale.pos_sale_items) {
        sale.pos_sale_items.forEach(item => {
          const categoryName = item.pos_categories?.name || 'Uncategorized';
          if (!categorySummary[categoryName]) {
            categorySummary[categoryName] = {
              name: categoryName,
              revenue: 0,
              quantity: 0,
              items: 0
            };
          }
          categorySummary[categoryName].revenue += Number(item.total_price) || 0;
          categorySummary[categoryName].quantity += Number(item.quantity) || 0;
          categorySummary[categoryName].items += 1;
        });
      }
    });

    // Employee Summary
    const employeeSummary = {};
    sales.forEach(sale => {
      const userId = sale.user_id;
      if (!employeeSummary[userId]) {
        const employee = employees.find(e => e.id === userId);
        employeeSummary[userId] = {
          id: userId,
          name: employee ? (employee.full_name || employee.email) : 'Unknown',
          sales: 0,
          transactions: 0,
          averageTransaction: 0
        };
      }
      employeeSummary[userId].sales += Number(sale.total) || 0;
      employeeSummary[userId].transactions += 1;
    });

    // Calculate average transactions for employees
    Object.values(employeeSummary).forEach(emp => {
      emp.averageTransaction = emp.transactions > 0 ? emp.sales / emp.transactions : 0;
    });

    // Top Items
    const itemSummary = {};
    sales.forEach(sale => {
      if (sale.pos_sale_items) {
        sale.pos_sale_items.forEach(item => {
          const itemName = item.name;
          if (!itemSummary[itemName]) {
            itemSummary[itemName] = {
              name: itemName,
              revenue: 0,
              quantity: 0
            };
          }
          itemSummary[itemName].revenue += Number(item.total_price) || 0;
          itemSummary[itemName].quantity += Number(item.quantity) || 0;
        });
      }
    });

    const topItems = Object.values(itemSummary)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Drawer Summary
    const drawerSummary = {
      openingCash: drawers.reduce((sum, d) => sum + (Number(d.starting_cash) || 0), 0),
      expectedCash: drawers.reduce((sum, d) => sum + (Number(d.expected_cash) || 0), 0),
      actualCash: drawers.reduce((sum, d) => sum + (Number(d.actual_cash) || 0), 0),
      variance: drawers.reduce((sum, d) => sum + (Number(d.variance) || 0), 0),
      drawerCount: drawers.length
    };

    // Calculate cash sales from payments
    const cashSales = paymentSummary['cash'] || 0;
    drawerSummary.cashSales = cashSales;

    return {
      salesSummary: {
        totalSales,
        totalTransactions,
        totalTax,
        totalRefunds,
        netSales,
        averageTransaction
      },
      paymentSummary,
      categorySummary: Object.values(categorySummary).sort((a, b) => b.revenue - a.revenue),
      employeeSummary: Object.values(employeeSummary).sort((a, b) => b.sales - a.sales),
      topItems,
      periodComparison: comparison,
      drawerSummary,
      discountSummary: {
        totalDiscounts,
        loyaltyDiscounts: totalLoyaltyDiscounts,
        manualDiscounts: totalDiscounts - totalLoyaltyDiscounts
      }
    };
  };

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

  const formatPeriodLabel = (start, end) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    if (startDate.toDateString() === endDate.toDateString()) {
      return startDate.toLocaleDateString();
    }
    
    return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
  };

  const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;
  const formatPercentage = (percent) => `${(percent || 0).toFixed(1)}%`;

  const exportData = {
    csv: () => {
      const { start, end } = getDateRangeText();
      let csvContent = "data:text/csv;charset=utf-8,";
      
      csvContent += "End-of-Period Sales Report\n";
      csvContent += `Period,${start} to ${end}\n`;
      csvContent += `Employee Filter,${getEmployeeName()}\n`;
      csvContent += `Generated,${new Date().toLocaleString()}\n\n`;
      
      // Sales Summary
      csvContent += "Sales Summary\n";
      csvContent += `Total Sales,${periodData.salesSummary.totalSales.toFixed(2)}\n`;
      csvContent += `Total Transactions,${periodData.salesSummary.totalTransactions}\n`;
      csvContent += `Average Transaction,${periodData.salesSummary.averageTransaction.toFixed(2)}\n`;
      csvContent += `Total Tax,${periodData.salesSummary.totalTax.toFixed(2)}\n`;
      csvContent += `Total Refunds,${periodData.salesSummary.totalRefunds.toFixed(2)}\n`;
      csvContent += `Net Sales,${periodData.salesSummary.netSales.toFixed(2)}\n\n`;
      
      // Payment Methods
      csvContent += "Payment Methods\n";
      csvContent += "Method,Amount\n";
      Object.entries(periodData.paymentSummary).forEach(([method, amount]) => {
        csvContent += `${method},${amount.toFixed(2)}\n`;
      });
      csvContent += "\n";
      
      // Top Categories
      csvContent += "Category Performance\n";
      csvContent += "Category,Revenue,Quantity,Items\n";
      periodData.categorySummary.forEach(cat => {
        csvContent += `${cat.name},${cat.revenue.toFixed(2)},${cat.quantity},${cat.items}\n`;
      });
      csvContent += "\n";
      
      // Employee Performance
      if (includeEmployeeBreakdown) {
        csvContent += "Employee Performance\n";
        csvContent += "Employee,Sales,Transactions,Average Transaction\n";
        periodData.employeeSummary.forEach(emp => {
          csvContent += `${emp.name},${emp.sales.toFixed(2)},${emp.transactions},${emp.averageTransaction.toFixed(2)}\n`;
        });
        csvContent += "\n";
      }
      
      // Drawer Summary
      if (includeDrawerInfo && periodData.drawerSummary.drawerCount > 0) {
        csvContent += "Cash Drawer Summary\n";
        csvContent += `Opening Cash,${periodData.drawerSummary.openingCash.toFixed(2)}\n`;
        csvContent += `Cash Sales,${periodData.drawerSummary.cashSales.toFixed(2)}\n`;
        csvContent += `Expected Cash,${periodData.drawerSummary.expectedCash.toFixed(2)}\n`;
        csvContent += `Actual Cash,${periodData.drawerSummary.actualCash.toFixed(2)}\n`;
        csvContent += `Variance,${periodData.drawerSummary.variance.toFixed(2)}\n`;
      }
      
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
    subject: `End-of-Period Sales Report - ${getDateRangeText().start} to ${getDateRangeText().end}`,
    body: `
End-of-Period Sales Report

Period: ${getDateRangeText().start} to ${getDateRangeText().end}
Employee Filter: ${getEmployeeName()}
Generated: ${new Date().toLocaleString()}

SALES SUMMARY:
- Total Sales: ${formatCurrency(periodData.salesSummary.totalSales)}
- Total Transactions: ${periodData.salesSummary.totalTransactions}
- Average Transaction: ${formatCurrency(periodData.salesSummary.averageTransaction)}
- Total Tax: ${formatCurrency(periodData.salesSummary.totalTax)}
- Net Sales: ${formatCurrency(periodData.salesSummary.netSales)}

TOP PAYMENT METHODS:
${Object.entries(periodData.paymentSummary)
  .sort(([,a], [,b]) => b - a)
  .slice(0, 3)
  .map(([method, amount]) => `• ${method}: ${formatCurrency(amount)}`)
  .join('\n')}

TOP CATEGORIES:
${periodData.categorySummary.slice(0, 5).map(cat => 
  `• ${cat.name}: ${formatCurrency(cat.revenue)}`
).join('\n')}

${periodData.periodComparison ? `
PERIOD COMPARISON:
- Previous Period: ${formatCurrency(periodData.periodComparison.previousTotal)}
- Growth: ${formatCurrency(periodData.salesSummary.totalSales - periodData.periodComparison.previousTotal)}
- Change: ${formatPercentage(((periodData.salesSummary.totalSales - periodData.periodComparison.previousTotal) / periodData.periodComparison.previousTotal) * 100)}
` : ''}

This comprehensive report summarizes all business activity for the selected period.
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
      onExport(content, format, 'end-period');
      
      logAction({
        action: 'end_period_report_exported',
        context: 'EndOfPeriodSalesReport',
        metadata: {
          format,
          date_range: dateRange,
          total_sales: periodData.salesSummary.totalSales,
          business_id: auth.selectedBusinessId
        }
      });
    }
  };

  const handleEmail = () => {
    const content = emailContent();
    onEmail(content, exportData.csv(), 'end-period');
    
    logAction({
      action: 'end_period_report_emailed',
      context: 'EndOfPeriodSalesReport',
      metadata: {
        date_range: dateRange,
        total_sales: periodData.salesSummary.totalSales,
        business_id: auth.selectedBusinessId
      }
    });
  };

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows.sm,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg,
      width: '100%'
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.lg,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center',
      flexWrap: 'wrap'
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
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg,
      alignItems: 'center',
      flexWrap: 'wrap'
    },
    
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg
    },
    
    summaryCard: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      textAlign: 'center'
    },
    
    summaryValue: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.xs
    },
    
    summaryLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    section: {
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      overflow: 'hidden'
    },
    
    th: {
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray100,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      textAlign: 'left',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.xs,
      textTransform: 'uppercase'
    },
    
    td: {
      padding: TavariStyles.spacing.sm,
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
      verticalAlign: 'middle'
    },
    
    comparisonSection: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.blue50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.blue200}`
    },
    
    comparisonGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.sm
    },
    
    comparisonItem: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    noData: {
      textAlign: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic'
    },
    
    error: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.md
    },
    
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray500
    }
  };

  if (loading || taxLoading) {
    return <div style={styles.loading}>Loading end-of-period data...</div>;
  }

  if (error || taxError) {
    return <div style={styles.error}>{error || taxError}</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>End-of-Period Sales Report</h3>
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

      <div style={styles.controls}>
        <TavariCheckbox
          checked={includeTaxDetails}
          onChange={setIncludeTaxDetails}
          label="Include Tax Details"
          id="include-tax-details"
        />
        
        <TavariCheckbox
          checked={includeDrawerInfo}
          onChange={setIncludeDrawerInfo}
          label="Include Drawer Info"
          id="include-drawer-info"
        />
        
        <TavariCheckbox
          checked={includeEmployeeBreakdown}
          onChange={setIncludeEmployeeBreakdown}
          label="Include Employee Breakdown"
          id="include-employee-breakdown"
        />

        <TavariCheckbox
          checked={showComparison}
          onChange={setShowComparison}
          label="Show Period Comparison"
          id="show-comparison"
        />
      </div>

      {/* Sales Summary */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(periodData.salesSummary.totalSales)}</div>
          <div style={styles.summaryLabel}>Total Sales</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{periodData.salesSummary.totalTransactions}</div>
          <div style={styles.summaryLabel}>Total Transactions</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(periodData.salesSummary.averageTransaction)}</div>
          <div style={styles.summaryLabel}>Avg Transaction</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(periodData.salesSummary.totalTax)}</div>
          <div style={styles.summaryLabel}>Total Tax</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(periodData.salesSummary.totalRefunds)}</div>
          <div style={styles.summaryLabel}>Total Refunds</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(periodData.salesSummary.netSales)}</div>
          <div style={styles.summaryLabel}>Net Sales</div>
        </div>
      </div>

      {/* Period Comparison */}
      {showComparison && periodData.periodComparison && (
        <div style={styles.comparisonSection}>
          <h4 style={styles.sectionTitle}>Period Comparison</h4>
          <div style={styles.comparisonGrid}>
            <div style={styles.comparisonItem}>
              <span>Previous Period:</span>
              <span>{formatCurrency(periodData.periodComparison.previousTotal)}</span>
            </div>
            <div style={styles.comparisonItem}>
              <span>Growth:</span>
              <span style={{
                color: (periodData.salesSummary.totalSales - periodData.periodComparison.previousTotal) >= 0 
                  ? TavariStyles.colors.success : TavariStyles.colors.danger
              }}>
                {formatCurrency(periodData.salesSummary.totalSales - periodData.periodComparison.previousTotal)}
              </span>
            </div>
            <div style={styles.comparisonItem}>
              <span>% Change:</span>
              <span style={{
                color: (periodData.salesSummary.totalSales - periodData.periodComparison.previousTotal) >= 0 
                  ? TavariStyles.colors.success : TavariStyles.colors.danger
              }}>
                {formatPercentage(((periodData.salesSummary.totalSales - periodData.periodComparison.previousTotal) / periodData.periodComparison.previousTotal) * 100)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Payment Methods */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Payment Method Summary</h4>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Payment Method</th>
              <th style={styles.th}>Amount</th>
              <th style={styles.th}>Percentage</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(periodData.paymentSummary)
              .sort(([,a], [,b]) => b - a)
              .map(([method, amount]) => (
              <tr key={method}>
                <td style={styles.td}>{method.charAt(0).toUpperCase() + method.slice(1)}</td>
                <td style={styles.td}>{formatCurrency(amount)}</td>
                <td style={styles.td}>
                  {formatPercentage((amount / periodData.salesSummary.totalSales) * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Category Performance */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Category Performance</h4>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Revenue</th>
              <th style={styles.th}>Quantity</th>
              <th style={styles.th}>Items</th>
              <th style={styles.th}>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {periodData.categorySummary.map((category, index) => (
              <tr key={index}>
                <td style={styles.td}>{category.name}</td>
                <td style={styles.td}>{formatCurrency(category.revenue)}</td>
                <td style={styles.td}>{category.quantity}</td>
                <td style={styles.td}>{category.items}</td>
                <td style={styles.td}>
                  {formatPercentage((category.revenue / periodData.salesSummary.totalSales) * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Employee Performance */}
      {includeEmployeeBreakdown && periodData.employeeSummary.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Employee Performance</h4>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Employee</th>
                <th style={styles.th}>Sales</th>
                <th style={styles.th}>Transactions</th>
                <th style={styles.th}>Avg Transaction</th>
                <th style={styles.th}>% of Total</th>
              </tr>
            </thead>
            <tbody>
              {periodData.employeeSummary.map((employee, index) => (
                <tr key={index}>
                  <td style={styles.td}>{employee.name}</td>
                  <td style={styles.td}>{formatCurrency(employee.sales)}</td>
                  <td style={styles.td}>{employee.transactions}</td>
                  <td style={styles.td}>{formatCurrency(employee.averageTransaction)}</td>
                  <td style={styles.td}>
                    {formatPercentage((employee.sales / periodData.salesSummary.totalSales) * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cash Drawer Summary */}
      {includeDrawerInfo && periodData.drawerSummary.drawerCount > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Cash Drawer Summary</h4>
          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{formatCurrency(periodData.drawerSummary.openingCash)}</div>
              <div style={styles.summaryLabel}>Opening Cash</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{formatCurrency(periodData.drawerSummary.cashSales)}</div>
              <div style={styles.summaryLabel}>Cash Sales</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{formatCurrency(periodData.drawerSummary.expectedCash)}</div>
              <div style={styles.summaryLabel}>Expected Cash</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{formatCurrency(periodData.drawerSummary.actualCash)}</div>
              <div style={styles.summaryLabel}>Actual Cash</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={{
                ...styles.summaryValue,
                color: Math.abs(periodData.drawerSummary.variance) > 5 ? TavariStyles.colors.danger : TavariStyles.colors.success
              }}>
                {formatCurrency(periodData.drawerSummary.variance)}
              </div>
              <div style={styles.summaryLabel}>Variance</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{periodData.drawerSummary.drawerCount}</div>
              <div style={styles.summaryLabel}>Drawers</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Items */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Top Selling Items</h4>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Item</th>
              <th style={styles.th}>Revenue</th>
              <th style={styles.th}>Quantity</th>
              <th style={styles.th}>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {periodData.topItems.map((item, index) => (
              <tr key={index}>
                <td style={styles.td}>{item.name}</td>
                <td style={styles.td}>{formatCurrency(item.revenue)}</td>
                <td style={styles.td}>{item.quantity}</td>
                <td style={styles.td}>
                  {formatPercentage((item.revenue / periodData.salesSummary.totalSales) * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {periodData.salesSummary.totalTransactions === 0 && (
        <div style={styles.noData}>
          No sales data found for this period
        </div>
      )}
    </div>
  );
};

export default EndOfPeriodSalesReport;
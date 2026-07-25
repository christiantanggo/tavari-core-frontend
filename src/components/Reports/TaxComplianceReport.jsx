// src/components/Reports/TaxComplianceReport.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { logAction } from '../../helpers/posAudit';

const TaxComplianceReport = ({ 
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
    componentName: 'TaxComplianceReport'
  });

  const {
    calculateTotalTax,
    formatTaxAmount,
    getTaxSummary,
    applyCashRounding,
    loading: taxLoading,
    error: taxError
  } = useTaxCalculations(auth.selectedBusinessId);

  const [taxData, setTaxData] = useState({
    salesTaxBreakdown: [],
    totalTaxCollected: 0,
    totalTaxableAmount: 0,
    totalExemptAmount: 0,
    taxByCategory: [],
    taxByRate: [],
    refundedTax: 0,
    netTaxOwed: 0,
    aggregatedTaxes: {},
    aggregatedRebates: {},
    indianStatusTransactions: [],
    indianStatusSummary: {
      transactionCount: 0,
      subtotal: 0,
      taxCollected: 0,
      total: 0,
      rebates: 0
    }
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [includeRefunds, setIncludeRefunds] = useState(true);
  const [showByCategory, setShowByCategory] = useState(true);
  const [showByRate, setShowByRate] = useState(true);

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadTaxData();
    }
  }, [auth.selectedBusinessId, dateRange, customDateStart, customDateEnd, selectedEmployee, includeRefunds]);

  const loadTaxData = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      setLoading(true);
      setError(null);

      const { start, end } = getDateFilter();

      // Get sales data with tax information
      let salesQuery = supabase
        .from('pos_sales')
        .select(`
          id, subtotal, tax, total, created_at, user_id, aggregated_taxes, aggregated_rebates,
          indian_status_gst_only, indian_status_certificate_number,
          pos_sale_items (
            id, inventory_id, name, quantity, unit_price, total_price, 
            category_id, tax_rate, tax_exempt, tax_amount, tax_details,
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

      // Get refunds if included
      let refunds = [];
      if (includeRefunds) {
        let refundsQuery = supabase
          .from('pos_refunds')
          .select('total_refund_amount, created_at, refunded_by')
          .eq('business_id', auth.selectedBusinessId)
          .gte('created_at', start)
          .lt('created_at', end);

        if (selectedEmployee !== 'all') {
          refundsQuery = refundsQuery.eq('refunded_by', selectedEmployee);
        }

        const { data: refundData, error: refundsError } = await refundsQuery;
        if (refundsError && refundsError.code !== 'PGRST116') throw refundsError;
        refunds = refundData || [];
      }

      // Get tax categories for reference
      const { data: taxCategories } = await supabase
        .from('pos_tax_categories')
        .select('id, name, rate')
        .eq('business_id', auth.selectedBusinessId);

      // Process tax data
      const processedTaxData = processTaxData(sales || [], refunds, taxCategories || []);
      setTaxData(processedTaxData);

    } catch (err) {
      console.error('Error loading tax data:', err);
      setError('Failed to load tax compliance data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const processTaxData = (sales, refunds, taxCategories) => {
    let totalTaxCollected = 0;
    let totalTaxableAmount = 0;
    let totalExemptAmount = 0;
    let refundedTax = 0;
    
    const taxByRate = {};
    const taxByCategory = {};
    const salesTaxBreakdown = [];
    const aggregatedTaxes = {};
    const aggregatedRebates = {};
    const indianStatusTransactions = [];
    const indianStatusSummary = {
      transactionCount: 0,
      subtotal: 0,
      taxCollected: 0,
      total: 0,
      rebates: 0
    };

    // First pass: calculate totals for effective tax rate
    sales.forEach(sale => {
      totalTaxCollected += Number(sale.tax) || 0;
      totalTaxableAmount += Number(sale.subtotal) || 0;
    });

    const effectiveTaxRate = totalTaxableAmount > 0 ? (totalTaxCollected / totalTaxableAmount) : 0;

    // Reset counters for detailed processing
    totalTaxCollected = 0;
    totalTaxableAmount = 0;
    totalExemptAmount = 0;

    // Process sales data
    sales.forEach(sale => {
      const saleDate = new Date(sale.created_at);
      const saleTax = Number(sale.tax) || 0;
      totalTaxCollected += saleTax;

      // Process aggregated taxes from the sale
      if (sale.aggregated_taxes && typeof sale.aggregated_taxes === 'object') {
        Object.entries(sale.aggregated_taxes).forEach(([taxType, amount]) => {
          aggregatedTaxes[taxType] = (aggregatedTaxes[taxType] || 0) + Number(amount);
        });
      }

      // Process aggregated rebates from the sale
      if (sale.aggregated_rebates && typeof sale.aggregated_rebates === 'object') {
        Object.entries(sale.aggregated_rebates).forEach(([rebateType, amount]) => {
          aggregatedRebates[rebateType] = (aggregatedRebates[rebateType] || 0) + Number(amount);
        });
      }

      if (sale.indian_status_gst_only || sale.indian_status_certificate_number) {
        const saleRebates = sale.aggregated_rebates && typeof sale.aggregated_rebates === 'object'
          ? Object.values(sale.aggregated_rebates).reduce((sum, amount) => sum + Number(amount || 0), 0)
          : 0;

        indianStatusTransactions.push({
          saleId: sale.id,
          date: sale.created_at,
          certificateNumber: sale.indian_status_certificate_number || 'Not provided',
          gstOnly: !!sale.indian_status_gst_only,
          subtotal: Number(sale.subtotal) || 0,
          taxCollected: saleTax,
          total: Number(sale.total) || 0,
          aggregatedTaxes: sale.aggregated_taxes || {},
          aggregatedRebates: sale.aggregated_rebates || {},
          rebateTotal: saleRebates
        });

        indianStatusSummary.transactionCount += 1;
        indianStatusSummary.subtotal += Number(sale.subtotal) || 0;
        indianStatusSummary.taxCollected += saleTax;
        indianStatusSummary.total += Number(sale.total) || 0;
        indianStatusSummary.rebates += saleRebates;
      }

      // Process individual items for detailed breakdown
      if (sale.pos_sale_items) {
        sale.pos_sale_items.forEach(item => {
          const itemTotal = Number(item.total_price) || 0;
          const itemTaxRate = Number(item.tax_rate) || 0;
          const itemTaxAmount = Number(item.tax_amount) || 0;
          const isExempt = item.tax_exempt;
          const categoryName = item.pos_categories?.name || 'Uncategorized';

          if (isExempt) {
            totalExemptAmount += itemTotal;
          } else {
            totalTaxableAmount += itemTotal;
            
            // Group by tax rate
            const rateKey = (itemTaxRate * 100).toFixed(2) + '%';
            if (!taxByRate[rateKey]) {
              taxByRate[rateKey] = {
                rate: itemTaxRate,
                taxableAmount: 0,
                taxCollected: 0,
                itemCount: 0
              };
            }
            
            taxByRate[rateKey].taxableAmount += itemTotal;
            taxByRate[rateKey].taxCollected += itemTaxAmount;
            taxByRate[rateKey].itemCount += Number(item.quantity) || 0;

            // Group by category
            if (!taxByCategory[categoryName]) {
              taxByCategory[categoryName] = {
                category: categoryName,
                taxableAmount: 0,
                taxCollected: 0,
                itemCount: 0
              };
            }
            
            taxByCategory[categoryName].taxableAmount += itemTotal;
            taxByCategory[categoryName].taxCollected += itemTaxAmount;
            taxByCategory[categoryName].itemCount += Number(item.quantity) || 0;
          }
        });
      }

      // Add to daily breakdown
      const dateKey = saleDate.toISOString().split('T')[0];
      const existingDay = salesTaxBreakdown.find(day => day.date === dateKey);
      
      if (existingDay) {
        existingDay.taxCollected += saleTax;
        existingDay.taxableAmount += Number(sale.subtotal) || 0;
        existingDay.transactionCount += 1;
      } else {
        salesTaxBreakdown.push({
          date: dateKey,
          taxCollected: saleTax,
          taxableAmount: Number(sale.subtotal) || 0,
          transactionCount: 1
        });
      }
    });

    // Process refunds - estimate tax from total refund using effective rate
    refunds.forEach(refund => {
      const estimatedTaxFromRefund = (Number(refund.total_refund_amount) || 0) * effectiveTaxRate;
      refundedTax += estimatedTaxFromRefund;
    });

    const netTaxOwed = totalTaxCollected - refundedTax;

    return {
      salesTaxBreakdown: salesTaxBreakdown.sort((a, b) => new Date(a.date) - new Date(b.date)),
      totalTaxCollected,
      totalTaxableAmount,
      totalExemptAmount,
      taxByCategory: Object.values(taxByCategory).sort((a, b) => b.taxCollected - a.taxCollected),
      taxByRate: Object.entries(taxByRate).map(([rate, data]) => ({
        rate,
        ...data
      })).sort((a, b) => b.taxCollected - a.taxCollected),
      refundedTax,
      netTaxOwed,
      aggregatedTaxes,
      aggregatedRebates,
      indianStatusTransactions: indianStatusTransactions.sort((a, b) => new Date(b.date) - new Date(a.date)),
      indianStatusSummary
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

  const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;
  const formatPercentage = (percent) => `${(percent * 100 || 0).toFixed(2)}%`;
  const formatDate = (dateString) => new Date(dateString).toLocaleDateString();
  const formatTaxMap = (values = {}) => {
    if (!values || Object.keys(values).length === 0) return 'None';
    return Object.entries(values)
      .map(([type, amount]) => `${type}: ${formatCurrency(Number(amount) || 0)}`)
      .join(' | ');
  };

  const exportData = {
    csv: () => {
      const { start, end } = getDateRangeText();
      let csvContent = "data:text/csv;charset=utf-8,";
      
      csvContent += "Tax Compliance Report\n";
      csvContent += `Period,${start} to ${end}\n`;
      csvContent += `Employee Filter,${getEmployeeName()}\n`;
      csvContent += `Generated,${new Date().toLocaleString()}\n\n`;
      
      // Summary
      csvContent += "Tax Summary\n";
      csvContent += `Total Taxable Amount,${taxData.totalTaxableAmount.toFixed(2)}\n`;
      csvContent += `Total Tax Collected,${taxData.totalTaxCollected.toFixed(2)}\n`;
      csvContent += `Total Tax Exempt,${taxData.totalExemptAmount.toFixed(2)}\n`;
      csvContent += `Tax Refunded (Estimated),${taxData.refundedTax.toFixed(2)}\n`;
      csvContent += `Net Tax Owed,${taxData.netTaxOwed.toFixed(2)}\n\n`;
      
      // Aggregated Taxes
      if (Object.keys(taxData.aggregatedTaxes).length > 0) {
        csvContent += "Aggregated Taxes by Type\n";
        csvContent += "Tax Type,Amount\n";
        Object.entries(taxData.aggregatedTaxes).forEach(([type, amount]) => {
          csvContent += `${type},${amount.toFixed(2)}\n`;
        });
        csvContent += "\n";
      }

      // By Tax Rate
      if (taxData.taxByRate.length > 0) {
        csvContent += "Tax by Rate\n";
        csvContent += "Rate,Taxable Amount,Tax Collected,Items\n";
        taxData.taxByRate.forEach(rate => {
          csvContent += `${rate.rate},${rate.taxableAmount.toFixed(2)},${rate.taxCollected.toFixed(2)},${rate.itemCount}\n`;
        });
        csvContent += "\n";
      }
      
      // By Category
      if (taxData.taxByCategory.length > 0) {
        csvContent += "Tax by Category\n";
        csvContent += "Category,Taxable Amount,Tax Collected,Items\n";
        taxData.taxByCategory.forEach(cat => {
          csvContent += `${cat.category},${cat.taxableAmount.toFixed(2)},${cat.taxCollected.toFixed(2)},${cat.itemCount}\n`;
        });
        csvContent += "\n";
      }

      if (taxData.indianStatusTransactions.length > 0) {
        csvContent += "Indian Status Transactions\n";
        csvContent += "Date,Certificate Number,GST Only,Subtotal,Tax Collected,Total,Tax Breakdown,Tax Rebates\n";
        taxData.indianStatusTransactions.forEach((transaction) => {
          csvContent += `${formatDate(transaction.date)},${transaction.certificateNumber},${transaction.gstOnly ? 'Yes' : 'No'},${transaction.subtotal.toFixed(2)},${transaction.taxCollected.toFixed(2)},${transaction.total.toFixed(2)},"${formatTaxMap(transaction.aggregatedTaxes)}","${formatTaxMap(transaction.aggregatedRebates)}"\n`;
        });
        csvContent += "\n";
      }
      
      // Daily Breakdown
      csvContent += "Daily Tax Breakdown\n";
      csvContent += "Date,Taxable Amount,Tax Collected,Transactions\n";
      taxData.salesTaxBreakdown.forEach(day => {
        csvContent += `${day.date},${day.taxableAmount.toFixed(2)},${day.taxCollected.toFixed(2)},${day.transactionCount}\n`;
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
    subject: `Tax Compliance Report - ${getDateRangeText().start} to ${getDateRangeText().end}`,
    body: `
Tax Compliance Report

Period: ${getDateRangeText().start} to ${getDateRangeText().end}
Employee Filter: ${getEmployeeName()}
Generated: ${new Date().toLocaleString()}

TAX SUMMARY:
- Total Taxable Amount: ${formatCurrency(taxData.totalTaxableAmount)}
- Total Tax Collected: ${formatCurrency(taxData.totalTaxCollected)}
- Tax Exempt Sales: ${formatCurrency(taxData.totalExemptAmount)}
- Tax Refunded (Estimated): ${formatCurrency(taxData.refundedTax)}
- Net Tax Owed: ${formatCurrency(taxData.netTaxOwed)}

EFFECTIVE TAX RATE: ${formatPercentage(taxData.totalTaxableAmount > 0 ? taxData.totalTaxCollected / taxData.totalTaxableAmount : 0)}

${Object.keys(taxData.aggregatedTaxes).length > 0 ? `
AGGREGATED TAXES:
${Object.entries(taxData.aggregatedTaxes).map(([type, amount]) => 
  `• ${type}: ${formatCurrency(amount)}`
).join('\n')}
` : ''}

${taxData.indianStatusTransactions.length > 0 ? `
INDIAN STATUS TRANSACTIONS:
- Count: ${taxData.indianStatusSummary.transactionCount}
- Subtotal: ${formatCurrency(taxData.indianStatusSummary.subtotal)}
- Tax Collected: ${formatCurrency(taxData.indianStatusSummary.taxCollected)}
- Tax Rebates: ${formatCurrency(taxData.indianStatusSummary.rebates)}

${taxData.indianStatusTransactions.map((transaction) =>
  `• ${formatDate(transaction.date)} | Cert ${transaction.certificateNumber} | GST Only: ${transaction.gstOnly ? 'Yes' : 'No'} | Tax: ${formatCurrency(transaction.taxCollected)} | Taxes: ${formatTaxMap(transaction.aggregatedTaxes)} | Rebates: ${formatTaxMap(transaction.aggregatedRebates)}`
).join('\n')}
` : ''}

This report provides tax compliance data for regulatory filing purposes.
Note: Tax refunded amounts are estimated based on effective tax rate.
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
      onExport(content, format, 'tax-report');
      
      logAction({
        action: 'tax_compliance_report_exported',
        context: 'TaxComplianceReport',
        metadata: {
          format,
          date_range: dateRange,
          total_tax_collected: taxData.totalTaxCollected,
          business_id: auth.selectedBusinessId
        }
      });
    }
  };

  const handleEmail = () => {
    const content = emailContent();
    onEmail(content, exportData.csv(), 'tax-report');
    
    logAction({
      action: 'tax_compliance_report_emailed',
      context: 'TaxComplianceReport',
      metadata: {
        date_range: dateRange,
        total_tax_collected: taxData.totalTaxCollected,
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
    
    aggregatedTaxGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.sm
    },
    
    aggregatedTaxItem: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },

    noteText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
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
    return <div style={styles.loading}>Loading tax compliance data...</div>;
  }

  if (error || taxError) {
    return <div style={styles.error}>{error || taxError}</div>;
  }

  const effectiveTaxRate = taxData.totalTaxableAmount > 0 ? 
    (taxData.totalTaxCollected / taxData.totalTaxableAmount) : 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Tax Compliance Report</h3>
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
          checked={includeRefunds}
          onChange={setIncludeRefunds}
          label="Include Refunded Tax (Estimated)"
          id="include-refunds"
        />
        
        <TavariCheckbox
          checked={showByCategory}
          onChange={setShowByCategory}
          label="Show by Category"
          id="show-by-category"
        />
        
        <TavariCheckbox
          checked={showByRate}
          onChange={setShowByRate}
          label="Show by Tax Rate"
          id="show-by-rate"
        />
      </div>

      {/* Tax Summary */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(taxData.totalTaxableAmount)}</div>
          <div style={styles.summaryLabel}>Taxable Amount</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(taxData.totalTaxCollected)}</div>
          <div style={styles.summaryLabel}>Tax Collected</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(taxData.totalExemptAmount)}</div>
          <div style={styles.summaryLabel}>Tax Exempt</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(taxData.refundedTax)}</div>
          <div style={styles.summaryLabel}>Tax Refunded (Est.)</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(taxData.netTaxOwed)}</div>
          <div style={styles.summaryLabel}>Net Tax Owed</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatPercentage(effectiveTaxRate)}</div>
          <div style={styles.summaryLabel}>Effective Rate</div>
        </div>
      </div>

      {/* Aggregated Taxes */}
      {Object.keys(taxData.aggregatedTaxes).length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Aggregated Taxes by Type</h4>
          <div style={styles.aggregatedTaxGrid}>
            {Object.entries(taxData.aggregatedTaxes).map(([type, amount]) => (
              <div key={type} style={styles.aggregatedTaxItem}>
                <span>{type}:</span>
                <span>{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aggregated Rebates */}
      {Object.keys(taxData.aggregatedRebates).length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Aggregated Rebates by Type</h4>
          <div style={styles.aggregatedTaxGrid}>
            {Object.entries(taxData.aggregatedRebates).map(([type, amount]) => (
              <div key={type} style={styles.aggregatedTaxItem}>
                <span>{type}:</span>
                <span style={{ color: TavariStyles.colors.success }}>{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Indian Status Transactions */}
      {taxData.indianStatusTransactions.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Indian Status Transactions</h4>
          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{taxData.indianStatusSummary.transactionCount}</div>
              <div style={styles.summaryLabel}>Transactions</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{formatCurrency(taxData.indianStatusSummary.subtotal)}</div>
              <div style={styles.summaryLabel}>Subtotal</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{formatCurrency(taxData.indianStatusSummary.taxCollected)}</div>
              <div style={styles.summaryLabel}>Tax Collected</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{formatCurrency(taxData.indianStatusSummary.rebates)}</div>
              <div style={styles.summaryLabel}>Tax Rebates</div>
            </div>
          </div>
          <p style={styles.noteText}>
            These transactions include the saved Indian status certificate number and the exact tax and rebate breakdown stored on each sale.
          </p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Certificate #</th>
                <th style={styles.th}>GST Only</th>
                <th style={styles.th}>Subtotal</th>
                <th style={styles.th}>Tax Collected</th>
                <th style={styles.th}>Tax Breakdown</th>
                <th style={styles.th}>Rebates</th>
              </tr>
            </thead>
            <tbody>
              {taxData.indianStatusTransactions.map((transaction) => (
                <tr key={transaction.saleId}>
                  <td style={styles.td}>{formatDate(transaction.date)}</td>
                  <td style={styles.td}>{transaction.certificateNumber}</td>
                  <td style={styles.td}>{transaction.gstOnly ? 'Yes' : 'No'}</td>
                  <td style={styles.td}>{formatCurrency(transaction.subtotal)}</td>
                  <td style={styles.td}>{formatCurrency(transaction.taxCollected)}</td>
                  <td style={styles.td}>{formatTaxMap(transaction.aggregatedTaxes)}</td>
                  <td style={styles.td}>{formatTaxMap(transaction.aggregatedRebates)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tax by Rate */}
      {showByRate && taxData.taxByRate.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Tax Breakdown by Rate</h4>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Tax Rate</th>
                <th style={styles.th}>Taxable Amount</th>
                <th style={styles.th}>Tax Collected</th>
                <th style={styles.th}>Items</th>
                <th style={styles.th}>Effective Rate</th>
              </tr>
            </thead>
            <tbody>
              {taxData.taxByRate.map((rate, index) => (
                <tr key={index}>
                  <td style={styles.td}>{rate.rate}</td>
                  <td style={styles.td}>{formatCurrency(rate.taxableAmount)}</td>
                  <td style={styles.td}>{formatCurrency(rate.taxCollected)}</td>
                  <td style={styles.td}>{rate.itemCount}</td>
                  <td style={styles.td}>
                    {formatPercentage(rate.taxableAmount > 0 ? rate.taxCollected / rate.taxableAmount : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tax by Category */}
      {showByCategory && taxData.taxByCategory.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Tax Breakdown by Category</h4>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Taxable Amount</th>
                <th style={styles.th}>Tax Collected</th>
                <th style={styles.th}>Items</th>
                <th style={styles.th}>Effective Rate</th>
              </tr>
            </thead>
            <tbody>
              {taxData.taxByCategory.map((category, index) => (
                <tr key={index}>
                  <td style={styles.td}>{category.category}</td>
                  <td style={styles.td}>{formatCurrency(category.taxableAmount)}</td>
                  <td style={styles.td}>{formatCurrency(category.taxCollected)}</td>
                  <td style={styles.td}>{category.itemCount}</td>
                  <td style={styles.td}>
                    {formatPercentage(category.taxableAmount > 0 ? category.taxCollected / category.taxableAmount : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Daily Tax Breakdown */}
      {taxData.salesTaxBreakdown.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Daily Tax Summary</h4>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Taxable Amount</th>
                <th style={styles.th}>Tax Collected</th>
                <th style={styles.th}>Transactions</th>
                <th style={styles.th}>Avg Tax Rate</th>
              </tr>
            </thead>
            <tbody>
              {taxData.salesTaxBreakdown.map((day, index) => (
                <tr key={index}>
                  <td style={styles.td}>{formatDate(day.date)}</td>
                  <td style={styles.td}>{formatCurrency(day.taxableAmount)}</td>
                  <td style={styles.td}>{formatCurrency(day.taxCollected)}</td>
                  <td style={styles.td}>{day.transactionCount}</td>
                  <td style={styles.td}>
                    {formatPercentage(day.taxableAmount > 0 ? day.taxCollected / day.taxableAmount : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {taxData.salesTaxBreakdown.length === 0 && (
        <div style={styles.noData}>
          No tax data found for this period
        </div>
      )}
    </div>
  );
};

export default TaxComplianceReport;
// src/screens/POS/POSReportsScreen.jsx - Production Ready with Permissions & Security
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';

// Import report components
import SalesSummaryReport from '../../components/Reports/SalesSummaryReport';
import PaymentMethodsReport from '../../components/Reports/PaymentMethodsReport';
import CashDrawerReport from '../../components/Reports/CashDrawerReport';
import HourlySalesReport from '../../components/Reports/HourlySalesReport';
import TaxComplianceReport from '../../components/Reports/TaxComplianceReport';
import EndOfPeriodSalesReport from '../../components/Reports/EndOfPeriodSalesReport';
import RefundsVoidsReport from '../../components/Reports/RefundsVoidsReport';
import DiscountUsageReport from '../../components/Reports/DiscountUsageReport';
import TopItemsReport from '../../components/Reports/TopItemsReport';
import CategoryPerformanceReport from '../../components/Reports/CategoryPerformanceReport';
import LowStockReport from '../../components/Reports/LowStockReport';
import ProductMixReport from '../../components/Reports/ProductMixReport';
import EmployeePerformanceReport from '../../components/Reports/EmployeePerformanceReport';
import LaborCostAnalysisReport from '../../components/Reports/LaborCostAnalysisReport';
import ShiftPerformanceReport from '../../components/Reports/ShiftPerformanceReport';
import LoyaltyProgramReport from '../../components/Reports/LoyaltyProgramReport';
import CustomerTransactionHistoryReport from '../../components/Reports/CustomerTransactionHistoryReport';
import AverageCustomerValueReport from '../../components/Reports/AverageCustomerValueReport';
import YearOverYearComparisonReport from '../../components/Reports/YearOverYearComparisonReport';
import ProfitMarginAnalysisReport from '../../components/Reports/ProfitMarginAnalysisReport';
import PromotionalEffectivenessReport from '../../components/Reports/PromotionalEffectivenessReport';

const POSReportsScreen = () => {
  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'POS Reports Screen'
  });

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSReportsScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    hasLoggedInUserElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  const hasReportElevatedAccess = hasElevatedPrivileges() || hasLoggedInUserElevatedPrivileges();

  // Permission checks for different report types
  const canViewSalesReports = hasAnyPermission([
    'pos.reports.view',
    'pos.reports.sales',
    'reports.pos.view',
    'reports.pos.sales'
  ]) || hasReportElevatedAccess;

  const canViewFinancialReports = hasAnyPermission([
    'pos.reports.view',
    'pos.reports.financial',
    'reports.pos.view',
    'reports.pos.financial'
  ]) || hasReportElevatedAccess;

  const canViewInventoryReports = hasAnyPermission([
    'pos.reports.view',
    'pos.reports.inventory',
    'reports.pos.view',
    'reports.pos.inventory'
  ]) || hasReportElevatedAccess;

  const canViewEmployeeReports = hasAnyPermission([
    'pos.reports.employee',
    'reports.pos.employee',
    'reports.pos.view'
  ]) || hasReportElevatedAccess;
  const canViewCustomerReports = hasAnyPermission([
    'pos.reports.customer',
    'reports.pos.customer',
    'reports.pos.view'
  ]) || hasReportElevatedAccess;
  const canExportReports = hasAnyPermission([
    'pos.reports.export',
    'reports.export'
  ]) || hasReportElevatedAccess;
  const canEmailReports = hasAnyPermission([
    'pos.reports.email',
    'reports.email'
  ]) || hasReportElevatedAccess;

  // Tax calculations
  const {
    calculateTotalTax,
    formatTaxAmount,
    getTaxSummary,
    applyCashRounding,
    loading: taxLoading,
    error: taxError
  } = useTaxCalculations(auth.selectedBusinessId);

  // Report configuration
  const REPORT_COMPONENTS = {
    'sales-summary': SalesSummaryReport,
    'payment-methods': PaymentMethodsReport,
    'cash-drawer': CashDrawerReport,
    'hourly-breakdown': HourlySalesReport,
    'tax-report': TaxComplianceReport,
    'end-period': EndOfPeriodSalesReport,
    'refunds-voids': RefundsVoidsReport,
    'discount-usage': DiscountUsageReport,
    'top-items': TopItemsReport,
    'category-performance': CategoryPerformanceReport,
    'low-stock': LowStockReport,
    'product-mix': ProductMixReport,
    'employee-performance': EmployeePerformanceReport,
    'labor-analysis': LaborCostAnalysisReport,
    'shift-reports': ShiftPerformanceReport,
    'loyalty-program': LoyaltyProgramReport,
    'customer-history': CustomerTransactionHistoryReport,
    'customer-value': AverageCustomerValueReport,
    'year-comparison': YearOverYearComparisonReport,
    'profit-margin': ProfitMarginAnalysisReport,	
    'promotional-effectiveness': PromotionalEffectivenessReport,
  };

  const REPORT_NAMES = {
    'sales-summary': 'Daily Sales Summary',
    'payment-methods': 'Payment Method Analysis',
    'cash-drawer': 'Cash Drawer Reconciliation',
    'hourly-breakdown': 'Hourly Sales Breakdown',
    'tax-report': 'Tax Compliance Report',
    'end-period': 'End-of-Period Sales',
    'refunds-voids': 'Refunds & Voids Report',
    'discount-usage': 'Discount Usage Report',
    'top-items': 'Top/Bottom Selling Items',
    'category-performance': 'Category Performance',
    'low-stock': 'Low Stock Alerts',
    'product-mix': 'Product Mix Analysis',
    'employee-performance': 'Employee Sales Performance',
    'labor-analysis': 'Labor Cost Analysis',
    'shift-reports': 'Shift Performance Reports',
    'loyalty-program': 'Loyalty Program Report',
    'customer-history': 'Customer Transaction History',
    'customer-value': 'Average Customer Value',
    'year-comparison': 'Year-over-Year Comparison',
    'profit-margin': 'Profit Margin Analysis',
    'promotional-effectiveness': 'Promotional Effectiveness'
  };

  // Report type to permission mapping
  const REPORT_PERMISSIONS = {
    'sales-summary': 'sales',
    'payment-methods': 'financial',
    'cash-drawer': 'financial',
    'hourly-breakdown': 'sales',
    'tax-report': 'financial',
    'end-period': 'financial',
    'refunds-voids': 'financial',
    'discount-usage': 'sales',
    'top-items': 'inventory',
    'category-performance': 'inventory',
    'low-stock': 'inventory',
    'product-mix': 'inventory',
    'employee-performance': 'employee',
    'labor-analysis': 'employee',
    'shift-reports': 'employee',
    'loyalty-program': 'customer',
    'customer-history': 'customer',
    'customer-value': 'customer',
    'year-comparison': 'financial',
    'profit-margin': 'financial',
    'promotional-effectiveness': 'sales'
  };

  // State
  const [reportData, setReportData] = useState({
    salesTotals: 0,
    refundTotals: 0,
    netSales: 0,
    paymentBreakdown: [],
    topItems: [],
    employeeStats: [],
    taxBreakdown: {
      totalTax: 0,
      aggregatedTaxes: {},
      aggregatedRebates: {}
    },
    setupStats: {
      inventoryCount: 0,
      categoriesCount: 0,
      modifiersCount: 0,
      discountsCount: 0,
      stationsCount: 0
    },
    rawData: null
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dateRange, setDateRange] = useState('today');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [compareToLastYear, setCompareToLastYear] = useState(false);
  const [includeTaxBreakdown, setIncludeTaxBreakdown] = useState(true);
  const [selectedReport, setSelectedReport] = useState('sales-summary');
  const [employees, setEmployees] = useState([]);

  // Check if user can view current report
  const canViewCurrentReport = () => {
    const reportType = REPORT_PERMISSIONS[selectedReport];
    
    switch (reportType) {
      case 'sales':
        return canViewSalesReports;
      case 'financial':
        return canViewFinancialReports;
      case 'inventory':
        return canViewInventoryReports;
      case 'employee':
        return canViewEmployeeReports;
      case 'customer':
        return canViewCustomerReports;
      default:
        return canViewSalesReports;
    }
  };

  useEffect(() => {
    if (auth.selectedBusinessId && auth.isReady) {
      loadEmployees();
      generateReport();
    }
  }, [auth.selectedBusinessId, auth.isReady]);

  useEffect(() => {
    if (auth.selectedBusinessId && auth.isReady) {
      generateReport();
    }
  }, [dateRange, customDateStart, customDateEnd, selectedEmployee, compareToLastYear, includeTaxBreakdown, auth.selectedBusinessId, auth.isReady]);

  const loadEmployees = async () => {
    try {
      await logSecurityEvent('employees_list_accessed', {
        action: 'load_for_reports',
        business_id: auth.selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          users!inner(id, email, first_name, last_name, employment_status, status)
        `)
        .eq('business_id', auth.selectedBusinessId)
        .eq('active', true);
      
      if (error) throw error;
      
      const employeeList = (data || [])
        .filter((role) => {
          const employeeStatus = (role.users?.employment_status || role.users?.status || '').toLowerCase();
          return employeeStatus === 'active';
        })
        .map(role => ({
          id: role.user_id,
          full_name: `${role.users.first_name || ''} ${role.users.last_name || ''}`.trim() || role.users.email,
          email: role.users.email
        }))
        .sort((left, right) => (left.full_name || '').localeCompare(right.full_name || ''));
      
      setEmployees(employeeList);
    } catch (err) {
      await logSecurityEvent('employees_list_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
    }
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

  const loadPaymentsForSales = async (saleIds) => {
    if (!Array.isArray(saleIds) || saleIds.length === 0) {
      return [];
    }

    const batchSize = 100;
    const paymentRows = [];

    for (let index = 0; index < saleIds.length; index += batchSize) {
      const batchSaleIds = saleIds.slice(index, index + batchSize);
      const { data: batchPayments, error: batchPaymentsError } = await supabase
        .from('pos_payments')
        .select('payment_method, amount, sale_id')
        .eq('business_id', auth.selectedBusinessId)
        .in('sale_id', batchSaleIds);

      if (batchPaymentsError) {
        throw batchPaymentsError;
      }

      paymentRows.push(...(batchPayments || []));
    }

    return paymentRows;
  };

  const generateReport = async () => {
    if (!auth.selectedBusinessId || !auth.isReady) return;
    if (!canViewCurrentReport()) {
      setError('You do not have permission to view this report type');
      return;
    }

    // Rate limiting for report generation
    const rateLimitCheck = await checkRateLimit('generate_report', 20, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many report requests. Please wait a moment.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await logSecurityEvent('report_generated', {
        report_type: selectedReport,
        date_range: dateRange,
        business_id: auth.selectedBusinessId,
        generated_by: auth.authUser?.id,
        custom_dates: dateRange === 'custom' ? { start: customDateStart, end: customDateEnd } : null
      }, 'low');

      const { start, end } = getDateFilter();
      
      // Build sales query
      let salesQuery = supabase
        .from('pos_sales')
        .select(`
          id, subtotal, tax, discount, loyalty_discount, total, created_at, user_id, operator_user_id, operator_user_name, payment_status,
          pos_sale_items (
            id, inventory_id, name, quantity, unit_price, total_price, category_id,
            pos_categories (name)
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .gte('created_at', start)
        .lt('created_at', end);

      if (selectedEmployee !== 'all') {
        salesQuery = salesQuery.or(`operator_user_id.eq.${selectedEmployee},and(operator_user_id.is.null,user_id.eq.${selectedEmployee})`);
      }

      const { data: sales, error: salesError } = await salesQuery;
      if (salesError) throw salesError;

      const completedSales = sales?.filter(sale => sale.payment_status === 'paid' || sale.payment_status === 'completed') || [];

      const inventoryIdsMissingCategories = [
        ...new Set(
          completedSales.flatMap((sale) =>
            (sale.pos_sale_items || [])
              .filter((item) => !item.category_id && item.inventory_id)
              .map((item) => item.inventory_id)
          )
        )
      ];

      let inventoryCategoryMap = {};
      if (inventoryIdsMissingCategories.length > 0) {
        const { data: inventoryRows, error: inventoryCategoryError } = await supabase
          .from('pos_inventory')
          .select(`
            id,
            category_id,
            pos_categories (name)
          `)
          .in('id', inventoryIdsMissingCategories);

        if (inventoryCategoryError) throw inventoryCategoryError;

        inventoryCategoryMap = (inventoryRows || []).reduce((map, row) => {
          map[row.id] = {
            category_id: row.category_id || null,
            category_name: row.pos_categories?.name || null
          };
          return map;
        }, {});
      }

      const enrichedCompletedSales = completedSales.map((sale) => ({
        ...sale,
        pos_sale_items: (sale.pos_sale_items || []).map((item) => {
          const inventoryCategory = inventoryCategoryMap[item.inventory_id] || null;
          return {
            ...item,
            category_id: item.category_id || inventoryCategory?.category_id || null,
            category_name: item.pos_categories?.name || inventoryCategory?.category_name || null
          };
        })
      }));

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
      if (refundsError) throw refundsError;

      // Get payments
      const payments = await loadPaymentsForSales(enrichedCompletedSales.map((sale) => sale.id));

      // Get setup statistics
      const [inventoryResult, categoriesResult, modifiersResult, discountsResult, stationsResult] = await Promise.all([
        supabase.from('pos_inventory').select('id').eq('business_id', auth.selectedBusinessId),
        supabase.from('pos_categories').select('id, is_active').eq('business_id', auth.selectedBusinessId),
        supabase.from('pos_modifier_groups').select('id, is_active').eq('business_id', auth.selectedBusinessId),
        supabase.from('pos_discounts').select('id').eq('business_id', auth.selectedBusinessId),
        supabase.from('pos_stations').select('id, is_active').eq('business_id', auth.selectedBusinessId)
      ]);

      // Calculate totals
      const salesTotals = enrichedCompletedSales?.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0) || 0;
      const refundTotals = refunds?.reduce((sum, refund) => sum + (Number(refund.total_refund_amount) || 0), 0) || 0;
      const netSales = salesTotals - refundTotals;

      // Calculate tax breakdown
      let taxBreakdown = { totalTax: 0, aggregatedTaxes: {}, aggregatedRebates: {} };
      
      if (includeTaxBreakdown && enrichedCompletedSales?.length > 0) {
        const totalTaxFromSales = enrichedCompletedSales.reduce((sum, sale) => sum + (Number(sale.tax) || 0), 0);
        const totalTaxFromRefunds = refunds?.reduce((sum, refund) => sum + (Number(refund.tax_refunded) || 0), 0) || 0;
        taxBreakdown.totalTax = totalTaxFromSales - totalTaxFromRefunds;
      }

      // Calculate payment breakdown
      const paymentMethodTotals = {};
      payments?.forEach(payment => {
        const method = payment.payment_method || 'unknown';
        paymentMethodTotals[method] = (paymentMethodTotals[method] || 0) + (Number(payment.amount) || 0);
      });

      const paymentBreakdown = Object.entries(paymentMethodTotals).map(([method, amount]) => ({
        method: method.charAt(0).toUpperCase() + method.slice(1),
        amount,
        percentage: salesTotals > 0 ? ((amount / salesTotals) * 100) : 0
      }));

      // Calculate top items
      const itemTotals = {};
      enrichedCompletedSales?.forEach(sale => {
        if (sale.pos_sale_items) {
          sale.pos_sale_items.forEach(item => {
            const key = item.name;
            if (!itemTotals[key]) {
              itemTotals[key] = { name: key, quantity: 0, revenue: 0 };
            }
            itemTotals[key].quantity += Number(item.quantity) || 0;
            itemTotals[key].revenue += Number(item.total_price) || 0;
          });
        }
      });

      const topItems = Object.values(itemTotals)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      // Calculate employee stats
      const employeeStats = {};
      enrichedCompletedSales?.forEach(sale => {
        const userId = sale.operator_user_id || sale.user_id;
        if (!employeeStats[userId]) {
          const employee = employees.find(e => e.id === userId);
          employeeStats[userId] = {
            id: userId,
            name: sale.operator_user_name || (employee ? employee.full_name || employee.email : 'Unknown'),
            sales: 0,
            revenue: 0,
            transactions: 0
          };
        }
        employeeStats[userId].transactions += 1;
        employeeStats[userId].revenue += Number(sale.total) || 0;
      });

      // Get comparison data
      let comparisonData = null;
      if (compareToLastYear) {
        const lastYearStart = new Date(start);
        const lastYearEnd = new Date(end);
        lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
        lastYearEnd.setFullYear(lastYearEnd.getFullYear() - 1);

        const { data: lastYearSales } = await supabase
          .from('pos_sales')
          .select('total')
          .eq('business_id', auth.selectedBusinessId)
          .in('payment_status', ['paid', 'completed'])
          .gte('created_at', lastYearStart.toISOString())
          .lt('created_at', lastYearEnd.toISOString());

        const lastYearTotal = lastYearSales?.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0) || 0;
        
        comparisonData = {
          lastYearSales: lastYearTotal,
          growth: lastYearTotal > 0 ? ((netSales - lastYearTotal) / lastYearTotal * 100) : 0,
          difference: netSales - lastYearTotal
        };
      }

      setReportData({
        salesTotals,
        refundTotals,
        netSales,
        paymentBreakdown,
        topItems,
        employeeStats: Object.values(employeeStats).sort((a, b) => b.revenue - a.revenue),
        comparisonData,
        totalTransactions: enrichedCompletedSales?.length || 0,
        avgTransaction: enrichedCompletedSales?.length > 0 ? (salesTotals / enrichedCompletedSales.length) : 0,
        taxBreakdown,
        setupStats: {
          inventoryCount: inventoryResult.data?.length || 0,
          categoriesCount: categoriesResult.data?.length || 0,
          modifiersCount: modifiersResult.data?.length || 0,
          discountsCount: discountsResult.data?.length || 0,
          stationsCount: stationsResult.data?.length || 0,
          activeCategories: categoriesResult.data?.filter(c => c.is_active !== false).length || 0,
          activeModifiers: modifiersResult.data?.filter(m => m.is_active !== false).length || 0,
          activeStations: stationsResult.data?.filter(s => s.is_active !== false).length || 0
        },
        rawData: {
          sales: enrichedCompletedSales,
          refunds,
          payments
        }
      });

      await recordAction('pos_report_generated', {
        report_type: selectedReport,
        date_range: dateRange,
        total_sales: salesTotals,
        net_sales: netSales,
        transactions_count: enrichedCompletedSales?.length || 0
      }, true);

    } catch (err) {
      await logSecurityEvent('report_generation_error', {
        error: err.message,
        report_type: selectedReport,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Failed to generate report: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Export handler
  const handleExport = async (content, format, reportType) => {
    if (!canExportReports) {
      alert('You do not have permission to export reports');
      await logSecurityEvent('report_export_denied', {
        report_type: reportType,
        format: format,
        business_id: auth.selectedBusinessId
      }, 'medium');
      return;
    }

    const rateLimitCheck = await checkRateLimit('export_report', 5, 60000);
    if (!rateLimitCheck.allowed) {
      alert('Too many export attempts. Please wait a moment.');
      return;
    }

    try {
      const fileName = `${reportType}-${dateRange}-${new Date().toISOString().split('T')[0]}`;
      
      if (format === 'csv' || format === 'excel') {
        const encodedUri = encodeURI(content);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", fileName + (format === 'csv' ? '.csv' : '.xlsx'));
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (format === 'pdf') {
        alert('PDF export functionality will be implemented with a PDF library');
      }

      await logSecurityEvent('report_exported', {
        format: format,
        report_type: reportType,
        file_name: fileName,
        date_range: dateRange,
        business_id: auth.selectedBusinessId,
        exported_by: auth.authUser?.id
      }, 'low');

      await recordAction('pos_report_exported', {
        format: format,
        report_type: reportType
      }, true);

    } catch (err) {
      await logSecurityEvent('report_export_error', {
        error: err.message,
        report_type: reportType,
        business_id: auth.selectedBusinessId
      }, 'medium');
    }
  };

  // Email handler
  const handleEmail = async (emailContent) => {
    if (!canEmailReports) {
      alert('You do not have permission to email reports');
      await logSecurityEvent('report_email_denied', {
        report_type: selectedReport,
        business_id: auth.selectedBusinessId
      }, 'medium');
      return;
    }

    const rateLimitCheck = await checkRateLimit('email_report', 3, 60000);
    if (!rateLimitCheck.allowed) {
      alert('Too many email attempts. Please wait a moment.');
      return;
    }

    try {
      const mailtoLink = `mailto:?subject=${encodeURIComponent(emailContent.subject)}&body=${encodeURIComponent(emailContent.body)}`;
      window.open(mailtoLink);

      await logSecurityEvent('report_emailed', {
        report_type: selectedReport,
        date_range: dateRange,
        business_id: auth.selectedBusinessId,
        emailed_by: auth.authUser?.id
      }, 'low');

      await recordAction('pos_report_emailed', {
        report_type: selectedReport
      }, true);

    } catch (err) {
      await logSecurityEvent('report_email_error', {
        error: err.message,
        report_type: selectedReport,
        business_id: auth.selectedBusinessId
      }, 'medium');
    }
  };

  const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;

  const styles = {
    container: {
      padding: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.gray50,
      overflowY: 'auto'
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg
    },
    
    controls: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      flexWrap: 'wrap',
      alignItems: 'end',
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows.sm
    },
    
    controlGroup: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: '120px'
    },
    
    label: TavariStyles.components.form.label,
    select: TavariStyles.components.form.select,
    input: TavariStyles.components.form.input,
    
    loading: TavariStyles.components.loading.container,
    
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg
    },
    
    summaryCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      textAlign: 'center'
    },
    
    summaryValue: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    
    summaryLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    reportNotImplemented: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      textAlign: 'center',
      color: TavariStyles.colors.gray500
    },

    noAccessContainer: {
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },

    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    }
  };

  const ReportComponent = REPORT_COMPONENTS[selectedReport];

  // Check overall access
  if (!permissionsLoading && !canViewSalesReports && !canViewFinancialReports && !canViewInventoryReports && !canViewEmployeeReports && !canViewCustomerReports) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POS Reports Screen"
        >
          <div style={styles.container}>
            <div style={styles.noAccessContainer}>
              <h3 style={{ color: TavariStyles.colors.danger }}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to view any reports.
              </p>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  if (auth.authLoading || permissionsLoading) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POS Reports Screen"
        >
          <div style={styles.loading}>Loading...</div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  if (auth.authError) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POS Reports Screen"
        >
          <div style={styles.errorBanner}>{auth.authError}</div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="POS Reports Screen"
      >
        <div style={styles.container}>
          {error && <div style={styles.errorBanner}>{error}</div>}
          {taxError && <div style={styles.errorBanner}>Tax calculation error: {taxError}</div>}

          {/* Report Controls */}
          <div style={styles.controls}>
            <div style={styles.controlGroup}>
              <label style={styles.label}>Report Type:</label>
              <select
                value={selectedReport}
                onChange={(e) => setSelectedReport(e.target.value)}
                style={styles.select}
              >
                {canViewSalesReports && (
                  <optgroup label="Daily Operations">
                    <option value="sales-summary">Daily Sales Summary</option>
                    <option value="cash-drawer">Cash Drawer Reconciliation</option>
                    <option value="hourly-breakdown">Hourly Sales Breakdown</option>
                    <option value="payment-methods">Payment Method Analysis</option>
                  </optgroup>
                )}
                {canViewFinancialReports && (
                  <optgroup label="Financial & Tax">
                    <option value="tax-report">Tax Compliance Report</option>
                    <option value="end-period">End-of-Period Sales</option>
                    <option value="refunds-voids">Refunds & Voids Report</option>
                    <option value="discount-usage">Discount Usage Report</option>
                  </optgroup>
                )}
                {canViewInventoryReports && (
                  <optgroup label="Inventory & Products">
                    <option value="top-items">Top/Bottom Selling Items</option>
                    <option value="category-performance">Category Performance</option>
                    <option value="low-stock">Low Stock Alerts</option>
                    <option value="product-mix">Product Mix Analysis</option>
                  </optgroup>
                )}
                {canViewEmployeeReports && (
                  <optgroup label="Staff & Labor">
                    <option value="employee-performance">Employee Sales Performance</option>
                    <option value="labor-analysis">Labor Cost Analysis</option>
                    <option value="shift-reports">Shift Performance Reports</option>
                  </optgroup>
                )}
                {canViewCustomerReports && (
                  <optgroup label="Customer Insights">
                    <option value="loyalty-program">Loyalty Program Report</option>
                    <option value="customer-history">Customer Transaction History</option>
                    <option value="customer-value">Average Customer Value</option>
                  </optgroup>
                )}
                {canViewFinancialReports && (
                  <optgroup label="Business Intelligence">
                    <option value="year-comparison">Year-over-Year Comparison</option>
                    <option value="profit-margin">Profit Margin Analysis</option>
                    <option value="promotional-effectiveness">Promotional Effectiveness</option>
                  </optgroup>
                )}
              </select>
            </div>

            <div style={styles.controlGroup}>
              <label style={styles.label}>Date Range:</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                style={styles.select}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {dateRange === 'custom' && (
              <>
                <div style={styles.controlGroup}>
                  <label style={styles.label}>Start Date:</label>
                  <input
                    type="date"
                    value={customDateStart}
                    onChange={(e) => setCustomDateStart(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={styles.controlGroup}>
                  <label style={styles.label}>End Date:</label>
                  <input
                    type="date"
                    value={customDateEnd}
                    onChange={(e) => setCustomDateEnd(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </>
            )}

            <div style={styles.controlGroup}>
              <label style={styles.label}>Employee:</label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                style={styles.select}
              >
                <option value="all">All Employees</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name || emp.email}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.controlGroup}>
              <TavariCheckbox
                checked={compareToLastYear}
                onChange={setCompareToLastYear}
                label="Compare to Last Year"
                id="compare-last-year"
              />
            </div>

            <div style={styles.controlGroup}>
              <TavariCheckbox
                checked={includeTaxBreakdown}
                onChange={setIncludeTaxBreakdown}
                label="Include Tax Breakdown"
                id="include-tax-breakdown"
              />
            </div>
          </div>

          {/* Quick Summary Cards */}
          {(canViewSalesReports || canViewFinancialReports || canViewInventoryReports || canViewEmployeeReports || canViewCustomerReports) && (
            <div style={styles.summaryGrid}>
              <div style={styles.summaryCard}>
                <div style={styles.summaryValue}>{formatCurrency(reportData.salesTotals)}</div>
                <div style={styles.summaryLabel}>Total Sales</div>
              </div>
              <div style={styles.summaryCard}>
                <div style={styles.summaryValue}>{formatCurrency(reportData.netSales)}</div>
                <div style={styles.summaryLabel}>Net Sales</div>
              </div>
              <div style={styles.summaryCard}>
                <div style={styles.summaryValue}>{reportData.totalTransactions}</div>
                <div style={styles.summaryLabel}>Transactions</div>
              </div>
              <div style={styles.summaryCard}>
                <div style={styles.summaryValue}>{formatCurrency(reportData.avgTransaction)}</div>
                <div style={styles.summaryLabel}>Avg Transaction</div>
              </div>
            </div>
          )}

          {/* Report Content */}
          {loading ? (
            <div style={styles.loading}>Generating report...</div>
          ) : !canViewCurrentReport() ? (
            <div style={styles.noAccessContainer}>
              <h3 style={{ color: TavariStyles.colors.danger }}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to view this report type.
              </p>
            </div>
          ) : ReportComponent ? (
            <ReportComponent
              data={reportData}
              dateRange={dateRange}
              customDateStart={customDateStart}
              customDateEnd={customDateEnd}
              compareToLastYear={compareToLastYear}
              selectedEmployee={selectedEmployee}
              employees={employees}
              businessId={auth.selectedBusinessId}
              onExport={handleExport}
              onEmail={handleEmail}
              canExport={canExportReports}
              canEmail={canEmailReports}
            />
          ) : (
            <div style={styles.reportNotImplemented}>
              <h3>{REPORT_NAMES[selectedReport] || 'Unknown Report'}</h3>
              <p>This report is not yet implemented. Check back soon!</p>
            </div>
          )}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSReportsScreen;
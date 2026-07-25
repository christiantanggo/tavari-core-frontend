// src/components/Reports/CashDrawerReport.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { logAction } from '../../helpers/posAudit';

const CashDrawerReport = ({ 
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
    componentName: 'CashDrawerReport'
  });

  const [drawerData, setDrawerData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showVariances, setShowVariances] = useState(true);
  const [varianceThreshold, setVarianceThreshold] = useState(5.00);

  const getDrawerStartingAmount = (drawer) =>
    Number(drawer?.starting_cash ?? drawer?.starting_amount ?? 0);

  const getDrawerExpectedAmount = (drawer) =>
    Number(drawer?.expected_cash ?? drawer?.expected_amount ?? 0);

  const getDrawerActualAmount = (drawer) =>
    Number(drawer?.actual_cash ?? drawer?.actual_amount ?? 0);

  const getDrawerVarianceAmount = (drawer) =>
    Number(drawer?.variance ?? (getDrawerActualAmount(drawer) - getDrawerExpectedAmount(drawer)) ?? 0);

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadDrawerData();
    }
  }, [auth.selectedBusinessId, dateRange, customDateStart, customDateEnd, selectedEmployee]);

  const loadDrawerData = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      setLoading(true);
      setError(null);

      const { start, end } = getDateFilter();

      // Get drawer opening/closing data
      let drawerQuery = supabase
        .from('pos_drawers')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .gte('opened_at', start)
        .lt('opened_at', end)
        .order('opened_at', { ascending: false });

      if (selectedEmployee !== 'all') {
        drawerQuery = drawerQuery.or(`opened_by.eq.${selectedEmployee},closed_by.eq.${selectedEmployee}`);
      }

      const { data: drawers, error: drawerError } = await drawerQuery;
      if (drawerError) throw drawerError;

      const userIds = Array.from(
        new Set(
          (drawers || [])
            .flatMap((drawer) => [drawer.opened_by, drawer.closed_by])
            .filter(Boolean)
        )
      );

      let userMap = new Map();
      if (userIds.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, full_name, email')
          .in('id', userIds);

        if (!usersError) {
          userMap = new Map(
            (users || []).map((user) => [
              user.id,
              user.full_name || user.email || `User ${user.id}`
            ])
          );
        }
      }

      // Get cash transactions for each drawer period
      const enrichedDrawers = await Promise.all(
        (drawers || []).map(async (drawer) => {
          try {
            // Get cash sales during this drawer period
            const drawerStart = drawer.opened_at;
            const drawerEnd = drawer.closed_at || new Date().toISOString();

            const { data: cashSales, error: salesError } = await supabase
              .from('pos_payments')
              .select('amount, sale_id, created_at')
              .eq('business_id', auth.selectedBusinessId)
              .eq('payment_method', 'cash')
              .gte('created_at', drawerStart)
              .lte('created_at', drawerEnd);

            if (salesError) throw salesError;

            // Get cash refunds during this period
            const { data: cashRefunds, error: refundsError } = await supabase
              .from('pos_refunds')
              .select('total_refund_amount, created_at')
              .eq('business_id', auth.selectedBusinessId)
              .eq('refund_method', 'cash')
              .gte('created_at', drawerStart)
              .lte('created_at', drawerEnd);

            if (refundsError) throw refundsError;

            const totalCashSales = (cashSales || []).reduce((sum, sale) => sum + (Number(sale.amount) || 0), 0);
            const totalCashRefunds = (cashRefunds || []).reduce((sum, refund) => sum + (Number(refund.total_refund_amount) || 0), 0);
            const netCashActivity = totalCashSales - totalCashRefunds;
            const startingAmount = getDrawerStartingAmount(drawer);
            const expectedAmount = getDrawerExpectedAmount(drawer);
            const actualAmount = getDrawerActualAmount(drawer);
            const varianceAmount = getDrawerVarianceAmount(drawer);

            return {
              ...drawer,
              openerName: userMap.get(drawer.opened_by) || drawer.opened_by || 'Unknown',
              closerName: userMap.get(drawer.closed_by) || drawer.closed_by || 'Not closed',
              normalizedStartingAmount: startingAmount,
              normalizedExpectedAmount: expectedAmount,
              normalizedActualAmount: actualAmount,
              normalizedVarianceAmount: varianceAmount,
              cashSales: cashSales || [],
              cashRefunds: cashRefunds || [],
              totalCashSales,
              totalCashRefunds,
              netCashActivity,
              calculatedExpected: startingAmount + netCashActivity,
              varianceFromCalculated: actualAmount - (startingAmount + netCashActivity)
            };
          } catch (err) {
            console.error('Error enriching drawer data:', err);
            return drawer;
          }
        })
      );

      setDrawerData(enrichedDrawers);

    } catch (err) {
      console.error('Error loading drawer data:', err);
      setError('Failed to load drawer data: ' + err.message);
    } finally {
      setLoading(false);
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

  const formatCurrency = (amount) => `$${(amount || 0).toFixed(2)}`;
  const formatDateTime = (dateString) => {
    if (!dateString) return 'Not closed';
    return new Date(dateString).toLocaleString();
  };

  const getVarianceColor = (variance) => {
    const absVariance = Math.abs(variance || 0);
    if (absVariance === 0) return TavariStyles.colors.success;
    if (absVariance <= varianceThreshold) return TavariStyles.colors.warning;
    return TavariStyles.colors.danger;
  };

  const getVarianceIcon = (variance) => {
    const absVariance = Math.abs(variance || 0);
    if (absVariance === 0) return '✓';
    if (absVariance <= varianceThreshold) return '⚠';
    return '⚠';
  };

  const exportData = {
    csv: () => {
      const { start, end } = getDateRangeText();
      let csvContent = "data:text/csv;charset=utf-8,";
      
      csvContent += "Cash Drawer Reconciliation Report\n";
      csvContent += `Period,${start} to ${end}\n`;
      csvContent += `Employee Filter,${getEmployeeName()}\n`;
      csvContent += `Generated,${new Date().toLocaleString()}\n\n`;
      
      csvContent += "Opened,Closed,Opened By,Closed By,Starting Cash,Expected Cash,Actual Cash,Variance,Status,Terminal,Notes\n";
      
      drawerData.forEach(drawer => {
        const openerName = drawer.openerName || 'Unknown';
        const closerName = drawer.closerName || 'Unknown';
        
        csvContent += `"${formatDateTime(drawer.opened_at)}","${formatDateTime(drawer.closed_at)}","${openerName}","${closerName}",${getDrawerStartingAmount(drawer)},${getDrawerExpectedAmount(drawer)},${getDrawerActualAmount(drawer)},${getDrawerVarianceAmount(drawer)},"${drawer.status || 'open'}","${drawer.terminal_id || 'N/A'}","${(drawer.notes || '').replace(/"/g, '""')}"\n`;
      });
      
      // Summary
      const totalStarting = drawerData.reduce((sum, d) => sum + getDrawerStartingAmount(d), 0);
      const totalExpected = drawerData.reduce((sum, d) => sum + getDrawerExpectedAmount(d), 0);
      const totalActual = drawerData.reduce((sum, d) => sum + getDrawerActualAmount(d), 0);
      const totalVariance = drawerData.reduce((sum, d) => sum + getDrawerVarianceAmount(d), 0);
      
      csvContent += `\nSummary\n`;
      csvContent += `Total Drawers,${drawerData.length}\n`;
      csvContent += `Total Starting Cash,${totalStarting.toFixed(2)}\n`;
      csvContent += `Total Expected Cash,${totalExpected.toFixed(2)}\n`;
      csvContent += `Total Actual Cash,${totalActual.toFixed(2)}\n`;
      csvContent += `Total Variance,${totalVariance.toFixed(2)}\n`;
      
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
    subject: `Cash Drawer Reconciliation Report - ${getDateRangeText().start} to ${getDateRangeText().end}`,
    body: `
Cash Drawer Reconciliation Report

Period: ${getDateRangeText().start} to ${getDateRangeText().end}
Employee Filter: ${getEmployeeName()}
Generated: ${new Date().toLocaleString()}

DRAWER SUMMARY:
- Total Drawers: ${drawerData.length}
- Total Starting Cash: ${formatCurrency(drawerData.reduce((sum, d) => sum + getDrawerStartingAmount(d), 0))}
- Total Expected Cash: ${formatCurrency(drawerData.reduce((sum, d) => sum + getDrawerExpectedAmount(d), 0))}
- Total Actual Cash: ${formatCurrency(drawerData.reduce((sum, d) => sum + getDrawerActualAmount(d), 0))}
- Total Variance: ${formatCurrency(drawerData.reduce((sum, d) => sum + getDrawerVarianceAmount(d), 0))}

VARIANCES OVER $${varianceThreshold.toFixed(2)}:
${drawerData.filter(d => Math.abs(getDrawerVarianceAmount(d)) > varianceThreshold).map(drawer => 
  `• ${formatDateTime(drawer.opened_at)}: ${formatCurrency(getDrawerVarianceAmount(drawer))} (${drawer.openerName || 'Unknown'})`
).join('\n') || 'None'}

This report shows cash drawer reconciliation data for the selected period.
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
      onExport(content, format, 'cash-drawer');
      
      logAction({
        action: 'cash_drawer_report_exported',
        context: 'CashDrawerReport',
        metadata: {
          format,
          date_range: dateRange,
          drawer_count: drawerData.length,
          business_id: auth.selectedBusinessId
        }
      });
    }
  };

  const handleEmail = () => {
    const content = emailContent();
    onEmail(content, exportData.csv(), 'cash-drawer');
    
    logAction({
      action: 'cash_drawer_report_emailed',
      context: 'CashDrawerReport',
      metadata: {
        date_range: dateRange,
        drawer_count: drawerData.length,
        business_id: auth.selectedBusinessId
      }
    });
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
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      alignItems: 'center',
      flexWrap: 'wrap'
    },
    
    varianceInput: {
      ...TavariStyles.components.form.input,
      width: '100px'
    },
    
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
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
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    
    summaryLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    tableContainer: {
      overflowX: 'auto',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    th: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray100,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
      textAlign: 'left',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.xs,
      textTransform: 'uppercase'
    },
    
    td: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
      verticalAlign: 'middle'
    },
    
    statusBadge: {
      padding: '4px 8px',
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textTransform: 'uppercase'
    },
    
    statusOpen: {
      backgroundColor: TavariStyles.colors.warning,
      color: TavariStyles.colors.white
    },
    
    statusClosed: {
      backgroundColor: TavariStyles.colors.success,
      color: TavariStyles.colors.white
    },
    
    varianceCell: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold
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
      ...TavariStyles.components.loading.container,
      minHeight: '200px'
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading cash drawer data...</div>;
  }

  if (error) {
    return <div style={styles.error}>{error}</div>;
  }

  const totalStarting = drawerData.reduce((sum, d) => sum + getDrawerStartingAmount(d), 0);
  const totalExpected = drawerData.reduce((sum, d) => sum + getDrawerExpectedAmount(d), 0);
  const totalActual = drawerData.reduce((sum, d) => sum + getDrawerActualAmount(d), 0);
  const totalVariance = drawerData.reduce((sum, d) => sum + getDrawerVarianceAmount(d), 0);
  const varianceCount = drawerData.filter(d => Math.abs(getDrawerVarianceAmount(d)) > varianceThreshold).length;

  const filteredDrawers = showVariances ? 
    drawerData.filter(d => Math.abs(getDrawerVarianceAmount(d)) > varianceThreshold) : 
    drawerData;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Cash Drawer Reconciliation</h3>
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
          checked={showVariances}
          onChange={setShowVariances}
          label="Show Only Variances"
          id="show-variances"
        />
        
        <div>
          <label style={{ fontSize: TavariStyles.typography.fontSize.sm, marginRight: TavariStyles.spacing.xs }}>
            Variance Threshold: $
          </label>
          <input
            type="number"
            value={varianceThreshold}
            onChange={(e) => setVarianceThreshold(Number(e.target.value) || 0)}
            step="0.01"
            min="0"
            style={styles.varianceInput}
          />
        </div>
      </div>

      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{drawerData.length}</div>
          <div style={styles.summaryLabel}>Total Drawers</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(totalStarting)}</div>
          <div style={styles.summaryLabel}>Starting Cash</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(totalExpected)}</div>
          <div style={styles.summaryLabel}>Expected Cash</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{formatCurrency(totalActual)}</div>
          <div style={styles.summaryLabel}>Actual Cash</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={{...styles.summaryValue, color: getVarianceColor(totalVariance)}}>
            {formatCurrency(totalVariance)}
          </div>
          <div style={styles.summaryLabel}>Total Variance</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={{...styles.summaryValue, color: varianceCount > 0 ? TavariStyles.colors.warning : TavariStyles.colors.success}}>
            {varianceCount}
          </div>
          <div style={styles.summaryLabel}>Variances Over ${varianceThreshold.toFixed(2)}</div>
        </div>
      </div>

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Opened</th>
              <th style={styles.th}>Closed</th>
              <th style={styles.th}>Opened By</th>
              <th style={styles.th}>Closed By</th>
              <th style={styles.th}>Starting</th>
              <th style={styles.th}>Expected</th>
              <th style={styles.th}>Actual</th>
              <th style={styles.th}>Variance</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Terminal</th>
              <th style={styles.th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filteredDrawers.length === 0 ? (
              <tr>
                <td colSpan="11" style={styles.noData}>
                  {showVariances ? 
                    `No variances over $${varianceThreshold.toFixed(2)} found for this period` : 
                    'No drawer data found for this period'
                  }
                </td>
              </tr>
            ) : (
              filteredDrawers.map((drawer, index) => (
                <tr key={drawer.id || index}>
                  <td style={styles.td}>{formatDateTime(drawer.opened_at)}</td>
                  <td style={styles.td}>{formatDateTime(drawer.closed_at)}</td>
                  <td style={styles.td}>{drawer.openerName || 'Unknown'}</td>
                  <td style={styles.td}>{drawer.closerName || 'Not closed'}</td>
                  <td style={styles.td}>{formatCurrency(getDrawerStartingAmount(drawer))}</td>
                  <td style={styles.td}>{formatCurrency(getDrawerExpectedAmount(drawer))}</td>
                  <td style={styles.td}>{formatCurrency(getDrawerActualAmount(drawer))}</td>
                  <td style={styles.td}>
                    <div style={{
                      ...styles.varianceCell,
                      color: getVarianceColor(getDrawerVarianceAmount(drawer))
                    }}>
                      <span>{getVarianceIcon(getDrawerVarianceAmount(drawer))}</span>
                      <span>{formatCurrency(getDrawerVarianceAmount(drawer))}</span>
                    </div>
                  </td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.statusBadge,
                      ...(drawer.status === 'closed' ? styles.statusClosed : styles.statusOpen)
                    }}>
                      {drawer.status || 'open'}
                    </span>
                  </td>
                  <td style={styles.td}>{drawer.terminal_id || 'N/A'}</td>
                  <td style={styles.td}>{drawer.notes || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CashDrawerReport;
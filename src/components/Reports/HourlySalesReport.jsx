// src/components/Reports/HourlySalesReport.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { logAction } from '../../helpers/posAudit';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const HourlySalesReport = ({ 
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
    componentName: 'HourlySalesReport'
  });

  const [hourlyData, setHourlyData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTransactionCount, setShowTransactionCount] = useState(true);
  const [showAverageTransaction, setShowAverageTransaction] = useState(true);
  const [highlightPeakHours, setHighlightPeakHours] = useState(true);

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadHourlyData();
    }
  }, [auth.selectedBusinessId, dateRange, customDateStart, customDateEnd, selectedEmployee]);

  const loadHourlyData = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      setLoading(true);
      setError(null);

      const { start, end } = getDateFilter();

      // Get sales data for the period
      let salesQuery = supabase
        .from('pos_sales')
        .select('id, subtotal, tax, total, created_at, user_id')
        .eq('business_id', auth.selectedBusinessId)
        .eq('payment_status', 'completed')
        .gte('created_at', start)
        .lt('created_at', end);

      if (selectedEmployee !== 'all') {
        salesQuery = salesQuery.eq('user_id', selectedEmployee);
      }

      const { data: sales, error: salesError } = await salesQuery;
      if (salesError) throw salesError;

      // Get refunds for the same period
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

      // Process hourly data
      const hourlyBreakdown = processHourlyData(sales || [], refunds || []);
      setHourlyData(hourlyBreakdown);

    } catch (err) {
      console.error('Error loading hourly data:', err);
      setError('Failed to load hourly sales data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const processHourlyData = (sales, refunds) => {
    // Initialize 24-hour array
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      displayHour: formatHour(i),
      sales: 0,
      refunds: 0,
      netSales: 0,
      transactionCount: 0,
      averageTransaction: 0,
      salesList: [],
      refundsList: []
    }));

    // Process sales by hour
    sales.forEach(sale => {
      const saleDate = new Date(sale.created_at);
      const hour = saleDate.getHours();
      const amount = Number(sale.total) || 0;
      
      hours[hour].sales += amount;
      hours[hour].transactionCount += 1;
      hours[hour].salesList.push(sale);
    });

    // Process refunds by hour
    refunds.forEach(refund => {
      const refundDate = new Date(refund.created_at);
      const hour = refundDate.getHours();
      const amount = Number(refund.total_refund_amount) || 0;
      
      hours[hour].refunds += amount;
      hours[hour].refundsList.push(refund);
    });

    // Calculate net sales and averages
    hours.forEach(hourData => {
      hourData.netSales = hourData.sales - hourData.refunds;
      hourData.averageTransaction = hourData.transactionCount > 0 ? 
        hourData.sales / hourData.transactionCount : 0;
    });

    return hours;
  };

  const formatHour = (hour) => {
    if (hour === 0) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    if (hour < 12) return `${hour}:00 AM`;
    return `${hour - 12}:00 PM`;
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

  const chartData = hourlyData.map((hour) => ({
    ...hour,
    shortHour:
      hour.hour === 0 ? '12A' :
      hour.hour < 12 ? `${hour.hour}A` :
      hour.hour === 12 ? '12P' :
      `${hour.hour - 12}P`
  }));

  const getPeakHours = () => {
    if (hourlyData.length === 0) return [];
    
    const maxSales = Math.max(...hourlyData.map(h => h.netSales));
    const threshold = maxSales * 0.8; // Consider top 20% as peak
    
    return hourlyData
      .filter(h => h.netSales >= threshold && h.netSales > 0)
      .map(h => h.hour);
  };

  const getHourColor = (hour, netSales) => {
    if (!highlightPeakHours) return TavariStyles.colors.gray50;
    
    const peakHours = getPeakHours();
    if (peakHours.includes(hour)) {
      return TavariStyles.colors.primary + '20'; // 20% opacity
    }
    return TavariStyles.colors.gray50;
  };

  const exportData = {
    csv: () => {
      const { start, end } = getDateRangeText();
      let csvContent = "data:text/csv;charset=utf-8,";
      
      csvContent += "Hourly Sales Breakdown Report\n";
      csvContent += `Period,${start} to ${end}\n`;
      csvContent += `Employee Filter,${getEmployeeName()}\n`;
      csvContent += `Generated,${new Date().toLocaleString()}\n\n`;
      
      csvContent += "Hour,Sales,Refunds,Net Sales,Transactions,Average Transaction\n";
      
      hourlyData.forEach(hour => {
        csvContent += `${hour.displayHour},${hour.sales.toFixed(2)},${hour.refunds.toFixed(2)},${hour.netSales.toFixed(2)},${hour.transactionCount},${hour.averageTransaction.toFixed(2)}\n`;
      });
      
      // Summary
      const totalSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
      const totalRefunds = hourlyData.reduce((sum, h) => sum + h.refunds, 0);
      const totalNet = hourlyData.reduce((sum, h) => sum + h.netSales, 0);
      const totalTransactions = hourlyData.reduce((sum, h) => sum + h.transactionCount, 0);
      const peakHours = getPeakHours();
      
      csvContent += `\nSummary\n`;
      csvContent += `Total Sales,${totalSales.toFixed(2)}\n`;
      csvContent += `Total Refunds,${totalRefunds.toFixed(2)}\n`;
      csvContent += `Net Sales,${totalNet.toFixed(2)}\n`;
      csvContent += `Total Transactions,${totalTransactions}\n`;
      csvContent += `Overall Average,${totalTransactions > 0 ? (totalSales / totalTransactions).toFixed(2) : '0.00'}\n`;
      csvContent += `Peak Hours,"${peakHours.map(h => formatHour(h)).join(', ')}"\n`;
      
      return csvContent;
    },
    
    excel: () => {
      return exportData.csv();
    },
    
    pdf: () => {
      return null;
    }
  };

  const emailContent = () => {
    const peakHours = getPeakHours();
    const totalSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
    const totalTransactions = hourlyData.reduce((sum, h) => sum + h.transactionCount, 0);
    
    return {
      subject: `Hourly Sales Breakdown - ${getDateRangeText().start} to ${getDateRangeText().end}`,
      body: `
Hourly Sales Breakdown Report

Period: ${getDateRangeText().start} to ${getDateRangeText().end}
Employee Filter: ${getEmployeeName()}
Generated: ${new Date().toLocaleString()}

SUMMARY:
- Total Sales: ${formatCurrency(totalSales)}
- Total Transactions: ${totalTransactions}
- Overall Average: ${formatCurrency(totalTransactions > 0 ? totalSales / totalTransactions : 0)}

PEAK HOURS:
${peakHours.length > 0 ? 
  peakHours.map(h => `• ${formatHour(h)}: ${formatCurrency(hourlyData[h].netSales)}`).join('\n') :
  '• No significant peak hours identified'
}

TOP 5 HOURS BY SALES:
${hourlyData
  .sort((a, b) => b.netSales - a.netSales)
  .slice(0, 5)
  .map(h => `• ${h.displayHour}: ${formatCurrency(h.netSales)} (${h.transactionCount} transactions)`)
  .join('\n')
}

This report shows sales activity broken down by hour of day for business planning purposes.
      `.trim()
    };
  };

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
      onExport(content, format, 'hourly-breakdown');
      
      logAction({
        action: 'hourly_sales_report_exported',
        context: 'HourlySalesReport',
        metadata: {
          format,
          date_range: dateRange,
          total_hours_with_sales: hourlyData.filter(h => h.sales > 0).length,
          business_id: auth.selectedBusinessId
        }
      });
    }
  };

  const handleEmail = () => {
    const content = emailContent();
    onEmail(content, exportData.csv(), 'hourly-breakdown');
    
    logAction({
      action: 'hourly_sales_report_emailed',
      context: 'HourlySalesReport',
      metadata: {
        date_range: dateRange,
        total_hours_with_sales: hourlyData.filter(h => h.sales > 0).length,
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
    
    chartSection: {
      marginBottom: TavariStyles.spacing.lg,
      width: '100%'
    },

    chartContainer: {
      width: '100%',
      height: 360,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50
    },

    chartLegend: {
      marginTop: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      textAlign: 'center'
    },

    chartTooltip: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.md,
      boxShadow: TavariStyles.shadows.md,
      padding: TavariStyles.spacing.sm,
      minWidth: '180px'
    },

    tooltipTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },

    tooltipRow: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray700,
      marginBottom: 4
    },

    chartNotes: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md,
      width: '100%'
    },
    
    chartNoteCard: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.white
    },
    
    chartNoteTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    
    chartNoteValue: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    chartNoteDetail: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      lineHeight: TavariStyles.typography.lineHeight.tight
    },
    
    summarySection: {
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray100,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      width: '100%'
    },
    
    summaryTitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.sm,
      width: '100%'
    },
    
    summaryItem: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    peakHoursSection: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.primary + '10',
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.primary + '30'}`,
      width: '100%'
    },
    
    peakHoursList: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.xs,
      marginTop: TavariStyles.spacing.sm
    },
    
    peakHourBadge: {
      padding: '4px 8px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
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
      textAlign: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray500
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading hourly sales data...</div>;
  }

  if (error) {
    return <div style={styles.error}>{error}</div>;
  }

  const totalSales = hourlyData.reduce((sum, h) => sum + h.sales, 0);
  const totalRefunds = hourlyData.reduce((sum, h) => sum + h.refunds, 0);
  const totalNet = hourlyData.reduce((sum, h) => sum + h.netSales, 0);
  const totalTransactions = hourlyData.reduce((sum, h) => sum + h.transactionCount, 0);
  const peakHours = getPeakHours();
  const hoursWithSales = hourlyData.filter(h => h.sales > 0).length;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) {
      return null;
    }

    const point = payload[0]?.payload;
    if (!point) return null;

    return (
      <div style={styles.chartTooltip}>
        <div style={styles.tooltipTitle}>{label}</div>
        <div style={styles.tooltipRow}>Sales: {formatCurrency(point.netSales)}</div>
        {showTransactionCount && (
          <div style={styles.tooltipRow}>Transactions: {point.transactionCount}</div>
        )}
        {showAverageTransaction && point.transactionCount > 0 && (
          <div style={styles.tooltipRow}>Avg Transaction: {formatCurrency(point.averageTransaction)}</div>
        )}
        {point.refunds > 0 && (
          <div style={{ ...styles.tooltipRow, color: TavariStyles.colors.danger }}>
            Refunds: {formatCurrency(point.refunds)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Hourly Sales Breakdown</h3>
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
          checked={showTransactionCount}
          onChange={setShowTransactionCount}
          label="Show Transaction Count"
          id="show-transaction-count"
        />
        
        <TavariCheckbox
          checked={showAverageTransaction}
          onChange={setShowAverageTransaction}
          label="Show Average Transaction"
          id="show-average-transaction"
        />
        
        <TavariCheckbox
          checked={highlightPeakHours}
          onChange={setHighlightPeakHours}
          label="Highlight Peak Hours"
          id="highlight-peak-hours"
        />
      </div>

      {hourlyData.length === 0 ? (
        <div style={styles.noData}>
          No hourly sales data found for this period
        </div>
      ) : (
        <>
          <div style={styles.chartSection}>
            <div style={styles.chartContainer}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 20, left: 8, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={TavariStyles.colors.gray200} />
                  <XAxis
                    dataKey="shortHour"
                    interval={0}
                    tick={{ fontSize: 10, fill: TavariStyles.colors.gray600 }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: TavariStyles.colors.gray600 }}
                    tickFormatter={(value) => `$${Number(value || 0).toFixed(0)}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="netSales"
                    name="Sales"
                    stroke={TavariStyles.colors.primary}
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 2, fill: TavariStyles.colors.white }}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={styles.chartLegend}>
              24-hour sales trend. Hover over any point to see the sales amount for that hour.
            </div>
            <div style={styles.chartNotes}>
              <div style={styles.chartNoteCard}>
                <div style={styles.chartNoteTitle}>Peak Hour</div>
                <div style={styles.chartNoteValue}>
                  {peakHours.length > 0 ? formatHour(peakHours[0]) : 'None'}
                </div>
                <div style={styles.chartNoteDetail}>
                  Highest-performing hour based on net sales.
                </div>
              </div>
              <div style={styles.chartNoteCard}>
                <div style={styles.chartNoteTitle}>Hours With Sales</div>
                <div style={styles.chartNoteValue}>{hoursWithSales} / 24</div>
                <div style={styles.chartNoteDetail}>
                  Hours that recorded at least one sale during the selected period.
                </div>
              </div>
              <div style={styles.chartNoteCard}>
                <div style={styles.chartNoteTitle}>Hourly Average</div>
                <div style={styles.chartNoteValue}>
                  {formatCurrency(hoursWithSales > 0 ? totalNet / hoursWithSales : 0)}
                </div>
                <div style={styles.chartNoteDetail}>
                  Average net sales across the hours that had activity.
                </div>
              </div>
            </div>
          </div>

          <div style={styles.summarySection}>
            <h4 style={styles.summaryTitle}>Daily Summary</h4>
            <div style={styles.summaryGrid}>
              <div style={styles.summaryItem}>
                <span>Total Sales:</span>
                <span>{formatCurrency(totalSales)}</span>
              </div>
              <div style={styles.summaryItem}>
                <span>Total Refunds:</span>
                <span>{formatCurrency(totalRefunds)}</span>
              </div>
              <div style={styles.summaryItem}>
                <span>Net Sales:</span>
                <span>{formatCurrency(totalNet)}</span>
              </div>
              <div style={styles.summaryItem}>
                <span>Total Transactions:</span>
                <span>{totalTransactions}</span>
              </div>
              <div style={styles.summaryItem}>
                <span>Hours with Sales:</span>
                <span>{hoursWithSales} of 24</span>
              </div>
              <div style={styles.summaryItem}>
                <span>Overall Average:</span>
                <span>{formatCurrency(totalTransactions > 0 ? totalSales / totalTransactions : 0)}</span>
              </div>
            </div>

            {peakHours.length > 0 && (
              <div style={styles.peakHoursSection}>
                <h5 style={styles.summaryTitle}>Peak Hours (Top 20% by Sales)</h5>
                <div style={styles.peakHoursList}>
                  {peakHours.map(hour => (
                    <span key={hour} style={styles.peakHourBadge}>
                      {formatHour(hour)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default HourlySalesReport;
// components/POS/POSDailyDepositScreen/POSDepositCountComponent.jsx - Cash Counting Interface
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { TavariStyles } from '../../../utils/TavariStyles';
import { insertAuditLog } from '../../../utils/auditLogInsert';
import {
  fetchRegisterStations,
  getStationDepositKey,
} from '../../../services/posRegisterStationsService';
import bcrypt from 'bcryptjs';

const POSDepositCountComponent = ({ 
  businessId, 
  userId, 
  businessSettings, 
  taskKioskCredentials = null,
  onDepositComplete 
}) => {
  const auth = usePOSAuth({
    requiredRoles: taskKioskCredentials ? null : ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSDepositCountComponent'
  });

  // State for till selection and data
  const [selectedStationId, setSelectedStationId] = useState('');
  const [availableStations, setAvailableStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [dailyTransactions, setDailyTransactions] = useState({});
  const [refundData, setRefundData] = useState([]);

  // Cash counting state - Canadian denominations
  const [cashCounts, setCashCounts] = useState({
    // Coins
    '0.05': 0,  // Nickel
    '0.10': 0,  // Dime
    '0.25': 0,  // Quarter
    '1.00': 0,  // Loonie
    '2.00': 0,  // Toonie
    // Bills
    '5.00': 0,
    '10.00': 0,
    '20.00': 0,
    '50.00': 0,
    '100.00': 0,
    // Coin Rolls
    'nickel_roll': 0,    // $2.00 each
    'dime_roll': 0,      // $5.00 each
    'quarter_roll': 0,   // $10.00 each
    'loonie_roll': 0,    // $25.00 each
    'toonie_roll': 0     // $50.00 each
  });

  // Other payment methods
  const [otherCounts, setOtherCounts] = useState({
    checks: 0,
    gift_cards: 0
  });

  // Manager PIN state for variance approval
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [managerPinError, setManagerPinError] = useState('');
  const [pendingDeposit, setPendingDeposit] = useState(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState('');

  // Load available tills when component mounts
  useEffect(() => {
    if (businessId) {
      loadAvailableStations();
    }
  }, [businessId]);

  useEffect(() => {
    if (selectedStationId && businessId) {
      const station = availableStations.find((item) => item.id === selectedStationId) || null;
      setSelectedStation(station);
    } else {
      setSelectedStation(null);
    }
  }, [selectedStationId, availableStations, businessId]);

  useEffect(() => {
    if (selectedStation && businessId) {
      loadDailyData(selectedStation);
    }
  }, [selectedStation, businessId]);

  const loadAvailableStations = async () => {
    try {
      if (taskKioskCredentials) {
        const { data: ctx, error: ctxError } = await supabase.rpc('task_kiosk_pos_daily_deposit_context', {
          p_token: taskKioskCredentials.token,
          p_business_id: businessId,
          p_employee_id: taskKioskCredentials.employeeId
        });
        if (ctxError) throw ctxError;
        const stations = ctx?.stations || [];
        setAvailableStations(stations);
        if (stations.length === 1) {
          setSelectedStationId(stations[0].id);
        }
        return;
      }

      const { data: stations, error } = await fetchRegisterStations(businessId);

      if (error) throw error;

      setAvailableStations(stations || []);

      if ((stations || []).length === 1) {
        setSelectedStationId(stations[0].id);
      }
    } catch (err) {
      console.error('Error loading register stations:', err);
      setError('Failed to load register stations. Add stations under POS Settings → General.');
    }
  };

  const loadDailyData = async (station) => {
    try {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const posTerminalId = station?.terminal_id || null;

      if (!posTerminalId) {
        setDailyTransactions({ cash: 0, card: 0, gift_card: 0, check: 0, other: 0 });
        setRefundData([]);
        return;
      }

      if (taskKioskCredentials) {
        const { data: payload, error: rpcError } = await supabase.rpc('task_kiosk_pos_daily_deposit_station_data', {
          p_token: taskKioskCredentials.token,
          p_business_id: businessId,
          p_employee_id: taskKioskCredentials.employeeId,
          p_terminal_id: posTerminalId,
          p_deposit_date: today
        });
        if (rpcError) throw rpcError;
        setRefundData(payload?.refunds || []);
        setDailyTransactions(payload?.totals || { cash: 0, card: 0, gift_card: 0, check: 0, other: 0 });
        return;
      }

      const { data: sales, error: salesError } = await supabase
        .from('pos_sales')
        .select('id, total, payment_method')
        .eq('business_id', businessId)
        .eq('terminal_id', posTerminalId)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lt('created_at', `${today}T23:59:59.999Z`);

      if (salesError) throw salesError;

      const saleIds = (sales || []).map((sale) => sale.id).filter(Boolean);
      let payments = [];

      if (saleIds.length > 0) {
        const { data: paymentRows, error: paymentsError } = await supabase
          .from('pos_payments')
          .select('amount, payment_method, custom_method_name, sale_id')
          .eq('business_id', businessId)
          .in('sale_id', saleIds)
          .gte('created_at', `${today}T00:00:00.000Z`)
          .lt('created_at', `${today}T23:59:59.999Z`);

        if (paymentsError) throw paymentsError;
        payments = paymentRows || [];
      }

      let refunds = [];
      if (saleIds.length > 0) {
        const { data: refundRows, error: refundsError } = await supabase
          .from('pos_refunds')
          .select('total_refund_amount, refund_method, reason, created_at, refunded_by, original_sale_id')
          .eq('business_id', businessId)
          .in('original_sale_id', saleIds)
          .gte('created_at', `${today}T00:00:00.000Z`)
          .lt('created_at', `${today}T23:59:59.999Z`)
          .order('created_at', { ascending: false });

        if (refundsError) {
          console.warn('Error loading refunds (non-critical):', refundsError);
        } else {
          refunds = refundRows || [];
        }
      }

      setRefundData(refunds);

      // Calculate totals by payment method
      const totals = {
        cash: 0,
        card: 0,
        gift_card: 0,
        check: 0,
        other: 0
      };

      payments?.forEach(payment => {
        const amount = Number(payment.amount) || 0;
        switch (payment.payment_method) {
          case 'cash':
            totals.cash += amount;
            break;
          case 'card':
          case 'credit':
          case 'debit':
          case 'helcim':
            totals.card += amount;
            break;
          case 'gift_card':
            totals.gift_card += amount;
            break;
          case 'check':
            totals.check += amount;
            break;
          default:
            totals.other += amount;
        }
      });

      setDailyTransactions(totals);

    } catch (err) {
      console.error('Error loading daily data:', err);
      setError('Failed to load daily transaction data');
    } finally {
      setLoading(false);
    }
  };

  // Calculate cash totals
  const calculateCashTotal = useCallback(() => {
    let total = 0;
    
    // Regular denominations
    Object.entries(cashCounts).forEach(([denomination, count]) => {
      if (denomination.includes('_roll')) return; // Handle rolls separately
      total += Number(denomination) * Number(count || 0);
    });

    // Coin rolls
    const rollValues = {
      nickel_roll: 2.00,
      dime_roll: 5.00,
      quarter_roll: 10.00,
      loonie_roll: 25.00,
      toonie_roll: 50.00
    };

    Object.entries(rollValues).forEach(([rollType, value]) => {
      total += value * Number(cashCounts[rollType] || 0);
    });

    return total;
  }, [cashCounts]);

  // Calculate other totals
  const calculateOtherTotal = useCallback(() => {
    return Object.values(otherCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  }, [otherCounts]);

  const selectedFloatAmount = Number(selectedStation?.float_amount ?? businessSettings.default_float_amount ?? 0);

  // Calculate variance
  const calculateVariance = useCallback(() => {
    const countedCash = calculateCashTotal();
    const countedOther = calculateOtherTotal();
    const countedTotal = countedCash + countedOther;
    
    const expectedCash = (dailyTransactions.cash || 0) + selectedFloatAmount;
    const expectedOther = (dailyTransactions.check || 0) + (dailyTransactions.gift_card || 0);
    const expectedTotal = expectedCash + expectedOther;
    
    return {
      countedCash,
      countedOther,
      countedTotal,
      expectedCash,
      expectedOther,
      expectedTotal,
      variance: countedTotal - expectedTotal
    };
  }, [calculateCashTotal, calculateOtherTotal, dailyTransactions, selectedFloatAmount]);

  const variance = calculateVariance();

  // Handle cash count changes
  const handleCashCountChange = (denomination, value) => {
    setCashCounts(prev => ({
      ...prev,
      [denomination]: Math.max(0, Number(value) || 0)
    }));
  };

  // Handle other count changes
  const handleOtherCountChange = (type, value) => {
    setOtherCounts(prev => ({
      ...prev,
      [type]: Math.max(0, Number(value) || 0)
    }));
  };

  // Validate manager PIN
  const validateManagerPin = async () => {
    if (!managerPin || managerPin.length !== 4) {
      setManagerPinError('PIN must be 4 digits');
      return false;
    }

    try {
      if (taskKioskCredentials) {
        const { data: manager, error: rpcError } = await supabase.rpc('task_kiosk_validate_manager_pin', {
          p_token: taskKioskCredentials.token,
          p_business_id: businessId,
          p_employee_id: taskKioskCredentials.employeeId,
          p_manager_pin: managerPin
        });
        if (rpcError) throw rpcError;
        if (manager?.id) {
          return { success: true, manager };
        }
        setManagerPinError('Invalid manager PIN');
        return { success: false };
      }

      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('active', true)
        .in('role', ['manager', 'owner']);

      if (rolesError) throw rolesError;

      const managerUserIds = userRoles.map(ur => ur.user_id);

      const { data: managers, error: managersError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', managerUserIds);

      if (managersError) throw managersError;

      for (const manager of managers) {
        if (!manager.pin) continue;
        
        let pinMatched = false;
        if (manager.pin.startsWith('$2b$') || manager.pin.startsWith('$2a$')) {
          pinMatched = await bcrypt.compare(managerPin, manager.pin);
        } else {
          pinMatched = manager.pin === managerPin;
        }

        if (pinMatched) {
          return { success: true, manager };
        }
      }

      setManagerPinError('Invalid manager PIN');
      return { success: false };
    } catch (err) {
      console.error('Error validating manager PIN:', err);
      setManagerPinError('Error validating PIN');
      return { success: false };
    }
  };

  // Handle deposit submission
  const handleSubmitDeposit = async () => {
    if (!selectedStation) {
      setError('Please select a register station');
      return;
    }

    const varianceAmount = Math.abs(variance.variance);
    const maxVariance = businessSettings.max_drawer_variance || 5.00;
    
    if (businessSettings.require_manager_pin_for_variance && varianceAmount > maxVariance) {
      setPendingDeposit({
        ...variance,
        notes: notes.trim(),
        selectedStation
      });
      setShowManagerPinModal(true);
      return;
    }

    await saveDeposit();
  };

  // Save deposit to database
  const saveDeposit = async (managerApproval = null) => {
    try {
      setLoading(true);
      
      const depositData = {
        business_id: businessId,
        terminal_id: getStationDepositKey(selectedStation),
        deposit_date: new Date().toISOString().split('T')[0],
        
        // Expected amounts
        expected_cash: variance.expectedCash,
        expected_checks: dailyTransactions.check || 0,
        expected_gift_cards: dailyTransactions.gift_card || 0,
        expected_total: variance.expectedTotal,
        
        // Counted amounts
        counted_cash: variance.countedCash,
        counted_checks: otherCounts.checks,
        counted_gift_cards: otherCounts.gift_cards,
        counted_total: variance.countedTotal,
        
        // Variance
        variance_amount: variance.variance,
        variance_percentage: variance.expectedTotal > 0 ? (variance.variance / variance.expectedTotal) * 100 : 0,
        
        // Cash breakdown
        cash_breakdown: cashCounts,
        
        // Metadata
        float_amount: selectedFloatAmount,
        refund_count: refundData.length,
        total_refunds: refundData.reduce((sum, r) => sum + (Number(r.total_refund_amount) || 0), 0),
        
        // User info
        counted_by: userId,
        verified_by: managerApproval?.manager?.id || userId,
        manager_override_required: !!managerApproval,
        
        // Notes
        notes: notes.trim() || null,
        
        // Status
        status: 'completed',
        submitted_to_bank: false
      };

      if (taskKioskCredentials) {
        const { data: depositId, error: saveError } = await supabase.rpc('task_kiosk_pos_daily_deposit_save', {
          p_token: taskKioskCredentials.token,
          p_business_id: businessId,
          p_employee_id: taskKioskCredentials.employeeId,
          p_deposit: {
            ...depositData,
            verified_by: managerApproval?.manager?.id || userId
          }
        });
        if (saveError) throw saveError;

        await insertAuditLog({
          userId,
          businessId,
          details: {
            action: 'daily_deposit_created',
            context: 'POSDepositCount',
            deposit_id: depositId,
            terminal_id: selectedStation?.terminal_name || getStationDepositKey(selectedStation),
            variance_amount: variance.variance,
            manager_approval: !!managerApproval,
            approved_by: managerApproval?.manager?.full_name,
            task_kiosk: true
          },
        });
      } else {
        const { data: deposit, error: depositError } = await supabase
        .from('pos_daily_deposits')
        .insert(depositData)
        .select()
        .single();

        if (depositError) throw depositError;

        await insertAuditLog({
          userId,
          businessId,
          details: {
            action: 'daily_deposit_created',
            context: 'POSDepositCount',
            deposit_id: deposit.id,
            terminal_id: selectedStation?.terminal_name || getStationDepositKey(selectedStation),
            variance_amount: variance.variance,
            manager_approval: !!managerApproval,
            approved_by: managerApproval?.manager?.full_name || managerApproval?.manager?.email,
          },
        });
      }

      // Reset form
      setCashCounts({
        '0.05': 0, '0.10': 0, '0.25': 0, '1.00': 0, '2.00': 0,
        '5.00': 0, '10.00': 0, '20.00': 0, '50.00': 0, '100.00': 0,
        'nickel_roll': 0, 'dime_roll': 0, 'quarter_roll': 0, 'loonie_roll': 0, 'toonie_roll': 0
      });
      setOtherCounts({ checks: 0, gift_cards: 0 });
      setNotes('');
      
      // Close PIN modal and reset state
      setShowManagerPinModal(false);
      setManagerPin('');
      setManagerPinError('');
      setPendingDeposit(null);

      showToast('Daily deposit saved successfully', 'success');
      
      if (onDepositComplete) {
        onDepositComplete();
      }

    } catch (err) {
      console.error('Error saving deposit:', err);
      setError(`Failed to save deposit: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle manager PIN approval
  const handleManagerPinApproval = async () => {
    const validation = await validateManagerPin();
    if (validation.success) {
      await saveDeposit(validation);
    }
  };

  const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? TavariStyles.colors.danger : 
                   type === 'success' ? TavariStyles.colors.success : 
                   TavariStyles.colors.primary;
    
    toast.style.cssText = `
      position: fixed;
      top: 120px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-weight: bold;
      z-index: 1000;
      background-color: ${bgColor};
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 3000);
  };

  // Currency formatting helper
  const formatCurrency = (amount) => {
    return `$${Number(amount || 0).toFixed(2)}`;
  };

  // Define denomination display data
  const denominations = [
    { value: '0.05', label: 'Nickels ($0.05)', type: 'coin' },
    { value: '0.10', label: 'Dimes ($0.10)', type: 'coin' },
    { value: '0.25', label: 'Quarters ($0.25)', type: 'coin' },
    { value: '1.00', label: 'Loonies ($1.00)', type: 'coin' },
    { value: '2.00', label: 'Toonies ($2.00)', type: 'coin' },
    { value: '5.00', label: '$5 Bills', type: 'bill' },
    { value: '10.00', label: '$10 Bills', type: 'bill' },
    { value: '20.00', label: '$20 Bills', type: 'bill' },
    { value: '50.00', label: '$50 Bills', type: 'bill' },
    { value: '100.00', label: '$100 Bills', type: 'bill' }
  ];

  const coinRolls = [
    { value: 'nickel_roll', label: 'Nickel Rolls', rollValue: 2.00 },
    { value: 'dime_roll', label: 'Dime Rolls', rollValue: 5.00 },
    { value: 'quarter_roll', label: 'Quarter Rolls', rollValue: 10.00 },
    { value: 'loonie_roll', label: 'Loonie Rolls', rollValue: 25.00 },
    { value: 'toonie_roll', label: 'Toonie Rolls', rollValue: 50.00 }
  ];

  if (availableStations.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>No register stations configured</h3>
          <p style={styles.emptyText}>
            Add register stations under <strong>POS Settings → General → Register Stations</strong>.
            Each station links POS sales, Helcim, and cash drawer counting together.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !selectedStation) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={TavariStyles.components.loading.spinner}></div>
          <div>Loading station data...</div>
          <style>{TavariStyles.keyframes.spin}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Select Register Station</h3>
        <select
          value={selectedStationId}
          onChange={(e) => setSelectedStationId(e.target.value)}
          style={styles.tillSelect}
        >
          <option value="">Select a station to count...</option>
          {availableStations.map((station) => (
            <option key={station.id} value={station.id}>
              {station.terminal_name} (float ${Number(station.float_amount || 0).toFixed(2)})
            </option>
          ))}
        </select>
      </div>

      {selectedStation && (
        <>
          <div style={styles.tillMeta}>
            <span><strong>Float:</strong> {formatCurrency(selectedFloatAmount)}</span>
            <span><strong>POS ID:</strong> {selectedStation.terminal_id}</span>
            {selectedStation.helcim_device_code ? (
              <span><strong>Helcim:</strong> {selectedStation.helcim_device_code}</span>
            ) : (
              <span><strong>Helcim:</strong> not configured</span>
            )}
          </div>
          {/* Cash Counting Grid */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Cash Count</h3>
            
            {/* Regular Denominations */}
            <div style={styles.denominationGrid}>
              <div style={styles.gridHeader}>
                <span>Denomination</span>
                <span>Quantity</span>
                <span>Total</span>
              </div>
              
              {denominations.map(denom => (
                <div key={denom.value} style={styles.gridRow}>
                  <span style={styles.denominationLabel}>{denom.label}</span>
                  <input
                    type="number"
                    min="0"
                    value={cashCounts[denom.value] || ''}
                    onChange={(e) => handleCashCountChange(denom.value, e.target.value)}
                    style={styles.countInput}
                    placeholder="0"
                  />
                  <span style={styles.totalCell}>
                    {formatCurrency(Number(denom.value) * (cashCounts[denom.value] || 0))}
                  </span>
                </div>
              ))}
            </div>

            {/* Coin Rolls */}
            <h4 style={styles.subSectionTitle}>Coin Rolls</h4>
            <div style={styles.denominationGrid}>
              <div style={styles.gridHeader}>
                <span>Roll Type</span>
                <span>Quantity</span>
                <span>Total</span>
              </div>
              
              {coinRolls.map(roll => (
                <div key={roll.value} style={styles.gridRow}>
                  <span style={styles.denominationLabel}>
                    {roll.label} ({formatCurrency(roll.rollValue)} each)
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={cashCounts[roll.value] || ''}
                    onChange={(e) => handleCashCountChange(roll.value, e.target.value)}
                    style={styles.countInput}
                    placeholder="0"
                  />
                  <span style={styles.totalCell}>
                    {formatCurrency(roll.rollValue * (cashCounts[roll.value] || 0))}
                  </span>
                </div>
              ))}
            </div>

            <div style={styles.cashTotal}>
              <strong>Total Cash: {formatCurrency(calculateCashTotal())}</strong>
            </div>
          </div>

          {/* Other Payment Methods */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Other Payment Methods</h3>
            <div style={styles.otherPaymentsGrid}>
              <div style={styles.gridRow}>
                <span style={styles.denominationLabel}>Checks</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={otherCounts.checks || ''}
                  onChange={(e) => handleOtherCountChange('checks', e.target.value)}
                  style={styles.countInput}
                  placeholder="0.00"
                />
                <span style={styles.totalCell}>{formatCurrency(otherCounts.checks)}</span>
              </div>
              <div style={styles.gridRow}>
                <span style={styles.denominationLabel}>Gift Cards</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={otherCounts.gift_cards || ''}
                  onChange={(e) => handleOtherCountChange('gift_cards', e.target.value)}
                  style={styles.countInput}
                  placeholder="0.00"
                />
                <span style={styles.totalCell}>{formatCurrency(otherCounts.gift_cards)}</span>
              </div>
            </div>
          </div>

          {/* Refunds Display */}
          {refundData.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Refunds for This Station</h3>
              <div style={styles.refundsList}>
                {refundData.map((refund, index) => (
                  <div key={index} style={styles.refundItem}>
                    <span>{formatCurrency(refund.total_refund_amount)}</span>
                    <span>{refund.reason}</span>
                    <span>{new Date(refund.created_at).toLocaleTimeString()}</span>
                  </div>
                ))}
                <div style={styles.refundTotal}>
                  <strong>
                    Total Refunds: {formatCurrency(refundData.reduce((sum, r) => sum + Number(r.total_refund_amount), 0))}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Summary */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Deposit Summary</h3>
            <div style={styles.summaryGrid}>
              <div style={styles.summaryRow}>
                <span>Expected Cash (including float):</span>
                <span>{formatCurrency(variance.expectedCash)}</span>
              </div>
              <div style={styles.summaryRow}>
                <span>Expected Other:</span>
                <span>{formatCurrency(variance.expectedOther)}</span>
              </div>
              <div style={styles.summaryRow}>
                <span>Expected Total:</span>
                <span><strong>{formatCurrency(variance.expectedTotal)}</strong></span>
              </div>
              
              <div style={styles.summaryDivider}></div>
              
              <div style={styles.summaryRow}>
                <span>Counted Cash:</span>
                <span>{formatCurrency(variance.countedCash)}</span>
              </div>
              <div style={styles.summaryRow}>
                <span>Counted Other:</span>
                <span>{formatCurrency(variance.countedOther)}</span>
              </div>
              <div style={styles.summaryRow}>
                <span>Counted Total:</span>
                <span><strong>{formatCurrency(variance.countedTotal)}</strong></span>
              </div>
              
              <div style={styles.summaryDivider}></div>
              
              <div style={{
                ...styles.summaryRow,
                ...styles.varianceRow,
                color: variance.variance === 0 ? TavariStyles.colors.success :
                       variance.variance > 0 ? TavariStyles.colors.primary :
                       TavariStyles.colors.danger
              }}>
                <span>Over / Under:</span>
                <span><strong>{formatCurrency(variance.variance)}</strong></span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this deposit..."
              style={styles.notesTextarea}
              rows={3}
              maxLength={500}
            />
          </div>

          {/* Submit Button */}
          <div style={styles.actions}>
            <button
              onClick={handleSubmitDeposit}
              disabled={loading || !selectedStation}
              style={{
                ...TavariStyles.components.button.base,
                ...TavariStyles.components.button.variants.primary,
                ...TavariStyles.components.button.sizes.lg,
                width: '100%'
              }}
            >
              {loading ? 'Saving Deposit...' : 'Submit Daily Deposit'}
            </button>
          </div>
        </>
      )}

      {/* Manager PIN Modal */}
      {showManagerPinModal && (
        <div style={TavariStyles.components.modal.overlay}>
          <div style={TavariStyles.components.modal.content}>
            <div style={TavariStyles.components.modal.header}>
              <h3>Manager Approval Required</h3>
              <button
                onClick={() => {
                  setShowManagerPinModal(false);
                  setManagerPin('');
                  setManagerPinError('');
                  setPendingDeposit(null);
                }}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>
            
            <div style={TavariStyles.components.modal.body}>
              <p>
                Variance of {formatCurrency(Math.abs(variance.variance))} exceeds the maximum allowed 
                variance of {formatCurrency(businessSettings.max_drawer_variance || 5.00)}. 
                Manager approval is required.
              </p>
              
              <div style={styles.formGroup}>
                <label style={TavariStyles.components.form.label}>Manager PIN</label>
                <input
                  type="password"
                  maxLength={4}
                  value={managerPin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setManagerPin(value);
                    setManagerPinError('');
                  }}
                  placeholder="••••"
                  style={{
                    ...TavariStyles.components.form.input,
                    textAlign: 'center',
                    letterSpacing: '4px',
                    fontSize: '18px',
                    fontFamily: 'monospace'
                  }}
                  autoFocus
                />
                {managerPinError && (
                  <p style={styles.errorText}>{managerPinError}</p>
                )}
              </div>
            </div>
            
            <div style={TavariStyles.components.modal.footer}>
              <button
                onClick={() => {
                  setShowManagerPinModal(false);
                  setManagerPin('');
                  setManagerPinError('');
                  setPendingDeposit(null);
                }}
                style={{
                  ...TavariStyles.components.button.base,
                  ...TavariStyles.components.button.variants.secondary
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleManagerPinApproval}
                disabled={managerPin.length !== 4}
                style={{
                  ...TavariStyles.components.button.base,
                  ...TavariStyles.components.button.variants.primary
                }}
              >
                Approve Deposit
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={TavariStyles.utils.merge(
          TavariStyles.components.banner.base,
          TavariStyles.components.banner.variants.error
        )}>
          {error}
        </div>
      )}
    </div>
  );
};

// Styles
const styles = {
  container: {
    padding: TavariStyles.spacing.xl,
    maxHeight: 'calc(100vh - 200px)',
    overflow: 'auto'
  },

  section: {
    marginBottom: TavariStyles.spacing['3xl'],
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius.lg
  },

  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.lg,
    paddingBottom: TavariStyles.spacing.sm,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`
  },

  subSectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray700,
    marginTop: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.md
  },

  tillSelect: {
    ...TavariStyles.components.form.select,
    width: '100%',
    maxWidth: '420px'
  },

  tillMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.lg,
    color: TavariStyles.colors.gray700,
    fontSize: TavariStyles.typography.fontSize.sm,
  },

  emptyText: {
    color: TavariStyles.colors.gray600,
    lineHeight: TavariStyles.typography.lineHeight.relaxed,
  },

  denominationGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: TavariStyles.spacing.md,
    alignItems: 'center'
  },

  gridHeader: {
    display: 'contents',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    fontSize: TavariStyles.typography.fontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },

  gridRow: {
    display: 'contents'
  },

  denominationLabel: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray700,
    fontWeight: TavariStyles.typography.fontWeight.medium
  },

  countInput: {
    ...TavariStyles.components.form.input,
    width: '100px',
    textAlign: 'center'
  },

  totalCell: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    textAlign: 'right',
    minWidth: '80px'
  },

  cashTotal: {
    marginTop: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    textAlign: 'center',
    fontSize: TavariStyles.typography.fontSize.lg
  },

  otherPaymentsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: TavariStyles.spacing.md,
    alignItems: 'center'
  },

  refundsList: {
    backgroundColor: TavariStyles.colors.gray50,
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.md
  },

  refundItem: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.sm,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    fontSize: TavariStyles.typography.fontSize.sm
  },

  refundTotal: {
    paddingTop: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.md,
    borderTop: `2px solid ${TavariStyles.colors.gray300}`,
    textAlign: 'right'
  },

  summaryGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },

  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray700
  },

  summaryDivider: {
    height: '1px',
    backgroundColor: TavariStyles.colors.gray300,
    margin: `${TavariStyles.spacing.sm} 0`
  },

  varianceRow: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.sm
  },

  notesTextarea: {
    ...TavariStyles.components.form.input,
    width: '100%',
    resize: 'vertical',
    fontFamily: TavariStyles.typography.fontFamily
  },

  actions: {
    marginTop: TavariStyles.spacing.xl,
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.lg
  },

  loading: {
    ...TavariStyles.components.loading.container,
    minHeight: '200px'
  },

  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600
  },

  formGroup: {
    marginBottom: TavariStyles.spacing.lg
  },

  errorText: {
    color: TavariStyles.colors.danger,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginTop: TavariStyles.spacing.xs
  }
};

export default POSDepositCountComponent;
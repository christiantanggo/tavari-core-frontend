// src/components/POS/POSDrawerComponent.jsx - Complete Drawer Management with Open/Close Flow
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAuditLog } from '../../hooks/useAuditLog';
import { TavariStyles } from '../../utils/TavariStyles';
import bcrypt from 'bcryptjs';

const POSDrawerComponent = ({ businessId, currentTerminalId, onDrawerOpened, onDrawerClosed, visible = false, onClose }) => {
  const auth = usePOSAuth({
    requiredRoles: ['cashier', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSDrawerComponent'
  });

  const { logPOS, logSecurity } = useAuditLog();

  // Mode state - 'open' or 'close'
  const [drawerMode, setDrawerMode] = useState('open');

  // Settings and data
  const [posSettings, setPosSettings] = useState({
    drawer_manager_pin_required: false,
    drawer_open_reasons: ['No Sale', 'Change Request', 'Till Check', 'Manager Request', 'Refund', 'Other'],
    max_drawer_variance: 5.00,
    require_manager_pin_for_variance: true
  });
  const [drawerHistory, setDrawerHistory] = useState([]);
  const [currentDrawerSession, setCurrentDrawerSession] = useState(null);
  const [loading, setLoading] = useState(false);

  // Form state for opening
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [openNotes, setOpenNotes] = useState('');

  // Form state for closing - Canadian denominations
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
  const [expectedCash, setExpectedCash] = useState(0);
  const [closeNotes, setCloseNotes] = useState('');
  const [requireRecount, setRequireRecount] = useState(false);

  // Manager PIN state
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [managerPinError, setManagerPinError] = useState('');
  const [pendingDrawerAction, setPendingDrawerAction] = useState(null);

  useEffect(() => {
    if (businessId && visible) {
      loadPosSettings();
      loadDrawerHistory();
      checkCurrentDrawerSession();
    }
  }, [businessId, currentTerminalId, visible]);

  const loadPosSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('pos_settings')
        .select('drawer_manager_pin_required, drawer_open_reasons, max_drawer_variance, require_manager_pin_for_variance')
        .eq('business_id', businessId)
        .maybeSingle();

      if (error && error.code && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setPosSettings({
          drawer_manager_pin_required: data.drawer_manager_pin_required || false,
          drawer_open_reasons: data.drawer_open_reasons || ['No Sale', 'Change Request', 'Till Check', 'Manager Request', 'Refund', 'Other'],
          max_drawer_variance: data.max_drawer_variance || 5.00,
          require_manager_pin_for_variance: data.require_manager_pin_for_variance || true
        });
      }
    } catch (err) {
      console.error('Error loading POS settings:', err);
    }
  };

  const loadDrawerHistory = async () => {
    try {
      const terminalId = currentTerminalId || generateTerminalId();
      
      const { data, error } = await supabase
        .from('pos_drawers')
        .select('*')
        .eq('business_id', businessId)
        .eq('terminal_id', terminalId)
        .order('opened_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setDrawerHistory(data || []);
    } catch (err) {
      console.error('Error loading drawer history:', err);
      setDrawerHistory([]);
    }
  };

  const checkCurrentDrawerSession = async () => {
    try {
      const terminalId = currentTerminalId || generateTerminalId();
      
      // Check for open drawer session
      const { data, error } = await supabase
        .from('pos_drawers')
        .select('*')
        .eq('business_id', businessId)
        .eq('terminal_id', terminalId)
        .is('closed_at', null)
        .maybeSingle();

      if (error && error.code && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setCurrentDrawerSession(data);
        setDrawerMode('close');
        await loadExpectedCashForSession(data.id);
      } else {
        setCurrentDrawerSession(null);
        setDrawerMode('open');
      }
    } catch (err) {
      // No open drawer session found - this is normal
      setCurrentDrawerSession(null);
      setDrawerMode('open');
    }
  };

  const loadExpectedCashForSession = async (drawerId) => {
    try {
      // Get all cash transactions since drawer was opened
      const drawerSession = currentDrawerSession;
      if (!drawerSession) return;

      const { data: cashTransactions, error } = await supabase
        .from('pos_payments')
        .select('amount')
        .eq('business_id', businessId)
        .eq('payment_method', 'cash')
        .gte('created_at', drawerSession.opened_at)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Calculate expected cash = starting float + cash sales
      const startingFloat = drawerSession.starting_amount || 0;
      const cashSales = cashTransactions?.reduce((sum, payment) => sum + Number(payment.amount), 0) || 0;
      
      setExpectedCash(startingFloat + cashSales);
      
    } catch (err) {
      console.error('Error calculating expected cash:', err);
      setExpectedCash(0);
    }
  };

  const generateTerminalId = () => {
    const storedTerminalId = localStorage.getItem('tavari_terminal_id');
    if (storedTerminalId) {
      return storedTerminalId;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Terminal fingerprint', 2, 2);
    
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      canvas.toDataURL()
    ].join('|');
    
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    const terminalId = `TERM_${Math.abs(hash).toString(36).toUpperCase().substring(0, 8)}`;
    localStorage.setItem('tavari_terminal_id', terminalId);
    return terminalId;
  };

  const validateManagerPin = async () => {
    if (!managerPin || managerPin.length !== 4) {
      setManagerPinError('PIN must be 4 digits');
      return false;
    }

    try {
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

  const handleOpenDrawer = async () => {
    const reason = selectedReason === 'Other' ? customReason : selectedReason;
    
    if (!reason || !reason.trim()) {
      showToast('Please select a reason for opening the drawer', 'error');
      return;
    }

    // Validate manager PIN if required
    let managerInfo = null;
    if (posSettings.drawer_manager_pin_required) {
      const validationResult = await validateManagerPin();
      if (!validationResult.success) {
        return;
      }
      managerInfo = validationResult.manager;
    }

    setLoading(true);
    try {
      const terminalId = currentTerminalId || generateTerminalId();
      const now = new Date().toISOString();

      // Create drawer session record
      const { data: drawerSession, error: drawerError } = await supabase
        .from('pos_drawers')
        .insert({
          business_id: businessId,
          terminal_id: terminalId,
          opened_at: now,
          opened_by: auth.authUser.id,
          starting_amount: 200.00, // Default float - could be configurable
          open_reason: reason.trim(),
          open_notes: openNotes.trim() || null,
          manager_approval_required: posSettings.drawer_manager_pin_required,
          manager_approved_by: managerInfo?.id || null
        })
        .select()
        .single();

      if (drawerError) throw drawerError;

      // Log drawer opening
      await logPOS('cash_drawer_opened', {
        drawer_id: drawerSession.id,
        terminal_id: terminalId,
        reason: reason.trim(),
        notes: openNotes.trim() || null,
        opened_by: auth.authUser.id,
        opened_by_name: auth.authUser.email,
        opened_at: now,
        starting_amount: 200.00,
        manager_approval_required: posSettings.drawer_manager_pin_required,
        manager_approved_by: managerInfo?.id || null,
        manager_approved_by_name: managerInfo?.full_name || managerInfo?.email || null
      });

      // Update state and close modal
      setCurrentDrawerSession(drawerSession);
      setDrawerMode('close');
      resetOpenForm();

      if (onDrawerOpened) {
        onDrawerOpened({
          id: drawerSession.id,
          reason: reason.trim(),
          opened_by: auth.authUser.id,
          opened_at: now,
          starting_amount: 200.00
        });
      }

      showToast('Drawer opened successfully', 'success');
      loadDrawerHistory();

    } catch (err) {
      console.error('Error opening drawer:', err);
      showToast('Error opening drawer: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseDrawer = async () => {
    if (!currentDrawerSession) {
      showToast('No open drawer session found', 'error');
      return;
    }

    const countedCash = calculateCashTotal();
    const variance = countedCash - expectedCash;
    const varianceAmount = Math.abs(variance);

    // Check if manager PIN required for variance
    if (posSettings.require_manager_pin_for_variance && varianceAmount > posSettings.max_drawer_variance) {
      setPendingDrawerAction({
        type: 'close',
        countedCash,
        variance,
        expectedCash,
        notes: closeNotes.trim()
      });
      setShowManagerPinModal(true);
      return;
    }

    await performDrawerClose();
  };

  const performDrawerClose = async (managerApproval = null) => {
    setLoading(true);
    try {
      const countedCash = calculateCashTotal();
      const variance = countedCash - expectedCash;
      const now = new Date().toISOString();

      // Update drawer session record
      const { error: updateError } = await supabase
        .from('pos_drawers')
        .update({
          closed_at: now,
          closed_by: auth.authUser.id,
          ending_amount: countedCash,
          expected_amount: expectedCash,
          variance: variance,
          cash_breakdown: cashCounts,
          close_notes: closeNotes.trim() || null,
          manager_override_required: !!managerApproval,
          manager_override_by: managerApproval?.manager?.id || null,
          requires_recount: requireRecount
        })
        .eq('id', currentDrawerSession.id);

      if (updateError) throw updateError;

      // Log drawer closing
      await logPOS('cash_drawer_closed', {
        drawer_id: currentDrawerSession.id,
        terminal_id: currentTerminalId,
        closed_by: auth.authUser.id,
        closed_by_name: auth.authUser.email,
        closed_at: now,
        expected_amount: expectedCash,
        counted_amount: countedCash,
        variance: variance,
        variance_percentage: expectedCash > 0 ? (variance / expectedCash) * 100 : 0,
        cash_breakdown: cashCounts,
        manager_override_required: !!managerApproval,
        manager_approved_by: managerApproval?.manager?.id || null,
        requires_recount: requireRecount
      });

      // Reset state and close modal
      setCurrentDrawerSession(null);
      setDrawerMode('open');
      resetCloseForm();
      resetManagerPinModal();
      onClose();

      if (onDrawerClosed) {
        onDrawerClosed({
          id: currentDrawerSession.id,
          expected_amount: expectedCash,
          actual_amount: countedCash,
          variance: variance,
          closed_by: auth.authUser.id,
          closed_at: now
        });
      }

      showToast('Drawer closed successfully', 'success');
      loadDrawerHistory();

    } catch (err) {
      console.error('Error closing drawer:', err);
      showToast('Error closing drawer: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleManagerPinApproval = async () => {
    const validation = await validateManagerPin();
    if (validation.success) {
      if (pendingDrawerAction?.type === 'close') {
        await performDrawerClose(validation);
      }
    }
  };

  // Cash calculation helper
  const calculateCashTotal = () => {
    let total = 0;
    
    // Regular denominations
    Object.entries(cashCounts).forEach(([denomination, count]) => {
      if (denomination.includes('_roll')) return;
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
  };

  const handleCashCountChange = (denomination, value) => {
    setCashCounts(prev => ({
      ...prev,
      [denomination]: Math.max(0, Number(value) || 0)
    }));
  };

  const resetOpenForm = () => {
    setSelectedReason('');
    setCustomReason('');
    setOpenNotes('');
    setManagerPin('');
    setManagerPinError('');
  };

  const resetCloseForm = () => {
    setCashCounts({
      '0.05': 0, '0.10': 0, '0.25': 0, '1.00': 0, '2.00': 0,
      '5.00': 0, '10.00': 0, '20.00': 0, '50.00': 0, '100.00': 0,
      'nickel_roll': 0, 'dime_roll': 0, 'quarter_roll': 0, 'loonie_roll': 0, 'toonie_roll': 0
    });
    setCloseNotes('');
    setRequireRecount(false);
  };

  const resetManagerPinModal = () => {
    setShowManagerPinModal(false);
    setManagerPin('');
    setManagerPinError('');
    setPendingDrawerAction(null);
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

  const formatCurrency = (amount) => {
    return `$${Number(amount || 0).toFixed(2)}`;
  };

  // Define denomination display data for closing
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

  if (!visible) return null;

  return (
    <>
      <div style={styles.modal}>
        <div style={styles.modalContent}>
          <div style={styles.modalHeader}>
            <h3>{drawerMode === 'open' ? 'Open Cash Drawer' : 'Close Cash Drawer'}</h3>
            <button 
              onClick={() => {
                onClose();
                resetOpenForm();
                resetCloseForm();
              }}
              style={styles.closeButton}
            >
              ×
            </button>
          </div>
          
          <div style={styles.modalBody}>
            {drawerMode === 'open' ? (
              /* DRAWER OPENING INTERFACE */
              <>
                <div style={styles.formSection}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Reason for opening drawer: *</label>
                    <select
                      value={selectedReason}
                      onChange={(e) => {
                        setSelectedReason(e.target.value);
                        if (e.target.value !== 'Other') {
                          setCustomReason('');
                        }
                      }}
                      style={styles.select}
                    >
                      <option value="">Select a reason...</option>
                      {posSettings.drawer_open_reasons.map((reason, index) => (
                        <option key={index} value={reason}>{reason}</option>
                      ))}
                    </select>
                  </div>
                  
                  {selectedReason === 'Other' && (
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Custom reason: *</label>
                      <input
                        type="text"
                        value={customReason}
                        onChange={(e) => setCustomReason(e.target.value)}
                        placeholder="Enter custom reason..."
                        style={styles.input}
                        maxLength={100}
                      />
                    </div>
                  )}
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Additional notes (optional):</label>
                    <textarea
                      value={openNotes}
                      onChange={(e) => setOpenNotes(e.target.value)}
                      placeholder="Any additional details..."
                      style={styles.textarea}
                      rows={3}
                      maxLength={500}
                    />
                  </div>

                  {posSettings.drawer_manager_pin_required && (
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Manager PIN: *</label>
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
                          ...styles.input,
                          textAlign: 'center',
                          letterSpacing: '4px',
                          fontSize: '18px',
                          fontFamily: 'monospace'
                        }}
                      />
                      
                      {managerPinError && (
                        <p style={styles.errorText}>{managerPinError}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Recent drawer history */}
                <div style={styles.historySection}>
                  <h4>Recent Drawer Activity</h4>
                  {drawerHistory.length === 0 ? (
                    <p style={styles.noHistory}>No recent drawer activity</p>
                  ) : (
                    <div style={styles.historyList}>
                      {drawerHistory.slice(0, 3).map((entry) => (
                        <div key={entry.id} style={styles.historyItem}>
                          <div style={styles.historyHeader}>
                            <span style={styles.historyDate}>
                              {new Date(entry.opened_at).toLocaleDateString()}
                            </span>
                            <span style={styles.historyTime}>
                              {new Date(entry.opened_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <div style={styles.historyDetails}>
                            <div style={styles.historyRow}>
                              <span><strong>Reason:</strong> {entry.open_reason || 'Unknown'}</span>
                            </div>
                            {entry.variance && (
                              <div style={styles.historyRow}>
                                <span><strong>Last Variance:</strong> {formatCurrency(entry.variance)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* DRAWER CLOSING INTERFACE */
              <>
                <div style={styles.closeHeader}>
                  <h4>Current Drawer Session</h4>
                  <p>Opened: {currentDrawerSession ? new Date(currentDrawerSession.opened_at).toLocaleString() : 'Unknown'}</p>
                  <p>Starting Amount: {formatCurrency(currentDrawerSession?.starting_amount || 0)}</p>
                </div>

                {/* Expected vs Counted Summary */}
                <div style={styles.summarySection}>
                  <div style={styles.summaryRow}>
                    <span>Expected Cash Total:</span>
                    <span style={styles.expectedAmount}>{formatCurrency(expectedCash)}</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span>Counted Cash Total:</span>
                    <span style={styles.countedAmount}>{formatCurrency(calculateCashTotal())}</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span>Variance:</span>
                    <span style={{
                      ...styles.varianceAmount,
                      color: calculateCashTotal() - expectedCash === 0 ? TavariStyles.colors.success :
                             calculateCashTotal() - expectedCash > 0 ? TavariStyles.colors.primary :
                             TavariStyles.colors.danger
                    }}>
                      {formatCurrency(calculateCashTotal() - expectedCash)}
                    </span>
                  </div>
                </div>

                {/* Cash Counting Interface */}
                <div style={styles.cashCountSection}>
                  <h4>Count Cash in Drawer</h4>
                  
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
                  <h5 style={styles.subSectionTitle}>Coin Rolls</h5>
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
                </div>

                {/* Variance Warning */}
                {Math.abs(calculateCashTotal() - expectedCash) > posSettings.max_drawer_variance && (
                  <div style={styles.varianceWarning}>
                    <strong>⚠️ Large Variance Detected</strong>
                    <p>
                      Variance of {formatCurrency(Math.abs(calculateCashTotal() - expectedCash))} exceeds 
                      maximum allowed variance of {formatCurrency(posSettings.max_drawer_variance)}.
                      {posSettings.require_manager_pin_for_variance && ' Manager approval will be required.'}
                    </p>
                    
                    <label style={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={requireRecount}
                        onChange={(e) => setRequireRecount(e.target.checked)}
                        style={styles.checkbox}
                      />
                      Require recount before closing
                    </label>
                  </div>
                )}

                {/* Closing Notes */}
                <div style={styles.formGroup}>
                  <label style={styles.label}>Closing notes (optional):</label>
                  <textarea
                    value={closeNotes}
                    onChange={(e) => setCloseNotes(e.target.value)}
                    placeholder="Any notes about this drawer close..."
                    style={styles.textarea}
                    rows={3}
                    maxLength={500}
                  />
                </div>
              </>
            )}
          </div>
          
          <div style={styles.modalFooter}>
            <button
              onClick={() => {
                onClose();
                resetOpenForm();
                resetCloseForm();
              }}
              style={styles.cancelButton}
              disabled={loading}
            >
              Cancel
            </button>
            
            {drawerMode === 'open' ? (
              <button
                onClick={handleOpenDrawer}
                style={styles.primaryButton}
                disabled={loading || !selectedReason || (selectedReason === 'Other' && !customReason.trim()) || (posSettings.drawer_manager_pin_required && managerPin.length !== 4)}
              >
                {loading ? 'Opening...' : 'Open Drawer'}
              </button>
            ) : (
              <button
                onClick={handleCloseDrawer}
                style={styles.primaryButton}
                disabled={loading || (requireRecount && Math.abs(calculateCashTotal() - expectedCash) > posSettings.max_drawer_variance)}
              >
                {loading ? 'Closing...' : 'Close Drawer'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Manager PIN Modal for Variance Approval */}
      {showManagerPinModal && (
        <div style={TavariStyles.components.modal.overlay}>
          <div style={TavariStyles.components.modal.content}>
            <div style={TavariStyles.components.modal.header}>
              <h3>Manager Approval Required</h3>
              <button
                onClick={resetManagerPinModal}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>
            
            <div style={TavariStyles.components.modal.body}>
              <p>
                Drawer variance of {formatCurrency(Math.abs(pendingDrawerAction?.variance || 0))} exceeds 
                the maximum allowed variance of {formatCurrency(posSettings.max_drawer_variance)}. 
                Manager approval is required to close the drawer.
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
                onClick={resetManagerPinModal}
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
                Approve Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Comprehensive styles for both open and close interfaces
const styles = {
  modal: {
    ...TavariStyles.components.modal.overlay
  },
  
  modalContent: {
    ...TavariStyles.components.modal.content,
    maxWidth: '800px',
    width: '95%',
    maxHeight: '90vh'
  },
  
  modalHeader: {
    ...TavariStyles.components.modal.header
  },
  
  modalBody: {
    ...TavariStyles.components.modal.body,
    maxHeight: '70vh',
    overflow: 'auto'
  },
  
  modalFooter: {
    ...TavariStyles.components.modal.footer
  },
  
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600
  },
  
  formSection: {
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.lg,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },
  
  formGroup: {
    marginBottom: TavariStyles.spacing.lg
  },
  
  label: {
    ...TavariStyles.components.form.label
  },
  
  input: {
    ...TavariStyles.components.form.input,
    width: '100%'
  },
  
  select: {
    ...TavariStyles.components.form.select,
    width: '100%'
  },
  
  textarea: {
    ...TavariStyles.components.form.input,
    width: '100%',
    resize: 'vertical',
    fontFamily: TavariStyles.typography.fontFamily
  },
  
  checkbox: {
    marginRight: TavariStyles.spacing.sm
  },
  
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700
  },
  
  errorText: {
    color: TavariStyles.colors.danger,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginTop: TavariStyles.spacing.xs
  },
  
  historySection: {
    marginTop: TavariStyles.spacing.lg
  },
  
  noHistory: {
    textAlign: 'center',
    color: TavariStyles.colors.gray500,
    fontSize: TavariStyles.typography.fontSize.sm,
    padding: TavariStyles.spacing.md
  },
  
  historyList: {
    maxHeight: '150px',
    overflow: 'auto'
  },
  
  historyItem: {
    padding: TavariStyles.spacing.sm,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: TavariStyles.spacing.xs
  },
  
  historyDate: {
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  
  historyTime: {
    color: TavariStyles.colors.gray600
  },
  
  historyDetails: {
    fontSize: TavariStyles.typography.fontSize.xs
  },
  
  historyRow: {
    marginBottom: TavariStyles.spacing.xs
  },
  
  closeHeader: {
    backgroundColor: TavariStyles.colors.gray50,
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: TavariStyles.spacing.lg,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  
  summarySection: {
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    padding: TavariStyles.spacing.lg,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: TavariStyles.spacing.lg
  },
  
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  
  expectedAmount: {
    color: TavariStyles.colors.white
  },
  
  countedAmount: {
    color: TavariStyles.colors.white
  },
  
  varianceAmount: {
    fontWeight: TavariStyles.typography.fontWeight.bold
  },
  
  cashCountSection: {
    marginBottom: TavariStyles.spacing.lg
  },
  
  subSectionTitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray700,
    marginTop: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.md
  },
  
  denominationGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: TavariStyles.spacing.md,
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.lg
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
    width: '80px',
    textAlign: 'center'
  },
  
  totalCell: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    textAlign: 'right',
    minWidth: '80px'
  },
  
  varianceWarning: {
    backgroundColor: TavariStyles.colors.warningBg,
    color: TavariStyles.colors.warningText,
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.warning}`,
    marginBottom: TavariStyles.spacing.lg
  },
  
  cancelButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary
  },
  
  primaryButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary
  }
};

export default POSDrawerComponent;
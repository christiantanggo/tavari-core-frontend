// components/Dining/SeatPaymentModal.jsx
import React, { useState, useMemo } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { X, Check } from 'lucide-react';

const SeatPaymentModal = ({
  visible,
  onClose,
  onConfirm,
  cartItems = [],
  guestCount = 0,
  subtotal = 0,
  tax = 0,
  total = 0
}) => {
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [tableSplitWays, setTableSplitWays] = useState(1);

  // Calculate totals per seat
  const seatTotals = useMemo(() => {
    const totals = {
      'All': { items: [], subtotal: 0, tax: 0, total: 0 }
    };

    // Initialize seat totals
    for (let i = 1; i <= guestCount; i++) {
      totals[i] = { items: [], subtotal: 0, tax: 0, total: 0 };
    }

    // Group items by seat
    // Only count unpaid amounts for payment calculation
    cartItems.forEach(item => {
      const seat = item.seat || 'All';
      if (totals[seat]) {
        totals[seat].items.push(item);
        // Use remaining_balance if item is partially paid, otherwise use full price
        const itemSubtotal = item.is_partially_paid 
          ? (item.remaining_balance || 0)
          : ((item.price || 0) * (item.quantity || 1));
        totals[seat].subtotal += itemSubtotal;
      }
    });

    // Calculate tax proportionally for each seat
    const totalSubtotal = Object.values(totals).reduce((sum, seat) => sum + seat.subtotal, 0);
    
    Object.keys(totals).forEach(seat => {
      if (totals[seat].subtotal > 0 && totalSubtotal > 0) {
        const taxProportion = totals[seat].subtotal / totalSubtotal;
        totals[seat].tax = tax * taxProportion;
        totals[seat].total = totals[seat].subtotal + totals[seat].tax;
      }
    });

    return totals;
  }, [cartItems, guestCount, tax]);

  // Calculate payment totals for selected seats
  const paymentTotals = useMemo(() => {
    if (selectedSeats.length === 0) {
      return { subtotal: 0, tax: 0, total: 0, tableShare: 0 };
    }

    let selectedSubtotal = 0;
    let selectedTax = 0;
    let tableShare = 0;

    selectedSeats.forEach(seat => {
      if (seatTotals[seat]) {
        selectedSubtotal += seatTotals[seat].subtotal;
        selectedTax += seatTotals[seat].tax;
      }
    });

    // Calculate equal share of "All" items based on MANUAL split selection
    // This is independent of how many seats are selected
    if (seatTotals['All'] && seatTotals['All'].subtotal > 0 && tableSplitWays > 0) {
      tableShare = seatTotals['All'].subtotal / tableSplitWays;
      const tableTaxShare = seatTotals['All'].tax / tableSplitWays;
      selectedSubtotal += tableShare;
      selectedTax += tableTaxShare;
    }

    return {
      subtotal: selectedSubtotal,
      tax: selectedTax,
      total: selectedSubtotal + selectedTax,
      tableShare: tableShare
    };
  }, [selectedSeats, seatTotals, tableSplitWays]);

  const handleSeatToggle = (seat) => {
    setSelectedSeats(prev => {
      if (prev.includes(seat)) {
        return prev.filter(s => s !== seat);
      } else {
        return [...prev, seat];
      }
    });
  };

  const handleConfirm = () => {
    if (selectedSeats.length === 0) {
      alert('Please select at least one seat to pay');
      return;
    }

    // Build items for payment: selected seat items + equal share of "All" items
    const paymentItems = [];
    
    selectedSeats.forEach(seat => {
      // Add seat-specific items (only unpaid items)
      if (seatTotals[seat] && seatTotals[seat].items.length > 0) {
        seatTotals[seat].items.forEach(item => {
          // Only include items that aren't fully paid
          if (!item.is_paid) {
            paymentItems.push({
              ...item,
              // Calculate how much of this item is still unpaid
              unpaid_amount: item.remaining_balance || ((item.price || 0) * (item.quantity || 1))
            });
          }
        });
      }
    });

    // Add equal share of "All" items - create a summary line item for the share
    // Use the MANUAL split count, not the number of selected seats
    if (seatTotals['All'] && seatTotals['All'].items.length > 0 && tableSplitWays > 0) {
      const tableSharePerSeat = seatTotals['All'].subtotal / tableSplitWays;
      const tableTaxSharePerSeat = seatTotals['All'].tax / tableSplitWays;
      
      // Create a single line item representing the table share
      // Store the original table items so they can be displayed on the receipt
      paymentItems.push({
        id: 'table-share',
        name: `Table Share (1/${tableSplitWays})`,
        price: tableSharePerSeat,
        quantity: 1,
        modifiers: [],
        category_id: null,
        item_tax_overrides: null,
        seat: 'All',
        isTableShare: true,
        tableShareAmount: tableSharePerSeat,
        tableShareTax: tableTaxSharePerSeat,
        splitWays: tableSplitWays,
        originalTableItems: seatTotals['All'].items // Store original items for receipt display
      });
    }

    onConfirm({
      selectedSeats,
      items: paymentItems,
      subtotal: paymentTotals.subtotal,
      tax: paymentTotals.tax,
      total: paymentTotals.total,
      tableShare: paymentTotals.tableShare
    });
  };

  if (!visible) return null;

  const styles = {
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    },
    modalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      maxWidth: '600px',
      width: '90%',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: TavariStyles.shadows.xl
    },
    modalHeader: {
      padding: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    modalTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    modalBody: {
      padding: TavariStyles.spacing.lg
    },
    instruction: {
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    seatList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    seatCard: {
      border: `2px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      backgroundColor: TavariStyles.colors.white
    },
    seatCardSelected: {
      borderColor: TavariStyles.colors.primary,
      backgroundColor: TavariStyles.colors.primary + '10'
    },
    seatHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xs
    },
    seatName: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    seatTotal: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    seatItems: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    tableCard: {
      border: `2px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50
    },
    tableLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    tableNote: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.xs
    },
    paymentSummary: {
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    summaryRow: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: TavariStyles.spacing.xs
    },
    summaryLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    summaryValue: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    totalRow: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: TavariStyles.spacing.sm,
      paddingTop: TavariStyles.spacing.sm,
      borderTop: `2px solid ${TavariStyles.colors.gray300}`
    },
    totalLabel: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    totalValue: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    modalFooter: {
      padding: TavariStyles.spacing.lg,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'flex-end'
    },
    button: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
      borderRadius: TavariStyles.borderRadius.md,
      border: 'none',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      transition: 'all 0.2s ease'
    },
    cancelButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700
    },
    confirmButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary
    },
    checkIcon: {
      marginLeft: TavariStyles.spacing.xs
    },
    splitInputContainer: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    splitLabel: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    splitInput: {
      ...TavariStyles.components.form.input,
      width: '100px',
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.xs
    },
    splitNote: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    }
  };

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Select Seats for Payment</h2>
          <button style={styles.closeButton} onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.modalBody}>
          <p style={styles.instruction}>
            Select which seat(s) will be paying. You can manually set how many ways the table items are split.
          </p>

          {/* Table Items (All) */}
          {seatTotals['All'] && seatTotals['All'].items.length > 0 && (
            <div style={styles.tableCard}>
              <div style={styles.tableLabel}>Table Items (Shared)</div>
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>
                  {seatTotals['All'].items.length} item(s)
                </span>
                <span style={styles.summaryValue}>
                  ${seatTotals['All'].subtotal.toFixed(2)}
                </span>
              </div>
              <div style={styles.splitInputContainer}>
                <label style={styles.splitLabel}>
                  Split table items how many ways?
                </label>
                <input
                  type="number"
                  min="1"
                  max={guestCount || 10}
                  value={tableSplitWays}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1;
                    setTableSplitWays(Math.max(1, Math.min(value, guestCount || 10)));
                  }}
                  style={styles.splitInput}
                />
                <div style={styles.splitNote}>
                  Each paying seat will pay ${tableSplitWays > 0 ? (seatTotals['All'].subtotal / tableSplitWays).toFixed(2) : '0.00'} of table items
                </div>
              </div>
            </div>
          )}

          {/* Seat Cards */}
          <div style={styles.seatList}>
            {Array.from({ length: guestCount }, (_, i) => i + 1).map(seatNum => {
              const seat = seatTotals[seatNum] || { items: [], subtotal: 0, tax: 0, total: 0 };
              const isSelected = selectedSeats.includes(seatNum);
              const hasItems = seat.items.length > 0;

              return (
                <div
                  key={seatNum}
                  style={{
                    ...styles.seatCard,
                    ...(isSelected ? styles.seatCardSelected : {}),
                    ...(!hasItems ? { opacity: 0.7 } : {})
                  }}
                  onClick={() => handleSeatToggle(seatNum)}
                >
                  <div style={styles.seatHeader}>
                    <span style={styles.seatName}>
                      Seat {seatNum}
                      {isSelected && <Check size={16} style={styles.checkIcon} />}
                    </span>
                    <span style={styles.seatTotal}>
                      ${seat.total.toFixed(2)}
                    </span>
                  </div>
                  {hasItems ? (
                    <div style={styles.seatItems}>
                      {seat.items.length} item(s) • Subtotal: ${seat.subtotal.toFixed(2)}
                    </div>
                  ) : (
                    <div style={styles.seatItems}>
                      No items
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Payment Summary */}
          {selectedSeats.length > 0 && (
            <div style={styles.paymentSummary}>
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Selected Seats:</span>
                <span style={styles.summaryValue}>
                  {selectedSeats.map(s => `Seat ${s}`).join(', ')}
                </span>
              </div>
              {paymentTotals.tableShare > 0 && (
                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Table Share (1/{tableSplitWays}):</span>
                  <span style={styles.summaryValue}>
                    ${paymentTotals.tableShare.toFixed(2)}
                  </span>
                </div>
              )}
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Subtotal:</span>
                <span style={styles.summaryValue}>
                  ${paymentTotals.subtotal.toFixed(2)}
                </span>
              </div>
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Tax:</span>
                <span style={styles.summaryValue}>
                  ${paymentTotals.tax.toFixed(2)}
                </span>
              </div>
              <div style={styles.totalRow}>
                <span style={styles.totalLabel}>Total to Pay:</span>
                <span style={styles.totalValue}>
                  ${paymentTotals.total.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={styles.modalFooter}>
          <button
            style={styles.cancelButton}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            style={{
              ...styles.confirmButton,
              opacity: selectedSeats.length === 0 ? 0.5 : 1,
              cursor: selectedSeats.length === 0 ? 'not-allowed' : 'pointer'
            }}
            onClick={handleConfirm}
            disabled={selectedSeats.length === 0}
          >
            Process Payment
          </button>
        </div>
      </div>
    </div>
  );
};

export default SeatPaymentModal;


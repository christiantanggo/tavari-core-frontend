// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\components\POS\SeatSelector.jsx
// Enhanced version with item counts per seat
import React, { useMemo } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiUsers } from 'react-icons/fi';

const SeatSelector = ({ 
  guestCount, 
  selectedSeat, 
  onSeatSelect,
  cartItems = [] // Pass cart items to show counts
}) => {
  if (!guestCount) return null;

  // Calculate item counts per seat
  const seatCounts = useMemo(() => {
    const counts = {
      'All': 0
    };

    // Initialize counts for each seat
    for (let i = 1; i <= guestCount; i++) {
      counts[i] = 0;
    }

    // Count items per seat
    cartItems.forEach(item => {
      const seat = item.seat || item.seat_number || 'All'; // Support both property names for compatibility
      if (!seat || seat === 'All') {
        counts['All'] += item.quantity || 1;
      } else {
        const seatNum = parseInt(seat);
        if (counts[seatNum] !== undefined) {
          counts[seatNum] += item.quantity || 1;
        }
      }
    });

    return counts;
  }, [cartItems, guestCount]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiUsers size={14} />
        <span style={styles.headerText}>Assign to Seat:</span>
      </div>
      
      <div style={styles.seatGrid}>
        {/* Table Button (All) */}
        <button
          style={{
            ...styles.seatButton,
            ...(selectedSeat === 'All' ? styles.seatButtonActive : {})
          }}
          onClick={() => onSeatSelect('All')}
        >
          <div style={styles.seatButtonContent}>
            <span style={styles.seatLabel}>Table</span>
            {seatCounts['All'] > 0 && (
              <span style={styles.itemBadge}>{seatCounts['All']}</span>
            )}
          </div>
          <span style={styles.seatSubtext}>Shared</span>
        </button>

        {/* Individual Seat Buttons */}
        {Array.from({ length: guestCount }, (_, i) => i + 1).map(seatNum => (
          <button
            key={seatNum}
            style={{
              ...styles.seatButton,
              ...(selectedSeat === seatNum ? styles.seatButtonActive : {})
            }}
            onClick={() => onSeatSelect(seatNum)}
          >
            <div style={styles.seatButtonContent}>
              <span style={styles.seatLabel}>Seat {seatNum}</span>
              {seatCounts[seatNum] > 0 && (
                <span style={styles.itemBadge}>{seatCounts[seatNum]}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const styles = {
  container: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    marginBottom: TavariStyles.spacing.sm
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    marginBottom: TavariStyles.spacing.sm,
    color: TavariStyles.colors.gray700,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },

  headerText: {
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },

  seatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
    gap: TavariStyles.spacing.xs,
    marginBottom: TavariStyles.spacing.sm
  },

  seatButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.white,
    border: `2px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minHeight: '56px',
    position: 'relative',
    fontFamily: TavariStyles.typography.fontFamily
  },

  seatButtonActive: {
    backgroundColor: TavariStyles.colors.primary,
    borderColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    transform: 'scale(1.05)',
    boxShadow: TavariStyles.shadows.md
  },

  seatButtonContent: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs
  },

  seatLabel: {
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },

  seatSubtext: {
    fontSize: '10px',
    color: TavariStyles.colors.gray500,
    marginTop: '2px'
  },

  itemBadge: {
    backgroundColor: TavariStyles.colors.error,
    color: TavariStyles.colors.white,
    fontSize: '10px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    padding: '2px 6px',
    borderRadius: TavariStyles.borderRadius.full,
    minWidth: '18px',
    textAlign: 'center'
  }
};

export default SeatSelector;
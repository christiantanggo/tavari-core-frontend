// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\components\POS\CartItemsBySeat.jsx
import React, { useState } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import POSCartItem from './POSCartItem';
import { FiUsers, FiChevronDown, FiChevronRight } from 'react-icons/fi';

const CartItemsBySeat = ({ 
  cartItems, 
  guestCount, 
  onUpdateQuantity, 
  onRemoveItem, 
  sessionLocked 
}) => {
  // State for collapsible sections
  const [expandedSections, setExpandedSections] = useState(() => {
    const initial = { table: true };
    for (let i = 1; i <= (guestCount || 0); i++) {
      initial[`seat_${i}`] = true;
    }
    return initial;
  });

  const toggleSection = (sectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  // Group items by seat
  const groupedItems = React.useMemo(() => {
    if (!guestCount) {
      return { all: cartItems };
    }

    const groups = { table: [] };

    // Create groups for each seat
    for (let i = 1; i <= guestCount; i++) {
      groups[`seat_${i}`] = [];
    }

    // Sort items into groups
    if (!cartItems || !Array.isArray(cartItems)) {
      return groups;
    }

    cartItems.forEach((item) => {
      const seatNum = item.seat || item.seat_number; // Support both property names for compatibility
      
      if (!seatNum || seatNum === 'All' || seatNum === 'all') {
        groups.table.push(item);
      } else {
        const seatKey = `seat_${seatNum}`;
        if (groups[seatKey]) {
          groups[seatKey].push(item);
        } else {
          groups.table.push(item);
        }
      }
    });

    return groups;
  }, [cartItems, guestCount]);

  const getSectionTotal = (items) => {
    return items.reduce((sum, item) => {
      const itemTotal = (item.final_price || item.price || 0) * (item.quantity || 1);
      return sum + itemTotal;
    }, 0);
  };

  // NOT IN DINING MODE
  if (!guestCount) {
    if (!cartItems || cartItems.length === 0) {
      return (
        <div style={styles.emptyState}>
          <FiUsers size={32} color={TavariStyles.colors.gray400} />
          <p>Cart is empty</p>
        </div>
      );
    }
    
    return (
      <div style={styles.normalCartList}>
        {cartItems.map((item, index) => (
          <POSCartItem
            key={`${item.id}-${index}`}
            item={item}
            onUpdateQuantity={onUpdateQuantity}
            onRemove={onRemoveItem}
            sessionLocked={sessionLocked}
          />
        ))}
      </div>
    );
  }

  // IN DINING MODE - Build sections array: Table first, then seats
  const sections = [
    { key: 'table', label: 'Table', items: groupedItems.table || [] }
  ];

  // Add seat sections
  for (let i = 1; i <= guestCount; i++) {
    const seatKey = `seat_${i}`;
    sections.push({
      key: seatKey,
      label: `Seat ${i}`,
      items: groupedItems[seatKey] || []
    });
  }

  const hasAnyItems = sections.some(section => section.items.length > 0);

  if (!hasAnyItems) {
    return (
      <div style={styles.emptyState}>
        <FiUsers size={32} color={TavariStyles.colors.gray400} />
        <p>No items added yet</p>
      </div>
    );
  }

  return (
    <div style={styles.groupedContainer}>
      {sections.map(section => {
        const isExpanded = expandedSections[section.key];
        const hasItems = section.items.length > 0;

        return (
          <div key={section.key} style={styles.seatGroup}>
            {/* Header - Always visible, clickable */}
            <div 
              style={styles.seatHeader}
              onClick={() => toggleSection(section.key)}
            >
              <div style={styles.seatHeaderLeft}>
                <span style={styles.chevronIcon}>
                  {isExpanded ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                </span>
                <FiUsers size={16} />
                <span style={styles.seatLabel}>{section.label}</span>
              </div>
              {hasItems && (
                <div style={styles.seatHeaderRight}>
                  <span style={styles.itemCount}>
                    {section.items.length} item{section.items.length !== 1 ? 's' : ''}
                  </span>
                  <span style={styles.seatTotal}>${getSectionTotal(section.items).toFixed(2)}</span>
                </div>
              )}
            </div>
            
            {/* Items - Collapsible */}
            {isExpanded && hasItems && (
              <div style={styles.seatItems}>
                {section.items.map((item, index) => (
                  <POSCartItem
                    key={`${section.key}-${item.id}-${index}`}
                    item={item}
                    onUpdateQuantity={onUpdateQuantity}
                    onRemove={onRemoveItem}
                    sessionLocked={sessionLocked}
                  />
                ))}
              </div>
            )}

            {/* Empty state when expanded */}
            {isExpanded && !hasItems && (
              <div style={styles.emptySection}>
                <p>No items for {section.label.toLowerCase()}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const styles = {
  normalCartList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },
  
  groupedContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },

  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing['2xl'],
    color: TavariStyles.colors.gray400,
    textAlign: 'center',
    gap: TavariStyles.spacing.sm
  },
  
  seatGroup: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: `2px solid ${TavariStyles.colors.primary}`,
    overflow: 'hidden',
    marginBottom: TavariStyles.spacing.sm
  },
  
  seatHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.primary + '20',
    borderBottom: `2px solid ${TavariStyles.colors.primary}`,
    cursor: 'pointer',
    userSelect: 'none',
    minHeight: '56px'
  },

  seatHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    flex: 1
  },

  seatHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.md
  },

  chevronIcon: {
    display: 'flex',
    alignItems: 'center',
    color: TavariStyles.colors.primary,
    fontWeight: TavariStyles.typography.fontWeight.bold
  },
  
  seatLabel: {
    fontSize: TavariStyles.typography.fontSize.md,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray900
  },
  
  itemCount: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.white,
    backgroundColor: TavariStyles.colors.primary,
    padding: `6px ${TavariStyles.spacing.md}`,
    borderRadius: TavariStyles.borderRadius.full,
    fontWeight: TavariStyles.typography.fontWeight.bold
  },

  seatTotal: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.success,
    minWidth: '80px',
    textAlign: 'right'
  },
  
  seatItems: {
    padding: TavariStyles.spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.white
  },

  emptySection: {
    padding: TavariStyles.spacing.lg,
    textAlign: 'center',
    color: TavariStyles.colors.gray400,
    fontSize: TavariStyles.typography.fontSize.sm
  }
};

export default CartItemsBySeat;
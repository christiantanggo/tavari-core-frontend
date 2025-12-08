// components/POS/ModifierSelectionModal.jsx - FIXED TO ACTUALLY LOAD MODIFIERS
import React, { useState, useEffect } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { supabase } from '../../supabaseClient';

/**
 * Modal for selecting modifiers when adding products to cart
 * Loads modifier groups and their options from the database
 */
const ModifierSelectionModal = ({
  isOpen,
  onClose,
  product,
  businessId,
  onAddToCart
}) => {
  const [modifierGroups, setModifierGroups] = useState([]);
  const [selectedModifiers, setSelectedModifiers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load modifier groups when modal opens
  useEffect(() => {
    if (isOpen && product?.modifier_group_ids && businessId) {
      loadModifierGroups();
    }
  }, [isOpen, product, businessId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedModifiers([]);
      setModifierGroups([]);
      setError(null);
    }
  }, [isOpen]);

  const loadModifierGroups = async () => {
    setLoading(true);
    setError(null);

    try {
      // Handle both array and object formats for modifier_group_ids
      let groupIds = [];
      if (Array.isArray(product.modifier_group_ids)) {
        groupIds = product.modifier_group_ids;
      } else if (typeof product.modifier_group_ids === 'object' && product.modifier_group_ids !== null) {
        groupIds = Object.values(product.modifier_group_ids);
      }
      
      if (groupIds.length === 0) {
        setLoading(false);
        return;
      }

      // Load modifier groups
      const { data: groups, error: groupsError } = await supabase
        .from('pos_modifier_groups')
        .select('*')
        .in('id', groupIds)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (groupsError) {
        throw groupsError;
      }

      if (!groups || groups.length === 0) {
        setModifierGroups([]);
        setLoading(false);
        return;
      }

      // Load modifiers for each group
      const groupsWithModifiers = await Promise.all(
        groups.map(async (group) => {
          
          // First, get the modifier group items
          const { data: groupItems, error: groupItemsError } = await supabase
            .from('pos_modifier_group_items')
            .select('*')
            .eq('modifier_group_id', group.id)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

          if (groupItemsError) {
            console.error('Error loading group items for group', group.id, ':', groupItemsError);
            return {
              ...group,
              modifiers: []
            };
          }

          console.log(`Group items for ${group.name}:`, groupItems);

          if (!groupItems || groupItems.length === 0) {
            console.warn(`No modifier items found for group: ${group.name}`);
            return {
              ...group,
              modifiers: []
            };
          }

          // Get the inventory items for these modifiers
          const inventoryIds = groupItems.map(item => item.inventory_id);
          
          const { data: inventoryItems, error: inventoryError } = await supabase
            .from('pos_inventory')
            .select('id, name, price')
            .in('id', inventoryIds)
            .eq('business_id', businessId);

          if (inventoryError) {
            return {
              ...group,
              modifiers: []
            };
          }

          // Combine group items with inventory data
          const modifiers = groupItems.map(groupItem => {
            const inventoryItem = inventoryItems.find(inv => inv.id === groupItem.inventory_id);
            
            if (!inventoryItem) {
              return null;
            }

            return {
              id: inventoryItem.id,
              name: inventoryItem.name,
              price: groupItem.price_override !== null ? groupItem.price_override : inventoryItem.price,
              is_free: groupItem.is_free || false,
              is_default_selected: groupItem.is_default_selected || false,
              modifier_group_item_id: groupItem.id
            };
          }).filter(Boolean); // Remove any null entries

          return {
            ...group,
            modifiers
          };
        })
      );

      setModifierGroups(groupsWithModifiers);

      // Auto-select default modifiers
      const defaultModifiers = [];
      groupsWithModifiers.forEach(group => {
        group.modifiers.forEach(modifier => {
          if (modifier.is_default_selected) {
            defaultModifiers.push({
              ...modifier,
              group_id: group.id,
              group_name: group.name
            });
          }
        });
      });
      
      setSelectedModifiers(defaultModifiers);

    } catch (err) {
      setError('Failed to load modifier options. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleModifierToggle = (modifier, group) => {
    setSelectedModifiers(prev => {
      const existingIndex = prev.findIndex(m => m.id === modifier.id);
      
      if (existingIndex >= 0) {
        // Remove modifier
        const newSelection = prev.filter(m => m.id !== modifier.id);
        return newSelection;
      } else {
        // Add modifier
        const newModifier = {
          ...modifier,
          group_id: group.id,
          group_name: group.name
        };
        const newSelection = [...prev, newModifier];
        return newSelection;
      }
    });
  };

  const calculateModifierTotal = () => {
    const total = selectedModifiers.reduce((total, modifier) => {
      if (modifier.is_free) return total;
      return total + (Number(modifier.price) || 0);
    }, 0);
    return total;
  };

  const handleAddToCart = () => {
    if (loading) return;

    // Validate required groups have selections
    const requiredGroups = modifierGroups.filter(group => group.is_required);
    const missingRequired = requiredGroups.filter(group => {
      const groupSelections = selectedModifiers.filter(mod => mod.group_id === group.id);
      return groupSelections.length < (group.min_selections || 1);
    });

    if (missingRequired.length > 0) {
      setError(`Please make selections for: ${missingRequired.map(g => g.name).join(', ')}`);
      return;
    }

    // Create product with selected modifiers in the format expected by the cart
    const productWithModifiers = {
      ...product,
      modifiers: selectedModifiers.map(modifier => ({
        id: modifier.id,
        name: modifier.name,
        price: modifier.is_free ? 0 : (Number(modifier.price) || 0),
        group_id: modifier.group_id,
        group_name: modifier.group_name,
        modifier_group_item_id: modifier.modifier_group_item_id
      }))
    };
    
    onAddToCart(productWithModifiers);
  };

  const isModifierSelected = (modifierId) => {
    return selectedModifiers.some(m => m.id === modifierId);
  };

  const styles = {
    backdrop: {
      ...TavariStyles.components.modal.overlay,
      zIndex: 1500
    },
    
    modal: {
      ...TavariStyles.components.modal.content,
      width: '600px',
      maxWidth: '90vw',
      maxHeight: '80vh',
      padding: 0
    },
    
    header: {
      ...TavariStyles.components.modal.header,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    
    title: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    closeBtn: {
      backgroundColor: 'transparent',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      cursor: 'pointer',
      color: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xs,
      borderRadius: TavariStyles.borderRadius.sm,
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    
    content: {
      ...TavariStyles.components.modal.body,
      maxHeight: '400px',
      overflowY: 'auto'
    },
    
    loadingContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing['4xl'],
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    
    errorContainer: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      margin: TavariStyles.spacing.lg
    },
    
    noModifiersContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing['4xl'],
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray500,
      textAlign: 'center'
    },
    
    modifierGroup: {
      marginBottom: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.lg
    },
    
    groupHeader: {
      marginBottom: TavariStyles.spacing.lg
    },
    
    groupTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    
    groupDescription: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    
    requiredBadge: {
      display: 'inline-block',
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      padding: `2px ${TavariStyles.spacing.xs}`,
      borderRadius: TavariStyles.borderRadius.sm,
      marginLeft: TavariStyles.spacing.sm
    },
    
    modifiersList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    
    modifierItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      transition: TavariStyles.transitions.normal
    },
    
    modifierItemSelected: {
      borderColor: TavariStyles.colors.primary,
      backgroundColor: `${TavariStyles.colors.primary}10`
    },
    
    modifierDetails: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      flex: 1
    },
    
    modifierName: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray900
    },
    
    modifierPrice: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      minWidth: '60px',
      textAlign: 'right'
    },
    
    freeLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    summary: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      marginBottom: TavariStyles.spacing.xl
    },
    
    summaryRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.sm
    },
    
    summaryLabel: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray700
    },
    
    summaryValue: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    
    totalRow: {
      borderTop: `1px solid ${TavariStyles.colors.gray300}`,
      paddingTop: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.md,
      marginBottom: 0
    },
    
    totalValue: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    actions: {
      ...TavariStyles.components.modal.footer
    },
    
    cancelBtn: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.lg
    },
    
    addBtn: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg
    },
    
    addBtnDisabled: {
      backgroundColor: TavariStyles.colors.gray300,
      color: TavariStyles.colors.gray500,
      cursor: 'not-allowed'
    }
  };

  if (!isOpen) return null;

  const modifierTotal = calculateModifierTotal();
  const productTotal = Number(product?.price || 0) + modifierTotal;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>
            Customize: {product?.name || 'Item'}
          </h3>
          <button 
            style={styles.closeBtn} 
            onClick={onClose}
            disabled={loading}
          >
            ×
          </button>
        </div>

        {error && (
          <div style={styles.errorContainer}>
            {error}
          </div>
        )}

        <div style={styles.content}>
          {loading ? (
            <div style={styles.loadingContainer}>
              Loading modifier options...
            </div>
          ) : modifierGroups.length > 0 ? (
            <>
              {modifierGroups.map((group) => (
                <div key={group.id} style={styles.modifierGroup}>
                  <div style={styles.groupHeader}>
                    <div style={styles.groupTitle}>
                      {group.name}
                      {group.is_required && (
                        <span style={styles.requiredBadge}>REQUIRED</span>
                      )}
                    </div>
                    {(group.min_selections > 0 || group.max_selections > 0) && (
                      <div style={styles.groupDescription}>
                        {group.min_selections > 0 && group.max_selections > 0 
                          ? `Select ${group.min_selections}-${group.max_selections} options`
                          : group.min_selections > 0 
                            ? `Select at least ${group.min_selections} options`
                            : `Select up to ${group.max_selections} options`
                        }
                      </div>
                    )}
                  </div>
                  
                  <div style={styles.modifiersList}>
                    {group.modifiers?.map((modifier) => {
                      const isSelected = isModifierSelected(modifier.id);
                      return (
                        <div 
                          key={modifier.id} 
                          style={{
                            ...styles.modifierItem,
                            ...(isSelected ? styles.modifierItemSelected : {})
                          }}
                        >
                          <div style={styles.modifierDetails}>
                            <TavariCheckbox
                              checked={isSelected}
                              onChange={() => handleModifierToggle(modifier, group)}
                              size="md"
                              disabled={loading}
                            />
                            
                            <div style={styles.modifierName}>
                              {modifier.name}
                            </div>
                          </div>
                          
                          <div style={styles.modifierPrice}>
                            {modifier.is_free || Number(modifier.price) === 0 ? (
                              <span style={styles.freeLabel}>Free</span>
                            ) : (
                              `+$${Number(modifier.price).toFixed(2)}`
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={styles.noModifiersContainer}>
              No modifier options available for this item.
            </div>
          )}
        </div>

        {!loading && modifierGroups.length > 0 && (
          <>
            <div style={styles.summary}>
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>
                  Base Price:
                </span>
                <span style={styles.summaryValue}>
                  ${Number(product?.price || 0).toFixed(2)}
                </span>
              </div>
              
              {selectedModifiers.length > 0 && (
                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>
                    Modifiers ({selectedModifiers.length}):
                  </span>
                  <span style={styles.summaryValue}>
                    +${modifierTotal.toFixed(2)}
                  </span>
                </div>
              )}
              
              <div style={{...styles.summaryRow, ...styles.totalRow}}>
                <span style={styles.summaryLabel}>
                  Total:
                </span>
                <span style={styles.totalValue}>
                  ${productTotal.toFixed(2)}
                </span>
              </div>
            </div>

            <div style={styles.actions}>
              <button 
                style={styles.cancelBtn} 
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button 
                style={{
                  ...styles.addBtn,
                  ...(loading ? styles.addBtnDisabled : {})
                }}
                onClick={handleAddToCart}
                disabled={loading}
              >
                {loading ? 'Adding...' : 'Add to Cart'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ModifierSelectionModal;
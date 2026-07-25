// hooks/useTaxCalculations.js - Fixed Tax Calculations Hook for Tavari POS
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Tax calculations hook for Tavari POS system
 * Handles complex tax calculations including:
 * - Multiple tax rates per item
 * - Category-based tax assignments
 * - Item-specific tax overrides
 * - Rebates and exemptions
 * - Proportional tax reduction for discounts/loyalty
 * - Canadian cash rounding
 * 
 * @param {string} businessId - Business ID to load tax data for
 * @returns {Object} Tax calculation functions and data
 */
export const useTaxCalculations = (businessId) => {
  const [taxCategories, setTaxCategories] = useState([]);
  const [categoryTaxAssignments, setCategoryTaxAssignments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load tax data when businessId changes
  useEffect(() => {
    if (businessId) {
      loadTaxData(businessId);
    } else {
      setTaxCategories([]);
      setCategoryTaxAssignments([]);
      setCategories([]);
      setLoading(false);
    }
  }, [businessId]);

  /**
   * Load tax configuration data from database
   */
  const loadTaxData = async (businessId) => {
    setLoading(true);
    setError(null);
    
    try {
      // Load tax categories
      const { data: taxCats, error: taxError } = await supabase
        .from('pos_tax_categories')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (taxError) throw taxError;

      // Load category tax assignments
      const { data: assignments, error: assignError } = await supabase
        .from('pos_category_tax_assignments')
        .select(`
          *,
          pos_tax_categories!inner(*)
        `)
        .eq('business_id', businessId);

      if (assignError) throw assignError;

      // Load categories
      const { data: cats, error: catError } = await supabase
        .from('pos_categories')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (catError) throw catError;

      setTaxCategories(taxCats || []);
      setCategoryTaxAssignments(assignments || []);
      setCategories(cats || []);
      
    } catch (err) {
      console.error('Error loading tax data:', err);
      setError(err.message);
      // Set fallback empty arrays so calculations don't break
      setTaxCategories([]);
      setCategoryTaxAssignments([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Get tax categories that apply to a specific product category
   */
  const getCategoryTaxes = useCallback((categoryId) => {
    if (!categoryId || !Array.isArray(categoryTaxAssignments)) return [];
    
    return categoryTaxAssignments.filter(assignment => 
      assignment.category_id === categoryId
    );
  }, [categoryTaxAssignments]);

  /**
   * Get effective tax categories for an item
   * Combines category defaults with item-specific overrides.
   * Custom items (no category) get the first active standard tax category so they are taxed.
   */
  const getItemTaxes = useCallback((item) => {
    let allApplicableTaxes = [];

    // Custom items: use all active standard tax categories so combined rate matches other taxable items
    if (item.is_custom) {
      const defaultTaxes = taxCategories.filter(t => t.category_type === 'tax' && t.is_active !== false);
      allApplicableTaxes.push(...defaultTaxes);
      return allApplicableTaxes;
    }
    
    // ALWAYS start with category defaults (base taxes)
    if (item.category_id) {
      const categoryTaxes = getCategoryTaxes(item.category_id);
      const categoryBaseTaxes = categoryTaxes.map(assignment => {
        return assignment.pos_tax_categories || assignment;
      }).filter(Boolean);
      
      allApplicableTaxes.push(...categoryBaseTaxes);
    }
    
    // THEN add any item-specific tax overrides (usually rebates/exemptions)
    if (item.item_tax_overrides && Array.isArray(item.item_tax_overrides) && item.item_tax_overrides.length > 0) {
      const overrideTaxes = taxCategories.filter(tax => 
        item.item_tax_overrides.includes(tax.id)
      );
      allApplicableTaxes.push(...overrideTaxes);
    }
    
    // Remove duplicates (in case a tax appears in both category and overrides)
    const uniqueTaxes = allApplicableTaxes.filter((tax, index, self) => 
      index === self.findIndex(t => t.id === tax.id)
    );
    
    return uniqueTaxes;
  }, [taxCategories, getCategoryTaxes]);

  /** Combined rate (0-1) for standard taxes on an item. Used for tax-inclusive back-calculation. */
  const getCombinedTaxRate = useCallback((item) => {
    const taxes = getItemTaxes(item);
    return taxes
      .filter(t => t.category_type === 'tax')
      .reduce((sum, t) => sum + (parseFloat(t.rate) || 0), 0);
  }, [getItemTaxes]);

  /**
   * Calculate tax for a single item with rebates and exemptions
   */
  const calculateItemTax = useCallback((item, itemSubtotal) => {
    // Gift cards / prepaid value: tax at redemption only (Ontario default)
    if (item?.tax_exempt || item?.is_gift_card || item?.gift_card) {
      return {
        taxAmount: 0,
        effectiveRate: 0,
        simpleTaxBreakdown: {},
        rebateBreakdown: {},
        isExempt: true
      };
    }

    const applicableTaxes = getItemTaxes(item);
    
    let isExempt = false;
    let exemptFromTaxes = [];
    const simpleTaxBreakdown = {};
    const rebateBreakdown = {};
    
    // Process all applicable taxes
    applicableTaxes.forEach(tax => {
      if (tax.category_type === 'tax') {
        const taxRate = parseFloat(tax.rate) || 0;
        const taxAmount = itemSubtotal * taxRate;
        
        // Aggregate taxes by name
        if (simpleTaxBreakdown[tax.name]) {
          simpleTaxBreakdown[tax.name] += taxAmount;
        } else {
          simpleTaxBreakdown[tax.name] = taxAmount;
        }
      } else if (tax.category_type === 'rebate') {
        const taxRate = parseFloat(tax.rate) || 0;
        
        if (taxRate === 0 && tax.rebate_affects && Array.isArray(tax.rebate_affects)) {
          // Rate 0 rebate = full exemption from specific taxes
          exemptFromTaxes.push(...tax.rebate_affects);
          
          // Calculate rebate amount based on affected taxes
          tax.rebate_affects.forEach(affectedTaxId => {
            const affectedTax = taxCategories.find(t => t.id === affectedTaxId);
            if (affectedTax) {
              const rebateAmount = itemSubtotal * (parseFloat(affectedTax.rate) || 0);
              if (rebateBreakdown[tax.name]) {
                rebateBreakdown[tax.name] += rebateAmount;
              } else {
                rebateBreakdown[tax.name] = rebateAmount;
              }
            }
          });
        } else if (taxRate > 0) {
          // Percentage rebate
          const rebateAmount = itemSubtotal * taxRate;
          if (rebateBreakdown[tax.name]) {
            rebateBreakdown[tax.name] += rebateAmount;
          } else {
            rebateBreakdown[tax.name] = rebateAmount;
          }
        }
      } else if (tax.category_type === 'exemption') {
        isExempt = true;
      }
    });

    if (isExempt) {
      return {
        taxAmount: 0,
        effectiveRate: 0,
        simpleTaxBreakdown: {},
        rebateBreakdown: {},
        isExempt: true
      };
    }

    // Calculate net tax amount after rebates
    let totalNetTax = 0;
    Object.values(simpleTaxBreakdown).forEach(amount => {
      totalNetTax += amount;
    });
    Object.values(rebateBreakdown).forEach(amount => {
      totalNetTax -= amount;
    });

    return {
      taxAmount: Math.max(0, totalNetTax),
      effectiveRate: itemSubtotal > 0 ? Math.max(0, totalNetTax) / itemSubtotal : 0,
      simpleTaxBreakdown,
      rebateBreakdown,
      isExempt: false
    };
  }, [getItemTaxes, taxCategories]);

  /**
   * Calculate total tax for all cart items with aggregated breakdown
   */
  /**
   * @param {object|null} indianStatusOptions - When set, entire order uses only the configured GST rate (Indian Status).
   *   { enabled: true, gstRate: number, taxLabel?: string }
   */
  const calculateTotalTax = useCallback((
    cartItems = [], 
    discountAmount = 0, 
    loyaltyRedemption = 0, 
    subtotal = null,
    indianStatusOptions = null
  ) => {
    const gstOnly =
      indianStatusOptions &&
      indianStatusOptions.enabled === true &&
      typeof indianStatusOptions.gstRate === 'number' &&
      indianStatusOptions.gstRate >= 0;
    const indianGstRate = gstOnly ? Math.min(1, Math.max(0, indianStatusOptions.gstRate)) : 0;
    const indianTaxLabel = (gstOnly && indianStatusOptions.taxLabel?.trim())
      ? indianStatusOptions.taxLabel.trim()
      : 'GST (Indian Status)';

    // Calculate subtotal if not provided
    const calculatedSubtotal = subtotal !== null ? subtotal : cartItems.reduce((sum, item) => {
      const basePrice = Number(item.price) || 0;
      const modifiersTotal = item.modifiers?.reduce((mSum, mod) => {
        return mSum + (Number(mod.price) || 0);
      }, 0) || 0;
      const itemTotal = (basePrice + modifiersTotal) * (Number(item.quantity) || 1);
      return sum + itemTotal;
    }, 0);

    let totalTax = 0;
    const aggregatedTaxes = {};
    const aggregatedRebates = {};
    const itemTaxDetails = [];

    // Calculate proportional discount and loyalty reduction per item
    const discountRatio = calculatedSubtotal > 0 ? (discountAmount + loyaltyRedemption) / calculatedSubtotal : 0;

    cartItems.forEach((item) => {
      const basePrice = Number(item.price) || 0;
      const modifiersTotal = item.modifiers?.reduce((mSum, mod) => {
        return mSum + (Number(mod.price) || 0);
      }, 0) || 0;
      const itemSubtotal = (basePrice + modifiersTotal) * (Number(item.quantity) || 1);
      
      // Apply proportional discount/loyalty reduction
      let itemAfterReductions = itemSubtotal * (1 - discountRatio);

      // Tax-inclusive custom items: price entered is total including tax; back out pre-tax amount
      if (item.is_custom && item.tax_included) {
        const rateForInclusive = gstOnly ? indianGstRate : getCombinedTaxRate(item);
        if (rateForInclusive > 0) {
          const preTaxAmount = itemAfterReductions / (1 + rateForInclusive);
          itemAfterReductions = preTaxAmount;
        }
      }

      let itemTaxInfo;
      if (item?.tax_exempt || item?.is_gift_card || item?.gift_card) {
        itemTaxInfo = {
          taxAmount: 0,
          effectiveRate: 0,
          simpleTaxBreakdown: {},
          rebateBreakdown: {},
          isExempt: true
        };
      } else if (gstOnly) {
        const taxAmount = itemAfterReductions * indianGstRate;
        const simpleTaxBreakdown = taxAmount > 0 ? { [indianTaxLabel]: taxAmount } : {};
        itemTaxInfo = {
          taxAmount,
          effectiveRate: itemAfterReductions > 0 ? taxAmount / itemAfterReductions : 0,
          simpleTaxBreakdown,
          rebateBreakdown: {},
          isExempt: false
        };
        totalTax += taxAmount;
      } else {
        itemTaxInfo = calculateItemTax(item, itemAfterReductions);
        totalTax += itemTaxInfo.taxAmount;
      }
      
      itemTaxDetails.push({
        itemId: item.id,
        itemName: item.name,
        subtotal: itemSubtotal,
        taxableAmount: itemAfterReductions,
        ...itemTaxInfo
      });

      // Aggregate taxes across all items
      Object.entries(itemTaxInfo.simpleTaxBreakdown || {}).forEach(([taxName, amount]) => {
        if (aggregatedTaxes[taxName]) {
          aggregatedTaxes[taxName] += amount;
        } else {
          aggregatedTaxes[taxName] = amount;
        }
      });

      // Aggregate rebates across all items
      Object.entries(itemTaxInfo.rebateBreakdown || {}).forEach(([rebateName, amount]) => {
        if (aggregatedRebates[rebateName]) {
          aggregatedRebates[rebateName] += amount;
        } else {
          aggregatedRebates[rebateName] = amount;
        }
      });
    });

    return {
      totalTax,
      aggregatedTaxes,
      aggregatedRebates,
      itemTaxDetails,
      indianStatusGstOnly: gstOnly
    };
  }, [calculateItemTax, getCombinedTaxRate]);

  /**
   * Apply Canadian cash rounding (no pennies)
   */
  const applyCashRounding = useCallback((amount, paymentMethod = 'cash') => {
    if (paymentMethod !== 'cash') return amount;
    
    // Canadian cash rounding to nearest nickel
    return Math.round(amount * 20) / 20;
  }, []);

  /**
   * Calculate effective tax rate for display purposes
   */
  const calculateEffectiveRate = useCallback((taxAmount, taxableAmount) => {
    if (taxableAmount <= 0) return 0;
    return taxAmount / taxableAmount;
  }, []);

  /**
   * Validate tax configuration
   */
  const validateTaxConfiguration = useCallback((taxCategoriesToValidate = taxCategories) => {
    const errors = [];
    
    taxCategoriesToValidate.forEach(tax => {
      if (!tax.name || !tax.name.trim()) {
        errors.push(`Tax category missing name: ${tax.id}`);
      }
      
      if (tax.category_type === 'tax') {
        const rate = parseFloat(tax.rate);
        if (isNaN(rate) || rate < 0 || rate > 1) {
          errors.push(`Invalid tax rate for ${tax.name}: ${tax.rate}`);
        }
      }
      
      if (tax.category_type === 'rebate' && tax.rebate_affects) {
        if (!Array.isArray(tax.rebate_affects) || tax.rebate_affects.length === 0) {
          errors.push(`Rebate ${tax.name} must specify which taxes it affects`);
        }
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }, [taxCategories]);

  /**
   * Format tax amount for display
   */
  const formatTaxAmount = useCallback((amount, precision = 2) => {
    return Number(amount).toFixed(precision);
  }, []);

  /**
   * Get tax summary for receipt/display
   */
  const getTaxSummary = useCallback((taxBreakdown) => {
    const summary = [];
    
    // Add individual taxes
    Object.entries(taxBreakdown.aggregatedTaxes || {}).forEach(([name, amount]) => {
      summary.push({
        type: 'tax',
        name,
        amount,
        display: `${name}: $${formatTaxAmount(amount)}`
      });
    });
    
    // Add rebates
    Object.entries(taxBreakdown.aggregatedRebates || {}).forEach(([name, amount]) => {
      summary.push({
        type: 'rebate',
        name,
        amount: -amount,
        display: `${name}: -$${formatTaxAmount(amount)}`
      });
    });
    
    return summary;
  }, [formatTaxAmount]);

  return {
    // Data state
    taxCategories,
    categoryTaxAssignments,
    categories,
    loading,
    error,
    
    // Core calculation functions
    getCategoryTaxes,
    getItemTaxes,
    getCombinedTaxRate,
    calculateItemTax,
    calculateTotalTax,
    
    // Utility functions
    applyCashRounding,
    calculateEffectiveRate,
    validateTaxConfiguration,
    formatTaxAmount,
    getTaxSummary,
    
    // Data management
    refreshTaxData: () => loadTaxData(businessId)
  };
};

export default useTaxCalculations;
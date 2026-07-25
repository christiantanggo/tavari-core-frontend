// components/POS/POSRefundComponents/RefundModal.jsx - Transaction Refund Modal Component
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { logAction } from '../../../helpers/posAudit';
import { generateReceiptHTML, printReceipt, RECEIPT_TYPES } from '../../../helpers/ReceiptBuilder';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';

// Foundation Components
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import { applyRestockAdjustments } from '../../../utils/posInventoryStock';

const RefundModal = ({ 
  transaction, 
  businessSettings, 
  selectedBusinessId, 
  authUser, 
  onClose, 
  onRefundCompleted 
}) => {
  console.log('RefundModal rendered with transaction:', transaction);
  
  const [refundItems, setRefundItems] = useState([]);
  const [refundType, setRefundType] = useState('partial');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [customRefundMethod, setCustomRefundMethod] = useState('');
  const [recordOnly, setRecordOnly] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [restockItems, setRestockItems] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [helcimTransactionId, setHelcimTransactionId] = useState(null);
  const [helcimPaidAmount, setHelcimPaidAmount] = useState(0);
  const [saleNotes, setSaleNotes] = useState(null);
  const taxCalc = useTaxCalculations(selectedBusinessId);

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'RefundModal'
  });

  const parseHelcimIdFromText = (text) => {
    if (!text) return null;
    const match = String(text).match(/transaction id:\s*([0-9]+)/i) || String(text).match(/\bH-ID:\s*([0-9]+)/i);
    return match?.[1] ? match[1] : null;
  };

  useEffect(() => {
    console.log('RefundModal useEffect running with transaction:', transaction);
    
    if (!transaction?.id) return;

    // Fetch original sale notes + payment rows (needed for Helcim split refunds)
    (async () => {
      try {
        const [{ data: saleRow }, { data: paymentsRows }] = await Promise.all([
          supabase
            .from('pos_sales')
            .select('notes')
            .eq('id', transaction.id)
            .maybeSingle(),
          supabase
            .from('pos_payments')
            .select('payment_method, amount, reference_number, notes')
            .eq('sale_id', transaction.id)
        ]);

        const notes = saleRow?.notes || null;
        setSaleNotes(notes);

        const payments = Array.isArray(paymentsRows) ? paymentsRows : [];
        const helcimPayments = payments.filter(p => String(p.payment_method || '').toLowerCase() === 'helcim_terminal');
        const helcimTotal = helcimPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        setHelcimPaidAmount(helcimTotal);

        // Prefer H-ID from Helcim payment reference_number; fall back to sale notes.
        const hidFromPayment = helcimPayments.find(p => p.reference_number)?.reference_number || null;
        const hidFromNotes = parseHelcimIdFromText(notes);
        setHelcimTransactionId(hidFromPayment || hidFromNotes || null);
      } catch (e) {
        // Non-fatal; refunds can still proceed in cash/custom modes
        setSaleNotes(null);
        setHelcimPaidAmount(0);
        setHelcimTransactionId(parseHelcimIdFromText(transaction?.notes) || null);
      }
    })();

    // Initialize refund items (requires tax config to identify taxable vs exempt categories)
    (async () => {
      if (!transaction.pos_sale_items) return;
      if (taxCalc.loading) return;

      const transactionTax = parseFloat(transaction.tax || 0);
      const saleItems = transaction.pos_sale_items || [];

      // Fetch category_id for each inventory_id so we can determine if the item is taxable.
      const inventoryIds = Array.from(new Set(saleItems.map(i => i.inventory_id).filter(Boolean)));
      let inventoryMap = {};
      if (inventoryIds.length > 0) {
        const { data: inventoryRows } = await supabase
          .from('pos_inventory')
          .select('id, category_id')
          .in('id', inventoryIds);
        (inventoryRows || []).forEach(row => {
          inventoryMap[row.id] = row;
        });
      }

      // Determine taxable items using configured category taxes.
      const itemMeta = saleItems.map(item => {
        const inv = item.inventory_id ? inventoryMap[item.inventory_id] : null;
        const category_id = inv?.category_id || null;
        const itemSubtotal = parseFloat(item.total_price || 0);
        const taxInfo = taxCalc.calculateItemTax({ category_id }, itemSubtotal);
        return {
          item,
          category_id,
          itemSubtotal,
          isTaxable: (taxInfo?.taxAmount || 0) > 0,
        };
      });

      const taxableSubtotalTotal = itemMeta
        .filter(x => x.isTaxable)
        .reduce((sum, x) => sum + x.itemSubtotal, 0);

      const items = itemMeta.map(({ item, itemSubtotal, isTaxable }) => {
        // Allocate original transaction tax ONLY across taxable items.
        const allocatedTaxFull = (isTaxable && taxableSubtotalTotal > 0)
          ? (transactionTax * (itemSubtotal / taxableSubtotalTotal))
          : 0;

        return {
          ...item,
          refund_quantity: item.quantity,
          refund_subtotal: itemSubtotal,
          refund_tax: allocatedTaxFull,
          refund_amount: itemSubtotal + allocatedTaxFull,
          tax_breakdown: allocatedTaxFull > 0 ? { 'Tax': allocatedTaxFull } : {},
          rebate_breakdown: {},
          is_exempt: !isTaxable,
          _allocated_tax_full: allocatedTaxFull
        };
      });

      setRefundItems(items);

      // Initialize restock options
      const restockDefaults = {};
      items.forEach(item => {
        restockDefaults[item.id] = true;
      });
      setRestockItems(restockDefaults);

      // Set refund type based on whether all items are being refunded
      const totalItemsBeingRefunded = items.reduce((sum, item) => sum + item.refund_quantity, 0);
      const totalOriginalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      setRefundType(totalItemsBeingRefunded === totalOriginalItems ? 'full' : 'partial');
    })();
  }, [transaction, taxCalc.loading]);

  const handleItemQuantityChange = (itemId, newQuantity) => {
    const item = transaction.pos_sale_items.find(i => i.id === itemId);
    if (!item) return;

    const maxQuantity = item.quantity;
    const validQuantity = Math.max(0, Math.min(newQuantity, maxQuantity));
    
    setRefundItems(prev => prev.map(refundItem => {
      if (refundItem.id === itemId) {
        // Calculate proportional amounts for this item (subtotal + allocated tax)
        const quantityRatio = validQuantity / item.quantity;
        const itemSubtotal = parseFloat(item.total_price || 0) * quantityRatio;
        const baseTaxFull = refundItem._allocated_tax_full || 0;
        const itemTax = baseTaxFull * quantityRatio;
        
        return {
          ...refundItem,
          refund_quantity: validQuantity,
          refund_subtotal: itemSubtotal,
          refund_tax: itemTax,
          refund_amount: itemSubtotal + itemTax,
          tax_breakdown: itemTax > 0 ? { 'Tax': itemTax } : {}
        };
      }
      return refundItem;
    }));

    // Update refund type based on quantities
    setTimeout(() => {
      const allItems = transaction.pos_sale_items;
      const currentRefundItems = refundItems.map(ri => 
        ri.id === itemId ? { ...ri, refund_quantity: validQuantity } : ri
      );
      
      const totalItemsBeingRefunded = currentRefundItems.reduce((sum, item) => sum + item.refund_quantity, 0);
      const totalOriginalItems = allItems.reduce((sum, item) => sum + item.quantity, 0);
      
      if (totalItemsBeingRefunded === totalOriginalItems) {
        setRefundType('full');
      } else if (totalItemsBeingRefunded === 0) {
        setRefundType('partial');
      } else {
        setRefundType('partial');
      }
    }, 0);
  };

  const handleRestockToggle = (itemId) => {
    setRestockItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  const calculateRefundBreakdown = () => {
    const subtotal = refundItems.reduce((total, item) => total + (item.refund_subtotal || 0), 0);
    const tax = refundItems.reduce((total, item) => total + (item.refund_tax || 0), 0);
    
    // Aggregate tax breakdown across all items
    const aggregatedTaxes = {};
    const aggregatedRebates = {};
    
    refundItems.forEach(item => {
      Object.entries(item.tax_breakdown || {}).forEach(([taxName, amount]) => {
        aggregatedTaxes[taxName] = (aggregatedTaxes[taxName] || 0) + amount;
      });
      
      Object.entries(item.rebate_breakdown || {}).forEach(([rebateName, amount]) => {
        aggregatedRebates[rebateName] = (aggregatedRebates[rebateName] || 0) + amount;
      });
    });
    
    return { 
      subtotal, 
      tax, 
      total: subtotal + tax,
      aggregatedTaxes,
      aggregatedRebates
    };
  };

  const calculateRefundTotal = () => {
    return calculateRefundBreakdown().total;
  };

  const handleProcessRefund = async () => {
    if (!refundReason.trim()) {
      setError('Please provide a reason for the refund');
      return;
    }

    const refundTotal = calculateRefundTotal();
    if (!Number.isFinite(refundTotal)) {
      setError('Refund total could not be calculated. Please re-open the refund and try again.');
      return;
    }
    if (refundTotal <= 0) {
      setError('Refund amount must be greater than $0.00');
      return;
    }

    // Validate manager PIN
    if (!managerPin) {
      setError('Manager PIN is required for all refunds');
      return;
    }

    const isValidManagerPin = await auth.validateManagerPin(managerPin);
    if (!isValidManagerPin) {
      setError('Invalid manager PIN');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const breakdown = calculateRefundBreakdown();
      if (!Number.isFinite(breakdown?.total) || !Number.isFinite(breakdown?.subtotal) || !Number.isFinite(breakdown?.tax)) {
        throw new Error('Refund breakdown could not be calculated (invalid amounts)');
      }

      // If refund method is Helcim (credit/debit), refund up to the amount originally paid via Helcim.
      const isHelcimRefund = refundMethod === 'credit' || refundMethod === 'debit';
      const deviceCode = (localStorage.getItem('helcim_device_code') || 'JSV5').toUpperCase();
      const helcimCap = Number(helcimPaidAmount || 0);
      const helcimRefundAmount = isHelcimRefund ? Math.min(refundTotal, helcimCap) : 0;
      const cashRemainder = isHelcimRefund ? Math.max(0, refundTotal - helcimRefundAmount) : 0;

      if (isHelcimRefund && !recordOnly) {
        if (!helcimTransactionId) {
          throw new Error('Missing H-ID for this transaction. Cannot process Helcim refund.');
        }
        if (!Number.isFinite(helcimRefundAmount)) {
          throw new Error('Helcim refund amount could not be calculated');
        }
        if (helcimRefundAmount <= 0) {
          throw new Error('This transaction has no Helcim-paid amount available to refund.');
        }

        const refundPayload = {
          refundType: refundMethod === 'debit' ? 'debit' : 'credit',
          originalTransactionId: String(helcimTransactionId),
          transactionAmount: Number(helcimRefundAmount.toFixed(2)),
          currency: 'CAD',
          deviceCode
        };

        const { data: helcimResp, error: helcimFnError } = await supabase.functions.invoke('helcim-terminal', {
          body: {
            action: 'refundPayment',
            data: { ...refundPayload, businessId: selectedBusinessId },
          },
        });

        if (helcimFnError) {
          throw new Error(helcimFnError.message || 'Helcim refund failed');
        }

        if (!helcimResp?.success) {
          const rawError = String(helcimResp?.error || 'Helcim refund failed');
          const isNotRefundable = /cannot be refunded/i.test(rawError);
          const isFullCardOnlyRefund = cashRemainder <= 0 && Math.abs(helcimRefundAmount - refundTotal) < 0.01;

          // If Helcim says "cannot be refunded", it often means the transaction isn't settled yet.
          // For same-day/open-batch transactions, a full reverse/void is typically required.
          if (isNotRefundable && refundMethod === 'credit' && isFullCardOnlyRefund) {
            const { data: reverseResp, error: reverseFnError } = await supabase.functions.invoke('helcim-terminal', {
              body: {
                action: 'reversePayment',
                data: {
                  originalTransactionId: String(helcimTransactionId),
                  transactionAmount: Number(refundTotal.toFixed(2)),
                  currency: 'CAD',
                  businessId: selectedBusinessId,
                },
              },
            });

            if (reverseFnError) {
              throw new Error(reverseFnError.message || rawError);
            }
            if (!reverseResp?.success) {
              throw new Error(reverseResp?.error || rawError);
            }
          } else {
            throw new Error(rawError);
          }
        }
      }
      
      // Create refund record.
      // NOTE: DB enforces a check constraint on `refund_type`.
      // Keep the *processor method* in `refund_method`, but store a DB-safe type in `refund_type`.
      const resolvedRefundMethod = isHelcimRefund
        ? (cashRemainder > 0 ? `${refundMethod}+cash` : refundMethod)
        : (refundMethod === 'custom' ? customRefundMethod : refundMethod);

      const dbRefundType =
        (refundMethod === 'credit' || refundMethod === 'debit')
          ? 'card'
          : resolvedRefundMethod;

      const refundData = {
        business_id: selectedBusinessId,
        original_sale_id: transaction.id,
        refunded_by: authUser.id,
        refund_type: dbRefundType,
        refund_method: resolvedRefundMethod,
        total_refund_amount: refundTotal,
        reason: refundReason.trim(),
        manager_override: true,
        manager_id: authUser.id,
        created_at: new Date().toISOString()
      };

      console.log('Creating refund with data:', refundData);

      const { data: refund, error: refundError } = await supabase
        .from('pos_refunds')
        .insert(refundData)
        .select()
        .single();

      if (refundError) {
        console.error('Refund insert error:', refundError);
        throw refundError;
      }

      // Create refund item records
      const refundItemsToInsert = refundItems
        .filter(item => item.refund_quantity > 0)
        .map(item => ({
          business_id: selectedBusinessId,
          refund_id: refund.id,
          original_sale_item_id: item.id,
          inventory_id: item.inventory_id,
          quantity_refunded: item.refund_quantity,
          unit_price: item.unit_price,
          refund_amount: item.refund_amount,
          restock: restockItems[item.id] || false,
          created_at: new Date().toISOString()
        }));

      if (refundItemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('pos_refund_items')
          .insert(refundItemsToInsert);

        if (itemsError) throw itemsError;
      }

      // Update inventory for restocked items (bundle sales restock components)
      const restockLines = refundItems
        .filter((item) => item.refund_quantity > 0 && restockItems[item.id] && item.inventory_id)
        .map((item) => ({
          inventoryId: item.inventory_id,
          quantity: item.refund_quantity,
        }));

      if (restockLines.length > 0) {
        try {
          await applyRestockAdjustments(supabase, selectedBusinessId, restockLines);
        } catch (restockError) {
          console.warn('Inventory restock failed:', restockError);
        }
      }

      // Generate proper refund receipt
      const refundReceiptData = {
        // Basic receipt info
        sale_number: `REFUND-${transaction.sale_number}`,
        created_at: new Date().toISOString(), // Use refund timestamp
        // Negative amounts for refund items
        items: refundItems.filter(item => item.refund_quantity > 0).map(item => ({
          name: item.name,
          quantity: -item.refund_quantity, // NEGATIVE quantity
          price: item.unit_price,
          total_price: -item.refund_amount, // NEGATIVE total
          modifiers: item.modifiers || []
        })),
        subtotal: -breakdown.subtotal, // NEGATIVE subtotal
        final_total: -refundTotal, // NEGATIVE total
        tax_amount: -breakdown.tax, // NEGATIVE tax
        total: -refundTotal, // NEGATIVE total
        payments: [
          ...(helcimRefundAmount > 0 ? [{
            method: 'helcim_terminal',
            payment_method: 'helcim_terminal',
            amount: helcimRefundAmount,
            reference_number: helcimTransactionId || null
          }] : []),
          ...(cashRemainder > 0 ? [{
            method: 'cash',
            payment_method: 'cash',
            amount: cashRemainder
          }] : []),
          ...(!isHelcimRefund ? [{
            method: refundData.refund_method,
            payment_method: refundData.refund_method,
            amount: refundTotal
          }] : [])
        ],
        tip_amount: 0,
        change_given: 0,
        discount_amount: 0,
        loyalty_redemption: 0,
        aggregated_taxes: Object.fromEntries(
          Object.entries(breakdown.aggregatedTaxes).map(([key, value]) => [key, -value])
        ),
        aggregated_rebates: Object.fromEntries(
          Object.entries(breakdown.aggregatedRebates).map(([key, value]) => [key, -value])
        ),
        // Keep customer info if exists
        customer_name: transaction.customer_name,
        customer_email: transaction.customer_email,
        customer_phone: transaction.customer_phone,
        // Refund-specific data
        refund_id: refund.id,
        refund_reason: refundReason,
        refund_method: refundData.refund_method,
        refunded_at: new Date().toISOString(),
        original_sale_number: transaction.sale_number
      };

      const refundReceiptHTML = await generateReceiptHTML(
        refundReceiptData, 
        RECEIPT_TYPES.REFUND, 
        businessSettings,
        { 
          refundReason: refundReason,
          managerOverride: true,
          requiresSignature: true,
          originalSaleNumber: transaction.sale_number
        }
      );
      
      await printReceipt(refundReceiptHTML, {
        saleData: refundReceiptData,
        receiptType: RECEIPT_TYPES.REFUND,
        businessSettings,
      });

      await logAction({
        action: 'refund_processed',
        context: 'RefundModal',
        metadata: {
          refund_id: refund.id,
          original_sale_id: transaction.id,
          sale_number: transaction.sale_number,
          refund_amount: refundTotal,
          refund_type: refundType,
          refund_method: refundData.refund_method,
          refund_reason: refundReason,
          items_refunded: refundItems.filter(item => item.refund_quantity > 0).length,
          manager_approved: true
        }
      });

      alert('Refund processed successfully!');
      onRefundCompleted();

    } catch (err) {
      console.error('Refund processing error:', err);
      setError('Failed to process refund: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return `$${(amount || 0).toFixed(2)}`;
  };

  const breakdown = calculateRefundBreakdown();

  const styles = {
    modal: {
      ...TavariStyles.components.modal.overlay
    },
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '900px'
    },
    modalHeader: {
      ...TavariStyles.components.modal.header
    },
    closeButton: {
      backgroundColor: 'transparent',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      cursor: 'pointer',
      color: TavariStyles.colors.gray500
    },
    modalBody: {
      ...TavariStyles.components.modal.body
    },
    section: {
      marginBottom: TavariStyles.spacing['2xl']
    },
    transactionSummary: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius.md,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    radioGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.xl
    },
    radioLabel: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      cursor: 'pointer'
    },
    refundItemsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    refundItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md
    },
    itemInfo: {
      flex: 1
    },
    itemName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    itemDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    refundControls: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.lg
    },
    quantityControl: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    quantityInput: {
      width: '60px',
      padding: TavariStyles.spacing.xs,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.sm,
      textAlign: 'center'
    },
    refundAmount: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      minWidth: '100px',
      textAlign: 'right'
    },
    input: {
      ...TavariStyles.components.form.input,
      marginTop: TavariStyles.spacing.sm
    },
    textarea: {
      ...TavariStyles.components.form.input,
      fontFamily: 'inherit',
      resize: 'vertical',
      minHeight: '80px'
    },
    select: {
      ...TavariStyles.components.form.select
    },
    refundTotal: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl
    },
    refundBreakdown: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    breakdownLine: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize.lg
    },
    totalLine: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginTop: TavariStyles.spacing.sm,
      paddingTop: TavariStyles.spacing.sm,
      borderTop: '1px solid rgba(255,255,255,0.3)'
    },
    errorMessage: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error
    },
    modalActions: {
      ...TavariStyles.components.modal.footer
    },
    cancelButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      flex: 1
    },
    processButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      flex: 2
    }
  };

  return (
    <div style={styles.modal}>
      <div style={styles.modalContent}>
        <div style={styles.modalHeader}>
          <h3>Process Refund - Sale #{transaction.sale_number}</h3>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>

        <div style={styles.modalBody}>
          {/* Transaction Summary */}
          <div style={styles.section}>
            <h4>Transaction Details</h4>
            <div style={styles.transactionSummary}>
              <div>Original Total: {formatCurrency(transaction.total)}</div>
              <div>Date: {new Date(transaction.created_at).toLocaleString()}</div>
              {transaction.customer_name && <div>Customer: {transaction.customer_name}</div>}
            </div>
          </div>

          {/* Refund Type */}
          <div style={styles.section}>
            <h4>Refund Type</h4>
            <div style={styles.radioGroup}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  value="full"
                  checked={refundType === 'full'}
                  onChange={(e) => setRefundType(e.target.value)}
                />
                Full Refund
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  value="partial"
                  checked={refundType === 'partial'}
                  onChange={(e) => setRefundType(e.target.value)}
                />
                Partial Refund
              </label>
            </div>
          </div>

          {/* Items to Refund */}
          <div style={styles.section}>
            <h4>Items to Refund</h4>
            <div style={styles.refundItemsList}>
              {transaction.pos_sale_items?.map(item => {
                const refundItem = refundItems.find(ri => ri.id === item.id) || {};
                
                return (
                  <div key={item.id} style={styles.refundItem}>
                    <div style={styles.itemInfo}>
                      <div style={styles.itemName}>{item.name}</div>
                      <div style={styles.itemDetails}>
                        Original: {item.quantity} × {formatCurrency(item.unit_price)} = {formatCurrency(item.total_price)}
                      </div>
                    </div>
                    
                    <div style={styles.refundControls}>
                      <div style={styles.quantityControl}>
                        <label>Quantity:</label>
                        <input
                          type="number"
                          min="0"
                          max={item.quantity}
                          value={refundItem.refund_quantity || 0}
                          onChange={(e) => handleItemQuantityChange(item.id, parseInt(e.target.value) || 0)}
                          style={styles.quantityInput}
                        />
                        <span>of {item.quantity}</span>
                      </div>
                      
                      <TavariCheckbox
                        checked={restockItems[item.id] || false}
                        onChange={() => handleRestockToggle(item.id)}
                        label="Restock"
                        size="sm"
                      />
                      
                      <div style={styles.refundAmount}>
                        {formatCurrency(refundItem.refund_amount || 0)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Refund Method */}
          <div style={styles.section}>
            <h4>Refund Method</h4>
            <select
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value)}
              style={styles.select}
            >
              <option value="cash">Cash</option>
              <option value="credit">Credit (Helcim)</option>
              <option value="debit">Debit (Helcim - device required)</option>
              <option value="loyalty">Store Credit</option>
              <option value="custom">Custom Method</option>
            </select>

            {(refundMethod === 'credit' || refundMethod === 'debit') && (
              <div style={{ marginTop: TavariStyles.spacing.md }}>
                <TavariCheckbox
                  checked={recordOnly}
                  onChange={(e) => setRecordOnly(!!e?.target?.checked)}
                  label="Already refunded in Helcim (record only — do not process in Helcim again)"
                />
                <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: '6px' }}>
                  Use this only if Helcim already processed the refund but Tavari failed to save it.
                </div>
              </div>
            )}
            
            {refundMethod === 'custom' && (
              <input
                type="text"
                value={customRefundMethod}
                onChange={(e) => setCustomRefundMethod(e.target.value)}
                placeholder="Enter custom refund method"
                style={styles.input}
              />
            )}
          </div>

          {/* Refund Reason */}
          <div style={styles.section}>
            <h4>Refund Reason *</h4>
            <textarea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Enter reason for refund (required)"
              style={styles.textarea}
            />
          </div>

          {/* Manager PIN */}
          <div style={styles.section}>
            <h4>Manager Authorization *</h4>
            <input
              type="password"
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value)}
              placeholder="Manager PIN required"
              style={styles.input}
            />
          </div>

          {/* Refund Total */}
          <div style={styles.refundTotal}>
            <div style={styles.refundBreakdown}>
              <div style={styles.breakdownLine}>
                <span>Subtotal:</span>
                <span>{formatCurrency(breakdown.subtotal)}</span>
              </div>
              <div style={styles.breakdownLine}>
                <span>Tax:</span>
                <span>{formatCurrency(breakdown.tax)}</span>
              </div>
              <div style={styles.totalLine}>
                <span>Total Refund:</span>
                <span>{formatCurrency(breakdown.total)}</span>
              </div>
            </div>
          </div>

          {error && (
            <div style={styles.errorMessage}>{error}</div>
          )}
        </div>

        <div style={styles.modalActions}>
          <button
            style={styles.cancelButton}
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            style={styles.processButton}
            onClick={handleProcessRefund}
            disabled={loading || calculateRefundTotal() <= 0}
          >
            {loading ? 'Processing...' : `Process Refund ${formatCurrency(calculateRefundTotal())}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RefundModal;
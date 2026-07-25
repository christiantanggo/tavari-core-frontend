// components/POS/POSRefundComponents/ManualRefundModal.jsx - Manual Refund Modal Component
import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { logAction } from '../../../helpers/posAudit';
import { generateReceiptHTML, printReceipt, RECEIPT_TYPES } from '../../../helpers/ReceiptBuilder';

// Foundation Components
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { TavariStyles } from '../../../utils/TavariStyles';

const ManualRefundModal = ({ 
  businessSettings, 
  selectedBusinessId, 
  authUser, 
  onClose, 
  onRefundCompleted 
}) => {
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [customRefundMethod, setCustomRefundMethod] = useState('');
  const [helcimId, setHelcimId] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'ManualRefundModal'
  });

  const handleProcessManualRefund = async () => {
    // Validation
    if (!refundAmount || parseFloat(refundAmount) <= 0) {
      setError('Please enter a valid refund amount greater than $0.00');
      return;
    }

    if (!refundReason.trim()) {
      setError('Please provide a reason for the refund');
      return;
    }

    // If processing via Helcim, require H-ID (original Helcim transaction id)
    const isHelcimRefund = refundMethod === 'credit' || refundMethod === 'debit';
    if (isHelcimRefund && !helcimId.trim()) {
      setError('H-ID is required for Helcim debit/credit refunds');
      return;
    }

    if (!managerPin) {
      setError('Manager PIN is required for all refunds');
      return;
    }

    // Validate manager PIN
    const isValidManagerPin = await auth.validateManagerPin(managerPin);
    if (!isValidManagerPin) {
      setError('Invalid manager PIN');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const refundTotal = parseFloat(refundAmount);
      if (!Number.isFinite(refundTotal) || refundTotal <= 0) {
        throw new Error('Refund amount must be a number greater than $0.00');
      }

      // If Helcim debit/credit refund: call Helcim first (avoid creating DB records if processor fails)
      if (isHelcimRefund) {
        const deviceCode = (localStorage.getItem('helcim_device_code') || 'JSV5').toUpperCase();
        const { data: helcimResp, error: helcimFnError } = await supabase.functions.invoke('helcim-terminal', {
          body: {
            action: 'refundPayment',
            data: {
              refundType: refundMethod === 'debit' ? 'debit' : 'credit',
              originalTransactionId: helcimId.trim(),
              transactionAmount: Number(refundTotal.toFixed(2)),
              currency: 'CAD',
              deviceCode,
              businessId: selectedBusinessId,
            },
          },
        });
        if (helcimFnError) {
          throw new Error(helcimFnError.message || 'Helcim refund failed');
        }
        if (!helcimResp?.success) {
          throw new Error(helcimResp?.error || 'Helcim refund failed');
        }
      }
      
      // First, create a dummy sale record for the manual refund
      const { data: manualSale, error: saleError } = await supabase
        .rpc('create_manual_refund_sale', {
          p_business_id: selectedBusinessId,
          p_refund_amount: refundTotal,
          p_created_by: authUser.id
        });

      if (saleError) {
        console.error('Manual sale creation error:', saleError);
        throw saleError;
      }

      // Now create the refund record with the manual sale ID
      const resolvedRefundMethod = refundMethod === 'custom' ? customRefundMethod : refundMethod;
      const dbRefundType =
        (refundMethod === 'credit' || refundMethod === 'debit')
          ? 'card'
          : resolvedRefundMethod;
      const refundData = {
        business_id: selectedBusinessId,
        original_sale_id: manualSale, // Reference the dummy sale
        refunded_by: authUser.id,
        refund_type: dbRefundType,
        refund_method: resolvedRefundMethod,
        total_refund_amount: refundTotal,
        reason: refundReason.trim(),
        manager_override: true,
        manager_id: authUser.id,
        created_at: new Date().toISOString()
      };

      console.log('Creating manual refund with data:', refundData);

      const { data: refund, error: refundError } = await supabase
        .from('pos_refunds')
        .insert(refundData)
        .select()
        .single();

      if (refundError) {
        console.error('Manual refund insert error:', refundError);
        throw refundError;
      }

      // Generate manual refund receipt
      const manualRefundReceiptData = {
        sale_number: `MANUAL-REFUND-${manualSale.slice(-8).toUpperCase()}`,
        created_at: new Date().toISOString(),
        items: [{
          name: 'Manual Refund',
          quantity: -1,
          price: refundTotal,
          total_price: -refundTotal,
          modifiers: []
        }],
        subtotal: -refundTotal,
        final_total: -refundTotal,
        tax_amount: 0,
        total: -refundTotal,
        payments: isHelcimRefund ? [{
          method: 'helcim_terminal',
          payment_method: 'helcim_terminal',
          amount: refundTotal,
          reference_number: helcimId.trim()
        }] : [{
          method: refundData.refund_method,
          payment_method: refundData.refund_method,
          amount: refundTotal
        }],
        tip_amount: 0,
        change_given: 0,
        discount_amount: 0,
        loyalty_redemption: 0,
        aggregated_taxes: {},
        aggregated_rebates: {},
        customer_name: customerName || null,
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        refund_id: refund.id,
        refund_reason: refundReason,
        refund_method: refundData.refund_method,
        refunded_at: new Date().toISOString(),
        is_manual_refund: true
      };

      const refundReceiptHTML = await generateReceiptHTML(
        manualRefundReceiptData, 
        RECEIPT_TYPES.REFUND, 
        businessSettings,
        { 
          refundReason: refundReason,
          managerOverride: true,
          requiresSignature: true,
          isManualRefund: true
        }
      );
      
      await printReceipt(refundReceiptHTML, {
        saleData: manualRefundReceiptData,
        receiptType: RECEIPT_TYPES.REFUND,
        businessSettings,
      });

      await logAction({
        action: 'manual_refund_processed',
        context: 'ManualRefundModal',
        metadata: {
          refund_id: refund.id,
          manual_sale_id: manualSale,
          refund_amount: refundTotal,
          refund_method: refundData.refund_method,
          refund_reason: refundReason,
          customer_name: customerName,
          manager_approved: true
        }
      });

      alert('Manual refund processed successfully!');
      onRefundCompleted();

    } catch (err) {
      console.error('Manual refund processing error:', err);
      setError('Failed to process manual refund: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return `$${(amount || 0).toFixed(2)}`;
  };

  const styles = {
    modal: {
      ...TavariStyles.components.modal.overlay
    },
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '600px'
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
    warningBanner: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warning,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.warning}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
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
    amountInput: {
      ...TavariStyles.components.form.input,
      marginTop: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'center',
      border: `3px solid ${TavariStyles.colors.warning}`
    },
    refundTotal: {
      backgroundColor: TavariStyles.colors.warning,
      color: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      textAlign: 'center'
    },
    totalAmount: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.sm
    },
    totalLabel: {
      fontSize: TavariStyles.typography.fontSize.lg,
      opacity: 0.9
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
      ...TavariStyles.components.button.variants.warning,
      flex: 2
    }
  };

  return (
    <div style={styles.modal}>
      <div style={styles.modalContent}>
        <div style={styles.modalHeader}>
          <h3>Manual Refund</h3>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>

        <div style={styles.modalBody}>
          {/* Warning Banner */}
          <div style={styles.warningBanner}>
            <strong>Manual Refund:</strong> This refund is not tied to any specific transaction. 
            Use this only when a transaction cannot be found or for special circumstances. 
            Manager authorization and detailed reasoning are required.
          </div>

          {/* Refund Amount */}
          <div style={styles.section}>
            <h4>Refund Amount *</h4>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              placeholder="0.00"
              style={styles.amountInput}
            />
          </div>

          {/* Customer Information (Optional) */}
          <div style={styles.section}>
            <h4>Customer Information (Optional)</h4>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer Name"
              style={styles.input}
            />
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="Customer Email"
              style={styles.input}
            />
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Customer Phone"
              style={styles.input}
            />
          </div>

          {/* Refund Method */}
          <div style={styles.section}>
            <h4>Refund Method *</h4>
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
                <label style={{ display: 'block', fontWeight: TavariStyles.typography.fontWeight.medium }}>
                  H-ID (Helcim Transaction ID) *
                </label>
                <input
                  type="text"
                  value={helcimId}
                  onChange={(e) => setHelcimId(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="Enter Helcim transaction id (numbers only)"
                  style={styles.input}
                />
                <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: '6px' }}>
                  {refundMethod === 'debit'
                    ? 'Debit refunds require the customer to complete the refund on the terminal.'
                    : 'Credit refunds are processed via Helcim without the customer present.'}
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
            <h4>Refund Reason * (Detailed explanation required)</h4>
            <textarea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Enter detailed reason for manual refund (required for audit purposes)"
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

          {/* Refund Total Display */}
          {refundAmount && parseFloat(refundAmount) > 0 && (
            <div style={styles.refundTotal}>
              <div style={styles.totalLabel}>Manual Refund Total</div>
              <div style={styles.totalAmount}>
                {formatCurrency(parseFloat(refundAmount))}
              </div>
            </div>
          )}

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
            onClick={handleProcessManualRefund}
            disabled={loading || !refundAmount || parseFloat(refundAmount) <= 0}
          >
            {loading ? 'Processing...' : `Process Manual Refund ${formatCurrency(parseFloat(refundAmount) || 0)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualRefundModal;
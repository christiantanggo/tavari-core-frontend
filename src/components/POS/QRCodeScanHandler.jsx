// components/POS/QRCodeScanHandler.jsx - QR Code Scanner for Transaction Lookup & Refund Flow
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import BarcodeScanHandler from './BarcodeScanHandler';

/**
 * QR Code scanner for transaction lookup and refund flow launch
 * Integrates with existing BarcodeScanHandler for QR code detection
 * 
 * @param {Object} props
 * @param {Function} props.onTransactionFound - Callback when transaction is found (receives transaction data)
 * @param {Function} props.onRefundLaunch - Callback to launch refund flow (receives transaction data)
 * @param {boolean} props.disabled - Whether scanning is disabled
 * @param {boolean} props.autoLaunchRefund - Whether to automatically launch refund flow (default: true)
 * @param {string} props.testId - Test ID for testing
 */
const QRCodeScanHandler = ({
  onTransactionFound = null,
  onRefundLaunch = null,
  disabled = false,
  autoLaunchRefund = true,
  testId = 'qr-scan-handler'
}) => {
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager'],
    requireBusiness: true,
    componentName: 'QR Code Scanner'
  });

  const [scanning, setScanning] = useState(false);
  const [lastScanResult, setLastScanResult] = useState(null);
  const [error, setError] = useState(null);
  const [transactionData, setTransactionData] = useState(null);

  /**
   * Parse QR code to extract transaction information
   * Supports multiple QR code formats:
   * - Receipt QR: "TAVARI_RECEIPT_{transactionId}_{businessId}"
   * - Transaction QR: "TAVARI_TXN_{transactionId}_{timestamp}"
   * - Legacy format: Just the transaction ID
   */
  const parseQRCode = (qrData) => {
    if (!qrData || typeof qrData !== 'string') return null;

    // Try Tavari receipt format
    const receiptMatch = qrData.match(/^TAVARI_RECEIPT_([a-f0-9-]+)_([a-f0-9-]+)$/i);
    if (receiptMatch) {
      return {
        transactionId: receiptMatch[1],
        businessId: receiptMatch[2],
        type: 'receipt'
      };
    }

    // Try receipt-number-only QR (current POS receipt QR encodes just the receipt number)
    // Example: "REDDC2601244597988"
    const receiptNumberMatch = qrData.match(/^R[A-Z0-9]{4}\d{6}\d{4}\d{3}$/i);
    if (receiptNumberMatch) {
      return {
        receiptNumber: qrData.toUpperCase(),
        type: 'receipt_number'
      };
    }

    // Try Tavari transaction format
    const txnMatch = qrData.match(/^TAVARI_TXN_([a-f0-9-]+)_(\d+)$/i);
    if (txnMatch) {
      return {
        transactionId: txnMatch[1],
        timestamp: parseInt(txnMatch[2]),
        type: 'transaction'
      };
    }

    // Try UUID format (legacy)
    const uuidMatch = qrData.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
    if (uuidMatch) {
      return {
        transactionId: qrData,
        type: 'legacy'
      };
    }

    return null;
  };

  /**
   * Look up transaction in database
   */
  const lookupTransaction = async (parsedQR) => {
    if (!parsedQR?.transactionId && !parsedQR?.receiptNumber) return null;

    try {
      console.log('Looking up transaction:', parsedQR.transactionId || parsedQR.receiptNumber);

      // Query pos_sales table for the transaction
      const baseQuery = supabase
        .from('pos_sales')
        .select(`
          *,
          pos_sale_items (
            *,
            inventory (name, price, sku)
          ),
          pos_payments (
            *
          )
        `)
        .eq('business_id', auth.selectedBusinessId);

      const query = parsedQR.receiptNumber
        ? baseQuery.eq('sale_number', parsedQR.receiptNumber)
        : baseQuery.eq('id', parsedQR.transactionId);

      const { data: saleData, error: saleError } = await query.single();

      if (saleError) {
        console.error('Error looking up transaction:', saleError);
        throw new Error('Transaction not found or access denied');
      }

      if (!saleData) {
        throw new Error('Transaction not found');
      }

      // Verify business match if QR contains business ID
      if (parsedQR.businessId && parsedQR.businessId !== auth.selectedBusinessId) {
        throw new Error('Transaction belongs to different business');
      }

      console.log('Transaction found:', saleData);
      return saleData;

    } catch (err) {
      console.error('Transaction lookup error:', err);
      throw err;
    }
  };

  /**
   * Handle QR code scan
   */
  const handleQRScan = async (qrData) => {
    if (!qrData || scanning) return;

    setScanning(true);
    setError(null);
    setLastScanResult(qrData);

    try {
      console.log('QR Code scanned:', qrData);

      // Parse QR code
      const parsedQR = parseQRCode(qrData);
      if (!parsedQR) {
        throw new Error('Invalid QR code format. Please scan a valid Tavari receipt QR code.');
      }

      // Look up transaction
      const transaction = await lookupTransaction(parsedQR);
      if (!transaction) {
        throw new Error('Transaction not found or no access');
      }

      setTransactionData(transaction);

      // Notify parent components
      if (onTransactionFound) {
        onTransactionFound(transaction);
      }

      // Auto-launch refund flow if enabled
      if (autoLaunchRefund && onRefundLaunch) {
        console.log('Auto-launching refund flow for transaction:', transaction.id);
        onRefundLaunch(transaction);
      }

    } catch (err) {
      console.error('QR scan error:', err);
      setError(err.message);
      setTransactionData(null);
    } finally {
      setScanning(false);
    }
  };

  /**
   * Clear scan results
   */
  const clearResults = () => {
    setLastScanResult(null);
    setError(null);
    setTransactionData(null);
  };

  /**
   * Manual refund launch
   */
  const launchRefund = () => {
    if (transactionData && onRefundLaunch) {
      onRefundLaunch(transactionData);
    }
  };

  // Don't render if auth not ready
  if (!auth.isReady || auth.authLoading) {
    return null;
  }

  const styles = {
    container: {
      position: 'relative'
    },

    statusPanel: {
      position: 'fixed',
      top: TavariStyles.spacing.lg,
      right: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      boxShadow: TavariStyles.shadows.md,
      minWidth: '300px',
      zIndex: 9998
    },

    statusTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },

    scanStatus: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: scanning ? TavariStyles.colors.warning : TavariStyles.colors.gray100
    },

    scanIcon: {
      fontSize: TavariStyles.typography.fontSize.lg
    },

    scanText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: scanning ? TavariStyles.colors.white : TavariStyles.colors.gray700
    },

    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.md
    },

    successBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.success,
      marginBottom: TavariStyles.spacing.md
    },

    transactionInfo: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.sm,
      marginBottom: TavariStyles.spacing.md
    },

    transactionRow: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm
    },

    transactionLabel: {
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray600
    },

    transactionValue: {
      color: TavariStyles.colors.gray800
    },

    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      justifyContent: 'flex-end'
    },

    primaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm
    },

    secondaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    }
  };

  return (
    <div style={styles.container} data-testid={testId}>
      {/* Barcode scan handler for QR detection */}
      <BarcodeScanHandler
        onScan={handleQRScan}
        disabled={disabled || scanning}
        testId={`${testId}-barcode-handler`}
      />

      {/* Status panel (only show if there's activity) */}
      {(scanning || error || transactionData || lastScanResult) && (
        <div style={styles.statusPanel}>
          <div style={styles.statusTitle}>QR Code Scanner</div>

          {/* Scan status */}
          <div style={styles.scanStatus}>
            <span style={styles.scanIcon}>
              {scanning ? '🔄' : disabled ? '🚫' : '📷'}
            </span>
            <span style={styles.scanText}>
              {scanning ? 'Processing QR code...' : 
               disabled ? 'Scanner disabled' : 
               'Ready to scan receipt QR codes'}
            </span>
          </div>

          {/* Error display */}
          {error && (
            <div style={styles.errorBanner}>
              {error}
            </div>
          )}

          {/* Success display */}
          {transactionData && !error && (
            <>
              <div style={styles.successBanner}>
                Transaction found! Ready for refund.
              </div>

              <div style={styles.transactionInfo}>
                <div style={styles.transactionRow}>
                  <span style={styles.transactionLabel}>Receipt #:</span>
                  <span style={styles.transactionValue}>
                    {transactionData.receipt_number || transactionData.id.slice(0, 8)}
                  </span>
                </div>
                <div style={styles.transactionRow}>
                  <span style={styles.transactionLabel}>Date:</span>
                  <span style={styles.transactionValue}>
                    {new Date(transactionData.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div style={styles.transactionRow}>
                  <span style={styles.transactionLabel}>Total:</span>
                  <span style={styles.transactionValue}>
                    ${Number(transactionData.total_amount || 0).toFixed(2)}
                  </span>
                </div>
                <div style={styles.transactionRow}>
                  <span style={styles.transactionLabel}>Items:</span>
                  <span style={styles.transactionValue}>
                    {transactionData.pos_sale_items?.length || 0} items
                  </span>
                </div>
              </div>

              <div style={styles.buttonGroup}>
                {!autoLaunchRefund && onRefundLaunch && (
                  <button 
                    style={styles.primaryButton}
                    onClick={launchRefund}
                  >
                    Start Refund
                  </button>
                )}
                <button 
                  style={styles.secondaryButton}
                  onClick={clearResults}
                >
                  Clear
                </button>
              </div>
            </>
          )}

          {/* Last scan result (if no transaction found) */}
          {lastScanResult && !transactionData && !error && (
            <div style={styles.transactionInfo}>
              <div style={styles.transactionRow}>
                <span style={styles.transactionLabel}>Scanned:</span>
                <span style={styles.transactionValue}>
                  {lastScanResult.length > 30 ? 
                    `${lastScanResult.slice(0, 30)}...` : 
                    lastScanResult}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QRCodeScanHandler;
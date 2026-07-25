// components/POS/TransactionsModal.jsx - Step 98 Implementation
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { TavariStyles } from '../../utils/TavariStyles';
import { logAction } from '../../helpers/posAudit';
import dayjs from 'dayjs';
import { buildSaleAttributionDisplay } from '../../utils/posSaleAttribution';

/**
 * TransactionsModal - Step 98: Create TransactionsModal.jsx for lookup by receipt # or QR code
 * Allows employees to search for and view past transactions for refunds, reprints, or inquiries
 */
const TransactionsModal = ({ 
  isOpen, 
  onClose, 
  onTransactionFound = null,
  searchMode = 'both', // 'receipt', 'qr', or 'both'
  title = 'Transaction Lookup'
}) => {
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'TransactionsModal'
  });

  const { calculateTotalTax } = useTaxCalculations(auth.selectedBusinessId);

  // State management
  const [searchValue, setSearchValue] = useState('');
  const [searchType, setSearchType] = useState('receipt'); // 'receipt' or 'qr'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showTransactionDetails, setShowTransactionDetails] = useState(false);
  const [qrScannerActive, setQrScannerActive] = useState(false);

  // Refs for QR scanner
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const styles = {
    overlay: {
      ...TavariStyles.components.modal.overlay,
      display: isOpen ? 'flex' : 'none'
    },
    
    modal: {
      ...TavariStyles.components.modal.content,
      maxWidth: showTransactionDetails ? '800px' : '600px',
      maxHeight: '90vh'
    },
    
    header: {
      ...TavariStyles.components.modal.header
    },
    
    body: {
      ...TavariStyles.components.modal.body,
      maxHeight: '70vh',
      overflowY: 'auto'
    },
    
    footer: {
      ...TavariStyles.components.modal.footer
    },
    
    searchSection: {
      marginBottom: TavariStyles.spacing.xl
    },
    
    searchTypeToggle: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.lg
    },
    
    toggleButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1
    },
    
    toggleButtonActive: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1
    },
    
    toggleButtonInactive: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1
    },
    
    searchInput: {
      ...TavariStyles.components.form.input,
      fontSize: TavariStyles.typography.fontSize.lg,
      textAlign: 'center',
      fontFamily: TavariStyles.typography.fontFamilyMono
    },
    
    searchButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      marginTop: TavariStyles.spacing.lg
    },
    
    qrSection: {
      marginTop: TavariStyles.spacing.lg,
      textAlign: 'center'
    },
    
    qrButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md
    },
    
    qrVideo: {
      width: '100%',
      maxWidth: '400px',
      height: 'auto',
      borderRadius: TavariStyles.borderRadius.lg,
      border: `2px solid ${TavariStyles.colors.primary}`,
      marginTop: TavariStyles.spacing.md
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg
    },
    
    successBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.success,
      marginBottom: TavariStyles.spacing.lg
    },
    
    resultsSection: {
      marginTop: TavariStyles.spacing.xl
    },
    
    resultsTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray800
    },
    
    transactionCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.md,
      cursor: 'pointer',
      transition: TavariStyles.transitions.normal,
      border: `2px solid ${TavariStyles.colors.gray200}`
    },
    
    transactionCardHover: {
      borderColor: TavariStyles.colors.primary,
      boxShadow: TavariStyles.shadows.md
    },
    
    transactionHeader: {
      ...TavariStyles.layout.flexBetween,
      marginBottom: TavariStyles.spacing.sm
    },
    
    receiptNumber: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      fontFamily: TavariStyles.typography.fontFamilyMono
    },
    
    transactionDate: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    
    transactionInfo: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    infoLabel: {
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    infoValue: {
      color: TavariStyles.colors.gray800,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    
    transactionTotal: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      textAlign: 'right',
      marginTop: TavariStyles.spacing.sm
    },
    
    detailsSection: {
      marginTop: TavariStyles.spacing.xl
    },
    
    detailsGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl
    },
    
    detailsCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg
    },
    
    detailsTitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray800
    },
    
    itemsList: {
      maxHeight: '300px',
      overflowY: 'auto',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.md
    },
    
    itemRow: {
      padding: TavariStyles.spacing.sm,
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    
    itemInfo: {
      flex: 1
    },
    
    itemName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800
    },
    
    itemDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    
    itemPrice: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    actionButtons: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xl
    },
    
    primaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      flex: 1
    },
    
    secondaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      flex: 1
    },
    
    closeButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary
    },
    
    loading: {
      ...TavariStyles.components.loading.container,
      height: '200px'
    },
    
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray500
    }
  };

  useEffect(() => {
    return () => {
      stopQrScanner();
    };
  }, []);

  const searchTransactions = async () => {
    if (!searchValue.trim()) {
      setError('Please enter a receipt number or QR code');
      return;
    }

    setLoading(true);
    setError(null);
    setTransactions([]);

    try {
      console.log(`TransactionsModal: Searching for transactions with ${searchType}: ${searchValue}`);

      let query = supabase
        .from('pos_sales')
        .select(`
          *,
          pos_sale_items (
            *,
            inventory (name, price, sku)
          ),
          pos_payments (*)
        `)
        .eq('business_id', auth.selectedBusinessId);

      // Search by receipt number or QR code
      if (searchType === 'receipt') {
        query = query.eq('sale_number', searchValue.toUpperCase());
      } else if (searchType === 'qr') {
        query = query.eq('qr_code', searchValue);
      }

      const { data: salesData, error: salesError } = await query
        .order('created_at', { ascending: false })
        .limit(10);

      if (salesError) throw salesError;

      console.log(`TransactionsModal: Found ${salesData?.length || 0} transactions`);

      const userIds = [
        ...new Set(
          (salesData || [])
            .flatMap((sale) => [sale.user_id, sale.operator_user_id, sale.login_user_id])
            .filter(Boolean)
        )
      ];

      let usersById = {};
      if (userIds.length > 0) {
        const { data: userRows, error: usersError } = await supabase
          .from('users')
          .select('id, full_name, email')
          .in('id', userIds);

        if (usersError) throw usersError;

        usersById = (userRows || []).reduce((acc, user) => {
          acc[user.id] = user;
          return acc;
        }, {});
      }

      // Process transaction data
      const processedTransactions = (salesData || []).map(sale => {
        const items = sale.pos_sale_items || [];
        const payments = sale.pos_payments || [];
        const attribution = buildSaleAttributionDisplay(sale, usersById);

        const subtotal = items.reduce((sum, item) => {
          return sum + ((item.price || item.unit_price || 0) * (item.quantity || 0));
        }, 0);

        const totalTax = sale.tax || sale.tax_amount || 0;
        const total = sale.total || sale.total_amount || (subtotal + totalTax);

        return {
          id: sale.id,
          receiptNumber: sale.sale_number,
          qrCode: sale.qr_code,
          date: sale.created_at,
          customerName: sale.customer_name || 'Walk-in',
          customerPhone: sale.customer_phone,
          cashierName: attribution.displayName,
          cashierDisplay: attribution.displayWithContext,
          loginUserName: attribution.loginUserName,
          showDualAttribution: attribution.showBoth,
          items,
          payments,
          subtotal,
          totalTax,
          total,
          status: sale.status,
          refunded: sale.refunded_amount > 0,
          refundedAmount: sale.refunded_amount || 0,
          rawSale: sale
        };
      });

      setTransactions(processedTransactions);

      // Log successful search
      await logAction({
        action: 'transaction_searched',
        context: 'TransactionsModal',
        metadata: {
          business_id: auth.selectedBusinessId,
          search_type: searchType,
          search_value: searchValue,
          results_found: processedTransactions.length,
          user_role: auth.userRole
        }
      });

      if (processedTransactions.length === 0) {
        setError(`No transactions found for ${searchType}: ${searchValue}`);
      }

    } catch (err) {
      console.error('TransactionsModal: Error searching transactions:', err);
      setError(`Failed to search transactions: ${err.message}`);
      
      await logAction({
        action: 'transaction_search_error',
        context: 'TransactionsModal',
        metadata: {
          business_id: auth.selectedBusinessId,
          search_type: searchType,
          search_value: searchValue,
          error: err.message,
          user_role: auth.userRole
        }
      });
    } finally {
      setLoading(false);
    }
  };

  const startQrScanner = async () => {
    try {
      console.log('TransactionsModal: Starting QR scanner');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setQrScannerActive(true);
      }
    } catch (err) {
      console.error('TransactionsModal: Error starting QR scanner:', err);
      setError('Unable to access camera for QR scanning');
    }
  };

  const stopQrScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setQrScannerActive(false);
  };

  const handleTransactionSelect = (transaction) => {
    setSelectedTransaction(transaction);
    setShowTransactionDetails(true);

    logAction({
      action: 'transaction_viewed',
      context: 'TransactionsModal',
      metadata: {
        business_id: auth.selectedBusinessId,
        transaction_id: transaction.id,
        receipt_number: transaction.receiptNumber,
        user_role: auth.userRole
      }
    });
  };

  const handleTransactionAction = (action, transaction) => {
    if (onTransactionFound) {
      onTransactionFound(action, transaction);
    }
    onClose();
  };

  const renderSearchSection = () => (
    <div style={styles.searchSection}>
      {searchMode === 'both' && (
        <div style={styles.searchTypeToggle}>
          <button
            style={searchType === 'receipt' ? styles.toggleButtonActive : styles.toggleButtonInactive}
            onClick={() => setSearchType('receipt')}
          >
            Receipt Number
          </button>
          <button
            style={searchType === 'qr' ? styles.toggleButtonActive : styles.toggleButtonInactive}
            onClick={() => setSearchType('qr')}
          >
            QR Code
          </button>
        </div>
      )}

      <input
        type="text"
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        placeholder={searchType === 'receipt' ? 'Enter receipt number (e.g., R001234)' : 'Enter QR code'}
        style={styles.searchInput}
        onKeyPress={(e) => e.key === 'Enter' && searchTransactions()}
      />

      <button
        style={styles.searchButton}
        onClick={searchTransactions}
        disabled={loading || !searchValue.trim()}
      >
        {loading ? 'Searching...' : `Search by ${searchType === 'receipt' ? 'Receipt Number' : 'QR Code'}`}
      </button>

      {searchType === 'qr' && (
        <div style={styles.qrSection}>
          <button
            style={styles.qrButton}
            onClick={qrScannerActive ? stopQrScanner : startQrScanner}
          >
            {qrScannerActive ? 'Stop Scanner' : 'Scan QR Code'}
          </button>

          {qrScannerActive && (
            <video
              ref={videoRef}
              style={styles.qrVideo}
              autoPlay
              playsInline
            />
          )}
        </div>
      )}
    </div>
  );

  const renderTransactionsList = () => (
    <div style={styles.resultsSection}>
      <h3 style={styles.resultsTitle}>Search Results ({transactions.length})</h3>
      
      {transactions.map((transaction) => (
        <div
          key={transaction.id}
          style={styles.transactionCard}
          onClick={() => handleTransactionSelect(transaction)}
          onMouseEnter={(e) => {
            e.target.style.borderColor = TavariStyles.colors.primary;
            e.target.style.boxShadow = TavariStyles.shadows.md;
          }}
          onMouseLeave={(e) => {
            e.target.style.borderColor = TavariStyles.colors.gray200;
            e.target.style.boxShadow = 'none';
          }}
        >
          <div style={styles.transactionHeader}>
            <div style={styles.receiptNumber}>
              #{transaction.receiptNumber}
            </div>
            <div style={styles.transactionDate}>
              {dayjs(transaction.date).format('MMM D, YYYY h:mm A')}
            </div>
          </div>

          <div style={styles.transactionInfo}>
            <div>
              <span style={styles.infoLabel}>Customer:</span><br/>
              <span style={styles.infoValue}>{transaction.customerName}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>Cashier:</span><br/>
              <span style={styles.infoValue}>{transaction.cashierName}</span>
              {transaction.showDualAttribution && (
                <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500 }}>
                  Logged in as {transaction.loginUserName}
                </div>
              )}
            </div>
            <div>
              <span style={styles.infoLabel}>Items:</span><br/>
              <span style={styles.infoValue}>{transaction.items.length}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>Status:</span><br/>
              <span style={{
                ...styles.infoValue,
                color: transaction.refunded ? TavariStyles.colors.warning : TavariStyles.colors.success
              }}>
                {transaction.refunded ? 'Partially Refunded' : 'Completed'}
              </span>
            </div>
          </div>

          <div style={styles.transactionTotal}>
            ${transaction.total.toFixed(2)}
            {transaction.refunded && (
              <span style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.warning }}>
                (-${transaction.refundedAmount.toFixed(2)} refunded)
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const renderTransactionDetails = () => {
    if (!selectedTransaction) return null;

    return (
      <div style={styles.detailsSection}>
        <div style={styles.detailsGrid}>
          <div style={styles.detailsCard}>
            <h4 style={styles.detailsTitle}>Transaction Details</h4>
            <div style={styles.transactionInfo}>
              <div>
                <span style={styles.infoLabel}>Receipt #:</span><br/>
                <span style={styles.infoValue}>{selectedTransaction.receiptNumber}</span>
              </div>
              <div>
                <span style={styles.infoLabel}>Date:</span><br/>
                <span style={styles.infoValue}>{dayjs(selectedTransaction.date).format('MMM D, YYYY h:mm A')}</span>
              </div>
              <div>
                <span style={styles.infoLabel}>Customer:</span><br/>
                <span style={styles.infoValue}>{selectedTransaction.customerName}</span>
              </div>
              <div>
                <span style={styles.infoLabel}>Phone:</span><br/>
                <span style={styles.infoValue}>{selectedTransaction.customerPhone || 'N/A'}</span>
              </div>
              <div>
                <span style={styles.infoLabel}>Cashier:</span><br/>
                <span style={styles.infoValue}>{selectedTransaction.cashierName}</span>
                {selectedTransaction.showDualAttribution && (
                  <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500 }}>
                    Logged in as {selectedTransaction.loginUserName}
                  </div>
                )}
              </div>
              <div>
                <span style={styles.infoLabel}>Status:</span><br/>
                <span style={styles.infoValue}>{selectedTransaction.status}</span>
              </div>
            </div>
          </div>

          <div style={styles.detailsCard}>
            <h4 style={styles.detailsTitle}>Payment Summary</h4>
            <div style={styles.transactionInfo}>
              <div>
                <span style={styles.infoLabel}>Subtotal:</span><br/>
                <span style={styles.infoValue}>${selectedTransaction.subtotal.toFixed(2)}</span>
              </div>
              <div>
                <span style={styles.infoLabel}>Tax:</span><br/>
                <span style={styles.infoValue}>${selectedTransaction.totalTax.toFixed(2)}</span>
              </div>
              <div>
                <span style={styles.infoLabel}>Total:</span><br/>
                <span style={styles.infoValue}>${selectedTransaction.total.toFixed(2)}</span>
              </div>
              {selectedTransaction.refunded && (
                <div>
                  <span style={styles.infoLabel}>Refunded:</span><br/>
                  <span style={{ ...styles.infoValue, color: TavariStyles.colors.warning }}>
                    ${selectedTransaction.refundedAmount.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={styles.detailsCard}>
          <h4 style={styles.detailsTitle}>Items Purchased ({selectedTransaction.items.length})</h4>
          <div style={styles.itemsList}>
            {selectedTransaction.items.map((item, index) => (
              <div key={index} style={styles.itemRow}>
                <div style={styles.itemInfo}>
                  <div style={styles.itemName}>
                    {item.inventory?.name || item.item_name}
                  </div>
                  <div style={styles.itemDetails}>
                    Qty: {item.quantity} × ${item.price.toFixed(2)}
                    {item.inventory?.sku && ` | SKU: ${item.inventory.sku}`}
                  </div>
                </div>
                <div style={styles.itemPrice}>
                  ${(item.price * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.actionButtons}>
          <button
            style={styles.secondaryButton}
            onClick={() => handleTransactionAction('reprint', selectedTransaction)}
          >
            Reprint Receipt
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => handleTransactionAction('refund', selectedTransaction)}
          >
            Process Refund
          </button>
          <button
            style={styles.primaryButton}
            onClick={() => setShowTransactionDetails(false)}
          >
            Back to Search
          </button>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3>{showTransactionDetails ? `Transaction ${selectedTransaction?.receiptNumber}` : title}</h3>
          <button
            style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div style={styles.body}>
          {error && (
            <div style={styles.errorBanner}>
              {error}
            </div>
          )}

          {loading && (
            <div style={styles.loading}>
              <div style={TavariStyles.components.loading.spinner}></div>
              <div>Searching transactions...</div>
              <style>{TavariStyles.keyframes.spin}</style>
            </div>
          )}

          {!showTransactionDetails && !loading && (
            <>
              {renderSearchSection()}
              {transactions.length > 0 && renderTransactionsList()}
              {transactions.length === 0 && searchValue && !error && (
                <div style={styles.emptyState}>
                  <p>No transactions found matching your search criteria.</p>
                  <p>Try searching with a different receipt number or QR code.</p>
                </div>
              )}
            </>
          )}

          {showTransactionDetails && renderTransactionDetails()}
        </div>

        {!showTransactionDetails && (
          <div style={styles.footer}>
            <button style={styles.closeButton} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionsModal;
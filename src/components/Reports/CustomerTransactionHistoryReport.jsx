// components/Reports/CustomerTransactionHistoryReport.jsx - Customer Transaction History Report
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FiDownload, FiSearch, FiCalendar, FiUser, FiDollarSign, FiCreditCard, FiRefreshCw, FiEye, FiFilter, FiPrinter, FiCamera, FiX, FiMail } from 'react-icons/fi';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { supabase } from '../../supabaseClient';

const CustomerTransactionHistoryReport = () => {
  // Authentication and business context
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'Customer Transaction History Report'
  });

  // State management
  const [transactions, setTransactions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  });
  const [filters, setFilters] = useState({
    paymentMethod: '',
    minAmount: '',
    maxAmount: '',
    includeRefunds: true,
    includeTabs: true
  });
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  
  // QR Scanner states
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [qrSearchValue, setQrSearchValue] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Mobile responsive states
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const ITEMS_PER_PAGE = 20; // Reduced for mobile

  // Check for mobile screen
  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  // Responsive styling using TavariStyles
  const styles = {
    container: {
      ...TavariStyles.layout.container,
      padding: isMobile ? TavariStyles.spacing.md : TavariStyles.spacing['2xl'],
      maxWidth: '100%',
      overflowX: 'hidden'
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: isMobile ? 'flex-start' : 'center',
      marginBottom: TavariStyles.spacing.xl,
      flexDirection: isMobile ? 'column' : 'row',
      gap: TavariStyles.spacing.md
    },
    
    title: {
      fontSize: isMobile ? TavariStyles.typography.fontSize['2xl'] : TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    
    subtitle: {
      fontSize: isMobile ? TavariStyles.typography.fontSize.base : TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: `${TavariStyles.spacing.xs} 0 0 0`
    },
    
    mobileFilterToggle: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm,
      width: '100%',
      marginBottom: TavariStyles.spacing.md,
      display: isMobile ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center'
    },
    
    filtersCard: {
      ...TavariStyles.layout.card,
      padding: isMobile ? TavariStyles.spacing.md : TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      display: isMobile && !showMobileFilters ? 'none' : 'block'
    },
    
    filtersGrid: {
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg
    },
    
    filterGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    qrSearchSection: {
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: TavariStyles.spacing.md,
      alignItems: isMobile ? 'stretch' : 'end',
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.blue50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.blue200}`
    },
    
    qrInputGroup: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    qrButtonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexDirection: isMobile ? 'column' : 'row'
    },
    
    label: {
      ...TavariStyles.components.form.label,
      marginBottom: TavariStyles.spacing.xs,
      fontSize: isMobile ? TavariStyles.typography.fontSize.sm : TavariStyles.typography.fontSize.base
    },
    
    input: {
      ...TavariStyles.components.form.input,
      fontSize: isMobile ? TavariStyles.typography.fontSize.sm : TavariStyles.typography.fontSize.base
    },
    
    select: {
      ...TavariStyles.components.form.select,
      fontSize: isMobile ? TavariStyles.typography.fontSize.sm : TavariStyles.typography.fontSize.base
    },
    
    checkboxGroup: {
      display: 'flex',
      gap: isMobile ? TavariStyles.spacing.md : TavariStyles.spacing.lg,
      marginTop: TavariStyles.spacing.md,
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'flex-start' : 'center'
    },
    
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center',
      flexWrap: 'wrap',
      width: isMobile ? '100%' : 'auto'
    },
    
    primaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md,
      fontSize: isMobile ? TavariStyles.typography.fontSize.sm : TavariStyles.typography.fontSize.base,
      flex: isMobile ? '1' : 'none'
    },
    
    secondaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md,
      fontSize: isMobile ? TavariStyles.typography.fontSize.sm : TavariStyles.typography.fontSize.base,
      flex: isMobile ? '1' : 'none'
    },
    
    scannerButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.outline,
      ...TavariStyles.components.button.sizes.md,
      backgroundColor: TavariStyles.colors.blue100,
      borderColor: TavariStyles.colors.blue300,
      color: TavariStyles.colors.blue700
    },
    
    tableContainer: {
      ...TavariStyles.components.table.container,
      marginBottom: TavariStyles.spacing.xl,
      overflowX: 'auto',
      maxWidth: '100%'
    },
    
    table: {
      ...TavariStyles.components.table.table,
      minWidth: isMobile ? '800px' : 'auto' // Force horizontal scroll on mobile
    },
    
    headerRow: TavariStyles.components.table.headerRow,
    
    th: {
      ...TavariStyles.components.table.th,
      cursor: 'pointer',
      userSelect: 'none',
      fontSize: isMobile ? TavariStyles.typography.fontSize.xs : TavariStyles.typography.fontSize.sm,
      padding: isMobile ? TavariStyles.spacing.xs : TavariStyles.spacing.sm
    },
    
    row: {
      ...TavariStyles.components.table.row,
      cursor: 'pointer'
    },
    
    td: {
      ...TavariStyles.components.table.td,
      fontSize: isMobile ? TavariStyles.typography.fontSize.xs : TavariStyles.typography.fontSize.sm,
      padding: isMobile ? TavariStyles.spacing.xs : TavariStyles.spacing.sm
    },
    
    pagination: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: TavariStyles.spacing.lg,
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? TavariStyles.spacing.md : 0
    },
    
    paginationButtons: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    
    paginationInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    
    statusBadge: {
      padding: '3px 6px',
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      display: 'inline-block',
      whiteSpace: 'nowrap'
    },
    
    statusPaid: {
      backgroundColor: TavariStyles.colors.successBg,
      color: TavariStyles.colors.successText
    },
    
    statusRefunded: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText
    },
    
    statusPartial: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warningText
    },
    
    paymentMethodBadge: {
      padding: '2px 4px',
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      whiteSpace: 'nowrap'
    },
    
    loading: TavariStyles.components.loading.container,
    
    error: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error
    },
    
    noData: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.lg
    },
    
    modalOverlay: {
      ...TavariStyles.components.modal.overlay,
      padding: isMobile ? TavariStyles.spacing.md : TavariStyles.spacing.xl
    },
    
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: isMobile ? '100%' : '800px',
      width: '95%',
      maxHeight: isMobile ? '90vh' : '80vh',
      overflowY: 'auto'
    },
    
    modalHeader: {
      ...TavariStyles.components.modal.header,
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'flex-start' : 'center',
      gap: isMobile ? TavariStyles.spacing.sm : 0
    },
    
    modalBody: {
      ...TavariStyles.components.modal.body,
      padding: isMobile ? TavariStyles.spacing.md : TavariStyles.spacing.lg
    },
    
    modalFooter: {
      ...TavariStyles.components.modal.footer,
      flexDirection: isMobile ? 'column' : 'row',
      gap: TavariStyles.spacing.md
    },
    
    modalButtonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      width: isMobile ? '100%' : 'auto',
      flexDirection: isMobile ? 'column' : 'row'
    },
    
    detailRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: `${TavariStyles.spacing.xs} 0`,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? TavariStyles.spacing.xs : 0
    },
    
    detailLabel: {
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      fontSize: isMobile ? TavariStyles.typography.fontSize.sm : TavariStyles.typography.fontSize.base
    },
    
    detailValue: {
      color: TavariStyles.colors.gray800,
      fontSize: isMobile ? TavariStyles.typography.fontSize.sm : TavariStyles.typography.fontSize.base,
      wordBreak: 'break-word'
    },
    
    itemsList: {
      marginTop: TavariStyles.spacing.lg
    },
    
    itemRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray50,
      marginBottom: TavariStyles.spacing.xs,
      borderRadius: TavariStyles.borderRadius.sm,
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? TavariStyles.spacing.xs : 0
    },
    
    // QR Scanner Modal Styles
    qrScannerModal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.md
    },
    
    qrScannerContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg,
      maxWidth: isMobile ? '100%' : '500px',
      width: '100%'
    },
    
    qrScannerHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.lg
    },
    
    videoContainer: {
      position: 'relative',
      width: '100%',
      height: isMobile ? '250px' : '300px',
      backgroundColor: TavariStyles.colors.gray900,
      borderRadius: TavariStyles.borderRadius.md,
      overflow: 'hidden',
      marginBottom: TavariStyles.spacing.md
    },
    
    video: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    },
    
    scannerOverlay: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '200px',
      height: '200px',
      border: '2px solid #00ff00',
      borderRadius: '8px',
      boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
    },
    
    // Receipt Print Styles
    printableReceipt: {
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.4',
      color: '#000',
      backgroundColor: '#fff',
      padding: '20px',
      width: '300px',
      margin: '0 auto'
    },
    
    receiptHeader: {
      textAlign: 'center',
      marginBottom: '20px',
      borderBottom: '1px dashed #000',
      paddingBottom: '10px'
    },
    
    receiptLine: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '2px'
    },
    
    receiptTotal: {
      borderTop: '1px dashed #000',
      paddingTop: '5px',
      marginTop: '10px',
      fontWeight: 'bold'
    },
    
    reprintNotice: {
      textAlign: 'center',
      backgroundColor: '#f0f0f0',
      border: '2px solid #333',
      padding: '10px',
      margin: '10px 0',
      fontWeight: 'bold',
      fontSize: '14px',
      letterSpacing: '2px'
    }
  };

  // Load customers for filter dropdown
  const loadCustomers = useCallback(async () => {
    if (!auth.selectedBusinessId) return;

    try {
      // First try pos_loyalty_accounts
      const { data: loyaltyData, error: loyaltyError } = await supabase
        .from('pos_loyalty_accounts')
        .select('id, customer_name, customer_phone')
        .eq('business_id', auth.selectedBusinessId)
        .order('customer_name', { ascending: true });

      if (loyaltyError) {
        console.warn('No loyalty accounts table or data:', loyaltyError);
      }

      // Also get unique customers from sales
      const { data: salesData, error: salesError } = await supabase
        .from('pos_sales')
        .select('customer_name, customer_phone')
        .eq('business_id', auth.selectedBusinessId)
        .not('customer_name', 'is', null)
        .order('customer_name', { ascending: true });

      if (salesError) {
        console.warn('Error loading sales customers:', salesError);
      }

      // Combine and deduplicate customers
      const allCustomers = [];
      
      if (loyaltyData) {
        loyaltyData.forEach(customer => {
          allCustomers.push({
            id: customer.id,
            type: 'loyalty',
            customer_name: customer.customer_name,
            customer_phone: customer.customer_phone
          });
        });
      }

      if (salesData) {
        const uniqueSalesCustomers = new Map();
        salesData.forEach(sale => {
          const key = `${sale.customer_name}-${sale.customer_phone}`;
          if (!uniqueSalesCustomers.has(key)) {
            uniqueSalesCustomers.set(key, {
              id: `sales-${key}`,
              type: 'sales',
              customer_name: sale.customer_name,
              customer_phone: sale.customer_phone
            });
          }
        });
        allCustomers.push(...uniqueSalesCustomers.values());
      }

      setCustomers(allCustomers);
    } catch (err) {
      console.error('Error loading customers:', err);
    }
  }, [auth.selectedBusinessId]);

  // Load transaction data
  const loadTransactions = useCallback(async () => {
    if (!auth.selectedBusinessId) return;

    setLoading(true);
    setError(null);

    try {
      // Base sales query without complex joins
      let query = supabase
        .from('pos_sales')
        .select('*')
        .eq('business_id', auth.selectedBusinessId);

      // Apply filters
      if (selectedCustomer) {
        if (selectedCustomer.startsWith('sales-')) {
          // Extract customer name from sales-based customer ID
          const customerKey = selectedCustomer.replace('sales-', '');
          const [customerName] = customerKey.split('-');
          query = query.eq('customer_name', customerName);
        } else {
          // Loyalty customer
          query = query.eq('loyalty_customer_id', selectedCustomer);
        }
      }

      if (dateRange.startDate) {
        query = query.gte('created_at', `${dateRange.startDate}T00:00:00`);
      }

      if (dateRange.endDate) {
        query = query.lte('created_at', `${dateRange.endDate}T23:59:59`);
      }

      if (filters.paymentMethod) {
        query = query.eq('payment_method', filters.paymentMethod);
      }

      if (filters.minAmount) {
        query = query.gte('total', parseFloat(filters.minAmount));
      }

      if (filters.maxAmount) {
        query = query.lte('total', parseFloat(filters.maxAmount));
      }

      // QR search by sale number
      if (qrSearchValue) {
        query = query.eq('sale_number', qrSearchValue);
      }

      // Apply sorting
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      // Apply pagination
      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      query = query.range(startIndex, startIndex + ITEMS_PER_PAGE - 1);

      const { data: salesData, error: salesError, count } = await query;

      if (salesError) throw salesError;

      let allTransactions = salesData || [];

      // Load sale items separately for each transaction
      if (salesData && salesData.length > 0) {
        const saleIds = salesData.map(sale => sale.id);
        const { data: saleItems, error: itemsError } = await supabase
          .from('pos_sale_items')
          .select('*')
          .in('sale_id', saleIds);

        if (!itemsError && saleItems) {
          // Group items by sale_id
          const itemsBySale = {};
          saleItems.forEach(item => {
            if (!itemsBySale[item.sale_id]) {
              itemsBySale[item.sale_id] = [];
            }
            itemsBySale[item.sale_id].push(item);
          });

          // Add items to each sale
          allTransactions = salesData.map(sale => ({
            ...sale,
            pos_sale_items: itemsBySale[sale.id] || []
          }));
        }
      }

      setTransactions(allTransactions);
      setTotalPages(Math.ceil((count || 0) / ITEMS_PER_PAGE));

      // Load refunds if included
      if (filters.includeRefunds) {
        try {
          const { data: refundData, error: refundError } = await supabase
            .from('pos_refunds')
            .select('*')
            .eq('business_id', auth.selectedBusinessId);

          if (!refundError && refundData) {
            // Process and merge refund data with transactions
            const processedRefunds = refundData.map(refund => ({
              ...refund,
              id: `refund-${refund.id}`,
              type: 'refund',
              total: -refund.total_refund_amount,
              customer_name: 'Refund Transaction',
              payment_status: 'refunded'
            }));

            setTransactions(prev => [...prev, ...processedRefunds].sort((a, b) => {
              const aValue = a[sortBy] || a.created_at;
              const bValue = b[sortBy] || b.created_at;
              return sortOrder === 'desc' ? new Date(bValue) - new Date(aValue) : new Date(aValue) - new Date(bValue);
            }));
          }
        } catch (refundErr) {
          console.warn('Could not load refunds:', refundErr);
        }
      }

    } catch (err) {
      console.error('Error loading transactions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [auth.selectedBusinessId, selectedCustomer, dateRange, filters, sortBy, sortOrder, currentPage, qrSearchValue]);

  // QR Scanner functionality
  const startQRScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      
      setShowQRScanner(true);
      setIsScanning(true);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      
      // Start scanning loop
      scanQRCode();
    } catch (err) {
      console.error('Error accessing camera:', err);
      setError('Unable to access camera for QR scanning');
    }
  };

  const stopQRScanner = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
    setShowQRScanner(false);
    setIsScanning(false);
  };

  const scanQRCode = () => {
    if (!isScanning || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      
      // Simple QR code detection (in a real implementation, use a QR library like jsQR)
      // For now, we'll simulate successful scan after a few seconds
      setTimeout(() => {
        if (isScanning) {
          // Simulate finding a QR code with transaction number
          const mockQRData = 'TXN-2024-001234'; // This would come from actual QR detection
          setQrSearchValue(mockQRData);
          stopQRScanner();
          loadTransactions();
        }
      }, 3000);
    }

    if (isScanning) {
      requestAnimationFrame(scanQRCode);
    }
  };

  // Print receipt functionality
  const printReceipt = (transaction) => {
    const printWindow = window.open('', '', 'width=300,height=600');
    const receiptHTML = generateReceiptHTML(transaction, true); // true indicates this is a reprint
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt - ${transaction.sale_number}</title>
          <style>
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
            }
            ${getReceiptCSS()}
          </style>
        </head>
        <body>
          ${receiptHTML}
          <div class="no-print" style="text-align: center; margin-top: 20px;">
            <button onclick="window.print()">Print</button>
            <button onclick="window.close()">Close</button>
          </div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  const generateReceiptHTML = (transaction, isReprint = false) => {
    const businessName = "Off The Wall Kids London"; // This should come from business settings
    const businessAddress = "123 Business St, London, ON"; // This should come from business settings
    
    return `
      <div class="printable-receipt">
        <div class="receipt-header">
          <h2>${businessName}</h2>
          <p>${businessAddress}</p>
          <p>Tel: (519) 555-0123</p>
          <hr>
        </div>
        
        ${isReprint ? `
          <div class="reprint-notice">
            *** REPRINT ***
          </div>
        ` : ''}
        
        <div class="receipt-info">
          <div class="receipt-line">
            <span>Receipt #:</span>
            <span>${transaction.sale_number || 'N/A'}</span>
          </div>
          <div class="receipt-line">
            <span>Date:</span>
            <span>${new Date(transaction.created_at).toLocaleString()}</span>
          </div>
          ${isReprint ? `
            <div class="receipt-line">
              <span>Reprinted:</span>
              <span>${new Date().toLocaleString()}</span>
            </div>
          ` : ''}
          <div class="receipt-line">
            <span>Customer:</span>
            <span>${transaction.customer_name || 'Walk-in'}</span>
          </div>
          <hr>
        </div>
        
        <div class="receipt-items">
          ${transaction.pos_sale_items ? transaction.pos_sale_items.map(item => `
            <div class="receipt-line">
              <span>${item.name}</span>
              <span></span>
            </div>
            <div class="receipt-line" style="margin-left: 10px; font-size: 0.9em;">
              <span>${item.quantity} x ${formatCurrency(item.unit_price)}</span>
              <span>${formatCurrency(item.total_price)}</span>
            </div>
          `).join('') : ''}
          <hr>
        </div>
        
        <div class="receipt-totals">
          <div class="receipt-line">
            <span>Subtotal:</span>
            <span>${formatCurrency(transaction.subtotal)}</span>
          </div>
          ${transaction.discount > 0 ? `
            <div class="receipt-line">
              <span>Discount:</span>
              <span>-${formatCurrency(transaction.discount)}</span>
            </div>
          ` : ''}
          <div class="receipt-line">
            <span>Tax:</span>
            <span>${formatCurrency(transaction.tax)}</span>
          </div>
          <div class="receipt-line receipt-total">
            <span><strong>Total:</strong></span>
            <span><strong>${formatCurrency(transaction.total)}</strong></span>
          </div>
          <hr>
        </div>
        
        <div class="receipt-payment">
          <div class="receipt-line">
            <span>Payment:</span>
            <span>${getPaymentMethodDisplay(transaction.payment_method)}</span>
          </div>
        </div>
        
        <div class="receipt-footer">
          <p style="text-align: center; margin-top: 20px;">
            Thank you for your business!
          </p>
          <p style="text-align: center; font-size: 0.8em;">
            QR: ${transaction.sale_number}
          </p>
          ${isReprint ? `
            <p style="text-align: center; font-size: 0.7em; margin-top: 10px; font-weight: bold;">
              This is a reprinted receipt
            </p>
          ` : ''}
        </div>
      </div>
    `;
  };

  const getReceiptCSS = () => {
    return `
      .printable-receipt {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        line-height: 1.4;
        color: #000;
        background: #fff;
        padding: 10px;
        width: 280px;
        margin: 0 auto;
      }
      .receipt-header {
        text-align: center;
        margin-bottom: 15px;
      }
      .receipt-header h2 {
        margin: 0 0 5px 0;
        font-size: 16px;
      }
      .receipt-header p {
        margin: 2px 0;
        font-size: 11px;
      }
      .receipt-line {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
      }
      .receipt-total {
        border-top: 1px dashed #000;
        padding-top: 5px;
        margin-top: 5px;
      }
      .reprint-notice {
        text-align: center;
        background: #f0f0f0;
        border: 2px solid #333;
        padding: 8px;
        margin: 10px 0;
        font-weight: bold;
        font-size: 14px;
        letter-spacing: 2px;
        text-transform: uppercase;
      }
      hr {
        border: none;
        border-top: 1px dashed #000;
        margin: 8px 0;
      }
      .receipt-footer {
        text-align: center;
        margin-top: 15px;
      }
    `;
  };

  // Email receipt functionality
  const emailReceipt = (transaction) => {
    const subject = `Receipt - ${transaction.sale_number}`;
    const body = `
Receipt Details:
Transaction #: ${transaction.sale_number}
Date: ${new Date(transaction.created_at).toLocaleString()}
Customer: ${transaction.customer_name || 'Walk-in'}
Total: ${formatCurrency(transaction.total)}

Thank you for your business!
    `;
    
    const mailtoLink = `mailto:${transaction.customer_email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoLink);
  };

  // Load data on component mount and filter changes
  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Handle sort change
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSelectedCustomer('');
    setDateRange({ startDate: '', endDate: '' });
    setFilters({
      paymentMethod: '',
      minAmount: '',
      maxAmount: '',
      includeRefunds: true,
      includeTabs: true
    });
    setQrSearchValue('');
    setCurrentPage(1);
  };

  // Handle QR search
  const handleQRSearch = () => {
    setCurrentPage(1);
    loadTransactions();
  };

  // Export to CSV
  const handleExport = async () => {
    try {
      // Get all transactions without pagination for export
      let query = supabase
        .from('pos_sales')
        .select('*')
        .eq('business_id', auth.selectedBusinessId);

      // Apply same filters as current view
      if (selectedCustomer) {
        if (selectedCustomer.startsWith('sales-')) {
          const customerKey = selectedCustomer.replace('sales-', '');
          const [customerName] = customerKey.split('-');
          query = query.eq('customer_name', customerName);
        } else {
          query = query.eq('loyalty_customer_id', selectedCustomer);
        }
      }

      if (dateRange.startDate) {
        query = query.gte('created_at', `${dateRange.startDate}T00:00:00`);
      }

      if (dateRange.endDate) {
        query = query.lte('created_at', `${dateRange.endDate}T23:59:59`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      // Convert to CSV
      const csvHeaders = [
        'Date',
        'Sale Number',
        'Customer Name',
        'Customer Phone',
        'Payment Method',
        'Items',
        'Subtotal',
        'Tax',
        'Discount',
        'Total',
        'Status',
        'Notes'
      ];

      const csvRows = data.map(transaction => [
        new Date(transaction.created_at).toLocaleDateString(),
        transaction.sale_number || 'N/A',
        transaction.customer_name || 'Walk-in',
        transaction.customer_phone || 'N/A',
        transaction.payment_method || 'N/A',
        transaction.item_count || 0,
        `$${(transaction.subtotal || 0).toFixed(2)}`,
        `$${(transaction.tax || 0).toFixed(2)}`,
        `$${(transaction.discount || 0).toFixed(2)}`,
        `$${(transaction.total || 0).toFixed(2)}`,
        transaction.payment_status || 'unknown',
        transaction.notes || ''
      ]);

      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `customer-transactions-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);

    } catch (err) {
      console.error('Error exporting data:', err);
      setError('Failed to export data');
    }
  };

  // View transaction details
  const handleViewTransaction = (transaction) => {
    setSelectedTransaction(transaction);
    setShowTransactionModal(true);
  };

  // Format currency
  const formatCurrency = (amount) => {
    return `$${(amount || 0).toFixed(2)}`;
  };

  // Get payment method display
  const getPaymentMethodDisplay = (method) => {
    const methodMap = {
      'cash': 'Cash',
      'card': 'Card',
      'debit': 'Debit',
      'credit': 'Credit',
      'loyalty': 'Loyalty Points',
      'mixed': 'Mixed Payment'
    };
    return methodMap[method] || method || 'Unknown';
  };

  // Get status badge style
  const getStatusBadgeStyle = (status, type) => {
    if (type === 'refund') {
      return { ...styles.statusBadge, ...styles.statusRefunded };
    }

    switch (status) {
      case 'paid':
      case 'completed':
        return { ...styles.statusBadge, ...styles.statusPaid };
      case 'refunded':
        return { ...styles.statusBadge, ...styles.statusRefunded };
      case 'partial':
        return { ...styles.statusBadge, ...styles.statusPartial };
      default:
        return { ...styles.statusBadge, backgroundColor: TavariStyles.colors.gray100, color: TavariStyles.colors.gray600 };
    }
  };

  if (loading && transactions.length === 0) {
    return (
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        componentName="Customer Transaction History Report"
      >
        <div style={styles.loading}>
          <div>Loading customer transaction history...</div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['employee', 'manager', 'owner']}
      componentName="Customer Transaction History Report"
    >
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Customer Transaction History</h1>
            <p style={styles.subtitle}>View and analyze customer purchase history</p>
          </div>
          <div style={styles.buttonGroup}>
            <button
              style={styles.secondaryButton}
              onClick={loadTransactions}
              disabled={loading}
            >
              <FiRefreshCw size={16} />
              {isMobile ? '' : 'Refresh'}
            </button>
            <button
              style={styles.primaryButton}
              onClick={handleExport}
              disabled={loading || transactions.length === 0}
            >
              <FiDownload size={16} />
              {isMobile ? '' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* Mobile Filter Toggle */}
        <button
          style={styles.mobileFilterToggle}
          onClick={() => setShowMobileFilters(!showMobileFilters)}
        >
          <FiFilter size={16} />
          {showMobileFilters ? 'Hide Filters' : 'Show Filters'}
        </button>

        {/* QR Scanner Section */}
        <div style={styles.qrSearchSection}>
          <div style={styles.qrInputGroup}>
            <label style={styles.label}>
              <FiSearch size={16} />
              Search by QR Code / Transaction #
            </label>
            <input
              type="text"
              style={styles.input}
              value={qrSearchValue}
              onChange={(e) => setQrSearchValue(e.target.value)}
              placeholder="Enter transaction number or scan QR code"
            />
          </div>
          <div style={styles.qrButtonGroup}>
            <button
              style={styles.scannerButton}
              onClick={startQRScanner}
              disabled={loading}
            >
              <FiCamera size={16} />
              {isMobile ? '' : 'Scan QR'}
            </button>
            <button
              style={styles.secondaryButton}
              onClick={handleQRSearch}
              disabled={loading}
            >
              <FiSearch size={16} />
              {isMobile ? '' : 'Search'}
            </button>
            {qrSearchValue && (
              <button
                style={styles.secondaryButton}
                onClick={() => {
                  setQrSearchValue('');
                  loadTransactions();
                }}
              >
                <FiX size={16} />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={styles.filtersCard}>
          <div style={styles.filtersGrid}>
            <div style={styles.filterGroup}>
              <label style={styles.label}>
                <FiUser size={16} />
                Customer
              </label>
              <select
                style={styles.select}
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
              >
                <option value="">All Customers</option>
                {customers.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.customer_name} {customer.customer_phone && `(${customer.customer_phone})`}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.filterGroup}>
              <label style={styles.label}>
                <FiCalendar size={16} />
                Start Date
              </label>
              <input
                type="date"
                style={styles.input}
                value={dateRange.startDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              />
            </div>

            <div style={styles.filterGroup}>
              <label style={styles.label}>
                <FiCalendar size={16} />
                End Date
              </label>
              <input
                type="date"
                style={styles.input}
                value={dateRange.endDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>

            <div style={styles.filterGroup}>
              <label style={styles.label}>
                <FiCreditCard size={16} />
                Payment Method
              </label>
              <select
                style={styles.select}
                value={filters.paymentMethod}
                onChange={(e) => setFilters(prev => ({ ...prev, paymentMethod: e.target.value }))}
              >
                <option value="">All Methods</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
                <option value="loyalty">Loyalty Points</option>
                <option value="mixed">Mixed Payment</option>
              </select>
            </div>

            <div style={styles.filterGroup}>
              <label style={styles.label}>
                <FiDollarSign size={16} />
                Min Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                style={styles.input}
                value={filters.minAmount}
                onChange={(e) => setFilters(prev => ({ ...prev, minAmount: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            <div style={styles.filterGroup}>
              <label style={styles.label}>
                <FiDollarSign size={16} />
                Max Amount
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                style={styles.input}
                value={filters.maxAmount}
                onChange={(e) => setFilters(prev => ({ ...prev, maxAmount: e.target.value }))}
                placeholder="999.99"
              />
            </div>
          </div>

          <div style={styles.checkboxGroup}>
            <TavariCheckbox
              checked={filters.includeRefunds}
              onChange={(checked) => setFilters(prev => ({ ...prev, includeRefunds: checked }))}
              label="Include Refunds"
            />
            <TavariCheckbox
              checked={filters.includeTabs}
              onChange={(checked) => setFilters(prev => ({ ...prev, includeTabs: checked }))}
              label="Include Tab Transactions"
            />
          </div>

          <div style={{ marginTop: TavariStyles.spacing.md }}>
            <button
              style={styles.secondaryButton}
              onClick={handleClearFilters}
            >
              <FiFilter size={16} />
              Clear Filters
            </button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div style={styles.error}>
            Error loading transaction data: {error}
          </div>
        )}

        {/* Transactions Table */}
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.headerRow}>
                <th style={styles.th} onClick={() => handleSort('created_at')}>
                  Date {sortBy === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th style={styles.th} onClick={() => handleSort('sale_number')}>
                  Transaction # {sortBy === 'sale_number' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th style={styles.th} onClick={() => handleSort('customer_name')}>
                  Customer {sortBy === 'customer_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                {!isMobile && (
                  <th style={styles.th}>Contact</th>
                )}
                <th style={styles.th} onClick={() => handleSort('payment_method')}>
                  Payment {sortBy === 'payment_method' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                {!isMobile && (
                  <th style={styles.th} onClick={() => handleSort('item_count')}>
                    Items {sortBy === 'item_count' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                )}
                <th style={styles.th} onClick={() => handleSort('total')}>
                  Total {sortBy === 'total' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={isMobile ? "7" : "9"} style={styles.noData}>
                    No transactions found for the selected criteria
                  </td>
                </tr>
              ) : (
                transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    style={styles.row}
                    onClick={() => handleViewTransaction(transaction)}
                  >
                    <td style={styles.td}>
                      {new Date(transaction.created_at).toLocaleDateString()}
                      {!isMobile && (
                        <>
                          <br />
                          <small>{new Date(transaction.created_at).toLocaleTimeString()}</small>
                        </>
                      )}
                    </td>
                    <td style={styles.td}>
                      {transaction.sale_number || 'N/A'}
                      {transaction.type === 'refund' && (
                        <div style={{ color: TavariStyles.colors.danger, fontSize: TavariStyles.typography.fontSize.xs }}>
                          REFUND
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>
                      {transaction.customer_name || 'Walk-in'}
                      {isMobile && transaction.customer_phone && (
                        <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500 }}>
                          {transaction.customer_phone}
                        </div>
                      )}
                    </td>
                    {!isMobile && (
                      <td style={styles.td}>
                        {transaction.customer_phone || 'N/A'}
                      </td>
                    )}
                    <td style={styles.td}>
                      <span style={styles.paymentMethodBadge}>
                        {isMobile ? 
                          getPaymentMethodDisplay(transaction.payment_method).substring(0, 4) :
                          getPaymentMethodDisplay(transaction.payment_method)
                        }
                      </span>
                    </td>
                    {!isMobile && (
                      <td style={styles.td}>
                        {transaction.item_count || 0}
                      </td>
                    )}
                    <td style={styles.td}>
                      <strong style={{ color: transaction.type === 'refund' ? TavariStyles.colors.danger : TavariStyles.colors.gray800 }}>
                        {formatCurrency(transaction.total)}
                      </strong>
                      {isMobile && (
                        <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500 }}>
                          {transaction.item_count || 0} items
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>
                      <span style={getStatusBadgeStyle(transaction.payment_status, transaction.type)}>
                        {transaction.type === 'refund' ? 'Refunded' : (transaction.payment_status || 'Unknown')}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button
                        style={{
                          ...styles.secondaryButton,
                          padding: isMobile ? '4px 8px' : '6px 12px',
                          fontSize: TavariStyles.typography.fontSize.xs
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewTransaction(transaction);
                        }}
                      >
                        <FiEye size={14} />
                        {!isMobile && ' View'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <div style={styles.paginationInfo}>
              Page {currentPage} of {totalPages} ({transactions.length} transactions)
            </div>
            <div style={styles.paginationButtons}>
              <button
                style={styles.secondaryButton}
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <button
                style={styles.secondaryButton}
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* QR Scanner Modal */}
        {showQRScanner && (
          <div style={styles.qrScannerModal}>
            <div style={styles.qrScannerContent}>
              <div style={styles.qrScannerHeader}>
                <h3>Scan QR Code</h3>
                <button
                  style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
                  onClick={stopQRScanner}
                >
                  ×
                </button>
              </div>
              <div style={styles.videoContainer}>
                <video
                  ref={videoRef}
                  style={styles.video}
                  autoPlay
                  playsInline
                  muted
                />
                <div style={styles.scannerOverlay}></div>
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>
              <p style={{ textAlign: 'center', margin: TavariStyles.spacing.md }}>
                Position the QR code within the green square
              </p>
            </div>
          </div>
        )}

        {/* Transaction Details Modal */}
        {showTransactionModal && selectedTransaction && (
          <div style={styles.modalOverlay} onClick={() => setShowTransactionModal(false)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h3>Transaction Details</h3>
                <div style={styles.modalButtonGroup}>
                  <button
                    style={styles.secondaryButton}
                    onClick={() => printReceipt(selectedTransaction)}
                  >
                    <FiPrinter size={16} />
                    {!isMobile && ' Print'}
                  </button>
                  <button
                    style={styles.secondaryButton}
                    onClick={() => emailReceipt(selectedTransaction)}
                  >
                    <FiMail size={16} />
                    {!isMobile && ' Email'}
                  </button>
                  <button
                    style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
                    onClick={() => setShowTransactionModal(false)}
                  >
                    ×
                  </button>
                </div>
              </div>

              <div style={styles.modalBody}>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Transaction #:</span>
                  <span style={styles.detailValue}>{selectedTransaction.sale_number || 'N/A'}</span>
                </div>

                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Date:</span>
                  <span style={styles.detailValue}>
                    {new Date(selectedTransaction.created_at).toLocaleString()}
                  </span>
                </div>

                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Customer:</span>
                  <span style={styles.detailValue}>
                    {selectedTransaction.customer_name || 'Walk-in Customer'}
                  </span>
                </div>

                {selectedTransaction.customer_phone && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Phone:</span>
                    <span style={styles.detailValue}>
                      {selectedTransaction.customer_phone}
                    </span>
                  </div>
                )}

                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Payment Method:</span>
                  <span style={styles.detailValue}>
                    {getPaymentMethodDisplay(selectedTransaction.payment_method)}
                  </span>
                </div>

                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Subtotal:</span>
                  <span style={styles.detailValue}>{formatCurrency(selectedTransaction.subtotal)}</span>
                </div>

                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Tax:</span>
                  <span style={styles.detailValue}>{formatCurrency(selectedTransaction.tax)}</span>
                </div>

                {selectedTransaction.discount > 0 && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Discount:</span>
                    <span style={styles.detailValue}>-{formatCurrency(selectedTransaction.discount)}</span>
                  </div>
                )}

                {selectedTransaction.loyalty_discount > 0 && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Loyalty Discount:</span>
                    <span style={styles.detailValue}>-{formatCurrency(selectedTransaction.loyalty_discount)}</span>
                  </div>
                )}

                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Total:</span>
                  <span style={{ ...styles.detailValue, fontWeight: TavariStyles.typography.fontWeight.bold }}>
                    {formatCurrency(selectedTransaction.total)}
                  </span>
                </div>

                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Status:</span>
                  <span style={getStatusBadgeStyle(selectedTransaction.payment_status, selectedTransaction.type)}>
                    {selectedTransaction.type === 'refund' ? 'Refunded' : (selectedTransaction.payment_status || 'Unknown')}
                  </span>
                </div>

                {selectedTransaction.notes && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Notes:</span>
                    <span style={styles.detailValue}>{selectedTransaction.notes}</span>
                  </div>
                )}

                {/* Items List */}
                {selectedTransaction.pos_sale_items && selectedTransaction.pos_sale_items.length > 0 && (
                  <div style={styles.itemsList}>
                    <h4>Items Purchased</h4>
                    {selectedTransaction.pos_sale_items.map((item, index) => (
                      <div key={index} style={styles.itemRow}>
                        <div>
                          <strong>{item.name}</strong>
                          {item.sku && <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500 }}>SKU: {item.sku}</div>}
                          {item.notes && <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600 }}>Notes: {item.notes}</div>}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div>Qty: {item.quantity}</div>
                          <div>Unit: {formatCurrency(item.unit_price)}</div>
                          <div><strong>Total: {formatCurrency(item.total_price)}</strong></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={styles.modalFooter}>
                <button
                  style={{...styles.secondaryButton, width: isMobile ? '100%' : 'auto'}}
                  onClick={() => setShowTransactionModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </POSAuthWrapper>
  );
};

export default CustomerTransactionHistoryReport;
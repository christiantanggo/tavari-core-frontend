// src/screens/Music/Ads/PayoutHistory.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../supabaseClient';
import { useBusiness } from '../../../contexts/BusinessContext';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { usePermissions } from '../../../hooks/usePermissions';
import PermissionGate from '../../../components/Auth/PermissionGate';
import SessionManager from '../../../components/SessionManager';
import toast from 'react-hot-toast';
import { FiLock } from 'react-icons/fi';

const PayoutHistory = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const { profile } = useUserProfile();
  
  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    isManager,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewRevenue = hasAnyPermission(['reports.financial.view', 'music.ads.manage']) || hasElevatedPrivileges();
  const canManagePayouts = hasPermission('reports.financial.view') || isOwner(); // Only owners can manage payouts
  const canEditBankInfo = isOwner(); // Only owners can edit bank info
  
  const [payouts, setPayouts] = useState([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [payoutThreshold, setPayoutThreshold] = useState(25.00);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [timeframe, setTimeframe] = useState('all');
  const [error, setError] = useState(null);
  
  const [bankInfo, setBankInfo] = useState({
    accountName: '',
    accountNumber: '',
    routingNumber: '',
    bankName: '',
    accountType: 'checking'
  });

  const timeframeOptions = [
    { label: 'All Time', value: 'all' },
    { label: 'This Year', value: 'year' },
    { label: 'Last 90 Days', value: '90days' }
  ];

  useEffect(() => {
    if (business?.id && !permissionsLoading) {
      if (!canViewRevenue) {
        toast.error('You do not have permission to view payout history');
        navigate('/dashboard/music');
        return;
      }
      
      loadPayoutHistory();
      loadBankInfo();
      calculateCurrentBalance();
    }
  }, [business?.id, timeframe, permissionsLoading, canViewRevenue]);

  const loadPayoutHistory = async () => {
    if (!business?.id) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      let query = supabase
        .from('music_business_payouts')
        .select('*')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });
      
      // Apply timeframe filter
      if (timeframe === 'year') {
        const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
        query = query.gte('created_at', yearStart);
      } else if (timeframe === '90days') {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('created_at', ninetyDaysAgo);
      }
      
      const { data: payoutData, error: payoutError } = await query;
      
      if (payoutError) throw payoutError;
      
      // Process payout data
      const processedPayouts = payoutData?.map(payout => ({
        id: payout.id,
        amount: parseFloat(payout.net_payout_amount || 0),
        status: payout.payment_status || 'pending',
        date: new Date(payout.created_at),
        method: payout.payment_method || 'bank_transfer',
        reference: payout.payment_reference || `PAY-${payout.id.slice(-8)}`,
        periodStart: new Date(payout.payout_period_start),
        periodEnd: new Date(payout.payout_period_end),
        grossRevenue: parseFloat(payout.total_gross_revenue || 0),
        commissions: parseFloat(payout.total_commissions || 0),
        providers: payout.api_breakdown || {}
      })) || [];
      
      setPayouts(processedPayouts);
      
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load payout history');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const loadBankInfo = async () => {
    if (!business?.id) return;
    
    try {
      // Get business API settings which include payout info
      const { data: apiSettings, error } = await supabase
        .from('music_business_ad_apis')
        .select('*')
        .eq('business_id', business.id)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error; // Ignore "no rows" error
      
      if (apiSettings) {
        setPayoutThreshold(parseFloat(apiSettings.minimum_payout || 25.00));
        
        // Extract bank info from settings if available
        const settings = apiSettings.settings || {};
        if (settings.bank_info) {
          setBankInfo({
            accountName: settings.bank_info.account_name || business.name || '',
            accountNumber: settings.bank_info.account_number || '',
            routingNumber: settings.bank_info.routing_number || '',
            bankName: settings.bank_info.bank_name || '',
            accountType: settings.bank_info.account_type || 'checking'
          });
        }
      }
      
    } catch (err) {
      // Silent fail for bank info loading
    }
  };

  const calculateCurrentBalance = async () => {
    if (!business?.id) return;
    
    try {
      // Get total unpaid revenue
      const { data: revenueData, error } = await supabase
        .from('music_ad_revenue_detailed')
        .select('business_payout')
        .eq('business_id', business.id)
        .eq('payment_status', 'pending');
      
      if (error) throw error;
      
      const balance = revenueData?.reduce((sum, record) => 
        sum + parseFloat(record.business_payout || 0), 0
      ) || 0;
      
      setCurrentBalance(balance);
      
    } catch (err) {
      setCurrentBalance(0);
    }
  };

  const saveBankInfo = async () => {
    // Permission check
    if (!canEditBankInfo) {
      toast.error('Only the business owner can edit bank account information');
      return;
    }

    if (!business?.id) return;
    
    try {
      const bankData = {
        account_name: bankInfo.accountName,
        account_number: bankInfo.accountNumber,
        routing_number: bankInfo.routingNumber,
        bank_name: bankInfo.bankName,
        account_type: bankInfo.accountType
      };
      
      // Update or create business API settings with bank info
      const { error } = await supabase
        .from('music_business_ad_apis')
        .upsert({
          business_id: business.id,
          api_id: (await supabase.from('music_ad_apis').select('id').limit(1).single()).data?.id,
          settings: { bank_info: bankData },
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'business_id,api_id'
        });
      
      if (error) throw error;
      
      setShowBankModal(false);
      toast.success('Bank information saved successfully');
      
    } catch (err) {
      toast.error('Failed to save bank information');
    }
  };

  const requestPayout = async () => {
    // Permission check
    if (!canManagePayouts) {
      toast.error('You do not have permission to request payouts');
      return;
    }

    if (currentBalance < payoutThreshold) {
      toast.error(`Minimum payout amount is ${formatCurrency(payoutThreshold)}`);
      return;
    }
    
    if (!bankInfo.accountNumber || !bankInfo.routingNumber) {
      toast.error('Please configure your bank account information first');
      setShowBankModal(true);
      return;
    }
    
    try {
      // Create a payout request
      const { error } = await supabase
        .from('music_business_payouts')
        .insert({
          business_id: business.id,
          payout_period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          payout_period_end: new Date().toISOString().split('T')[0],
          total_gross_revenue: currentBalance * 1.67, // Estimate gross (business gets ~60%)
          total_commissions: currentBalance * 0.67,
          net_payout_amount: currentBalance,
          payment_method: 'bank_transfer',
          payment_status: 'pending',
          api_breakdown: {},
          created_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
      // Mark revenue records as processing
      await supabase
        .from('music_ad_revenue_detailed')
        .update({ payment_status: 'processing' })
        .eq('business_id', business.id)
        .eq('payment_status', 'pending');
      
      toast.success(`Payout request of ${formatCurrency(currentBalance)} submitted successfully!`);
      
      // Refresh data
      await Promise.all([
        loadPayoutHistory(),
        calculateCurrentBalance()
      ]);
      
    } catch (err) {
      toast.error('Failed to request payout. Please try again.');
    }
  };

  const viewPayoutDetails = (payout) => {
    setSelectedPayout(payout);
    setShowPayoutModal(true);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadPayoutHistory(),
      calculateCurrentBalance()
    ]);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': 
      case 'paid': 
        return '#4caf50';
      case 'processing': 
        return '#ff9800';
      case 'pending': 
        return '#2196f3';
      case 'failed': 
        return '#f44336';
      default: 
        return '#666';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
      case 'paid':
        return '✅';
      case 'processing': 
        return '⏳';
      case 'pending': 
        return '📅';
      case 'failed': 
        return '❌';
      default: 
        return '❓';
    }
  };

  const getTotalPayouts = () => {
    return payouts
      .filter(p => p.status === 'completed' || p.status === 'paid')
      .reduce((total, payout) => total + payout.amount, 0);
  };

  const getPayoutProgress = () => {
    if (payoutThreshold <= 0) return 1;
    return Math.min(currentBalance / payoutThreshold, 1);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount || 0);
  };

  // Show loading while permissions are being checked
  if (permissionsLoading) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <div style={styles.loadingText}>Loading permissions...</div>
        </div>
      </SessionManager>
    );
  }

  // Show access denied if no permission
  if (!canViewRevenue) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <FiLock size={64} style={{ color: '#f44336', marginBottom: '20px' }} />
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>Access Denied</h2>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '20px' }}>
            You do not have permission to view payout history.
          </p>
          <p style={{ fontSize: '14px', color: '#999', marginBottom: '30px' }}>
            Contact your business owner for access to financial information.
          </p>
          <button 
            onClick={() => navigate('/dashboard/music')} 
            style={styles.retryButton}
          >
            Return to Music Dashboard
          </button>
        </div>
      </SessionManager>
    );
  }

  if (isLoading) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <div style={styles.loadingText}>Loading payout history...</div>
        </div>
      </SessionManager>
    );
  }

  if (error) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <div style={styles.errorText}>Error loading payouts: {error}</div>
          <button onClick={() => window.location.reload()} style={styles.retryButton}>
            Retry
          </button>
        </div>
      </SessionManager>
    );
  }

  return (
    <SessionManager>
      <div style={styles.container}>
        {/* Current Balance & Payout Status */}
        <div style={styles.card}>
          <h1 style={styles.title}>Payout Status</h1>
          
          {!canManagePayouts && (
            <div style={{ 
              marginBottom: '15px', 
              padding: '10px', 
              backgroundColor: '#fff3cd', 
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <FiLock size={16} style={{ color: '#856404' }} />
              <span style={{ color: '#856404', fontSize: '14px' }}>
                View-only mode - Only the business owner can request payouts
              </span>
            </div>
          )}
          
          <div style={styles.balanceSection}>
            <div style={styles.balanceInfo}>
              <div style={styles.balanceAmount}>{formatCurrency(currentBalance)}</div>
              <div style={styles.balanceLabel}>Current Balance</div>
            </div>
            
            <div style={styles.progressSection}>
              <div style={styles.progressLabel}>
                Progress to next payout ({formatCurrency(payoutThreshold)})
              </div>
              <div style={styles.progressBarContainer}>
                <div 
                  style={{
                    ...styles.progressBar,
                    width: `${getPayoutProgress() * 100}%`
                  }}
                />
              </div>
              <div style={styles.progressText}>
                {currentBalance >= payoutThreshold 
                  ? 'Ready for payout!' 
                  : `${formatCurrency(Math.max(0, payoutThreshold - currentBalance))} remaining`
                }
              </div>
            </div>
          </div>

          <div style={styles.actionButtons}>
            <PermissionGate
              requireOwner
              fallback={
                <button
                  disabled
                  style={{
                    ...styles.payoutButton,
                    backgroundColor: '#ccc',
                    cursor: 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                  title="Only the business owner can request payouts"
                >
                  <FiLock size={16} />
                  Request Payout
                </button>
              }
            >
              <button
                onClick={requestPayout}
                disabled={currentBalance < payoutThreshold}
                style={{
                  ...styles.payoutButton,
                  backgroundColor: currentBalance >= payoutThreshold ? '#009688' : '#ccc',
                  cursor: currentBalance >= payoutThreshold ? 'pointer' : 'not-allowed'
                }}
              >
                Request Payout
              </button>
            </PermissionGate>
            
            <PermissionGate
              requireOwner
              fallback={
                <button
                  onClick={() => setShowBankModal(true)}
                  style={{ ...styles.bankButton, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  disabled={!canEditBankInfo}
                >
                  <FiLock size={16} />
                  Bank Details
                </button>
              }
            >
              <button
                onClick={() => setShowBankModal(true)}
                style={styles.bankButton}
              >
                Bank Details
              </button>
            </PermissionGate>
            
            <button
              onClick={onRefresh}
              disabled={refreshing}
              style={{
                ...styles.bankButton,
                opacity: refreshing ? 0.6 : 1
              }}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Payout Summary</h2>
          
          <div style={styles.timeframeButtons}>
            {timeframeOptions.map(option => (
              <button
                key={option.value}
                onClick={() => setTimeframe(option.value)}
                style={{
                  ...styles.button,
                  backgroundColor: timeframe === option.value ? '#009688' : '#fff',
                  color: timeframe === option.value ? '#fff' : '#333'
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.statBox}>
              <div style={styles.statValue}>{formatCurrency(getTotalPayouts())}</div>
              <div style={styles.statLabel}>Total Paid Out</div>
            </div>
            
            <div style={styles.statBox}>
              <div style={styles.statValue}>{payouts.length}</div>
              <div style={styles.statLabel}>Total Payouts</div>
            </div>
            
            <div style={styles.statBox}>
              <div style={styles.statValue}>
                {payouts.length > 0 && getTotalPayouts() > 0
                  ? formatCurrency(getTotalPayouts() / payouts.filter(p => p.status === 'completed' || p.status === 'paid').length) 
                  : formatCurrency(0)
                }
              </div>
              <div style={styles.statLabel}>Average Payout</div>
            </div>
            
            <div style={styles.statBox}>
              <div style={styles.statValue}>
                {payouts.filter(p => p.status === 'pending' || p.status === 'processing').length}
              </div>
              <div style={styles.statLabel}>Pending</div>
            </div>
          </div>
        </div>

        {/* Payout History */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Payout History</h2>
          
          {payouts.length === 0 ? (
            <div style={styles.noDataText}>No payouts found for selected timeframe</div>
          ) : (
            <div style={styles.payoutsList}>
              {payouts.map((payout) => (
                <div 
                  key={payout.id} 
                  style={styles.payoutItem}
                  onClick={() => viewPayoutDetails(payout)}
                >
                  <div style={styles.payoutIcon}>
                    {getStatusIcon(payout.status)}
                  </div>
                  <div style={styles.payoutInfo}>
                    <div style={styles.payoutTitle}>
                      {formatCurrency(payout.amount)} • {payout.reference}
                    </div>
                    <div style={styles.payoutDescription}>
                      {payout.date.toLocaleDateString()} • {payout.method.replace('_', ' ')}
                    </div>
                  </div>
                  <div style={styles.payoutStatus}>
                    <span 
                      style={{
                        ...styles.statusChip,
                        backgroundColor: getStatusColor(payout.status) + '20',
                        color: getStatusColor(payout.status)
                      }}
                    >
                      {payout.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bank Account Modal */}
        {showBankModal && (
          <div style={styles.modalOverlay} onClick={() => setShowBankModal(false)}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h2 style={styles.modalTitle}>Bank Account Details</h2>

              {!canEditBankInfo && (
                <div style={{ 
                  marginBottom: '15px', 
                  padding: '10px', 
                  backgroundColor: '#fff3cd', 
                  borderRadius: '4px',
                  textAlign: 'center'
                }}>
                  <FiLock size={16} style={{ color: '#856404', marginRight: '8px' }} />
                  <span style={{ color: '#856404', fontSize: '14px' }}>
                    View-only - Only the business owner can edit bank information
                  </span>
                </div>
              )}

              <div style={styles.modalContent}>
                <div style={styles.inputGroup}>
                  <label style={styles.inputLabel}>Account Name</label>
                  <input
                    type="text"
                    value={bankInfo.accountName}
                    onChange={(e) => setBankInfo(prev => ({ ...prev, accountName: e.target.value }))}
                    style={styles.input}
                    placeholder="Business or personal name"
                    disabled={!canEditBankInfo}
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.inputLabel}>Account Number</label>
                  <input
                    type="password"
                    value={bankInfo.accountNumber}
                    onChange={(e) => setBankInfo(prev => ({ ...prev, accountNumber: e.target.value }))}
                    style={styles.input}
                    placeholder="Bank account number"
                    disabled={!canEditBankInfo}
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.inputLabel}>Routing Number</label>
                  <input
                    type="text"
                    value={bankInfo.routingNumber}
                    onChange={(e) => setBankInfo(prev => ({ ...prev, routingNumber: e.target.value }))}
                    style={styles.input}
                    placeholder="Bank routing/transit number"
                    disabled={!canEditBankInfo}
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.inputLabel}>Bank Name</label>
                  <input
                    type="text"
                    value={bankInfo.bankName}
                    onChange={(e) => setBankInfo(prev => ({ ...prev, bankName: e.target.value }))}
                    style={styles.input}
                    placeholder="Name of your bank"
                    disabled={!canEditBankInfo}
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.inputLabel}>Account Type</label>
                  <select
                    value={bankInfo.accountType}
                    onChange={(e) => setBankInfo(prev => ({ ...prev, accountType: e.target.value }))}
                    style={styles.input}
                    disabled={!canEditBankInfo}
                  >
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="business">Business</option>
                  </select>
                </div>
              </div>

              <div style={styles.modalActions}>
                <button
                  onClick={() => setShowBankModal(false)}
                  style={styles.cancelButton}
                >
                  {canEditBankInfo ? 'Cancel' : 'Close'}
                </button>
                {canEditBankInfo && (
                  <button
                    onClick={saveBankInfo}
                    style={styles.saveButton}
                  >
                    Save
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Payout Details Modal */}
        {showPayoutModal && selectedPayout && (
          <div style={styles.modalOverlay} onClick={() => setShowPayoutModal(false)}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h2 style={styles.modalTitle}>Payout Details</h2>
              
              <div style={styles.payoutDetails}>
                <div style={styles.detailsTable}>
                  {[
                    { label: 'Reference', value: selectedPayout.reference },
                    { label: 'Amount', value: formatCurrency(selectedPayout.amount) },
                    { label: 'Status', value: selectedPayout.status.toUpperCase() },
                    { label: 'Date', value: selectedPayout.date.toLocaleDateString() },
                    { label: 'Period', value: `${selectedPayout.periodStart.toLocaleDateString()} - ${selectedPayout.periodEnd.toLocaleDateString()}` },
                    { label: 'Method', value: selectedPayout.method.replace('_', ' ') },
                    { label: 'Gross Revenue', value: formatCurrency(selectedPayout.grossRevenue) },
                    { label: 'Commissions', value: formatCurrency(selectedPayout.commissions) }
                  ].map((row, index) => (
                    <div key={index} style={styles.detailRow}>
                      <span style={styles.detailLabel}>{row.label}</span>
                      <span style={styles.detailValue}>{row.value}</span>
                    </div>
                  ))}
                </div>

                {Object.keys(selectedPayout.providers).length > 0 && (
                  <>
                    <div style={styles.divider} />
                    <h3 style={styles.providersTitle}>Revenue by Provider</h3>
                    {Object.entries(selectedPayout.providers).map(([provider, amount]) => (
                      <div key={provider} style={styles.providerRow}>
                        <span style={styles.providerName}>{provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
                        <span style={styles.providerAmount}>{formatCurrency(amount)}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <button
                onClick={() => setShowPayoutModal(false)}
                style={styles.closeButton}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </SessionManager>
  );
};

const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e9ecef',
    borderTop: '4px solid #009688',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '15px'
  },
  loadingText: {
    fontSize: '16px',
    color: '#666'
  },
  errorText: {
    fontSize: '16px',
    color: '#f44336',
    marginBottom: '20px',
    textAlign: 'center'
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#009688',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
    margin: '0 0 20px 0'
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
    margin: '0 0 15px 0'
  },
  balanceSection: {
    marginBottom: '20px'
  },
  balanceInfo: {
    textAlign: 'center',
    marginBottom: '20px'
  },
  balanceAmount: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#009688',
    marginBottom: '5px'
  },
  balanceLabel: {
    fontSize: '16px',
    color: '#666'
  },
  progressSection: {
    marginBottom: '15px'
  },
  progressLabel: {
    fontSize: '14px',
    color: '#333',
    marginBottom: '8px'
  },
  progressBarContainer: {
    width: '100%',
    height: '8px',
    backgroundColor: '#e0e0e0',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px'
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#009688',
    transition: 'width 0.3s ease'
  },
  progressText: {
    fontSize: '12px',
    color: '#666',
    textAlign: 'center'
  },
  actionButtons: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap'
  },
  payoutButton: {
    flex: 1,
    minWidth: '120px',
    padding: '12px',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '16px',
    fontWeight: '500'
  },
  bankButton: {
    flex: 1,
    minWidth: '120px',
    padding: '12px',
    border: '1px solid #009688',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#009688',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  timeframeButtons: {
    display: 'flex',
    gap: '5px',
    marginBottom: '20px',
    justifyContent: 'center',
    flexWrap: 'wrap'
  },
  button: {
    padding: '8px 16px',
    border: '1px solid #009688',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px'
  },
  statBox: {
    textAlign: 'center',
    padding: '20px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  statValue: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#009688',
    marginBottom: '5px'
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    textTransform: 'uppercase'
  },
  noDataText: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    padding: '40px 0'
  },
  payoutsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  payoutItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '15px',
    border: '1px solid #eee',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  payoutIcon: {
    fontSize: '24px',
    marginRight: '15px'
  },
  payoutInfo: {
    flex: 1
  },
  payoutTitle: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#333',
    marginBottom: '5px'
  },
  payoutDescription: {
    fontSize: '14px',
    color: '#666'
  },
  payoutStatus: {
    marginLeft: '15px'
  },
  statusChip: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
    textTransform: 'uppercase'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '30px',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: '20px',
    margin: '0 0 20px 0'
  },
  modalContent: {
    marginBottom: '30px'
  },
  inputGroup: {
    marginBottom: '20px'
  },
  inputLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
    marginBottom: '5px'
  },
  input: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '16px',
    boxSizing: 'border-box'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px'
  },
  cancelButton: {
    padding: '10px 20px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#333',
    cursor: 'pointer',
    fontSize: '14px'
  },
  saveButton: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#009688',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  closeButton: {
    padding: '10px 20px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#333',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'block',
    margin: '0 auto'
  },
  payoutDetails: {
    marginBottom: '20px'
  },
  detailsTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '20px'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #eee'
  },
  detailLabel: {
    fontWeight: '500',
    color: '#333'
  },
  detailValue: {
    color: '#666'
  },
  divider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '20px 0'
  },
  providersTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
    margin: '0 0 15px 0'
  },
  providerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0'
  },
  providerName: {
    fontSize: '14px',
    color: '#333',
    textTransform: 'capitalize'
  },
  providerAmount: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#009688'
  }
};

// Add hover effects and spinner animation CSS
if (!document.querySelector('#payout-history-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'payout-history-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    [style*="payoutItem"]:hover {
      background-color: #f5f5f5 !important;
    }

    input:disabled,
    select:disabled {
      background-color: #f5f5f5;
      cursor: not-allowed;
      opacity: 0.6;
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(styleSheet);
}

export default PayoutHistory;
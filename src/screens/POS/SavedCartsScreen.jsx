// screens/POS/SavedCartsScreen.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const SavedCartsScreen = () => {
  const navigate = useNavigate();
  
  // Security context for sensitive saved cart operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'SavedCartsScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'SavedCartsScreen'
  });

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
  const canViewSavedCarts = hasAnyPermission(['pos.sales.create', 'pos.sales.view_all']) || hasElevatedPrivileges();
  const canResumeCarts = hasPermission('pos.sales.create') || hasElevatedPrivileges();
  const canDeleteCarts = hasAnyPermission(['pos.sales.void', 'pos.sales.refund']) || hasElevatedPrivileges();
  const canViewAllCarts = hasPermission('pos.sales.view_all') || hasElevatedPrivileges();

  const taxCalc = useTaxCalculations(auth.selectedBusinessId);

  const [savedCarts, setSavedCarts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cartToDelete, setCartToDelete] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [showExpiredOnly, setShowExpiredOnly] = useState(false);

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewSavedCarts) {
      toast.error('You do not have permission to view saved carts');
      navigate('/dashboard/pos');
    }
  }, [permissionsLoading, canViewSavedCarts, navigate]);

  const loadSavedCarts = async () => {
    if (!auth.selectedBusinessId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_saved_carts');
      if (!rateLimitCheck.allowed) {
        setError('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('saved_carts_access', {
        action: 'load_saved_carts',
        business_id: auth.selectedBusinessId,
        show_expired_only: showExpiredOnly
      }, 'low');
      
      // FIXED: Handle null expires_at properly
      let query = supabase
        .from('pos_saved_orders')
        .select('*')
        .eq('business_id', auth.selectedBusinessId);

      // FIXED: Handle expires_at null values
      if (showExpiredOnly) {
        query = query.not('expires_at', 'is', null).lt('expires_at', new Date().toISOString());
      } else {
        // Show active carts (null expires_at OR future expires_at)
        query = query.or('expires_at.is.null,expires_at.gte.' + new Date().toISOString());
      }

      const { data: savedOrders, error: savedError } = await query.order('created_at', { ascending: false });

      if (savedError) {
        await logSecurityEvent('saved_carts_query_error', {
          action: 'load_saved_carts_failed',
          business_id: auth.selectedBusinessId,
          error_message: savedError.message
        }, 'medium');
        throw savedError;
      }

      if (!savedOrders || savedOrders.length === 0) {
        setSavedCarts([]);
        setLoading(false);
        await recordAction('saved_carts_loaded', auth.selectedBusinessId, true);
        return;
      }

      const processedCarts = savedOrders.map((order) => {
        const cartData = order.cart_data || {};
        const items = cartData.items || [];
        
        // Use the stored totals from the database
        const subtotal = parseFloat(order.subtotal) || 0;
        const taxAmount = parseFloat(order.tax_amount) || 0;
        const total = parseFloat(order.total_amount) || 0;
        
        let customerName = order.order_name || 'Walk-in';
        if (order.customer_info?.name) {
          customerName = order.customer_info.name;
        } else if (cartData.loyaltyCustomer?.customer_name) {
          customerName = cartData.loyaltyCustomer.customer_name;
        }
        
        let cartType = 'saved';
        let reason = 'Manually saved';
        if (order.save_reason === 'timeout' || order.save_reason === 'session_timeout') {
          cartType = 'timeout';
          reason = 'Session timeout';
        }

        // FIXED: Handle null expires_at
        const isExpired = order.expires_at ? new Date(order.expires_at) < new Date() : false;
        
        return {
          id: order.id,
          type: cartType,
          reason,
          itemCount: order.item_count || items.length,
          subtotal,
          totalTax: taxAmount,
          total,
          customerName,
          savedBy: 'Employee',
          savedAt: order.created_at,
          expiresAt: order.expires_at,
          isExpired,
          cartData: cartData,
          items: items,
          businessId: order.business_id,
          canBeResumed: items.length > 0 && !isExpired
        };
      });

      setSavedCarts(processedCarts);
      
      await recordAction('saved_carts_loaded', auth.selectedBusinessId, true);
      await logSecurityEvent('saved_carts_loaded', {
        action: 'load_saved_carts_success',
        business_id: auth.selectedBusinessId,
        cart_count: processedCarts.length
      }, 'low');
      
    } catch (err) {
      await logSecurityEvent('saved_carts_error', {
        action: 'load_saved_carts_failed',
        business_id: auth.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      setError(`Failed to load saved carts: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Load data when ready
  useEffect(() => {
    if (auth.isReady && auth.selectedBusinessId && !permissionsLoading && canViewSavedCarts) {
      loadSavedCarts();
    }
  }, [auth.isReady, auth.selectedBusinessId, permissionsLoading, canViewSavedCarts]);

  // Reload when filter changes
  useEffect(() => {
    if (auth.isReady && auth.selectedBusinessId && !permissionsLoading && canViewSavedCarts) {
      loadSavedCarts();
    }
  }, [showExpiredOnly]);

  const handleResumeCart = async (cart) => {
    if (!canResumeCarts) {
      toast.error('You do not have permission to resume carts');
      return;
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('resume_cart');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('cart_resume_initiated', {
        action: 'resume_cart',
        business_id: auth.selectedBusinessId,
        cart_id: cart.id,
        item_count: cart.itemCount,
        total_amount: cart.total
      }, 'medium');

      await recordAction('cart_resumed', cart.id, true);

      navigate('/dashboard/pos/register', {
        state: {
          resumeCart: {
            items: cart.items,
            customer: cart.cartData.loyaltyCustomer || {
              customer_name: cart.customerName,
              id: null
            },
            cartId: cart.id
          }
        }
      });
    } catch (err) {
      await logSecurityEvent('cart_resume_error', {
        action: 'resume_cart_failed',
        business_id: auth.selectedBusinessId,
        cart_id: cart.id,
        error_message: err.message
      }, 'medium');
      
      setError(`Failed to resume cart: ${err.message}`);
      toast.error(`Failed to resume cart: ${err.message}`);
    }
  };

  const handleDeleteCart = async (cartId) => {
    if (!canDeleteCarts) {
      toast.error('You do not have permission to delete carts');
      return;
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('delete_cart');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('cart_delete_initiated', {
        action: 'delete_cart',
        business_id: auth.selectedBusinessId,
        cart_id: cartId
      }, 'high');

      const { error } = await supabase
        .from('pos_saved_orders')
        .delete()
        .eq('id', cartId)
        .eq('business_id', auth.selectedBusinessId);

      if (error) throw error;

      setSavedCarts(prev => prev.filter(cart => cart.id !== cartId));
      setShowDeleteModal(false);
      setCartToDelete(null);

      await recordAction('cart_deleted', cartId, true);
      await logSecurityEvent('cart_deleted', {
        action: 'delete_cart_success',
        business_id: auth.selectedBusinessId,
        cart_id: cartId
      }, 'high');

      toast.success('Cart deleted successfully');

    } catch (err) {
      await logSecurityEvent('cart_delete_error', {
        action: 'delete_cart_failed',
        business_id: auth.selectedBusinessId,
        cart_id: cartId,
        error_message: err.message
      }, 'high');
      
      setError(`Failed to delete cart: ${err.message}`);
      toast.error(`Failed to delete cart: ${err.message}`);
    }
  };

  const handleSearchChange = async (value) => {
    // Validate search input
    const validation = await validateInput(value, 'text', 'search_term');
    if (!validation.valid) {
      toast.error('Invalid search input');
      return;
    }
    setSearchTerm(value);
  };

  if (!auth.isReady) {
    return (
      <SecurityWrapper
        componentName="SavedCartsScreen"
        sensitiveComponent={true}
        requireSecureConnection={false}
        securityLevel="high"
      >
        <div style={{ ...TavariStyles.layout.container, paddingTop: '100px' }}>
          <div style={TavariStyles.components.loading.container}>
            <div style={TavariStyles.components.loading.spinner}></div>
            <div>Loading...</div>
            <style>{TavariStyles.keyframes.spin}</style>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  if (auth.authError) {
    return (
      <SecurityWrapper
        componentName="SavedCartsScreen"
        sensitiveComponent={true}
        requireSecureConnection={false}
        securityLevel="high"
      >
        <div style={{ ...TavariStyles.layout.container, paddingTop: '100px' }}>
          <div style={{ ...TavariStyles.components.banner.base, ...TavariStyles.components.banner.variants.error }}>
            Authentication Error: {auth.authError}
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  if (loading) {
    return (
      <SecurityWrapper
        componentName="SavedCartsScreen"
        sensitiveComponent={true}
        requireSecureConnection={false}
        securityLevel="high"
      >
        <POSAuthWrapper 
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="SavedCartsScreen"
        >
          <div style={{ ...TavariStyles.layout.container, paddingTop: '100px' }}>
            <div style={TavariStyles.components.loading.container}>
              <div style={TavariStyles.components.loading.spinner}></div>
              <div>Loading saved carts...</div>
              <style>{TavariStyles.keyframes.spin}</style>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  const filteredCarts = savedCarts.filter(cart => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = searchTerm === '' || 
      cart.customerName.toLowerCase().includes(searchLower) ||
      cart.id.toLowerCase().includes(searchLower);
    
    const matchesType = filterType === 'all' || 
      (filterType === 'saved' && cart.type === 'saved') ||
      (filterType === 'timeout' && cart.type === 'timeout') ||
      (filterType === 'resumable' && cart.canBeResumed) ||
      (filterType === 'expired' && cart.isExpired);
    
    return matchesSearch && matchesType;
  });

  const styles = {
    container: { ...TavariStyles.layout.container, paddingTop: '100px' },
    header: { marginBottom: TavariStyles.spacing['3xl'] },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0,
      marginBottom: TavariStyles.spacing.md
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    },
    controls: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl,
      gap: TavariStyles.spacing.lg,
      flexWrap: 'wrap'
    },
    filters: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center',
      flex: 1
    },
    searchInput: {
      ...TavariStyles.components.form.input,
      flex: 1,
      minWidth: '250px'
    },
    select: {
      ...TavariStyles.components.form.select,
      minWidth: '120px'
    },
    cartsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    cartCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      cursor: 'pointer'
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['5xl'],
      color: TavariStyles.colors.gray500
    },
    error: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg
    }
  };

  return (
    <SecurityWrapper
      componentName="SavedCartsScreen"
      sensitiveComponent={true}
      requireSecureConnection={false}
      securityLevel="high"
    >
      <POSAuthWrapper 
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="SavedCartsScreen"
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h2 style={styles.title}>Saved Carts</h2>
            <p style={styles.subtitle}>Resume incomplete transactions</p>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.controls}>
            <div style={styles.filters}>
              <input
                type="text"
                placeholder="Search by customer, cart ID..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                style={styles.searchInput}
              />
              
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                style={styles.select}
              >
                <option value="all">All ({savedCarts.length})</option>
                <option value="resumable">Resumable</option>
                <option value="saved">Manual</option>
                <option value="timeout">Timeout</option>
                <option value="expired">Expired</option>
              </select>

              <TavariCheckbox
                checked={showExpiredOnly}
                onChange={(checked) => setShowExpiredOnly(checked)}
                label="Show expired only"
                size="md"
              />
            </div>

            <button
              style={{
                ...TavariStyles.components.button.base,
                ...TavariStyles.components.button.variants.secondary
              }}
              onClick={() => navigate('/dashboard/pos/tabs')}
            >
              Back to Tabs
            </button>
          </div>

          {filteredCarts.length === 0 ? (
            <div style={styles.emptyState}>
              <h3>No Saved Carts Found</h3>
              <p>No carts match your current filters.</p>
            </div>
          ) : (
            <div style={styles.cartsGrid}>
              {filteredCarts.map((cart) => (
                <div key={cart.id} style={styles.cartCard}>
                  <h4>{cart.customerName}</h4>
                  <p>Items: {cart.itemCount}</p>
                  <p>Total: ${cart.total.toFixed(2)}</p>
                  <p>Saved: {dayjs(cart.savedAt).fromNow()}</p>
                  
                  <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, marginTop: TavariStyles.spacing.md }}>
                    <PermissionGate permissions={['pos.sales.create']} requireAny>
                      <button
                        style={{
                          ...TavariStyles.components.button.base,
                          ...TavariStyles.components.button.variants.primary,
                          ...TavariStyles.components.button.sizes.sm,
                          flex: 1
                        }}
                        onClick={() => handleResumeCart(cart)}
                        disabled={!cart.canBeResumed}
                      >
                        Resume
                      </button>
                    </PermissionGate>
                    
                    <PermissionGate permissions={['pos.sales.void', 'pos.sales.refund']} requireAny>
                      <button
                        style={{
                          ...TavariStyles.components.button.base,
                          ...TavariStyles.components.button.variants.danger,
                          ...TavariStyles.components.button.sizes.sm
                        }}
                        onClick={() => {
                          setCartToDelete(cart);
                          setShowDeleteModal(true);
                        }}
                      >
                        Delete
                      </button>
                    </PermissionGate>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showDeleteModal && cartToDelete && (
            <div style={TavariStyles.components.modal.overlay}>
              <div style={TavariStyles.components.modal.content}>
                <h3>Delete Cart?</h3>
                <p>Are you sure you want to delete this cart?</p>
                <div style={{ display: 'flex', gap: TavariStyles.spacing.md, justifyContent: 'flex-end', marginTop: TavariStyles.spacing.lg }}>
                  <button
                    style={{
                      ...TavariStyles.components.button.base,
                      ...TavariStyles.components.button.variants.secondary
                    }}
                    onClick={() => {
                      setShowDeleteModal(false);
                      setCartToDelete(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={{
                      ...TavariStyles.components.button.base,
                      ...TavariStyles.components.button.variants.danger
                    }}
                    onClick={() => handleDeleteCart(cartToDelete.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default SavedCartsScreen;
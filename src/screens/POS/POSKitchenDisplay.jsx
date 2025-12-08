// src/screens/POS/POSKitchenDisplay.jsx - FIXED to work with actual database schema
import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { logAction } from '../../helpers/posAudit';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';

const POSKitchenDisplay = () => {
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSKitchenDisplay'
  });

  // Security context for kitchen operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSKitchenDisplay',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  // Permission checks
  const canViewKitchen = hasAnyPermission([
    'pos.kitchen.view',
    'pos.kitchen.manage'
  ]) || hasElevatedPrivileges();

  const canManageOrders = hasPermission('pos.kitchen.manage') || hasElevatedPrivileges();
  const canCompleteOrders = hasPermission('pos.kitchen.complete') || hasElevatedPrivileges();
  const canChangeSettings = hasPermission('pos.kitchen.settings') || hasElevatedPrivileges();

  // Display state
  const [displayMode, setDisplayMode] = useState('single');
  const [selectedStations, setSelectedStations] = useState([]);
  const [availableStations, setAvailableStations] = useState([]);
  
  // Orders state - now includes both tabs and regular sales
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Filter and view state
  const [filterStatus, setFilterStatus] = useState('all');
  const [orderType, setOrderType] = useState('all'); // 'all', 'tabs', 'sales'
  const [sortBy, setSortBy] = useState('time');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(10000);
  
  // Timer refs
  const refreshTimer = useRef(null);
  const orderTimers = useRef({});
  
  // Sound settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [urgentThreshold, setUrgentThreshold] = useState(15);
  const [criticalThreshold, setCriticalThreshold] = useState(25);

  // Load initial data
  useEffect(() => {
    if (auth.selectedBusinessId && auth.authUser && canViewKitchen) {
      fetchStations();
      fetchAllOrders();
      setupRealtimeSubscription();
    }

    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
      }
      Object.values(orderTimers.current).forEach(timer => clearInterval(timer));
    };
  }, [auth.selectedBusinessId, auth.authUser, canViewKitchen]);

  // Auto-refresh setup - modified to not show loading screen
  useEffect(() => {
    if (autoRefresh && auth.selectedBusinessId && canViewKitchen) {
      refreshTimer.current = setInterval(() => {
        fetchAllOrdersQuiet(); // Use quiet version for auto-refresh
      }, refreshInterval);
    } else if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
    }

    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
      }
    };
  }, [autoRefresh, refreshInterval, auth.selectedBusinessId, canViewKitchen]);

  // Setup realtime subscription for all order updates
  const setupRealtimeSubscription = () => {
    const subscription = supabase
      .channel('kitchen-orders')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'pos_tabs',
          filter: `business_id=eq.${auth.selectedBusinessId}`
        }, 
        (payload) => {
          handleRealtimeUpdate(payload);
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pos_tab_items',
          filter: `business_id=eq.${auth.selectedBusinessId}`
        },
        (payload) => {
          handleRealtimeUpdate(payload);
        }
      )
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pos_sales',
          filter: `business_id=eq.${auth.selectedBusinessId}`
        },
        (payload) => {
          handleRealtimeUpdate(payload);
        }
      )
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pos_sale_items',
          filter: `business_id=eq.${auth.selectedBusinessId}`
        },
        (payload) => {
          handleRealtimeUpdate(payload);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const handleRealtimeUpdate = (payload) => {
    if (payload.eventType === 'INSERT') {
      playNewOrderSound();
      fetchAllOrdersQuiet();
    } else if (payload.eventType === 'UPDATE') {
      fetchAllOrdersQuiet();
    }
  };

  const playNewOrderSound = () => {
    if (soundEnabled) {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.2);
    }
  };

  const fetchStations = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      await logSecurityEvent('kitchen_stations_accessed', {
        action: 'fetch_stations',
        business_id: auth.selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .from('pos_stations')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      
      setAvailableStations(data || []);
      
      // Auto-select Kitchen station if available and none selected
      if (data && data.length > 0 && selectedStations.length === 0) {
        const kitchenStation = data.find(s => s.name === 'Kitchen');
        if (kitchenStation) {
          setSelectedStations([kitchenStation.id]);
        } else {
          setSelectedStations([data[0].id]);
        }
      }
    } catch (err) {
      await logSecurityEvent('kitchen_stations_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
      
      setError('Error loading stations');
    }
  };

  // Quiet version for auto-refresh that doesn't show loading
  const fetchAllOrdersQuiet = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      const allOrders = [];
      
      // First, get inventory data to map station assignments
      const { data: inventory, error: inventoryError } = await supabase
        .from('pos_inventory')
        .select('id, station_ids')
        .eq('business_id', auth.selectedBusinessId);

      if (inventoryError) throw inventoryError;

      // Create a lookup map for inventory station assignments
      const inventoryStationMap = {};
      (inventory || []).forEach(item => {
        inventoryStationMap[item.id] = item.station_ids || [];
      });
      
      // Fetch open tabs with items (without inventory join)
      const { data: tabs, error: tabError } = await supabase
        .from('pos_tabs')
        .select(`
          *,
          pos_tab_items (
            id,
            inventory_id,
            name,
            quantity,
            unit_price,
            modifiers,
            notes,
            kitchen_status,
            prep_started_at,
            ready_at,
            completed_at,
            created_at,
            category_id
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .eq('status', 'open');

      if (tabError) throw tabError;

      // Add tabs to orders with manual station assignment
      (tabs || []).forEach(tab => {
        if (tab.pos_tab_items && tab.pos_tab_items.length > 0) {
          // Map tab items with station_id from inventory lookup
          const itemsWithStations = tab.pos_tab_items.map(item => {
            const stationIds = inventoryStationMap[item.inventory_id] || [];
            return {
              ...item,
              station_id: stationIds[0] || null, // Take first station if multiple
              station_ids: stationIds
            };
          });

          allOrders.push({
            ...tab,
            order_type: 'tab',
            order_id: tab.id,
            order_number: tab.tab_number,
            items: itemsWithStations,
            elapsedMinutes: getElapsedMinutes(tab.created_at),
            urgencyLevel: getUrgencyLevel(tab)
          });
        }
      });

      // Fetch recent sales (last 2 hours) that haven't been marked complete
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      
      // Fetch sales without inventory join
      const { data: sales, error: saleError } = await supabase
        .from('pos_sales')
        .select(`
          *,
          pos_sale_items (
            id,
            inventory_id,
            name,
            quantity,
            unit_price,
            modifiers,
            notes,
            created_at
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .gte('created_at', twoHoursAgo)
        .neq('kitchen_status', 'completed')
        .order('created_at', { ascending: false });

      if (saleError) throw saleError;

      // Add recent sales to orders with manual station assignment
      (sales || []).forEach(sale => {
        if (sale.pos_sale_items && sale.pos_sale_items.length > 0) {
          // Map sale items with station_id from inventory lookup
          const itemsWithStations = sale.pos_sale_items.map(item => {
            const stationIds = inventoryStationMap[item.inventory_id] || [];
            return {
              ...item,
              station_id: stationIds[0] || null,
              station_ids: stationIds,
              kitchen_status: sale.kitchen_status || 'new'
            };
          });

          // Only show sales that have items assigned to kitchen stations
          const hasKitchenItems = itemsWithStations.some(item => 
            item.station_ids && item.station_ids.length > 0
          );
          
          if (hasKitchenItems) {
            allOrders.push({
              ...sale,
              order_type: 'sale',
              order_id: sale.id,
              order_number: sale.sale_number || `#${sale.id.slice(-6)}`,
              items: itemsWithStations,
              kitchen_status: sale.kitchen_status || 'new',
              elapsedMinutes: getElapsedMinutes(sale.created_at),
              urgencyLevel: getUrgencyLevel(sale)
            });
          }
        }
      });

      setOrders(allOrders);

      // Update timers
      allOrders.forEach(order => {
        if (!orderTimers.current[order.order_id]) {
          startOrderTimer(order.order_id);
        }
      });

    } catch (err) {
      await logSecurityEvent('kitchen_orders_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
      // Don't show error for quiet refresh
    }
  };

  const fetchAllOrders = async () => {
    if (!auth.selectedBusinessId) return;

    setLoading(true);
    setError(null);
    
    try {
      await logSecurityEvent('kitchen_orders_accessed', {
        action: 'fetch_orders',
        business_id: auth.selectedBusinessId
      }, 'low');

      await fetchAllOrdersQuiet();

      await logAction({
        action: 'kitchen_orders_loaded',
        context: 'POSKitchenDisplay',
        metadata: { 
          total_orders: orders.length
        }
      });

    } catch (err) {
      await logSecurityEvent('kitchen_orders_load_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error loading orders: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const startOrderTimer = (orderId) => {
    orderTimers.current[orderId] = setInterval(() => {
      setOrders(prevOrders => 
        prevOrders.map(order => {
          if (order.order_id === orderId) {
            const elapsed = getElapsedMinutes(order.created_at);
            return {
              ...order,
              elapsedMinutes: elapsed,
              urgencyLevel: getUrgencyLevel({ ...order, elapsedMinutes: elapsed })
            };
          }
          return order;
        })
      );
    }, 60000);
  };

  const getElapsedMinutes = (createdAt) => {
    const created = new Date(createdAt);
    const now = new Date();
    return Math.floor((now - created) / 60000);
  };

  const getUrgencyLevel = (order) => {
    const elapsed = order.elapsedMinutes || getElapsedMinutes(order.created_at);
    
    if (elapsed >= criticalThreshold) return 'critical';
    if (elapsed >= urgentThreshold) return 'urgent';
    if (elapsed >= 10) return 'moderate';
    return 'normal';
  };

  const getUrgencyColor = (level) => {
    switch (level) {
      case 'critical': return TavariStyles.colors.danger;
      case 'urgent': return TavariStyles.colors.warning;
      case 'moderate': return TavariStyles.colors.info;
      default: return TavariStyles.colors.success;
    }
  };

  // Optimistic UI update for item status changes
  const updateItemStatusOptimistic = async (order, itemId, newStatus) => {
    if (!canManageOrders) {
      setError('You do not have permission to manage kitchen orders');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('kitchen_status_update', 30, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many status updates. Please wait a moment.');
      return;
    }

    // Update UI immediately
    setOrders(prevOrders => 
      prevOrders.map(prevOrder => {
        if (prevOrder.order_id === order.order_id) {
          return {
            ...prevOrder,
            items: prevOrder.items.map(item => 
              item.id === itemId 
                ? { ...item, kitchen_status: newStatus }
                : item
            )
          };
        }
        return prevOrder;
      })
    );

    // Then update database in background
    try {
      if (order.order_type === 'tab') {
        const updateData = { 
          kitchen_status: newStatus,
          updated_at: new Date().toISOString()
        };

        if (newStatus === 'in_progress') {
          updateData.prep_started_at = new Date().toISOString();
        } else if (newStatus === 'completed') {
          updateData.completed_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from('pos_tab_items')
          .update(updateData)
          .eq('id', itemId);

        if (error) throw error;
      } else {
        // For sales, mark the entire sale as kitchen_complete when item is completed
        if (newStatus === 'completed') {
          const { error } = await supabase
            .from('pos_sales')
            .update({ 
              kitchen_status: 'completed',
              kitchen_completed_at: new Date().toISOString()
            })
            .eq('id', order.order_id);

          if (error) throw error;
        }
      }

      await logSecurityEvent('kitchen_item_status_updated', {
        order_type: order.order_type,
        order_id: order.order_id,
        item_id: itemId,
        new_status: newStatus,
        business_id: auth.selectedBusinessId,
        updated_by: auth.authUser?.id
      }, 'low');

      await logAction({
        action: 'kitchen_item_status_updated',
        context: 'POSKitchenDisplay',
        metadata: { 
          order_type: order.order_type,
          order_id: order.order_id,
          item_id: itemId,
          new_status: newStatus
        }
      });

      await recordAction('kitchen_item_updated', { item_id: itemId, status: newStatus }, true);

    } catch (err) {
      await logSecurityEvent('kitchen_item_update_error', {
        error: err.message,
        order_id: order.order_id,
        item_id: itemId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error updating item: ' + err.message);
      // Revert optimistic update on error
      fetchAllOrdersQuiet();
    }
  };

  // Complete entire order function
  const completeOrder = async (order) => {
    if (!canCompleteOrders) {
      setError('You do not have permission to complete orders');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('kitchen_complete_order', 20, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many completion attempts. Please wait a moment.');
      return;
    }

    setError(null);
    try {
      if (order.order_type === 'tab') {
        // Mark all tab items as completed
        const { error: itemsError } = await supabase
          .from('pos_tab_items')
          .update({ 
            kitchen_status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('tab_id', order.order_id);

        if (itemsError) throw itemsError;

        // Mark tab as kitchen completed
        const { error: tabError } = await supabase
          .from('pos_tabs')
          .update({ 
            kitchen_status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', order.order_id);

        if (tabError) throw tabError;
      } else {
        // Mark sale as kitchen completed
        const { error } = await supabase
          .from('pos_sales')
          .update({ 
            kitchen_status: 'completed',
            kitchen_completed_at: new Date().toISOString()
          })
          .eq('id', order.order_id);

        if (error) throw error;
      }

      // Play completion sound
      if (soundEnabled) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 1200;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
        
        const oscillator2 = audioContext.createOscillator();
        oscillator2.connect(gainNode);
        oscillator2.frequency.value = 1600;
        oscillator2.type = 'sine';
        oscillator2.start(audioContext.currentTime + 0.1);
        oscillator2.stop(audioContext.currentTime + 0.2);
      }

      await logSecurityEvent('kitchen_order_completed', {
        order_type: order.order_type,
        order_id: order.order_id,
        business_id: auth.selectedBusinessId,
        completed_by: auth.authUser?.id
      }, 'low');

      await logAction({
        action: 'kitchen_order_completed',
        context: 'POSKitchenDisplay',
        metadata: { 
          order_type: order.order_type,
          order_id: order.order_id
        }
      });

      await recordAction('kitchen_order_completed', { order_id: order.order_id }, true);

      // Clear timer if order is completed
      if (orderTimers.current[order.order_id]) {
        clearInterval(orderTimers.current[order.order_id]);
        delete orderTimers.current[order.order_id];
      }

      // Refresh orders to remove completed order
      fetchAllOrdersQuiet();

    } catch (err) {
      await logSecurityEvent('kitchen_order_complete_error', {
        error: err.message,
        order_id: order.order_id,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error completing order: ' + err.message);
    }
  };

  const filteredOrders = orders.map(order => {
    // Filter by order type
    if (orderType !== 'all' && order.order_type !== orderType) {
      return null;
    }

    // Filter by kitchen status
    if (filterStatus !== 'all' && order.kitchen_status !== filterStatus) {
      return null;
    }

    // Filter items by station if in single station mode
    let filteredItems = order.items;
    if (displayMode === 'single' && selectedStations.length > 0 && selectedStations[0]) {
      const selectedStationId = selectedStations[0];
      const selectedStation = availableStations.find(s => s.id === selectedStationId);
      const selectedStationName = selectedStation?.name;
      
      filteredItems = order.items?.filter(item => {
        if (!item.station_ids || !Array.isArray(item.station_ids)) return false;
        
        // Check if this specific item is assigned to the selected station
        return item.station_ids.includes(selectedStationId) || 
               item.station_ids.includes(selectedStationName);
      }) || [];
    }

    // Only show items that need kitchen attention after station filtering
    const itemsNeedingAttention = filteredItems.filter(item => 
      !item.kitchen_status || item.kitchen_status !== 'completed'
    );

    if (itemsNeedingAttention.length === 0) {
      return null;
    }

    return {
      ...order,
      items: itemsNeedingAttention
    };
  }).filter(Boolean);

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    switch (sortBy) {
      case 'urgency':
        const urgencyOrder = { critical: 0, urgent: 1, moderate: 2, normal: 3 };
        return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
      case 'station':
        return (a.items?.[0]?.station_id || '').localeCompare(
          b.items?.[0]?.station_id || ''
        );
      default: // time
        return new Date(a.created_at) - new Date(b.created_at);
    }
  });

  const renderOrderCard = (order) => {
    const urgencyColor = getUrgencyColor(order.urgencyLevel);
    const isTab = order.order_type === 'tab';
    
    return (
      <div
        key={order.order_id}
        style={{
          ...styles.orderCard,
          borderLeftColor: urgencyColor,
          borderLeftWidth: '4px',
          animation: order.kitchen_status === 'new' ? 'pulse 2s infinite' : 'none'
        }}
      >
        <div style={styles.orderHeader}>
          <div style={styles.orderNumber}>
            {isTab ? `Tab #${order.order_number}` : `Order ${order.order_number}`}
          </div>
          <div style={styles.orderTimer}>
            <span style={{ color: urgencyColor }}>
              {order.elapsedMinutes}m
            </span>
          </div>
        </div>

        <div style={styles.orderDetails}>
          <div style={styles.customerInfo}>
            {order.customer_name || 'Walk-in Customer'}
            {order.table_number && ` • Table ${order.table_number}`}
          </div>
          
          <div style={styles.orderType}>
            {isTab ? 'TAB' : 'PAID'} • {order.order_type === 'sale' ? 'Takeout' : 'Dine-in'}
          </div>
        </div>

        <div style={styles.orderItems}>
          {order.items?.filter(item => 
            !item.kitchen_status || item.kitchen_status !== 'completed'
          ).map(item => (
            <div 
              key={item.id} 
              style={{
                ...styles.orderItem,
                backgroundColor: item.kitchen_status === 'completed' 
                  ? TavariStyles.colors.successBg 
                  : item.kitchen_status === 'in_progress'
                  ? TavariStyles.colors.infoBg
                  : TavariStyles.colors.gray50
              }}
            >
              <div style={styles.itemQuantity}>{item.quantity}x</div>
              <div style={styles.itemDetails}>
                <div style={styles.itemName}>
                  {item.name}
                </div>
                {item.modifiers && item.modifiers.length > 0 && (
                  <div style={styles.itemModifiers}>
                    {Array.isArray(item.modifiers) ? 
                      item.modifiers.map((mod, idx) => (
                        <span key={idx} style={styles.modifier}>
                          • {typeof mod === 'object' ? mod.name : mod}
                        </span>
                      )) : 
                      <span style={styles.modifier}>• {item.modifiers}</span>
                    }
                  </div>
                )}
                {item.notes && (
                  <div style={styles.itemNotes}>
                    Note: {item.notes}
                  </div>
                )}
                {isTab && canManageOrders && (
                  <div style={styles.itemActions}>
                    {(!item.kitchen_status || item.kitchen_status === 'new') && (
                      <button
                        onClick={() => updateItemStatusOptimistic(order, item.id, 'in_progress')}
                        style={styles.startButton}
                      >
                        Start
                      </button>
                    )}
                    
                    {item.kitchen_status === 'in_progress' && (
                      <button
                        onClick={() => updateItemStatusOptimistic(order, item.id, 'completed')}
                        style={styles.completeButton}
                      >
                        Complete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {canCompleteOrders && (
          <div style={styles.orderActions}>
            <button
              onClick={() => completeOrder(order)}
              style={styles.completeOrderButton}
            >
              Complete Order
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderStationView = (stationId, gridArea = null) => {
    const station = availableStations.find(s => s.id === stationId);
    if (!station) return null;

    const stationOrders = sortedOrders.filter(order =>
      order.items?.some(item => {
        if (!item.station_ids || !Array.isArray(item.station_ids)) return false;
        
        // Check if station_ids contains either the UUID or the station name
        return item.station_ids.includes(stationId) || 
               item.station_ids.includes(station.name);
      })
    );

    return (
      <div style={{ ...styles.stationView, gridArea }}>
        <div style={styles.stationHeader}>
          <h3 style={styles.stationTitle}>{station.name}</h3>
          <span style={styles.orderCount}>{stationOrders.length} orders</span>
        </div>
        
        <div style={styles.ordersGrid}>
          {stationOrders.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>✓</div>
              <div style={styles.emptyText}>No pending orders</div>
            </div>
          ) : (
            stationOrders.map(order => renderOrderCard(order))
          )}
        </div>
      </div>
    );
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray900,
      minHeight: '100vh'
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      marginBottom: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows.md
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    controls: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center',
      flexWrap: 'wrap'
    },
    
    controlGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center'
    },
    
    select: {
      ...TavariStyles.components.form.select,
      minWidth: '150px'
    },
    
    button: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    
    activeButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm
    },
    
    displayContainer: {
      display: 'grid',
      gap: TavariStyles.spacing.lg,
      height: 'calc(100vh - 200px)'
    },
    
    singleDisplay: {
      gridTemplateColumns: '1fr'
    },
    
    splitDisplay: {
      gridTemplateColumns: '1fr 1fr'
    },
    
    quadDisplay: {
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr'
    },
    
    stationView: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    },
    
    stationHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    
    stationTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      margin: 0
    },
    
    orderCount: {
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    ordersGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      flex: 1,
      overflowY: 'auto',
      backgroundColor: TavariStyles.colors.gray50
    },
    
    orderCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      boxShadow: TavariStyles.shadows.sm,
      border: '1px solid ' + TavariStyles.colors.gray200,
      borderLeftStyle: 'solid',
      height: 'fit-content'
    },
    
    orderHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.sm,
      paddingBottom: TavariStyles.spacing.sm,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    orderNumber: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    orderTimer: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    orderDetails: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    
    customerInfo: {
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    orderType: {
      backgroundColor: TavariStyles.colors.gray100,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs
    },
    
    orderItems: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.md
    },
    
    orderItem: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'flex-start',
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    itemQuantity: {
      minWidth: '30px',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    itemDetails: {
      flex: 1
    },
    
    itemName: {
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    itemModifiers: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    
    modifier: {
      marginRight: TavariStyles.spacing.sm
    },
    
    itemNotes: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.warning,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.xs
    },
    
    itemActions: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      marginTop: TavariStyles.spacing.sm
    },
    
    orderActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      paddingTop: TavariStyles.spacing.md,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    startButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`
    },
    
    completeButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.success,
      ...TavariStyles.components.button.sizes.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`
    },
    
    completeOrderButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.success,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1
    },
    
    emptyState: {
      gridColumn: '1 / -1',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray500
    },
    
    emptyIcon: {
      fontSize: '48px',
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.success
    },
    
    emptyText: {
      fontSize: TavariStyles.typography.fontSize.lg
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.xl
    },
    
    loading: {
      ...TavariStyles.components.loading.container,
      color: TavariStyles.colors.white
    },

    noAccessContainer: {
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      margin: TavariStyles.spacing.xl
    },

    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    }
  };

  const loadingContent = (
    <div style={styles.container}>
      <div style={styles.loading}>Loading kitchen display...</div>
    </div>
  );

  if (loading || permissionsLoading) return loadingContent;

  // Check overall access permission
  if (!canViewKitchen) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POSKitchenDisplay"
        >
          <div style={styles.container}>
            <div style={styles.noAccessContainer}>
              <h3 style={styles.errorBanner}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to view the kitchen display.
              </p>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="POSKitchenDisplay"
        loadingContent={loadingContent}
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h1 style={styles.title}>Kitchen Display System</h1>
            
            <div style={styles.controls}>
              <div style={styles.controlGroup}>
                <label>Display:</label>
                <select
                  value={displayMode}
                  onChange={(e) => setDisplayMode(e.target.value)}
                  style={styles.select}
                >
                  <option value="single">Single Station</option>
                  <option value="split">Split Screen</option>
                  <option value="quad">Quad View</option>
                </select>
              </div>

              {displayMode === 'single' && (
                <div style={styles.controlGroup}>
                  <label>Station:</label>
                  <select
                    value={selectedStations[0] || ''}
                    onChange={(e) => setSelectedStations([e.target.value])}
                    style={styles.select}
                  >
                    <option value="">All Stations</option>
                    {availableStations.map(station => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={styles.controlGroup}>
                <label>Orders:</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                  style={styles.select}
                >
                  <option value="all">All Orders</option>
                  <option value="tabs">Tabs Only</option>
                  <option value="sales">Paid Orders</option>
                </select>
              </div>

              <div style={styles.controlGroup}>
                <label>Filter:</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={styles.select}
                >
                  <option value="all">All Statuses</option>
                  <option value="new">New</option>
                  <option value="in_progress">In Progress</option>
                  <option value="ready">Ready</option>
                </select>
              </div>

              <div style={styles.controlGroup}>
                <label>Sort:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={styles.select}
                >
                  <option value="time">Time</option>
                  <option value="urgency">Urgency</option>
                  <option value="station">Station</option>
                </select>
              </div>

              {canChangeSettings && (
                <>
                  <button
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    style={soundEnabled ? styles.activeButton : styles.button}
                    title={soundEnabled ? 'Sound On' : 'Sound Off'}
                  >
                    {soundEnabled ? '🔊' : '🔇'}
                  </button>

                  <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    style={autoRefresh ? styles.activeButton : styles.button}
                    title={autoRefresh ? 'Auto-refresh On' : 'Auto-refresh Off'}
                  >
                    {autoRefresh ? '🔄' : '⸏'}
                  </button>
                </>
              )}

              <button
                onClick={fetchAllOrders}
                style={styles.button}
                title="Refresh Now"
              >
                Refresh
              </button>
            </div>
          </div>

          {error && <div style={styles.errorBanner}>{error}</div>}

          <div style={{
            ...styles.displayContainer,
            ...(displayMode === 'single' ? styles.singleDisplay :
                displayMode === 'split' ? styles.splitDisplay :
                styles.quadDisplay)
          }}>
            {displayMode === 'single' && (
              selectedStations.length > 0 && selectedStations[0] ? 
                renderStationView(selectedStations[0]) :
                <div style={styles.stationView}>
                  <div style={styles.stationHeader}>
                    <h3 style={styles.stationTitle}>All Stations</h3>
                    <span style={styles.orderCount}>{sortedOrders.length} orders</span>
                  </div>
                  <div style={styles.ordersGrid}>
                    {sortedOrders.length === 0 ? (
                      <div style={styles.emptyState}>
                        <div style={styles.emptyIcon}>✓</div>
                        <div style={styles.emptyText}>No pending orders</div>
                      </div>
                    ) : (
                      sortedOrders.map(order => renderOrderCard(order))
                    )}
                  </div>
                </div>
            )}

            {displayMode === 'split' && availableStations.slice(0, 2).map(station => 
              renderStationView(station.id)
            )}

            {displayMode === 'quad' && availableStations.slice(0, 4).map(station => 
              renderStationView(station.id)
            )}
          </div>
        </div>

        <style>
          {`
            @keyframes pulse {
              0% { opacity: 1; }
              50% { opacity: 0.7; }
              100% { opacity: 1; }
            }
          `}
        </style>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSKitchenDisplay;
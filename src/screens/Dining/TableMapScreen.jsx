// screens/Dining/TableMapScreen.jsx - WITH NEW PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';
import TableMapCanvas from '../../components/Dining/TableMapCanvas';
import GuestCountModal from '../../components/Dining/GuestCountModal';
import { FiEdit2, FiUsers, FiClock, FiLock } from 'react-icons/fi';
import toast from 'react-hot-toast';

const TableMapScreen = () => {
  const navigate = useNavigate();
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'TableMapScreen'
  });

  // NEW: Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const [tables, setTables] = useState([]);
  const [floorPlan, setFloorPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [activeOrders, setActiveOrders] = useState([]);
  const [showGuestCountModal, setShowGuestCountModal] = useState(false);

  // Filter state
  const [filterStatus, setFilterStatus] = useState('all');

  // Permission checks
  const canViewTables = hasPermission('dining.tables.view');
  const canTakeOrders = hasPermission('dining.orders.create');
  const canEditFloorPlan = hasPermission('dining.floorplan.edit');

  // Check permissions on load
  useEffect(() => {
    if (!permissionsLoading && !canViewTables) {
      toast.error('You do not have permission to view the table map');
      navigate('/dashboard/home');
    }
  }, [permissionsLoading, canViewTables, navigate]);

  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading) {
      loadFloorPlan();
      loadActiveOrders();
    }
  }, [auth.selectedBusinessId, permissionsLoading]);

  const loadFloorPlan = async () => {
    try {
      setLoading(true);
      
      const { data: planData, error: planError } = await supabase
        .from('dining_floor_plans')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .single();

      if (planError && planError.code !== 'PGRST116') throw planError;

      const { data: tablesData, error: tablesError } = await supabase
        .from('dining_tables')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .order('table_number');

      if (tablesError) throw tablesError;

      setFloorPlan(planData);
      setTables(tablesData || []);
      
    } catch (err) {
      console.error('Error loading floor plan:', err);
      setError(err.message);
      toast.error('Failed to load floor plan');
    } finally {
      setLoading(false);
    }
  };

  const loadActiveOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('pos_tabs')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('status', 'open')
        .not('table_id', 'is', null);

      if (error) throw error;
      setActiveOrders(data || []);
    } catch (err) {
      console.error('Error loading orders:', err);
    }
  };

  const handleTableClick = (table) => {
    // Check permission to take orders
    if (!canTakeOrders) {
      toast.error('You do not have permission to take table orders');
      return;
    }

    setSelectedTable(table);
    
    // Check if table already has an active order
    const existingOrder = activeOrders.find(order => order.table_id === table.id);
    
    if (existingOrder) {
      // Go directly to dining order screen with existing tab
      navigate('/dashboard/dining/table-order', {
        state: {
          activeTab: existingOrder,
          mode: 'dining',
          tableId: table.id,
          tableName: table.table_name || `Table ${table.table_number}`,
          guestCount: existingOrder.guest_count || 2
        }
      });
    } else {
      // Show guest count modal for new order
      setShowGuestCountModal(true);
    }
  };

  const handleGuestCountConfirm = async (guestCount) => {
    // Check permission
    if (!canTakeOrders) {
      toast.error('You do not have permission to start table orders');
      return;
    }

    try {
      // Create new tab for this table
      const tabNumber = `T${selectedTable.table_number}-${Date.now().toString().slice(-6)}`;
    
      const { data: newTab, error: tabError } = await supabase
        .from('pos_tabs')
        .insert([{
          business_id: auth.selectedBusinessId,
          tab_number: tabNumber,
          table_id: selectedTable.id,
          guest_count: guestCount,
          status: 'open',
          customer_name: `Table ${selectedTable.table_number}`,
          created_by: auth.authUser.id,
          started_by: auth.authUser.id
        }])
        .select()
        .single();

      if (tabError) throw tabError;

      toast.success(`Started order for Table ${selectedTable.table_number}`);

      // Navigate to dining order screen with new tab
      navigate('/dashboard/dining/table-order', {
        state: {
          activeTab: newTab,
          mode: 'dining',
          tableId: selectedTable.id,
          tableName: selectedTable.table_name || `Table ${selectedTable.table_number}`,
          guestCount: guestCount
        }
      });
    } catch (err) {
      console.error('Error creating tab:', err);
      toast.error('Error starting table order: ' + err.message);
    } finally {
      setShowGuestCountModal(false);
      setSelectedTable(null);
    }
  };

  const handleGuestCountCancel = () => {
    setShowGuestCountModal(false);
    setSelectedTable(null);
  };

  const handleEditFloorPlan = () => {
    // Check permission
    if (!canEditFloorPlan) {
      toast.error('You do not have permission to edit the floor plan');
      return;
    }
    
    navigate('/dashboard/dining/floor-editor');
  };

  const getTableStatus = (table) => {
    const hasOrder = activeOrders.some(order => order.table_id === table.id);
    if (hasOrder) return 'occupied';
    if (table.is_reserved) return 'reserved';
    return 'available';
  };

  const filteredTables = tables.filter(table => {
    if (filterStatus === 'all') return true;
    return getTableStatus(table) === filterStatus;
  });

  const stats = {
    total: tables.length,
    available: tables.filter(t => getTableStatus(t) === 'available').length,
    occupied: tables.filter(t => getTableStatus(t) === 'occupied').length,
    reserved: tables.filter(t => getTableStatus(t) === 'reserved').length
  };

  // Loading state
  if (loading || permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.loadingSpinner}></div>
          <p style={styles.loadingText}>Loading floor plan...</p>
        </div>
      </div>
    );
  }

  // No access screen
  if (!canViewTables) {
    return (
      <div style={styles.noAccessContainer}>
        <div style={styles.noAccessCard}>
          <FiLock size={64} style={styles.lockIcon} />
          <h2 style={styles.noAccessTitle}>Access Denied</h2>
          <p style={styles.noAccessText}>
            You do not have permission to view the table map.
          </p>
          <div style={styles.permissionsRequired}>
            <strong>Required Permission:</strong> View Table Map
          </div>
          <button 
            style={styles.backButton}
            onClick={() => navigate('/dashboard/home')}
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Table Map</h1>
          <p style={styles.subtitle}>Manage your dining room</p>
        </div>
        
        {/* Edit Floor Plan Button - Protected */}
        <PermissionGate 
          permission="dining.floorplan.edit"
          fallback={
            <button
              style={styles.editButtonDisabled}
              disabled
              title="You don't have permission to edit the floor plan"
            >
              <FiLock size={16} /> Floor Plan Locked
            </button>
          }
        >
          <button
            style={styles.editButton}
            onClick={handleEditFloorPlan}
          >
            <FiEdit2 /> Edit Floor Plan
          </button>
        </PermissionGate>
      </div>

      {/* Stats Bar */}
      <div style={styles.statsBar}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.total}</div>
          <div style={styles.statLabel}>Total Tables</div>
        </div>
        <div style={{...styles.statCard, ...styles.statAvailable}}>
          <div style={styles.statValue}>{stats.available}</div>
          <div style={styles.statLabel}>Available</div>
        </div>
        <div style={{...styles.statCard, ...styles.statOccupied}}>
          <div style={styles.statValue}>{stats.occupied}</div>
          <div style={styles.statLabel}>Occupied</div>
        </div>
        <div style={{...styles.statCard, ...styles.statReserved}}>
          <div style={styles.statValue}>{stats.reserved}</div>
          <div style={styles.statLabel}>Reserved</div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div style={styles.filterBar}>
        {['all', 'available', 'occupied', 'reserved'].map(status => (
          <button
            key={status}
            style={{
              ...styles.filterButton,
              ...(filterStatus === status ? styles.filterButtonActive : {})
            }}
            onClick={() => setFilterStatus(status)}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Table Map Canvas */}
      <div style={styles.canvasContainer}>
        {tables.length === 0 ? (
          <div style={styles.emptyState}>
            <FiUsers size={48} />
            <h3>No Tables Yet</h3>
            <PermissionGate permission="dining.floorplan.edit">
              <p>Click "Edit Floor Plan" to add tables to your dining room</p>
            </PermissionGate>
            <PermissionGate permission="dining.floorplan.edit" invert>
              <p>Contact your manager to set up the floor plan</p>
            </PermissionGate>
          </div>
        ) : (
          <TableMapCanvas
            tables={filteredTables}
            floorPlan={floorPlan}
            activeOrders={activeOrders}
            onTableClick={handleTableClick}
            getTableStatus={getTableStatus}
            readonly={true}
            canTakeOrders={canTakeOrders}
          />
        )}
      </div>

      {/* Guest Count Modal */}
      {showGuestCountModal && selectedTable && (
        <GuestCountModal
          table={selectedTable}
          onConfirm={handleGuestCountConfirm}
          onCancel={handleGuestCountCancel}
        />
      )}

      {error && (
        <div style={styles.errorBanner}>
          {error}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: TavariStyles.colors.gray50,
    paddingTop: '80px',
    overflow: 'hidden'
  },
  
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '20px'
  },

  loadingSpinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #14B8A6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },

  loadingText: {
    fontSize: '16px',
    color: '#666'
  },

  noAccessContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '40px'
  },

  noAccessCard: {
    backgroundColor: '#fff',
    border: '2px solid #e9ecef',
    borderRadius: '12px',
    padding: '50px',
    maxWidth: '500px',
    textAlign: 'center'
  },

  lockIcon: {
    color: '#dc3545',
    marginBottom: '20px'
  },

  noAccessTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#dc3545',
    marginBottom: '15px'
  },

  noAccessText: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '20px'
  },

  permissionsRequired: {
    backgroundColor: '#f8f9fa',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '20px',
    fontSize: '14px'
  },

  backButton: {
    padding: '12px 24px',
    backgroundColor: '#14B8A6',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.xl,
    backgroundColor: 'white',
    borderBottom: `2px solid ${TavariStyles.colors.gray200}`
  },

  headerLeft: {
    flex: 1
  },

  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray900,
    margin: '0 0 4px 0'
  },

  subtitle: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600,
    margin: 0
  },

  editButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    backgroundColor: '#14B8A6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },

  editButtonDisabled: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    backgroundColor: '#e9ecef',
    color: '#6c757d',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'not-allowed',
    opacity: 0.6
  },

  statsBar: {
    display: 'flex',
    gap: '20px',
    padding: TavariStyles.spacing.lg,
    backgroundColor: 'white',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },

  statCard: {
    flex: 1,
    padding: '20px',
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: '8px',
    textAlign: 'center',
    border: `2px solid ${TavariStyles.colors.gray200}`
  },

  statAvailable: {
    backgroundColor: '#d1fae5',
    borderColor: '#10b981'
  },

  statOccupied: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444'
  },

  statReserved: {
    backgroundColor: '#dbeafe',
    borderColor: '#3b82f6'
  },

  statValue: {
    fontSize: '33px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray900,
    marginBottom: '4px'
  },

  statLabel: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },

  filterBar: {
    display: 'flex',
    gap: '12px',
    padding: TavariStyles.spacing.lg,
    backgroundColor: 'white',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },

  filterButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: TavariStyles.colors.gray700,
    border: `2px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },

  filterButtonActive: {
    backgroundColor: '#14B8A6',
    color: 'white',
    borderColor: '#14B8A6'
  },

  canvasContainer: {
    flex: 1,
    overflow: 'auto',
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.gray50
  },

  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: TavariStyles.colors.gray500,
    gap: '20px'
  },

  errorBanner: {
    position: 'fixed',
    top: '100px',
    right: '20px',
    padding: '16px 24px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    borderRadius: '8px',
    border: '1px solid #fecaca',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    zIndex: 1000
  }
};

// Add CSS animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
if (!document.querySelector('#table-map-styles')) {
  styleSheet.id = 'table-map-styles';
  document.head.appendChild(styleSheet);
}

export default TableMapScreen;
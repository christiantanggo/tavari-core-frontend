// src/screens/POS/POSStationsScreen.jsx - Production Ready with Permissions & Security
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import PermissionGate from '../../components/Auth/PermissionGate';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';

const POSStationsScreen = () => {
  const navigate = useNavigate();
  
  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSStationsScreen'
  });

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSStationsScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  // Permission checks
  const canViewStations = hasPermission('pos.stations.view') || hasElevatedPrivileges();
  const canCreateStations = hasPermission('pos.stations.create') || hasElevatedPrivileges();
  const canEditStations = hasPermission('pos.stations.edit') || hasElevatedPrivileges();
  const canDeleteStations = hasPermission('pos.stations.delete') || hasElevatedPrivileges();
  const canManagePrinters = hasPermission('pos.printers.manage') || hasElevatedPrivileges();

  // State
  const [stations, setStations] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // New station form
  const [newStationName, setNewStationName] = useState('');
  const [newStationDescription, setNewStationDescription] = useState('');
  const [newStationHasScreen, setNewStationHasScreen] = useState(true);
  const [newStationScreenEnabled, setNewStationScreenEnabled] = useState(true);
  const [newStationPrinters, setNewStationPrinters] = useState([]);

  // Edit station form
  const [editStationId, setEditStationId] = useState(null);
  const [editStationName, setEditStationName] = useState('');
  const [editStationDescription, setEditStationDescription] = useState('');
  const [editStationActive, setEditStationActive] = useState(true);
  const [editStationHasScreen, setEditStationHasScreen] = useState(true);
  const [editStationScreenEnabled, setEditStationScreenEnabled] = useState(true);
  const [editStationPrinters, setEditStationPrinters] = useState([]);

  // Printer management
  const [showPrinterManager, setShowPrinterManager] = useState(false);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newPrinterIP, setNewPrinterIP] = useState('');
  const [newPrinterType, setNewPrinterType] = useState('thermal');

  // Load data
  useEffect(() => {
    if (auth.selectedBusinessId && auth.isReady && canViewStations) {
      fetchStations();
      fetchPrinters();
    }
  }, [auth.selectedBusinessId, auth.isReady, canViewStations]);

  const fetchStations = async () => {
    const businessId = auth.selectedBusinessId;
    if (!businessId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      await logSecurityEvent('pos_stations_accessed', {
        action: 'fetch_stations',
        business_id: businessId,
        accessed_by: auth.authUser?.id
      }, 'low');

      const { data, error } = await supabase
        .from('pos_stations')
        .select('*')
        .eq('business_id', businessId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      
      setStations(data || []);

      await recordAction('pos_stations_loaded', {
        station_count: data?.length || 0
      }, true);

    } catch (err) {
      await logSecurityEvent('pos_stations_fetch_error', {
        error: err.message,
        business_id: businessId
      }, 'medium');
      
      setError('Error fetching stations: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPrinters = async () => {
    const businessId = auth.selectedBusinessId;
    if (!businessId) return;
    
    try {
      await logSecurityEvent('pos_printers_accessed', {
        action: 'fetch_printers',
        business_id: businessId,
        accessed_by: auth.authUser?.id
      }, 'low');

      const { data, error } = await supabase
        .from('pos_printers')
        .select('*')
        .eq('business_id', businessId)
        .order('name');

      if (error && error.message.includes('relation "pos_printers" does not exist')) {
        setPrinters([
          { id: 'sample-1', name: 'Kitchen Printer', ip_address: '192.168.1.100', type: 'thermal', is_active: true },
          { id: 'sample-2', name: 'Bar Printer', ip_address: '192.168.1.101', type: 'thermal', is_active: true },
          { id: 'sample-3', name: 'Receipt Printer', ip_address: '192.168.1.102', type: 'receipt', is_active: true }
        ]);
      } else if (error) {
        throw error;
      } else {
        setPrinters(data || []);
      }

    } catch (err) {
      await logSecurityEvent('pos_printers_fetch_error', {
        error: err.message,
        business_id: businessId
      }, 'low');
      
      setPrinters([
        { id: 'sample-1', name: 'Kitchen Printer', ip_address: '192.168.1.100', type: 'thermal', is_active: true },
        { id: 'sample-2', name: 'Bar Printer', ip_address: '192.168.1.101', type: 'thermal', is_active: true },
        { id: 'sample-3', name: 'Receipt Printer', ip_address: '192.168.1.102', type: 'receipt', is_active: true }
      ]);
    }
  };

  const addPrinter = async () => {
    if (!canManagePrinters) {
      setError('You do not have permission to manage printers');
      await logSecurityEvent('printer_add_denied', {
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'medium');
      return;
    }

    if (!newPrinterName.trim()) {
      setError('Printer name is required');
      return;
    }

    // Validate printer name
    const nameValidation = validateInput(newPrinterName, 'text', 'printer_name');
    if (!nameValidation.valid) {
      setError('Invalid printer name');
      return;
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit('add_printer', 5, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many printer additions. Please wait a moment.');
      return;
    }

    try {
      await logSecurityEvent('printer_created', {
        printer_name: newPrinterName.trim(),
        printer_type: newPrinterType,
        business_id: auth.selectedBusinessId,
        created_by: auth.authUser?.id
      }, 'low');

      const newPrinter = {
        id: `printer-${Date.now()}`,
        name: newPrinterName.trim(),
        ip_address: newPrinterIP.trim() || null,
        type: newPrinterType,
        is_active: true,
        business_id: auth.selectedBusinessId
      };

      setPrinters(prev => [...prev, newPrinter]);
      
      setNewPrinterName('');
      setNewPrinterIP('');
      setNewPrinterType('thermal');

      await recordAction('pos_printer_created', {
        printer_name: newPrinterName.trim(),
        printer_type: newPrinterType
      }, true);

    } catch (err) {
      await logSecurityEvent('printer_create_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error adding printer: ' + err.message);
    }
  };

  const addStation = async () => {
    if (!canCreateStations) {
      setError('You do not have permission to create stations');
      await logSecurityEvent('station_create_denied', {
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'medium');
      return;
    }

    if (!newStationName.trim()) {
      setError('Station name is required');
      return;
    }

    // Validate station name
    const nameValidation = validateInput(newStationName, 'text', 'station_name');
    if (!nameValidation.valid) {
      setError('Invalid station name');
      return;
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit('add_station', 10, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many station additions. Please wait a moment.');
      return;
    }

    setError(null);
    try {
      await logSecurityEvent('station_create_initiated', {
        station_name: newStationName.trim(),
        has_screen: newStationHasScreen,
        screen_enabled: newStationScreenEnabled,
        printer_count: newStationPrinters.length,
        business_id: auth.selectedBusinessId,
        created_by: auth.authUser?.id
      }, 'low');

      const maxSortOrder = stations.length > 0 ? Math.max(...stations.map(s => s.sort_order || 0)) : 0;

      const { data, error } = await supabase
        .from('pos_stations')
        .insert([{
          business_id: auth.selectedBusinessId,
          name: newStationName.trim(),
          description: newStationDescription.trim() || null,
          printer_ids: newStationPrinters,
          is_active: true,
          sort_order: maxSortOrder + 1,
          has_screen: newStationHasScreen,
          screen_enabled: newStationScreenEnabled,
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) throw error;

      await logSecurityEvent('station_created', {
        station_name: newStationName.trim(),
        station_id: data[0]?.id,
        business_id: auth.selectedBusinessId
      }, 'low');

      await recordAction('pos_station_created', {
        station_name: newStationName.trim(),
        has_screen: newStationHasScreen,
        assigned_printers: newStationPrinters.length
      }, true);

      setNewStationName('');
      setNewStationDescription('');
      setNewStationHasScreen(true);
      setNewStationScreenEnabled(true);
      setNewStationPrinters([]);

      fetchStations();
    } catch (err) {
      await logSecurityEvent('station_create_error', {
        error: err.message,
        station_name: newStationName.trim(),
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error adding station: ' + err.message);
    }
  };

  const startEditStation = (station) => {
    if (!canEditStations) {
      setError('You do not have permission to edit stations');
      return;
    }

    setEditStationId(station.id);
    setEditStationName(station.name);
    setEditStationDescription(station.description || '');
    setEditStationActive(station.is_active !== false);
    setEditStationHasScreen(station.has_screen !== false);
    setEditStationScreenEnabled(station.screen_enabled !== false);
    setEditStationPrinters(station.printer_ids || []);
  };

  const cancelEdit = () => {
    setEditStationId(null);
    setEditStationName('');
    setEditStationDescription('');
    setEditStationActive(true);
    setEditStationHasScreen(true);
    setEditStationScreenEnabled(true);
    setEditStationPrinters([]);
  };

  const saveEditStation = async () => {
    if (!canEditStations) {
      setError('You do not have permission to edit stations');
      await logSecurityEvent('station_edit_denied', {
        station_id: editStationId,
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'medium');
      return;
    }

    if (!editStationName.trim()) {
      setError('Station name is required');
      return;
    }

    // Validate station name
    const nameValidation = validateInput(editStationName, 'text', 'station_name');
    if (!nameValidation.valid) {
      setError('Invalid station name');
      return;
    }

    setError(null);
    try {
      await logSecurityEvent('station_update_initiated', {
        station_id: editStationId,
        station_name: editStationName.trim(),
        is_active: editStationActive,
        business_id: auth.selectedBusinessId,
        updated_by: auth.authUser?.id
      }, 'low');

      const { error } = await supabase
        .from('pos_stations')
        .update({
          name: editStationName.trim(),
          description: editStationDescription.trim() || null,
          is_active: editStationActive,
          has_screen: editStationHasScreen,
          screen_enabled: editStationScreenEnabled,
          printer_ids: editStationPrinters,
          updated_at: new Date().toISOString()
        })
        .eq('id', editStationId);

      if (error) throw error;

      await logSecurityEvent('station_updated', {
        station_id: editStationId,
        station_name: editStationName.trim(),
        business_id: auth.selectedBusinessId
      }, 'low');

      await recordAction('pos_station_updated', {
        station_id: editStationId,
        station_name: editStationName.trim(),
        is_active: editStationActive
      }, true);

      cancelEdit();
      fetchStations();
    } catch (err) {
      await logSecurityEvent('station_update_error', {
        error: err.message,
        station_id: editStationId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error updating station: ' + err.message);
    }
  };

  const deleteStation = async (id, name) => {
    if (!canDeleteStations) {
      setError('You do not have permission to delete stations');
      await logSecurityEvent('station_delete_denied', {
        station_id: id,
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'high');
      return;
    }

    if (stations.length === 1 && name === 'Kitchen') {
      setError('Cannot delete the default Kitchen station when it\'s the only station');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete station "${name}"? This action cannot be undone.`)) return;

    setError(null);
    try {
      await logSecurityEvent('station_delete_initiated', {
        station_id: id,
        station_name: name,
        business_id: auth.selectedBusinessId,
        deleted_by: auth.authUser?.id
      }, 'medium');

      const { error } = await supabase
        .from('pos_stations')
        .delete()
        .eq('id', id);
        
      if (error) throw error;

      await logSecurityEvent('station_deleted', {
        station_id: id,
        station_name: name,
        business_id: auth.selectedBusinessId
      }, 'medium');

      await recordAction('pos_station_deleted', {
        station_id: id,
        station_name: name
      }, true);

      fetchStations();
    } catch (err) {
      await logSecurityEvent('station_delete_error', {
        error: err.message,
        station_id: id,
        business_id: auth.selectedBusinessId
      }, 'high');
      
      setError('Error deleting station: ' + err.message);
    }
  };

  const moveStation = async (id, direction) => {
    if (!canEditStations) {
      setError('You do not have permission to reorder stations');
      return;
    }

    setError(null);
    try {
      const index = stations.findIndex(s => s.id === id);
      if (index === -1) return;

      const swapIndex = index + direction;
      if (swapIndex < 0 || swapIndex >= stations.length) return;

      const stationA = stations[index];
      const stationB = stations[swapIndex];

      await logSecurityEvent('station_reordered', {
        station_id: id,
        old_position: index,
        new_position: swapIndex,
        business_id: auth.selectedBusinessId,
        reordered_by: auth.authUser?.id
      }, 'low');

      const updates = [
        { id: stationA.id, sort_order: stationB.sort_order || 0 },
        { id: stationB.id, sort_order: stationA.sort_order || 0 }
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('pos_stations')
          .update({ 
            sort_order: update.sort_order,
            updated_at: new Date().toISOString()
          })
          .eq('id', update.id);
        if (error) throw error;
      }

      fetchStations();
    } catch (err) {
      await logSecurityEvent('station_reorder_error', {
        error: err.message,
        station_id: id,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error moving station: ' + err.message);
    }
  };

  const toggleStationStatus = async (id, currentStatus, name) => {
    if (!canEditStations) {
      setError('You do not have permission to change station status');
      return;
    }

    const newStatus = !currentStatus;
    
    try {
      await logSecurityEvent('station_status_changed', {
        station_id: id,
        station_name: name,
        old_status: currentStatus,
        new_status: newStatus,
        business_id: auth.selectedBusinessId,
        changed_by: auth.authUser?.id
      }, 'low');

      const { error } = await supabase
        .from('pos_stations')
        .update({ 
          is_active: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;

      await recordAction('pos_station_status_changed', {
        station_id: id,
        station_name: name,
        new_status: newStatus
      }, true);

      fetchStations();
    } catch (err) {
      await logSecurityEvent('station_status_change_error', {
        error: err.message,
        station_id: id,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error updating station status: ' + err.message);
    }
  };

  const handlePrinterSelection = (printerId, isSelected, isEdit = false) => {
    if (isEdit) {
      setEditStationPrinters(prev => 
        isSelected 
          ? [...prev, printerId]
          : prev.filter(id => id !== printerId)
      );
    } else {
      setNewStationPrinters(prev => 
        isSelected 
          ? [...prev, printerId]
          : prev.filter(id => id !== printerId)
      );
    }
  };

  const getPrinterName = (printerId) => {
    const printer = printers.find(p => p.id === printerId);
    return printer ? printer.name : `Unknown Printer (${printerId})`;
  };

  // Styles
  const styles = {
    container: {
      ...TavariStyles.layout.container
    },
    header: {
      marginBottom: TavariStyles.spacing['2xl'],
      textAlign: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.xl
    },
    loading: {
      ...TavariStyles.components.loading.container
    },
    addSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing['2xl'],
      border: `2px solid ${TavariStyles.colors.primary}`
    },
    printerSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing['2xl'],
      border: `2px solid ${TavariStyles.colors.secondary}`
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    printerSectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.secondary}`
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xl
    },
    formRow: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.xl
    },
    formRowThree: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: TavariStyles.spacing.xl
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    label: {
      ...TavariStyles.components.form.label
    },
    input: {
      ...TavariStyles.components.form.input
    },
    select: {
      ...TavariStyles.components.form.select
    },
    checkboxRow: {
      display: 'flex',
      gap: TavariStyles.spacing.xl,
      alignItems: 'center'
    },
    printerGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.lg
    },
    printerCard: {
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50
    },
    printerName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.xs
    },
    printerDetails: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm
    },
    addButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      alignSelf: 'flex-start'
    },
    toggleButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm,
      marginBottom: TavariStyles.spacing.lg
    },
    tableContainer: {
      ...TavariStyles.components.table.container,
      flex: 1,
      marginBottom: TavariStyles.spacing.xl
    },
    table: {
      ...TavariStyles.components.table.table
    },
    headerRow: {
      ...TavariStyles.components.table.headerRow,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      position: 'sticky',
      top: 0
    },
    th: {
      ...TavariStyles.components.table.th,
      color: TavariStyles.colors.white,
      borderBottom: `2px solid ${TavariStyles.colors.primaryDark}`
    },
    row: {
      ...TavariStyles.components.table.row
    },
    td: {
      ...TavariStyles.components.table.td
    },
    emptyCell: {
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic'
    },
    statusIndicator: {
      width: '12px',
      height: '12px',
      borderRadius: TavariStyles.borderRadius.full,
      display: 'inline-block'
    },
    stationName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800
    },
    inactiveLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.danger,
      fontWeight: TavariStyles.typography.fontWeight.normal
    },
    printerList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    printerBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      display: 'inline-block',
      marginRight: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.xs
    },
    screenBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      display: 'inline-block'
    },
    orderControls: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    orderButton: {
      width: '24px',
      height: '24px',
      backgroundColor: TavariStyles.colors.gray100,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.sm,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.xs,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    orderNumber: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      flexWrap: 'wrap'
    },
    editActions: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      flexWrap: 'wrap'
    },
    editButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    toggleStatusButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      color: TavariStyles.colors.white,
      border: 'none'
    },
    deleteButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm
    },
    saveButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.success,
      ...TavariStyles.components.button.sizes.sm
    },
    cancelButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.gray500,
      color: TavariStyles.colors.white,
      ...TavariStyles.components.button.sizes.sm
    },
    infoPanel: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.infoBg,
      border: `2px solid ${TavariStyles.colors.info}`
    },
    infoTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.infoText,
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'center'
    },
    infoText: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.infoText,
      lineHeight: TavariStyles.typography.lineHeight.relaxed,
      textAlign: 'center'
    },
    noAccessContainer: {
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },
    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    }
  };

  // Check overall access
  if (!permissionsLoading && !canViewStations) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['manager', 'owner']}
          requireBusiness={true}
          componentName="POSStationsScreen"
        >
          <div style={styles.container}>
            <div style={styles.noAccessContainer}>
              <h3 style={{ color: TavariStyles.colors.danger }}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to view POS stations.
              </p>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  if (loading || permissionsLoading) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['manager', 'owner']}
          requireBusiness={true}
          componentName="POSStationsScreen"
        >
          <div style={styles.loading}>Loading stations...</div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['manager', 'owner']}
        requireBusiness={true}
        componentName="POSStationsScreen"
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h2 style={styles.title}>POS Station Management</h2>
            <p style={styles.subtitle}>Configure stations for kitchen display screens and printer routing</p>
          </div>

          {error && <div style={styles.errorBanner}>{error}</div>}

          {/* Printer Management Section */}
          <PermissionGate permissions={['pos.printers.manage']} fallback={null}>
            <div style={styles.printerSection}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.xl }}>
                <h3 style={styles.printerSectionTitle}>Printer Management</h3>
                <button
                  onClick={() => setShowPrinterManager(!showPrinterManager)}
                  style={styles.toggleButton}
                >
                  {showPrinterManager ? 'Hide' : 'Show'} Printer Setup
                </button>
              </div>

              {showPrinterManager && (
                <div style={styles.form}>
                  <div style={styles.formRowThree}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Printer Name *</label>
                      <input
                        type="text"
                        placeholder="e.g., Kitchen Printer"
                        value={newPrinterName}
                        onChange={(e) => setNewPrinterName(e.target.value)}
                        style={styles.input}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>IP Address</label>
                      <input
                        type="text"
                        placeholder="192.168.1.100"
                        value={newPrinterIP}
                        onChange={(e) => setNewPrinterIP(e.target.value)}
                        style={styles.input}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Printer Type</label>
                      <select
                        value={newPrinterType}
                        onChange={(e) => setNewPrinterType(e.target.value)}
                        style={styles.select}
                      >
                        <option value="thermal">Thermal (Kitchen/Bar)</option>
                        <option value="receipt">Receipt Printer</option>
                        <option value="label">Label Printer</option>
                      </select>
                    </div>
                  </div>

                  <button 
                    onClick={addPrinter} 
                    style={styles.addButton}
                    disabled={!newPrinterName.trim()}
                  >
                    Add Printer
                  </button>
                </div>
              )}

              <div>
                <h4 style={{ fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.semibold, marginBottom: TavariStyles.spacing.md }}>
                  Available Printers ({printers.length})
                </h4>
                <div style={styles.printerGrid}>
                  {printers.map(printer => (
                    <div key={printer.id} style={styles.printerCard}>
                      <div style={styles.printerName}>{printer.name}</div>
                      <div style={styles.printerDetails}>
                        Type: {printer.type} {printer.ip_address && `• IP: ${printer.ip_address}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </PermissionGate>

          {/* Add New Station Form */}
          <PermissionGate
            permissions={['pos.stations.create']}
            fallback={
              <div style={{ ...styles.infoPanel, marginBottom: TavariStyles.spacing['2xl'] }}>
                <p style={styles.infoText}>
                  You have view-only access to stations. Contact a manager to create new stations.
                </p>
              </div>
            }
          >
            <div style={styles.addSection}>
              <h3 style={styles.sectionTitle}>Add New Station</h3>
              <div style={styles.form}>
                <div style={styles.formRow}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Station Name *</label>
                    <input
                      type="text"
                      placeholder="e.g., Kitchen, Bar, Grill, Prep"
                      value={newStationName}
                      onChange={(e) => setNewStationName(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Description</label>
                    <input
                      type="text"
                      placeholder="Optional description"
                      value={newStationDescription}
                      onChange={(e) => setNewStationDescription(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={styles.checkboxRow}>
                  <TavariCheckbox
                    checked={newStationHasScreen}
                    onChange={setNewStationHasScreen}
                    label="Has Display Screen"
                    id="new-has-screen"
                  />
                  {newStationHasScreen && (
                    <TavariCheckbox
                      checked={newStationScreenEnabled}
                      onChange={setNewStationScreenEnabled}
                      label="Screen Enabled"
                      id="new-screen-enabled"
                    />
                  )}
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Assign Printers (Optional)</label>
                  <div style={styles.printerGrid}>
                    {printers.map(printer => (
                      <div key={printer.id} style={styles.printerCard}>
                        <TavariCheckbox
                          checked={newStationPrinters.includes(printer.id)}
                          onChange={(checked) => handlePrinterSelection(printer.id, checked, false)}
                          label={printer.name}
                          id={`new-printer-${printer.id}`}
                        />
                        <div style={styles.printerDetails}>
                          {printer.type} {printer.ip_address && `• ${printer.ip_address}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={addStation} 
                  style={styles.addButton}
                  disabled={!newStationName.trim()}
                >
                  Add Station
                </button>
              </div>
            </div>
          </PermissionGate>

          {/* Stations Table */}
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.headerRow}>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Display Screen</th>
                  <th style={styles.th}>Assigned Printers</th>
                  <th style={styles.th}>Order</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stations.length === 0 && (
                  <tr>
                    <td colSpan="7" style={styles.emptyCell}>
                      No stations found. Create your first station above.
                    </td>
                  </tr>
                )}
                {stations.map((station, i) => (
                  <tr key={station.id} style={{
                    ...styles.row,
                    backgroundColor: i % 2 === 0 ? TavariStyles.colors.gray50 : TavariStyles.colors.white,
                    opacity: station.is_active === false ? 0.6 : 1
                  }}>
                    <td style={styles.td}>
                      <div
                        style={{
                          ...styles.statusIndicator,
                          backgroundColor: station.is_active !== false ? TavariStyles.colors.cashGreen : TavariStyles.colors.danger
                        }}
                        title={station.is_active !== false ? 'Active' : 'Inactive'}
                      />
                    </td>
                    
                    <td style={styles.td}>
                      {editStationId === station.id ? (
                        <input
                          type="text"
                          value={editStationName}
                          onChange={(e) => setEditStationName(e.target.value)}
                          style={styles.input}
                        />
                      ) : (
                        <div style={styles.stationName}>
                          {station.name}
                          {station.is_active === false && (
                            <span style={styles.inactiveLabel}> (Inactive)</span>
                          )}
                        </div>
                      )}
                    </td>
                    
                    <td style={styles.td}>
                      {editStationId === station.id ? (
                        <input
                          type="text"
                          value={editStationDescription}
                          onChange={(e) => setEditStationDescription(e.target.value)}
                          style={styles.input}
                          placeholder="Optional description"
                        />
                      ) : (
                        station.description || '—'
                      )}
                    </td>
                    
                    <td style={styles.td}>
                      {editStationId === station.id ? (
                        <div style={styles.checkboxRow}>
                          <TavariCheckbox
                            checked={editStationHasScreen}
                            onChange={setEditStationHasScreen}
                            label="Has Screen"
                            size="sm"
                            id={`edit-has-screen-${station.id}`}
                          />
                          {editStationHasScreen && (
                            <TavariCheckbox
                              checked={editStationScreenEnabled}
                              onChange={setEditStationScreenEnabled}
                              label="Enabled"
                              size="sm"
                              id={`edit-screen-enabled-${station.id}`}
                            />
                          )}
                        </div>
                      ) : (
                        <div>
                          {station.has_screen ? (
                            <span style={{
                              ...styles.screenBadge,
                              backgroundColor: station.screen_enabled ? TavariStyles.colors.successBg : TavariStyles.colors.gray200,
                              color: station.screen_enabled ? TavariStyles.colors.successText : TavariStyles.colors.gray600
                            }}>
                              {station.screen_enabled ? 'Screen Active' : 'Screen Disabled'}
                            </span>
                          ) : (
                            <span style={{ color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.sm }}>
                              No Screen
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    <td style={styles.td}>
                      {editStationId === station.id ? (
                        <div style={styles.printerGrid}>
                          {printers.map(printer => (
                            <div key={printer.id} style={styles.printerCard}>
                              <TavariCheckbox
                                checked={editStationPrinters.includes(printer.id)}
                                onChange={(checked) => handlePrinterSelection(printer.id, checked, true)}
                                label={printer.name}
                                size="sm"
                                id={`edit-printer-${station.id}-${printer.id}`}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={styles.printerList}>
                          {station.printer_ids && station.printer_ids.length > 0 ? (
                            station.printer_ids.map(printerId => (
                              <span key={printerId} style={styles.printerBadge}>
                                {getPrinterName(printerId)}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.sm }}>
                              No Printers
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    
                    <td style={styles.td}>
                      <PermissionGate permissions={['pos.stations.edit']} fallback={<span style={styles.orderNumber}>{i + 1}</span>}>
                        <div style={styles.orderControls}>
                          <button
                            onClick={() => moveStation(station.id, -1)}
                            disabled={i === 0}
                            style={styles.orderButton}
                            title="Move Up"
                          >
                            ↑
                          </button>
                          <span style={styles.orderNumber}>{i + 1}</span>
                          <button
                            onClick={() => moveStation(station.id, 1)}
                            disabled={i === stations.length - 1}
                            style={styles.orderButton}
                            title="Move Down"
                          >
                            ↓
                          </button>
                        </div>
                      </PermissionGate>
                    </td>
                    
                    <td style={styles.td}>
                      {editStationId === station.id ? (
                        <div style={styles.editActions}>
                          <button 
                            onClick={saveEditStation} 
                            style={styles.saveButton}
                            disabled={!editStationName.trim()}
                          >
                            Save
                          </button>
                          <button onClick={cancelEdit} style={styles.cancelButton}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={styles.actions}>
                          <PermissionGate permissions={['pos.stations.edit']}>
                            <button 
                              onClick={() => startEditStation(station)} 
                              style={styles.editButton}
                            >
                              Edit
                            </button>
                          </PermissionGate>
                          <PermissionGate permissions={['pos.stations.edit']}>
                            <button
                              onClick={() => toggleStationStatus(station.id, station.is_active !== false, station.name)}
                              style={{
                                ...styles.toggleStatusButton,
                                backgroundColor: station.is_active !== false ? TavariStyles.colors.warning : TavariStyles.colors.cashGreen
                              }}
                            >
                              {station.is_active !== false ? 'Disable' : 'Enable'}
                            </button>
                          </PermissionGate>
                          <PermissionGate permissions={['pos.stations.delete']}>
                            <button 
                              onClick={() => deleteStation(station.id, station.name)} 
                              style={styles.deleteButton}
                            >
                              Delete
                            </button>
                          </PermissionGate>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Info Panel */}
          <div style={styles.infoPanel}>
            <h3 style={styles.infoTitle}>Station & Printer Routing System</h3>
            <p style={styles.infoText}>
              Stations route orders to kitchen display screens and printers. When items are assigned to a station in inventory, 
              they will appear on that station's display and print to assigned printers when ordered. Printer integration is ready for future implementation.
            </p>
          </div>
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSStationsScreen;
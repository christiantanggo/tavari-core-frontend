// screens/Reports/ReportAutomationSettings.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';

const ReportAutomationSettings = () => {
  // Security context for sensitive automation settings
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ReportAutomationSettings',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'ReportAutomationSettings'
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
  const canViewAutomation = hasAnyPermission(['pos.reports.view', 'pos.reports.export']) || hasElevatedPrivileges();
  const canCreateAutomation = hasPermission('pos.reports.export') || hasElevatedPrivileges();
  const canEditAutomation = hasPermission('pos.reports.export') || hasElevatedPrivileges();
  const canDeleteAutomation = hasAnyPermission(['pos.reports.export', 'pos.sales.void']) || isOwner();

  const [selectedBusinessId, setSelectedBusinessId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [automationRules, setAutomationRules] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    report_type: 'sales',
    frequency: 'daily',
    run_time: '09:00',
    email_enabled: false,
    print_enabled: false,
    email_recipients: '',
    date_range: 'yesterday',
    active: true
  });

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewAutomation) {
      toast.error('You do not have permission to view report automation settings');
      // Could navigate away or show error
    }
  }, [permissionsLoading, canViewAutomation]);

  // Available report types (matching POSReportsScreen options)
  const reportTypes = [
    { value: 'sales', label: 'Sales Summary' },
    { value: 'transactions', label: 'Transaction Details' },
    { value: 'inventory', label: 'Inventory Report' },
    { value: 'payments', label: 'Payment Methods' },
    { value: 'refunds', label: 'Refunds Report' },
    { value: 'discounts', label: 'Discounts Applied' },
    { value: 'taxes', label: 'Tax Summary' },
    { value: 'loyalty', label: 'Loyalty Activity' },
    { value: 'employees', label: 'Employee Performance' }
  ];

  const frequencies = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' }
  ];

  const dateRanges = [
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'last_week', label: 'Last Week' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'current_week', label: 'Current Week' },
    { value: 'current_month', label: 'Current Month' }
  ];

  useEffect(() => {
    if (selectedBusinessId && !permissionsLoading && canViewAutomation) {
      loadAutomationRules();
    }
  }, [selectedBusinessId, permissionsLoading, canViewAutomation]);

  const loadAutomationRules = async () => {
    try {
      setLoading(true);

      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_automation_rules');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('automation_rules_access', {
        action: 'load_automation_rules',
        business_id: selectedBusinessId
      }, 'low');
      
      // Load existing automation rules from pos_settings or create new table
      const { data, error } = await supabase
        .from('pos_report_automation')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false });

      if (error && error.code === '42P01') {
        // Table doesn't exist, create it
        await createAutomationTable();
        setAutomationRules([]);
      } else if (error) {
        throw error;
      } else {
        setAutomationRules(data || []);
        
        await recordAction('automation_rules_loaded', selectedBusinessId, true);
        await logSecurityEvent('automation_rules_loaded', {
          action: 'load_automation_rules_success',
          business_id: selectedBusinessId,
          rule_count: data?.length || 0
        }, 'low');
      }
    } catch (err) {
      await logSecurityEvent('automation_rules_load_error', {
        action: 'load_automation_rules_failed',
        business_id: selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      // For now, use empty array if table doesn't exist
      setAutomationRules([]);
      toast.error('Failed to load automation rules');
    } finally {
      setLoading(false);
    }
  };

  const createAutomationTable = async () => {
    try {
      await logSecurityEvent('automation_table_creation', {
        action: 'create_automation_table',
        business_id: selectedBusinessId
      }, 'medium');

      // Create the automation table if it doesn't exist
      const { error } = await supabase.rpc('create_report_automation_table');
      if (error) {
        await logSecurityEvent('automation_table_creation_error', {
          action: 'create_automation_table_failed',
          business_id: selectedBusinessId,
          error_message: error.message
        }, 'medium');
      }
    } catch (err) {
      await logSecurityEvent('automation_table_creation_error', {
        action: 'create_automation_table_exception',
        business_id: selectedBusinessId,
        error_message: err.message
      }, 'medium');
    }
  };

  const handleAuthReady = async (authData) => {
    setSelectedBusinessId(authData.selectedBusinessId);
    
    await logSecurityEvent('automation_settings_accessed', {
      action: 'report_automation_screen_loaded',
      business_id: authData.selectedBusinessId,
      user_id: authData.authUser?.id
    }, 'low');
  };

  const handleInputChange = async (field, value) => {
    // Validate text inputs
    if (typeof value === 'string' && value.length > 0) {
      const validation = await validateInput(value, 'text', field);
      if (!validation.valid) {
        toast.error(`Invalid input for ${field}`);
        return;
      }
    }

    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCreateRule = async () => {
    if (!canCreateAutomation) {
      toast.error('You do not have permission to create automation rules');
      return;
    }

    await logSecurityEvent('automation_rule_create_initiated', {
      action: 'open_create_modal',
      business_id: selectedBusinessId
    }, 'low');

    setFormData({
      name: '',
      report_type: 'sales',
      frequency: 'daily',
      run_time: '09:00',
      email_enabled: false,
      print_enabled: false,
      email_recipients: '',
      date_range: 'yesterday',
      active: true
    });
    setEditingRule(null);
    setShowCreateModal(true);
  };

  const handleEditRule = async (rule) => {
    if (!canEditAutomation) {
      toast.error('You do not have permission to edit automation rules');
      return;
    }

    await logSecurityEvent('automation_rule_edit_initiated', {
      action: 'open_edit_modal',
      business_id: selectedBusinessId,
      rule_id: rule.id,
      rule_name: rule.name
    }, 'medium');

    setFormData({
      name: rule.name || '',
      report_type: rule.report_type || 'sales',
      frequency: rule.frequency || 'daily',
      run_time: rule.run_time || '09:00',
      email_enabled: rule.email_enabled || false,
      print_enabled: rule.print_enabled || false,
      email_recipients: rule.email_recipients || '',
      date_range: rule.date_range || 'yesterday',
      active: rule.active !== false
    });
    setEditingRule(rule);
    setShowCreateModal(true);
  };

  const handleSaveRule = async () => {
    if (!formData.name.trim()) {
      toast.error('Rule name is required');
      return;
    }

    // Validate email recipients if email is enabled
    if (formData.email_enabled && formData.email_recipients) {
      const validation = await validateInput(formData.email_recipients, 'email', 'email_recipients');
      if (!validation.valid) {
        toast.error('Please enter valid email addresses');
        return;
      }
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('save_automation_rule');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      const ruleData = {
        ...formData,
        business_id: selectedBusinessId,
        updated_at: new Date().toISOString()
      };

      if (editingRule) {
        // Update existing rule
        await logSecurityEvent('automation_rule_update', {
          action: 'update_automation_rule',
          business_id: selectedBusinessId,
          rule_id: editingRule.id,
          rule_name: formData.name
        }, 'high');

        const { error } = await supabase
          .from('pos_report_automation')
          .update(ruleData)
          .eq('id', editingRule.id);

        if (error) throw error;

        await recordAction('automation_rule_updated', editingRule.id, true);
        await logSecurityEvent('automation_rule_updated', {
          action: 'update_automation_rule_success',
          business_id: selectedBusinessId,
          rule_id: editingRule.id
        }, 'high');

        toast.success('Automation rule updated successfully');
      } else {
        // Create new rule
        ruleData.created_at = new Date().toISOString();

        await logSecurityEvent('automation_rule_create', {
          action: 'create_automation_rule',
          business_id: selectedBusinessId,
          rule_name: formData.name,
          report_type: formData.report_type
        }, 'high');
        
        const { data, error } = await supabase
          .from('pos_report_automation')
          .insert([ruleData])
          .select();

        if (error) throw error;

        await recordAction('automation_rule_created', data[0]?.id, true);
        await logSecurityEvent('automation_rule_created', {
          action: 'create_automation_rule_success',
          business_id: selectedBusinessId,
          rule_id: data[0]?.id
        }, 'high');

        toast.success('Automation rule created successfully');
      }

      setShowCreateModal(false);
      loadAutomationRules();

    } catch (err) {
      await logSecurityEvent('automation_rule_save_error', {
        action: editingRule ? 'update_automation_rule_failed' : 'create_automation_rule_failed',
        business_id: selectedBusinessId,
        error_message: err.message
      }, 'high');
      
      toast.error('Error saving automation rule. Please try again.');
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!canDeleteAutomation) {
      toast.error('You do not have permission to delete automation rules');
      return;
    }

    if (!confirm('Are you sure you want to delete this automation rule?')) {
      return;
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('delete_automation_rule');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('automation_rule_delete', {
        action: 'delete_automation_rule',
        business_id: selectedBusinessId,
        rule_id: ruleId
      }, 'high');

      const { error } = await supabase
        .from('pos_report_automation')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;

      await recordAction('automation_rule_deleted', ruleId, true);
      await logSecurityEvent('automation_rule_deleted', {
        action: 'delete_automation_rule_success',
        business_id: selectedBusinessId,
        rule_id: ruleId
      }, 'high');

      toast.success('Automation rule deleted successfully');
      loadAutomationRules();

    } catch (err) {
      await logSecurityEvent('automation_rule_delete_error', {
        action: 'delete_automation_rule_failed',
        business_id: selectedBusinessId,
        rule_id: ruleId,
        error_message: err.message
      }, 'high');
      
      toast.error('Error deleting automation rule. Please try again.');
    }
  };

  const toggleRuleActive = async (rule) => {
    if (!canEditAutomation) {
      toast.error('You do not have permission to modify automation rules');
      return;
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('toggle_automation_rule');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('automation_rule_toggle', {
        action: 'toggle_automation_rule',
        business_id: selectedBusinessId,
        rule_id: rule.id,
        new_status: !rule.active
      }, 'medium');

      const { error } = await supabase
        .from('pos_report_automation')
        .update({ active: !rule.active })
        .eq('id', rule.id);

      if (error) throw error;

      await recordAction('automation_rule_toggled', rule.id, true);
      await logSecurityEvent('automation_rule_toggled', {
        action: 'toggle_automation_rule_success',
        business_id: selectedBusinessId,
        rule_id: rule.id,
        new_status: !rule.active
      }, 'medium');

      toast.success(`Rule ${!rule.active ? 'activated' : 'deactivated'} successfully`);
      loadAutomationRules();

    } catch (err) {
      await logSecurityEvent('automation_rule_toggle_error', {
        action: 'toggle_automation_rule_failed',
        business_id: selectedBusinessId,
        rule_id: rule.id,
        error_message: err.message
      }, 'medium');
      
      toast.error('Error updating rule status. Please try again.');
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      maxWidth: '1200px',
      margin: '0 auto'
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing['2xl'],
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    
    createButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      fontSize: TavariStyles.typography.fontSize.base
    },
    
    rulesGrid: {
      display: 'grid',
      gap: TavariStyles.spacing.lg,
      gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))'
    },
    
    ruleCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      position: 'relative'
    },
    
    ruleHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.md
    },
    
    ruleName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    
    statusBadge: {
      padding: '4px 8px',
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer'
    },
    
    activeBadge: {
      backgroundColor: TavariStyles.colors.successBg,
      color: TavariStyles.colors.successText
    },
    
    inactiveBadge: {
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray600
    },
    
    ruleDetail: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs
    },
    
    ruleActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md
    },
    
    editButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    
    deleteButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm
    },
    
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    },
    
    modalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing['2xl'],
      maxWidth: '600px',
      width: '90%',
      maxHeight: '90vh',
      overflowY: 'auto'
    },
    
    modalHeader: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray800
    },
    
    formGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    
    label: {
      ...TavariStyles.components.form.label,
      marginBottom: TavariStyles.spacing.sm
    },
    
    input: {
      ...TavariStyles.components.form.input,
      width: '100%'
    },
    
    select: {
      ...TavariStyles.components.form.select,
      width: '100%'
    },
    
    modalActions: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'flex-end',
      marginTop: TavariStyles.spacing.xl
    },
    
    saveButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary
    },
    
    cancelButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary
    },
    
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray500
    },
    
    emptyStateTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.md
    }
  };

  if (loading) {
    return (
      <SecurityWrapper
        componentName="ReportAutomationSettings"
        sensitiveComponent={true}
        requireSecureConnection={false}
        securityLevel="high"
      >
        <POSAuthWrapper
          requiredRoles={['manager', 'owner']}
          onAuthReady={handleAuthReady}
        >
          <div style={styles.container}>
            <div style={{ ...TavariStyles.components.loading.container }}>
              Loading automation settings...
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper
      componentName="ReportAutomationSettings"
      sensitiveComponent={true}
      requireSecureConnection={false}
      securityLevel="high"
    >
      <POSAuthWrapper
        requiredRoles={['manager', 'owner']}
        onAuthReady={handleAuthReady}
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h1 style={styles.title}>Report Automation Settings</h1>
            <PermissionGate permission="pos.reports.export">
              <button
                style={styles.createButton}
                onClick={handleCreateRule}
              >
                + Create Automation Rule
              </button>
            </PermissionGate>
          </div>

          {automationRules.length === 0 ? (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyStateTitle}>No Automation Rules</h3>
              <p>Create your first automation rule to automatically generate and send reports.</p>
            </div>
          ) : (
            <div style={styles.rulesGrid}>
              {automationRules.map((rule) => (
                <div key={rule.id} style={styles.ruleCard}>
                  <div style={styles.ruleHeader}>
                    <h3 style={styles.ruleName}>{rule.name || 'Unnamed Rule'}</h3>
                    <PermissionGate permission="pos.reports.export">
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...(rule.active ? styles.activeBadge : styles.inactiveBadge)
                        }}
                        onClick={() => toggleRuleActive(rule)}
                      >
                        {rule.active ? 'Active' : 'Inactive'}
                      </span>
                    </PermissionGate>
                  </div>
                  
                  <div style={styles.ruleDetail}>
                    <strong>Report:</strong> {reportTypes.find(t => t.value === rule.report_type)?.label || rule.report_type}
                  </div>
                  
                  <div style={styles.ruleDetail}>
                    <strong>Frequency:</strong> {frequencies.find(f => f.value === rule.frequency)?.label || rule.frequency} at {rule.run_time}
                  </div>
                  
                  <div style={styles.ruleDetail}>
                    <strong>Date Range:</strong> {dateRanges.find(d => d.value === rule.date_range)?.label || rule.date_range}
                  </div>
                  
                  {rule.email_enabled && (
                    <div style={styles.ruleDetail}>
                      <strong>Email:</strong> {rule.email_recipients || 'No recipients set'}
                    </div>
                  )}
                  
                  {rule.print_enabled && (
                    <div style={styles.ruleDetail}>
                      <strong>Auto Print:</strong> Enabled
                    </div>
                  )}
                  
                  <div style={styles.ruleActions}>
                    <PermissionGate permission="pos.reports.export">
                      <button
                        style={styles.editButton}
                        onClick={() => handleEditRule(rule)}
                      >
                        Edit
                      </button>
                    </PermissionGate>
                    
                    <PermissionGate permissions={['pos.reports.export', 'pos.sales.void']} requireAny requireOwner>
                      <button
                        style={styles.deleteButton}
                        onClick={() => handleDeleteRule(rule.id)}
                      >
                        Delete
                      </button>
                    </PermissionGate>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showCreateModal && (
            <div style={styles.modal} onClick={(e) => e.target === e.currentTarget && setShowCreateModal(false)}>
              <div style={styles.modalContent}>
                <h2 style={styles.modalHeader}>
                  {editingRule ? 'Edit Automation Rule' : 'Create Automation Rule'}
                </h2>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Rule Name</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Enter a descriptive name for this rule"
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Report Type</label>
                  <select
                    style={styles.select}
                    value={formData.report_type}
                    onChange={(e) => handleInputChange('report_type', e.target.value)}
                  >
                    {reportTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Frequency</label>
                  <select
                    style={styles.select}
                    value={formData.frequency}
                    onChange={(e) => handleInputChange('frequency', e.target.value)}
                  >
                    {frequencies.map(freq => (
                      <option key={freq.value} value={freq.value}>
                        {freq.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Time</label>
                  <input
                    type="time"
                    style={styles.input}
                    value={formData.run_time}
                    onChange={(e) => handleInputChange('run_time', e.target.value)}
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Date Range</label>
                  <select
                    style={styles.select}
                    value={formData.date_range}
                    onChange={(e) => handleInputChange('date_range', e.target.value)}
                  >
                    {dateRanges.map(range => (
                      <option key={range.value} value={range.value}>
                        {range.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div style={styles.formGroup}>
                  <TavariCheckbox
                    checked={formData.email_enabled}
                    onChange={(checked) => handleInputChange('email_enabled', checked)}
                    label="Enable Email Delivery"
                    size="md"
                  />
                </div>
                
                {formData.email_enabled && (
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email Recipients (comma-separated)</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={formData.email_recipients}
                      onChange={(e) => handleInputChange('email_recipients', e.target.value)}
                      placeholder="email1@example.com, email2@example.com"
                    />
                  </div>
                )}
                
                <div style={styles.formGroup}>
                  <TavariCheckbox
                    checked={formData.print_enabled}
                    onChange={(checked) => handleInputChange('print_enabled', checked)}
                    label="Enable Auto Print"
                    size="md"
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <TavariCheckbox
                    checked={formData.active}
                    onChange={(checked) => handleInputChange('active', checked)}
                    label="Active"
                    size="md"
                  />
                </div>
                
                <div style={styles.modalActions}>
                  <button
                    style={styles.cancelButton}
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    style={styles.saveButton}
                    onClick={handleSaveRule}
                    disabled={!formData.name.trim()}
                  >
                    {editingRule ? 'Update Rule' : 'Create Rule'}
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

export default ReportAutomationSettings;
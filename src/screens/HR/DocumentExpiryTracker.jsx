// screens/HR/DocumentExpiryTracker.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, AlertTriangle, CheckCircle, Clock, DollarSign, FileText, User, Bell, Settings, Eye, Plus } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Import security and authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

const DocumentExpiryTracker = () => {
  const navigate = useNavigate();
  
  // Security context for sensitive document data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'DocumentExpiryTracker',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'DocumentExpiryTracker'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();
  
  // Active Tab
  const [activeTab, setActiveTab] = useState('tracker');
  
  // Tracker Tab State
  const [expiringDocuments, setExpiringDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDaysAhead, setSelectedDaysAhead] = useState(30);
  const [showPremiumCalculator, setShowPremiumCalculator] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [premiumCalculation, setPremiumCalculation] = useState(null);

  // Premium Rules Tab State
  const [wagePremiumRules, setWagePremiumRules] = useState([]);
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [newRule, setNewRule] = useState({
    rule_name: '',
    document_category: 'certification',
    premium_type: 'fixed_amount',
    premium_value: 0,
    description: '',
    is_active: true
  });

  // Permission checks
  const canViewDocuments = hasAnyPermission([
    'hr.documents.view',
    'hr.documents.view_all'
  ]) || hasElevatedPrivileges();

  const canManageDocuments = hasPermission('hr.documents.manage') || hasElevatedPrivileges();
  const canManagePremiums = hasPermission('hr.wages.manage') || hasElevatedPrivileges();
  const canSendNotifications = hasPermission('hr.notifications.send') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewDocuments) {
      toast.error('You do not have permission to view document expiry tracking');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewDocuments]);

  useEffect(() => {
    if (!selectedBusinessId || authLoading || permissionsLoading) return;
    
    if (activeTab === 'tracker' && canViewDocuments) {
      loadExpiringDocuments();
    } else if (activeTab === 'rules' && canManagePremiums) {
      loadWagePremiumRules();
    }
  }, [selectedBusinessId, selectedDaysAhead, activeTab, authLoading, permissionsLoading]);

  const loadExpiringDocuments = async () => {
    if (!selectedBusinessId || !canViewDocuments) return;
    
    setLoading(true);
    try {
      await logSecurityEvent('document_expiry_access', {
        action: 'load_expiring_documents',
        business_id: selectedBusinessId,
        days_ahead: selectedDaysAhead
      }, 'low');

      const { data, error } = await supabase.rpc('get_expiring_documents', {
        p_business_id: selectedBusinessId,
        p_days_ahead: selectedDaysAhead
      });

      if (error) throw error;
      setExpiringDocuments(data || []);
      
      recordAction('view_expiring_documents', selectedBusinessId);
    } catch (error) {
      console.error('Error loading expiring documents:', error);
      toast.error('Failed to load expiring documents');
      
      await logSecurityEvent('document_expiry_access_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const loadWagePremiumRules = async () => {
    if (!selectedBusinessId || !canManagePremiums) return;

    setLoading(true);
    try {
      await logSecurityEvent('premium_rules_access', {
        action: 'load_wage_premium_rules',
        business_id: selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .from('wage_premium_rules')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWagePremiumRules(data || []);
      
      recordAction('view_premium_rules', selectedBusinessId);
    } catch (error) {
      console.error('Error loading wage premium rules:', error);
      toast.error('Failed to load premium rules');
      
      await logSecurityEvent('premium_rules_access_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const calculateEmployeePremiums = async (employeeId) => {
    if (!selectedBusinessId || !employeeId || !canViewDocuments) return;

    // Rate limiting check
    const canProceed = await checkRateLimit('calculate_premiums', 10, 60);
    if (!canProceed) {
      toast.error('Too many premium calculations. Please wait a moment.');
      return;
    }

    try {
      await logSecurityEvent('premium_calculation', {
        action: 'calculate_employee_premiums',
        employee_id: employeeId,
        business_id: selectedBusinessId
      }, 'low');

      const { data, error } = await supabase.rpc('calculate_employee_wage_premiums', {
        p_employee_id: employeeId,
        p_business_id: selectedBusinessId
      });

      if (error) throw error;
      
      if (data && data.length > 0) {
        setPremiumCalculation(data[0]);
        setSelectedEmployee(employeeId);
        setShowPremiumCalculator(true);
        
        recordAction('calculate_premium', employeeId);
      }
    } catch (error) {
      console.error('Error calculating premiums:', error);
      toast.error('Failed to calculate premiums');
      
      await logSecurityEvent('premium_calculation_failed', {
        error_message: error.message,
        employee_id: employeeId
      }, 'medium');
    }
  };

  const sendExpiryNotifications = async () => {
    if (!canSendNotifications) {
      toast.error('You do not have permission to send notifications');
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('send_notifications', 5, 3600);
    if (!canProceed) {
      toast.error('Notification limit reached. Please wait before sending more.');
      return;
    }

    try {
      await logSecurityEvent('notification_send_attempt', {
        action: 'send_document_expiry_notifications',
        business_id: selectedBusinessId
      }, 'medium');

      const { data, error } = await supabase.rpc('send_document_expiry_notifications');
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        const result = data[0];
        toast.success(`Sent ${result.notifications_sent} expiry notifications`);
        
        await logSecurityEvent('notifications_sent', {
          notifications_count: result.notifications_sent,
          business_id: selectedBusinessId,
          sent_by: authUser?.id
        }, 'low');
        
        recordAction('send_notifications', selectedBusinessId);
      }
    } catch (error) {
      console.error('Error sending notifications:', error);
      toast.error('Failed to send notifications');
      
      await logSecurityEvent('notification_send_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'high');
    }
  };

  const handleSaveRule = async () => {
    if (!canManagePremiums) {
      toast.error('You do not have permission to manage premium rules');
      return;
    }

    // Validation
    const validationErrors = [];
    
    if (!newRule.rule_name.trim()) {
      validationErrors.push('Rule name is required');
    }
    
    if (!newRule.premium_value || newRule.premium_value <= 0) {
      validationErrors.push('Premium value must be greater than 0');
    }

    if (validationErrors.length > 0) {
      toast.error(validationErrors.join(', '));
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('save_premium_rule', 20, 3600);
    if (!canProceed) {
      toast.error('Too many rule changes. Please wait before making more changes.');
      return;
    }

    try {
      await logSecurityEvent('premium_rule_modification', {
        action: editingRule ? 'update_premium_rule' : 'create_premium_rule',
        rule_id: editingRule?.id,
        rule_name: newRule.rule_name,
        business_id: selectedBusinessId,
        modified_by: authUser?.id
      }, 'medium');

      if (editingRule) {
        // Update existing rule
        const { error } = await supabase
          .from('wage_premium_rules')
          .update({
            rule_name: newRule.rule_name,
            document_category: newRule.document_category,
            premium_type: newRule.premium_type,
            premium_value: newRule.premium_value,
            description: newRule.description,
            is_active: newRule.is_active,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingRule.id);

        if (error) throw error;
        toast.success('Premium rule updated successfully');
        
        recordAction('update_premium_rule', editingRule.id);
      } else {
        // Create new rule
        const { error } = await supabase
          .from('wage_premium_rules')
          .insert({
            business_id: selectedBusinessId,
            rule_name: newRule.rule_name,
            document_category: newRule.document_category,
            premium_type: newRule.premium_type,
            premium_value: newRule.premium_value,
            description: newRule.description,
            is_active: newRule.is_active,
            created_by: authUser.id
          });

        if (error) throw error;
        toast.success('Premium rule created successfully');
        
        recordAction('create_premium_rule', selectedBusinessId);
      }

      setShowAddRuleModal(false);
      setEditingRule(null);
      setNewRule({
        rule_name: '',
        document_category: 'certification',
        premium_type: 'fixed_amount',
        premium_value: 0,
        description: '',
        is_active: true
      });
      loadWagePremiumRules();
    } catch (error) {
      console.error('Error saving rule:', error);
      toast.error('Failed to save premium rule');
      
      await logSecurityEvent('premium_rule_save_failed', {
        error_message: error.message,
        rule_name: newRule.rule_name
      }, 'high');
    }
  };

  const handleEditRule = (rule) => {
    if (!canManagePremiums) {
      toast.error('You do not have permission to edit premium rules');
      return;
    }

    setEditingRule(rule);
    setNewRule({
      rule_name: rule.rule_name,
      document_category: rule.document_category,
      premium_type: rule.premium_type,
      premium_value: rule.premium_value,
      description: rule.description || '',
      is_active: rule.is_active
    });
    setShowAddRuleModal(true);
    
    recordAction('edit_premium_rule', rule.id);
  };

  const handleDeleteRule = async (ruleId) => {
    if (!canManagePremiums) {
      toast.error('You do not have permission to delete premium rules');
      return;
    }

    if (!confirm('Are you sure you want to delete this premium rule?')) {
      return;
    }

    try {
      await logSecurityEvent('premium_rule_deletion', {
        action: 'delete_premium_rule',
        rule_id: ruleId,
        business_id: selectedBusinessId,
        deleted_by: authUser?.id
      }, 'high');

      const { error } = await supabase
        .from('wage_premium_rules')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;
      toast.success('Premium rule deleted successfully');
      
      recordAction('delete_premium_rule', ruleId);
      loadWagePremiumRules();
    } catch (error) {
      console.error('Error deleting rule:', error);
      toast.error('Failed to delete premium rule');
      
      await logSecurityEvent('premium_rule_deletion_failed', {
        error_message: error.message,
        rule_id: ruleId
      }, 'high');
    }
  };

  const handleToggleRuleStatus = async (ruleId, currentStatus) => {
    if (!canManagePremiums) {
      toast.error('You do not have permission to modify premium rules');
      return;
    }

    try {
      await logSecurityEvent('premium_rule_status_change', {
        action: 'toggle_premium_rule_status',
        rule_id: ruleId,
        new_status: !currentStatus,
        business_id: selectedBusinessId,
        modified_by: authUser?.id
      }, 'medium');

      const { error } = await supabase
        .from('wage_premium_rules')
        .update({ is_active: !currentStatus })
        .eq('id', ruleId);

      if (error) throw error;
      toast.success(`Premium rule ${!currentStatus ? 'activated' : 'deactivated'}`);
      
      recordAction('toggle_premium_rule', ruleId);
      loadWagePremiumRules();
    } catch (error) {
      console.error('Error toggling rule status:', error);
      toast.error('Failed to update rule status');
      
      await logSecurityEvent('premium_rule_status_change_failed', {
        error_message: error.message,
        rule_id: ruleId
      }, 'medium');
    }
  };

  const getExpiryStatusBadge = (status) => {
    const statusConfig = {
      'expired': { color: '#dc2626', bg: '#fee2e2', icon: AlertTriangle, text: 'Expired' },
      'expiring_soon': { color: '#d97706', bg: '#fef3c7', icon: Clock, text: 'Expiring Soon' },
      'expiring_later': { color: '#1e40af', bg: '#dbeafe', icon: Calendar, text: 'Expiring Later' },
      'valid': { color: '#059669', bg: '#d1fae5', icon: CheckCircle, text: 'Valid' }
    };

    const config = statusConfig[status] || statusConfig['valid'];
    const Icon = config.icon;

    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: '600',
        backgroundColor: config.bg,
        color: config.color
      }}>
        <Icon size={12} style={{ marginRight: '4px' }} />
        {config.text}
      </span>
    );
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount || 0);
  };

  // Loading states
  if (permissionsLoading || authLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p>Loading Document Expiry Tracker...</p>
      </div>
    );
  }

  if (!canViewDocuments) {
    return (
      <div style={styles.errorContainer}>
        <AlertTriangle size={48} style={{ color: '#dc2626', marginBottom: '16px' }} />
        <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937' }}>Access Denied</h3>
        <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '8px' }}>
          You do not have permission to view document expiry tracking
        </p>
        <button
          onClick={() => navigate('/dashboard/hr/dashboard')}
          style={styles.backButton}
        >
          Return to HR Dashboard
        </button>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={styles.errorContainer}>
        <AlertTriangle size={48} style={{ color: '#dc2626', marginBottom: '16px' }} />
        <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937' }}>Authentication Error</h3>
        <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '8px' }}>{authError}</p>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="DocumentExpiryTracker"
    >
      <SecurityWrapper>
        <div style={styles.container}>
          <div style={styles.header}>
            <h1 style={styles.title}>Document Expiry Tracker</h1>
            <p style={styles.subtitle}>
              Monitor certification and license expiration dates with automatic wage premium calculations
            </p>
          </div>

          {/* Tab Navigation */}
          <div style={styles.tabContainer}>
            <div style={styles.tabList}>
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'tracker' ? styles.tabActive : {})
                }}
                onClick={() => setActiveTab('tracker')}
              >
                <Eye size={18} />
                Document Tracker
              </button>
              
              <PermissionGate permissions={['hr.wages.manage']} requireElevated fallback={null}>
                <button
                  style={{
                    ...styles.tab,
                    ...(activeTab === 'rules' ? styles.tabActive : {})
                  }}
                  onClick={() => setActiveTab('rules')}
                >
                  <Settings size={18} />
                  Premium Rules
                </button>
              </PermissionGate>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'tracker' && (
            <DocumentTrackerTab
              expiringDocuments={expiringDocuments}
              loading={loading}
              selectedDaysAhead={selectedDaysAhead}
              setSelectedDaysAhead={setSelectedDaysAhead}
              onSendNotifications={sendExpiryNotifications}
              onCalculatePremiums={calculateEmployeePremiums}
              getExpiryStatusBadge={getExpiryStatusBadge}
              formatCurrency={formatCurrency}
              canSendNotifications={canSendNotifications}
            />
          )}

          {activeTab === 'rules' && (
            <PermissionGate permissions={['hr.wages.manage']} requireElevated>
              <PremiumRulesTab
                wagePremiumRules={wagePremiumRules}
                loading={loading}
                onAddRule={() => {
                  setEditingRule(null);
                  setNewRule({
                    rule_name: '',
                    document_category: 'certification',
                    premium_type: 'fixed_amount',
                    premium_value: 0,
                    description: '',
                    is_active: true
                  });
                  setShowAddRuleModal(true);
                }}
                onEditRule={handleEditRule}
                onDeleteRule={handleDeleteRule}
                onToggleStatus={handleToggleRuleStatus}
                formatCurrency={formatCurrency}
              />
            </PermissionGate>
          )}

          {/* Premium Calculator Modal */}
          {showPremiumCalculator && premiumCalculation && (
            <div style={styles.modalOverlay}>
              <div style={styles.modal}>
                <div style={styles.modalHeader}>
                  <h3 style={styles.modalTitle}>Wage Premium Calculation</h3>
                </div>
                
                <div style={styles.modalBody}>
                  <div style={styles.premiumSummary}>
                    <div style={styles.premiumRow}>
                      <span style={styles.premiumLabel}>Base Wage:</span>
                      <span style={styles.premiumValue}>{formatCurrency(premiumCalculation.base_wage)}/hour</span>
                    </div>
                    <div style={styles.premiumRow}>
                      <span style={styles.premiumLabel}>Total Premiums:</span>
                      <span style={styles.premiumValue}>{formatCurrency(premiumCalculation.total_premiums)}/hour</span>
                    </div>
                    <div style={{ ...styles.premiumRow, borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '12px' }}>
                      <span style={{ ...styles.premiumLabel, fontSize: '16px', fontWeight: 'bold' }}>Final Wage:</span>
                      <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#008080' }}>
                        {formatCurrency(premiumCalculation.final_wage)}/hour
                      </span>
                    </div>
                  </div>

                  {premiumCalculation.premium_details && premiumCalculation.premium_details.length > 0 && (
                    <div style={{ marginTop: '20px' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                        Premium Details:
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {premiumCalculation.premium_details.map((detail, index) => (
                          <div key={index} style={styles.premiumDetailCard}>
                            <div style={{ fontSize: '13px', fontWeight: '600', textTransform: 'capitalize' }}>
                              {detail.category.replace(/_/g, ' ')}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                              {detail.type === 'fixed_amount' ? `+${formatCurrency(detail.value)}/hour` : 
                               detail.type === 'percentage' ? `+${detail.value}% of base` :
                               `Set to ${formatCurrency(detail.value)}/hour`}
                            </div>
                            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                              Expires: {new Date(detail.expiry_date).toLocaleDateString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={styles.modalFooter}>
                  <button
                    onClick={() => setShowPremiumCalculator(false)}
                    style={styles.modalCloseButton}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add/Edit Rule Modal */}
          <PermissionGate permissions={['hr.wages.manage']} requireElevated>
            {showAddRuleModal && (
              <div style={styles.modalOverlay}>
                <div style={styles.modal}>
                  <div style={styles.modalHeader}>
                    <h3 style={styles.modalTitle}>
                      {editingRule ? 'Edit Premium Rule' : 'Add Premium Rule'}
                    </h3>
                  </div>
                  
                  <div style={styles.modalBody}>
                    <div style={styles.formGroup}>
                      <label style={styles.formLabel}>Rule Name</label>
                      <input
                        type="text"
                        value={newRule.rule_name}
                        onChange={(e) => setNewRule({ ...newRule, rule_name: e.target.value })}
                        style={styles.formInput}
                        placeholder="e.g., Red Seal Chef Premium"
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.formLabel}>Document Category</label>
                      <select
                        value={newRule.document_category}
                        onChange={(e) => setNewRule({ ...newRule, document_category: e.target.value })}
                        style={styles.formSelect}
                      >
                        <option value="certification">Certification</option>
                        <option value="license">License</option>
                        <option value="training">Training</option>
                        <option value="qualification">Qualification</option>
                      </select>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.formLabel}>Premium Type</label>
                      <select
                        value={newRule.premium_type}
                        onChange={(e) => setNewRule({ ...newRule, premium_type: e.target.value })}
                        style={styles.formSelect}
                      >
                        <option value="fixed_amount">Fixed Amount</option>
                        <option value="percentage">Percentage</option>
                        <option value="set_wage">Set Wage</option>
                      </select>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.formLabel}>
                        Premium Value {newRule.premium_type === 'percentage' ? '(%)' : '($)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newRule.premium_value}
                        onChange={(e) => setNewRule({ ...newRule, premium_value: parseFloat(e.target.value) })}
                        style={styles.formInput}
                        placeholder="0.00"
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.formLabel}>Description (Optional)</label>
                      <textarea
                        value={newRule.description}
                        onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                        style={styles.formTextarea}
                        rows={3}
                        placeholder="Additional details about this premium rule..."
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={newRule.is_active}
                          onChange={(e) => setNewRule({ ...newRule, is_active: e.target.checked })}
                          style={{ marginRight: '8px' }}
                        />
                        Active Rule
                      </label>
                    </div>
                  </div>

                  <div style={styles.modalFooter}>
                    <button
                      onClick={() => {
                        setShowAddRuleModal(false);
                        setEditingRule(null);
                      }}
                      style={styles.modalCancelButton}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveRule}
                      style={styles.modalSaveButton}
                    >
                      {editingRule ? 'Update Rule' : 'Create Rule'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </PermissionGate>

          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

// DOCUMENT TRACKER TAB COMPONENT
const DocumentTrackerTab = ({
  expiringDocuments,
  loading,
  selectedDaysAhead,
  setSelectedDaysAhead,
  onSendNotifications,
  onCalculatePremiums,
  getExpiryStatusBadge,
  formatCurrency,
  canSendNotifications
}) => {
  const expiredCount = expiringDocuments.filter(doc => doc.expiry_status === 'expired').length;
  const expiringSoonCount = expiringDocuments.filter(doc => doc.expiry_status === 'expiring_soon').length;
  const withPremiumCount = expiringDocuments.filter(doc => doc.has_wage_premium).length;

  return (
    <div style={styles.tabContent}>
      {/* Controls */}
      <div style={styles.controlsCard}>
        <div style={styles.controlsContent}>
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Show documents expiring within:</label>
            <select
              value={selectedDaysAhead}
              onChange={(e) => setSelectedDaysAhead(parseInt(e.target.value))}
              style={styles.formSelect}
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          
          {canSendNotifications && (
            <button onClick={onSendNotifications} style={styles.notificationButton}>
              <Bell size={16} style={{ marginRight: '8px' }} />
              Send Notifications
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <AlertTriangle size={24} style={{ color: '#dc2626' }} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>Expired Documents</div>
            <div style={styles.summaryValue}>{expiredCount}</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <Clock size={24} style={{ color: '#d97706' }} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>Expiring Soon</div>
            <div style={styles.summaryValue}>{expiringSoonCount}</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            <DollarSign size={24} style={{ color: '#059669' }} />
          </div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>With Wage Premium</div>
            <div style={styles.summaryValue}>{withPremiumCount}</div>
          </div>
        </div>
      </div>

      {/* Documents Table */}
      <div style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <h3 style={styles.tableTitle}>Documents Requiring Attention</h3>
        </div>
        
        {loading ? (
          <div style={styles.loadingState}>
            <div style={styles.spinner}></div>
          </div>
        ) : expiringDocuments.length === 0 ? (
          <div style={styles.emptyState}>
            <FileText size={48} style={{ color: '#9ca3af', marginBottom: '16px' }} />
            <p style={{ color: '#6b7280' }}>No documents expiring within {selectedDaysAhead} days</p>
          </div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead style={styles.thead}>
                <tr>
                  <th style={styles.th}>Employee</th>
                  <th style={styles.th}>Document</th>
                  <th style={styles.th}>Expiry Date</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Wage Premium</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {expiringDocuments.map((doc) => (
                  <tr key={doc.document_id} style={styles.tr}>
                    <td style={styles.td}>
                      <div style={styles.employeeCell}>
                        <div style={styles.avatar}>
                          <User size={16} style={{ color: '#6b7280' }} />
                        </div>
                        <div style={styles.employeeName}>{doc.employee_name}</div>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.documentName}>{doc.file_name}</div>
                      <div style={styles.documentCategory}>
                        {doc.document_category.replace(/_/g, ' ')}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.expiryDate}>
                        {new Date(doc.expiry_date).toLocaleDateString()}
                      </div>
                      <div style={styles.daysRemaining}>
                        {doc.days_until_expiry >= 0 
                          ? `${doc.days_until_expiry} days remaining`
                          : `${Math.abs(doc.days_until_expiry)} days overdue`
                        }
                      </div>
                    </td>
                    <td style={styles.td}>
                      {getExpiryStatusBadge(doc.expiry_status)}
                    </td>
                    <td style={styles.td}>
                      {doc.has_wage_premium ? (
                        <span style={styles.premiumBadge}>
                          <DollarSign size={12} style={{ marginRight: '4px' }} />
                          Has Premium
                        </span>
                      ) : (
                        <span style={{ fontSize: '14px', color: '#6b7280' }}>No Premium</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <button
                        onClick={() => onCalculatePremiums(doc.employee_id)}
                        style={styles.actionLink}
                      >
                        View Premiums
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// PREMIUM RULES TAB COMPONENT
const PremiumRulesTab = ({
  wagePremiumRules,
  loading,
  onAddRule,
  onEditRule,
  onDeleteRule,
  onToggleStatus,
  formatCurrency
}) => {
  return (
    <div style={styles.tabContent}>
      <div style={styles.rulesHeader}>
        <div>
          <h3 style={styles.rulesTitle}>Wage Premium Rules</h3>
          <p style={styles.rulesSubtitle}>
            Configure automatic wage premiums based on employee certifications and licenses
          </p>
        </div>
        <button onClick={onAddRule} style={styles.addRuleButton}>
          <Plus size={18} style={{ marginRight: '8px' }} />
          Add Premium Rule
        </button>
      </div>

      {loading ? (
        <div style={styles.loadingState}>
          <div style={styles.spinner}></div>
        </div>
      ) : wagePremiumRules.length === 0 ? (
        <div style={styles.emptyState}>
          <DollarSign size={48} style={{ color: '#9ca3af', marginBottom: '16px' }} />
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#1f2937', marginBottom: '8px' }}>
            No Premium Rules
          </h3>
          <p style={{ color: '#6b7280', marginBottom: '20px' }}>
            Create your first wage premium rule to automatically calculate premiums
          </p>
          <button onClick={onAddRule} style={styles.addRuleButton}>
            <Plus size={18} style={{ marginRight: '8px' }} />
            Add Premium Rule
          </button>
        </div>
      ) : (
        <div style={styles.rulesGrid}>
          {wagePremiumRules.map((rule) => (
            <div key={rule.id} style={styles.ruleCard}>
              <div style={styles.ruleHeader}>
                <div style={styles.ruleTitleRow}>
                  <h4 style={styles.ruleTitle}>{rule.rule_name}</h4>
                  <span style={{
                    ...styles.statusBadge,
                    backgroundColor: rule.is_active ? '#d1fae5' : '#fee2e2',
                    color: rule.is_active ? '#059669' : '#dc2626'
                  }}>
                    {rule.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div style={styles.ruleCategory}>
                  {rule.document_category.replace(/_/g, ' ')}
                </div>
              </div>

              <div style={styles.ruleBody}>
                <div style={styles.ruleDetail}>
                  <span style={styles.ruleDetailLabel}>Premium Type:</span>
                  <span style={styles.ruleDetailValue}>
                    {rule.premium_type === 'fixed_amount' ? 'Fixed Amount' :
                     rule.premium_type === 'percentage' ? 'Percentage' : 'Set Wage'}
                  </span>
                </div>

                <div style={styles.ruleDetail}>
                  <span style={styles.ruleDetailLabel}>Premium Value:</span>
                  <span style={{ ...styles.ruleDetailValue, fontWeight: 'bold', color: '#008080' }}>
                    {rule.premium_type === 'percentage' 
                      ? `${rule.premium_value}%`
                      : formatCurrency(rule.premium_value)
                    }
                  </span>
                </div>

                {rule.description && (
                  <div style={styles.ruleDescription}>
                    {rule.description}
                  </div>
                )}
              </div>

              <div style={styles.ruleActions}>
                <button
                  onClick={() => onToggleStatus(rule.id, rule.is_active)}
                  style={styles.ruleActionButton}
                >
                  {rule.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => onEditRule(rule)}
                  style={styles.ruleActionButton}
                >
                  Edit
                </button>
                <button
                  onClick={() => onDeleteRule(rule.id)}
                  style={styles.ruleDeleteButton}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '20px',
    paddingTop: '100px',
    boxSizing: 'border-box'
  },
  header: {
    marginBottom: '30px',
    textAlign: 'center'
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  subtitle: {
    fontSize: '14px',
    color: '#6b7280',
    marginTop: '8px'
  },
  tabContainer: {
    marginBottom: '30px',
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  tabList: {
    display: 'flex',
    borderBottom: '1px solid #e5e7eb'
  },
  tab: {
    flex: 1,
    padding: '16px',
    backgroundColor: '#f8f9fa',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s',
    borderRight: '1px solid #e5e7eb'
  },
  tabActive: {
    backgroundColor: '#008080',
    color: 'white'
  },
  tabContent: {
    flex: 1,
    overflowY: 'auto'
  },
  controlsCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '24px',
    marginBottom: '24px'
  },
  controlsContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '20px',
    flexWrap: 'wrap'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  formLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px'
  },
  formInput: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px'
  },
  formSelect: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: 'white'
  },
  formTextarea: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer'
  },
  notificationButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '24px'
  },
  summaryCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '20px',
    display: 'flex',
    alignItems: 'center'
  },
  summaryIcon: {
    marginRight: '16px'
  },
  summaryContent: {
    flex: 1
  },
  summaryLabel: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '4px'
  },
  summaryValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  tableCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  tableHeader: {
    padding: '20px 24px',
    borderBottom: '1px solid #e5e7eb'
  },
  tableTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  tableContainer: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  thead: {
    backgroundColor: '#f8f9fa'
  },
  th: {
    padding: '12px 24px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  tr: {
    borderBottom: '1px solid #e5e7eb'
  },
  td: {
    padding: '16px 24px',
    fontSize: '14px'
  },
  employeeCell: {
    display: 'flex',
    alignItems: 'center'
  },
  avatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: '#e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '12px'
  },
  employeeName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#1f2937'
  },
  documentName: {
    fontSize: '14px',
    color: '#1f2937',
    marginBottom: '4px'
  },
  documentCategory: {
    fontSize: '13px',
    color: '#6b7280',
    textTransform: 'capitalize'
  },
  expiryDate: {
    fontSize: '14px',
    color: '#1f2937',
    marginBottom: '4px'
  },
  daysRemaining: {
    fontSize: '13px',
    color: '#6b7280'
  },
  premiumBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    backgroundColor: '#d1fae5',
    color: '#059669'
  },
  actionLink: {
    background: 'none',
    border: 'none',
    color: '#008080',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    textDecoration: 'underline'
  },
  rulesHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb'
  },
  rulesTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  rulesSubtitle: {
    fontSize: '14px',
    color: '#6b7280',
    marginTop: '4px'
  },
  addRuleButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  rulesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '20px'
  },
  ruleCard: {
    backgroundColor: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px'
  },
  ruleHeader: {
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid #e5e7eb'
  },
  ruleTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  ruleTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600'
  },
  ruleCategory: {
    fontSize: '13px',
    color: '#6b7280',
    textTransform: 'capitalize'
  },
  ruleBody: {
    marginBottom: '16px'
  },
  ruleDetail: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px'
  },
  ruleDetailLabel: {
    fontSize: '14px',
    color: '#6b7280'
  },
  ruleDetailValue: {
    fontSize: '14px',
    color: '#1f2937',
    fontWeight: '500'
  },
  ruleDescription: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  ruleActions: {
    display: 'flex',
    gap: '8px'
  },
  ruleActionButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  ruleDeleteButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },
  modalHeader: {
    padding: '24px',
    borderBottom: '1px solid #e5e7eb'
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  modalBody: {
    padding: '24px',
    overflowY: 'auto',
    flex: 1
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '1px solid #e5e7eb'
  },
  modalCancelButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  modalSaveButton: {
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  modalCloseButton: {
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  premiumSummary: {
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px'
  },
  premiumRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '12px'
  },
  premiumLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151'
  },
  premiumValue: {
    fontSize: '14px',
    color: '#1f2937'
  },
  premiumDetailCard: {
    fontSize: '12px',
    backgroundColor: '#dbeafe',
    borderRadius: '6px',
    padding: '12px'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '16px'
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '40px'
  },
  backButton: {
    marginTop: '20px',
    padding: '12px 24px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  loadingState: {
    display: 'flex',
    justifyContent: 'center',
    padding: '60px'
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    textAlign: 'center'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #e5e7eb',
    borderTop: '3px solid #008080',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  }
};

export default DocumentExpiryTracker;
// components/Inbox/MailboxManagement.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';
import {
  FiMail,
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiUsers,
  FiArrowRight,
  FiSettings,
  FiCheck,
  FiX,
  FiRefreshCw
} from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

const MailboxManagement = ({ businessId: propBusinessId }) => {
  // Get businessId from props or use auth context
  const { selectedBusinessId, authUser } = usePOSAuth();
  const businessId = propBusinessId || selectedBusinessId;
  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const { checkRateLimit, recordAction, logSecurityEvent } = useSecurityContext({
    componentName: 'MailboxManagement',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [domains, setDomains] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingMailbox, setEditingMailbox] = useState(null);
  const [deletingMailboxId, setDeletingMailboxId] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    email_address: '',
    display_name: '',
    description: '',
    mailbox_type: 'individual',
    assigned_to_user_id: null,
    forwarding_enabled: false,
    forwarding_addresses: [],
    keep_copy: true,
    shared_with_user_ids: [],
    storage_quota_mb: 1024,
    auto_responder_enabled: false,
    auto_responder_subject: '',
    auto_responder_message: '',
    domain_id: null
  });

  const [newForwardingAddress, setNewForwardingAddress] = useState('');

  const canCreate = hasPermission('inbox.mailboxes.create') || hasElevatedPrivileges();
  const canUpdate = hasPermission('inbox.mailboxes.update') || hasElevatedPrivileges();
  const canDelete = hasPermission('inbox.mailboxes.delete') || hasElevatedPrivileges();

  // Load mailboxes
  const loadMailboxes = useCallback(async () => {
    if (!businessId) return;
    try {
      setLoading(true);
      // First, get all mailboxes for the business
      const { data: mailboxesData, error: mailboxesError } = await supabase
        .from('mailboxes')
        .select('*')
        .eq('business_id', businessId)
        .order('email_address', { ascending: true });

      if (mailboxesError) {
        console.error('[MailboxManagement] Supabase query error:', mailboxesError);
        console.error('[MailboxManagement] Error code:', mailboxesError.code);
        console.error('[MailboxManagement] Error message:', mailboxesError.message);
        console.error('[MailboxManagement] Error hint:', mailboxesError.hint);
        
        // If table doesn't exist, provide helpful message
        if (mailboxesError.code === 'PGRST116' || mailboxesError.message?.includes('does not exist')) {
          throw new Error('Mailboxes table not found. Please run the database migration: create_mailboxes_table.sql');
        }
        
        throw mailboxesError;
      }
      
      console.log('[MailboxManagement] Found', mailboxesData?.length || 0, 'mailboxes');

      // Then, enrich with domain and user data (handle errors gracefully)
      const enrichedMailboxes = await Promise.all(
        (mailboxesData || []).map(async (mailbox) => {
          const enriched = { ...mailbox };

          // Get domain info if domain_id exists
          if (mailbox.domain_id) {
            try {
              const { data: domainData, error: domainError } = await supabase
                .from('mail_domains')
                .select('id, domain, domain_name, verified')
                .eq('id', mailbox.domain_id)
                .maybeSingle(); // Use maybeSingle() instead of single() to avoid errors
              
              if (!domainError && domainData) {
                enriched.domain = domainData;
                enriched.mail_domains = domainData;
              }
            } catch (err) {
              console.warn('[MailboxManagement] Could not load domain for mailbox:', mailbox.id, err);
            }
          }

          // Get assigned user info if assigned_to_user_id exists
          if (mailbox.assigned_to_user_id) {
            try {
              const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, first_name, last_name, email')
                .eq('id', mailbox.assigned_to_user_id)
                .maybeSingle(); // Use maybeSingle() instead of single() to avoid errors
              
              if (!userError && userData) {
                enriched.assigned_user = userData;
              }
            } catch (err) {
              console.warn('[MailboxManagement] Could not load user for mailbox:', mailbox.id, err);
            }
          }

          return enriched;
        })
      );

      console.log('[MailboxManagement] Loaded', enrichedMailboxes.length, 'mailboxes');
      setMailboxes(enrichedMailboxes);
    } catch (error) {
      console.error('[MailboxManagement] Error loading mailboxes:', error);
      console.error('[MailboxManagement] Error code:', error.code);
      console.error('[MailboxManagement] Error message:', error.message);
      console.error('[MailboxManagement] Error details:', JSON.stringify(error, null, 2));
      toast.error('Failed to load mailboxes: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  // Load employees
  const loadEmployees = useCallback(async () => {
    if (!businessId) return;
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          email,
          position,
          business_users!inner(business_id, role)
        `)
        .eq('business_users.business_id', businessId)
        .in('employment_status', ['active', 'probation'])
        .order('first_name');

      if (error) throw error;
      setEmployees(data || []);
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  }, [businessId]);

  // Load domains - use same pattern as TavariInboxDashboard
  const loadDomains = useCallback(async () => {
    if (!businessId) {
      console.warn('[MailboxManagement] Cannot load domains: no businessId');
      return;
    }
    try {
      setLoadingDomains(true);
      console.log('[MailboxManagement] Loading domains for business:', businessId);
      
      // Use same query pattern as the dashboard
      const { data, error } = await supabase
        .from('mail_domains')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[MailboxManagement] Supabase error:', error);
        console.error('[MailboxManagement] Error code:', error.code);
        console.error('[MailboxManagement] Error message:', error.message);
        console.error('[MailboxManagement] Error details:', JSON.stringify(error, null, 2));
        throw error;
      }
      
      console.log('[MailboxManagement] Raw domains data:', data);
      console.log('[MailboxManagement] Number of domains:', data?.length || 0);
      
      if (data && data.length > 0) {
        console.log('[MailboxManagement] First domain sample:', data[0]);
      }
      
      // Map domains same way as dashboard does
      const mappedDomains = (data || []).map(domain => {
        const domainName = domain.domain || domain.domain_name || '';
        const statusRaw = domain.ses_verification_status || (domain.verified ? 'Verified' : 'Pending');
        return {
          ...domain,
          domain_name: domainName,
          domain: domain.domain || domainName,
          status: statusRaw?.toString().toLowerCase() || 'pending'
        };
      });
      
      console.log('[MailboxManagement] Mapped domains:', mappedDomains);
      console.log('[MailboxManagement] Setting domains state with', mappedDomains.length, 'domains');
      setDomains(mappedDomains);
      
      if (mappedDomains.length === 0) {
        console.warn('[MailboxManagement] No domains found. Check business_id match and RLS policies.');
      }
    } catch (error) {
      console.error('[MailboxManagement] Error loading domains:', error);
      toast.error('Failed to load domains: ' + (error.message || 'Unknown error'));
    } finally {
      setLoadingDomains(false);
    }
  }, [businessId]);

  useEffect(() => {
    console.log('[MailboxManagement] useEffect triggered, businessId:', businessId);
    if (businessId) {
      loadMailboxes();
      loadEmployees();
      loadDomains();
    } else {
      console.warn('[MailboxManagement] No businessId available');
    }
  }, [businessId, loadMailboxes, loadEmployees, loadDomains]);

  // Debug: Log when domains state changes
  useEffect(() => {
    console.log('[MailboxManagement] Domains state changed:', domains.length, 'domains');
    if (domains.length > 0) {
      console.log('[MailboxManagement] Available domains:', domains.map(d => ({ 
        id: d.id, 
        name: d.domain_name || d.domain,
        verified: d.verified,
        status: d.ses_verification_status
      })));
    } else {
      console.warn('[MailboxManagement] Domains array is empty');
    }
  }, [domains]);

  const handleCreate = () => {
    // Reload domains when opening modal to ensure we have latest data
    if (businessId) {
      loadDomains();
    }
    
    setFormData({
      email_address: '',
      display_name: '',
      description: '',
      mailbox_type: 'individual',
      assigned_to_user_id: null,
      forwarding_enabled: false,
      forwarding_addresses: [],
      keep_copy: true,
      shared_with_user_ids: [],
      storage_quota_mb: 1024,
      auto_responder_enabled: false,
      auto_responder_subject: '',
      auto_responder_message: '',
      domain_id: domains[0]?.id || null
    });
    setEditingMailbox(null);
    setShowCreateModal(true);
  };

  const handleEdit = (mailbox) => {
    const accessUserIds = [
      ...new Set([
        ...(mailbox.shared_with_user_ids || []),
        mailbox.assigned_to_user_id
      ].filter(Boolean))
    ];
    const emailLocalPart = mailbox.email_address?.includes('@')
      ? mailbox.email_address.split('@')[0]
      : mailbox.email_address;

    setFormData({
      email_address: emailLocalPart,
      display_name: mailbox.display_name || '',
      description: mailbox.description || '',
      mailbox_type: mailbox.mailbox_type,
      assigned_to_user_id: mailbox.assigned_to_user_id,
      forwarding_enabled: mailbox.forwarding_enabled || false,
      forwarding_addresses: mailbox.forwarding_addresses || [],
      keep_copy: mailbox.keep_copy !== false,
      shared_with_user_ids: accessUserIds,
      storage_quota_mb: mailbox.storage_quota_mb || 1024,
      auto_responder_enabled: mailbox.auto_responder_enabled || false,
      auto_responder_subject: mailbox.auto_responder_subject || '',
      auto_responder_message: mailbox.auto_responder_message || '',
      domain_id: mailbox.domain_id
    });
    setEditingMailbox(mailbox);
    setShowCreateModal(true);
  };

  const handleDelete = async (mailboxId) => {
    if (!confirm('Are you sure you want to delete this mailbox? This action cannot be undone.')) {
      return;
    }

    try {
      if (!checkRateLimit('delete_mailbox', 5, 60000)) {
        toast.error('Please wait before deleting another mailbox.');
        return;
      }

      setDeletingMailboxId(mailboxId);
      const { error } = await supabase
        .from('mailboxes')
        .delete()
        .eq('id', mailboxId);

      if (error) throw error;

      toast.success('Mailbox deleted successfully');
      await recordAction('mailbox_deleted', true, mailboxId);
      await logSecurityEvent('mailbox_deleted', { mailbox_id: mailboxId }, 'high');
      loadMailboxes();
    } catch (error) {
      console.error('Error deleting mailbox:', error);
      toast.error('Failed to delete mailbox: ' + error.message);
      await recordAction('mailbox_deleted', false, mailboxId);
    } finally {
      setDeletingMailboxId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.email_address || !formData.domain_id) {
      toast.error('Email address and domain are required');
      return;
    }

    try {
      if (!checkRateLimit('save_mailbox', 10, 60000)) {
        toast.error('Please wait before saving again.');
        return;
      }

      // Construct full email address from username + domain
      const selectedDomain = domains.find(d => d.id === formData.domain_id);
      if (!selectedDomain) {
        toast.error('Please select a domain');
        return;
      }
      
      const domainName = selectedDomain.domain_name || selectedDomain.domain;
      const fullEmailAddress = `${formData.email_address.toLowerCase().trim()}@${domainName}`;
      
      console.log('[MailboxManagement] Creating mailbox with email:', fullEmailAddress);

      const accessUserIds = formData.mailbox_type === 'forwarding'
        ? []
        : [...new Set((formData.shared_with_user_ids || []).filter(Boolean))];

      const mailboxData = {
        business_id: businessId,
        domain_id: formData.domain_id,
        email_address: fullEmailAddress,
        display_name: formData.display_name || null,
        description: formData.description || null,
        mailbox_type: formData.mailbox_type,
        assigned_to_user_id: accessUserIds[0] || null,
        forwarding_enabled: formData.forwarding_enabled,
        forwarding_addresses: formData.forwarding_addresses.filter(addr => addr.trim()),
        keep_copy: formData.keep_copy,
        shared_with_user_ids: accessUserIds,
        storage_quota_mb: formData.storage_quota_mb,
        auto_responder_enabled: formData.auto_responder_enabled,
        auto_responder_subject: formData.auto_responder_subject || null,
        auto_responder_message: formData.auto_responder_message || null,
        created_by: authUser?.id
      };

      if (editingMailbox) {
        const { error } = await supabase
          .from('mailboxes')
          .update(mailboxData)
          .eq('id', editingMailbox.id);

        if (error) throw error;
        toast.success('Mailbox updated successfully');
        await recordAction('mailbox_updated', true, editingMailbox.id);
      } else {
        const { error } = await supabase
          .from('mailboxes')
          .insert(mailboxData);

        if (error) throw error;
        toast.success('Mailbox created successfully');
        await recordAction('mailbox_created', true);
      }

      await logSecurityEvent('mailbox_saved', { 
        mailbox_id: editingMailbox?.id,
        email: formData.email_address 
      }, 'medium');

      setShowCreateModal(false);
      loadMailboxes();
    } catch (error) {
      console.error('Error saving mailbox:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      // Check for specific error types
      if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
        // Unique constraint violation
        toast.error('A mailbox with this email address already exists for this business. Please choose a different email address.');
      } else if (error.code === '23503' || error.message?.includes('foreign key')) {
        // Foreign key violation
        toast.error('Invalid domain or user selected. Please check your selections.');
      } else if (error.code === 'PGRST116' || error.message?.includes('404')) {
        // Table doesn't exist
        toast.error('Mailboxes table not found. Please run the database migration.');
      } else {
        toast.error('Failed to save mailbox: ' + (error.message || 'Unknown error'));
      }
      
      await recordAction(editingMailbox ? 'mailbox_updated' : 'mailbox_created', false);
    }
  };

  const addForwardingAddress = () => {
    if (newForwardingAddress.trim() && !formData.forwarding_addresses.includes(newForwardingAddress.trim())) {
      setFormData({
        ...formData,
        forwarding_addresses: [...formData.forwarding_addresses, newForwardingAddress.trim()]
      });
      setNewForwardingAddress('');
    }
  };

  const removeForwardingAddress = (address) => {
    setFormData({
      ...formData,
      forwarding_addresses: formData.forwarding_addresses.filter(addr => addr !== address)
    });
  };

  const toggleSharedUser = (userId) => {
    const current = formData.shared_with_user_ids || [];
    if (current.includes(userId)) {
      setFormData({
        ...formData,
        shared_with_user_ids: current.filter(id => id !== userId)
      });
    } else {
      setFormData({
        ...formData,
        shared_with_user_ids: [...current, userId]
      });
    }
  };

  const getMailboxTypeLabel = (type) => {
    const labels = {
      individual: 'Individual',
      shared: 'Shared',
      group: 'Group',
      forwarding: 'Forwarding'
    };
    return labels[type] || type;
  };

  const getStatusBadge = (status) => {
    const styles = {
      active: { backgroundColor: '#e8f5e8', color: '#2e7d32' },
      suspended: { backgroundColor: '#fff3cd', color: '#856404' },
      archived: { backgroundColor: '#e0e0e0', color: '#666' }
    };
    return styles[status] || styles.active;
  };

  if (loading && mailboxes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <FiRefreshCw className="spin" style={{ fontSize: '24px', marginBottom: '12px' }} />
        <p>Loading mailboxes...</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>Mailboxes</h2>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Manage email mailboxes for your business domain
          </p>
        </div>
        {canCreate && (
          <button
            onClick={handleCreate}
            style={{
              ...styles.primaryButton,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <FiPlus size={18} />
            Create Mailbox
          </button>
        )}
      </div>

      {mailboxes.length === 0 ? (
        <div style={styles.emptyState}>
          <FiMail size={48} style={{ color: '#999', marginBottom: '16px' }} />
          <h3 style={{ marginBottom: '8px' }}>No mailboxes yet</h3>
          <p style={{ color: '#666', marginBottom: '20px' }}>
            Create your first mailbox to start receiving emails
          </p>
          {canCreate && (
            <button onClick={handleCreate} style={styles.primaryButton}>
              <FiPlus size={18} style={{ marginRight: '8px' }} />
              Create First Mailbox
            </button>
          )}
        </div>
      ) : (
        <div style={styles.mailboxGrid}>
          {mailboxes.map((mailbox) => (
            <div key={mailbox.id} style={styles.mailboxCard}>
              <div style={styles.mailboxHeader}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <FiMail size={20} style={{ color: '#008080' }} />
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>
                        {mailbox.email_address}
                      </div>
                      {mailbox.display_name && (
                        <div style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>
                          {mailbox.display_name}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                    <span style={{ ...styles.badge, ...getStatusBadge(mailbox.status) }}>
                      {mailbox.status}
                    </span>
                    <span style={{ ...styles.badge, backgroundColor: '#e3f2fd', color: '#1976d2' }}>
                      {getMailboxTypeLabel(mailbox.mailbox_type)}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {canUpdate && (
                    <button
                      onClick={() => handleEdit(mailbox)}
                      style={styles.iconButton}
                      title="Edit mailbox"
                    >
                      <FiEdit2 size={18} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(mailbox.id)}
                      disabled={deletingMailboxId === mailbox.id}
                      style={{ ...styles.iconButton, color: '#d32f2f' }}
                      title="Delete mailbox"
                    >
                      {deletingMailboxId === mailbox.id ? (
                        <FiRefreshCw className="spin" size={18} />
                      ) : (
                        <FiTrash2 size={18} />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div style={styles.mailboxBody}>
                {mailbox.assigned_user && (
                  <div style={styles.infoRow}>
                    <strong>Assigned to:</strong> {mailbox.assigned_user.first_name} {mailbox.assigned_user.last_name}
                  </div>
                )}
                {mailbox.forwarding_enabled && mailbox.forwarding_addresses?.length > 0 && (
                  <div style={styles.infoRow}>
                    <strong>Forwarding to:</strong> {mailbox.forwarding_addresses.join(', ')}
                  </div>
                )}
                {mailbox.shared_with_user_ids?.length > 0 && (
                  <div style={styles.infoRow}>
                    <strong>Access:</strong> {mailbox.shared_with_user_ids.length} user(s)
                  </div>
                )}
                {mailbox.auto_responder_enabled && (
                  <div style={styles.infoRow}>
                    <strong>Auto-responder:</strong> Enabled
                  </div>
                )}
                <div style={styles.infoRow}>
                  <strong>Storage:</strong> {mailbox.current_storage_mb || 0} MB / {mailbox.storage_quota_mb} MB
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div style={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                {editingMailbox ? 'Edit Mailbox' : 'Create Mailbox'}
              </h2>
              <button onClick={() => setShowCreateModal(false)} style={styles.closeButton}>
                <FiX size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={styles.formSection}>
                <label style={styles.label}>Domain *</label>
                {loadingDomains ? (
                  <div style={{ padding: '10px', color: '#666', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FiRefreshCw className="spin" size={16} />
                    Loading domains...
                  </div>
                ) : (
                  <>
                    <select
                      value={formData.domain_id || ''}
                      onChange={(e) => {
                        console.log('[MailboxManagement] Domain selected:', e.target.value, 'from', domains.length, 'domains');
                        setFormData({ ...formData, domain_id: e.target.value });
                      }}
                      style={styles.select}
                      required
                    >
                      <option value="">Select a domain</option>
                      {domains.length === 0 ? (
                        <option value="" disabled>
                          No domains available. Add a domain in the Domains tab first.
                        </option>
                      ) : (
                        domains.map(domain => {
                          const domainName = domain.domain_name || domain.domain || 'Unknown';
                          const isVerified = domain.verified === true || domain.ses_verification_status?.toLowerCase() === 'success';
                          return (
                            <option key={domain.id} value={domain.id}>
                              {domainName} {isVerified ? '✓' : '(Pending)'}
                            </option>
                          );
                        })
                      )}
                    </select>
                    {domains.length > 0 && (
                      <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                        {domains.length} domain(s) available
                      </div>
                    )}
                    {domains.length === 0 && !loadingDomains && (
                      <div style={{ fontSize: '13px', color: '#d32f2f', marginTop: '4px' }}>
                        Debug: businessId={businessId}, domains state length={domains.length}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={styles.formSection}>
                <label style={styles.label}>Email Address *</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    value={formData.email_address}
                    onChange={(e) => setFormData({ ...formData, email_address: e.target.value })}
                    placeholder="username"
                    style={{ ...styles.input, flex: 1 }}
                    required
                  />
                  <span style={{ color: '#666' }}>@</span>
                  <span style={{ color: '#666', minWidth: '150px' }}>
                    {(() => {
                      const selectedDomain = domains.find(d => d.id === formData.domain_id);
                      return selectedDomain?.domain_name || selectedDomain?.domain || 'domain.com';
                    })()}
                  </span>
                </div>
              </div>

              <div style={styles.formSection}>
                <label style={styles.label}>Display Name</label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder="Mailbox display name"
                  style={styles.input}
                />
              </div>

              <div style={styles.formSection}>
                <label style={styles.label}>Mailbox Type *</label>
                <select
                  value={formData.mailbox_type}
                  onChange={(e) => setFormData({ ...formData, mailbox_type: e.target.value })}
                  style={styles.select}
                  required
                >
                  <option value="individual">Individual</option>
                  <option value="shared">Shared</option>
                  <option value="group">Group</option>
                  <option value="forwarding">Forwarding Only</option>
                </select>
              </div>

              {formData.mailbox_type !== 'forwarding' && (
                <div style={styles.formSection}>
                  <label style={styles.label}>Mailbox Access</label>
                  <p style={styles.helpText}>
                    Select every employee who should be able to access this mailbox.
                  </p>
                  <div style={styles.checkboxList}>
                    {employees.length === 0 ? (
                      <p style={styles.emptyListText}>No active employees found.</p>
                    ) : (
                      employees.map(emp => (
                        <TavariCheckbox
                          key={emp.id}
                          id={`mailbox-access-${emp.id}`}
                          checked={(formData.shared_with_user_ids || []).includes(emp.id)}
                          onChange={() => toggleSharedUser(emp.id)}
                          label={`${emp.first_name} ${emp.last_name} (${emp.email})`}
                          size="sm"
                          appearance="native"
                          style={styles.checkboxItem}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}

              <div style={styles.formSection}>
                <TavariCheckbox
                  id="mailbox-forwarding-enabled"
                  checked={formData.forwarding_enabled}
                  onChange={(checked) => setFormData({ ...formData, forwarding_enabled: checked })}
                  label="Enable Email Forwarding"
                  appearance="native"
                />
              </div>

              {formData.forwarding_enabled && (
                <>
                  <div style={styles.formSection}>
                    <label style={styles.label}>Forwarding Addresses</label>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="email"
                        value={newForwardingAddress}
                        onChange={(e) => setNewForwardingAddress(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addForwardingAddress())}
                        placeholder="email@example.com"
                        style={styles.input}
                      />
                      <button
                        type="button"
                        onClick={addForwardingAddress}
                        style={styles.addButton}
                      >
                        <FiPlus size={18} />
                      </button>
                    </div>
                    {formData.forwarding_addresses.length > 0 && (
                      <div style={styles.tagList}>
                        {formData.forwarding_addresses.map((addr, idx) => (
                          <span key={idx} style={styles.tag}>
                            {addr}
                            <button
                              type="button"
                              onClick={() => removeForwardingAddress(addr)}
                              style={styles.tagRemove}
                            >
                              <FiX size={14} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={styles.formSection}>
                    <TavariCheckbox
                      id="mailbox-keep-copy"
                      checked={formData.keep_copy}
                      onChange={(checked) => setFormData({ ...formData, keep_copy: checked })}
                      label="Keep a copy in this mailbox"
                      appearance="native"
                    />
                  </div>
                </>
              )}

              <div style={styles.formSection}>
                <TavariCheckbox
                  id="mailbox-auto-responder-enabled"
                  checked={formData.auto_responder_enabled}
                  onChange={(checked) => setFormData({ ...formData, auto_responder_enabled: checked })}
                  label="Enable Auto-Responder"
                  appearance="native"
                />
              </div>

              {formData.auto_responder_enabled && (
                <>
                  <div style={styles.formSection}>
                    <label style={styles.label}>Auto-Responder Subject</label>
                    <input
                      type="text"
                      value={formData.auto_responder_subject}
                      onChange={(e) => setFormData({ ...formData, auto_responder_subject: e.target.value })}
                      placeholder="Out of Office"
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.formSection}>
                    <label style={styles.label}>Auto-Responder Message</label>
                    <textarea
                      value={formData.auto_responder_message}
                      onChange={(e) => setFormData({ ...formData, auto_responder_message: e.target.value })}
                      placeholder="Thank you for your email..."
                      rows={4}
                      style={styles.textarea}
                    />
                  </div>
                </>
              )}

              <div style={styles.formSection}>
                <label style={styles.label}>Storage Quota (MB)</label>
                <input
                  type="number"
                  value={formData.storage_quota_mb}
                  onChange={(e) => setFormData({ ...formData, storage_quota_mb: parseInt(e.target.value) || 1024 })}
                  min={100}
                  max={10240}
                  style={styles.input}
                />
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={styles.secondaryButton}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.primaryButton}>
                  <FiCheck size={18} style={{ marginRight: '8px' }} />
                  {editingMailbox ? 'Update' : 'Create'} Mailbox
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  primaryButton: {
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'inline-flex',
    alignItems: 'center'
  },
  secondaryButton: {
    backgroundColor: '#e0e0e0',
    color: '#333',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  iconButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '4px',
    transition: 'all 0.2s'
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e0e0e0'
  },
  mailboxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '20px'
  },
  mailboxCard: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e0e0e0',
    padding: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
  },
  mailboxHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid #e0e0e0'
  },
  mailboxBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  infoRow: {
    fontSize: '14px',
    color: '#666',
    display: 'flex',
    gap: '8px'
  },
  badge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: 'bold',
    display: 'inline-block'
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
    zIndex: 1000,
    padding: '20px'
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '600px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 12px 40px rgba(0,0,0,0.2)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    borderBottom: '1px solid #e0e0e0'
  },
  modalTitle: {
    fontSize: '23px',
    fontWeight: 'bold',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    color: '#666'
  },
  formSection: {
    marginBottom: '20px',
    padding: '0 24px'
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px'
  },
  helpText: {
    margin: '0 0 10px 0',
    fontSize: '13px',
    color: '#666',
    lineHeight: 1.4
  },
  input: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px'
  },
  select: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: '#fff'
  },
  textarea: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical'
  },
  checkboxList: {
    maxHeight: '200px',
    overflowY: 'auto',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '12px'
  },
  checkboxItem: {
    marginBottom: '8px'
  },
  emptyListText: {
    margin: 0,
    fontSize: '14px',
    color: '#666'
  },
  addButton: {
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center'
  },
  tagList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px'
  },
  tag: {
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    padding: '6px 12px',
    borderRadius: '16px',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  tagRemove: {
    background: 'none',
    border: 'none',
    color: '#1976d2',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '24px',
    borderTop: '1px solid #e0e0e0'
  }
};

export default MailboxManagement;


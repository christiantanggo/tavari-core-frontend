// screens/Mail/CampaignList.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import EmailPauseBanner, { blockEmailSendIfPaused } from '../../components/EmailPauseBanner';
import { 
  FiMail, FiPlus, FiEdit3, FiSend, FiEye, FiTrash2, FiCopy, 
  FiClock, FiCheckCircle, FiAlertCircle, FiRefreshCw 
} from 'react-icons/fi';

// Permission System Imports
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';

const CampaignList = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  
  // Security context for campaign data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'CampaignList',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'low'
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
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'CampaignList'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, draft, sent, scheduled
  const [error, setError] = useState(null);

  // Email sending pause state for UI updates
  const [emailSendingPaused, setEmailSendingPaused] = useState(() => {
    const stored = localStorage.getItem('EMAIL_SENDING_PAUSED');
    return stored ? JSON.parse(stored) : true; // Default to paused for safety
  });

  // Use localStorage as primary source, context as fallback
  const businessId = localStorage.getItem('currentBusinessId') || business?.id;

  // Permission checks
  const canViewCampaigns = hasPermission('mail.campaigns.view') || hasElevatedPrivileges();
  const canCreateCampaigns = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();
  const canEditCampaigns = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();
  const canSendCampaigns = hasPermission('mail.campaigns.send') || hasElevatedPrivileges();
  const canDeleteCampaigns = hasPermission('mail.campaigns.delete') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !authLoading && !canViewCampaigns) {
      toast.error('You do not have permission to view campaigns');
      navigate('/dashboard');
    }
  }, [permissionsLoading, authLoading, canViewCampaigns]);

  useEffect(() => {
    if (businessId && !authLoading && !permissionsLoading && canViewCampaigns) {
      loadCampaigns();
    }
  }, [businessId, filter, authLoading, permissionsLoading, canViewCampaigns]);

  // Listen for localStorage changes to update pause state
  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem('EMAIL_SENDING_PAUSED');
      setEmailSendingPaused(stored ? JSON.parse(stored) : true);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('emailPauseStateChanged', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('emailPauseStateChanged', handleStorageChange);
    };
  }, []);

  const loadCampaigns = async () => {
    if (!businessId || !canViewCampaigns) return;
    
    // Rate limiting
    if (!checkRateLimit('load_campaigns', 10, 60000)) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await logSecurityEvent('campaigns_list_access', {
        action: 'load_campaigns',
        filter: filter,
        business_id: businessId,
        user_id: authUser?.id
      }, 'low');
      
      let query = supabase
        .from('mail_campaigns')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      // Apply status filter
      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading campaigns:', error);
        setError('Failed to load campaigns. Please try again.');
        setCampaigns([]);
        await recordAction('campaigns_loaded', false, businessId);
        return;
      }

      setCampaigns(data || []);
      await recordAction('campaigns_loaded', true, businessId);
    } catch (error) {
      console.error('Error loading campaigns:', error);
      setError('Failed to load campaigns. Please try again.');
      setCampaigns([]);
      await recordAction('campaigns_loaded', false, businessId);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':
        return <FiCheckCircle style={{ color: '#4caf50' }} />;
      case 'draft':
        return <FiEdit3 style={{ color: '#ff9800' }} />;
      case 'scheduled':
        return <FiClock style={{ color: '#2196f3' }} />;
      case 'failed':
        return <FiAlertCircle style={{ color: '#f44336' }} />;
      case 'sending':
        // Show paused icon if sending is paused, otherwise show spinning icon
        return emailSendingPaused ? 
          <FiAlertCircle style={{ color: '#ff9800' }} /> : 
          <FiRefreshCw style={{ color: '#2196f3' }} />;
      default:
        return <FiMail style={{ color: '#666' }} />;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'sent':
        return 'Sent';
      case 'draft':
        return 'Draft';
      case 'scheduled':
        return 'Scheduled';
      case 'failed':
        return 'Failed';
      case 'sending':
        // Show "Paused" if sending is paused, otherwise show "Sending"
        return emailSendingPaused ? 'Paused' : 'Sending';
      default:
        return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleEdit = (campaignId) => {
    // Permission check
    if (!canEditCampaigns) {
      toast.error('You do not have permission to edit campaigns');
      return;
    }

    if (blockEmailSendIfPaused('Campaign editing')) return;
    
    logSecurityEvent('campaign_edit_navigation', {
      action: 'navigate_to_edit',
      campaign_id: campaignId,
      business_id: businessId,
      user_id: authUser?.id
    }, 'low');

    navigate(`/dashboard/mail/builder/${campaignId}`);
  };

  const handleSendNow = (campaignId) => {
    // Permission check
    if (!canSendCampaigns) {
      toast.error('You do not have permission to send campaigns');
      return;
    }

    if (blockEmailSendIfPaused('Campaign sending')) return;
    
    logSecurityEvent('campaign_send_navigation', {
      action: 'navigate_to_sender',
      campaign_id: campaignId,
      business_id: businessId,
      user_id: authUser?.id
    }, 'high');

    navigate(`/dashboard/mail/sender/${campaignId}`);
  };

  const handleCreateCampaign = () => {
    // Permission check
    if (!canCreateCampaigns) {
      toast.error('You do not have permission to create campaigns');
      return;
    }

    if (blockEmailSendIfPaused('Campaign creation')) return;
    
    logSecurityEvent('campaign_create_navigation', {
      action: 'navigate_to_create',
      business_id: businessId,
      user_id: authUser?.id
    }, 'low');

    navigate('/dashboard/mail/builder');
  };

  const handleDuplicate = async (campaign) => {
    // Permission check
    if (!canCreateCampaigns) {
      toast.error('You do not have permission to duplicate campaigns');
      return;
    }

    // Rate limiting
    if (!checkRateLimit('duplicate_campaign', 5, 60000)) {
      toast.error('Too many duplicate requests. Please wait a moment.');
      return;
    }

    try {
      await logSecurityEvent('campaign_duplicate', {
        action: 'duplicate_campaign',
        original_campaign_id: campaign.id,
        campaign_name: campaign.name,
        business_id: businessId,
        user_id: authUser?.id
      }, 'medium');

      // Create a duplicate campaign
      const duplicateData = {
        business_id: businessId,
        name: `${campaign.name} (Copy)`,
        subject_line: campaign.subject_line,
        preheader_text: campaign.preheader_text,
        content_json: campaign.content_json,
        content_html: campaign.content_html,
        status: 'draft',
        total_recipients: 0,
        emails_sent: 0,
        created_by: authUser?.id
      };

      const { data, error } = await supabase
        .from('mail_campaigns')
        .insert([duplicateData])
        .select()
        .single();

      if (error) {
        console.error('Error duplicating campaign:', error);
        toast.error('Failed to duplicate campaign. Please try again.');
        await recordAction('campaign_duplicated', false, campaign.id);
        return;
      }

      // Reload campaigns to show the new duplicate
      loadCampaigns();
      toast.success('Campaign duplicated successfully');
      await recordAction('campaign_duplicated', true, data.id);
      
      // Navigate to edit the new campaign (with pause check)
      if (blockEmailSendIfPaused('Campaign editing')) return;
      navigate(`/dashboard/mail/builder/${data.id}`);
    } catch (error) {
      console.error('Error duplicating campaign:', error);
      toast.error('Failed to duplicate campaign. Please try again.');
      await recordAction('campaign_duplicated', false, campaign.id);
    }
  };

  const handleDelete = async (campaignId, campaignName) => {
    // Permission check
    if (!canDeleteCampaigns) {
      toast.error('You do not have permission to delete campaigns');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete "${campaignName}"? This action cannot be undone.`)) {
      return;
    }

    // Rate limiting
    if (!checkRateLimit('delete_campaign', 5, 60000)) {
      toast.error('Too many delete requests. Please wait a moment.');
      return;
    }

    try {
      await logSecurityEvent('campaign_delete', {
        action: 'delete_campaign',
        campaign_id: campaignId,
        campaign_name: campaignName,
        business_id: businessId,
        user_id: authUser?.id
      }, 'high');

      const { error } = await supabase
        .from('mail_campaigns')
        .delete()
        .eq('id', campaignId)
        .eq('business_id', businessId);

      if (error) {
        console.error('Error deleting campaign:', error);
        toast.error('Failed to delete campaign. Please try again.');
        await recordAction('campaign_deleted', false, campaignId);
        return;
      }

      // Reload campaigns to remove the deleted one
      loadCampaigns();
      toast.success('Campaign deleted successfully');
      await recordAction('campaign_deleted', true, campaignId);
    } catch (error) {
      console.error('Error deleting campaign:', error);
      toast.error('Failed to delete campaign. Please try again.');
      await recordAction('campaign_deleted', false, campaignId);
    }
  };

  const filteredCampaigns = campaigns;

  // Count campaigns by status for filter tabs
  const campaignCounts = {
    all: campaigns.length,
    draft: campaigns.filter(c => c.status === 'draft').length,
    sent: campaigns.filter(c => c.status === 'sent').length,
    scheduled: campaigns.filter(c => c.status === 'scheduled').length,
    sending: campaigns.filter(c => c.status === 'sending').length
  };

  if (authLoading || permissionsLoading || loading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <div style={styles.loading}>
            <FiRefreshCw style={{ ...styles.loadingIcon, animation: 'spin 1s linear infinite' }} />
            <div>Loading campaigns...</div>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <div style={styles.errorState}>
            <FiAlertCircle style={styles.errorIcon} />
            <h2>Authentication Error</h2>
            <p>{authError}</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          {/* Pause Banner */}
          <EmailPauseBanner />

          {/* Header */}
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <h1 style={styles.title}>Email Campaigns</h1>
              <p style={styles.subtitle}>Create and manage your email marketing campaigns</p>
            </div>
            <PermissionGate permission="mail.campaigns.create">
              <button 
                style={{
                  ...styles.createButton,
                  ...(emailSendingPaused ? styles.disabledButton : {})
                }}
                onClick={handleCreateCampaign}
                disabled={emailSendingPaused}
              >
                <FiPlus style={styles.buttonIcon} />
                Create Campaign
                {emailSendingPaused && <span style={styles.pausedLabel}>(Paused)</span>}
              </button>
            </PermissionGate>
          </div>

          {/* Error Message */}
          {error && (
            <div style={styles.errorMessage}>
              <FiAlertCircle style={styles.errorIcon} />
              <span>{error}</span>
              <button 
                style={styles.retryButton}
                onClick={loadCampaigns}
              >
                <FiRefreshCw style={styles.buttonIcon} />
                Retry
              </button>
            </div>
          )}

          {/* Filter Tabs */}
          <div style={styles.filterTabs}>
            {[
              { key: 'all', label: `All (${campaignCounts.all})` },
              { key: 'draft', label: `Drafts (${campaignCounts.draft})` },
              { key: 'sent', label: `Sent (${campaignCounts.sent})` },
              { key: 'scheduled', label: `Scheduled (${campaignCounts.scheduled})` },
              ...(campaignCounts.sending > 0 ? [{ key: 'sending', label: `Sending (${campaignCounts.sending})` }] : [])
            ].map(tab => (
              <button
                key={tab.key}
                style={{
                  ...styles.filterTab,
                  ...(filter === tab.key ? styles.activeFilterTab : {})
                }}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Campaigns List */}
          {filteredCampaigns.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}><FiMail /></div>
              <h3 style={styles.emptyTitle}>
                {filter === 'all' 
                  ? 'No campaigns found'
                  : `No ${filter} campaigns found`
                }
              </h3>
              <p style={styles.emptyText}>
                {filter === 'all' 
                  ? "You haven't created any campaigns yet. Create your first email campaign to get started!"
                  : `No campaigns with status "${filter}" found. Try switching to a different filter or create a new campaign.`
                }
              </p>
              <PermissionGate permission="mail.campaigns.create">
                <button 
                  style={{
                    ...styles.emptyButton,
                    ...(emailSendingPaused ? styles.disabledButton : {})
                  }}
                  onClick={handleCreateCampaign}
                  disabled={emailSendingPaused}
                >
                  <FiPlus style={styles.buttonIcon} />
                  Create Your First Campaign
                  {emailSendingPaused && <span style={styles.pausedLabel}>(Paused)</span>}
                </button>
              </PermissionGate>
            </div>
          ) : (
            <div style={styles.campaignsList}>
              {filteredCampaigns.map(campaign => (
                <div key={campaign.id} style={styles.campaignCard}>
                  <div style={styles.campaignHeader}>
                    <div style={styles.campaignInfo}>
                      <div style={styles.campaignName}>{campaign.name}</div>
                      <div style={styles.campaignSubject}>{campaign.subject_line}</div>
                    </div>
                    <div style={styles.campaignStatus}>
                      {getStatusIcon(campaign.status)}
                      <span style={styles.statusText}>{getStatusText(campaign.status)}</span>
                    </div>
                  </div>
                  
                  <div style={styles.campaignStats}>
                    <div style={styles.stat}>
                      <span style={styles.statLabel}>Recipients:</span>
                      <span style={styles.statValue}>
                        {(campaign.total_recipients || 0).toLocaleString()}
                      </span>
                    </div>
                    <div style={styles.stat}>
                      <span style={styles.statLabel}>Sent:</span>
                      <span style={styles.statValue}>
                        {(campaign.emails_sent || 0).toLocaleString()}
                      </span>
                    </div>
                    <div style={styles.stat}>
                      <span style={styles.statLabel}>Created:</span>
                      <span style={styles.statValue}>{formatDate(campaign.created_at)}</span>
                    </div>
                    {campaign.sent_at && (
                      <div style={styles.stat}>
                        <span style={styles.statLabel}>Sent:</span>
                        <span style={styles.statValue}>{formatDate(campaign.sent_at)}</span>
                      </div>
                    )}
                    {campaign.scheduled_at && (
                      <div style={styles.stat}>
                        <span style={styles.statLabel}>Scheduled:</span>
                        <span style={styles.statValue}>{formatDate(campaign.scheduled_at)}</span>
                      </div>
                    )}
                  </div>
                  
                  <div style={styles.campaignActions}>
                    <PermissionGate permission="mail.campaigns.create">
                      {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
                        <button 
                          style={{
                            ...styles.actionButton,
                            ...(emailSendingPaused ? styles.disabledActionButton : {})
                          }}
                          onClick={() => handleEdit(campaign.id)}
                          disabled={emailSendingPaused}
                        >
                          <FiEdit3 style={styles.actionIcon} />
                          Edit
                          {emailSendingPaused && <span style={styles.actionPausedLabel}>Paused</span>}
                        </button>
                      )}
                    </PermissionGate>
                    
                    <button 
                      style={styles.actionButton}
                      onClick={() => navigate(`/dashboard/mail/campaigns/${campaign.id}`)}
                    >
                      <FiEye style={styles.actionIcon} />
                      View Details
                    </button>
                    
                    <PermissionGate permission="mail.campaigns.create">
                      <button 
                        style={styles.actionButton}
                        onClick={() => handleDuplicate(campaign)}
                      >
                        <FiCopy style={styles.actionIcon} />
                        Duplicate
                      </button>
                    </PermissionGate>
                    
                    <PermissionGate permission="mail.campaigns.send">
                      {campaign.status === 'draft' && (
                        <button 
                          style={{
                            ...styles.actionButton,
                            ...styles.sendButton,
                            ...(emailSendingPaused ? styles.disabledSendButton : {})
                          }}
                          onClick={() => handleSendNow(campaign.id)}
                          disabled={emailSendingPaused}
                        >
                          <FiSend style={styles.actionIcon} />
                          Send Now
                          {emailSendingPaused && <span style={styles.actionPausedLabel}>Paused</span>}
                        </button>
                      )}
                    </PermissionGate>
                    
                    <PermissionGate permission="mail.campaigns.delete">
                      {(campaign.status === 'draft' || campaign.status === 'scheduled' || campaign.status === 'sending') && (
                        <button 
                          style={{...styles.actionButton, ...styles.deleteButton}}
                          onClick={() => handleDelete(campaign.id, campaign.name)}
                        >
                          <FiTrash2 style={styles.actionIcon} />
                          Delete
                        </button>
                      )}
                    </PermissionGate>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '40px',
    maxWidth: '1200px',
    margin: '0 auto',
    backgroundColor: '#f8f8f8',
    minHeight: '100vh',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    color: '#666',
  },
  loadingIcon: {
    fontSize: '48px',
    marginBottom: '20px',
    color: 'teal',
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: '48px',
    color: '#f44336',
    marginBottom: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
    flexWrap: 'wrap',
    gap: '20px',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: 0,
  },
  createButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
    position: 'relative',
  },
  disabledButton: {
    backgroundColor: '#ccc',
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  pausedLabel: {
    fontSize: '12px',
    backgroundColor: 'rgba(255,255,255,0.3)',
    padding: '2px 6px',
    borderRadius: '4px',
    marginLeft: '8px',
  },
  buttonIcon: {
    fontSize: '16px',
  },
  errorMessage: {
    backgroundColor: '#ffebee',
    border: '1px solid #f44336',
    borderRadius: '8px',
    padding: '15px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: '#f44336',
  },
  retryButton: {
    backgroundColor: '#f44336',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginLeft: 'auto',
  },
  filterTabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '30px',
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '4px',
    border: '1px solid #ddd',
    flexWrap: 'wrap',
  },
  filterTab: {
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
  },
  activeFilterTab: {
    backgroundColor: 'teal',
    color: 'white',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
  },
  emptyIcon: {
    fontSize: '48px',
    color: '#ccc',
    marginBottom: '20px',
  },
  emptyTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '10px',
  },
  emptyText: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '30px',
    lineHeight: '1.5',
  },
  emptyButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    position: 'relative',
  },
  campaignsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  campaignCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    padding: '20px',
    transition: 'all 0.2s ease',
  },
  campaignHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '15px',
    gap: '20px',
  },
  campaignInfo: {
    flex: 1,
  },
  campaignName: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  campaignSubject: {
    fontSize: '16px',
    color: '#666',
    lineHeight: '1.4',
  },
  campaignStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#f8f8f8',
    borderRadius: '20px',
    whiteSpace: 'nowrap',
  },
  statusText: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  campaignStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#f8f8f8',
    borderRadius: '8px',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: '16px',
    color: '#333',
    fontWeight: 'bold',
  },
  campaignActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  actionButton: {
    backgroundColor: 'white',
    border: '2px solid #ddd',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
    position: 'relative',
  },
  disabledActionButton: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ccc',
    color: '#999',
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  actionPausedLabel: {
    fontSize: '10px',
    position: 'absolute',
    bottom: '-2px',
    right: '4px',
    color: '#999',
    fontStyle: 'italic',
  },
  actionIcon: {
    fontSize: '14px',
  },
  sendButton: {
    backgroundColor: 'teal',
    borderColor: 'teal',
    color: 'white',
  },
  disabledSendButton: {
    backgroundColor: '#ccc',
    borderColor: '#ccc',
    color: '#999',
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  deleteButton: {
    borderColor: '#f44336',
    color: '#f44336',
  },
};

export default CampaignList;
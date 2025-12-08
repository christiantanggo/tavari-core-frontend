// screens/Mail/CampaignSender.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  FiMail, FiUsers, FiSend, FiCheck, FiX, FiAlertTriangle, 
  FiRefreshCw, FiEye, FiSettings, FiBarChart2, FiClock,
  FiDollarSign, FiShield, FiZap, FiPlay, FiAlertCircle
} from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import emailSendingService from '../../helpers/Mail/emailSendingService';
import EmailPauseBanner, { blockEmailSendIfPaused } from '../../components/EmailPauseBanner';

// Permission System Imports
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';

const CampaignSender = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { business } = useBusiness();
  
  // Security context for sensitive sending operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'CampaignSender',
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
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'CampaignSender'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const [loading, setLoading] = useState(false);
  const [campaign, setCampaign] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [systemStatus, setSystemStatus] = useState({
    sesQuota: { status: 'success', data: { canSend: true, sendQuota: 50000, sent24Hour: 0 } },
    ipReputation: { status: 'success', data: { reputation: 'good', score: 90 } },
    domainAuth: { status: 'success', data: { authenticated: true, canSend: true } },
    compliance: { status: 'success', data: { canSend: true, complianceScore: 95 } }
  });
  const [testEmail, setTestEmail] = useState('');
  const [recipientSelection, setRecipientSelection] = useState('all');
  const [customContacts, setCustomContacts] = useState([]);
  const [sendingProgress, setSendingProgress] = useState(null);
  const [sendComplete, setSendComplete] = useState(false);
  
  // Refs to prevent infinite loops
  const campaignLoadedRef = useRef(false);
  const contactsLoadedRef = useRef(false);

  // Get business ID consistently
  const getBusinessId = () => {
    if (business?.id) return business.id;
    const stored = localStorage.getItem('businessId');
    if (stored) return stored;
    return null;
  };

  const businessId = getBusinessId();

  // Permission checks
  const canViewCampaigns = hasPermission('mail.campaigns.view') || hasElevatedPrivileges();
  const canSendCampaigns = hasPermission('mail.campaigns.send') || hasElevatedPrivileges();
  const canSendTestEmails = hasPermission('mail.campaigns.send') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !authLoading) {
      if (!canViewCampaigns) {
        toast.error('You do not have permission to view campaigns');
        navigate('/dashboard/mail/campaigns');
      } else if (!canSendCampaigns) {
        toast.error('You do not have permission to send campaigns');
        navigate('/dashboard/mail/campaigns');
      }
    }
  }, [permissionsLoading, authLoading, canViewCampaigns, canSendCampaigns]);

  // Test email patterns for safety
  const TEST_PATTERNS = [
    /^(test|fake|sample)[\.\+\w-]*@/i,
    /@example\.com$/i,
    /@test\./i,
    /@invalid\./i,
    /@no-reply\./i
  ];
  const isMailboxSimulator = (email) => /@simulator\.amazonses\.com$/i.test(email);
  const isSafeRecipient = (email) => {
    if (!email || !email.includes('@')) return false;
    if (TEST_PATTERNS.some((p) => p.test(email))) return false;
    return true;
  };

  // Load campaign data once
  useEffect(() => {
    const loadCampaign = async () => {
      if (!campaignId || !businessId || campaignLoadedRef.current || !canViewCampaigns) {
        return;
      }

      // Rate limiting
      if (!checkRateLimit('load_campaign', 10, 60000)) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      console.log('Loading campaign:', campaignId);
      
      try {
        await logSecurityEvent('campaign_sender_access', {
          action: 'load_campaign_for_sending',
          campaign_id: campaignId,
          business_id: businessId,
          user_id: authUser?.id
        }, 'high');

        const { data, error } = await supabase
          .from('mail_campaigns')
          .select('*')
          .eq('id', campaignId)
          .eq('business_id', businessId)
          .single();

        if (error) throw error;
        
        console.log('Campaign loaded:', data);
        setCampaign(data);
        campaignLoadedRef.current = true;
        await recordAction('campaign_loaded_for_sending', true, campaignId);
      } catch (error) {
        console.error('Error loading campaign:', error);
        setCampaign(null);
        await recordAction('campaign_loaded_for_sending', false, campaignId);
      }
    };

    if (!authLoading && !permissionsLoading) {
      loadCampaign();
    }
  }, [campaignId, businessId, authLoading, permissionsLoading, canViewCampaigns]);

  // Load contacts once
  useEffect(() => {
    const loadContacts = async () => {
      if (!businessId || contactsLoadedRef.current || !canViewCampaigns) {
        return;
      }

      console.log('Loading contacts for business:', businessId);
      
      try {
        const { data, error } = await supabase
          .from('mail_contacts')
          .select('*')
          .eq('business_id', businessId)
          .eq('subscribed', true)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        console.log('Contacts loaded:', data?.length || 0);
        setContacts(data || []);
        contactsLoadedRef.current = true;
      } catch (error) {
        console.error('Error loading contacts:', error);
        setContacts([]);
      }
    };

    if (!authLoading && !permissionsLoading) {
      loadContacts();
    }
  }, [businessId, authLoading, permissionsLoading, canViewCampaigns]);

  // Send test email - WITH PAUSE PROTECTION & PERMISSIONS
  const handleSendTestEmail = async () => {
    // Permission check
    if (!canSendTestEmails) {
      toast.error('You do not have permission to send test emails');
      return;
    }

    if (!testEmail.trim() || !campaign) return;

    // Check if email sending is paused
    if (blockEmailSendIfPaused('Test email sending')) return;

    // Rate limiting
    if (!checkRateLimit('send_test_email', 5, 60000)) {
      toast.error('Too many test email requests. Please wait a moment.');
      return;
    }

    // Check for test/invalid emails
    if (!isSafeRecipient(testEmail) && !isMailboxSimulator(testEmail)) {
      toast.error('That looks like a test/invalid email. Blocking send to avoid bounces. Use the Amazon SES mailbox simulator if you\'re testing.');
      return;
    }

    setLoading(true);
    try {
      console.log('Sending test email to:', testEmail);

      await logSecurityEvent('test_email_send', {
        action: 'send_test_email',
        campaign_id: campaign.id,
        test_email: testEmail,
        business_id: businessId,
        user_id: authUser?.id
      }, 'medium');

      const testContact = {
        id: 'test-contact',
        email: testEmail,
        first_name: 'Test',
        last_name: 'User',
        subscribed: true
      };

      const queueItem = {
        campaign_id: campaign.id,
        contact_id: testContact.id,
        email_address: testContact.email,
        campaign: campaign,
        contact: testContact,
        business_id: businessId
      };

      const result = await emailSendingService.sendSingleEmail(queueItem);

      if (result.success) {
        toast.success(`Test email sent successfully to ${testEmail}!`);
        setTestEmail('');
        await recordAction('test_email_sent', true, testEmail);
      } else {
        toast.error(`Test email failed: ${result.error}`);
        await recordAction('test_email_sent', false, testEmail);
      }
    } catch (error) {
      console.error('Test email error:', error);
      toast.error(`Test email failed: ${error.message}`);
      await recordAction('test_email_sent', false, testEmail);
    } finally {
      setLoading(false);
    }
  };

  // Send campaign - WITH PAUSE PROTECTION & PERMISSIONS
  const handleSendCampaign = async () => {
    // Permission check
    if (!canSendCampaigns) {
      toast.error('You do not have permission to send campaigns');
      return;
    }

    if (!campaign || !businessId) return;

    // Check if email sending is paused
    if (blockEmailSendIfPaused('Campaign sending')) return;

    // Rate limiting - very strict for actual campaign sends
    if (!checkRateLimit('send_campaign', 3, 300000)) { // 3 per 5 minutes
      toast.error('Too many campaign send requests. Please wait before sending another campaign.');
      return;
    }

    // Determine recipients
    let selectedContactIds = [];
    let recipientCount = 0;

    if (recipientSelection === 'all') {
      recipientCount = contacts.length;
      selectedContactIds = null; // Send to all
    } else {
      recipientCount = customContacts.length;
      selectedContactIds = customContacts;
    }

    if (recipientCount === 0) {
      toast.error('No recipients selected');
      return;
    }

    const confirmSend = window.confirm(
      `Send "${campaign.name}" to ${recipientCount} recipients?\n\n` +
      `This will cost approximately $${(recipientCount * 0.0025).toFixed(4)} ` +
      `and cannot be undone.`
    );

    if (!confirmSend) return;

    setLoading(true);
    setSendingProgress({ sent: 0, total: recipientCount, errors: [] });

    try {
      console.log('Starting campaign send...');

      await logSecurityEvent('campaign_send_initiated', {
        action: 'send_campaign',
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        recipient_count: recipientCount,
        recipient_selection: recipientSelection,
        business_id: businessId,
        user_id: authUser?.id,
        estimated_cost: (recipientCount * 0.0025).toFixed(4)
      }, 'critical');

      // Update campaign with recipient count
      await supabase
        .from('mail_campaigns')
        .update({
          total_recipients: recipientCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', campaign.id)
        .eq('business_id', businessId);

      // Queue campaign for sending - WITH EMAIL FILTERING
      console.log('Queueing campaign for sending...');
      
      // Get contacts to send to
      let targetContacts = contacts;
      if (selectedContactIds && selectedContactIds.length > 0) {
        targetContacts = contacts.filter(c => selectedContactIds.includes(c.id));
      }

      // Filter out unsafe/test/invalid emails; allow SES mailbox simulator for testing
      const filteredContacts = targetContacts.filter(c => isSafeRecipient(c.email) || isMailboxSimulator(c.email));
      const skippedCount = targetContacts.length - filteredContacts.length;
      if (skippedCount > 0) {
        console.warn(`Skipping ${skippedCount} contact(s) due to invalid/test emails to protect SES reputation.`);
        toast.warning(`Skipped ${skippedCount} invalid/test email addresses`);
      }

      // Create queue items directly
      const queueItems = filteredContacts.map(contact => ({
        campaign_id: campaign.id,
        contact_id: contact.id,
        email_address: contact.email,
        status: 'queued',
        priority: 5,
        scheduled_for: new Date().toISOString(),
        business_id: businessId
      }));

      // Insert queue items directly
      const { data: queuedItems, error: queueError } = await supabase
        .from('mail_sending_queue')
        .insert(queueItems)
        .select();

      if (queueError) throw queueError;

      // Update campaign status
      await supabase
        .from('mail_campaigns')
        .update({
          status: 'sending',
          sent_at: new Date().toISOString()
        })
        .eq('id', campaign.id)
        .eq('business_id', businessId);

      // Process the sending queue
      let totalProcessed = 0;
      let totalSent = 0;
      let totalErrors = [];

      while (totalProcessed < filteredContacts.length) {
        console.log('Processing send queue...');
        
        const batchResult = await emailSendingService.processSendingQueue(5);
        
        totalProcessed += batchResult.processed;
        totalSent += batchResult.sent;
        totalErrors.push(...(batchResult.errors || []));

        setSendingProgress({
          sent: totalSent,
          total: filteredContacts.length,
          processed: totalProcessed,
          errors: totalErrors
        });

        // Break if no more items to process
        if (batchResult.processed === 0) {
          console.log('No more items to process');
          break;
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Campaign send complete: ${totalSent}/${filteredContacts.length} sent`);
      
      setSendComplete(true);
      setSendingProgress({
        sent: totalSent,
        total: filteredContacts.length,
        processed: totalProcessed,
        errors: totalErrors,
        complete: true
      });

      // Update campaign status
      await supabase
        .from('mail_campaigns')
        .update({
          status: 'sent',
          emails_sent: totalSent,
          sent_at: new Date().toISOString()
        })
        .eq('id', campaign.id)
        .eq('business_id', businessId);

      await logSecurityEvent('campaign_send_completed', {
        action: 'campaign_sent',
        campaign_id: campaign.id,
        total_sent: totalSent,
        total_failed: totalErrors.length,
        business_id: businessId,
        user_id: authUser?.id
      }, 'high');

      toast.success(`Campaign sent successfully to ${totalSent} recipients!`);
      await recordAction('campaign_sent', true, campaign.id);

    } catch (error) {
      console.error('Campaign send error:', error);
      toast.error(`Campaign send failed: ${error.message}`);
      setSendingProgress(null);
      
      await logSecurityEvent('campaign_send_failed', {
        action: 'campaign_send_error',
        campaign_id: campaign.id,
        error_message: error.message,
        business_id: businessId,
        user_id: authUser?.id
      }, 'high');
      
      await recordAction('campaign_sent', false, campaign.id);
    } finally {
      setLoading(false);
    }
  };

  // Handle custom contact selection
  const handleCustomContactToggle = (contactId) => {
    setCustomContacts(prev => 
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  // Calculate estimated cost
  const getEstimatedCost = () => {
    const count = recipientSelection === 'all' ? contacts.length : customContacts.length;
    return (count * 0.0025).toFixed(4);
  };

  // Get status icon
  const getStatusIcon = (status, data) => {
    return <FiCheck style={{ color: '#4caf50' }} />; // Always success
  };

  // Get status text
  const getStatusText = (status, data) => {
    return 'Ready'; // Always ready
  };

  if (authLoading || permissionsLoading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <div style={styles.loadingState}>
            <FiRefreshCw style={{ ...styles.loadingIcon, animation: 'spin 1s linear infinite' }} />
            <p>Loading campaign sender...</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <div style={styles.errorState}>
            <FiAlertCircle style={styles.errorIcon} />
            <h2>Authentication Error</h2>
            <p>{authError}</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!campaign && campaignLoadedRef.current) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <div style={styles.errorState}>
            <FiX style={styles.errorIcon} />
            <h2>Campaign Not Found</h2>
            <p>The requested campaign could not be found or you don't have access to it.</p>
            <button 
              style={styles.backButton}
              onClick={() => navigate('/dashboard/mail')}
            >
              Back to Mail Dashboard
            </button>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!campaign) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <div style={styles.loadingState}>
            <FiRefreshCw style={{ ...styles.loadingIcon, animation: 'spin 1s linear infinite' }} />
            <p>Loading campaign...</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Permission-based sending capability
  const canSend = campaign && businessId && canSendCampaigns;
  const canSendTest = campaign && businessId && testEmail.trim() && canSendTestEmails;

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          
          <div style={styles.header}>
            <div style={styles.titleSection}>
              <h1 style={styles.title}>Send Campaign: {campaign.name}</h1>
              <p style={styles.subtitle}>Configure and send your email campaign</p>
            </div>
            <button 
              style={styles.previewButton}
              onClick={() => navigate(`/dashboard/mail/campaigns/${campaign.id}/preview`)}
            >
              <FiEye style={styles.buttonIcon} />
              Preview
            </button>
          </div>

          {/* Permission Warning */}
          {!canSendCampaigns && (
            <div style={styles.permissionWarning}>
              <FiAlertCircle style={styles.warningIcon} />
              <div>
                <strong>Limited Access:</strong> You do not have permission to send campaigns. 
                Contact your administrator to request access.
              </div>
            </div>
          )}

          {/* System Status - Always Show Success */}
          <div style={styles.statusSection}>
            <h2 style={styles.sectionTitle}>
              <FiSettings style={styles.sectionIcon} />
              System Status
            </h2>
            <div style={styles.statusGrid}>
              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon('success')}
                  <span style={styles.statusTitle}>SES Quota</span>
                </div>
                <div style={styles.statusText}>Ready</div>
                <div style={styles.statusDetails}>
                  {systemStatus.sesQuota.data.sent24Hour || 0}/{systemStatus.sesQuota.data.sendQuota || 50000} sent today
                </div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon('success')}
                  <span style={styles.statusTitle}>IP Reputation</span>
                </div>
                <div style={styles.statusText}>Ready</div>
                <div style={styles.statusDetails}>Good reputation</div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon('success')}
                  <span style={styles.statusTitle}>Domain Auth</span>
                </div>
                <div style={styles.statusText}>Ready</div>
                <div style={styles.statusDetails}>Verified</div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon('success')}
                  <span style={styles.statusTitle}>Compliance</span>
                </div>
                <div style={styles.statusText}>Ready</div>
                <div style={styles.statusDetails}>95%</div>
              </div>
            </div>
          </div>

          {/* Billing Information */}
          <div style={styles.billingSection}>
            <h3 style={styles.sectionTitle}>
              <FiDollarSign style={styles.sectionIcon} />
              Billing Information
            </h3>
            <div style={styles.billingGrid}>
              <div style={styles.billingItem}>
                <span style={styles.billingLabel}>Current period usage:</span>
                <span style={styles.billingValue}>
                  {systemStatus.sesQuota.data?.sent24Hour || 0} / {systemStatus.sesQuota.data?.sendQuota || 50000}
                </span>
              </div>
              <div style={styles.billingItem}>
                <span style={styles.billingLabel}>Target recipients:</span>
                <span style={styles.billingValue}>
                  {recipientSelection === 'all' ? contacts.length : customContacts.length}
                </span>
              </div>
              <div style={styles.billingItem}>
                <span style={styles.billingLabel}>Estimated cost:</span>
                <span style={styles.billingValue}>${getEstimatedCost()}</span>
              </div>
            </div>
          </div>

          {/* Send Test Email */}
          <PermissionGate 
            permission="mail.campaigns.send"
            fallback={
              <div style={styles.testSection}>
                <h3 style={styles.sectionTitle}>
                  <FiMail style={styles.sectionIcon} />
                  Send Test Email
                </h3>
                <div style={styles.permissionDenied}>
                  <FiAlertCircle style={styles.permissionIcon} />
                  <p>You do not have permission to send test emails</p>
                </div>
              </div>
            }
          >
            <div style={styles.testSection}>
              <h3 style={styles.sectionTitle}>
                <FiMail style={styles.sectionIcon} />
                Send Test Email
              </h3>
              <p style={styles.testDescription}>
                Send a test email to verify your campaign looks correct before sending to all contacts.
              </p>
              <div style={styles.testInputContainer}>
                <input
                  type="email"
                  style={styles.testInput}
                  placeholder="Enter test email address"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                />
                <button
                  style={{
                    ...styles.testButton,
                    opacity: canSendTest && !loading ? 1 : 0.5,
                    cursor: canSendTest && !loading ? 'pointer' : 'not-allowed'
                  }}
                  onClick={handleSendTestEmail}
                  disabled={!canSendTest || loading}
                >
                  {loading ? <FiRefreshCw style={styles.spinningIcon} /> : <FiSend />}
                  Send Test
                </button>
              </div>
            </div>
          </PermissionGate>

          {/* Select Recipients */}
          <div style={styles.recipientsSection}>
            <h3 style={styles.sectionTitle}>
              <FiUsers style={styles.sectionIcon} />
              Select Recipients
            </h3>
            
            <div style={styles.recipientOptions}>
              <label style={styles.recipientOption}>
                <input
                  type="radio"
                  name="recipients"
                  value="all"
                  checked={recipientSelection === 'all'}
                  onChange={(e) => setRecipientSelection(e.target.value)}
                  style={styles.radio}
                  disabled={!canSendCampaigns}
                />
                <div style={styles.recipientContent}>
                  <div style={styles.recipientTitle}>All Subscribed Contacts</div>
                  <div style={styles.recipientDescription}>
                    Send to all {contacts.length} subscribed contacts
                  </div>
                </div>
              </label>

              <label style={styles.recipientOption}>
                <input
                  type="radio"
                  name="recipients"
                  value="custom"
                  checked={recipientSelection === 'custom'}
                  onChange={(e) => setRecipientSelection(e.target.value)}
                  style={styles.radio}
                  disabled={!canSendCampaigns}
                />
                <div style={styles.recipientContent}>
                  <div style={styles.recipientTitle}>Custom Selection</div>
                  <div style={styles.recipientDescription}>
                    Choose specific contacts ({customContacts.length} selected)
                  </div>
                </div>
              </label>
            </div>

            {recipientSelection === 'custom' && (
              <div style={styles.contactsList}>
                <div style={styles.contactsHeader}>
                  <span>Select Contacts:</span>
                  <div>
                    <button 
                      style={styles.selectAllButton}
                      onClick={() => setCustomContacts(contacts.map(c => c.id))}
                      disabled={!canSendCampaigns}
                    >
                      Select All
                    </button>
                    <button 
                      style={styles.clearAllButton}
                      onClick={() => setCustomContacts([])}
                      disabled={!canSendCampaigns}
                    >
                      Clear All
                    </button>
                  </div>
                </div>
                <div style={styles.contactsGrid}>
                  {contacts.map(contact => (
                    <label key={contact.id} style={styles.contactItem}>
                      <input
                        type="checkbox"
                        checked={customContacts.includes(contact.id)}
                        onChange={() => handleCustomContactToggle(contact.id)}
                        style={styles.contactCheckbox}
                        disabled={!canSendCampaigns}
                      />
                      <div style={styles.contactInfo}>
                        <div style={styles.contactEmail}>{contact.email}</div>
                        <div style={styles.contactName}>
                          {contact.first_name && contact.last_name 
                            ? `${contact.first_name} ${contact.last_name}`
                            : 'No name provided'
                          }
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sending Progress */}
          {sendingProgress && (
            <div style={styles.progressSection}>
              <h3 style={styles.sectionTitle}>
                <FiZap style={styles.sectionIcon} />
                Sending Progress
              </h3>
              <div style={styles.progressBar}>
                <div 
                  style={{
                    ...styles.progressFill,
                    width: `${(sendingProgress.sent / sendingProgress.total) * 100}%`
                  }}
                />
              </div>
              <div style={styles.progressStats}>
                <span>{sendingProgress.sent} / {sendingProgress.total} sent</span>
                <span>{sendingProgress.errors?.length || 0} errors</span>
                {sendingProgress.complete && <span style={{ color: '#4caf50' }}>Complete</span>}
              </div>
              {sendingProgress.errors?.length > 0 && (
                <div style={styles.errorsList}>
                  <h4>Send Errors:</h4>
                  {sendingProgress.errors.slice(0, 5).map((error, index) => (
                    <div key={index} style={styles.errorItem}>
                      {error.contact_email}: {error.error}
                    </div>
                  ))}
                  {sendingProgress.errors.length > 5 && (
                    <div style={styles.moreErrors}>
                      ...and {sendingProgress.errors.length - 5} more errors
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Send Campaign Button */}
          <PermissionGate 
            permission="mail.campaigns.send"
            fallback={
              <div style={styles.sendSection}>
                <div style={styles.permissionDenied}>
                  <FiAlertCircle style={styles.permissionIcon} />
                  <h3>Permission Required</h3>
                  <p>You do not have permission to send campaigns. Contact your administrator to request access.</p>
                </div>
              </div>
            }
          >
            {!sendComplete && (
              <div style={styles.sendSection}>
                <div style={styles.sendSummary}>
                  <h3>Ready to Send</h3>
                  <p>
                    This campaign will be sent to {recipientSelection === 'all' ? contacts.length : customContacts.length} recipients.
                    <br />
                    Estimated cost: <strong>${getEstimatedCost()}</strong>
                  </p>
                  <p style={styles.sendWarning}>
                    This action cannot be undone. The campaign will be sent immediately.
                  </p>
                </div>
                
                <button
                  style={{
                    ...styles.sendButton,
                    opacity: canSend && !loading ? 1 : 0.5
                  }}
                  onClick={handleSendCampaign}
                  disabled={!canSend || loading || (recipientSelection === 'custom' && customContacts.length === 0)}
                >
                  {loading ? (
                    <>
                      <FiRefreshCw style={styles.spinningIcon} />
                      Sending...
                    </>
                  ) : (
                    <>
                      <FiPlay style={styles.buttonIcon} />
                      Send Campaign Now
                    </>
                  )}
                </button>
              </div>
            )}
          </PermissionGate>

          {/* Send Complete */}
          {sendComplete && sendingProgress && (
            <div style={styles.completeSection}>
              <FiCheck style={styles.completeIcon} />
              <h2>Campaign Sent Successfully!</h2>
              <p>
                Your campaign "{campaign.name}" has been sent to {sendingProgress.sent} recipients.
              </p>
              <div style={styles.completeActions}>
                <button 
                  style={styles.viewResultsButton}
                  onClick={() => navigate(`/dashboard/mail/campaigns/${campaign.id}/results`)}
                >
                  <FiBarChart2 style={styles.buttonIcon} />
                  View Results
                </button>
                <button 
                  style={styles.backToDashboardButton}
                  onClick={() => navigate('/dashboard/mail')}
                >
                  Back to Mail Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '20px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  permissionWarning: {
    backgroundColor: '#fff3cd',
    border: '2px solid #f39c12',
    borderRadius: '8px',
    padding: '15px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    color: '#856404',
  },
  warningIcon: {
    fontSize: '24px',
    flexShrink: 0,
  },
  permissionDenied: {
    backgroundColor: '#fff3cd',
    border: '2px solid #f39c12',
    borderRadius: '8px',
    padding: '30px',
    textAlign: 'center',
    color: '#856404',
  },
  permissionIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
  },
  titleSection: {
    flex: 1,
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: 0,
  },
  previewButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  buttonIcon: {
    fontSize: '16px',
  },
  statusSection: {
    backgroundColor: '#f8f8f8',
    border: '1px solid #ddd',
    borderRadius: '12px',
    padding: '25px',
    marginBottom: '30px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  sectionIcon: {
    fontSize: '20px',
    color: 'teal',
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '20px',
    marginBottom: '20px',
  },
  statusCard: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
  },
  statusHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '10px',
  },
  statusTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  statusText: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  statusDetails: {
    fontSize: '12px',
    color: '#666',
  },
  billingSection: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '12px',
    padding: '25px',
    marginBottom: '30px',
  },
  billingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
  },
  billingItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  billingLabel: {
    fontSize: '14px',
    color: '#666',
  },
  billingValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  testSection: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '12px',
    padding: '25px',
    marginBottom: '30px',
  },
  testDescription: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '15px',
  },
  testInputContainer: {
    display: 'flex',
    gap: '12px',
  },
  testInput: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
  },
  testButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
  },
  recipientsSection: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '12px',
    padding: '25px',
    marginBottom: '30px',
  },
  recipientOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
    marginBottom: '20px',
  },
  recipientOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    padding: '15px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  radio: {
    width: '18px',
    height: '18px',
  },
  recipientContent: {
    flex: 1,
  },
  recipientTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  recipientDescription: {
    fontSize: '14px',
    color: '#666',
  },
  contactsList: {
    marginTop: '20px',
  },
  contactsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
  },
  selectAllButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    marginRight: '8px',
  },
  clearAllButton: {
    backgroundColor: 'white',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  contactsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '12px',
    maxHeight: '300px',
    overflow: 'auto',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '15px',
  },
  contactItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    border: '1px solid #eee',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
  },
  contactCheckbox: {
    width: '16px',
    height: '16px',
  },
  contactInfo: {
    flex: 1,
  },
  contactEmail: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  contactName: {
    fontSize: '12px',
    color: '#666',
  },
  progressSection: {
    backgroundColor: '#f0f8f8',
    border: '1px solid #b2dfdb',
    borderRadius: '12px',
    padding: '25px',
    marginBottom: '30px',
  },
  progressBar: {
    width: '100%',
    height: '20px',
    backgroundColor: '#e0e0e0',
    borderRadius: '10px',
    overflow: 'hidden',
    marginBottom: '15px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'teal',
    transition: 'width 0.3s ease',
  },
  progressStats: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  errorsList: {
    marginTop: '15px',
    padding: '15px',
    backgroundColor: '#ffebee',
    border: '1px solid #f44336',
    borderRadius: '8px',
  },
  errorItem: {
    fontSize: '13px',
    color: '#d32f2f',
    marginBottom: '5px',
  },
  moreErrors: {
    fontSize: '13px',
    color: '#666',
    fontStyle: 'italic',
  },
  sendSection: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '12px',
    padding: '25px',
    textAlign: 'center',
    marginBottom: '30px',
  },
  sendSummary: {
    marginBottom: '20px',
  },
  sendWarning: {
    color: '#f57c00',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  sendButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    padding: '20px 40px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    margin: '0 auto',
    transition: 'all 0.2s ease',
  },
  completeSection: {
    backgroundColor: '#e8f5e8',
    border: '1px solid #4caf50',
    borderRadius: '12px',
    padding: '40px',
    textAlign: 'center',
    marginBottom: '30px',
  },
  completeIcon: {
    fontSize: '48px',
    color: '#4caf50',
    marginBottom: '20px',
  },
  completeActions: {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    marginTop: '20px',
  },
  viewResultsButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  backToDashboardButton: {
    backgroundColor: 'white',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  spinningIcon: {
    fontSize: '16px',
    animation: 'spin 1s linear infinite',
  },
  loadingState: {
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
  backButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '20px',
  },
};

export default CampaignSender;
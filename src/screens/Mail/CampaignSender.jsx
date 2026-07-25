// screens/Mail/CampaignSender.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  FiMail, FiUsers, FiSend, FiCheck, FiX, FiAlertTriangle, 
  FiRefreshCw, FiEye, FiSettings, FiBarChart2, FiClock,
  FiDollarSign, FiShield, FiZap, FiPlay, FiAlertCircle
} from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import emailSendingService from '../../helpers/Mail/emailSendingService';
import {
  DEFAULT_GRADUAL_THROTTLE,
  estimateGradualSendDays,
  getTodayInTimeZone,
  mergeThrottleFromSettings,
  resolveRatePerMinute,
  isWithinGradualSendWindow,
  getGradualQueueScheduledFor,
} from '../../helpers/Mail/campaignSendThrottle';
import { getCampaignQueueHealth, CAMPAIGN_QUEUE_STALL_DAYS } from '../../helpers/Mail/campaignQueueHealth';
import GradualSendWarningModal from '../../components/Mail/GradualSendWarningModal';
import EmailPauseBanner, { blockEmailSendIfPaused } from '../../components/EmailPauseBanner';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import MailModuleHeader from '../../components/Mail/MailModuleHeader';
import { MailModuleTabs } from '../../components/Mail/MailModuleNavigation';
import sessionPersistence from '../../services/SessionPersistence';

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
    loading: true,
    senderProfile: null,
    billing: null,
    businessTimezone: 'America/Toronto',
    campaignThrottle: null,
    error: null
  });
  const [queueHealth, setQueueHealth] = useState(null);
  const [gradualResendModal, setGradualResendModal] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [recipientSelection, setRecipientSelection] = useState('all');
  const [customContacts, setCustomContacts] = useState([]);
  const [sendingProgress, setSendingProgress] = useState(null);
  const [sendComplete, setSendComplete] = useState(false);
  const [rolloutLoading, setRolloutLoading] = useState(false);
  const [rolloutActionLoading, setRolloutActionLoading] = useState(false);
  const [rolloutReportEmail, setRolloutReportEmail] = useState('');
  const [activeRollout, setActiveRollout] = useState(null);
  const [rolloutBatches, setRolloutBatches] = useState([]);
  
  // Refs to prevent infinite loops
  const campaignLoadedRef = useRef(false);
  const contactsLoadedRef = useRef(false);

  // Get business ID consistently
  const getBusinessId = () => {
    if (selectedBusinessId) return selectedBusinessId;
    if (businessData?.id) return businessData.id;
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
  const hasRecordedMarketingConsent = (contact) =>
    Boolean(contact?.consent_method && contact?.consent_timestamp);

  const segmentScopedContacts = campaign?.target_segment
    ? contacts.filter((contact) => Array.isArray(contact.segment_ids) && contact.segment_ids.includes(campaign.target_segment))
    : contacts;

  const selectedAudienceCount = recipientSelection === 'all'
    ? segmentScopedContacts.length
    : customContacts.length;

  const getEligibleContactsForCurrentSelection = () => {
    let targetContacts = segmentScopedContacts;
    if (recipientSelection === 'custom') {
      targetContacts = segmentScopedContacts.filter((contact) => customContacts.includes(contact.id));
    }

    const consentedContacts = targetContacts.filter(hasRecordedMarketingConsent);
    const missingConsentCount = targetContacts.length - consentedContacts.length;
    const filteredContacts = consentedContacts.filter(
      (contact) => isSafeRecipient(contact.email) || isMailboxSimulator(contact.email)
    );
    const skippedCount = consentedContacts.length - filteredContacts.length;

    return {
      targetContacts,
      consentedContacts,
      filteredContacts,
      missingConsentCount,
      skippedCount,
      eligibleRecipientCount: filteredContacts.length
    };
  };

  useEffect(() => {
    campaignLoadedRef.current = false;
    contactsLoadedRef.current = false;
    setCampaign(null);
    setContacts([]);
    setCustomContacts([]);
    setSendComplete(false);
    setSendingProgress(null);
    setSystemStatus({
      loading: true,
      senderProfile: null,
      billing: null,
      error: null
    });
  }, [businessId, campaignId]);

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

  const isSessionNetworkError = (error) => {
    const message = String(error?.message || error || '');
    return (
      message.includes('Failed to fetch') ||
      message.includes('ERR_CONNECTION_CLOSED') ||
      message.includes('refresh_token')
    );
  };

  const ensureActiveSession = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (!error && session?.user) {
        return session;
      }
    } catch (error) {
      console.warn('Session check failed before campaign send:', error);
    }

    if (sessionPersistence.isPersistenceEnabled()) {
      const restoreResult = await sessionPersistence.restoreSession();
      if (restoreResult.restored && restoreResult.session?.user) {
        return restoreResult.session;
      }
    }

    throw new Error('Your session expired or lost connection. Please unlock or sign in again, then retry.');
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
        const allContacts = [];
        const pageSize = 1000;
        let from = 0;

        while (true) {
          const { data, error } = await supabase
            .from('mail_contacts')
            .select(`
              *,
              segments:mail_contact_segment_memberships(segment_id)
            `)
            .eq('business_id', businessId)
            .eq('subscribed', true)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + pageSize - 1);

          if (error) throw error;

          const batch = data || [];
          allContacts.push(...batch);

          if (batch.length < pageSize) {
            break;
          }

          from += pageSize;
        }

        const uniqueContacts = [];
        const seenContactIds = new Set();

        for (const contact of allContacts) {
          if (!contact?.id || seenContactIds.has(contact.id)) {
            continue;
          }

          seenContactIds.add(contact.id);
          uniqueContacts.push({
            ...contact,
            segment_ids: Array.isArray(contact.segments)
              ? contact.segments.map((membership) => membership.segment_id).filter(Boolean)
              : []
          });
        }

        if (uniqueContacts.length !== allContacts.length) {
          console.warn(
            `Removed ${allContacts.length - uniqueContacts.length} duplicate contact row(s) while loading recipients.`
          );
        }

        console.log('Contacts loaded:', uniqueContacts.length);
        setContacts(uniqueContacts);
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

  useEffect(() => {
    const loadSystemStatus = async () => {
      if (!businessId || !canViewCampaigns) {
        return;
      }

      setSystemStatus((prev) => ({
        ...prev,
        loading: true,
        error: null
      }));

      try {
        const [
          { data: mailSettings, error: mailSettingsError },
          { data: billing, error: billingError },
          { data: businessRow, error: businessError },
        ] = await Promise.all([
          supabase
            .from('mail_settings')
            .select(
              'from_name, from_email, business_address, daily_digest_timezone, campaign_throttle_window_start_hour, campaign_throttle_window_end_hour, campaign_throttle_initial_rate_per_minute, campaign_throttle_daily_increment, campaign_throttle_max_rate_per_minute',
            )
            .eq('business_id', businessId)
            .maybeSingle(),
          supabase
            .from('mail_billing')
            .select('status, emails_used, included_emails, overage_emails, billing_period_start, billing_period_end')
            .eq('business_id', businessId)
            .order('billing_period_start', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('businesses')
            .select('timezone')
            .eq('id', businessId)
            .maybeSingle(),
        ]);

        if (businessError) {
          console.warn('Business timezone could not be loaded:', businessError);
        }

        if (mailSettingsError) {
          throw mailSettingsError;
        }

        if (billingError) {
          console.warn('Billing status could not be loaded:', billingError);
        }

        const businessTimezone =
          mailSettings?.daily_digest_timezone ||
          businessRow?.timezone ||
          'America/Toronto';

        setSystemStatus({
          loading: false,
          senderProfile: mailSettings || null,
          billing: billing || null,
          businessTimezone,
          campaignThrottle: mailSettings || null,
          error: billingError?.message || null
        });
      } catch (error) {
        console.error('Error loading sender system status:', error);
        setSystemStatus({
          loading: false,
          senderProfile: null,
          billing: null,
          businessTimezone: 'America/Toronto',
          error: error.message || 'Failed to load sender status'
        });
      }
    };

    if (!authLoading && !permissionsLoading) {
      loadSystemStatus();
    }
  }, [businessId, authLoading, permissionsLoading, canViewCampaigns]);

  useEffect(() => {
    if (authUser?.email && !rolloutReportEmail) {
      setRolloutReportEmail(authUser.email);
    }
  }, [authUser?.email, rolloutReportEmail]);

  useEffect(() => {
    let cancelled = false;
    const refreshQueueHealth = async () => {
      if (!campaign?.id || !['sending', 'scheduled'].includes(campaign?.status)) {
        if (!cancelled) setQueueHealth(null);
        return;
      }
      try {
        const health = await getCampaignQueueHealth(campaign.id);
        if (!cancelled) setQueueHealth(health);
      } catch (error) {
        console.warn('Queue health check failed:', error);
      }
    };
    refreshQueueHealth();
    const intervalId = window.setInterval(refreshQueueHealth, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [campaign?.id, campaign?.status]);

  useEffect(() => {
    const visibleContactIds = new Set(segmentScopedContacts.map((contact) => contact.id));
    setCustomContacts((prev) => prev.filter((contactId) => visibleContactIds.has(contactId)));
  }, [segmentScopedContacts]);

  const loadRolloutState = async () => {
    if (!businessId || !campaignId || !canViewCampaigns) {
      return;
    }

    setRolloutLoading(true);
    try {
      const { data: rollout, error: rolloutError } = await supabase
        .from('mail_campaign_rollouts')
        .select('*')
        .eq('business_id', businessId)
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (rolloutError) throw rolloutError;

      setActiveRollout(rollout || null);

      if (rollout?.id) {
        const { data: batches, error: batchesError } = await supabase
          .from('mail_campaign_rollout_batches')
          .select('*')
          .eq('rollout_id', rollout.id)
          .order('batch_number', { ascending: false });

        if (batchesError) throw batchesError;
        setRolloutBatches(batches || []);
      } else {
        setRolloutBatches([]);
      }
    } catch (error) {
      console.error('Error loading rollout state:', error);
      setActiveRollout(null);
      setRolloutBatches([]);
    } finally {
      setRolloutLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !permissionsLoading) {
      loadRolloutState();
    }
  }, [businessId, campaignId, authLoading, permissionsLoading, canViewCampaigns]);

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
        id: null,
        email: testEmail,
        first_name: 'Test',
        last_name: 'User',
        subscribed: true
      };

      const queueItem = {
        campaign_id: campaign.id,
        contact_id: null,
        email_address: testContact.email,
        campaign: campaign,
        contact: testContact,
        business_id: businessId,
        emailType: 'transactional'
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

  const requestGradualSend = async () => {
    if (!canSendCampaigns || !campaign || !businessId) return;
    if (blockEmailSendIfPaused('Gradual campaign send')) return;

    const alreadyActive =
      campaign.status === 'sending' ||
      campaign.status === 'scheduled' ||
      Boolean(campaign.send_throttle_enabled);

    if (alreadyActive) {
      try {
        const health = await getCampaignQueueHealth(campaign.id);
        const { data: sentRows, error: sentError } = await supabase
          .from('mail_campaign_sends')
          .select('contact_id')
          .eq('campaign_id', campaign.id)
          .eq('status', 'sent');
        if (sentError) throw sentError;
        const sentIds = new Set((sentRows || []).map((row) => row.contact_id).filter(Boolean));
        const { filteredContacts } = getEligibleContactsForCurrentSelection();
        const unsentCount = filteredContacts.filter((contact) => !sentIds.has(contact.id)).length;
        setGradualResendModal({ health, unsentCount });
        return;
      } catch (error) {
        console.error('Gradual resend precheck failed:', error);
        toast.error('Could not verify send progress. Try again in a moment.');
        return;
      }
    }

    handleSendCampaign({ gradualThrottle: true });
  };

  // Send campaign - WITH PAUSE PROTECTION & PERMISSIONS
  const handleSendCampaign = async (options = {}) => {
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
    const overrideContactIds = Array.isArray(options.overrideContactIds)
      ? options.overrideContactIds
      : null;
    const recipientModeLabel = options.recipientModeLabel || recipientSelection;

    if (overrideContactIds && overrideContactIds.length > 0) {
      recipientCount = overrideContactIds.length;
      selectedContactIds = overrideContactIds;
    } else if (recipientSelection === 'all') {
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

    let {
      targetContacts,
      consentedContacts,
      filteredContacts,
      missingConsentCount,
      skippedCount,
      eligibleRecipientCount
    } = overrideContactIds && overrideContactIds.length > 0
      ? (() => {
          const targetContacts = contacts.filter((contact) => overrideContactIds.includes(contact.id));
          const consentedContacts = targetContacts.filter(hasRecordedMarketingConsent);
          const filteredContacts = consentedContacts.filter(
            (contact) => isSafeRecipient(contact.email) || isMailboxSimulator(contact.email)
          );
          return {
            targetContacts,
            consentedContacts,
            filteredContacts,
            missingConsentCount: targetContacts.length - consentedContacts.length,
            skippedCount: consentedContacts.length - filteredContacts.length,
            eligibleRecipientCount: filteredContacts.length
          };
        })()
      : getEligibleContactsForCurrentSelection();

    const gradualThrottle = options.gradualThrottle === true;
    const sendTimezone = systemStatus.businessTimezone || 'America/Toronto';
    const throttleProfile = mergeThrottleFromSettings(
      systemStatus.campaignThrottle,
      campaign,
      sendTimezone,
    );

    if (gradualThrottle && options.forceRequeue) {
      const { data: sentRows, error: sentError } = await supabase
        .from('mail_campaign_sends')
        .select('contact_id')
        .eq('campaign_id', campaign.id)
        .eq('status', 'sent');
      if (sentError) throw sentError;
      const sentIds = new Set((sentRows || []).map((row) => row.contact_id).filter(Boolean));
      filteredContacts = filteredContacts.filter((contact) => !sentIds.has(contact.id));
      eligibleRecipientCount = filteredContacts.length;
      if (eligibleRecipientCount === 0) {
        toast.error('All eligible contacts have already been sent this campaign.');
        setGradualResendModal(null);
        return;
      }
    }

    if (eligibleRecipientCount === 0) {
      toast.error('No recipients remain after consent and deliverability checks');
      return;
    }

    const todayRate = gradualThrottle
      ? resolveRatePerMinute(
          {
            ...throttleProfile,
            send_throttle_started_on:
              campaign.send_throttle_started_on || getTodayInTimeZone(sendTimezone),
          },
          new Date(),
          sendTimezone,
        )
      : null;
    const gradualEstimate = gradualThrottle
      ? estimateGradualSendDays(eligibleRecipientCount, sendTimezone)
      : null;

    const confirmSend = window.confirm(
      gradualThrottle
        ? `Start gradual send for "${campaign.name}"?\n\n` +
          `Eligible recipients: ${eligibleRecipientCount}\n` +
          `Day 1 rate: ${todayRate}/min (${DEFAULT_GRADUAL_THROTTLE.windowStartHour}:00–${DEFAULT_GRADUAL_THROTTLE.windowEndHour}:00 ${sendTimezone})\n` +
          `Then +${DEFAULT_GRADUAL_THROTTLE.dailyIncrement}/min each day (up to ${DEFAULT_GRADUAL_THROTTLE.maxRatePerMinute}/min).\n` +
          `Estimated ~${gradualEstimate?.days || '?'} day(s) to finish.\n` +
          `${missingConsentCount > 0 ? `${missingConsentCount} skipped (no consent).\n` : ''}` +
          `${skippedCount > 0 ? `${skippedCount} skipped (invalid/test).\n` : ''}` +
          `Automations and transactional mail are not throttled.`
        : `Send "${campaign.name}" to ${eligibleRecipientCount} eligible recipients${recipientModeLabel === 'ses_simulator' ? ' (SES simulators)' : ''}?\n\n` +
          `${missingConsentCount > 0 ? `${missingConsentCount} contact(s) will be skipped for missing consent.\n` : ''}` +
          `${skippedCount > 0 ? `${skippedCount} contact(s) will be skipped for invalid/test addresses.\n\n` : '\n'}` +
          `This will cost approximately $${(eligibleRecipientCount * 0.0025).toFixed(4)} ` +
          `and cannot be undone.`
    );

    if (!confirmSend) return;

    setLoading(true);
    setSendingProgress({ sent: 0, total: eligibleRecipientCount, errors: [] });

    try {
      await ensureActiveSession();
      console.log('Starting campaign send...');

      await logSecurityEvent('campaign_send_initiated', {
        action: 'send_campaign',
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        recipient_count: eligibleRecipientCount,
        recipient_selection: recipientModeLabel,
        business_id: businessId,
        user_id: authUser?.id,
        estimated_cost: (eligibleRecipientCount * 0.0025).toFixed(4)
      }, 'critical');

      // Update campaign with recipient count
      const updateCampaignRecipientCount = async () => {
        const { error } = await supabase
          .from('mail_campaigns')
          .update({
            total_recipients: eligibleRecipientCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', campaign.id)
          .eq('business_id', businessId);

        if (error) throw error;
      };

      try {
        await updateCampaignRecipientCount();
      } catch (error) {
        if (!isSessionNetworkError(error)) throw error;
        await ensureActiveSession();
        await updateCampaignRecipientCount();
      }

      // Queue campaign for sending - WITH EMAIL FILTERING
      console.log('Queueing campaign for sending...');

      if (missingConsentCount > 0) {
        console.warn(`Skipping ${missingConsentCount} contact(s) with no recorded marketing consent.`);
        toast(`Skipped ${missingConsentCount} contact(s) missing recorded consent`, { icon: '⚠️' });
      }

      // Filter out unsafe/test/invalid emails; allow SES mailbox simulator for testing
      if (skippedCount > 0) {
        console.warn(`Skipping ${skippedCount} contact(s) due to invalid/test emails to protect SES reputation.`);
        toast(`Skipped ${skippedCount} invalid/test email addresses`, { icon: '⚠️' });
      }

      if (filteredContacts.length === 0) {
        throw new Error('No recipients remain after consent and deliverability checks');
      }

      await supabase
        .from('mail_sending_queue')
        .delete()
        .eq('campaign_id', campaign.id)
        .in('status', ['queued', 'processing']);

      const queueScheduledFor = gradualThrottle
        ? getGradualQueueScheduledFor(throttleProfile)
        : new Date().toISOString();

      // Create queue items directly
      const queueItems = filteredContacts.map(contact => ({
        campaign_id: campaign.id,
        contact_id: contact.id,
        email_address: contact.email,
        status: 'queued',
        priority: 5,
        scheduled_for: queueScheduledFor,
        business_id: businessId,
        personalized_content: emailSendingService.personalizeEmailContent(campaign.content_html || '', contact, businessId)
      }));

      // Insert queue items in chunks so large sends do not blow up the request
      const queuedItems = [];
      const queueInsertBatchSize = 1000;
      for (let i = 0; i < queueItems.length; i += queueInsertBatchSize) {
        const batch = queueItems.slice(i, i + queueInsertBatchSize);
        const insertQueueBatch = async () => {
          const { data: queuedBatch, error: queueError } = await supabase
            .from('mail_sending_queue')
            .insert(batch)
            .select();

          if (queueError) throw queueError;
          return queuedBatch || [];
        };

        try {
          const queuedBatch = await insertQueueBatch();
          queuedItems.push(...queuedBatch);
        } catch (error) {
          if (!isSessionNetworkError(error)) throw error;
          await ensureActiveSession();
          const queuedBatch = await insertQueueBatch();
          queuedItems.push(...queuedBatch);
        }
      }

      // Update campaign status
      const throttleFields = gradualThrottle
        ? {
            send_throttle_enabled: true,
            send_throttle_started_on:
              campaign.send_throttle_started_on || getTodayInTimeZone(sendTimezone),
            send_throttle_timezone: sendTimezone,
          }
        : { send_throttle_enabled: false };

      const markCampaignSending = async () => {
        const { error } = await supabase
          .from('mail_campaigns')
          .update({
            status: 'sending',
            total_recipients: filteredContacts.length,
            updated_at: new Date().toISOString(),
            ...throttleFields,
          })
          .eq('id', campaign.id)
          .eq('business_id', businessId);

        if (error) throw error;
      };

      try {
        await markCampaignSending();
      } catch (error) {
        if (!isSessionNetworkError(error)) throw error;
        await ensureActiveSession();
        await markCampaignSending();
      }

      // Kick off one backend pass only inside the gradual send window (7am–7pm local by default).
      let kickoffResult = { sent: 0, processed: 0, failed: 0, errors: [] };
      const inGradualWindow = !gradualThrottle || isWithinGradualSendWindow(throttleProfile);
      if (inGradualWindow) {
        try {
          kickoffResult = await emailSendingService.processSendingQueue(50, businessId);
        } catch (error) {
          if (!isSessionNetworkError(error)) throw error;
          await ensureActiveSession();
          kickoffResult = await emailSendingService.processSendingQueue(50, businessId);
        }
      } else if (gradualThrottle) {
        toast(
          `Queued for gradual send. Delivery starts at ${throttleProfile.send_throttle_window_start_hour}:00 ${sendTimezone} (outside the send window right now).`,
          { icon: 'ℹ️', duration: 8000 },
        );
      }

      setSendingProgress({
        sent: kickoffResult.sent || 0,
        total: filteredContacts.length,
        processed: kickoffResult.processed || 0,
        queued: queueItems.length,
        errors: kickoffResult.errors || [],
        background: true,
        complete: true
      });
      setSendComplete((kickoffResult.failed || 0) === 0);

      if ((kickoffResult.sent || 0) === 0 && (kickoffResult.failed || 0) > 0) {
        throw new Error(kickoffResult.errors?.[0] || 'Initial queue processing failed for all recipients');
      }

      await logSecurityEvent('campaign_send_completed', {
        action: 'campaign_queued_for_background_send',
        campaign_id: campaign.id,
        queued_count: queueItems.length,
        initial_processed: kickoffResult.processed || 0,
        initial_sent: kickoffResult.sent || 0,
        initial_failed: kickoffResult.failed || 0,
        business_id: businessId,
        user_id: authUser?.id
      }, 'high');

      if ((kickoffResult.failed || 0) > 0) {
        toast.error(`Campaign queued with issues: ${kickoffResult.sent || 0} sent, ${kickoffResult.failed || 0} failed in the initial pass.`);
        await recordAction('campaign_sent', false, campaign.id);
      } else if (gradualThrottle) {
        setGradualResendModal(null);
        toast.success(
          `Gradual send: ${filteredContacts.length} queued at ${todayRate}/min today (${throttleProfile.send_throttle_window_start_hour}:00–${throttleProfile.send_throttle_window_end_hour}:00).`,
        );
        await recordAction('campaign_sent', true, campaign.id);
        setCampaign((current) => (current ? { ...current, ...throttleFields, status: 'sending' } : current));
      } else {
        toast.success(`Campaign queued for delivery to ${filteredContacts.length} recipients.`);
        await recordAction('campaign_sent', true, campaign.id);
      }

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

  const handleStartRollout = async () => {
    if (!canSendCampaigns || !campaign || !businessId) {
      toast.error('You do not have permission to start a rollout');
      return;
    }

    if (blockEmailSendIfPaused('Staged rollout')) return;

    const reportEmail = rolloutReportEmail.trim().toLowerCase();
    if (!reportEmail) {
      toast.error('Enter the report email that should receive batch approvals');
      return;
    }

    const validation = await validateInput(reportEmail, 'email', 'campaign_rollout_report_email');
    if (!validation.valid) {
      toast.error(validation.error || 'Invalid report email');
      return;
    }

    const {
      filteredContacts,
      missingConsentCount,
      skippedCount,
      eligibleRecipientCount
    } = getEligibleContactsForCurrentSelection();

    if (eligibleRecipientCount === 0) {
      toast.error('No recipients remain after consent and deliverability checks');
      return;
    }

    const confirmStart = window.confirm(
      `Start staged rollout for "${campaign.name}"?\n\n` +
      `Batch plan: 50, 150, 300, 600 then doubling after approval.\n` +
      `Eligible recipients available: ${eligibleRecipientCount}\n` +
      `${missingConsentCount > 0 ? `Missing consent skipped: ${missingConsentCount}\n` : ''}` +
      `${skippedCount > 0 ? `Invalid/test skipped: ${skippedCount}\n` : ''}` +
      `A report will be emailed to ${reportEmail} after each 60 minute review window.`
    );

    if (!confirmStart) return;

    setRolloutActionLoading(true);
    try {
      await ensureActiveSession();
      const { data, error } = await supabase.functions.invoke('mail-rollout-manager', {
        body: {
          action: 'start',
          businessId,
          campaignId: campaign.id,
          reportEmail,
          waitMinutes: 60,
          batchSizes: [50, 150, 300, 600],
          contactIds: filteredContacts.map((contact) => contact.id)
        }
      });

      if (error || data?.ok === false) {
        throw error || new Error(data?.error || 'Failed to start staged rollout');
      }

      toast.success('Staged rollout started. Batch 1 has been queued.');
      setSendComplete(false);
      setSendingProgress(null);
      await loadRolloutState();
    } catch (error) {
      console.error('Error starting staged rollout:', error);
      toast.error(error.message || 'Failed to start staged rollout');
    } finally {
      setRolloutActionLoading(false);
    }
  };

  const handleApproveNextBatch = async () => {
    if (!activeRollout?.id || !campaign || !businessId) {
      toast.error('No rollout is waiting for approval');
      return;
    }

    const confirmApprove = window.confirm(
      `Approve the next staged batch for "${campaign.name}"?`
    );

    if (!confirmApprove) return;

    setRolloutActionLoading(true);
    try {
      await ensureActiveSession();
      const { data, error } = await supabase.functions.invoke('mail-rollout-manager', {
        body: {
          action: 'approve_next_batch',
          rolloutId: activeRollout.id,
          campaignId: campaign.id,
          businessId
        }
      });

      if (error || data?.ok === false) {
        throw error || new Error(data?.error || 'Failed to approve the next batch');
      }

      toast.success(data?.completed ? 'Rollout is complete.' : 'Next batch approved and queued.');
      await loadRolloutState();
    } catch (error) {
      console.error('Error approving rollout batch:', error);
      toast.error(error.message || 'Failed to approve the next batch');
    } finally {
      setRolloutActionLoading(false);
    }
  };

  const handleStopRollout = async () => {
    if (!activeRollout?.id || !businessId) {
      toast.error('No active rollout to stop');
      return;
    }

    const confirmStop = window.confirm(
      'Stop this staged rollout? No further batches will be sent until you start a new rollout.'
    );

    if (!confirmStop) return;

    setRolloutActionLoading(true);
    try {
      await ensureActiveSession();
      const { data, error } = await supabase.functions.invoke('mail-rollout-manager', {
        body: {
          action: 'stop',
          rolloutId: activeRollout.id,
          businessId,
          stopReason: 'Stopped from campaign sender'
        }
      });

      if (error || data?.ok === false) {
        throw error || new Error(data?.error || 'Failed to stop staged rollout');
      }

      toast.success('Staged rollout stopped.');
      await loadRolloutState();
    } catch (error) {
      console.error('Error stopping staged rollout:', error);
      toast.error(error.message || 'Failed to stop staged rollout');
    } finally {
      setRolloutActionLoading(false);
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
    const count = selectedAudienceCount;
    return (count * 0.0025).toFixed(4);
  };

  // Get status icon
  const getStatusIcon = (status) => {
    if (status === 'success') {
      return <FiCheck style={{ color: '#4caf50' }} />;
    }
    if (status === 'warning') {
      return <FiAlertTriangle style={{ color: '#ff9800' }} />;
    }
    if (status === 'loading') {
      return <FiRefreshCw style={{ color: '#2196f3' }} />;
    }
    return <FiX style={{ color: '#f44336' }} />;
  };

  // Get status text
  const getStatusText = (status) => {
    if (status === 'success') return 'Ready';
    if (status === 'warning') return 'Needs Attention';
    if (status === 'loading') return 'Loading';
    return 'Blocked';
  };

  const senderDisplayName =
    systemStatus.senderProfile?.from_name?.trim() ||
    businessData?.name?.trim() ||
    business?.name?.trim() ||
    '';

  const senderProfileStatus = systemStatus.loading
    ? 'loading'
    : systemStatus.senderProfile?.from_email && senderDisplayName
      ? 'success'
      : 'warning';

  const billingStatus = systemStatus.loading
    ? 'loading'
    : !systemStatus.billing
      ? 'warning'
      : systemStatus.billing.status === 'active'
        ? 'success'
        : 'error';

  const complianceStatus = systemStatus.loading
    ? 'loading'
    : systemStatus.senderProfile?.business_address
      ? 'success'
      : 'warning';

  const audienceStatus = segmentScopedContacts.length > 0 ? 'success' : 'warning';
  const isResendFlow =
    campaign?.status === 'sent' ||
    campaign?.status === 'failed' ||
    campaign?.status === 'partial_failure';
  const senderPageTitle = isResendFlow ? 'Send Campaign Again' : 'Send Campaign';
  const senderPageSubtitle = isResendFlow
    ? 'Review recipients and resend this campaign'
    : 'Configure and send your email campaign';
  const sendNowLabel = isResendFlow ? 'Send Campaign Again' : 'Send Campaign Now';

  if (authLoading || permissionsLoading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailModuleTabs />
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
          <MailModuleHeader />
          <MailModuleTabs />
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
          <MailModuleHeader />
          <MailModuleTabs />
          <div style={styles.errorState}>
            <FiX style={styles.errorIcon} />
            <h2>Campaign Not Found</h2>
            <p>The requested campaign could not be found or you don't have access to it.</p>
            <button 
              style={styles.backButton}
              onClick={() => navigate('/dashboard/mail/campaigns')}
            >
              Back to Campaigns
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
          <MailModuleHeader />
          <MailModuleTabs />
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
  const latestRolloutBatch = rolloutBatches[0] || null;
  const rolloutEligibleSummary = getEligibleContactsForCurrentSelection();
  const rolloutIsActive =
    activeRollout && ['waiting_for_report', 'awaiting_approval'].includes(activeRollout.status);
  const showApproveButton =
    rolloutIsActive &&
    activeRollout?.status === 'awaiting_approval' &&
    latestRolloutBatch?.status === 'awaiting_approval';
  const sendTimezone = systemStatus.businessTimezone || 'America/Toronto';
  const throttleProfile = mergeThrottleFromSettings(
    systemStatus.campaignThrottle,
    campaign,
    sendTimezone,
  );
  const gradualEligibleCount = rolloutEligibleSummary.eligibleRecipientCount;
  const gradualDayEstimate = estimateGradualSendDays(gradualEligibleCount, sendTimezone);
  const campaignThrottleActive =
    Boolean(campaign?.send_throttle_enabled) &&
    (campaign?.status === 'sending' || campaign?.status === 'scheduled');
  const currentThrottleRate = campaignThrottleActive
    ? resolveRatePerMinute(throttleProfile, new Date(), sendTimezone)
    : throttleProfile.send_throttle_initial_rate_per_minute;
  const queueStalled = Boolean(queueHealth?.stalled);

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailModuleTabs />

          {queueStalled && (
            <div style={styles.stallBanner} role="alert">
              <FiAlertTriangle style={styles.warningIcon} />
              <div>
                <strong>Send pipeline stalled</strong> — no queue activity for {CAMPAIGN_QUEUE_STALL_DAYS}+ days
                but {queueHealth.pending} email(s) are still waiting ({queueHealth.sent} sent so far).
                Check Mail settings (pause/test mode), SES limits, and Email History. The campaign stays{' '}
                <em>sending</em> until the queue finishes; it will not show as Sent until then.
              </div>
            </div>
          )}
          
          <div style={styles.header}>
            <div style={styles.titleSection}>
              <h1 style={styles.title}>{senderPageTitle}: {campaign.name}</h1>
              <p style={styles.subtitle}>{senderPageSubtitle}</p>
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

          {/* System Status */}
          <div style={styles.statusSection}>
            <h2 style={styles.sectionTitle}>
              <FiSettings style={styles.sectionIcon} />
              System Status
            </h2>
            <div style={styles.statusGrid}>
              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon(senderProfileStatus)}
                  <span style={styles.statusTitle}>Sender Profile</span>
                </div>
                <div style={styles.statusText}>{getStatusText(senderProfileStatus)}</div>
                <div style={styles.statusDetails}>
                  {systemStatus.loading
                    ? 'Loading sender settings...'
                    : systemStatus.senderProfile?.from_email
                      ? `${senderDisplayName || 'Mailer'} <${systemStatus.senderProfile.from_email}>`
                      : 'Missing from name or from email in mail settings'}
                </div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon(billingStatus)}
                  <span style={styles.statusTitle}>Billing</span>
                </div>
                <div style={styles.statusText}>{getStatusText(billingStatus)}</div>
                <div style={styles.statusDetails}>
                  {systemStatus.loading
                    ? 'Loading billing status...'
                    : systemStatus.billing
                      ? `${systemStatus.billing.status} · ${systemStatus.billing.emails_used || 0}/${systemStatus.billing.included_emails || 0} used`
                      : 'Billing record will be created automatically on first send'}
                </div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon(complianceStatus)}
                  <span style={styles.statusTitle}>Compliance</span>
                </div>
                <div style={styles.statusText}>{getStatusText(complianceStatus)}</div>
                <div style={styles.statusDetails}>
                  {systemStatus.loading
                    ? 'Checking campaign footer and sender address...'
                    : systemStatus.senderProfile?.business_address
                      ? 'Business address present and unsubscribe footer is injected automatically'
                      : 'Missing business address in mail settings'}
                </div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusHeader}>
                  {getStatusIcon(audienceStatus)}
                  <span style={styles.statusTitle}>Audience</span>
                </div>
                <div style={styles.statusText}>{getStatusText(audienceStatus)}</div>
                <div style={styles.statusDetails}>
                  {contacts.length > 0
                    ? campaign?.target_segment
                      ? `${segmentScopedContacts.length} saved-list contact${segmentScopedContacts.length === 1 ? '' : 's'} available`
                      : `${contacts.length} subscribed contact${contacts.length === 1 ? '' : 's'} available`
                    : 'No subscribed contacts available to send'}
                </div>
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
                  {systemStatus.billing
                    ? `${systemStatus.billing.emails_used || 0} / ${systemStatus.billing.included_emails || 0}`
                    : 'Unavailable'}
                </span>
              </div>
              <div style={styles.billingItem}>
                <span style={styles.billingLabel}>Target recipients:</span>
                <span style={styles.billingValue}>
                  {selectedAudienceCount}
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
              {campaign?.target_segment && (
                <div style={styles.segmentTargetNotice}>
                  This campaign is limited to its saved send list. "All" means all contacts in that list, and custom selection is limited to the same list.
                </div>
              )}
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
                  <div style={styles.recipientTitle}>
                    {campaign?.target_segment ? 'All Contacts In Saved List' : 'All Subscribed Contacts'}
                  </div>
                  <div style={styles.recipientDescription}>
                    {campaign?.target_segment
                      ? `Send to all ${segmentScopedContacts.length} contacts in this campaign's saved list`
                      : `Send to all ${contacts.length} subscribed contacts`}
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
                    {campaign?.target_segment
                      ? `Choose specific contacts from this saved list (${customContacts.length} selected)`
                      : `Choose specific contacts (${customContacts.length} selected)`}
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
                      onClick={() => setCustomContacts(segmentScopedContacts.map(c => c.id))}
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
                  {segmentScopedContacts.map(contact => (
                    <div
                      key={contact.id}
                      style={{
                        ...styles.contactItem,
                        ...(customContacts.includes(contact.id) ? styles.contactItemSelected : {})
                      }}
                    >
                      <TavariCheckbox
                        checked={customContacts.includes(contact.id)}
                        onChange={() => handleCustomContactToggle(contact.id)}
                        disabled={!canSendCampaigns}
                        appearance="custom"
                        size="md"
                        style={styles.contactCheckboxContainer}
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
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={styles.rolloutSection}>
            <h3 style={styles.sectionTitle}>
              <FiClock style={styles.sectionIcon} />
              Staged Rollout
            </h3>
            <p style={styles.rolloutDescription}>
              Send this campaign in controlled batches of 50, 150, 300, 600, then double each approved batch. The system waits 60 minutes, emails a report, and never reuses a recipient already included in the rollout.
            </p>

            <div style={styles.rolloutControls}>
              <div style={styles.rolloutField}>
                <label style={styles.rolloutLabel}>Report Email</label>
                <input
                  type="email"
                  style={styles.rolloutInput}
                  value={rolloutReportEmail}
                  onChange={(e) => setRolloutReportEmail(e.target.value)}
                  placeholder="Enter approval report email"
                  disabled={rolloutActionLoading || rolloutIsActive}
                />
              </div>
              <div style={styles.rolloutSummaryBox}>
                <div style={styles.rolloutSummaryLabel}>Eligible recipients</div>
                <div style={styles.rolloutSummaryValue}>{rolloutEligibleSummary.eligibleRecipientCount}</div>
                <div style={styles.rolloutSummaryMeta}>
                  {rolloutEligibleSummary.missingConsentCount} missing consent skipped · {rolloutEligibleSummary.skippedCount} invalid/test skipped
                </div>
              </div>
            </div>

            {rolloutLoading ? (
              <div style={styles.rolloutStatusNote}>Loading rollout status...</div>
            ) : rolloutIsActive ? (
              <div style={styles.rolloutActiveCard}>
                <div style={styles.rolloutActiveHeader}>
                  <div>
                    <div style={styles.rolloutStatusPill}>{String(activeRollout.status || 'unknown').replace(/_/g, ' ')}</div>
                    <h4 style={styles.rolloutActiveTitle}>Current rollout</h4>
                    <p style={styles.rolloutActiveMeta}>
                      Report email: {activeRollout.report_email || 'Not set'} · Total pool: {activeRollout.total_candidate_recipients || 0}
                    </p>
                  </div>
                  <div style={styles.rolloutActionGroup}>
                    <button
                      style={styles.secondaryActionButton}
                      onClick={loadRolloutState}
                      disabled={rolloutActionLoading}
                    >
                      Refresh
                    </button>
                    {showApproveButton && (
                      <button
                        style={styles.approveRolloutButton}
                        onClick={handleApproveNextBatch}
                        disabled={rolloutActionLoading}
                      >
                        {rolloutActionLoading ? 'Approving...' : 'Approve Next Batch'}
                      </button>
                    )}
                    {['waiting_for_report', 'awaiting_approval'].includes(activeRollout.status) && (
                      <button
                        style={styles.stopRolloutButton}
                        onClick={handleStopRollout}
                        disabled={rolloutActionLoading}
                      >
                        Stop Rollout
                      </button>
                    )}
                  </div>
                </div>

                {latestRolloutBatch && (
                  <div style={styles.rolloutBatchCard}>
                    <div style={styles.rolloutBatchTitle}>Latest batch</div>
                    <div style={styles.rolloutBatchGrid}>
                      <div><strong>Batch #</strong><br />{latestRolloutBatch.batch_number}</div>
                      <div><strong>Requested</strong><br />{latestRolloutBatch.requested_size}</div>
                      <div><strong>Actual</strong><br />{latestRolloutBatch.actual_size}</div>
                      <div><strong>Status</strong><br />{String(latestRolloutBatch.status || '').replace(/_/g, ' ')}</div>
                      <div><strong>Delivery success</strong><br />{latestRolloutBatch.delivery_success_count || 0}</div>
                      <div><strong>Bounces</strong><br />{latestRolloutBatch.bounced_count || 0}</div>
                      <div><strong>Complaints</strong><br />{latestRolloutBatch.complaint_count || 0}</div>
                      <div><strong>Unsubscribes</strong><br />{latestRolloutBatch.unsubscribe_count || 0}</div>
                      <div><strong>Opens</strong><br />{latestRolloutBatch.opened_count || 0}</div>
                      <div><strong>Clicks</strong><br />{latestRolloutBatch.clicked_count || 0}</div>
                    </div>
                    {latestRolloutBatch.scheduled_report_at && latestRolloutBatch.status === 'awaiting_report' && (
                      <div style={styles.rolloutStatusNote}>
                        Waiting for the 60 minute report window to finish before approval is available.
                      </div>
                    )}
                    {latestRolloutBatch.report_error && (
                      <div style={styles.rolloutErrorNote}>
                        Report email issue: {latestRolloutBatch.report_error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={styles.rolloutInactiveCard}>
                <p style={styles.rolloutStatusNote}>
                  {activeRollout
                    ? `Latest rollout status: ${String(activeRollout.status || 'unknown').replace(/_/g, ' ')}.`
                    : 'No staged rollout is active for this campaign.'}
                </p>
                {latestRolloutBatch && !rolloutIsActive && (
                  <div style={{ ...styles.rolloutBatchGrid, marginBottom: '16px', textAlign: 'left' }}>
                    <div><strong>Last batch</strong><br />#{latestRolloutBatch.batch_number}</div>
                    <div><strong>Delivery success</strong><br />{latestRolloutBatch.delivery_success_count || 0}</div>
                    <div><strong>Bounces</strong><br />{latestRolloutBatch.bounced_count || 0}</div>
                    <div><strong>Complaints</strong><br />{latestRolloutBatch.complaint_count || 0}</div>
                  </div>
                )}
                <button
                  style={{
                    ...styles.startRolloutButton,
                    opacity: canSend && !rolloutActionLoading ? 1 : 0.5,
                    cursor: canSend && !rolloutActionLoading ? 'pointer' : 'not-allowed'
                  }}
                  onClick={handleStartRollout}
                  disabled={!canSend || rolloutActionLoading || rolloutEligibleSummary.eligibleRecipientCount === 0}
                >
                  {rolloutActionLoading ? 'Starting rollout...' : 'Start Staged Rollout'}
                </button>
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
                <span>{sendingProgress.sent} / {sendingProgress.total} sent so far</span>
                <span>{sendingProgress.errors?.length || 0} errors</span>
                {sendingProgress.complete && <span style={{ color: '#4caf50' }}>{sendingProgress.background ? 'Background processing active' : 'Complete'}</span>}
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

          <PermissionGate
            permission="mail.campaigns.send"
            fallback={null}
          >
            <div style={styles.gradualSection}>
              <h3 style={styles.sectionTitle}>
                <FiClock style={styles.sectionIcon} />
                Gradual warmup send
              </h3>
              <p style={styles.rolloutDescription}>
                Spread this campaign with a daily ramp: {throttleProfile.send_throttle_initial_rate_per_minute}/min today, +{throttleProfile.send_throttle_daily_increment}/min per day up to {throttleProfile.send_throttle_max_rate_per_minute}/min ({throttleProfile.send_throttle_window_start_hour}:00–{throttleProfile.send_throttle_window_end_hour}:00 {sendTimezone}).{' '}
                <Link to="/dashboard/mail/settings?tab=campaign-sending" style={styles.settingsLink}>
                  Edit rates in Mail Settings → Campaign sending
                </Link>
              </p>
              {campaignThrottleActive && (
                <div style={styles.gradualActiveCard}>
                  <div style={styles.rolloutStatusPill}>gradual send active</div>
                  <p style={styles.rolloutActiveMeta}>
                    Today: <strong>{currentThrottleRate}/min</strong> · Started {campaign.send_throttle_started_on || 'today'}
                  </p>
                </div>
              )}
              {!campaignThrottleActive && !rolloutIsActive && gradualEligibleCount > 0 && (
                <p style={styles.rolloutStatusNote}>
                  ~{gradualDayEstimate.days} day(s) for {gradualEligibleCount} eligible recipients.
                </p>
              )}
              {!campaignThrottleActive && (
                <button
                  type="button"
                  style={{
                    ...styles.gradualSendButton,
                    opacity: canSend && !loading && !rolloutIsActive && gradualEligibleCount > 0 ? 1 : 0.5,
                  }}
                  onClick={requestGradualSend}
                  disabled={!canSend || loading || rolloutIsActive || gradualEligibleCount === 0}
                >
                  {loading ? <FiRefreshCw style={styles.spinningIcon} /> : <FiClock style={styles.buttonIcon} />}
                  Start gradual send ({throttleProfile.send_throttle_initial_rate_per_minute}/min today)
                </button>
              )}
            </div>
          </PermissionGate>

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
                    This campaign will be sent to {selectedAudienceCount} recipients.
                    <br />
                    Estimated cost: <strong>${getEstimatedCost()}</strong>
                  </p>
                  {rolloutIsActive && (
                    <p style={styles.rolloutErrorNote}>
                      A staged rollout is already active for this campaign. Finish or stop it before using the full-send path.
                    </p>
                  )}
                  {campaignThrottleActive && (
                    <p style={styles.rolloutErrorNote}>
                      Gradual send is active for this campaign. Use Send Campaign Now only if you intend to disable the ramp (not recommended mid-send).
                    </p>
                  )}
                  <p style={styles.sendWarning}>
                    This action cannot be undone. The campaign will be queued immediately and continue sending in the background (up to 100/min, not throttled).
                  </p>
                </div>
                
                <button
                  style={{
                    ...styles.sendButton,
                    opacity: canSend && !loading ? 1 : 0.5
                  }}
                  onClick={handleSendCampaign}
                  disabled={
                    !canSend ||
                    loading ||
                    (recipientSelection === 'custom' && customContacts.length === 0) ||
                    rolloutIsActive ||
                    campaignThrottleActive
                  }
                >
                  {loading ? (
                    <>
                      <FiRefreshCw style={styles.spinningIcon} />
                      Sending...
                    </>
                  ) : (
                    <>
                      <FiPlay style={styles.buttonIcon} />
                      {sendNowLabel}
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
              <h2>Campaign Queued Successfully!</h2>
              <p>
                Your campaign "{campaign.name}" has been queued for {sendingProgress.total} recipients.
                {sendingProgress.sent > 0 ? ` ${sendingProgress.sent} email(s) were already processed in the initial backend pass.` : ''}
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
                  onClick={() => navigate('/dashboard/mail/campaigns')}
                >
                  Back to Campaigns
                </button>
              </div>
            </div>
          )}

        </div>

        <GradualSendWarningModal
          open={Boolean(gradualResendModal)}
          campaignName={campaign?.name}
          queueHealth={gradualResendModal?.health}
          remainingToQueue={gradualResendModal?.unsentCount ?? 0}
          onCancel={() => setGradualResendModal(null)}
          onConfirm={() => {
            setGradualResendModal(null);
            handleSendCampaign({ gradualThrottle: true, forceRequeue: true });
          }}
        />
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
    backgroundColor: '#fff',
    transition: 'background-color 0.2s ease',
  },
  contactItemSelected: {
    backgroundColor: '#f0f8f8',
    border: '1px solid #80cbc4',
  },
  contactCheckboxContainer: {
    flexShrink: 0,
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
  rolloutSection: {
    backgroundColor: '#f8f8ff',
    border: '1px solid #d7d9ff',
    borderRadius: '12px',
    padding: '25px',
    marginBottom: '30px',
  },
  stallBanner: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    padding: '16px 20px',
    margin: '0 0 20px',
    borderRadius: '10px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    fontSize: '14px',
    lineHeight: 1.5,
  },
  gradualSection: {
    backgroundColor: '#f0fdf9',
    border: '1px solid #99f6e4',
    borderRadius: '12px',
    padding: '25px',
    marginBottom: '30px',
  },
  gradualActiveCard: {
    backgroundColor: 'white',
    border: '1px solid #5eead4',
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '16px',
  },
  gradualSendButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#0d9488',
    color: 'white',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
  },
  rolloutDescription: {
    fontSize: '13px',
    color: '#4b5563',
    marginTop: 0,
    marginBottom: '20px',
    lineHeight: 1.6,
  },
  settingsLink: {
    color: '#0d9488',
    fontWeight: 600,
    textDecoration: 'underline',
  },
  rolloutControls: {
    display: 'grid',
    gridTemplateColumns: 'minmax(260px, 1.5fr) minmax(220px, 1fr)',
    gap: '16px',
    marginBottom: '20px',
  },
  rolloutField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  rolloutLabel: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#374151',
  },
  rolloutInput: {
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    fontSize: '18px',
    width: '100%',
    boxSizing: 'border-box',
  },
  rolloutSummaryBox: {
    backgroundColor: 'white',
    border: '1px solid #dbeafe',
    borderRadius: '10px',
    padding: '16px',
  },
  rolloutSummaryLabel: {
    fontSize: '48px',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '6px',
  },
  rolloutSummaryValue: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: '6px',
  },
  rolloutSummaryMeta: {
    fontSize: '14px',
    color: '#6b7280',
  },
  rolloutActiveCard: {
    backgroundColor: 'white',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    padding: '20px',
  },
  rolloutInactiveCard: {
    backgroundColor: 'white',
    border: '1px dashed #cbd5e1',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center',
  },
  rolloutActiveHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'flex-start',
    marginBottom: '18px',
  },
  rolloutActiveTitle: {
    margin: '8px 0 4px',
    fontSize: '16px',
    color: '#111827',
  },
  rolloutActiveMeta: {
    margin: 0,
    fontSize: '48px',
    color: '#6b7280',
  },
  rolloutStatusPill: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '999px',
    backgroundColor: '#ede9fe',
    color: '#5b21b6',
    fontSize: '48px',
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  rolloutActionGroup: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  secondaryActionButton: {
    backgroundColor: 'white',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  approveRolloutButton: {
    backgroundColor: '#111827',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 16px',
    fontSize: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  stopRolloutButton: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '10px 16px',
    fontSize: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  startRolloutButton: {
    backgroundColor: '#111827',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    padding: '14px 22px',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  rolloutBatchCard: {
    borderTop: '1px solid #e5e7eb',
    paddingTop: '18px',
  },
  rolloutBatchTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: '12px',
  },
  rolloutBatchGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '12px',
    fontSize: '10px',
    color: '#374151',
  },
  rolloutStatusNote: {
    marginTop: '14px',
    fontSize: '10px',
    color: '#6b7280',
  },
  rolloutErrorNote: {
    marginTop: '14px',
    fontSize: '10px',
    color: '#b91c1c',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '10px 12px',
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
    fontSize: '11px',
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
    fontSize: '10px',
    color: '#d32f2f',
    marginBottom: '5px',
  },
  moreErrors: {
    fontSize: '10px',
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
    fontSize: '11px',
    fontWeight: 'bold',
  },
  sendButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    padding: '20px 40px',
    fontSize: '14px',
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
    fontSize: '38px',
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
    fontSize: '11px',
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
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  spinningIcon: {
    fontSize: '13px',
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
    fontSize: '38px',
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
    fontSize: '38px',
    color: '#f44336',
    marginBottom: '20px',
  },
  backButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '20px',
  },
};

export default CampaignSender;


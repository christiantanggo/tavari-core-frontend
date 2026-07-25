// CampaignBuilder.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import EmailPauseBanner, { blockEmailSendIfPaused } from '../../components/EmailPauseBanner';

import {
  FiSave, FiSend, FiEye, FiSmartphone, FiMonitor, FiFileText, FiDollarSign,
  FiClock, FiSettings, FiBarChart2, FiActivity, FiLayers, FiTarget, FiArrowLeft,
  FiType, FiImage, FiLink, FiMinus, FiShare2, FiCopy, FiMove, FiTrash2,
  FiAlignLeft, FiAlignCenter, FiAlignRight, FiUpload, FiPlus, FiChevronUp, FiChevronDown,
  FiAlertCircle, FiMail, FiX
} from 'react-icons/fi';
import emailSendingService from '../../helpers/Mail/emailSendingService';
import CampaignScheduler from '../../components/Mail/CampaignScheduler';
import CampaignSchedulerService from '../../helpers/Mail/CampaignSchedulerService';

// Permission System Imports
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import MailModuleHeader from '../../components/Mail/MailModuleHeader';
import { MailModuleTabs } from '../../components/Mail/MailModuleNavigation';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';

const AUTOMATION_TYPE_OPTIONS = [
  { value: 'birthday', label: 'Birthday Promotions' },
  { value: 'day-camp', label: 'Day Camp Promotions' },
  { value: 'summer-camp', label: 'Summer Camp Promotions' },
  { value: 'we-miss-you', label: 'We Miss You' },
  { value: 'custom', label: 'Custom Automation' }
];

const AUTOMATION_SOURCE_OPTIONS = [
  { value: 'custom_rules', label: 'Custom Rules' },
  { value: 'waiver_check_in_review', label: 'Waiver Check-In Review Request' },
  { value: 'name_of_day', label: 'Name of the Day (waiver minors)' },
  { value: 'toddler_thursday', label: 'Toddler Thursday (bi-weekly promo)' }
];

function getDefaultPromoAnchorDate() {
  const d = new Date();
  const day = d.getDay();
  const daysUntilThu = (4 - day + 7) % 7;
  d.setDate(d.getDate() + daysUntilThu);
  return d.toISOString().slice(0, 10);
}

const AUTOMATION_DEFAULTS_BY_TYPE = {
  birthday: {
    trigger_timing: 'before_event',
    days_offset: 14,
    defaultName: 'Birthday Promotion Automation'
  },
  'day-camp': {
    trigger_timing: 'before_event',
    days_offset: 21,
    defaultName: 'Day Camp Promotion Automation'
  },
  'summer-camp': {
    trigger_timing: 'before_event',
    days_offset: 30,
    defaultName: 'Summer Camp Promotion Automation'
  },
  'we-miss-you': {
    trigger_timing: 'after_event',
    days_offset: 60,
    defaultName: 'We Miss You Automation'
  },
  custom: {
    trigger_timing: 'custom_window',
    days_offset: 0,
    defaultName: 'Custom Mail Automation'
  }
};

const AUTOMATION_DEFAULTS_BY_SOURCE = {
  waiver_check_in_review: {
    automation_type: 'custom',
    trigger_source: 'waiver_check_in_review',
    trigger_timing: 'after_event',
    days_offset: 0,
    defaultName: 'Post-Visit Review Request',
    // Must be true or waiver check-in never sends until user discovers the toggle (edge fn filters is_enabled)
    is_enabled: true
  },
  toddler_thursday: {
    automation_type: 'custom',
    trigger_source: 'toddler_thursday',
    trigger_timing: 'event_day',
    days_offset: 0,
    defaultName: 'Toddler Thursday Promotion',
    send_start_hour: 6,
    send_end_hour: 9,
    send_minute_offset: 0,
    promo_anchor_date: getDefaultPromoAnchorDate(),
    toddler_min_age_years: 1,
    toddler_max_age_years: 3,
    offer_price_label: '$7',
    promo_code: 'DCT2026',
    min_toddler_count_for_offer: 2,
    booking_window_label: '10:00 AM – 1:00 PM',
    is_enabled: false
  }
};

/** Shown in builder when trigger is Name of the Day — must match mail-process-queue personalizeEmailContent */
const NAME_OF_DAY_MERGE_TOKEN_GROUPS = [
  {
    label: 'Parent / guardian (email recipient)',
    codes: ['{{FirstName}}', '{{LastName}}', '{{FullName}}', '{{Email}}']
  },
  {
    label: 'Winning minor',
    codes: ['{{WinnerMinorFirstName}}', '{{MinorFirstName}}', '{{MinorLastName}}']
  },
  {
    label: "Today's name picks",
    codes: ['{{GirlNameOfDay}}', '{{BoyNameOfDay}}']
  },
  {
    label: 'Date',
    codes: ['{{NameOfDayDate}}', '{{Local Date}}']
  },
  {
    label: 'Other (optional)',
    codes: ['{{LoyaltyPoints}}', '{{EventDate}}', '{{Event Date}}']
  }
];

/** Shown in builder when trigger is Toddler Thursday — must match mail-process-queue personalizeEmailContent */
const TODDLER_THURSDAY_MERGE_TOKEN_GROUPS = [
  {
    label: 'Parent / guardian (email recipient)',
    codes: ['{{FirstName}}', '{{LastName}}', '{{FullName}}', '{{Email}}']
  },
  {
    label: 'Toddler promo details',
    codes: [
      '{{ToddlerCount}}',
      '{{ToddlerNames}}',
      '{{PromoThursdayDate}}',
      '{{OfferPrice}}',
      '{{PromoCode}}',
      '{{BookingWindow}}',
      '{{MinToddlersForOffer}}',
      '{{OfferDetails}}'
    ]
  },
  {
    label: 'Other (optional)',
    codes: ['{{LoyaltyPoints}}']
  }
];

const TODDLER_THURSDAY_TEMPLATE_BLOCKS = [
  {
    id: 'toddler-heading',
    type: 'heading',
    content: 'Toddler Thursday is today!',
    settings: {
      level: 'h2',
      fontSize: '16px',
      color: '#111827',
      textAlign: 'left',
      fontWeight: 'bold',
      linkUrl: ''
    }
  },
  {
    id: 'toddler-intro',
    type: 'text',
    content:
      'Hi {{First Name}},\n\nHappy Toddler Thursday! Today is {{PromoThursdayDate}}. We have {{ToddlerCount}} toddler(s) on your account: {{ToddlerNames}}.',
    settings: {
      fontSize: '24px',
      color: '#334155',
      textAlign: 'left',
      lineHeight: '1.6',
      linkUrl: ''
    }
  },
  {
    id: 'toddler-offer',
    type: 'text',
    content:
      'Book online for the Toddler Thursday session ({{BookingWindow}}) and use promo code {{PromoCode}} at checkout.\n\nWhen you book {{MinToddlersForOffer}} or more toddlers, each admission is only {{OfferPrice}}.\n\n{{OfferDetails}}',
    settings: {
      fontSize: '1px',
      color: '#334155',
      textAlign: 'left',
      lineHeight: '1.6',
      linkUrl: ''
    }
  },
  {
    id: 'toddler-reminder',
    type: 'text',
    content:
      'Important: your booking must be for the Toddler Thursday time slot between 10:00 AM and 1:00 PM, and the promo code must be applied at online checkout.',
    settings: {
      fontSize: '12px',
      color: '#475569',
      textAlign: 'left',
      lineHeight: '1.6',
      linkUrl: ''
    }
  }
];

const REVIEW_REQUEST_TEMPLATE_BLOCKS = [
  {
    id: 'review-heading',
    type: 'heading',
    content: 'Thanks for visiting!',
    settings: {
      level: 'h2',
      fontSize: '48px',
      color: '#111827',
      textAlign: 'left',
      fontWeight: 'bold',
      linkUrl: ''
    }
  },
  {
    id: 'review-message',
    type: 'text',
    content: 'Hi {{First Name}},\n\nThank you for visiting us today. We hope {{CheckedInName}} had a great time.\n\nYour feedback helps our team improve and helps other families find us.',
    settings: {
      fontSize: '48px',
      color: '#334155',
      textAlign: 'left',
      lineHeight: '1.6',
      linkUrl: ''
    }
  },
  {
    id: 'review-button',
    type: 'button',
    content: {
      buttons: [
        { text: 'Leave a Review', url: '{{ReviewLink}}' }
      ]
    },
    settings: {
      backgroundColor: '#008080',
      color: '#ffffff',
      textAlign: 'center',
      padding: '12px 24px',
      borderRadius: '6px',
      layout: 'single'
    }
  }
];

const getAutomationDefaults = (automationType = 'custom', automationSource = '') => {
  const defaultSendWindow = {
    send_start_hour: 7,
    send_end_hour: 19,
    send_minute_offset: 0,
  };

  if (automationSource && AUTOMATION_DEFAULTS_BY_SOURCE[automationSource]) {
    const defaults = AUTOMATION_DEFAULTS_BY_SOURCE[automationSource];
    return {
      id: null,
      name: defaults.defaultName,
      is_enabled: false,
      status: 'draft',
      ...defaultSendWindow,
      ...defaults
    };
  }

  const defaults = AUTOMATION_DEFAULTS_BY_TYPE[automationType] || AUTOMATION_DEFAULTS_BY_TYPE.custom;
  return {
    id: null,
    name: defaults.defaultName,
    automation_type: automationType,
    trigger_source: automationType === 'custom' ? 'custom_rules' : '',
    apply_max_child_age_rule: ['birthday', 'day-camp', 'summer-camp'].includes(automationType),
    is_enabled: false,
    status: 'draft',
    trigger_timing: defaults.trigger_timing,
    days_offset: defaults.days_offset,
    ...defaultSendWindow
  };
};

const CampaignBuilder = () => {
  const preserveLineBreaks = (content) => String(content || '').replace(/\r\n|\r|\n/g, '<br />');

  const navigate = useNavigate();
  const location = useLocation();
  const { campaignId } = useParams();
  const { business } = useBusiness();
  const isEditing = !!campaignId;
  const searchParams = new URLSearchParams(location.search);
  const isAutomationMode = searchParams.get('mode') === 'automation';
  const requestedAutomationType = String(searchParams.get('automationType') || 'custom').trim() || 'custom';
  const requestedAutomationSource = String(searchParams.get('automationSource') || '').trim();
  const requestedAutomationId = String(searchParams.get('automationId') || '').trim() || null;

  // Security context for sensitive campaign data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'CampaignBuilder',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
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
    componentName: 'CampaignBuilder'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // State management
  const [campaign, setCampaign] = useState({
    name: '',
    subject_line: '',
    preheader_text: '',
    content_blocks: [],
    target_segment: null,
    status: 'draft'
  });

  const [previewMode, setPreviewMode] = useState('desktop');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
  const [activeBlock, setActiveBlock] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');
  const [segments, setSegments] = useState([]);
  const [segmentCountError, setSegmentCountError] = useState('');
  const [automationConfig, setAutomationConfig] = useState(() => getAutomationDefaults(requestedAutomationType, requestedAutomationSource));
  /** Only include is_enabled in DB updates after user touches the builder toggle — avoids saving default false over an enabled automation. */
  const automationIsEnabledTouchedRef = useRef(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  /** Same field as Mail → Automations blueprint / reputation_settings (stored as minutes server-side). */
  const [waiverCheckInDelayHours, setWaiverCheckInDelayHours] = useState(2);

  const businessId =
    selectedBusinessId ||
    businessData?.id ||
    localStorage.getItem('currentBusinessId') ||
    business?.id ||
    localStorage.getItem('businessId');

  // Permission checks
  const canViewCampaigns = hasPermission('mail.campaigns.view') || hasElevatedPrivileges();
  const canCreateCampaigns = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();
  const canEditCampaigns = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();
  const canSendCampaigns = hasPermission('mail.campaigns.send') || hasElevatedPrivileges();
  const canUploadImages = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();

  const TEST_PATTERNS = [
    /^(test|fake|sample)[\.\+\w-]*@/i,
    /@example\.com$/i,
    /@test\./i,
    /@invalid\./i,
    /@no-reply\./i
  ];

  const isMailboxSimulator = (email) => /@simulator\.amazonses\.com$/i.test(email);

  const isSafeRecipient = (email) => {
    if (!email) return false;
    return !TEST_PATTERNS.some(pattern => pattern.test(email));
  };

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !authLoading) {
      if (isEditing && !canEditCampaigns) {
        toast.error('You do not have permission to edit campaigns');
        navigate('/dashboard/mail/campaigns');
      } else if (!isEditing && !canCreateCampaigns) {
        toast.error('You do not have permission to create campaigns');
        navigate('/dashboard/mail/campaigns');
      }
    }
  }, [permissionsLoading, authLoading, canEditCampaigns, canCreateCampaigns, isEditing]);

  useEffect(() => {
    if (isEditing && campaignId && businessId && canViewCampaigns) {
      loadCampaign();
    }
  }, [campaignId, businessId, canViewCampaigns]);

  useEffect(() => {
    if (isAutomationMode) {
      setAutomationConfig((prev) => {
        if (prev.id) {
          return prev;
        }

        const defaults = getAutomationDefaults(requestedAutomationType, requestedAutomationSource);
        return {
          ...defaults,
          name: prev.name || defaults.name
        };
      });
    }
  }, [isAutomationMode, requestedAutomationType, requestedAutomationSource]);

  useEffect(() => {
    if (!isAutomationMode || isEditing || requestedAutomationSource !== 'waiver_check_in_review') {
      return;
    }

    setCampaign((prev) => {
      if (prev.name || prev.subject_line || prev.content_blocks.length > 0) {
        return prev;
      }

      return {
        ...prev,
        name: 'Post-Visit Review Request',
        subject_line: 'Thank you for visiting!',
        preheader_text: 'We would love to hear about your visit.',
        content_blocks: REVIEW_REQUEST_TEMPLATE_BLOCKS
      };
    });
  }, [isAutomationMode, isEditing, requestedAutomationSource]);

  useEffect(() => {
    if (!isAutomationMode || isEditing || requestedAutomationSource !== 'toddler_thursday') {
      return;
    }

    setCampaign((prev) => {
      if (prev.name || prev.subject_line || prev.content_blocks.length > 0) {
        return prev;
      }

      return {
        ...prev,
        name: 'Toddler Thursday Promotion',
        subject_line: 'Toddler Thursday today — {{OfferPrice}} each with code {{PromoCode}}',
        preheader_text: 'Book online {{BookingWindow}}. Bring 2+ toddlers for the discount.',
        content_blocks: TODDLER_THURSDAY_TEMPLATE_BLOCKS
      };
    });
  }, [isAutomationMode, isEditing, requestedAutomationSource]);

  useEffect(() => {
    if (isAutomationMode && businessId && canViewCampaigns) {
      loadAutomation();
    }
  }, [isAutomationMode, requestedAutomationId, campaignId, businessId, canViewCampaigns, requestedAutomationSource]);

  useEffect(() => {
    if (businessId && canViewCampaigns) {
      loadSegments();
    }
  }, [businessId, canViewCampaigns]);

  useEffect(() => {
    if (!businessId || automationConfig.trigger_source !== 'waiver_check_in_review') {
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('reputation_settings')
        .select('waiver_check_in_review_delay_minutes')
        .eq('business_id', businessId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('[CampaignBuilder] waiver check-in delay load failed', error);
        return;
      }
      const mm = data?.waiver_check_in_review_delay_minutes;
      setWaiverCheckInDelayHours(mm != null ? Number(mm) / 60 : 2);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, automationConfig.trigger_source]);

  useEffect(() => {
    const loadBrandingLogo = async () => {
      if (!businessId) {
        setBrandingLogoUrl('');
        return;
      }

      try {
        const { data, error } = await supabase
          .from('app_branding')
          .select('logo_url')
          .eq('business_id', businessId)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        setBrandingLogoUrl(String(data?.logo_url || '').trim());
      } catch (error) {
        console.error('Error loading branding logo:', error);
        setBrandingLogoUrl('');
      }
    };

    loadBrandingLogo();
  }, [businessId]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadCampaign = async () => {
    // Permission check
    if (!canViewCampaigns) {
      toast.error('You do not have permission to view campaigns');
      return;
    }

    // Rate limiting
    if (!checkRateLimit('load_campaign', 10, 60000)) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    try {
      await logSecurityEvent('campaign_access', {
        action: 'load_campaign',
        campaign_id: campaignId,
        business_id: businessId,
        user_id: authUser?.id
      }, 'low');

      const { data, error } = await supabase
        .from('mail_campaigns')
        .select('*')
        .eq('id', campaignId)
        .eq('business_id', businessId)
        .single();

      if (error) throw error;

      setCampaign({
        name: data.name || '',
        subject_line: data.subject_line || '',
        preheader_text: data.preheader_text || '',
        content_blocks: data.content_json || [],
        target_segment: data.target_segment || null,
        status: data.status || 'draft'
      });

      await recordAction('campaign_loaded', true, campaignId);
    } catch (error) {
      console.error('Error loading campaign:', error);
      setMessage('Error loading campaign');
      await recordAction('campaign_loaded', false, campaignId);
    }
  };

  const handleInputChange = (field, value) => {
    setCampaign(prev => ({
      ...prev,
      [field]: value
    }));
    setMessage('');
  };

  const handleAutomationChange = (field, value) => {
    if (field === 'is_enabled') {
      automationIsEnabledTouchedRef.current = true;
    }
    setAutomationConfig((prev) => {
      if (field === 'trigger_source' && value === 'waiver_check_in_review') {
        const defaults = getAutomationDefaults('custom', value);
        return {
          ...prev,
          automation_type: 'custom',
          trigger_source: value,
          trigger_timing: defaults.trigger_timing,
          days_offset: defaults.days_offset,
          name: prev.name || defaults.name
        };
      }

      if (field === 'trigger_source' && value === 'toddler_thursday') {
        const defaults = getAutomationDefaults('custom', value);
        return {
          ...prev,
          ...defaults,
          automation_type: 'custom',
          trigger_source: value,
          name: prev.name || defaults.name
        };
      }

      if (field === 'automation_type') {
        const defaults = getAutomationDefaults(value);
        return {
          ...prev,
          automation_type: value,
          trigger_source: value === 'custom' ? prev.trigger_source || 'custom_rules' : '',
          apply_max_child_age_rule: defaults.apply_max_child_age_rule === true,
          trigger_timing: defaults.trigger_timing,
          days_offset: defaults.days_offset
        };
      }

      return {
        ...prev,
        [field]: value
      };
    });
    setMessage('');
  };

  const loadAutomation = async () => {
    setAutomationLoading(true);
    try {
      let query = supabase
        .from('mail_automations')
        .select('*')
        .eq('business_id', businessId);

      if (requestedAutomationId) {
        query = query.eq('id', requestedAutomationId);
      } else if (campaignId) {
        query = query.eq('campaign_id', campaignId);
      } else {
        setAutomationConfig(getAutomationDefaults(requestedAutomationType));
        return;
      }

      const { data, error } = await query.maybeSingle();
      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        automationIsEnabledTouchedRef.current = false;
        const criteria = data.criteria && typeof data.criteria === 'object' ? data.criteria : {};
        setAutomationConfig({
          id: data.id,
          name: data.name || getAutomationDefaults(data.automation_type).name,
          automation_type: data.automation_type || requestedAutomationType,
          trigger_source: criteria.source || (data.automation_type === 'custom' ? 'custom_rules' : ''),
          apply_max_child_age_rule: criteria.apply_max_child_age_rule === true,
          is_enabled: data.is_enabled === true,
          status: data.status || 'draft',
          trigger_timing: data.trigger_timing || 'event_day',
          days_offset: Number.isFinite(Number(data.days_offset)) ? Number(data.days_offset) : 0,
          send_start_hour: Number.isFinite(Number(criteria.send_window?.start_hour)) ? Number(criteria.send_window.start_hour) : 7,
          send_end_hour: Number.isFinite(Number(criteria.send_window?.end_hour)) ? Number(criteria.send_window.end_hour) : 19,
          send_minute_offset: Number.isFinite(Number(criteria.send_window?.minute_offset)) ? Number(criteria.send_window.minute_offset) : 0,
          promo_anchor_date: String(criteria.promo_anchor_date || getDefaultPromoAnchorDate()).slice(0, 10),
          toddler_min_age_years: Number.isFinite(Number(criteria.toddler_min_age_years))
            ? Number(criteria.toddler_min_age_years)
            : 1,
          toddler_max_age_years: Number.isFinite(Number(criteria.toddler_max_age_years))
            ? Number(criteria.toddler_max_age_years)
            : 3,
          offer_price_label: String(criteria.offer_price_label || '$7'),
          promo_code: String(criteria.promo_code || 'DCT2026'),
          min_toddler_count_for_offer: Number.isFinite(Number(criteria.min_toddler_count_for_offer))
            ? Number(criteria.min_toddler_count_for_offer)
            : 2,
          booking_window_label: String(criteria.booking_window_label || '10:00 AM – 1:00 PM')
        });
      } else {
        setAutomationConfig(getAutomationDefaults(requestedAutomationType, requestedAutomationSource));
      }
    } catch (error) {
      console.error('Error loading automation:', error);
      setMessage(`Error loading automation settings: ${error.message}`);
    } finally {
      setAutomationLoading(false);
    }
  };

  const buildAutomationCriteria = () => {
    const rawSendStartHour = Number(automationConfig.send_start_hour);
    const rawSendEndHour = Number(automationConfig.send_end_hour);
    const rawSendMinuteOffset = Number(automationConfig.send_minute_offset);
    const sendStartHour = Math.min(23, Math.max(0, Number.isFinite(rawSendStartHour) ? rawSendStartHour : 7));
    const sendEndHour = Math.min(23, Math.max(sendStartHour, Number.isFinite(rawSendEndHour) ? rawSendEndHour : 19));
    const sendMinuteOffset = Math.min(59, Math.max(0, Number.isFinite(rawSendMinuteOffset) ? rawSendMinuteOffset : 0));
    const baseCriteria = {
      target_segment: campaign.target_segment || null,
      personalization_signals: ['recipient_name', 'loyalty_points'],
      apply_max_child_age_rule: automationConfig.apply_max_child_age_rule === true,
      send_window: {
        start_hour: sendStartHour,
        end_hour: sendEndHour,
        minute_offset: sendMinuteOffset,
      },
    };

    switch (automationConfig.automation_type) {
      case 'birthday':
        return {
          ...baseCriteria,
          source: 'minor_dob',
          recipient: 'parent_guardian_email',
          requires_marketing_consent: true,
        };
      case 'day-camp':
        return {
          ...baseCriteria,
          source: 'booking_history',
          booking_category: 'day_camp',
          requires_marketing_consent: true,
        };
      case 'summer-camp':
        return {
          ...baseCriteria,
          source: 'booking_history_and_age',
          booking_category: 'summer_camp',
          requires_marketing_consent: true,
        };
      case 'we-miss-you':
        return {
          ...baseCriteria,
          source: 'booking_inactivity',
          inactivity_days: Math.max(Number(automationConfig.days_offset) || 0, 30),
          requires_marketing_consent: true,
        };
      default:
        if (automationConfig.trigger_source === 'waiver_check_in_review') {
          return {
            ...baseCriteria,
            source: 'waiver_check_in_review',
            trigger_table: 'waiver_participant_check_ins',
            recipient: 'waiver_signer_or_checked_in_adult_email',
            review_link_token: '{{ReviewLink}}',
            checked_in_name_token: '{{CheckedInName}}',
            email_type: 'transactional',
            requires_marketing_consent: false,
          };
        }

        if (automationConfig.trigger_source === 'name_of_day') {
          return {
            ...baseCriteria,
            source: 'name_of_day',
            trigger_table: 'mail_name_of_day_picks',
            recipient: 'waiver_guardian_mail_contact',
            requires_marketing_consent: true,
          };
        }

        if (automationConfig.trigger_source === 'toddler_thursday') {
          return {
            ...baseCriteria,
            source: 'toddler_thursday',
            promo_anchor_date: String(automationConfig.promo_anchor_date || getDefaultPromoAnchorDate()).slice(0, 10),
            toddler_min_age_years: Math.max(1, Number(automationConfig.toddler_min_age_years) || 1),
            toddler_max_age_years: Math.max(
              Math.max(1, Number(automationConfig.toddler_min_age_years) || 1),
              Number(automationConfig.toddler_max_age_years) || 3
            ),
            send_day_of_week: 4,
            offer_price_label: String(automationConfig.offer_price_label || '$7').trim() || '$7',
            promo_code: String(automationConfig.promo_code || 'DCT2026').trim() || 'DCT2026',
            min_toddler_count_for_offer: Math.max(2, Number(automationConfig.min_toddler_count_for_offer) || 2),
            booking_window_label:
              String(automationConfig.booking_window_label || '10:00 AM – 1:00 PM').trim() || '10:00 AM – 1:00 PM',
            recipient: 'waiver_guardian_mail_contact',
            requires_marketing_consent: true,
          };
        }

        return {
          ...baseCriteria,
          source: 'custom_rules',
          requires_marketing_consent: true,
        };
    }
  };

  const buildAutomationPersonalization = () => ({
    include_loyalty_points: true,
    include_recipient_first_name: true,
    include_review_link: automationConfig.trigger_source === 'waiver_check_in_review',
    include_checked_in_name: automationConfig.trigger_source === 'waiver_check_in_review',
    include_minor_first_name: ['birthday', 'day-camp', 'summer-camp'].includes(automationConfig.automation_type) ||
      automationConfig.trigger_source === 'name_of_day',
  });

  const loadSegments = async () => {
    try {
      const { data, error } = await supabase
        .from('mail_contact_segments')
        .select(`
          id,
          name,
          color,
          memberships:mail_contact_segment_memberships(contact_id)
        `)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      setSegments(
        (data || []).map((segment) => ({
          ...segment,
          contact_count: Array.isArray(segment.memberships) ? segment.memberships.length : 0
        }))
      );
      setSegmentCountError('');
    } catch (error) {
      console.error('Error loading segments:', error);
      setSegmentCountError('Could not load saved send lists.');
      setSegments([]);
    }
  };

  // FIXED: Updated validation - no manual unsubscribe check
  const validateCampaign = () => {
    const errors = [];

    if (!campaign.name.trim()) {
      errors.push('Campaign name is required');
    }

    if (!campaign.subject_line.trim()) {
      errors.push('Subject line is required');
    }

    if (campaign.content_blocks.length === 0) {
      errors.push('Campaign must have at least one content block');
    }

    // REMOVED: Manual unsubscribe link check - system auto-injects compliant footers

    return errors;
  };

  // FIXED: Color conversion helper to prevent console errors
  const convertColorToHex = (color) => {
    const colorMap = {
      'teal': '#008080',
      'white': '#ffffff',
      'black': '#000000',
      'red': '#ff0000',
      'blue': '#0000ff',
      'green': '#008000',
      'yellow': '#ffff00',
      'orange': '#ffa500',
      'purple': '#800080',
      'pink': '#ffc0cb',
      'gray': '#808080',
      'grey': '#808080'
    };

    if (color.startsWith('#')) {
      return color;
    }
    
    return colorMap[color.toLowerCase()] || color;
  };

  // Block type definitions
  const blockTypes = [
    { type: 'text', icon: FiType, label: 'Text Block', description: 'Add formatted text content' },
    { type: 'heading', icon: FiType, label: 'Heading', description: 'Add a heading or title' },
    { type: 'button', icon: FiLink, label: 'Button', description: 'Add a call-to-action button' },
    { type: 'image', icon: FiImage, label: 'Image', description: 'Add an image' },
    { type: 'divider', icon: FiMinus, label: 'Divider', description: 'Add a visual separator' },
    { type: 'social', icon: FiShare2, label: 'Social Links', description: 'Add social media buttons' },
    { type: 'spacer', icon: FiSettings, label: 'Spacer', description: 'Add vertical spacing' },
    { type: 'columns', icon: FiCopy, label: 'Two Columns', description: 'Side-by-side content' }
  ];

  // Add block functions
  const addBlock = (blockType) => {
    // Permission check
    if (!canCreateCampaigns && !canEditCampaigns) {
      toast.error('You do not have permission to add content blocks');
      return;
    }

    const newBlock = createBlockTemplate(blockType);
    setCampaign(prev => ({
      ...prev,
      content_blocks: [...prev.content_blocks, newBlock]
    }));
  };

  const createBlockTemplate = (type) => {
    const baseBlock = {
      id: Date.now().toString(),
      type: type,
      settings: {}
    };

    switch (type) {
      case 'text':
        return {
          ...baseBlock,
          content: 'Enter your text content here...',
          settings: {
            fontSize: '14px',
            color: '#333333',
            textAlign: 'left',
            lineHeight: '1.6',
            linkUrl: ''
          }
        };

      case 'heading':
        return {
          ...baseBlock,
          content: 'Your Heading Here',
          settings: {
            level: 'h2',
            fontSize: '28px',
            color: '#333333',
            textAlign: 'left',
            fontWeight: 'bold',
            linkUrl: ''
          }
        };

      case 'button':
        return {
          ...baseBlock,
          content: {
            buttons: [
              { text: 'Click Here', url: 'https://' }
            ]
          },
          settings: {
            backgroundColor: '#008080',
            color: '#ffffff',
            textAlign: 'center',
            padding: '12px 24px',
            borderRadius: '6px',
            layout: 'single'
          }
        };

      case 'image':
        return {
          ...baseBlock,
          content: {
            src: '',
            alt: '',
            url: '',
            width: '100%',
            alignment: 'center'
          },
          settings: {
            borderRadius: '0px',
            margin: '20px 0'
          }
        };

      case 'divider':
        return {
          ...baseBlock,
          content: {
            style: 'solid',
            color: '#dddddd',
            width: '100%'
          },
          settings: {
            margin: '20px auto'
          }
        };

      case 'social':
        return {
          ...baseBlock,
          content: {
            platforms: [
              { name: 'facebook', enabled: false, url: '' },
              { name: 'twitter', enabled: false, url: '' },
              { name: 'instagram', enabled: false, url: '' },
              { name: 'linkedin', enabled: false, url: '' },
              { name: 'youtube', enabled: false, url: '' },
              { name: 'website', enabled: false, url: '' }
            ]
          },
          settings: {
            size: '32px',
            spacing: '10px',
            alignment: 'center'
          }
        };

      case 'spacer':
        return {
          ...baseBlock,
          content: {
            height: '20px'
          },
          settings: {
            backgroundColor: 'transparent'
          }
        };

      case 'columns':
        return {
          ...baseBlock,
          content: {
            column1: 'Left column content...',
            column2: 'Right column content...'
          },
          settings: {
            gap: '20px',
            mobileStack: true
          }
        };

      default:
        return baseBlock;
    }
  };

  // Block management functions
  const updateBlock = (blockId, updates) => {
    // Permission check
    if (!canEditCampaigns) {
      toast.error('You do not have permission to edit campaign content');
      return;
    }

    setCampaign(prev => ({
      ...prev,
      content_blocks: prev.content_blocks.map(block =>
        block.id === blockId ? { ...block, ...updates } : block
      )
    }));
  };

  const removeBlock = (blockId) => {
    // Permission check
    if (!canEditCampaigns) {
      toast.error('You do not have permission to remove content blocks');
      return;
    }

    setCampaign(prev => ({
      ...prev,
      content_blocks: prev.content_blocks.filter(block => block.id !== blockId)
    }));
  };

  const duplicateBlock = (blockId) => {
    // Permission check
    if (!canEditCampaigns) {
      toast.error('You do not have permission to duplicate content blocks');
      return;
    }

    const blockToDupe = campaign.content_blocks.find(block => block.id === blockId);
    if (blockToDupe) {
      const duplicated = {
        ...blockToDupe,
        id: Date.now().toString()
      };
      const blockIndex = campaign.content_blocks.findIndex(block => block.id === blockId);
      const newBlocks = [...campaign.content_blocks];
      newBlocks.splice(blockIndex + 1, 0, duplicated);
      setCampaign(prev => ({ ...prev, content_blocks: newBlocks }));
    }
  };

  const moveBlock = (blockId, direction) => {
    // Permission check
    if (!canEditCampaigns) {
      toast.error('You do not have permission to reorder content blocks');
      return;
    }

    const blocks = [...campaign.content_blocks];
    const currentIndex = blocks.findIndex(block => block.id === blockId);
    
    if (direction === 'up' && currentIndex > 0) {
      [blocks[currentIndex], blocks[currentIndex - 1]] = [blocks[currentIndex - 1], blocks[currentIndex]];
    } else if (direction === 'down' && currentIndex < blocks.length - 1) {
      [blocks[currentIndex], blocks[currentIndex + 1]] = [blocks[currentIndex + 1], blocks[currentIndex]];
    }

    setCampaign(prev => ({ ...prev, content_blocks: blocks }));
  };

  // Image upload function
  const uploadImage = async (file, blockId) => {
    // Permission check
    if (!canUploadImages) {
      toast.error('You do not have permission to upload images');
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB.');
      return;
    }

    // Rate limiting
    if (!checkRateLimit('upload_image', 5, 60000)) {
      toast.error('Too many uploads. Please wait a moment.');
      return;
    }

    setUploadingImage(true);
    try {
      await logSecurityEvent('image_upload', {
        action: 'upload_campaign_image',
        file_name: file.name,
        file_size: file.size,
        business_id: businessId,
        user_id: authUser?.id
      }, 'low');

      const fileExt = file.name.split('.').pop();
      const fileName = `${businessId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('email-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('email-images')
        .getPublicUrl(fileName);

      updateBlock(blockId, {
        content: {
          ...campaign.content_blocks.find(b => b.id === blockId).content,
          src: urlData.publicUrl,
          alt: file.name
        }
      });

      toast.success('Image uploaded successfully');
      await recordAction('image_uploaded', true, fileName);
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Error uploading image: ' + error.message);
      await recordAction('image_uploaded', false, file.name);
    } finally {
      setUploadingImage(false);
    }
  };

  // FIXED: Email HTML generation with proper color handling
  const generateEmailHTML = () => {
    const businessName = businessData?.name || '';
    const businessHeader = (brandingLogoUrl || businessName)
      ? `
          <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
              <tr>
                ${
                  brandingLogoUrl
                    ? `<td style="width: 96px; vertical-align: middle; text-align: left;">
                        <img src="${brandingLogoUrl}" alt="${businessName || 'Business logo'}" style="max-width: 80px; max-height: 80px; width: auto; height: auto; display: block;" />
                      </td>`
                    : ''
                }
                <td style="vertical-align: middle; text-align: left;">
                  <div style="font-size: 14px; font-weight: 700; line-height: 1.2; color: #111827;">
                    ${businessName || '{BusinessName}'}
                  </div>
                </td>
              </tr>
            </table>
          </div>
        `
      : '';

    const blockHTML = campaign.content_blocks.map(block => {
      switch (block.type) {
        case 'text':
          const textColor = convertColorToHex(block.settings.color);
          const formattedTextContent = preserveLineBreaks(block.content);
          const textContent = block.settings.linkUrl ? 
            `<a href="${block.settings.linkUrl}" style="color: inherit; text-decoration: underline;">${formattedTextContent}</a>` : 
            formattedTextContent;
          return `
            <p style="font-size: ${block.settings.fontSize}; color: ${textColor}; text-align: ${block.settings.textAlign}; line-height: ${block.settings.lineHeight}; margin: 15px 0;">
              ${textContent}
            </p>
          `;

        case 'heading':
          const headingColor = convertColorToHex(block.settings.color);
          const headingContent = block.settings.linkUrl ? 
            `<a href="${block.settings.linkUrl}" style="color: inherit; text-decoration: none;">${block.content}</a>` : 
            block.content;
          return `
            <${block.settings.level} style="font-size: ${block.settings.fontSize}; color: ${headingColor}; text-align: ${block.settings.textAlign}; font-weight: ${block.settings.fontWeight}; margin: 20px 0 10px 0;">
              ${headingContent}
            </${block.settings.level}>
          `;

        case 'button':
          const buttonBgColor = convertColorToHex(block.settings.backgroundColor);
          const buttonTextColor = convertColorToHex(block.settings.color);
          const buttonAlign = block.settings.textAlign || 'center';
          const tableMargin =
            buttonAlign === 'center'
              ? '12px auto'
              : buttonAlign === 'right'
                ? '12px 0 12px auto'
                : '12px auto 12px 0';
          const buttonElements = block.content.buttons.map(button =>
            `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:${tableMargin};max-width:100%;"><tr><td align="center" bgcolor="${buttonBgColor}" style="border-radius:${block.settings.borderRadius};">
              <a href="${button.url}" target="_blank" rel="noopener noreferrer" style="background-color:${buttonBgColor};color:${buttonTextColor};padding:${block.settings.padding};border-radius:${block.settings.borderRadius};text-decoration:none;display:inline-block;font-weight:bold;font-family:Arial,Helvetica,sans-serif;line-height:1.25;border:1px solid ${buttonBgColor};mso-padding-alt:${block.settings.padding};">${button.text}</a>
            </td></tr></table>`
          ).join('');
          return `
            <div style="text-align: ${buttonAlign}; margin: 20px 0;">
              ${buttonElements}
            </div>
          `;

        case 'image':
          const imageMargin =
            block.content.alignment === 'center'
              ? '0 auto'
              : block.content.alignment === 'right'
                ? '0 0 0 auto'
                : '0 auto 0 0';
          const imageHtml = `<img src="${block.content.src}" alt="${block.content.alt}" style="max-width: ${block.content.width}; width: ${block.content.width}; height: auto; border-radius: ${block.settings.borderRadius}; display: block; margin: ${imageMargin};" />`;
          const imageContent = block.content.url ? `<a href="${block.content.url}">${imageHtml}</a>` : imageHtml;
          return `
            <div style="text-align: ${block.content.alignment}; margin: ${block.settings.margin};">
              ${imageContent}
            </div>
          `;

        case 'divider':
          const dividerColor = convertColorToHex(block.content.color);
          return `
            <hr style="border: none; border-top: 1px ${block.content.style} ${dividerColor}; width: ${block.content.width}; margin: ${block.settings.margin};" />
          `;

        case 'spacer':
          return `
            <div style="height: ${block.content.height}; background-color: ${block.settings.backgroundColor}; font-size: 14px; line-height: 1px;">&nbsp;</div>
          `;

        case 'social':
          const socialButtons = block.content.platforms
            .filter(platform => platform.enabled && platform.url)
            .map(platform => {
              const socialIcons = {
                facebook: '📘', twitter: '🦆', instagram: '📷',
                linkedin: '💼', youtube: '📺', website: '🌐'
              };
              return `
                <a href="${platform.url}" style="display: inline-block; margin: 0 ${parseInt(block.settings.spacing)/2}px; text-decoration: none; font-size: ${block.settings.size};" title="Visit our ${platform.name}">
                  ${socialIcons[platform.name] || '🔗'}
                </a>
              `;
            }).join('');
          return `
            <div style="text-align: ${block.settings.alignment}; margin: 20px 0;">
              ${socialButtons}
            </div>
          `;

        case 'columns':
          return `
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="width: 50%; padding-right: ${parseInt(block.settings.gap)/2}px; vertical-align: top;">
                  ${block.content.column1 || 'Left column content...'}
                </td>
                <td style="width: 50%; padding-left: ${parseInt(block.settings.gap)/2}px; vertical-align: top;">
                  ${block.content.column2 || 'Right column content...'}
                </td>
              </tr>
            </table>
          `;

        default:
          return '';
      }
    }).join('');

    const hiddenPreheader = campaign.preheader_text
      ? `
          <div style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size: 14px; line-height:1px; max-height:0; max-width:0;">
            ${campaign.preheader_text}
          </div>
        `
      : '';

    return `
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f8f8f8;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px;">
            ${hiddenPreheader}
            ${businessHeader}
            ${blockHTML}
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 18px; color: #999; text-align: center;">
              <p style="margin: 0 0 10px 0;">You received this email because you subscribed to our mailing list.</p>
              <p style="margin: 0 0 10px 0;"><strong>{BusinessName}</strong><br>{BusinessAddress}</p>
              <p style="margin: 0;"><a href="{UnsubscribeLink}" style="color: #999; text-decoration: underline;">Unsubscribe</a> | <a href="{UpdatePreferencesLink}" style="color: #999; text-decoration: underline;">Update Preferences</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const handleSave = async () => {
    // Permission check
    if (isEditing && !canEditCampaigns) {
      toast.error('You do not have permission to edit campaigns');
      return { success: false, error: 'You do not have permission to edit campaigns' };
    }

    if (!isEditing && !canCreateCampaigns) {
      toast.error('You do not have permission to create campaigns');
      return { success: false, error: 'You do not have permission to create campaigns' };
    }

    if (!businessId) {
      setMessage('No business selected');
      return { success: false, error: 'No business selected' };
    }

    // Rate limiting
    if (!checkRateLimit('save_campaign', 10, 60000)) {
      toast.error('Too many save requests. Please wait a moment.');
      return { success: false, error: 'Too many save requests. Please wait a moment.' };
    }

    setSaving(true);
    try {
      setMessage('');

      await logSecurityEvent('campaign_save', {
        action: isEditing ? 'update_campaign' : 'create_campaign',
        campaign_id: campaignId,
        campaign_name: campaign.name,
        business_id: businessId,
        user_id: authUser?.id
      }, 'medium');

      const campaignData = {
        business_id: businessId,
        name: campaign.name.trim(),
        subject_line: campaign.subject_line.trim(),
        preheader_text: campaign.preheader_text.trim(),
        content_json: campaign.content_blocks,
        content_html: generateEmailHTML(),
        target_segment: campaign.target_segment || null,
        status: campaign.status,
        updated_at: new Date().toISOString()
      };

      let result;
      if (isEditing) {
        result = await supabase
          .from('mail_campaigns')
          .update(campaignData)
          .eq('id', campaignId)
          .select()
          .single();
      } else {
        campaignData.created_by = authUser?.id;
        result = await supabase
          .from('mail_campaigns')
          .insert(campaignData)
          .select()
          .single();
      }

      if (result.error) throw result.error;

      let savedAutomationId = requestedAutomationId;
      const savedCampaignId = result.data?.id || campaignId;

      if (isAutomationMode) {
        const automationName = automationConfig.name.trim();
        if (!automationName) {
          throw new Error('Automation name is required');
        }

        const automationPayload = {
          business_id: businessId,
          campaign_id: savedCampaignId,
          name: automationName,
          automation_type: automationConfig.automation_type,
          status: automationConfig.status,
          trigger_timing: automationConfig.trigger_timing,
          days_offset:
            automationConfig.trigger_source === 'waiver_check_in_review'
              ? 0
              : Number(automationConfig.days_offset) || 0,
          criteria: buildAutomationCriteria(),
          personalization: buildAutomationPersonalization(),
          updated_at: new Date().toISOString(),
          last_saved_by: authUser?.id || null,
        };
        const isUpdate = Boolean(automationConfig.id);
        if (!isUpdate || automationIsEnabledTouchedRef.current) {
          automationPayload.is_enabled = automationConfig.is_enabled === true;
        }

        let automationResult;
        if (automationConfig.id) {
          automationResult = await supabase
            .from('mail_automations')
            .update(automationPayload)
            .eq('id', automationConfig.id)
            .select()
            .single();
        } else {
          automationPayload.created_by = authUser?.id || null;
          automationResult = await supabase
            .from('mail_automations')
            .insert(automationPayload)
            .select()
            .single();
        }

        if (automationResult.error) throw automationResult.error;

        savedAutomationId = automationResult.data?.id || savedAutomationId;
        setAutomationConfig((prev) => ({
          ...prev,
          id: savedAutomationId
        }));

        if (automationConfig.trigger_source === 'waiver_check_in_review') {
          const waiverMinutes = Math.max(
            0,
            Math.min(10080, Math.round(Number(waiverCheckInDelayHours) * 60)),
          );
          setWaiverCheckInDelayHours(waiverMinutes / 60);
          const { error: waiverRepError } = await supabase.from('reputation_settings').upsert(
            {
              business_id: businessId,
              waiver_check_in_review_delay_minutes: waiverMinutes,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'business_id' },
          );
          if (waiverRepError) throw waiverRepError;
        }

        setMessage('Automation saved successfully');
        toast.success('Automation saved successfully');
      } else {
        setMessage('Campaign saved successfully');
        toast.success('Campaign saved successfully');
      }

      if (!isEditing && result.data) {
        if (isAutomationMode) {
          const sourceParam = automationConfig.trigger_source ? `&automationSource=${encodeURIComponent(automationConfig.trigger_source)}` : '';
          navigate(`/dashboard/mail/builder/${result.data.id}?mode=automation&automationType=${encodeURIComponent(automationConfig.automation_type)}${sourceParam}${savedAutomationId ? `&automationId=${encodeURIComponent(savedAutomationId)}` : ''}`);
        } else {
          navigate(`/dashboard/mail/builder/${result.data.id}`);
        }
      } else if (isAutomationMode && savedCampaignId) {
        const sourceParam = automationConfig.trigger_source ? `&automationSource=${encodeURIComponent(automationConfig.trigger_source)}` : '';
        navigate(`/dashboard/mail/builder/${savedCampaignId}?mode=automation&automationType=${encodeURIComponent(automationConfig.automation_type)}${sourceParam}${savedAutomationId ? `&automationId=${encodeURIComponent(savedAutomationId)}` : ''}`, { replace: true });
      }

      await recordAction('campaign_saved', true, result.data?.id);
      return { success: true, campaignId: savedCampaignId, automationId: savedAutomationId };
    } catch (error) {
      console.error('Error saving campaign:', error);
      setMessage('Error saving campaign: ' + error.message);
      toast.error('Error saving campaign');
      await recordAction('campaign_saved', false, campaignId);
      return { success: false, error: error.message };
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    // Permission check
    if (!canSendCampaigns) {
      toast.error('You do not have permission to send campaigns');
      return;
    }

    // Block sending if paused
    if (blockEmailSendIfPaused('Campaign sending')) return;

    const errors = validateCampaign();
    if (errors.length > 0) {
      setMessage('Please fix these issues before sending:\n• ' + errors.join('\n• '));
      return;
    }

    // Save the campaign first if it has changes
    const saveResult = await handleSave();
    if (!saveResult?.success) {
      setMessage(saveResult?.error || 'Please save the campaign successfully before sending.');
      return;
    }
  
    // Navigate to the campaign sender
    const resolvedCampaignId = isEditing ? campaignId : saveResult?.campaignId;
    if (resolvedCampaignId) {
      await logSecurityEvent('campaign_send_initiated', {
        action: 'navigate_to_sender',
        campaign_id: resolvedCampaignId,
        business_id: businessId,
        user_id: authUser?.id
      }, 'high');
      navigate(`/dashboard/mail/sender/${resolvedCampaignId}`);
    } else {
      setMessage('Please save the campaign first');
    }
  };

  const handleOpenTestModal = () => {
    if (!canSendCampaigns) {
      toast.error('You do not have permission to send test emails');
      return;
    }

    if (!campaignId) {
      toast.error('Save the campaign before sending a test email.');
      return;
    }

    setShowTestModal(true);
  };

  const handleCloseTestModal = () => {
    if (sendingTest) return;
    setShowTestModal(false);
    setTestEmail('');
  };

  const handleOpenScheduler = () => {
    if (!canSendCampaigns) {
      toast.error('You do not have permission to schedule campaigns');
      return;
    }

    if (!campaignId) {
      toast.error('Save the campaign before scheduling it.');
      return;
    }

    const errors = validateCampaign();
    if (errors.length > 0) {
      setMessage('Please fix these issues before scheduling:\n• ' + errors.join('\n• '));
      return;
    }

    setShowScheduler(true);
  };

  const handleScheduleCampaign = async (scheduleData) => {
    if (!businessId || !campaignId) {
      toast.error('Save the campaign before scheduling it.');
      return;
    }

    const result = await CampaignSchedulerService.scheduleCampaign(campaignId, scheduleData, businessId);

    if (!result.success) {
      toast.error(result.message || result.error || 'Failed to schedule campaign');
      return;
    }

    setCampaign(prev => ({
      ...prev,
      status: result.status || (scheduleData.type === 'send_now' ? 'sent' : 'scheduled')
    }));
    setMessage(result.message || 'Campaign scheduled successfully');
    toast.success(result.message || 'Campaign scheduled successfully');
  };

  const handleSendTestEmail = async () => {
    if (!canSendCampaigns) {
      toast.error('You do not have permission to send test emails');
      return;
    }

    if (!campaignId) {
      toast.error('Save the campaign before sending a test email.');
      return;
    }

    if (!businessId) {
      toast.error('No business selected. Please refresh and try again.');
      return;
    }

    const emailToSend = testEmail.trim();
    if (!emailToSend) {
      toast.error('Enter an email address to send your test campaign.');
      return;
    }

    const validation = await validateInput(emailToSend, 'email', 'campaign_test_email');
    if (!validation.valid) {
      toast.error(validation.error || 'Invalid email address');
      return;
    }

    if (blockEmailSendIfPaused('Test email sending')) return;

    if (!checkRateLimit('send_test_email', 5, 60000)) {
      toast.error('Too many test email requests. Please wait a moment.');
      return;
    }

    if (!isSafeRecipient(emailToSend) && !isMailboxSimulator(emailToSend)) {
      toast.error('That looks like a test/invalid email. Use the Amazon SES mailbox simulator for testing.');
      return;
    }

    setSendingTest(true);
    try {
      await logSecurityEvent('builder_test_email_send', {
        action: 'send_test_email',
        campaign_id: campaignId,
        campaign_name: campaign.name,
        test_email: emailToSend,
        business_id: businessId,
        user_id: authUser?.id
      }, 'medium');

      const testContact = {
        id: 'test-contact',
        email: emailToSend,
        first_name: 'Test',
        last_name: 'User',
        subscribed: true
      };

      const testCampaignPayload = {
        ...campaign,
        id: campaignId,
        business_id: businessId,
        content_html: generateEmailHTML()
      };

      const queueItem = {
        campaign_id: campaignId,
        contact_id: testContact.id,
        email_address: testContact.email,
        campaign: testCampaignPayload,
        contact: testContact,
        business_id: businessId,
        emailType: 'transactional'
      };

      const result = await emailSendingService.sendSingleEmail(queueItem);

      if (result.success) {
        toast.success(`Test email sent successfully to ${emailToSend}!`);
        setTestEmail('');
        setShowTestModal(false);
        await recordAction('test_email_sent', true, emailToSend);
      } else {
        toast.error(`Test email failed: ${result.error}`);
        await recordAction('test_email_sent', false, emailToSend);
      }
    } catch (error) {
      console.error('Test email error:', error);
      toast.error(`Test email failed: ${error.message}`);
      await recordAction('test_email_sent', false, emailToSend);
    } finally {
      setSendingTest(false);
    }
  };

  // Render block editor
  const renderBlockEditor = (block) => {
    switch (block.type) {
      case 'text':
        return (
          <div style={styles.blockEditorContent}>
            <textarea
              style={styles.blockTextarea}
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              placeholder="Enter your text content..."
              rows={4}
            />
            <div style={styles.controlsRow}>
              <div style={styles.alignmentButtons}>
                {['left', 'center', 'right'].map(align => (
                  <button
                    key={align}
                    style={{
                      ...styles.alignmentButton,
                      ...(block.settings.textAlign === align ? styles.activeAlignment : {})
                    }}
                    onClick={() => updateBlock(block.id, {
                      settings: { ...block.settings, textAlign: align }
                    })}
                  >
                    {align === 'left' && <FiAlignLeft />}
                    {align === 'center' && <FiAlignCenter />}
                    {align === 'right' && <FiAlignRight />}
                  </button>
                ))}
              </div>
              <input
                type="color"
                style={styles.colorPicker}
                value={convertColorToHex(block.settings.color)}
                onChange={(e) => updateBlock(block.id, {
                  settings: { ...block.settings, color: e.target.value }
                })}
                title="Text Color"
              />
            </div>
            <div style={styles.linkRow}>
              <input
                type="url"
                style={styles.linkInput}
                placeholder="Link URL (optional)"
                value={block.settings.linkUrl || ''}
                onChange={(e) => updateBlock(block.id, {
                  settings: { ...block.settings, linkUrl: e.target.value }
                })}
              />
              {block.settings.linkUrl && (
                <button
                  type="button"
                  style={styles.testLinkButton}
                  onClick={() => window.open(block.settings.linkUrl, '_blank', 'noopener,noreferrer')}
                >
                  <FiLink style={styles.buttonIcon} />
                  Test Link
                </button>
              )}
            </div>
          </div>
        );

      case 'heading':
        return (
          <div style={styles.blockEditorContent}>
            <input
              type="text"
              style={styles.headingInput}
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              placeholder="Enter heading text..."
            />
            <div style={styles.controlsRow}>
              <select
                style={styles.headingLevelSelect}
                value={block.settings.level}
                onChange={(e) => updateBlock(block.id, {
                  settings: { ...block.settings, level: e.target.value }
                })}
              >
                <option value="h1">H1 - Large</option>
                <option value="h2">H2 - Medium</option>
                <option value="h3">H3 - Small</option>
              </select>
              <div style={styles.alignmentButtons}>
                {['left', 'center', 'right'].map(align => (
                  <button
                    key={align}
                    style={{
                      ...styles.alignmentButton,
                      ...(block.settings.textAlign === align ? styles.activeAlignment : {})
                    }}
                    onClick={() => updateBlock(block.id, {
                      settings: { ...block.settings, textAlign: align }
                    })}
                  >
                    {align === 'left' && <FiAlignLeft />}
                    {align === 'center' && <FiAlignCenter />}
                    {align === 'right' && <FiAlignRight />}
                  </button>
                ))}
              </div>
              <input
                type="color"
                style={styles.colorPicker}
                value={convertColorToHex(block.settings.color)}
                onChange={(e) => updateBlock(block.id, {
                  settings: { ...block.settings, color: e.target.value }
                })}
                title="Text Color"
              />
            </div>
            <div style={styles.linkRow}>
              <input
                type="url"
                style={styles.linkInput}
                placeholder="Link URL (optional)"
                value={block.settings.linkUrl || ''}
                onChange={(e) => updateBlock(block.id, {
                  settings: { ...block.settings, linkUrl: e.target.value }
                })}
              />
              {block.settings.linkUrl && (
                <button
                  type="button"
                  style={styles.testLinkButton}
                  onClick={() => window.open(block.settings.linkUrl, '_blank', 'noopener,noreferrer')}
                >
                  <FiLink style={styles.buttonIcon} />
                  Test Link
                </button>
              )}
            </div>
          </div>
        );

      case 'button':
        return (
          <div style={styles.blockEditorContent}>
            {block.content.buttons.map((button, index) => (
              <div key={index} style={styles.buttonRow}>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="Button text"
                  value={button.text}
                  onChange={(e) => {
                    const newButtons = [...block.content.buttons];
                    newButtons[index].text = e.target.value;
                    updateBlock(block.id, {
                      content: { ...block.content, buttons: newButtons }
                    });
                  }}
                />
                <input
                  type="url"
                  style={styles.input}
                  placeholder="Button URL (https://...)"
                  value={button.url}
                  onChange={(e) => {
                    const newButtons = [...block.content.buttons];
                    newButtons[index].url = e.target.value;
                    updateBlock(block.id, {
                      content: { ...block.content, buttons: newButtons }
                    });
                  }}
                />
                {block.content.buttons.length > 1 && (
                  <button
                    style={styles.removeButton}
                    onClick={() => {
                      const newButtons = block.content.buttons.filter((_, i) => i !== index);
                      updateBlock(block.id, {
                        content: { ...block.content, buttons: newButtons }
                      });
                    }}
                  >
                    <FiTrash2 />
                  </button>
                )}
              </div>
            ))}
            <div style={styles.controlsRow}>
              <div style={styles.alignmentButtons}>
                {['left', 'center', 'right'].map(align => (
                  <button
                    key={align}
                    style={{
                      ...styles.alignmentButton,
                      ...(block.settings.textAlign === align ? styles.activeAlignment : {})
                    }}
                    onClick={() => updateBlock(block.id, {
                      settings: { ...block.settings, textAlign: align }
                    })}
                  >
                    {align === 'left' && <FiAlignLeft />}
                    {align === 'center' && <FiAlignCenter />}
                    {align === 'right' && <FiAlignRight />}
                  </button>
                ))}
              </div>
              <input
                type="color"
                style={styles.colorPicker}
                value={convertColorToHex(block.settings.backgroundColor)}
                onChange={(e) => updateBlock(block.id, {
                  settings: { ...block.settings, backgroundColor: e.target.value }
                })}
                title="Background Color"
              />
              <input
                type="color"
                style={styles.colorPicker}
                value={convertColorToHex(block.settings.color)}
                onChange={(e) => updateBlock(block.id, {
                  settings: { ...block.settings, color: e.target.value }
                })}
                title="Text Color"
              />
            </div>
            {block.content.buttons.length < 2 && (
              <button
                style={styles.addButton}
                onClick={() => {
                  const newButtons = [...block.content.buttons, { text: 'Button Text', url: 'https://' }];
                  updateBlock(block.id, {
                    content: { ...block.content, buttons: newButtons }
                  });
                }}
              >
                <FiPlus /> Add Button
              </button>
            )}
          </div>
        );

      case 'image':
        return (
          <div style={styles.blockEditorContent}>
            <div style={styles.imageUploadArea}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) uploadImage(file, block.id);
                }}
                style={styles.fileInput}
                id={`image-${block.id}`}
                disabled={uploadingImage || !canUploadImages}
              />
              <label htmlFor={`image-${block.id}`} style={styles.imageUploadLabel}>
                {uploadingImage ? (
                  <>
                    <FiUpload style={styles.spinningIcon} />
                    Uploading...
                  </>
                ) : (
                  <>
                    <FiImage style={styles.uploadIcon} />
                    {block.content.src ? 'Change Image' : 'Upload Image'}
                  </>
                )}
              </label>
            </div>
            {block.content.src && (
              <div style={styles.imagePreview}>
                <img src={block.content.src} alt={block.content.alt} style={styles.previewImage} />
              </div>
            )}
            <input
              type="text"
              style={styles.input}
              placeholder="Alt text (for accessibility)"
              value={block.content.alt}
              onChange={(e) => updateBlock(block.id, {
                content: { ...block.content, alt: e.target.value }
              })}
            />
            <input
              type="url"
              style={styles.input}
              placeholder="Link URL (optional)"
              value={block.content.url || ''}
              onChange={(e) => updateBlock(block.id, {
                content: { ...block.content, url: e.target.value }
              })}
            />
            <div style={styles.alignmentButtons}>
              {['left', 'center', 'right'].map(align => (
                <button
                  key={align}
                  style={{
                    ...styles.alignmentButton,
                    ...(block.content.alignment === align ? styles.activeAlignment : {})
                  }}
                  onClick={() => updateBlock(block.id, {
                    content: { ...block.content, alignment: align }
                  })}
                >
                  {align === 'left' && <FiAlignLeft />}
                  {align === 'center' && <FiAlignCenter />}
                  {align === 'right' && <FiAlignRight />}
                </button>
              ))}
            </div>
          </div>
        );

      case 'divider':
        return (
          <div style={styles.blockEditorContent}>
            <div style={styles.controlsRow}>
              <select
                style={styles.select}
                value={block.content.style}
                onChange={(e) => updateBlock(block.id, {
                  content: { ...block.content, style: e.target.value }
                })}
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
              <input
                type="color"
                style={styles.colorPicker}
                value={convertColorToHex(block.content.color)}
                onChange={(e) => updateBlock(block.id, {
                  content: { ...block.content, color: e.target.value }
                })}
                title="Divider Color"
              />
            </div>
          </div>
        );

      case 'social':
        return (
          <div style={styles.blockEditorContent}>
            <div style={styles.socialPlatformsGrid}>
              {block.content.platforms.map((platform, index) => (
                <div key={platform.name} style={styles.socialPlatformEditor}>
                  <div style={styles.socialPlatformHeader}>
                    <label style={styles.socialCheckboxLabel}>
                      <input
                        type="checkbox"
                        style={styles.socialCheckbox}
                        checked={platform.enabled}
                        onChange={(e) => {
                          const newPlatforms = [...block.content.platforms];
                          newPlatforms[index].enabled = e.target.checked;
                          updateBlock(block.id, {
                            content: { ...block.content, platforms: newPlatforms }
                          });
                        }}
                      />
                      <span style={styles.socialPlatformName}>
                        {platform.name.charAt(0).toUpperCase() + platform.name.slice(1)}
                      </span>
                    </label>
                  </div>
                  <div style={styles.socialUrlRow}>
                    <input
                      type="url"
                      style={{
                        ...styles.socialUrlInput,
                        opacity: platform.enabled ? 1 : 0.5
                      }}
                      value={platform.url}
                      onChange={(e) => {
                        const newPlatforms = [...block.content.platforms];
                        newPlatforms[index].url = e.target.value;
                        updateBlock(block.id, {
                          content: { ...block.content, platforms: newPlatforms }
                        });
                      }}
                      placeholder={`Your ${platform.name} URL`}
                      disabled={!platform.enabled}
                    />
                    {platform.enabled && platform.url && (
                      <button
                        type="button"
                        style={styles.testSocialButton}
                        onClick={() => window.open(platform.url, '_blank', 'noopener,noreferrer')}
                        title="Test Link"
                      >
                        <FiLink />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={styles.alignmentButtons}>
              <span style={styles.alignmentLabel}>Alignment:</span>
              {['left', 'center', 'right'].map(align => (
                <button
                  key={align}
                  style={{
                    ...styles.alignmentButton,
                    ...(block.settings.alignment === align ? styles.activeAlignment : {})
                  }}
                  onClick={() => updateBlock(block.id, {
                    settings: { ...block.settings, alignment: align }
                  })}
                >
                  {align === 'left' && <FiAlignLeft />}
                  {align === 'center' && <FiAlignCenter />}
                  {align === 'right' && <FiAlignRight />}
                </button>
              ))}
            </div>
          </div>
        );

      case 'columns':
        return (
          <div style={styles.blockEditorContent}>
            <div style={styles.columnsEditor}>
              <div style={styles.columnEditor}>
                <label style={styles.columnLabel}>Left Column</label>
                <textarea
                  style={styles.columnTextarea}
                  value={block.content.column1}
                  onChange={(e) => updateBlock(block.id, {
                    content: { ...block.content, column1: e.target.value }
                  })}
                  placeholder="Left column content..."
                  rows={4}
                />
              </div>
              <div style={styles.columnEditor}>
                <label style={styles.columnLabel}>Right Column</label>
                <textarea
                  style={styles.columnTextarea}
                  value={block.content.column2}
                  onChange={(e) => updateBlock(block.id, {
                    content: { ...block.content, column2: e.target.value }
                  })}
                  placeholder="Right column content..."
                  rows={4}
                />
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div style={styles.blockEditorContent}>
            <p style={styles.placeholderText}>Editor for {block.type} block</p>
          </div>
        );
    }
  };

  if (authLoading || permissionsLoading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailModuleTabs />
          <div style={styles.loadingState}>
            <div style={styles.spinner}></div>
            <p>Loading campaign builder...</p>
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
            <h3>Authentication Error</h3>
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
          {/* Email Pause Banner */}
          <EmailPauseBanner />

          <MailModuleHeader />
          <MailModuleTabs />

          {/* Permission Denied Message */}
          {!canViewCampaigns && (
            <div style={styles.permissionDenied}>
              <FiAlertCircle style={styles.permissionIcon} />
              <h3>Access Denied</h3>
              <p>You do not have permission to access the campaign builder</p>
              <button
                style={styles.backButton}
                onClick={() => navigate('/dashboard/mail/campaigns')}
              >
                <FiArrowLeft />
                Return to Campaigns
              </button>
            </div>
          )}

          {canViewCampaigns && (
            <>
              {/* Header */}
              <div style={styles.header}>
                <div style={styles.headerActions}>
                  {isAutomationMode && (
                    <button
                      style={styles.secondaryButton}
                      onClick={() => navigate('/dashboard/mail/automations')}
                    >
                      <FiArrowLeft />
                      Back to Automations
                    </button>
                  )}
                  <button
                    style={styles.secondaryButton}
                    onClick={() => setPreviewMode(previewMode === 'desktop' ? 'mobile' : 'desktop')}
                  >
                    {previewMode === 'desktop' ? <FiSmartphone /> : <FiMonitor />}
                    {previewMode === 'desktop' ? 'Mobile' : 'Desktop'} Preview
                  </button>
                  <PermissionGate permissions={['mail.campaigns.create']} requireAny>
                    <button
                      style={styles.secondaryButton}
                      onClick={handleSave}
                      disabled={saving}
                    >
                      <FiSave />
                      {saving ? 'Saving...' : isAutomationMode ? 'Save Automation' : 'Save'}
                    </button>
                  </PermissionGate>
                  {!isAutomationMode && (
                    <PermissionGate permission="mail.campaigns.send">
                      <button
                        style={{
                          ...styles.secondaryButton,
                          opacity: campaignId ? 1 : 0.6,
                          cursor: campaignId ? 'pointer' : 'not-allowed'
                        }}
                        onClick={handleOpenScheduler}
                        disabled={!campaignId}
                        title={!campaignId ? 'Save the campaign before scheduling' : 'Schedule this campaign'}
                      >
                        <FiClock />
                        Schedule Campaign
                      </button>
                    </PermissionGate>
                  )}
                  <PermissionGate permission="mail.campaigns.send">
                    <button
                      style={{
                        ...styles.secondaryButton,
                        opacity: campaignId ? 1 : 0.6,
                        cursor: campaignId ? 'pointer' : 'not-allowed'
                      }}
                      onClick={handleOpenTestModal}
                      disabled={!campaignId}
                      title={!campaignId ? 'Save the campaign before sending a test email' : 'Send a test email to yourself'}
                    >
                      <FiMail />
                      {isAutomationMode ? 'Test Automation' : 'Test Campaign'}
                    </button>
                  </PermissionGate>
                  {!isAutomationMode && (
                    <PermissionGate permission="mail.campaigns.send">
                      <button
                        style={styles.primaryButton}
                        onClick={handleSend}
                      >
                        <FiSend />
                        Send Campaign
                      </button>
                    </PermissionGate>
                  )}
                </div>
              </div>

              {isAutomationMode && (
                <div style={styles.automationBanner}>
                  <div style={styles.automationBannerTitle}>
                    Automation Mode
                  </div>
                  <div style={styles.automationBannerText}>
                    This email will be saved as a recurring automation template instead of a one-off campaign send. It stays off until you turn this automation on.
                  </div>
                </div>
              )}

              {/* Message */}
              {message && (
                <div style={{
                  ...styles.message,
                  backgroundColor: message.includes('Error') || message.includes('fix') ? '#ffebee' : '#e8f5e8',
                  color: message.includes('Error') || message.includes('fix') ? '#c62828' : '#2e7d32'
                }}>
                  {message.split('\n').map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </div>
              )}

              {/* Main Content */}
              <div style={isMobile ? styles.contentMobile : styles.content}>
                {/* Editor Panel */}
                <div style={styles.editorPanel}>
                  {/* Campaign Settings */}
                  <div style={styles.settingsSection}>
                    <h3 style={styles.sectionTitle}>Campaign Settings</h3>
                    {isAutomationMode && (
                      <>
                        <div style={styles.formGroup}>
                          <label style={styles.label}>Automation Name</label>
                          <input
                            type="text"
                            style={styles.input}
                            value={automationConfig.name}
                            onChange={(e) => handleAutomationChange('name', e.target.value)}
                            placeholder="Enter automation name"
                            disabled={!canEditCampaigns && !canCreateCampaigns}
                          />
                        </div>
                        <div style={styles.formGroup}>
                          <label style={styles.label}>Automation Type</label>
                          <select
                            style={styles.input}
                            value={automationConfig.automation_type}
                            onChange={(e) => handleAutomationChange('automation_type', e.target.value)}
                            disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                          >
                            {AUTOMATION_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {automationConfig.automation_type === 'custom' && (
                          <div style={styles.formGroup}>
                            <label style={styles.label}>Automation Trigger Source</label>
                            <select
                              style={styles.input}
                              value={automationConfig.trigger_source || 'custom_rules'}
                              onChange={(e) => handleAutomationChange('trigger_source', e.target.value)}
                              disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                            >
                              {AUTOMATION_SOURCE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {automationConfig.trigger_source === 'waiver_check_in_review' && (
                              <div style={styles.helpText}>
                                Sends after a waiver participant is checked in. Use {'{{ReviewLink}}'} for the public reputation review link and {'{{CheckedInName}}'} for the checked-in person.
                              </div>
                            )}
                            {automationConfig.trigger_source === 'name_of_day' && (
                              <div style={styles.helpText}>
                                Runs daily via the mail-name-of-day job (~7:00 AM local by default). Use the merge tokens below in subject, preheader, and email body.
                              </div>
                            )}
                            {automationConfig.trigger_source === 'toddler_thursday' && (
                              <div style={styles.helpText}>
                                Sends Thursday morning (default 6:00–9:00 AM local) on bi-weekly Toddler Thursdays. Eligible families have at least one toddler age 1–3 on any waiver (including expired). Audience alternates 50/50 each promo week.
                              </div>
                            )}
                          </div>
                        )}
                        <div style={styles.formRow}>
                          <div style={styles.formGroupHalf}>
                            <label style={styles.label}>Status</label>
                            <select
                              style={styles.input}
                              value={automationConfig.status}
                              onChange={(e) => handleAutomationChange('status', e.target.value)}
                              disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                            >
                              <option value="draft">Draft</option>
                              <option value="active">Active</option>
                              <option value="paused">Paused</option>
                              <option value="archived">Archived</option>
                            </select>
                          </div>
                          <div style={styles.formGroupHalf}>
                            <label style={styles.label}>Trigger Timing</label>
                            <select
                              style={styles.input}
                              value={automationConfig.trigger_timing}
                              onChange={(e) => handleAutomationChange('trigger_timing', e.target.value)}
                              disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                            >
                              <option value="before_event">Before Event</option>
                              <option value="event_day">On Event Day</option>
                              <option value="after_event">After Event</option>
                              <option value="custom_window">Custom Window</option>
                            </select>
                          </div>
                        </div>
                        <div style={styles.formGroup}>
                          <label style={styles.label}>Automation Sending</label>
                          <button
                            type="button"
                            onClick={() => handleAutomationChange('is_enabled', !automationConfig.is_enabled)}
                            disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                            style={{
                              alignSelf: 'flex-start',
                              padding: '10px 16px',
                              borderRadius: '999px',
                              border: `1px solid ${automationConfig.is_enabled ? '#0f766e' : '#d1d5db'}`,
                              backgroundColor: automationConfig.is_enabled ? '#ccfbf1' : '#f3f4f6',
                              color: automationConfig.is_enabled ? '#115e59' : '#374151',
                              fontWeight: 700,
                              cursor: !canEditCampaigns && !canCreateCampaigns || automationLoading ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {automationConfig.is_enabled ? 'On: automatic sending enabled' : 'Off: automatic sending disabled'}
                          </button>
                          <div style={styles.helpText}>
                            Every automation starts off. Turn this on only when you are ready for this specific automation to send automatically.
                          </div>
                        </div>
                        <div style={styles.formGroup}>
                          <TavariCheckbox
                            id="automation-apply-max-child-age-rule"
                            checked={automationConfig.apply_max_child_age_rule === true}
                            onChange={(checked) => handleAutomationChange('apply_max_child_age_rule', checked)}
                            disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                            label="Apply max child age rule"
                            appearance="native"
                            size="md"
                            labelStyle={{ fontWeight: 700, color: '#333' }}
                          />
                          <div style={styles.helpText}>
                            Birthday automations apply this to the birthday minor. Broader child/family automations use the max age rule to limit eligible families.
                          </div>
                        </div>
                        {automationConfig.trigger_source === 'waiver_check_in_review' ? (
                          <div style={styles.formGroup}>
                            <label style={styles.label}>Hours after check-in</label>
                            <input
                              type="number"
                              style={styles.input}
                              min={0}
                              max={168}
                              step="any"
                              value={waiverCheckInDelayHours}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                setWaiverCheckInDelayHours(Number.isFinite(n) ? n : 0);
                              }}
                              placeholder="2"
                              disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                            />
                            <div style={styles.helpText}>
                              When someone is checked in on a waiver, the review request email is queued for this many
                              hours later (0 = as soon as check-in saves; max 168 hours / 7 days). This matches Mail →
                              Automations → Blueprints → Post-Visit Review Request and Reputation settings.
                            </div>
                          </div>
                        ) : automationConfig.trigger_source === 'toddler_thursday' ? (
                          <>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>Promo anchor date (first Toddler Thursday)</label>
                              <input
                                type="date"
                                style={styles.input}
                                value={automationConfig.promo_anchor_date || getDefaultPromoAnchorDate()}
                                onChange={(e) => handleAutomationChange('promo_anchor_date', e.target.value)}
                                disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                              />
                              <div style={styles.helpText}>
                                Bi-weekly promo Thursdays are counted from this anchor. Pick the first Thursday you want to run the promo.
                              </div>
                            </div>
                            <div style={styles.formRow}>
                              <div style={styles.formGroupHalf}>
                                <label style={styles.label}>Min toddler age (years)</label>
                                <input
                                  type="number"
                                  style={styles.input}
                                  min={1}
                                  max={3}
                                  value={automationConfig.toddler_min_age_years ?? 1}
                                  onChange={(e) => handleAutomationChange('toddler_min_age_years', e.target.value)}
                                  disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                                />
                              </div>
                              <div style={styles.formGroupHalf}>
                                <label style={styles.label}>Max toddler age (years)</label>
                                <input
                                  type="number"
                                  style={styles.input}
                                  min={1}
                                  max={3}
                                  value={automationConfig.toddler_max_age_years ?? 3}
                                  onChange={(e) => handleAutomationChange('toddler_max_age_years', e.target.value)}
                                  disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                                />
                              </div>
                            </div>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>Offer price label</label>
                              <input
                                type="text"
                                style={styles.input}
                                value={automationConfig.offer_price_label || '$7'}
                                onChange={(e) => handleAutomationChange('offer_price_label', e.target.value)}
                                placeholder="$7"
                                disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                              />
                              <div style={styles.helpText}>
                                Shown in {'{{OfferPrice}}'} — price per toddler when the offer applies.
                              </div>
                            </div>
                            <div style={styles.formRow}>
                              <div style={styles.formGroupHalf}>
                                <label style={styles.label}>Promo code</label>
                                <input
                                  type="text"
                                  style={styles.input}
                                  value={automationConfig.promo_code || 'DCT2026'}
                                  onChange={(e) => handleAutomationChange('promo_code', e.target.value)}
                                  placeholder="DCT2026"
                                  disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                                />
                              </div>
                              <div style={styles.formGroupHalf}>
                                <label style={styles.label}>Min toddlers for offer</label>
                                <input
                                  type="number"
                                  style={styles.input}
                                  min={2}
                                  max={10}
                                  value={automationConfig.min_toddler_count_for_offer ?? 2}
                                  onChange={(e) => handleAutomationChange('min_toddler_count_for_offer', e.target.value)}
                                  disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                                />
                              </div>
                            </div>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>Booking window label</label>
                              <input
                                type="text"
                                style={styles.input}
                                value={automationConfig.booking_window_label || '10:00 AM – 1:00 PM'}
                                onChange={(e) => handleAutomationChange('booking_window_label', e.target.value)}
                                placeholder="10:00 AM – 1:00 PM"
                                disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                              />
                              <div style={styles.helpText}>
                                Shown in {'{{BookingWindow}}'}. Must match the Toddler Thursday booking slot customers select online.
                              </div>
                            </div>
                          </>
                        ) : (
                          <div style={styles.formGroup}>
                            <label style={styles.label}>Days Offset</label>
                            <input
                              type="number"
                              style={styles.input}
                              value={automationConfig.days_offset}
                              onChange={(e) => handleAutomationChange('days_offset', e.target.value)}
                              placeholder="0"
                              disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                            />
                            <div style={styles.helpText}>
                              Use a positive number to send before or after the automation event window. Loyalty points are automatically included when this automation sends.
                            </div>
                          </div>
                        )}
                        <div style={styles.formGroup}>
                          <label style={styles.label}>Send Window</label>
                          {automationConfig.trigger_source === 'toddler_thursday' && (
                            <div style={styles.helpText}>
                              Default: Thursday 6:00–9:00 AM local on promo weeks. Adjust start/end hour if needed.
                            </div>
                          )}
                          <div style={styles.sendWindowRow}>
                            <div style={styles.formGroupThird}>
                              <label style={styles.smallLabel}>Start Hour</label>
                              <select
                                style={styles.input}
                                value={automationConfig.send_start_hour}
                                onChange={(e) => handleAutomationChange('send_start_hour', e.target.value)}
                                disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                              >
                                {Array.from({ length: 24 }, (_, hour) => (
                                  <option key={hour} value={hour}>
                                    {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={styles.formGroupThird}>
                              <label style={styles.smallLabel}>End Hour</label>
                              <select
                                style={styles.input}
                                value={automationConfig.send_end_hour}
                                onChange={(e) => handleAutomationChange('send_end_hour', e.target.value)}
                                disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                              >
                                {Array.from({ length: 24 }, (_, hour) => (
                                  <option key={hour} value={hour}>
                                    {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={styles.formGroupThird}>
                              <label style={styles.smallLabel}>Minute Offset</label>
                              <select
                                style={styles.input}
                                value={automationConfig.send_minute_offset}
                                onChange={(e) => handleAutomationChange('send_minute_offset', e.target.value)}
                                disabled={!canEditCampaigns && !canCreateCampaigns || automationLoading}
                              >
                                <option value={0}>:00</option>
                                <option value={15}>:15</option>
                                <option value={30}>:30</option>
                                <option value={45}>:45</option>
                              </select>
                            </div>
                          </div>
                          <div style={styles.helpText}>
                            Sends are spread evenly across this local-time window. Use a 30-minute offset to keep this automation from sending on the hour with another automation.
                          </div>
                        </div>
                      </>
                    )}
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Campaign Name</label>
                      <input
                        type="text"
                        style={styles.input}
                        value={campaign.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        placeholder="Enter campaign name"
                        disabled={!canEditCampaigns && !canCreateCampaigns}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Subject Line</label>
                      <input
                        type="text"
                        style={styles.input}
                        value={campaign.subject_line}
                        onChange={(e) => handleInputChange('subject_line', e.target.value)}
                        placeholder="Enter subject line"
                        disabled={!canEditCampaigns && !canCreateCampaigns}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Preheader Text (Optional)</label>
                      <input
                        type="text"
                        style={styles.input}
                        value={campaign.preheader_text}
                        onChange={(e) => handleInputChange('preheader_text', e.target.value)}
                        placeholder="Preview text that appears in inbox"
                        disabled={!canEditCampaigns && !canCreateCampaigns}
                      />
                    </div>
                    {isAutomationMode && automationConfig.trigger_source === 'name_of_day' && (
                      <div style={styles.mergeTokenPanel} aria-label="Name of the Day merge tokens">
                        <div style={styles.mergeTokenPanelTitle}>Name of the Day — merge tokens</div>
                        <p style={styles.mergeTokenIntro}>
                          Paste into <strong>subject</strong>, <strong>preheader</strong>, or any <strong>content block</strong>. Tokens are replaced when the winner email is sent.
                        </p>
                        {NAME_OF_DAY_MERGE_TOKEN_GROUPS.map((group) => (
                          <div key={group.label} style={styles.mergeTokenRow}>
                            <div style={styles.mergeTokenGroupLabel}>{group.label}</div>
                            <div style={styles.mergeTokenCodeWrap}>
                              {group.codes.map((code) => (
                                <code key={code} style={styles.mergeTokenCode}>{code}</code>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {isAutomationMode && automationConfig.trigger_source === 'toddler_thursday' && (
                      <div style={styles.mergeTokenPanel} aria-label="Toddler Thursday merge tokens">
                        <div style={styles.mergeTokenPanelTitle}>Toddler Thursday — merge tokens</div>
                        <p style={styles.mergeTokenIntro}>
                          Paste into <strong>subject</strong>, <strong>preheader</strong>, or any <strong>content block</strong>. Tokens are replaced when each promo email is sent.
                        </p>
                        {TODDLER_THURSDAY_MERGE_TOKEN_GROUPS.map((group) => (
                          <div key={group.label} style={styles.mergeTokenRow}>
                            <div style={styles.mergeTokenGroupLabel}>{group.label}</div>
                            <div style={styles.mergeTokenCodeWrap}>
                              {group.codes.map((code) => (
                                <code key={code} style={styles.mergeTokenCode}>{code}</code>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Saved Send List</label>
                      <select
                        style={styles.input}
                        value={campaign.target_segment || 'all'}
                        onChange={(e) => handleInputChange('target_segment', e.target.value === 'all' ? null : e.target.value)}
                        disabled={!canEditCampaigns && !canCreateCampaigns}
                      >
                        <option value="all">All subscribed contacts</option>
                        {segments.map((segment) => (
                          <option key={segment.id} value={segment.id}>
                            {segment.name} ({segment.contact_count || 0} contacts)
                          </option>
                        ))}
                      </select>
                      <div style={styles.helpText}>
                        Choose a reusable segment to limit this campaign to a saved list.
                      </div>
                      {segmentCountError && (
                        <div style={styles.errorMessage}>
                          {segmentCountError}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Block Library */}
                  <PermissionGate permissions={['mail.campaigns.create']} requireAny>
                    <div style={styles.blockLibrarySection}>
                      <h3 style={styles.sectionTitle}>Add Content Blocks</h3>
                      <div style={styles.blockLibrary}>
                        {blockTypes.map(blockType => (
                          <button
                            key={blockType.type}
                            style={styles.blockTypeButton}
                            onClick={() => addBlock(blockType.type)}
                            title={blockType.description}
                          >
                            <blockType.icon style={styles.blockTypeIcon} />
                            <span style={styles.blockTypeLabel}>{blockType.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </PermissionGate>

                  {/* Content Editor */}
                  <div style={styles.contentSection}>
                    <h3 style={styles.sectionTitle}>Email Content</h3>
                    {campaign.content_blocks.length === 0 ? (
                      <div style={styles.emptyState}>
                        <FiPlus style={styles.emptyIcon} />
                        <p>No content blocks yet.</p>
                        <p>Add your first block from the options above to get started.</p>
                      </div>
                    ) : (
                      <div style={styles.blocksList}>
                        {campaign.content_blocks.map((block, index) => (
                          <div key={block.id} style={styles.contentBlock}>
                            <div style={styles.blockHeader}>
                              <div style={styles.blockTitle}>
                                <FiMove style={styles.dragHandle} />
                                <span style={styles.blockTypeName}>
                                  {block.type.charAt(0).toUpperCase() + block.type.slice(1)} Block
                                </span>
                              </div>
                              <PermissionGate permissions={['mail.campaigns.create']} requireAny>
                                <div style={styles.blockActions}>
                                  <button
                                    style={styles.actionButton}
                                    onClick={() => moveBlock(block.id, 'up')}
                                    disabled={index === 0}
                                    title="Move Up"
                                  >
                                    <FiChevronUp />
                                  </button>
                                  <button
                                    style={styles.actionButton}
                                    onClick={() => moveBlock(block.id, 'down')}
                                    disabled={index === campaign.content_blocks.length - 1}
                                    title="Move Down"
                                  >
                                    <FiChevronDown />
                                  </button>
                                  <button
                                    style={styles.actionButton}
                                    onClick={() => duplicateBlock(block.id)}
                                    title="Duplicate"
                                  >
                                    <FiCopy />
                                  </button>
                                  <button
                                    style={styles.actionButton}
                                    onClick={() => removeBlock(block.id)}
                                    title="Delete"
                                  >
                                    <FiTrash2 />
                                  </button>
                                </div>
                              </PermissionGate>
                            </div>
                            <div style={styles.blockContent}>
                              {renderBlockEditor(block)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Preview Panel */}
                <div style={styles.previewPanel}>
                  <h3 style={styles.sectionTitle}>Email Preview</h3>
                  <div style={styles.previewContainer}>
                    <div style={previewMode === 'mobile' ? styles.mobilePreview : styles.desktopPreview}>
                      <div style={styles.emailContent}>
                        <div style={styles.emailHeader}>
                          <strong>Subject: </strong>{campaign.subject_line || 'Your Subject Line'}
                          {campaign.preheader_text && (
                            <div style={styles.preheaderText}>
                              {campaign.preheader_text}
                            </div>
                          )}
                        </div>
                        <div 
                          style={styles.emailBody}
                          dangerouslySetInnerHTML={{ 
                            __html: campaign.content_blocks.length > 0 
                              ? generateEmailHTML().match(/<div style="max-width: 600px[^>]*">([\s\S]*?)<div style="margin-top: 40px/)[1] || ''
                              : '<p style="color: #999; font-style: italic; text-align: center; padding: 40px;">Add content blocks to see preview</p>'
                          }}
                        />
                        <div style={styles.emailFooter}>
                          <p style={styles.footerText}>
                            You received this email because you subscribed to our mailing list.
                          </p>
                          <p style={styles.footerText}>
                            <strong>{business?.name || 'Your Business Name'}</strong><br />
                            Your Business Address - Required for CASL Compliance
                          </p>
                          <p style={styles.footerText}>
                            <a href="#" style={styles.footerLink}>Unsubscribe</a> | 
                            <a href="#" style={styles.footerLink}>Update Preferences</a>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

        {showTestModal && (
          <div style={styles.testModalOverlay}>
            <div style={styles.testModal}>
              <div style={styles.testModalHeader}>
                <h3 style={styles.testModalTitle}>Send Test Campaign</h3>
                <button
                  style={styles.testModalClose}
                  onClick={handleCloseTestModal}
                  disabled={sendingTest}
                  title="Close"
                >
                  <FiX />
                </button>
              </div>
              <div style={styles.testModalBody}>
                <label style={styles.testModalLabel}>Test email address</label>
                <input
                  type="email"
                  style={styles.testModalInput}
                  placeholder="name@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  disabled={sendingTest}
                />
                <p style={styles.testModalHint}>
                  We'll send this campaign to a single recipient so you can review the layout before launching.
                </p>
              </div>
              <div style={styles.testModalFooter}>
                <button
                  style={{
                    ...styles.secondaryButton,
                    opacity: sendingTest ? 0.7 : 1,
                    cursor: sendingTest ? 'wait' : 'pointer'
                  }}
                  onClick={handleSendTestEmail}
                  disabled={sendingTest}
                >
                  {sendingTest ? 'Sending...' : 'Send Test Email'}
                </button>
                <button
                  style={styles.tertiaryButton}
                  onClick={handleCloseTestModal}
                  disabled={sendingTest}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        <CampaignScheduler
          campaign={{ ...campaign, id: campaignId }}
          isOpen={showScheduler}
          onClose={() => setShowScheduler(false)}
          onSchedule={handleScheduleCampaign}
        />
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

// Comprehensive styles (FIXED: Using proper hex colors)
const styles = {
  container: {
    padding: '40px',
    maxWidth: '1400px',
    margin: '0 auto',
    backgroundColor: '#f8f8f8',
    minHeight: '100vh',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    color: '#666',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e9ecef',
    borderTop: '4px solid #008080',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '20px',
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
    fontSize: '20px',
    color: '#e74c3c',
    marginBottom: '20px',
  },
  permissionDenied: {
    backgroundColor: '#fff3cd',
    border: '2px solid #f39c12',
    borderRadius: '8px',
    padding: '40px',
    textAlign: 'center',
    color: '#856404',
  },
  permissionIcon: {
    fontSize: '14px',
    marginBottom: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
    flexWrap: 'wrap',
    gap: '20px',
  },
  titleSection: {
    flex: 1,
  },
  backButton: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#008080',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '10px',
  },
  title: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  primaryButton: {
    backgroundColor: '#008080',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    color: '#008080',
    border: '2px solid #008080',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  tertiaryButton: {
    backgroundColor: '#ffffff',
    color: '#4b5563',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  message: {
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontWeight: 'bold',
  },
  content: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '30px',
  },
  contentMobile: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  editorPanel: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    padding: '25px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
  },
  previewPanel: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    padding: '25px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
  },
  testModalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px',
  },
  testModal: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  testModalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 24px',
    borderBottom: '1px solid #e5e7eb',
  },
  testModalTitle: {
    margin: 0,
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#1f2937',
  },
  testModalClose: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  testModalBody: {
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  testModalLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#374151',
  },
  testModalInput: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    border: '2px solid #e5e7eb',
    fontSize: '48px',
    boxSizing: 'border-box',
  },
  testModalHint: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0,
  },
  testModalFooter: {
    padding: '18px 24px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
    borderBottom: '2px solid #f0f0f0',
    paddingBottom: '10px',
  },
  settingsSection: {
    marginBottom: '30px',
  },
  formGroup: {
    marginBottom: '20px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  sendWindowRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '16px',
  },
  formGroupHalf: {
    marginBottom: '20px',
  },
  formGroupThird: {
    marginBottom: '20px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  smallLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 700,
    color: '#475569',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '12px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '16px',
    boxSizing: 'border-box',
  },
  helpText: {
    marginTop: '8px',
    fontSize: '14px',
    color: '#6b7280',
  },
  mergeTokenPanel: {
    marginBottom: '20px',
    padding: '14px 16px',
    borderRadius: '8px',
    border: '1px solid #fdba74',
    backgroundColor: '#fffbeb'
  },
  mergeTokenPanelTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#9a3412',
    marginBottom: '8px'
  },
  mergeTokenIntro: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    color: '#57534e',
    lineHeight: 1.5
  },
  mergeTokenRow: {
    marginBottom: '12px'
  },
  mergeTokenGroupLabel: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#78716c',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.02em'
  },
  mergeTokenCodeWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px'
  },
  mergeTokenCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '32px',
    backgroundColor: '#fff7ed',
    padding: '4px 8px',
    borderRadius: '4px',
    border: '1px solid #fdba74',
    color: '#431407'
  },
  errorMessage: {
    marginTop: '8px',
    fontSize: '14px',
    color: '#dc2626',
  },
  automationBanner: {
    marginBottom: '20px',
    padding: '16px 18px',
    borderRadius: '10px',
    border: '1px solid #c4b5fd',
    backgroundColor: '#f5f3ff',
  },
  automationBannerTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#5b21b6',
    marginBottom: '6px',
  },
  automationBannerText: {
    fontSize: '12px',
    color: '#6d28d9',
    lineHeight: 1.5,
  },
  blockLibrarySection: {
    marginBottom: '30px',
  },
  blockLibrary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '12px',
  },
  blockTypeButton: {
    backgroundColor: '#ffffff',
    color: '#008080',
    border: '2px solid #008080',
    borderRadius: '8px',
    padding: '15px 10px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    textAlign: 'center',
    transition: 'all 0.2s ease',
  },
  blockTypeIcon: {
    fontSize: '14px',
  },
  blockTypeLabel: {
    fontSize: '14px',
  },
  contentSection: {
    marginBottom: '20px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#666',
    backgroundColor: '#f8f8f8',
    borderRadius: '8px',
  },
  emptyIcon: {
    fontSize: '14px',
    color: '#ccc',
    marginBottom: '15px',
  },
  blocksList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  contentBlock: {
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    padding: '20px',
    backgroundColor: '#fafafa',
  },
  blockHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
    paddingBottom: '10px',
    borderBottom: '1px solid #e0e0e0',
  },
  blockTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  dragHandle: {
    color: '#999',
    cursor: 'move',
    fontSize: '12px',
  },
  blockTypeName: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  blockActions: {
    display: 'flex',
    gap: '8px',
  },
  actionButton: {
    backgroundColor: '#ffffff',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '4px',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockContent: {
    padding: '10px 0',
  },
  blockEditorContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  blockTextarea: {
    width: '100%',
    padding: '12px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '12px',
    resize: 'vertical',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  headingInput: {
    width: '100%',
    padding: '12px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 'bold',
    boxSizing: 'border-box',
  },
  controlsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  headingLevelSelect: {
    padding: '8px 12px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '11px',
  },
  alignmentButtons: {
    display: 'flex',
    gap: '4px',
  },
  alignmentButton: {
    backgroundColor: '#ffffff',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '4px',
    padding: '8px 12px',
    fontSize: '11px',
    cursor: 'pointer',
  },
  activeAlignment: {
    backgroundColor: '#008080',
    color: '#ffffff',
    border: '2px solid #008080',
  },
  colorPicker: {
    width: '40px',
    height: '32px',
    border: '2px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  buttonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px',
  },
  removeButton: {
    backgroundColor: '#ff4444',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    backgroundColor: '#ffffff',
    color: '#008080',
    border: '2px solid #008080',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '11px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  imageUploadArea: {
    border: '2px dashed #ddd',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
    cursor: 'pointer',
    backgroundColor: '#fafafa',
  },
  fileInput: {
    display: 'none',
  },
  imageUploadLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    color: '#008080',
    fontWeight: 'bold',
  },
  uploadIcon: {
    fontSize: '26px',
  },
  spinningIcon: {
    fontSize: '26px',
    animation: 'spin 1s linear infinite',
  },
  imagePreview: {
    textAlign: 'center',
    marginBottom: '10px',
  },
  previewImage: {
    maxWidth: '200px',
    maxHeight: '150px',
    borderRadius: '4px',
    border: '1px solid #ddd',
  },
  select: {
    padding: '8px 12px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '11px',
  },
  linkRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  linkInput: {
    flex: 1,
    padding: '8px 12px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '11px',
  },
  testLinkButton: {
    backgroundColor: '#ffffff',
    color: '#008080',
    border: '2px solid #008080',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    whiteSpace: 'nowrap',
  },
  buttonIcon: {
    fontSize: '11px',
  },
  socialPlatformsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  socialPlatformEditor: {
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '12px',
  },
  socialPlatformHeader: {
    marginBottom: '8px',
  },
  socialCheckboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
  },
  socialCheckbox: {
    width: '16px',
    height: '16px',
  },
  socialPlatformName: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#333',
  },
  socialUrlRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  socialUrlInput: {
    flex: 1,
    padding: '8px 12px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '11px',
  },
  testSocialButton: {
    backgroundColor: '#ffffff',
    color: '#008080',
    border: '2px solid #008080',
    borderRadius: '4px',
    padding: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alignmentLabel: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#666',
  },
  columnsEditor: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '15px',
  },
  columnEditor: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  columnLabel: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#666',
  },
  columnTextarea: {
    width: '100%',
    padding: '10px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    fontSize: '11px',
    resize: 'vertical',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  placeholderText: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  previewContainer: {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    backgroundColor: '#f9f9f9',
  },
  desktopPreview: {
    maxWidth: '600px',
    margin: '0 auto',
  },
  mobilePreview: {
    maxWidth: '320px',
    margin: '0 auto',
  },
  emailContent: {
    backgroundColor: '#ffffff',
    padding: '30px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  emailHeader: {
    borderBottom: '1px solid #eee',
    paddingBottom: '15px',
    marginBottom: '20px',
  },
  preheaderText: {
    fontSize: '10px',
    color: '#666',
    marginTop: '5px',
  },
  emailBody: {
    marginBottom: '30px',
  },
  emailFooter: {
    borderTop: '1px solid #eee',
    paddingTop: '15px',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '10px',
    color: '#999',
    margin: '5px 0',
  },
  footerLink: {
    color: '#666',
    textDecoration: 'none',
    margin: '0 5px',
  },
};

// Add CSS animation
if (!document.querySelector('#campaign-builder-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'campaign-builder-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default CampaignBuilder;
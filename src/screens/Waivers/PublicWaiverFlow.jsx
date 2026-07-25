// src/screens/Waivers/PublicWaiverFlow.jsx
// Comprehensive public waiver signing flow with OTP authentication
// Flow: Location Selection → OTP Auth → Participant Info → Waiver Agreement → Signature → Multiple Adults → Completion

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { FiFileText, FiCheckCircle, FiAlertCircle, FiLock, FiMapPin } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { waiverOTPService } from '../../services/Waivers/WaiverOTPService';
import { getLocationData } from '../../utils/waiverLocationTracking';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import ErrorBoundary from '../../components/UI/ErrorBoundary';
import KioskIdleAdCarousel from '../../components/Waivers/KioskIdleAdCarousel';
import WaiverKioskFullscreenOverlay from '../../components/Waivers/WaiverKioskFullscreenOverlay';
import { clampKioskAdSlideSeconds, KIOSK_IDLE_AD_SIGNED_URL_SECONDS, KIOSK_IDLE_AD_URL_REFRESH_MS } from '../../constants/waiverKioskIdleAds';

// Import step components
import WelcomeStep from '../../components/Waivers/PublicWaiverSteps/WelcomeStep';
import PhoneEntryStep from '../../components/Waivers/PublicWaiverSteps/PhoneEntryStep';
import OTPStep from '../../components/Waivers/PublicWaiverSteps/OTPStep';
import ExistingWaiverViewStep from '../../components/Waivers/PublicWaiverSteps/ExistingWaiverViewStep';
import ExistingWaiverCheckInStep from '../../components/Waivers/PublicWaiverSteps/ExistingWaiverCheckInStep';
import ParticipantInfoStep from '../../components/Waivers/PublicWaiverSteps/ParticipantInfoStep';
import AgreementStep from '../../components/Waivers/PublicWaiverSteps/AgreementStep';
import LegalWarningStep from '../../components/Waivers/PublicWaiverSteps/LegalWarningStep';
import SignatureStep from '../../components/Waivers/PublicWaiverSteps/SignatureStep';
import AdditionalAdultStep from '../../components/Waivers/PublicWaiverSteps/AdditionalAdultStep';
import ReviewStep from '../../components/Waivers/PublicWaiverSteps/ReviewStep';
import CompletionStep from '../../components/Waivers/PublicWaiverSteps/CompletionStep';
import WaiverTemplateSelectStep from '../../components/Waivers/PublicWaiverSteps/WaiverTemplateSelectStep';
import WaiverSearchService from '../../services/Waivers/WaiverSearchService';
import WaiverParticipantService from '../../services/Waivers/WaiverParticipantService';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import { isWaiverExpired } from '../../utils/waiverUtils';
import { isMinorFromIsoDob, birthFormPartsFromValue } from '../../utils/waiverDateOfBirth';
import {
  normalizePhoneDigits,
  resolveWaiverViewerAccess,
  resolveOtpDeliveryForExistingWaiver
} from '../../utils/waiverExistingViewerAccess';
import {
  DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS,
  WAIVER_PORTAL_ACCESS
} from '../../constants/waiverParticipantPortalAccess';
import { isKioskIdleAdScheduledNow } from '../../utils/kioskIdleAdSchedule';
import { useWaiverTabletKeyboardInset } from '../../hooks/useWaiverTabletKeyboardInset';
import {
  isPublicWaiverKioskMode,
  resolvePublicWaiverCompletionRedirect
} from '../../utils/publicWaiverRedirect';
import '../../components/Waivers/PublicWaiverSteps/publicWaiverResponsive.css';

/** Same template as kiosk URL when possible; then newest-first for history UI. */
function waiversScopedToTemplate(waivers, templateId) {
  if (!Array.isArray(waivers) || waivers.length === 0) return [];
  let pool = waivers;
  if (templateId) {
    const same = waivers.filter((w) => w.template_id === templateId);
    if (same.length > 0) pool = same;
  }
  return pool;
}

function sortWaiversBySignedAtDesc(waivers) {
  const signedAtMs = (w) => (w.signed_at ? new Date(w.signed_at).getTime() : 0);
  return [...waivers].sort((a, b) => signedAtMs(b) - signedAtMs(a));
}

function latestTemplatesByKey(templates) {
  const seen = new Set();
  const latest = [];
  for (const template of Array.isArray(templates) ? templates : []) {
    const key = template?.template_key || template?.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    latest.push(template);
  }
  return latest;
}

function buildStationTemplateOptions(templates, settings) {
  const configured = Array.isArray(settings?.waiver_station_templates)
    ? settings.waiver_station_templates
    : [];

  return configured
    .map((item) => {
      const match = (Array.isArray(templates) ? templates : []).find((template) =>
        (item?.templateId && template.id === item.templateId) ||
        (item?.templateKey && template.template_key === item.templateKey)
      );
      if (!match) return null;

      const displayName =
        String(item?.displayName || '').trim() ||
        String(match.waiver_title || '').trim() ||
        String(match.template_name || '').trim() ||
        String(match.template_key || '').trim();

      return {
        templateId: match.id,
        templateKey: match.template_key,
        displayName,
        template: match
      };
    })
    .filter(Boolean);
}

const KIOSK_IDLE_AD_FOLDER = 'waiver-kiosk-ads';
const KIOSK_IDLE_AD_TAG = 'waiver-kiosk-ad';

function normalizeKioskIdleAds(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const folderPath = row?.content?.folder_path;
      const tags = Array.isArray(row?.content?.tags) ? row.content.tags : [];
      return folderPath === KIOSK_IDLE_AD_FOLDER || tags.includes(KIOSK_IDLE_AD_TAG);
    })
    .map((row) => ({
      id: row.id,
      name: row.ad_name || row?.content?.content_name || 'Waiver Kiosk Image',
      imageUrl: row?.content?.file_url || '',
      filePath: row?.content?.file_path || null,
      createdAt: row?.created_at || null
    }))
    .filter((row) => !!(row.imageUrl || row.filePath));
}

async function resolveKioskAdImageUrls(ads) {
  const list = Array.isArray(ads) ? ads : [];
  const out = [];
  for (const ad of list) {
    if (!ad.filePath) {
      if (ad.imageUrl) out.push(ad);
      continue;
    }
    try {
      const { data, error } = await supabase.storage
        .from('digital-signage-content')
        .createSignedUrl(ad.filePath, KIOSK_IDLE_AD_SIGNED_URL_SECONDS);
      if (!error && data?.signedUrl) {
        out.push({ ...ad, imageUrl: data.signedUrl });
      } else if (ad.imageUrl) {
        out.push(ad);
      }
    } catch {
      if (ad.imageUrl) out.push(ad);
    }
  }
  return out;
}

const PublicWaiverFlow = () => {
  const { businessId, templateKey } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnUrl = searchParams.get('returnUrl'); // When set (e.g. from booking portal), navigate here on completion
  const autoStart = searchParams.get('autoStart') === '1';
  const signingStation = searchParams.get('signingStation');
  /** Playwright / automated click-through runs; keeps long waits from tripping idle reset (see scripts/e2e-waiver-clickthrough.mjs). */
  const suspendIdleForAutomatedTest = searchParams.get('tavariE2E') === '1';
  /** Local dev only: skip phone→existing-waiver lookup so you can exercise a fresh sign with any digits (e.g. your real number). Never active in production builds. */
  const forceNewWaiverDevOnly =
    import.meta.env.DEV && searchParams.get('forceNewWaiver') === '1';
  const isNativeWaiverKiosk =
    typeof window !== 'undefined' &&
    (window.electronAPI || window.__TAVARI_KIOSK_MODE__ || window.__TAVARI_ELECTRON__);
  const isKioskIdleAdMode = signingStation === 'browser_kiosk' || isNativeWaiverKiosk;
  const kioskFullscreenChrome = isKioskIdleAdMode ? <WaiverKioskFullscreenOverlay /> : null;

  /** Soft keyboard on tablets/phones: pad viewport + scroll focused inputs above the keyboard */
  useWaiverTabletKeyboardInset(true);

  // Flow state
  const [currentStep, setCurrentStep] = useState('welcome'); // ... 'template_select', 'additional_adult', 'additional_adult_intent_ack', 'review', 'completion'
  /** Legal record: each time user confirms intent to add another adult (stored on waiver_signatures). */
  const [additionalAdultIntentAcknowledgments, setAdditionalAdultIntentAcknowledgments] = useState([]);
  const [submittedWaiver, setSubmittedWaiver] = useState(null); // Store submitted waiver for completion screen
  const [business, setBusiness] = useState(null);
  const [template, setTemplate] = useState(null);
  const [locationData, setLocationData] = useState(null);

  // Phone entry state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [checkingWaiver, setCheckingWaiver] = useState(false);
  const [existingWaiver, setExistingWaiver] = useState(null);
  const [existingWaiverParticipants, setExistingWaiverParticipants] = useState([]);
  /** Signed versions for this phone (template-scoped); newest first. Shown after OTP. */
  const [existingWaiverHistory, setExistingWaiverHistory] = useState([]);
  const [hasExistingWaiver, setHasExistingWaiver] = useState(false);
  /** After OTP on existing waiver: signer vs additional-adult portal tier */
  const [existingWaiverViewerAccess, setExistingWaiverViewerAccess] = useState('signer');
  const [existingWaiverViewerParticipantId, setExistingWaiverViewerParticipantId] = useState(null);
  /** Primary-chosen portal access for the next additional adult (stored on waiver_participants). */
  const [pendingAdditionalAdultPortalAccess, setPendingAdditionalAdultPortalAccess] = useState(
    DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS
  );
  /** OTP email target after phone lookup (primary vs additional adult on waiver_participants). */
  const [, setExistingWaiverOtpDelivery] = useState(null);

  // OTP state (only used if existing waiver found)
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [customerInfo, setCustomerInfo] = useState(null);
  const [showLookupRetryModal, setShowLookupRetryModal] = useState(false);
  const [lookupRetryMessage, setLookupRetryMessage] = useState('');

  // Participant state
  const [participants, setParticipants] = useState([]); // Array of {type: 'primary'|'additional_adult'|'minor', data: {...}}
  const [currentParticipantIndex, setCurrentParticipantIndex] = useState(0);
  const [formData, setFormData] = useState({});
  const [participantModal, setParticipantModal] = useState({ open: false, index: null, isNew: false });
  const [reviewEditIndex, setReviewEditIndex] = useState(null);
  const [, setNumberOfMinors] = useState(0);

  // Agreement state
  const [agreementScrolled, setAgreementScrolled] = useState(false);
  const [agreementAgreed, setAgreementAgreed] = useState(false);
  const [, setLegalWarningShown] = useState(false);

  // Signature state
  const [, setSignatureData] = useState(null);
  const [, setSigning] = useState(false);

  // Settings state
  const [waiverSettings, setWaiverSettings] = useState({});
  const [consents, setConsents] = useState({}); // Store consent states
  const [stationTemplateOptions, setStationTemplateOptions] = useState([]);
  const [kioskIdleAds, setKioskIdleAds] = useState([]);
  const [showKioskIdleOverlay, setShowKioskIdleOverlay] = useState(false);
  const [currentKioskIdleAdIndex, setCurrentKioskIdleAdIndex] = useState(0);
  const kioskBootIdleShownRef = useRef(false);
  const suspendKioskStepIdleTimer = Boolean(showKioskIdleOverlay && isKioskIdleAdMode);
  const suspendStepIdleTimer = suspendKioskStepIdleTimer || suspendIdleForAutomatedTest;

  // Loading state
  const [loading, setLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayStep, setDisplayStep] = useState('welcome'); // Step to actually display
  const previousStepRef = useRef('welcome'); // Track previous step to detect changes

  // Auto-scroll to top when step changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [displayStep]);

  // Loading transition between steps - delay actual step change by 1.5 seconds
  useEffect(() => {
    // Only trigger delay if step actually changed
    if (currentStep !== previousStepRef.current) {
      // Show loading transition for ALL step changes (including first user action)
      setIsTransitioning(true);
      
      // After 1.5 seconds, actually change the displayed step
      const timer = setTimeout(() => {
        setDisplayStep(currentStep);
        setIsTransitioning(false);
        previousStepRef.current = currentStep;
      }, 1500); // 1.5 second loading transition
      
      return () => clearTimeout(timer);
    }
  }, [currentStep]);

  // Timer-based redirect is now handled in CompletionStep component

  useEffect(() => {
    initializeFlow();
  }, [businessId, templateKey]);

  const reloadKioskIdleAds = useCallback(async () => {
    if (!businessId || !isKioskIdleAdMode) {
      setKioskIdleAds([]);
      setShowKioskIdleOverlay(false);
      return [];
    }

    try {
      const { data: fnBody, error: fnError } = await supabase.functions.invoke(
        'waiver-kiosk-ad-urls',
        { body: { business_id: businessId } }
      );

      if (
        !fnError &&
        fnBody &&
        fnBody.ok === true &&
        Array.isArray(fnBody.ads) &&
        fnBody.ads.length > 0
      ) {
        const next = fnBody.ads.filter((a) => a && typeof a.imageUrl === 'string' && a.imageUrl.trim());
        setKioskIdleAds(next);
        return next;
      }

      const { data, error } = await supabase
        .from('digital_signage_ads')
        .select(`
          id,
          ad_name,
          created_at,
          start_date,
          end_date,
          start_time,
          end_time,
          days_of_week,
          content:digital_signage_content (
            file_url,
            file_path,
            folder_path,
            tags,
            content_name
          )
        `)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const tz = business?.timezone || 'America/Toronto';
      const scheduleFiltered = (data || []).filter((row) => {
        const folderPath = row?.content?.folder_path;
        const tags = Array.isArray(row?.content?.tags) ? row.content.tags : [];
        const isKiosk =
          folderPath === KIOSK_IDLE_AD_FOLDER || tags.includes(KIOSK_IDLE_AD_TAG);
        if (!isKiosk) return false;
        return isKioskIdleAdScheduledNow(row, tz);
      });
      const normalized = normalizeKioskIdleAds(scheduleFiltered);
      const resolved = await resolveKioskAdImageUrls(normalized);
      setKioskIdleAds(resolved);
      return resolved;
    } catch (error) {
      console.error('[PublicWaiverFlow] Failed to load kiosk idle ads:', error);
      setKioskIdleAds([]);
      return [];
    }
  }, [businessId, isKioskIdleAdMode, business?.timezone]);

  useEffect(() => {
    reloadKioskIdleAds();
  }, [reloadKioskIdleAds]);

  useEffect(() => {
    if (!isKioskIdleAdMode) return undefined;

    const intervalId = setInterval(() => {
      reloadKioskIdleAds();
    }, KIOSK_IDLE_AD_URL_REFRESH_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        reloadKioskIdleAds();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isKioskIdleAdMode, reloadKioskIdleAds]);

  const showIdleOverlayIfAvailable = useCallback(() => {
    if (!isKioskIdleAdMode || kioskIdleAds.length === 0) {
      setShowKioskIdleOverlay(false);
      return;
    }

    setCurrentKioskIdleAdIndex((prev) => {
      if (kioskIdleAds.length <= 1) return 0;
      return (prev + 1) % kioskIdleAds.length;
    });
    setShowKioskIdleOverlay(true);
  }, [isKioskIdleAdMode, kioskIdleAds.length]);

  useEffect(() => {
    if (kioskBootIdleShownRef.current) return;
    if (!isKioskIdleAdMode || loading || kioskIdleAds.length === 0) return;
    if (currentStep !== 'welcome' || displayStep !== 'welcome') return;
    kioskBootIdleShownRef.current = true;
    showIdleOverlayIfAvailable();
  }, [
    isKioskIdleAdMode,
    loading,
    kioskIdleAds.length,
    currentStep,
    displayStep,
    showIdleOverlayIfAvailable
  ]);

  const handleKioskIdleAdImageError = useCallback(async () => {
    console.warn('[PublicWaiverFlow] Kiosk ad image failed — refreshing signed URLs');
    const next = await reloadKioskIdleAds();
    if (!next.length) {
      setShowKioskIdleOverlay(false);
    }
  }, [reloadKioskIdleAds]);

  const initializeFlow = async () => {
    try {
      setLoading(true);
      setTemplate(null);
      setStationTemplateOptions([]);
      // Read from URL directly so we have token even on first paint (React Router searchParams can lag)
      const portalTokenRaw = searchParams.get('portalToken') || (() => {
        const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        return q.get('portalToken');
      })();

      // Resolve portal token FIRST when present (so we never miss it); then load business/template
      let portalContext = null;
      if (portalTokenRaw && businessId) {
        const { data: resolveData, error: resolveError } = await supabase.rpc('waiver_resolve_portal_token', { p_token: portalTokenRaw });
        if (resolveError) {
          console.warn('[PublicWaiverFlow] Portal token resolve error:', resolveError);
          toast.error(resolveError.message || 'Could not load your session. Enter your phone to continue.');
        } else if (resolveData?.valid && resolveData?.customer_id) {
          portalContext = resolveData;
        } else if (resolveData && !resolveData.valid) {
          toast.error(resolveData.error || 'Link expired. Please start from the booking page.');
        }
      }

      // Load business
      if (businessId) {
        const { data: biz, error: bizError } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .single();
        
        if (bizError) {
          console.error('[PublicWaiverFlow] Business load error:', bizError);
          toast.error('Error loading business: ' + (bizError.message || 'Business not found'));
        } else {
          const { data: branding } = await supabase
            .from('app_branding')
            .select('logo_url')
            .eq('business_id', businessId)
            .maybeSingle();
          const logoFromSettings =
            branding?.logo_url && String(branding.logo_url).trim()
              ? String(branding.logo_url).trim()
              : '';
          setBusiness({
            ...biz,
            logo_url: logoFromSettings || biz?.logo_url || null
          });
        }
      }

      let loadedWaiverSettings = {};

      // Load waiver settings before deciding which public template to show.
      if (businessId) {
        try {
          WaiverSettingsService.setBusinessId(businessId);
          const settings = await WaiverSettingsService.getGlobalSettings();
          loadedWaiverSettings = settings || {};
          setWaiverSettings(loadedWaiverSettings);
        } catch (error) {
          console.error('[PublicWaiverFlow] Error loading waiver settings:', error);
        }
      }

      let resolvedTemplateForFlow = null;

      // Load template: by templateKey if provided, otherwise resolve station/default behavior.
      if (businessId) {
        if (templateKey) {
          const { data: tmpl, error: tmplError } = await supabase
            .from('waiver_templates')
            .select('*')
            .eq('business_id', businessId)
            .eq('template_key', templateKey)
            .eq('is_active', true)
            .order('version', { ascending: false })
            .limit(1)
            .single();
          if (tmplError) {
            console.error('[PublicWaiverFlow] Template load error:', tmplError);
            toast.error('Error loading waiver template: ' + (tmplError.message || 'Template not found'));
          } else {
            resolvedTemplateForFlow = tmpl;
            setTemplate(tmpl);
          }
        } else {
          const { data: tmplRows, error: tmplError } = await supabase
            .from('waiver_templates')
            .select('*')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('version', { ascending: false })
            .order('created_at', { ascending: false });
          if (tmplError) {
            console.warn('[PublicWaiverFlow] Default template load error:', tmplError);
          } else {
            const latestTemplates = latestTemplatesByKey(tmplRows || []);
            const stationMode = loadedWaiverSettings?.waiver_station_mode === 'multi' ? 'multi' : 'single';
            const configuredStationOptions = buildStationTemplateOptions(latestTemplates, loadedWaiverSettings);
            setStationTemplateOptions(configuredStationOptions);

            if (!(stationMode === 'multi' && configuredStationOptions.length > 1)) {
              const defaultTemplateKey = String(
                loadedWaiverSettings?.waiver_station_default_template_key || ''
              ).trim();
              const resolvedTemplate =
                (stationMode === 'multi' && configuredStationOptions.length === 1
                  ? configuredStationOptions[0]?.template
                  : null) ||
                latestTemplates.find((item) => item.template_key === defaultTemplateKey) ||
                latestTemplates[0] ||
                null;

              if (resolvedTemplate) {
                resolvedTemplateForFlow = resolvedTemplate;
                setTemplate(resolvedTemplate);
              }
            }
          }
        }
      }

      // Browser kiosk opens /waiver/...?signingStation=browser_kiosk (on-site shared station).
      // Electron/full-screen app kiosk keeps detectLocationSource() → 'kiosk' (do not override).
      const signingStation = searchParams.get('signingStation');
      const isElectronWaiverKiosk =
        typeof window !== 'undefined' &&
        (window.electronAPI || window.__TAVARI_KIOSK_MODE__ || window.__TAVARI_ELECTRON__);
      const locationSourceOverride =
        !isElectronWaiverKiosk && signingStation === 'browser_kiosk' ? 'browser_kiosk' : null;
      const resolvedLocationData = await getLocationData(locationSourceOverride);
      setLocationData(resolvedLocationData);

      // Set up services
      WaiverSearchService.setBusinessId(businessId);
      WaiverParticipantService.setBusinessId(businessId);

      // Apply portal context (already resolved at top) – skip phone/OTP and pre-fill customer + participants
      if (portalContext) {
          setPhoneNumber(portalContext.phone_number || '');
          setOtpVerified(true);
          setCustomerInfo({
            customerId: portalContext.customer_id,
            phoneNumber: portalContext.phone_number || '',
            email: portalContext.email || ''
          });
          const rawParticipants = portalContext.participants || [];
          const minorAgeThreshold = resolvedTemplateForFlow?.minor_age_threshold ?? 18;
          const isMinor = (dob) => isMinorFromIsoDob(dob, minorAgeThreshold);
          let primary = rawParticipants.find(p => p.is_account_owner || p.participant_type === 'primary') || rawParticipants[0];
          // If no participants in DB, build synthetic primary from customer so we still skip phone/OTP
          if (!primary) {
            const email = portalContext.email || '';
            const namePart = (email && email.includes('@')) ? email.split('@')[0] : 'Account owner';
            primary = {
              id: portalContext.customer_id,
              first_name: namePart,
              last_name: '',
              date_of_birth: null,
              participant_type: 'primary',
              is_account_owner: true
            };
          }
          const rest = rawParticipants.filter(p => p.id !== primary.id);
          const minorsList = rest.filter(p => p.participant_type === 'minor' || (p.date_of_birth && isMinor(p.date_of_birth)));
          const adultsList = rest.filter(p => !minorsList.some(m => m.id === p.id));
          const ordered = [primary, ...minorsList, ...adultsList];
          const mapped = ordered.map((p, idx) => {
            const type = p.is_account_owner || p.participant_type === 'primary' ? 'primary'
              : (p.participant_type === 'minor' || (p.date_of_birth && isMinor(p.date_of_birth))) ? 'minor'
              : 'additional_adult';
            const dob = p.date_of_birth;
            const dateStr = dob ? (typeof dob === 'string' ? dob : dob.split?.('T')?.[0] || '') : '';
            return {
              type,
              data: {
                firstName: p.first_name || '',
                lastName: p.last_name || '',
                dateOfBirth: dateStr,
                phoneNumber: type === 'primary' ? (portalContext.phone_number || '') : undefined,
                email: type === 'primary' ? (portalContext.email || '') : undefined
              },
              signed: false,
              index: idx
            };
          });
          if (mapped.length > 0) {
            setParticipants(mapped);
            setNumberOfMinors(mapped.filter(p => p.type === 'minor').length);
            const first = mapped[0];
            setFormData({
              firstName: first.data.firstName || '',
              lastName: first.data.lastName || '',
              dateOfBirth: first.data.dateOfBirth || ''
            });
            setCurrentParticipantIndex(0);
            setCurrentStep('participants');
            setDisplayStep('participants');
            previousStepRef.current = 'participants';
            setLoading(false);
            // Strip portalToken from URL (keeps returnUrl); token is single-use so no need to keep it in address bar
            const nextSearch = new URLSearchParams(searchParams);
            nextSearch.delete('portalToken');
            const newSearch = nextSearch.toString();
            navigate({ pathname: location.pathname, search: newSearch ? `?${newSearch}` : '' }, { replace: true });
            return;
          }
      }

      const initialStep = templateKey && autoStart ? 'phone_entry' : 'welcome';
      setCurrentStep(initialStep);
      setDisplayStep(initialStep);
      previousStepRef.current = initialStep;
    } catch (error) {
      console.error('[PublicWaiverFlow] Error initializing:', error);
      toast.error('Error loading waiver');
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Phone Entry - Check for existing waiver
  const handlePhoneContinue = async () => {
    setShowLookupRetryModal(false);
    setLookupRetryMessage('');
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setCheckingWaiver(true);

    try {
      // Normalize phone number
      const normalizedPhone = normalizePhoneDigits(phoneNumber);

      if (forceNewWaiverDevOnly) {
        setHasExistingWaiver(false);
        setExistingWaiverHistory([]);
        setExistingWaiver(null);
        setExistingWaiverParticipants([]);
        setExistingWaiverOtpDelivery(null);
        setCustomerInfo((prev) => ({ ...prev, phoneNumber: normalizedPhone }));
        beginNewWaiverFlow(normalizedPhone);
        return;
      }

      // Check for existing valid waivers
      const waivers = await WaiverSearchService.searchByPhone(normalizedPhone);
      
      // Filter to only valid, non-expired waivers
      const validWaivers = waivers.filter(w => {
        if (!w.is_valid) return false;
        if (!w.expires_at) return true; // No expiry = always valid
        return !isWaiverExpired(w.expires_at);
      });

      if (validWaivers.length > 0) {
        // Prefer this kiosk/URL template so we don't show an older waiver from another template.
        let pool = validWaivers;
        if (template?.id) {
          const sameTemplate = validWaivers.filter((w) => w.template_id === template.id);
          if (sameTemplate.length > 0) pool = sameTemplate;
        }
        // Must pick newest by signed_at (search order is not guaranteed across filters/RPC).
        const signedAtMs = (w) => (w.signed_at ? new Date(w.signed_at).getTime() : 0);
        const latestWaiver = [...pool].sort((a, b) => signedAtMs(b) - signedAtMs(a))[0];

        // Full signed history (includes expired/old) for "view older waiver" after OTP
        const historySorted = sortWaiversBySignedAtDesc(
          waiversScopedToTemplate(waivers, template?.id)
        );
        setExistingWaiverHistory(
          historySorted.map((w) => ({
            id: w.id,
            signed_at: w.signed_at,
            expires_at: w.expires_at,
            is_valid: w.is_valid !== false
          }))
        );
        
        // Fetch waiver with template data
        const { data: waiverWithTemplate } = await supabase
          .from('waiver_signatures')
          .select(`
            *,
            waiver_templates:template_id (
                id,
                template_name,
                waiver_title,
                waiver_content,
                expiry_days,
                minor_age_threshold
              )
            `)
          .eq('id', latestWaiver.id)
          .single();
        
        // Load participants for this waiver
        const participants = await WaiverParticipantService.getParticipants(latestWaiver.id);
        
        const waiverRow = waiverWithTemplate || latestWaiver;
        setExistingWaiver(waiverRow);
        setExistingWaiverParticipants(participants || []);
        setHasExistingWaiver(true);

        const digitsForOtp = normalizePhoneDigits(normalizedPhone);
        setExistingWaiverOtpDelivery(
          resolveOtpDeliveryForExistingWaiver(waiverRow, participants || [], digitsForOtp)
        );
        const viewerResolved = resolveWaiverViewerAccess(waiverRow, participants || [], digitsForOtp);
        setExistingWaiverViewerAccess(viewerResolved.mode);
        setExistingWaiverViewerParticipantId(viewerResolved.participantId);

        // Save phone number for later use
        setCustomerInfo(prev => ({ ...prev, phoneNumber: normalizedPhone }));
        
        // Go to OTP step to verify identity before showing waiver
        setCurrentStep('otp');
      } else {
        // No valid waiver - continue with signing process
        setHasExistingWaiver(false);
        setExistingWaiverHistory([]);
        
        // Save phone number for use throughout the process
        setCustomerInfo(prev => ({ ...prev, phoneNumber: normalizedPhone }));
        
        beginNewWaiverFlow(normalizedPhone);
      }
    } catch (error) {
      console.error('[PublicWaiverFlow] Error checking for existing waiver:', error);
      setHasExistingWaiver(false);
      setExistingWaiverHistory([]);
      setExistingWaiverOtpDelivery(null);
      setLookupRetryMessage('We could not check for an existing waiver right now. Please try again.');
      setShowLookupRetryModal(true);
    } finally {
      setCheckingWaiver(false);
    }
  };

  // Step 2: OTP Authentication (only for viewing existing waivers)
  const handleSendOTP = async () => {
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    try {
      const normalizedPhone = normalizePhoneDigits(phoneNumber);

      let email = null;
      let customerId = existingWaiver?.customer_id || customerInfo?.customerId || null;
      let isAdditionalAdultOtp = false;

      // Always resolve from current phone + waiver + participants (never trust stale sidebar state alone).
      const otpDelivery = existingWaiver
        ? resolveOtpDeliveryForExistingWaiver(
            existingWaiver,
            existingWaiverParticipants || [],
            normalizedPhone
          )
        : null;

      const matched = otpDelivery?.matched ?? null;

      if (existingWaiver && otpDelivery) {
        const od = otpDelivery;
        if (matched === 'additional_adult') {
          if (!od.email) {
            toast.error(
              'No email is on file for this phone on the waiver. Ask staff to add your email to your participant record, or complete a new waiver.'
            );
            return;
          }
          email = od.email;
          isAdditionalAdultOtp = true;
          customerId = null;
        } else if (matched === 'signature') {
          email = od.email || null;
        } else if (matched === null) {
          toast.error(
            'This phone number is not on file for this waiver. Use the phone you signed with, or ask staff for help.'
          );
          return;
        }
      }

      if (!email && matched === 'signature') {
        email = existingWaiver?.email || customerInfo?.email || null;
      }

      // Signer only: loyalty / signature-table fallbacks (never for additional adult — wrong inbox).
      if (!email && matched === 'signature' && customerId) {
        try {
          const { data: customer, error: customerError } = await supabase
            .from('pos_loyalty_accounts')
            .select('customer_email')
            .eq('id', customerId)
            .single();

          if (customer?.customer_email) {
            email = customer.customer_email;
          } else if (customerError) {
            console.warn('[PublicWaiverFlow] Could not fetch customer email:', customerError);
          }
        } catch (error) {
          console.warn('[PublicWaiverFlow] Could not fetch customer email:', error);
        }
      }
      
      // Signer only: match signature row by digits (DB may store formatted phone).
      if (!email && matched === 'signature') {
        try {
          const { data: waiverRows, error: waiverError } = await supabase
            .from('waiver_signatures')
            .select('email, customer_id, phone_number')
            .eq('business_id', businessId)
            .not('email', 'is', null)
            .order('signed_at', { ascending: false })
            .limit(40);

          const waivers = (waiverRows || []).filter(
            (w) => w && normalizePhoneDigits(w.phone_number) === normalizedPhone
          );
          
          if (waivers && waivers.length > 0 && waivers[0].email) {
            email = waivers[0].email;
            if (!customerId && waivers[0].customer_id) {
              customerId = waivers[0].customer_id;
            }
          } else if (waiverError) {
            console.warn('[PublicWaiverFlow] Could not fetch email from waivers:', waiverError);
          }
        } catch (error) {
          console.warn('[PublicWaiverFlow] Could not fetch email from waivers:', error);
        }
      }

      if (!email) {
        toast.error('Email is required for OTP delivery. Please provide an email address.');
        return;
      }

      const result = await waiverOTPService.generateOTP(
        businessId,
        normalizedPhone,
        email,
        customerId
      );

      if (result.success) {
        setOtpSent(true);
        toast.success(
          isAdditionalAdultOtp
            ? 'OTP sent to the email on file for this phone on the waiver'
            : 'OTP sent to your email'
        );
        setCustomerInfo({
          ...customerInfo,
          email: result.email || email,
          customerId: isAdditionalAdultOtp ? null : result.customerId || customerId,
          phoneNumber: normalizedPhone
        });
      } else {
        toast.error(result.error || 'Failed to send OTP');
      }
    } catch (error) {
      console.error('[PublicWaiverFlow] Error sending OTP:', error);
      toast.error('Error sending OTP');
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || otpCode.length !== 6) {
      toast.error('Please enter a valid 6-digit OTP code');
      return;
    }

    try {
      const normalizedPhone = normalizePhoneDigits(phoneNumber);
      const result = await waiverOTPService.verifyOTP(
        normalizedPhone,
        otpCode,
        businessId
      );

      if (result.valid) {
        setOtpVerified(true);
        setCustomerInfo({
          ...customerInfo,
          customerId: result.customer_id ?? null,
          email: result.email || customerInfo?.email,
          phoneNumber: result.phone_number || normalizedPhone
        });

        toast.success('OTP verified successfully');
        
        // If we have an existing waiver, show completion screen with countdown; otherwise continue to signing
        if (hasExistingWaiver && existingWaiver) {
          try {
            const waiversFresh = await WaiverSearchService.searchByPhone(normalizedPhone);
            const historySorted = sortWaiversBySignedAtDesc(
              waiversScopedToTemplate(waiversFresh, template?.id)
            );
            setExistingWaiverHistory(
              historySorted.map((w) => ({
                id: w.id,
                signed_at: w.signed_at,
                expires_at: w.expires_at,
                is_valid: w.is_valid !== false
              }))
            );
          } catch (histErr) {
            console.warn('[PublicWaiverFlow] Could not refresh waiver history:', histErr);
          }
          // Fetch participants with all their data including signatures
          const { data: waiverParticipants } = await supabase
            .from('waiver_participants')
            .select('*')
            .eq('waiver_id', existingWaiver.id)
            .order('created_at', { ascending: true });
          
          // Fetch waiver with template data
          const { data: waiverWithTemplate } = await supabase
            .from('waiver_signatures')
            .select(`
              *,
              waiver_templates:template_id (
                id,
                template_name,
                waiver_title,
                waiver_content,
                expiry_days,
                minor_age_threshold
              )
            `)
            .eq('id', existingWaiver.id)
            .single();
          
          setExistingWaiver(waiverWithTemplate || existingWaiver);
          setExistingWaiverParticipants(waiverParticipants || []);
          const resolved = resolveWaiverViewerAccess(
            waiverWithTemplate || existingWaiver,
            waiverParticipants || [],
            normalizedPhone
          );
          setExistingWaiverViewerAccess(resolved.mode);
          setExistingWaiverViewerParticipantId(resolved.participantId);
          setCurrentStep('existing_waiver');
        } else {
          beginNewWaiverFlow(normalizedPhone);
        }
      } else {
        toast.error(result.error || 'Invalid OTP code');
      }
    } catch (error) {
      console.error('[PublicWaiverFlow] Error verifying OTP:', error);
      toast.error('Error verifying OTP');
    }
  };

  /** Load another signed version from history (after OTP). */
  /** Clear on-file waiver data from memory before check-in screen (privacy). */
  const handleContinueFromExistingWaiver = () => {
    setExistingWaiver(null);
    setExistingWaiverParticipants([]);
    setExistingWaiverHistory([]);
    setHasExistingWaiver(false);
    setExistingWaiverViewerAccess('signer');
    setExistingWaiverViewerParticipantId(null);
    setExistingWaiverOtpDelivery(null);
    setCurrentStep('existing_waiver_checkin');
  };

  const handleSelectExistingWaiverVersion = async (waiverId) => {
    if (!waiverId || waiverId === existingWaiver?.id) return;
    try {
      const { data: waiverWithTemplate, error } = await supabase
        .from('waiver_signatures')
        .select(`
          *,
          waiver_templates:template_id (
            id,
            template_name,
            waiver_title,
            waiver_content,
            expiry_days,
            minor_age_threshold
          )
        `)
        .eq('id', waiverId)
        .single();
      if (error) throw error;
      const parts = await WaiverParticipantService.getParticipants(waiverId);
      setExistingWaiver(waiverWithTemplate);
      setExistingWaiverParticipants(parts || []);
      const digits = normalizePhoneDigits(phoneNumber);
      setExistingWaiverOtpDelivery(
        resolveOtpDeliveryForExistingWaiver(waiverWithTemplate, parts || [], digits)
      );
      const resolved = resolveWaiverViewerAccess(waiverWithTemplate, parts || [], digits);
      setExistingWaiverViewerAccess(resolved.mode);
      setExistingWaiverViewerParticipantId(resolved.participantId);
    } catch (e) {
      console.error('[PublicWaiverFlow] load waiver version:', e);
      toast.error('Could not load that waiver. Try again.');
    }
  };

  const beginNewWaiverFlow = (normalizedPhone = '') => {
    const phone = normalizedPhone || normalizePhoneDigits(phoneNumber || customerInfo?.phoneNumber || '');
    const primaryParticipant = {
      type: 'primary',
      data: {
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        birthYear: '',
        birthMonth: '',
        birthDay: '',
        email: '',
        phoneNumber: phone,
        address: '',
        city: '',
        postalCode: ''
      },
      signed: false,
      index: 0
    };
    setParticipants([primaryParticipant]);
    setCurrentParticipantIndex(0);
    setFormData({ ...primaryParticipant.data });
    setNumberOfMinors(0);
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    setLegalWarningShown(false);
    setCurrentStep('participants');
  };

  // Step 4: Waiver Agreement (Scroll and Agree) - NEW FLOW: After all participant info is entered
  const handleAgreementScroll = (e) => {
    const element = e.target;
    const scrolledToBottom = 
      element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    
    if (scrolledToBottom && !agreementScrolled) {
      setAgreementScrolled(true);
    }
  };

  const handleAgreementAgree = (nextConsentStates = {}) => {
    if (!agreementScrolled) {
      toast.error('Please scroll to the bottom of the waiver to read it completely');
      return;
    }
    const currentParticipant = participants[currentParticipantIndex];
    if (currentParticipant?.type === 'additional_adult') {
      setParticipants((prev) => {
        const next = [...prev];
        if (next[currentParticipantIndex]) {
          next[currentParticipantIndex] = {
            ...next[currentParticipantIndex],
            consentStates: {
              ...(next[currentParticipantIndex].consentStates || {}),
              ...(nextConsentStates || {})
            }
          };
        }
        return next;
      });
    } else {
      setConsents((prev) => ({
        ...(prev || {}),
        ...(nextConsentStates || {})
      }));
    }
    setAgreementAgreed(true);
    setCurrentStep('signature');
  };

  const handleAgreementConsentChange = (nextConsentStates) => {
    const currentParticipant = participants[currentParticipantIndex];
    if (currentParticipant?.type === 'additional_adult') {
      setParticipants((prev) => {
        const next = [...prev];
        if (next[currentParticipantIndex]) {
          next[currentParticipantIndex] = {
            ...next[currentParticipantIndex],
            consentStates: {
              ...(next[currentParticipantIndex].consentStates || {}),
              ...(nextConsentStates || {})
            }
          };
        }
        return next;
      });
      return;
    }
    setConsents(nextConsentStates || {});
  };

  // Step 5: Participant Information Entry
  const handleParticipantInfoSubmit = (data) => {
    console.log('[PublicWaiverFlow] handleParticipantInfoSubmit called:', {
      currentParticipantIndex,
      participantType: participants[currentParticipantIndex]?.type,
      data,
      participantsCount: participants.length
    });
    
    const updatedParticipants = [...participants];
    updatedParticipants[currentParticipantIndex].data = data;
    console.log('[PublicWaiverFlow] Updated participants:', updatedParticipants.map(p => ({
      type: p.type,
      hasData: !!p.data,
      dataKeys: p.data ? Object.keys(p.data) : []
    })));
    setParticipants(updatedParticipants);

    if (reviewEditIndex !== null) {
      setReviewEditIndex(null);
      focusPrimaryParticipant(updatedParticipants);
      setCurrentStep('review');
      return;
    }

    // NEW FLOW: Check participant type to determine next step
    const currentParticipant = participants[currentParticipantIndex];
    
    if (currentParticipant.type === 'additional_adult') {
      setAgreementScrolled(false);
      setAgreementAgreed(false);
      setCurrentStep('agreement');
    } else if (currentParticipant.type === 'minor') {
      setCurrentStep('children');
    } else if (currentParticipant.type === 'primary') {
      setCurrentStep('children');
    }
  };

  const focusPrimaryParticipant = (list = participants) => {
    const primary = Array.isArray(list) ? list.find((p) => p.type === 'primary') : null;
    setCurrentParticipantIndex(0);
    setFormData(primary?.data ? { ...primary.data } : {});
  };

  const participantNeedsName = (participant) => {
    if (!participant || (participant.type !== 'minor' && participant.type !== 'additional_adult')) return false;
    if (participant.signed) return false;
    const firstName = String(participant?.data?.firstName || '').trim();
    const lastName = String(participant?.data?.lastName || '').trim();
    return !firstName || !lastName;
  };

  const openIncompleteParticipant = (step, fallbackIndex = null) => {
    const incompleteIndex = participants.findIndex(participantNeedsName);
    const targetIndex = incompleteIndex !== -1 ? incompleteIndex : fallbackIndex;
    if (targetIndex == null || targetIndex < 0 || !participants[targetIndex]) {
      return false;
    }

    setCurrentParticipantIndex(targetIndex);
    setFormData(participants[targetIndex]?.data ? { ...participants[targetIndex].data } : {});
    setParticipantModal({ open: true, index: targetIndex, isNew: incompleteIndex === targetIndex });
    setCurrentStep(step);
    return true;
  };

  const closeParticipantModal = (removeIfBlank = true) => {
    const modalState = participantModal;
    if (reviewEditIndex !== null) {
      setParticipantModal({ open: false, index: null, isNew: false });
      setReviewEditIndex(null);
      focusPrimaryParticipant();
      setCurrentStep('review');
      return;
    }
    if (modalState.open && modalState.isNew && removeIfBlank) {
      setParticipants((prev) => {
        const target = prev[modalState.index];
        const hasData = !!target?.data && Object.values(target.data).some((value) => String(value || '').trim() !== '');
        if (hasData || target?.signed) return prev;
        return prev
          .filter((_, index) => index !== modalState.index)
          .map((participant, index) => ({ ...participant, index }));
      });
    }
    setParticipantModal({ open: false, index: null, isNew: false });
    focusPrimaryParticipant();
  };

  const handleParticipantModalSubmit = (data) => {
    const modalIndex = participantModal.index;
    const updatedParticipants = [...participants];
    updatedParticipants[modalIndex] = {
      ...updatedParticipants[modalIndex],
      data
    };
    if (updatedParticipants[modalIndex]?.type === 'additional_adult') {
      updatedParticipants[modalIndex] = {
        ...updatedParticipants[modalIndex],
        consentStates: {
          ...(updatedParticipants[modalIndex].consentStates || {}),
          waiverTerms: false
        }
      };
    }
    setParticipants(updatedParticipants);
    setParticipantModal({ open: false, index: null, isNew: false });

    if (reviewEditIndex !== null) {
      setReviewEditIndex(null);
      focusPrimaryParticipant(updatedParticipants);
      setCurrentStep('review');
      return;
    }

    if (updatedParticipants[modalIndex]?.type === 'additional_adult') {
      setCurrentParticipantIndex(modalIndex);
      setFormData(data);
      setAgreementScrolled(false);
      setAgreementAgreed(false);
      setCurrentStep('agreement');
      return;
    }

    focusPrimaryParticipant(updatedParticipants);
    toast.success('Child added. You can add another participant or continue.');
    setCurrentStep('children');
  };

  // Step 6: Signature - NEW FLOW: Primary adult signs once, then ask for additional adults
  const handleSignatureComplete = async (signature) => {
    const updatedParticipants = [...participants];
    updatedParticipants[currentParticipantIndex].signatureData = signature;
    updatedParticipants[currentParticipantIndex].signed = true;
    if (updatedParticipants[currentParticipantIndex]?.type === 'additional_adult') {
      updatedParticipants[currentParticipantIndex].consentStates = {
        ...(updatedParticipants[currentParticipantIndex].consentStates || {}),
        waiverTerms: true,
        electronicSignature: true
      };
    }
    setParticipants(updatedParticipants);

    if (updatedParticipants[currentParticipantIndex]?.type === 'primary') {
      setCurrentStep('additional_adult');
    } else {
      setCurrentStep('additional_adult');
    }
  };

  // Legal Warning for Additional Adults - NEW FLOW: Not used in new flow, but keep for compatibility
  const handleLegalWarningAcknowledge = () => {
    setLegalWarningShown(true);
    // Each additional adult must read and agree to the waiver
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    // NEW FLOW: After legal warning, go to signature for additional adult
    setCurrentStep('signature');
  };

  // Handle review step edit
  const handleReviewEdit = (updatedParticipants) => {
    if (Array.isArray(updatedParticipants)) {
      setParticipants(updatedParticipants);
      return;
    }

    const participantIndex = Number(updatedParticipants);
    const targetParticipant = participants[participantIndex];
    if (!targetParticipant) return;

    setReviewEditIndex(participantIndex);
    setCurrentParticipantIndex(participantIndex);
    setFormData(targetParticipant?.data ? { ...targetParticipant.data } : {});

    if (targetParticipant.type === 'primary') {
      setCurrentStep('participants');
      return;
    }

    setParticipantModal({ open: true, index: participantIndex, isNew: false });
    setCurrentStep(targetParticipant.type === 'minor' ? 'children' : 'additional_adult');
  };

  // Handle review step submit
  const handleReviewSubmit = async () => {
    await submitWaiver();
  };

  const requestAddAdditionalAdult = () => {
    if (openIncompleteParticipant('additional_adult')) {
      toast.error('Please finish the current additional adult before adding another.');
      return;
    }
    confirmAddAdditionalAdultIntent();
  };

  const proceedAddAdditionalAdult = () => {
    const updatedParticipants = [...participants];
    updatedParticipants.push({
      type: 'additional_adult',
      data: {},
      signed: false,
      index: updatedParticipants.length,
      portalAccess: pendingAdditionalAdultPortalAccess
    });
    setParticipants(updatedParticipants);
    setCurrentParticipantIndex(updatedParticipants.length - 1);
    setLegalWarningShown(false);
    setFormData({
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      birthYear: '',
      birthMonth: '',
      birthDay: '',
      email: '',
      phoneNumber: '',
      address: '',
      city: '',
      postalCode: '',
      usePrimaryAddress: false
    });
    setParticipantModal({ open: true, index: updatedParticipants.length - 1, isNew: true });
    setCurrentStep('additional_adult');
  };

  const confirmAddAdditionalAdultIntent = async () => {
    try {
      const { getIPAddress } = await import('../../utils/waiverLocationTracking');
      const {
        getAdditionalAdultIntentAcknowledgmentFullText,
        ADDITIONAL_ADULT_INTENT_DISCLAIMER_VERSION
      } = await import('../../constants/waiverLegalCopy');
      const ip = await getIPAddress().catch(() => 'unknown');
      const ack = {
        acknowledged_at: new Date().toISOString(),
        disclaimer_version: ADDITIONAL_ADULT_INTENT_DISCLAIMER_VERSION,
        acknowledgment_text: getAdditionalAdultIntentAcknowledgmentFullText(),
        ip_address: ip || null,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null
      };
      setAdditionalAdultIntentAcknowledgments((prev) => [...prev, ack]);
      proceedAddAdditionalAdult();
    } catch (e) {
      console.error('[PublicWaiverFlow] additional adult intent ack:', e);
      toast.error('Could not record acknowledgment. Please try again.');
    }
  };

  const handleSkipAdditionalAdult = () => {
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    const currentParticipant = participants[currentParticipantIndex];

    if (currentParticipant?.type === 'additional_adult') {
      setParticipantModal({ open: false, index: null, isNew: false });
      focusPrimaryParticipant();
      setCurrentStep('additional_adult');
      return;
    }

    setCurrentParticipantIndex(0);
    setCurrentStep('agreement');
  };

  const handleContinueParticipantSetup = () => {
    if (openIncompleteParticipant('additional_adult')) {
      toast.error('Please enter a first and last name for each additional adult before continuing.');
      return;
    }
    setCurrentParticipantIndex(0);
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    setCurrentStep('review');
  };

  const handleParticipantManagementBack = () => {
    focusPrimaryParticipant();
    setCurrentStep('participants');
  };

  const handleContinueChildrenSetup = () => {
    if (openIncompleteParticipant('children')) {
      toast.error('Please enter a first and last name for each child before continuing.');
      return;
    }
    setCurrentParticipantIndex(0);
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    setCurrentStep('agreement');
  };

  const handleAgreementBack = () => {
    const currentParticipant = participants[currentParticipantIndex];
    if (currentParticipant?.type === 'additional_adult') {
      setParticipantModal({ open: true, index: currentParticipantIndex, isNew: false });
      setCurrentStep('additional_adult');
      return;
    }
    focusPrimaryParticipant();
    setCurrentStep('children');
  };

  const handleSignatureBack = () => {
    if (participants[currentParticipantIndex]?.type === 'additional_adult') {
      setAgreementAgreed(false);
    }
    setCurrentStep('agreement');
  };

  const handleReviewBack = () => {
    setCurrentParticipantIndex(0);
    setCurrentStep('additional_adult');
  };

  /** Insert a new minor after existing minors, before additional adults; then open that minor's form. */
  const handleAddMinorDuringParticipants = () => {
    if (openIncompleteParticipant('children')) {
      toast.error('Please finish the current child before adding another.');
      return;
    }

    const computeNewMinorInsertIndex = (prev) => {
      const firstAdultIdx = prev.findIndex((p) => p.type === 'additional_adult');
      if (firstAdultIdx !== -1) return firstAdultIdx;
      let lastMinorIdx = 0;
      for (let i = 1; i < prev.length; i++) {
        if (prev[i].type === 'minor') lastMinorIdx = i;
      }
      return prev.some((p) => p.type === 'minor') ? lastMinorIdx + 1 : 1;
    };

    let insertedIndex = 0;
    let primaryData = {};
    flushSync(() => {
      setParticipants((prev) => {
        insertedIndex = computeNewMinorInsertIndex(prev);
        const primary = prev.find((p) => p.type === 'primary');
        primaryData = primary?.data || {};
        const next = [...prev];
        next.splice(insertedIndex, 0, {
          type: 'minor',
          data: {},
          signed: false
        });
        next.forEach((p, i) => {
          p.index = i;
        });
        return next;
      });
    });
    setNumberOfMinors((n) => n + 1);
    setCurrentParticipantIndex(insertedIndex);
    setFormData({
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      birthYear: '',
      birthMonth: '',
      birthDay: '',
      email: '',
      phoneNumber: '',
      address: primaryData.address || '',
      city: primaryData.city || '',
      postalCode: primaryData.postalCode || ''
    });
    setParticipantModal({ open: true, index: insertedIndex, isNew: true });
    setCurrentStep('children');
  };

  // Submit Waiver - NEW FLOW: Called from review step
  const submitWaiver = async () => {
    const genericSubmitError = 'We could not complete your waiver. Please try again.';
    try {
      setSigning(true);
      
      // Import submission service
      const { waiverSubmissionService } = await import('../../services/Waivers/WaiverSubmissionService');
      
      // Prepare submission data
      console.log('[PublicWaiverFlow] Submitting waiver with participants:', participants.map(p => ({
        type: p.type,
        hasData: !!p.data,
        signed: p.signed,
        dataKeys: p.data ? Object.keys(p.data) : [],
        name: p.data ? `${p.data.firstName} ${p.data.lastName}` : 'No data'
      })));
      
      const submissionData = {
        businessId,
        templateId: template?.id,
        customerInfo,
        participants,
        locationData,
        business,
        consentStates: consents,
        additionalAdultIntentAcknowledgments
      };

      const result = await waiverSubmissionService.submitWaiver(submissionData);

      if (result.success) {
        // Fetch the submitted waiver for completion screen
        const { data: submittedWaiverData } = await supabase
          .from('waiver_signatures')
          .select(`
            *,
            waiver_participants (*)
          `)
          .eq('id', result.waiverId)
          .single();

        setSubmittedWaiver(submittedWaiverData);
        toast.success('Waiver signed successfully!');
        setCurrentStep('completion');
      } else {
        throw new Error(genericSubmitError);
      }
    } catch (error) {
      console.error('[PublicWaiverFlow] Error submitting waiver:', error);
      toast.error(error?.message || genericSubmitError);
    } finally {
      setSigning(false);
    }
  };

  // Handle completion screen actions
  const resetToWelcome = ({ showIdleOverlay = false } = {}) => {
    setPhoneNumber('');
    setCheckingWaiver(false);
    setExistingWaiver(null);
    setExistingWaiverParticipants([]);
    setExistingWaiverHistory([]);
    setHasExistingWaiver(false);
    setOtpCode('');
    setOtpSent(false);
    setOtpVerified(false);
    setCustomerInfo(null);
    setParticipants([]);
    setCurrentParticipantIndex(0);
    setFormData({});
    setNumberOfMinors(0);
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    setLegalWarningShown(false);
    setSignatureData(null);
    setSigning(false);
    setSubmittedWaiver(null);
    setAdditionalAdultIntentAcknowledgments([]);
    setExistingWaiverViewerAccess('signer');
    setExistingWaiverViewerParticipantId(null);
    setPendingAdditionalAdultPortalAccess(DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS);
    setExistingWaiverOtpDelivery(null);
    setCurrentStep('welcome');
    setDisplayStep('welcome');
    setIsTransitioning(false);
    previousStepRef.current = 'welcome';
    toast.dismiss();

    if (showIdleOverlay) {
      showIdleOverlayIfAvailable();
    } else {
      setShowKioskIdleOverlay(false);
    }
  };

  const handleNewWaiver = () => {
    const preservedPhone = normalizePhoneDigits(phoneNumber || customerInfo?.phoneNumber || '');
    // Reset all state to start a new waiver
    setPhoneNumber('');
    setCheckingWaiver(false);
    setExistingWaiver(null);
    setExistingWaiverParticipants([]);
    setExistingWaiverHistory([]);
    setHasExistingWaiver(false);
    setOtpCode('');
    setOtpSent(false);
    setOtpVerified(false);
    setCustomerInfo(null);
    setParticipants([]);
    setCurrentParticipantIndex(0);
    setFormData({});
    setNumberOfMinors(0);
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    setLegalWarningShown(false);
    setSignatureData(null);
    setSigning(false);
    setSubmittedWaiver(null);
    setAdditionalAdultIntentAcknowledgments([]);
    setExistingWaiverViewerAccess('signer');
    setExistingWaiverViewerParticipantId(null);
    setPendingAdditionalAdultPortalAccess(DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS);
    setExistingWaiverOtpDelivery(null);
    
    beginNewWaiverFlow(preservedPhone);
    toast.dismiss();
    toast.success('Starting new waiver...');
  };

  const handleCancel = (options = {}) => {
    resetToWelcome({ showIdleOverlay: options?.reason === 'idle_ad' });
  };

  const handleWelcomeStart = () => {
    setShowKioskIdleOverlay(false);
    if (!templateKey && stationTemplateOptions.length > 1) {
      setCurrentStep('template_select');
      return;
    }

    setCurrentStep('phone_entry');
  };

  const isKioskMode = isPublicWaiverKioskMode(searchParams);
  const completionRedirect = resolvePublicWaiverCompletionRedirect({
    returnUrl: isKioskMode ? null : returnUrl,
    businessWebsite: business?.business_website,
    isKioskMode
  });

  const handleClose = (options = {}) => {
    if (isKioskMode) {
      resetToWelcome({ showIdleOverlay: options?.reason === 'idle_ad' });
      return;
    }

    const redirect = resolvePublicWaiverCompletionRedirect({
      returnUrl,
      businessWebsite: business?.business_website,
      isKioskMode: false
    });

    if (redirect?.kind === 'in_app') {
      navigate(redirect.href);
      return;
    }
    if (redirect?.kind === 'external') {
      window.location.assign(redirect.href);
      return;
    }

    resetToWelcome({ showIdleOverlay: options?.reason === 'idle_ad' });
  };

  // Handle Resign - Pre-fill all information from existing waiver but still require full flow
  const handleResign = async () => {
    if (!submittedWaiver && !existingWaiver) {
      toast.error('No waiver found to resign');
      return;
    }

    const waiverToResign = submittedWaiver || existingWaiver;
    
    // Fetch full waiver data with template and participants
    const { data: fullWaiver } = await supabase
      .from('waiver_signatures')
      .select(`
        *,
        waiver_templates:template_id (
          id,
          template_name,
          waiver_title,
          waiver_content
        )
      `)
      .eq('id', waiverToResign.id)
      .single();

    const { data: waiverParticipants } = await supabase
      .from('waiver_participants')
      .select('*')
      .eq('waiver_id', waiverToResign.id);

    const viewerParticipantId =
      existingWaiverViewerParticipantId != null ? String(existingWaiverViewerParticipantId) : null;
    const matchedAdditionalAdult =
      viewerParticipantId && existingWaiverViewerAccess !== 'signer'
        ? (waiverParticipants || []).find((p) => String(p?.id || '') === viewerParticipantId)
        : null;
    const resignOwnAdditionalAdult =
      !!matchedAdditionalAdult &&
      String(matchedAdditionalAdult?.participant_type || '').toLowerCase() === 'additional_adult';

    const minorThreshold =
      waiverSettings?.minor_age_threshold ?? template?.minor_age_threshold ?? 18;

    const inferParticipantIsMinor = (p) => {
      const t = String(p.participant_type || p.type || '').toLowerCase();
      if (t === 'minor') return true;
      if (t === 'primary' || t === 'additional_adult') return false;
      return isMinorFromIsoDob(p.date_of_birth, minorThreshold);
    };

    const resignSource = resignOwnAdditionalAdult ? matchedAdditionalAdult : fullWaiver;
    const primaryDobParts = birthFormPartsFromValue(resignSource?.date_of_birth);

    // Pre-fill primary adult information
    const primaryAdultData = {
      firstName: resignSource?.first_name || '',
      lastName: resignSource?.last_name || '',
      dateOfBirth: resignSource?.date_of_birth || '',
      birthYear: primaryDobParts.year,
      birthMonth: primaryDobParts.month,
      birthDay: primaryDobParts.day,
      email: resignSource?.email || '',
      phoneNumber: resignSource?.phone_number || customerInfo?.phoneNumber || '',
      address: resignSource?.address || '',
      city: resignSource?.city || '',
      postalCode: resignSource?.postal_code || ''
    };

    // Build participants array with pre-filled data
    const newParticipants = [
      {
        type: 'primary',
        data: primaryAdultData,
        signed: false,
        index: 0  // Add index for consistent identification
      }
    ];

    if (!resignOwnAdditionalAdult) {
      // Minors: explicit type or inferred from age (legacy rows)
      const minors = (waiverParticipants || []).filter(
        (p) => inferParticipantIsMinor(p)
      );
      minors.forEach((minor, index) => {
        const dobRaw = minor.date_of_birth || '';
        const minorDobParts = birthFormPartsFromValue(dobRaw);
        newParticipants.push({
          type: 'minor',
          data: {
            firstName: minor.first_name || '',
            lastName: minor.last_name || '',
            dateOfBirth: dobRaw || '',
            birthYear: minorDobParts.year,
            birthMonth: minorDobParts.month,
            birthDay: minorDobParts.day,
            address: primaryAdultData.address,
            city: primaryAdultData.city,
            postalCode: primaryAdultData.postalCode
          },
          signed: false,
          index: index + 1
        });
      });

      // Add additional adults (indices after minors)
      const additionalAdults = (waiverParticipants || []).filter((p) => {
        const t = String(p.participant_type || p.type || '').toLowerCase();
        return t === 'additional_adult';
      });
      const portalAllowed = new Set(Object.values(WAIVER_PORTAL_ACCESS));
      additionalAdults.forEach((adult, index) => {
        const dobRaw = adult.date_of_birth || '';
        const adultDobParts = birthFormPartsFromValue(dobRaw);
        const pa = adult.participant_portal_access;
        const portalAccess = portalAllowed.has(pa) ? pa : DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS;
        newParticipants.push({
          type: 'additional_adult',
          data: {
            firstName: adult.first_name || '',
            lastName: adult.last_name || '',
            dateOfBirth: dobRaw || '',
            birthYear: adultDobParts.year,
            birthMonth: adultDobParts.month,
            birthDay: adultDobParts.day,
            email: adult.email || '',
            phoneNumber: adult.phone_number || '',
            address: adult.address || '',
            city: adult.city || '',
            postalCode: adult.postal_code || '',
            usePrimaryAddress: false
          },
          signed: false,
          index: 1 + minors.length + index,
          portalAccess
        });
      });
    }

    // Set all state with pre-filled data (same order as handleMinorsSelected: primary @0, minors @1..n)
    setParticipants(newParticipants);
    setNumberOfMinors(minors.length);

    setCurrentParticipantIndex(0);
    setFormData(primaryAdultData);
    
    // IMPORTANT: Reset agreement state so they must scroll and check boxes again
    setAgreementScrolled(false);
    setAgreementAgreed(false);
    setLegalWarningShown(false);
    setSignatureData(null);
    
    // Update customer info
    setCustomerInfo({
      ...customerInfo,
      phoneNumber: fullWaiver.phone_number || customerInfo?.phoneNumber,
      email: fullWaiver.email || customerInfo?.email
    });

    // Navigate to participants step (will show primary adult info pre-filled)
    setCurrentStep('participants');
    toast.success('Waiver information pre-filled. Please review and complete the waiver process.');
  };

  const handleDismissKioskIdleOverlay = useCallback((event) => {
    if (event?.preventDefault) event.preventDefault();
    if (event?.stopPropagation) event.stopPropagation();
    setShowKioskIdleOverlay(false);
    setCurrentStep('welcome');
    setDisplayStep('welcome');
    setIsTransitioning(false);
    previousStepRef.current = 'welcome';
  }, []);

  const renderWithKioskIdleOverlay = (content) => (
    <>
      {kioskFullscreenChrome}
      {content}
      {showKioskIdleOverlay && kioskIdleAds.length > 0 ? (
        <KioskIdleAdCarousel
          ads={kioskIdleAds}
          initialIndex={currentKioskIdleAdIndex % kioskIdleAds.length}
          slideSeconds={clampKioskAdSlideSeconds(waiverSettings?.waiver_kiosk_ad_slide_seconds)}
          onDismiss={handleDismissKioskIdleOverlay}
          onImageError={handleKioskIdleAdImageError}
        />
      ) : null}
    </>
  );

  if (loading) {
    return (
      <>
        {kioskFullscreenChrome}
        <div style={styles.container}>
          <div style={styles.loading}>
            <p>Loading...</p>
          </div>
        </div>
      </>
    );
  }

  // Show loading transition between steps
  if (isTransitioning) {
    return (
      <>
        {kioskFullscreenChrome}
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <div style={styles.container}>
          <div style={styles.loading}>
            <div style={styles.loadingSpinner}></div>
            <p style={styles.loadingText}>Loading...</p>
          </div>
        </div>
      </>
    );
  }

  // If template is required but not loaded, show error
  if (templateKey && !template && !loading) {
    return (
      <>
        {kioskFullscreenChrome}
        <div style={styles.container}>
        <div style={styles.error}>
          <FiAlertCircle size={48} style={{ color: TavariStyles.colors.error, marginBottom: '1rem' }} />
          <h2>Waiver Template Not Found</h2>
          <p>The waiver template could not be loaded. Please check the template key and try again.</p>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '0.5rem' }}>
            Template Key: {templateKey}<br />
            Business ID: {businessId}
          </p>
        </div>
      </div>
      </>
    );
  }

  // If we came without a template key (e.g. from booking portal) but no default template exists for this business
  if (
    !templateKey &&
    businessId &&
    !template &&
    !loading &&
    stationTemplateOptions.length <= 1 &&
    displayStep !== 'template_select'
  ) {
    return (
      <>
        {kioskFullscreenChrome}
        <div style={styles.container}>
        <div style={styles.error}>
          <FiAlertCircle size={48} style={{ color: TavariStyles.colors.error, marginBottom: '1rem' }} />
          <h2>No Waiver Configured</h2>
          <p>This business has not set up a waiver yet. Please contact the business or skip the waiver step when booking.</p>
        </div>
      </div>
      </>
    );
  }

  // Render current step (use displayStep for actual rendering)
  switch (displayStep) {
    case 'template_select':
      return renderWithKioskIdleOverlay(
        <WaiverTemplateSelectStep
          business={business}
          options={stationTemplateOptions}
          onSelect={(option) => {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('autoStart', '1');
            const nextQuery = nextParams.toString();
            navigate(
              `/waiver/${businessId}/${option.templateKey}${nextQuery ? `?${nextQuery}` : ''}`,
              { replace: true }
            );
          }}
          onCancel={handleCancel}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'welcome':
      return renderWithKioskIdleOverlay(
        <WelcomeStep
          business={business}
          onStart={handleWelcomeStart}
          onCancel={handleCancel}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'phone_entry':
      return renderWithKioskIdleOverlay(
        <PhoneEntryStep
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          onContinue={handlePhoneContinue}
          loading={checkingWaiver}
          onCancel={handleCancel}
          showLookupRetryModal={showLookupRetryModal}
          lookupRetryMessage={lookupRetryMessage}
          onRetryLookup={handlePhoneContinue}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'otp':
      return renderWithKioskIdleOverlay(
        <OTPStep
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          otpCode={otpCode}
          setOtpCode={setOtpCode}
          otpSent={otpSent}
          otpVerified={otpVerified}
          setOtpSent={setOtpSent}
          onSendOTP={handleSendOTP}
          onVerifyOTP={handleVerifyOTP}
          onSkip={handleNewWaiver}
          onCancel={handleCancel}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'existing_waiver':
      if (!existingWaiver) {
        return renderWithKioskIdleOverlay(
          <WelcomeStep
            business={business}
            onStart={handleWelcomeStart}
            onCancel={handleCancel}
            suspendInactivityTimer={suspendStepIdleTimer}
          />
        );
      }
      // Show existing waiver view (Path 3 Step 4) - view-only with Sign New Waiver button
      return renderWithKioskIdleOverlay(
        <ExistingWaiverViewStep
          waiver={existingWaiver}
          participants={existingWaiverParticipants}
          waiverHistory={existingWaiverHistory}
          onSelectWaiverVersion={handleSelectExistingWaiverVersion}
          business={business}
          template={existingWaiver?.waiver_templates || template}
          onSignNewWaiver={handleResign}
          onContinue={handleContinueFromExistingWaiver}
          onCancel={handleCancel}
          waiverSettings={waiverSettings}
          viewerAccessMode={existingWaiverViewerAccess}
          viewerParticipantId={existingWaiverViewerParticipantId}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'existing_waiver_checkin':
      return renderWithKioskIdleOverlay(<ExistingWaiverCheckInStep onDone={handleClose} />);
    case 'participants':
      return renderWithKioskIdleOverlay(
        <ParticipantInfoStep
          participant={participants[currentParticipantIndex]}
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleParticipantInfoSubmit}
          template={template}
          customerInfo={customerInfo}
          businessTimezone={business?.timezone || 'America/Toronto'}
          onBack={() => {
            if (reviewEditIndex !== null) {
              setReviewEditIndex(null);
              focusPrimaryParticipant();
              setCurrentStep('review');
              return;
            }
            setCurrentStep('phone_entry');
          }}
          onCancel={handleCancel}
          minorAgeThreshold={waiverSettings.minor_age_threshold || template?.minor_age_threshold || 18}
          waiverSettings={waiverSettings}
          participants={participants}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'children':
      return renderWithKioskIdleOverlay(
        <AdditionalAdultStep
          mode="children"
          title="Add Children"
          subtitle="Add every child who needs a waiver before continuing to the waiver review."
          reminderTitle="Child Waiver Reminder"
          reminderText="Before you continue, make sure every child has been added, including babies and any child who is not playing."
          addButtonLabel="Add Child"
          continueButtonLabel="Continue to Waiver Review"
          continueConfirmation={{
            title: 'Have all children been added?',
            message: 'Please confirm that every child has been added, including babies and any child who is not playing.',
            confirmLabel: 'Yes, continue'
          }}
          onBack={handleParticipantManagementBack}
          onAddChild={handleAddMinorDuringParticipants}
          onContinue={handleContinueChildrenSetup}
          onCancel={handleCancel}
          participants={participants}
          modalParticipant={participantModal.open ? participants[participantModal.index] : null}
          modalFormData={formData}
          setModalFormData={setFormData}
          onModalSubmit={handleParticipantModalSubmit}
          onModalClose={closeParticipantModal}
          template={template}
          customerInfo={customerInfo}
          businessTimezone={business?.timezone || 'America/Toronto'}
          minorAgeThreshold={waiverSettings.minor_age_threshold || template?.minor_age_threshold || 18}
          waiverSettings={waiverSettings}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'agreement':
      return renderWithKioskIdleOverlay(
        <AgreementStep
          template={template}
          agreementScrolled={agreementScrolled}
          agreementAgreed={agreementAgreed}
          onScroll={handleAgreementScroll}
          onAgree={handleAgreementAgree}
          onBack={handleAgreementBack}
          onCancel={handleCancel}
          waiverSettings={waiverSettings}
          onConsentChange={handleAgreementConsentChange}
          consentStates={
            participants[currentParticipantIndex]?.type === 'additional_adult'
              ? participants[currentParticipantIndex]?.consentStates || {}
              : consents
          }
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'legal_warning':
      return renderWithKioskIdleOverlay(
        <LegalWarningStep
          onAcknowledge={handleLegalWarningAcknowledge}
          onCancel={handleCancel}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'signature':
      return renderWithKioskIdleOverlay(
        <SignatureStep
          participant={participants[currentParticipantIndex]}
          onSignatureComplete={handleSignatureComplete}
          template={template}
          onBack={handleSignatureBack}
          onCancel={handleCancel}
          waiverSettings={waiverSettings}
          onCancelForPaper={handleSkipAdditionalAdult}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'additional_adult':
      return renderWithKioskIdleOverlay(
        <AdditionalAdultStep
          mode="adults"
          title="Add Additional Adults"
          subtitle="Add each additional adult who needs to read and sign their own waiver before final submission."
          reminderTitle="Adult Waiver Reminder"
          reminderText="Everyone age 18+ requires their own waiver, whether they are playing or not. This includes grandparents, extra parents, and other adults attending."
          addButtonLabel="Add Additional Adult"
          continueButtonLabel="Continue to Submit"
          continueConfirmation={{
            title: 'Have all adults been added?',
            message: 'Please confirm that every adult has been added, including grandparents, additional parents, and any adult who is not playing.',
            confirmLabel: 'Yes, continue'
          }}
          addConfirmation={{
            title: 'Additional adult acknowledgment',
            message: 'The additional adult must be the person who reads and signs their own waiver. If you are filling this out for another adult, you are accepting liability for doing so.',
            checkboxLabel: 'I understand that the additional adult must sign their own waiver, and if I sign for another adult I accept liability.',
            confirmLabel: 'Continue to Additional Adult Info'
          }}
          onBack={() => setCurrentStep('signature')}
          onAdd={requestAddAdditionalAdult}
          onContinue={handleContinueParticipantSetup}
          onCancel={handleCancel}
          participants={participants}
          modalParticipant={participantModal.open ? participants[participantModal.index] : null}
          modalFormData={formData}
          setModalFormData={setFormData}
          onModalSubmit={handleParticipantModalSubmit}
          onModalClose={closeParticipantModal}
          template={template}
          customerInfo={customerInfo}
          businessTimezone={business?.timezone || 'America/Toronto'}
          minorAgeThreshold={waiverSettings.minor_age_threshold || template?.minor_age_threshold || 18}
          waiverSettings={waiverSettings}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'review':
      return renderWithKioskIdleOverlay(
        <ReviewStep
          participants={participants}
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleReviewSubmit}
          onEdit={handleReviewEdit}
          template={template}
          onBack={handleReviewBack}
          onCancel={handleCancel}
          phoneNumber={phoneNumber}
          customerInfo={customerInfo}
          businessTimezone={business?.timezone || 'America/Toronto'}
          minorAgeThreshold={waiverSettings.minor_age_threshold || template?.minor_age_threshold || 18}
          waiverSettings={waiverSettings}
          onSave={(data) => {
            // Auto-save functionality - update participants or formData
            if (data.participants) {
              setParticipants(data.participants);
            }
            if (data.formData) {
              setFormData(data.formData);
            }
          }}
          suspendInactivityTimer={suspendStepIdleTimer}
        />
      );
    case 'completion':
      return renderWithKioskIdleOverlay(
        <CompletionStep
          waiver={submittedWaiver || existingWaiver}
          participants={submittedWaiver?.waiver_participants || participants || existingWaiverParticipants}
          business={business}
          template={submittedWaiver?.waiver_templates || existingWaiver?.waiver_templates || template}
          onNewWaiver={handleNewWaiver}
          onClose={handleClose}
          onResign={handleResign}
          completionRedirect={completionRedirect}
          isKioskMode={isKioskMode}
        />
      );
    default:
      return <div>Unknown step</div>;
  }
};

// Location Selection Step (simple - can be enhanced later)
const LocationSelectionStep = ({ business, onSelect }) => {
  // For now, if business is provided, auto-select and continue
  useEffect(() => {
    if (business) {
      onSelect(business.id);
    }
  }, [business, onSelect]);

  return (
    <div style={styles.container}>
      <div style={styles.loading}>
        <p>Loading...</p>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    padding: '2rem',
    maxWidth: '800px',
    margin: '0 auto'
  },
  loading: {
    textAlign: 'center',
    padding: '4rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh'
  },
  loadingSpinner: {
    width: '48px',
    height: '48px',
    border: `4px solid ${TavariStyles.colors.gray300}`,
    borderTop: `4px solid ${TavariStyles.colors.primary}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
  },
  loadingText: {
    fontSize: '1.125rem',
    color: TavariStyles.colors.gray600
  },
  error: {
    textAlign: 'center',
    padding: '4rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  waiverContent: {
    maxHeight: '500px',
    overflowY: 'auto',
    padding: '1rem',
    border: '1px solid #ccc',
    borderRadius: '8px',
    marginBottom: '1rem',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  }
};

export default PublicWaiverFlow;


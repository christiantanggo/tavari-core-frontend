// src/screens/Waivers/BookingWaiverFlow.jsx
// Waiver flow entered from the booking portal only. Uses React Router state (no token).
// Same steps and WaiverSubmissionService as PublicWaiverFlow → same DB tables.

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { FiAlertCircle } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { getLocationData } from '../../utils/waiverLocationTracking';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

import ParticipantInfoStep from '../../components/Waivers/PublicWaiverSteps/ParticipantInfoStep';
import AgreementStep from '../../components/Waivers/PublicWaiverSteps/AgreementStep';
import SignatureStep from '../../components/Waivers/PublicWaiverSteps/SignatureStep';
import AdditionalAdultStep from '../../components/Waivers/PublicWaiverSteps/AdditionalAdultStep';
import ReviewStep from '../../components/Waivers/PublicWaiverSteps/ReviewStep';
import CompletionStep from '../../components/Waivers/PublicWaiverSteps/CompletionStep';
import WaiverTemplateSelectStep from '../../components/Waivers/PublicWaiverSteps/WaiverTemplateSelectStep';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import { birthFormPartsFromValue } from '../../utils/waiverDateOfBirth';
import { resolveDefaultWaiverTemplate } from '../../utils/waiverTemplateSelection';
import { useWaiverTabletKeyboardInset } from '../../hooks/useWaiverTabletKeyboardInset';
import '../../components/Waivers/PublicWaiverSteps/publicWaiverResponsive.css';

function getSafeInAppReturnPath(rawReturnUrl) {
  if (!rawReturnUrl) return null;

  try {
    const decoded = decodeURIComponent(rawReturnUrl).trim();
    if (!decoded) return null;
    if (decoded.startsWith('//')) return null;

    const isRootRelativePath = decoded.startsWith('/');
    const isAbsoluteHttpUrl = /^https?:\/\//i.test(decoded);
    if (!isRootRelativePath && !isAbsoluteHttpUrl) return null;

    const parsed = isAbsoluteHttpUrl
      ? new URL(decoded)
      : new URL(decoded, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

const BookingWaiverFlow = () => {
  const { businessId, templateKey } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const state = location.state || {};
  const { customerAccount, customerParticipants = [], returnUrl: stateReturnUrl } = state;
  const returnUrl = stateReturnUrl || searchParams.get('returnUrl') || '';
  console.log('[BookingWaiverFlow] Mount: location.state keys', state ? Object.keys(state) : [], 'customerAccount present', !!customerAccount, 'customerParticipants length', (customerParticipants || []).length);

  useWaiverTabletKeyboardInset(true);

  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState(null);
  const [template, setTemplate] = useState(null);
  const [locationData, setLocationData] = useState(null);
  const [waiverSettings, setWaiverSettings] = useState({});
  const [stationTemplateOptions, setStationTemplateOptions] = useState([]);
  const [consents, setConsents] = useState({});

  const [currentStep, setCurrentStep] = useState('participants');
  const [participants, setParticipants] = useState([]);
  const [currentParticipantIndex, setCurrentParticipantIndex] = useState(0);
  const [formData, setFormData] = useState({});
  const [participantModal, setParticipantModal] = useState({ open: false, index: null, isNew: false });
  const [reviewEditIndex, setReviewEditIndex] = useState(null);
  const [agreementScrolled, setAgreementScrolled] = useState(false);
  const [agreementAgreed, setAgreementAgreed] = useState(false);
  const [, setSigning] = useState(false);
  const [submittedWaiver, setSubmittedWaiver] = useState(null); // last submitted (for completion screen)
  const [, setSubmittedWaivers] = useState([]); // all submitted waivers (one per signer)
  const [additionalAdultIntentAcknowledgments, setAdditionalAdultIntentAcknowledgments] = useState([]);

  const customerInfo = customerAccount
    ? {
        id: customerAccount.id,
        customer_id: customerAccount.id,
        customerId: customerAccount.id,
        phoneNumber: customerAccount.phone || customerAccount.customer_phone || '',
        email: customerAccount.email || customerAccount.customer_email || ''
      }
    : null;

  // No state = arrived via refresh/bookmark → redirect back
  useEffect(() => {
    console.log('[BookingWaiverFlow] useEffect: state check', {
      hasCustomerAccount: !!customerAccount,
      customerAccountKeys: customerAccount ? Object.keys(customerAccount) : [],
      customerAccountId: customerAccount?.id,
      customerAccountPhone: customerAccount?.phone ?? customerAccount?.customer_phone,
      customerAccountEmail: customerAccount?.email ?? customerAccount?.customer_email,
      customerParticipantsLength: (customerParticipants || []).length,
      businessId,
      templateKey
    });
    if (!customerAccount?.id || !businessId) {
      const safeReturnPath = getSafeInAppReturnPath(returnUrl);
      const target = safeReturnPath || `/customer-portal/${businessId}/portal`;
      setLoading(false);
      navigate(target, { replace: true });
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const [bizRes, loc, brandRes] = await Promise.all([
          supabase.from('businesses').select('*').eq('id', businessId).single(),
          getLocationData(),
          supabase.from('app_branding').select('logo_url').eq('business_id', businessId).maybeSingle()
        ]);
        if (bizRes.data) {
          const b = brandRes.data;
          const logoFromSettings =
            b?.logo_url && String(b.logo_url).trim() ? String(b.logo_url).trim() : '';
          setBusiness({
            ...bizRes.data,
            logo_url: logoFromSettings || bizRes.data?.logo_url || null
          });
        }
        setLocationData(loc);
        let loadedWaiverSettings = {};
        if (businessId) {
          try {
            WaiverSettingsService.setBusinessId(businessId);
            const settings = await WaiverSettingsService.getGlobalSettings();
            loadedWaiverSettings = settings || {};
            setWaiverSettings(loadedWaiverSettings);
          } catch {
            // Keep default settings when waiver settings cannot be loaded.
          }
        }

        let resolvedTemplate = null;
        if (templateKey) {
          const { data: templateData, error: templateError } = await supabase
            .from('waiver_templates')
            .select('*')
            .eq('business_id', businessId)
            .eq('template_key', templateKey)
            .eq('is_active', true)
            .order('version', { ascending: false })
            .limit(1)
            .single();
          if (templateError) {
            console.error('[BookingWaiverFlow] Template load error:', templateError);
          } else {
            resolvedTemplate = templateData;
          }
        } else {
          const { data: templateRows, error: templateRowsError } = await supabase
            .from('waiver_templates')
            .select('*')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('version', { ascending: false })
            .order('created_at', { ascending: false });
          if (templateRowsError) {
            console.error('[BookingWaiverFlow] Default template load error:', templateRowsError);
          } else {
            const resolvedTemplateState = resolveDefaultWaiverTemplate(templateRows || [], loadedWaiverSettings);
            setStationTemplateOptions(resolvedTemplateState.stationTemplateOptions || []);

            if (
              resolvedTemplateState.stationMode === 'multi' &&
              (resolvedTemplateState.stationTemplateOptions || []).length > 1
            ) {
              setCurrentStep('template_select');
              setLoading(false);
              return;
            }

            resolvedTemplate = resolvedTemplateState.resolvedTemplate;
          }
        }

        if (resolvedTemplate) {
          setTemplate(resolvedTemplate);
        }

        const minorAgeThreshold = resolvedTemplate?.minor_age_threshold ?? 18;
        const raw = [...(customerParticipants || [])];
        console.log('[BookingWaiverFlow] Building participants from profile', {
          rawCount: raw.length,
          rawFirst: raw[0] ? { keys: Object.keys(raw[0]), first_name: raw[0].first_name, last_name: raw[0].last_name, email: raw[0].email, phone_number: raw[0].phone_number, date_of_birth: raw[0].date_of_birth } : null,
          customerAccountKeys: customerAccount ? Object.keys(customerAccount) : [],
          customerAccountPhone: customerAccount?.phone ?? customerAccount?.customer_phone,
          customerAccountEmail: customerAccount?.email ?? customerAccount?.customer_email,
          customerAccountName: customerAccount?.customer_name
        });
        const isMinor = (dob) => {
          if (!dob) return false;
          const d = new Date(typeof dob === 'string' ? dob.split('T')[0] : dob);
          if (isNaN(d.getTime())) return false;
          const today = new Date();
          let age = today.getFullYear() - d.getFullYear();
          if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) age--;
          return age < minorAgeThreshold;
        };
        let primary = raw.find(p => p.is_account_owner || p.participant_type === 'primary') || raw[0];
        if (!primary) {
          const email = customerAccount.email || customerAccount.customer_email || '';
          const nameFromAccount = (customerAccount.customer_name || '').trim().split(/\s+/);
          const first_name = nameFromAccount[0] || ((email && email.includes('@')) ? email.split('@')[0] : 'Account owner');
          const last_name = nameFromAccount.slice(1).join(' ') || '';
          raw.push({
            id: customerAccount.id,
            first_name,
            last_name,
            date_of_birth: customerAccount.date_of_birth ?? null,
            email: customerAccount.email || customerAccount.customer_email,
            phone_number: customerAccount.phone || customerAccount.customer_phone,
            participant_type: 'primary',
            is_account_owner: true
          });
          primary = raw[raw.length - 1];
          console.log('[BookingWaiverFlow] Synthetic primary created', { first_name: primary.first_name, last_name: primary.last_name, email: primary.email, phone_number: primary.phone_number });
        }
        const rest = raw.filter(p => p.id !== primary.id);
        const minorsList = rest.filter(p => p.participant_type === 'minor' || (p.date_of_birth && isMinor(p.date_of_birth)));
        const adultsList = rest.filter(p => !minorsList.some(m => m.id === p.id));
        const ordered = [primary || raw[0], ...minorsList, ...adultsList].filter(Boolean);
        const mapped = ordered.map((p, idx) => {
          const type = p.is_account_owner || p.participant_type === 'primary' ? 'primary'
            : (p.participant_type === 'minor' || (p.date_of_birth && isMinor(p.date_of_birth))) ? 'minor'
            : 'additional_adult';
          const dob = p.date_of_birth;
          const dateStr = dob ? (typeof dob === 'string' ? dob.split('T')[0] : dob) : '';
          const phone = type === 'primary' ? (p.phone_number || customerAccount.phone || customerAccount.customer_phone || '') : undefined;
          const email = type === 'primary' ? (p.email || customerAccount.email || customerAccount.customer_email || '') : undefined;
          const firstName = (p.first_name || '').trim();
          const lastName = (p.last_name || '').trim();
          const participantData = {
            firstName: firstName || (type === 'primary' && (customerAccount.customer_name || '').split(/\s+/)[0]) || '',
            lastName: lastName || (type === 'primary' && (customerAccount.customer_name || '').split(/\s+/).slice(1).join(' ')) || '',
            dateOfBirth: dateStr,
            phoneNumber: phone,
            email: email
          };
          if (type === 'primary') {
            console.log('[BookingWaiverFlow] Primary participant.data', { firstName: participantData.firstName, lastName: participantData.lastName, email: participantData.email, phoneNumber: participantData.phoneNumber, dateOfBirth: participantData.dateOfBirth });
          }
          return {
            type,
            data: participantData,
            signed: false,
            index: idx
          };
        });
        setParticipants(mapped);
        if (mapped.length > 0) {
          const first = mapped[0];
          const dobStr = first.data.dateOfBirth || '';
          const parsedDob = birthFormPartsFromValue(dobStr);
          const initialFormData = {
            firstName: first.data.firstName || '',
            lastName: first.data.lastName || '',
            dateOfBirth: dobStr,
            birthYear: parsedDob.year,
            birthMonth: parsedDob.month,
            birthDay: parsedDob.day,
            email: first.data.email || '',
            phoneNumber: first.data.phoneNumber || '',
            address: '',
            city: '',
            postalCode: ''
          };
          console.log('[BookingWaiverFlow] Initial formData set for first participant', { startIdx: 0, type: first.type, ...initialFormData });
          setFormData(initialFormData);
          setCurrentParticipantIndex(0);
        }
      } catch (err) {
        console.error('[BookingWaiverFlow] init error:', err);
        toast.error('Error loading waiver');
      } finally {
        setLoading(false);
      }
    })();
  }, [businessId, templateKey, customerAccount?.id, customerAccount?.phone, customerAccount?.email, customerAccount?.customer_email, customerParticipants]);

  const handleParticipantInfoSubmit = (data) => {
    const updated = [...participants];
    updated[currentParticipantIndex] = { ...updated[currentParticipantIndex], data };
    setParticipants(updated);

    if (reviewEditIndex !== null) {
      setReviewEditIndex(null);
      focusPrimaryParticipant(updated);
      setCurrentStep('review');
      return;
    }

    const current = updated[currentParticipantIndex];
    if (current?.type === 'additional_adult') {
      setAgreementScrolled(false);
      setAgreementAgreed(false);
      setCurrentStep('agreement');
    } else if (current?.type === 'minor') {
      setCurrentStep('children');
    } else if (current?.type === 'primary') {
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
    const updated = [...participants];
    updated[modalIndex] = { ...updated[modalIndex], data };
    if (updated[modalIndex]?.type === 'additional_adult') {
      updated[modalIndex] = {
        ...updated[modalIndex],
        consentStates: {
          ...(updated[modalIndex].consentStates || {}),
          waiverTerms: false
        }
      };
    }
    setParticipants(updated);
    setParticipantModal({ open: false, index: null, isNew: false });

    if (reviewEditIndex !== null) {
      setReviewEditIndex(null);
      focusPrimaryParticipant(updated);
      setCurrentStep('review');
      return;
    }

    if (updated[modalIndex]?.type === 'additional_adult') {
      setCurrentParticipantIndex(modalIndex);
      setFormData(data);
      setAgreementScrolled(false);
      setAgreementAgreed(false);
      setCurrentStep('agreement');
      return;
    }

    focusPrimaryParticipant(updated);
    toast.success('Child added. You can add another participant or continue.');
    setCurrentStep('children');
  };

  const handleAgreementScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop <= el.clientHeight + 50 && !agreementScrolled) setAgreementScrolled(true);
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

  const handleSignatureComplete = async (signature) => {
    const updated = [...participants];
    updated[currentParticipantIndex].signatureData = signature;
    updated[currentParticipantIndex].signed = true;
    if (updated[currentParticipantIndex]?.type === 'additional_adult') {
      updated[currentParticipantIndex].consentStates = {
        ...(updated[currentParticipantIndex].consentStates || {}),
        waiverTerms: true,
        electronicSignature: true
      };
    }
    setParticipants(updated);
    setCurrentStep('additional_adult');
  };

  const requestAddAdditionalAdult = () => {
    if (openIncompleteParticipant('additional_adult')) {
      toast.error('Please finish the current additional adult before adding another.');
      return;
    }
    confirmAddAdditionalAdultIntent();
  };

  const proceedAddAdditionalAdult = () => {
    setParticipants((prev) => {
      const next = [...prev, { type: 'additional_adult', data: {}, signed: false, index: prev.length }];
      setCurrentParticipantIndex(next.length - 1);
      return next;
    });
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
    setParticipantModal({ open: true, index: participants.length, isNew: true });
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
      console.error('[BookingWaiverFlow] additional adult intent ack:', e);
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

  const handleChildrenBack = () => {
    focusPrimaryParticipant();
    setCurrentStep('participants');
  };

  const handleParticipantManagementBack = () => {
    setCurrentStep('signature');
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

  const handleAddMinorDuringParticipants = () => {
    if (openIncompleteParticipant('children')) {
      toast.error('Please finish the current child before adding another.');
      return;
    }

    const firstAdultIdx = participants.findIndex((p) => p.type === 'additional_adult');
    const insertIndex = firstAdultIdx !== -1 ? firstAdultIdx : participants.filter((p) => p.type === 'minor').length + 1;
    const primary = participants.find((p) => p.type === 'primary');
    const primaryData = primary?.data || {};
    const next = [...participants];
    next.splice(insertIndex, 0, {
      type: 'minor',
      data: {},
      signed: false,
      index: insertIndex
    });
    next.forEach((participant, index) => {
      participant.index = index;
    });
    setParticipants(next);
    setCurrentParticipantIndex(insertIndex);
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
    setParticipantModal({ open: true, index: insertIndex, isNew: true });
    setCurrentStep('children');
  };

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

  // Submit the final reviewed booking waiver, mirroring the public waiver flow.
  const submitFinalWaiver = async (participantsToSubmit) => {
    const { waiverSubmissionService } = await import('../../services/Waivers/WaiverSubmissionService');
    const { getIPAddress } = await import('../../utils/waiverLocationTracking');
    const ip = await getIPAddress().catch(() => null);
    return waiverSubmissionService.submitWaiver({
      businessId,
      templateId: template?.id,
      customerInfo,
      participants: participantsToSubmit,
      locationData: { ...locationData, ...(ip ? { ip } : {}) },
      business,
      additionalAdultIntentAcknowledgments,
      consentStates: consents
    });
  };

  const submitWaiver = async () => {
    const genericSubmitError = 'We could not complete your waiver. Please try again.';
    try {
      setSigning(true);
      const result = await submitFinalWaiver(participants);
      if (result.success) {
        const { data } = await supabase.from('waiver_signatures').select('*, waiver_participants (*)').eq('id', result.waiverId).single();
        setSubmittedWaiver(data);
        setSubmittedWaivers(prev => [...prev, data]);
        toast.success('Waiver signed successfully!');
        setCurrentStep('completion');
      } else {
        throw new Error(genericSubmitError);
      }
    } catch (error) {
      console.error('[BookingWaiverFlow] submit error:', error);
      toast.error(error?.message || genericSubmitError);
    } finally {
      setSigning(false);
    }
  };

  const handleClose = () => {
    const safeReturnPath = getSafeInAppReturnPath(returnUrl);
    if (safeReturnPath) {
      navigate(safeReturnPath, { replace: true });
      return;
    }
    navigate(`/customer-portal/${businessId}/portal`, { replace: true });
  };

  if (!customerAccount?.id || !businessId) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <p style={styles.loadingText}>Redirecting…</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <div style={styles.loading}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <FiAlertCircle size={48} style={{ color: TavariStyles.colors.error, marginBottom: '1rem' }} />
          <h2>No Waiver Configured</h2>
          <p>This business has not set up a waiver yet.</p>
          <button type="button" onClick={handleClose} style={styles.button}>Return to booking</button>
        </div>
      </div>
    );
  }

  const cancelHandler = () => {
    if (window.confirm('Leave waiver? You can complete it from the booking page.')) handleClose();
  };

  switch (currentStep) {
    case 'template_select':
      return (
        <WaiverTemplateSelectStep
          business={business}
          options={stationTemplateOptions}
          onSelect={(option) => {
            const nextParams = new URLSearchParams(searchParams);
            navigate(
              `/waiver-from-booking/${businessId}/${option.templateKey}${nextParams.toString() ? `?${nextParams.toString()}` : ''}`,
              {
                replace: true,
                state
              }
            );
          }}
          onCancel={cancelHandler}
        />
      );
    case 'participants': {
      const currentParticipant = participants[currentParticipantIndex];
      console.log('[BookingWaiverFlow] Rendering ParticipantInfoStep', {
        currentParticipantIndex,
        participantType: currentParticipant?.type,
        participantDataKeys: currentParticipant?.data ? Object.keys(currentParticipant.data) : [],
        participantData: currentParticipant?.data ? { firstName: currentParticipant.data.firstName, lastName: currentParticipant.data.lastName, email: currentParticipant.data.email, phoneNumber: currentParticipant.data.phoneNumber, dateOfBirth: currentParticipant.data.dateOfBirth } : null,
        customerInfo: customerInfo ? { customerId: customerInfo.customerId, phoneNumber: customerInfo.phoneNumber, email: customerInfo.email } : null,
        formDataKeys: Object.keys(formData),
        formDataSample: { firstName: formData.firstName, lastName: formData.lastName, email: formData.email, phoneNumber: formData.phoneNumber }
      });
      return (
        <ParticipantInfoStep
          participant={currentParticipant}
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
            handleClose();
          }}
          onCancel={cancelHandler}
          minorAgeThreshold={waiverSettings.minor_age_threshold || template?.minor_age_threshold || 18}
          waiverSettings={waiverSettings}
          participants={participants}
        />
      );
    }
    case 'agreement':
      return (
        <AgreementStep
          template={template}
          agreementScrolled={agreementScrolled}
          agreementAgreed={agreementAgreed}
          onScroll={handleAgreementScroll}
          onAgree={handleAgreementAgree}
          onBack={handleAgreementBack}
          onCancel={cancelHandler}
          waiverSettings={waiverSettings}
          onConsentChange={handleAgreementConsentChange}
          consentStates={
            participants[currentParticipantIndex]?.type === 'additional_adult'
              ? participants[currentParticipantIndex]?.consentStates || {}
              : consents
          }
        />
      );
    case 'children':
      return (
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
          onBack={handleChildrenBack}
          onAddChild={handleAddMinorDuringParticipants}
          onContinue={handleContinueChildrenSetup}
          onCancel={cancelHandler}
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
        />
      );
    case 'signature':
      return (
        <SignatureStep
          participant={participants[currentParticipantIndex]}
          onSignatureComplete={handleSignatureComplete}
          template={template}
          onBack={handleSignatureBack}
          onCancel={cancelHandler}
          waiverSettings={waiverSettings}
          onCancelForPaper={handleSkipAdditionalAdult}
        />
      );
    case 'additional_adult':
      return (
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
          onBack={handleParticipantManagementBack}
          onAdd={requestAddAdditionalAdult}
          onContinue={handleContinueParticipantSetup}
          onCancel={cancelHandler}
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
        />
      );
    case 'review':
      return (
        <ReviewStep
          participants={participants}
          formData={formData}
          setFormData={setFormData}
          onSubmit={submitWaiver}
          onEdit={handleReviewEdit}
          template={template}
          onBack={handleReviewBack}
          onCancel={cancelHandler}
          phoneNumber={customerInfo?.phoneNumber}
          customerInfo={customerInfo}
          businessTimezone={business?.timezone || 'America/Toronto'}
          minorAgeThreshold={waiverSettings.minor_age_threshold || template?.minor_age_threshold || 18}
          waiverSettings={waiverSettings}
          onSave={(data) => {
            if (data.participants) setParticipants(data.participants);
            if (data.formData) setFormData(data.formData);
          }}
        />
      );
    case 'completion':
      return (
        <CompletionStep
          waiver={submittedWaiver}
          participants={submittedWaiver?.waiver_participants || participants}
          business={business}
          template={submittedWaiver?.waiver_templates || template}
          onNewWaiver={() => {}}
          onClose={handleClose}
          onResign={() => {}}
          fromBooking={true}
        />
      );
    default:
      return (
        <div style={styles.container}>
          <p>Unknown step</p>
          <button type="button" onClick={handleClose} style={styles.button}>Return</button>
        </div>
      );
  }
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
  spinner: {
    width: '48px',
    height: '48px',
    border: `4px solid ${TavariStyles.colors.gray300}`,
    borderTop: `4px solid ${TavariStyles.colors.primary}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
  },
  loadingText: { fontSize: '1.125rem', color: TavariStyles.colors.gray600 },
  error: {
    textAlign: 'center',
    padding: '4rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  button: {
    marginTop: '1rem',
    padding: '12px 24px',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontWeight: 600,
    cursor: 'pointer'
  }
};

export default BookingWaiverFlow;

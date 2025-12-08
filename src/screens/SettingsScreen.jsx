// src/screens/SettingsScreen.jsx - WITH SUCCESS MODAL
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBusinessContext } from '../contexts/BusinessContext';
import { supabase } from '../supabaseClient';
import { SecurityWrapper } from '../Security';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import PermissionGate from '../components/Auth/PermissionGate';
import SessionManager from '../components/SessionManager';
import toast from 'react-hot-toast';
import { 
  createOnboardingForm, 
  getOnboardingFormStatus, 
  createOnboardingFormLink,
  getMerchantDetails,
  isFinixConfigured 
} from '../helpers/finixApi';
import AppBuilderBrandingService from '../services/AppBuilder/AppBuilderBrandingService';

// Import tab components
import BasicInfoTab from '../components/Settings/BasicInfoTab';
import OperatingHoursTab from '../components/Settings/OperatingHoursTab';
import HolidayHoursTab from '../components/Settings/HolidayHoursTab';
import RoleManagementTab from '../components/Settings/RoleManagementTab';
import ColorsTab from '../components/Settings/ColorsTab';
import SchedulingSettingsTab from '../components/Settings/SchedulingSettingsTab';

// Success Modal Component
const SuccessModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.modal}>
        <div style={modalStyles.checkmark}>✓</div>
        <h2 style={modalStyles.title}>Changes Saved Successfully!</h2>
        <p style={modalStyles.message}>
          Your business settings have been updated. The page will refresh to show your changes.
        </p>
        <button 
          onClick={onClose}
          style={modalStyles.button}
        >
          OK
        </button>
      </div>
    </div>
  );
};

const modalStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '40px',
    textAlign: 'center',
    maxWidth: '400px',
    width: '90%',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
  },
  checkmark: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
    color: 'white',
    fontSize: '48px',
    lineHeight: '80px',
    margin: '0 auto 20px',
    fontWeight: 'bold'
  },
  title: {
    margin: '0 0 12px',
    fontSize: '24px',
    color: '#1f2937',
    fontWeight: 'bold'
  },
  message: {
    margin: '0 0 24px',
    fontSize: '16px',
    color: '#6b7280',
    lineHeight: '1.5'
  },
  button: {
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    minWidth: '120px',
    transition: 'all 0.2s ease'
  }
};

const SettingsScreen = () => {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [searchParams] = useSearchParams();

  const [businessData, setBusinessData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  
  // Branding/Colors state
  const [brandingData, setBrandingData] = useState({
    primary_color: '#3B82F6',
    secondary_color: '#1E40AF',
    accent_color: '#60A5FA',
    logo_url: '',
    favicon_url: ''
  });
  const [schedulingSettings, setSchedulingSettings] = useState(null);
  
  // Tavari Pay specific state
  const [tavarPayLoading, setTavarPayLoading] = useState(false);
  const [tavarPayError, setTavarPayError] = useState('');
  const [merchantDetails, setMerchantDetails] = useState(null);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['owner', 'admin', 'manager'],
    requireBusiness: true,
    componentName: 'SettingsScreen'
  });

  const {
    authUser,
    userRole,
    authLoading,
    selectedBusinessId: authBusinessId
  } = auth;

  // Permission system
  const permissions = usePermissions();
  const { 
    hasPermission, 
    hasElevatedPrivileges,
    isOwner: isOwnerFunc,
    loading: permissionsLoading 
  } = permissions;

  // Permission checks
  const canViewSettings = hasPermission('business.settings.view') || hasElevatedPrivileges();
  const canEditBasicInfo = hasPermission('business.settings.edit') || hasElevatedPrivileges();
  const canEditHours = hasPermission('business.hours.edit') || hasElevatedPrivileges();
  const canManageRoles = hasPermission('admin.roles.view') || hasElevatedPrivileges();
  const canManageTavariPay = hasPermission('business.tavari_pay.manage') || (isOwnerFunc && isOwnerFunc());

  // Default operating hours structure
  const defaultHours = {
    monday: { open: '09:00', close: '17:00', closed: false },
    tuesday: { open: '09:00', close: '17:00', closed: false },
    wednesday: { open: '09:00', close: '17:00', closed: false },
    thursday: { open: '09:00', close: '17:00', closed: false },
    friday: { open: '09:00', close: '17:00', closed: false },
    saturday: { open: '10:00', close: '16:00', closed: false },
    sunday: { open: '12:00', close: '16:00', closed: true }
  };

  // Check URL params for tab selection
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Fetch branding/colors data from app_branding table
  const fetchBranding = useCallback(async () => {
    if (!selectedBusinessId) return;

    try {
      const { data, error } = await supabase
        .from('app_branding')
        .select('primary_color, secondary_color, accent_color, logo_url, favicon_url')
        .eq('business_id', selectedBusinessId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching branding:', error);
        return;
      }

      if (data) {
        setBrandingData({
          primary_color: data.primary_color || '#3B82F6',
          secondary_color: data.secondary_color || '#1E40AF',
          accent_color: data.accent_color || '#60A5FA',
          logo_url: data.logo_url || '',
          favicon_url: data.favicon_url || ''
        });
      }
    } catch (err) {
      console.error('Error fetching branding data:', err);
    }
  }, [selectedBusinessId]);

  const fetchMerchantDetails = async (merchantId) => {
    try {
      const details = await getMerchantDetails(merchantId, selectedBusinessId);
      setMerchantDetails(details);
    } catch (err) {
      console.error('Error fetching merchant details:', err);
    }
  };

  const fetchSchedulingSettings = useCallback(async () => {
    if (!selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('scheduling_settings')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching scheduling settings:', error);
        return;
      }

      if (data) {
        setSchedulingSettings(data);
      } else {
        setSchedulingSettings(null);
      }
    } catch (err) {
      console.error('Error loading scheduling settings:', err);
    }
  }, [selectedBusinessId]);

  const fetchBusiness = useCallback(async () => {
    if (!selectedBusinessId) return;

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', selectedBusinessId)
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Unable to load business settings.');
      }

      // Ensure operating_hours has proper structure
      if (!data.operating_hours || typeof data.operating_hours !== 'object') {
        data.operating_hours = defaultHours;
      }

      // Ensure holiday_hours is an array
      if (!Array.isArray(data.holiday_hours)) {
        data.holiday_hours = [];
      }

      setBusinessData(data);

      // Fetch branding/colors data
      await fetchBranding();

      // Fetch scheduling settings
      await fetchSchedulingSettings();

      // Fetch merchant details if merchant ID exists
      if (data.finix_merchant_id && canManageTavariPay) {
        fetchMerchantDetails(data.finix_merchant_id);
      }

    } catch (err) {
      setError(err.message || 'Unable to load business settings.');
      toast.error('Failed to load settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, canManageTavariPay, fetchBranding, fetchSchedulingSettings]);

  // Main data fetching effect
  useEffect(() => {
    if (!authLoading && !permissionsLoading && canViewSettings && selectedBusinessId) {
      fetchBusiness();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewSettings, fetchBusiness]);

  // Handle modal close and page refresh
  const handleModalClose = () => {
    setShowSuccessModal(false);
    window.location.reload();
  };

  // SAVE FUNCTION WITH MODAL
  const handleSave = useCallback(async () => {
    if (!businessData) {
      toast.error('No data to save');
      return;
    }

    if (!canEditBasicInfo && activeTab === 'basic') {
      toast.error('You do not have permission to edit basic information');
      return;
    }

    if (!canEditHours && (activeTab === 'hours' || activeTab === 'holidays')) {
      toast.error('You do not have permission to edit hours');
      return;
    }

    if (!canEditBasicInfo && activeTab === 'colors') {
      toast.error('You do not have permission to edit colors');
      return;
    }

    setSaving(true);
    
    try {
      // Handle colors tab separately
      if (activeTab === 'colors') {
        const { data: updateResult, error: updateError } = await supabase
          .from('app_branding')
          .upsert({
            business_id: selectedBusinessId,
            primary_color: brandingData.primary_color,
            secondary_color: brandingData.secondary_color,
            accent_color: brandingData.accent_color,
            logo_url: brandingData.logo_url,
            favicon_url: brandingData.favicon_url,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'business_id'
          })
          .select();

        if (updateError) {
          if (updateError.code === '42501') {
            throw new Error('Permission denied: You do not have permission to update colors.');
          }
          throw updateError;
        }

        if (!updateResult || updateResult.length === 0) {
          throw new Error('Update failed: No rows were updated.');
        }

        setError('');
        setSaving(false);
        setShowSuccessModal(true);
        return;
      }

      // Handle basic tab - also save logo/favicon if they exist
      if (activeTab === 'basic') {
        // Save business data
        if (!businessData.name || businessData.name.trim().length < 2) {
          toast.error('Business name must be at least 2 characters');
          setSaving(false);
          return;
        }

        const updateData = {
          name: businessData.name.trim(),
          business_address: businessData.business_address?.trim() || '',
          business_city: businessData.business_city?.trim() || '',
          business_state: businessData.business_state?.trim() || 'ON',
          business_postal: businessData.business_postal?.trim() || '',
          business_phone: businessData.business_phone?.trim() || '',
          business_email: businessData.business_email?.trim() || '',
          business_website: businessData.business_website?.trim() || '',
          tax_number: businessData.tax_number?.trim() || '',
          operating_hours: businessData.operating_hours || defaultHours,
          holiday_hours: businessData.holiday_hours || [],
          timezone: businessData.timezone || 'America/Toronto'
        };

        const { data: updateResult, error: updateError } = await supabase
          .from('businesses')
          .update(updateData)
          .eq('id', selectedBusinessId)
          .select();

        if (updateError) {
          if (updateError.code === '42501') {
            throw new Error('Permission denied: You do not have permission to update this business.');
          }
          throw updateError;
        }

        if (!updateResult || updateResult.length === 0) {
          throw new Error('Update failed: No rows were updated.');
        }

        // Also save logo/favicon if they exist in brandingData
        if (brandingData.logo_url || brandingData.favicon_url) {
          await supabase
            .from('app_branding')
            .upsert({
              business_id: selectedBusinessId,
              logo_url: brandingData.logo_url || null,
              favicon_url: brandingData.favicon_url || null,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'business_id'
            });
        }

        setError('');
        setSaving(false);
        setShowSuccessModal(true);
        return;
      }

      // Basic validation for other tabs
      if (!businessData.name || businessData.name.trim().length < 2) {
        toast.error('Business name must be at least 2 characters');
        setSaving(false);
        return;
      }

      const updateData = {
        name: businessData.name.trim(),
        business_address: businessData.business_address?.trim() || '',
        business_city: businessData.business_city?.trim() || '',
        business_state: businessData.business_state?.trim() || 'ON',
        business_postal: businessData.business_postal?.trim() || '',
        business_phone: businessData.business_phone?.trim() || '',
        business_email: businessData.business_email?.trim() || '',
        business_website: businessData.business_website?.trim() || '',
        tax_number: businessData.tax_number?.trim() || '',
        operating_hours: businessData.operating_hours || defaultHours,
        holiday_hours: businessData.holiday_hours || [],
        timezone: businessData.timezone || 'America/Toronto'
      };

      const { data: updateResult, error: updateError } = await supabase
        .from('businesses')
        .update(updateData)
        .eq('id', selectedBusinessId)
        .select();

      if (updateError) {
        if (updateError.code === '42501') {
          throw new Error('Permission denied: You do not have permission to update this business.');
        }
        throw updateError;
      }

      if (!updateResult || updateResult.length === 0) {
        throw new Error('Update failed: No rows were updated.');
      }

      setError('');
      setSaving(false);
      
      // Show success modal instead of toast
      setShowSuccessModal(true);

    } catch (error) {
      const errorMessage = error.message || 'Failed to save changes.';
      toast.error(errorMessage);
      setError(`Failed to save: ${errorMessage}`);
      setSaving(false);
    }
  }, [businessData, brandingData, selectedBusinessId, activeTab, canEditBasicInfo, canEditHours]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setBusinessData({ ...businessData, [name]: value });
  };

  const handleHoursChange = (day, field, value) => {
    const newHours = {
      ...businessData.operating_hours,
      [day]: {
        ...businessData.operating_hours[day],
        [field]: value
      }
    };
    setBusinessData({ ...businessData, operating_hours: newHours });
  };

  const handleDayClosedToggle = (day) => {
    const newHours = {
      ...businessData.operating_hours,
      [day]: {
        ...businessData.operating_hours[day],
        closed: !businessData.operating_hours[day].closed
      }
    };
    setBusinessData({ ...businessData, operating_hours: newHours });
  };

  const addHoliday = () => {
    const newHoliday = {
      id: Date.now(),
      date: '',
      name: '',
      closed: true,
      hours: { open: '10:00', close: '14:00' }
    };
    
    const updatedHolidays = [...(businessData.holiday_hours || []), newHoliday];
    setBusinessData({ ...businessData, holiday_hours: updatedHolidays });
  };

  const updateHoliday = (holidayId, field, value) => {
    const updatedHolidays = businessData.holiday_hours.map(holiday => 
      holiday.id === holidayId 
        ? { ...holiday, [field]: value }
        : holiday
    );
    setBusinessData({ ...businessData, holiday_hours: updatedHolidays });
  };

  const updateHolidayHours = (holidayId, timeField, value) => {
    const updatedHolidays = businessData.holiday_hours.map(holiday => 
      holiday.id === holidayId 
        ? { ...holiday, hours: { ...holiday.hours, [timeField]: value } }
        : holiday
    );
    setBusinessData({ ...businessData, holiday_hours: updatedHolidays });
  };

  const removeHoliday = (holidayId) => {
    const updatedHolidays = businessData.holiday_hours.filter(holiday => holiday.id !== holidayId);
    setBusinessData({ ...businessData, holiday_hours: updatedHolidays });
  };

  // Handle asset upload (logo/favicon)
  const handleUploadAsset = async (file, assetType) => {
    if (!selectedBusinessId) {
      toast.error('Business ID is required');
      return;
    }

    try {
      AppBuilderBrandingService.setBusinessId(selectedBusinessId);
      
      let result;
      if (assetType === 'logo') {
        result = await AppBuilderBrandingService.uploadLogo(file, selectedBusinessId);
        setBrandingData(prev => ({ ...prev, logo_url: result.url }));
      } else if (assetType === 'favicon') {
        result = await AppBuilderBrandingService.uploadFavicon(file, selectedBusinessId);
        setBrandingData(prev => ({ ...prev, favicon_url: result.url }));
      }
      
      toast.success(`${assetType} uploaded successfully`);
    } catch (error) {
      console.error(`Error uploading ${assetType}:`, error);
      toast.error(`Failed to upload ${assetType}`);
    }
  };

  // ============================================
  // TAVARI PAY FUNCTIONS
  // ============================================

  const handleStartOnboarding = async () => {
    if (!canManageTavariPay) {
      toast.error('You do not have permission to manage Tavari Pay');
      return;
    }

    const finixConfigured = isFinixConfigured();

    if (!finixConfigured) {
      setTavarPayError('Finix API is not configured. Please contact support.');
      return;
    }

    setTavarPayLoading(true);
    setTavarPayError('');

    try {
      const formPayload = {
        name: businessData.name,
        email: businessData.business_email,
        phone: businessData.business_phone,
        address: businessData.business_address,
        city: businessData.business_city,
        state: businessData.business_state,
        postal: businessData.business_postal
      };

      const origin = window.location.origin;
      const returnUrl = `${origin}/tavari-pay/onboarding/success`;
      const cancelUrl = `${origin}/tavari-pay/onboarding/cancelled`;

      const formData = await createOnboardingForm(formPayload, returnUrl, selectedBusinessId, cancelUrl);
      
      const updatePayload = {
        finix_onboarding_form_id: formData.formId,
        finix_onboarding_link_url: formData.linkUrl,
        finix_onboarding_expires_at: formData.expiresAt,
        finix_onboarding_status: formData.status,
        finix_identity_id: formData.identityId
      };

      const { error: updateError } = await supabase
        .from('businesses')
        .update(updatePayload)
        .eq('id', selectedBusinessId);

      if (updateError) {
        throw new Error('Failed to save onboarding data');
      }

      window.location.href = formData.linkUrl;

    } catch (err) {
      setTavarPayError(err.message || 'Failed to start onboarding process');
      toast.error('Failed to start onboarding');
    } finally {
      setTavarPayLoading(false);
    }
  };

  const handleGenerateNewLink = async () => {
    if (!canManageTavariPay) {
      toast.error('You do not have permission to manage Tavari Pay');
      return;
    }

    if (!businessData.finix_onboarding_form_id) {
      setTavarPayError('No onboarding form found');
      return;
    }

    setTavarPayLoading(true);
    setTavarPayError('');

    try {
      const origin = window.location.origin;
      const linkData = await createOnboardingFormLink(businessData.finix_onboarding_form_id, selectedBusinessId, {
        returnUrl: `${origin}/tavari-pay/onboarding/success`,
        cancelUrl: `${origin}/tavari-pay/onboarding/cancelled`
      });
      
      const { error: updateError } = await supabase
        .from('businesses')
        .update({
          finix_onboarding_link_url: linkData.linkUrl,
          finix_onboarding_expires_at: linkData.expiresAt
        })
        .eq('id', selectedBusinessId);

      if (updateError) {
        throw new Error('Failed to save new link');
      }

      setBusinessData({
        ...businessData,
        finix_onboarding_link_url: linkData.linkUrl,
        finix_onboarding_expires_at: linkData.expiresAt
      });

      toast.success('New onboarding link generated!');

    } catch (err) {
      setTavarPayError(err.message || 'Failed to generate new link');
      toast.error('Failed to generate new link');
    } finally {
      setTavarPayLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!businessData.finix_onboarding_form_id) {
      return;
    }

    setTavarPayLoading(true);

    try {
      const status = await getOnboardingFormStatus(businessData.finix_onboarding_form_id, selectedBusinessId);
      
      const updates = {
        finix_onboarding_status: status.status,
      };

      if (status.identityId) {
        updates.finix_identity_id = status.identityId;
      }

      if (status.merchantId) {
        updates.finix_merchant_id = status.merchantId;
        await fetchMerchantDetails(status.merchantId);
      }

      const { error: updateError } = await supabase
        .from('businesses')
        .update(updates)
        .eq('id', selectedBusinessId);

      if (!updateError) {
        setBusinessData({ ...businessData, ...updates });
        toast.success('Status updated!');
      }

    } catch (err) {
      setTavarPayError(err.message || 'Failed to check status');
    } finally {
      setTavarPayLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      'NOT_STARTED': { text: 'Not Started', color: '#6b7280', bgColor: '#f3f4f6' },
      'INCOMPLETE': { text: 'Incomplete', color: '#d97706', bgColor: '#fef3c7' },
      'IN_PROGRESS': { text: 'In Progress', color: '#2563eb', bgColor: '#dbeafe' },
      'UPDATE_REQUESTED': { text: 'Update Requested', color: '#dc2626', bgColor: '#fee2e2' },
      'COMPLETED': { text: 'Completed', color: '#059669', bgColor: '#d1fae5' },
      'APPROVED': { text: 'Approved', color: '#059669', bgColor: '#d1fae5' },
      'REJECTED': { text: 'Rejected', color: '#dc2626', bgColor: '#fee2e2' }
    };

    const badge = badges[status] || badges['NOT_STARTED'];

    return (
      <span style={{
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 'bold',
        backgroundColor: badge.bgColor,
        color: badge.color
      }}>
        {badge.text}
      </span>
    );
  };

  const renderTavariPayTab = () => {
    if (!businessData) return null;

    const hasStarted = businessData.finix_onboarding_form_id;
    const isApproved = businessData.finix_onboarding_status === 'APPROVED' || merchantDetails?.onboardingState === 'APPROVED';
    const linkExpired = businessData.finix_onboarding_expires_at && new Date(businessData.finix_onboarding_expires_at) < new Date();

    return (
      <div style={styles.section}>
        <div style={styles.tavariPayHeader}>
          <div>
            <h3 style={styles.sectionTitle}>Tavari Pay - Payment Processing</h3>
            <p style={styles.subtitle}>
              Enable payment processing powered by Finix to accept credit cards, debit cards, and ACH payments.
            </p>
          </div>
          {hasStarted && (
            <div>
              {getStatusBadge(businessData.finix_onboarding_status || 'NOT_STARTED')}
            </div>
          )}
        </div>

        {tavarPayError && (
          <div style={styles.errorBanner}>
            {tavarPayError}
          </div>
        )}

        {!isFinixConfigured() && (
          <div style={styles.warningBanner}>
            ⚠️ Finix API is not configured. Please add your API credentials to the .env file.
          </div>
        )}

        {!hasStarted ? (
          <div style={styles.onboardingCard}>
            <h4 style={{ marginTop: 0 }}>Get Started with Tavari Pay</h4>
            <p>To start accepting payments, you'll need to complete merchant onboarding with our payment processor.</p>
            
            <div style={styles.featureList}>
              <div style={styles.featureItem}>✓ Accept credit and debit cards</div>
              <div style={styles.featureItem}>✓ Process ACH bank transfers</div>
              <div style={styles.featureItem}>✓ Manage subscriptions and recurring billing</div>
              <div style={styles.featureItem}>✓ PCI-compliant payment processing</div>
              <div style={styles.featureItem}>✓ Next-day settlement to your bank account</div>
            </div>

            <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '20px' }}>
              The onboarding process takes about 5-10 minutes and requires basic business information.
            </p>

            <button
              onClick={handleStartOnboarding}
              disabled={tavarPayLoading || !isFinixConfigured() || !canManageTavariPay}
              style={styles.primaryButton}
            >
              {tavarPayLoading ? 'Loading...' : 'Start Onboarding Process'}
            </button>
          </div>
        ) : isApproved ? (
          <div style={styles.approvedCard}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '48px' }}>✔</div>
              <h4 style={{ color: '#059669', margin: '10px 0' }}>Tavari Pay is Active!</h4>
              <p style={{ color: '#6b7280' }}>Your business is approved and ready to accept payments</p>
            </div>

            {merchantDetails && (
              <div style={styles.detailsGrid}>
                <div style={styles.detailItem}>
                  <div style={styles.detailLabel}>Merchant ID</div>
                  <div style={styles.detailValue}>{merchantDetails.merchantId}</div>
                </div>
                <div style={styles.detailItem}>
                  <div style={styles.detailLabel}>Processing Status</div>
                  <div style={styles.detailValue}>
                    {merchantDetails.processingEnabled ? '✔ Enabled' : '✗ Disabled'}
                  </div>
                </div>
                <div style={styles.detailItem}>
                  <div style={styles.detailLabel}>Settlement Status</div>
                  <div style={styles.detailValue}>
                    {merchantDetails.settlementEnabled ? '✔ Enabled' : '✗ Disabled'}
                  </div>
                </div>
                <div style={styles.detailItem}>
                  <div style={styles.detailLabel}>Processor</div>
                  <div style={styles.detailValue}>{merchantDetails.processor}</div>
                </div>
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button
                onClick={handleCheckStatus}
                disabled={tavarPayLoading}
                style={styles.secondaryButton}
              >
                {tavarPayLoading ? 'Checking...' : 'Refresh Status'}
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.onboardingCard}>
            <h4 style={{ marginTop: 0 }}>Onboarding Status</h4>
            
            <div style={{ marginBottom: '20px' }}>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Current Status</div>
                <div>{getStatusBadge(businessData.finix_onboarding_status)}</div>
              </div>

              {businessData.finix_onboarding_form_id && (
                <div style={styles.detailItem}>
                  <div style={styles.detailLabel}>Form ID</div>
                  <div style={styles.detailValue}>{businessData.finix_onboarding_form_id}</div>
                </div>
              )}
            </div>

            {businessData.finix_onboarding_status === 'INCOMPLETE' || businessData.finix_onboarding_status === 'IN_PROGRESS' ? (
              <div>
                <p>You can continue your onboarding where you left off:</p>
                {linkExpired ? (
                  <button
                    onClick={handleGenerateNewLink}
                    disabled={tavarPayLoading || !canManageTavariPay}
                    style={styles.primaryButton}
                  >
                    {tavarPayLoading ? 'Generating...' : 'Generate New Onboarding Link'}
                  </button>
                ) : (
                  <button
                    onClick={() => window.location.href = businessData.finix_onboarding_link_url}
                    disabled={!businessData.finix_onboarding_link_url}
                    style={styles.primaryButton}
                  >
                    Continue Onboarding
                  </button>
                )}
              </div>
            ) : businessData.finix_onboarding_status === 'UPDATE_REQUESTED' ? (
              <div>
                <div style={styles.warningBanner}>
                  ⚠️ Additional information is required. Please complete the onboarding form.
                </div>
                {linkExpired ? (
                  <button
                    onClick={handleGenerateNewLink}
                    disabled={tavarPayLoading || !canManageTavariPay}
                    style={styles.primaryButton}
                  >
                    {tavarPayLoading ? 'Generating...' : 'Generate New Link'}
                  </button>
                ) : (
                  <button
                    onClick={() => window.location.href = businessData.finix_onboarding_link_url}
                    disabled={!businessData.finix_onboarding_link_url}
                    style={styles.primaryButton}
                  >
                    Update Information
                  </button>
                )}
              </div>
            ) : businessData.finix_onboarding_status === 'COMPLETED' ? (
              <div>
                <p>Your onboarding is complete and under review. This usually takes just a few minutes.</p>
                <button
                  onClick={handleCheckStatus}
                  disabled={tavarPayLoading}
                  style={styles.secondaryButton}
                >
                  {tavarPayLoading ? 'Checking...' : 'Check Approval Status'}
                </button>
              </div>
            ) : businessData.finix_onboarding_status === 'REJECTED' ? (
              <div>
                <div style={styles.errorBanner}>
                  Your application was not approved. Please contact support for more information.
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  // Render loading state
  if (loading || authLoading || permissionsLoading) {
    return (
      <SessionManager>
        <div style={styles.container}>
          <div style={styles.loading}>Loading business settings...</div>
        </div>
      </SessionManager>
    );
  }

  // Render permission denied
  if (!canViewSettings) {
    return (
      <SessionManager>
        <div style={styles.container}>
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <h2 style={{ color: '#374151', marginBottom: '16px' }}>Access Denied</h2>
            <p style={{ color: '#6b7280' }}>You do not have permission to view settings</p>
          </div>
        </div>
      </SessionManager>
    );
  }

  // Render error state
  if (error && !businessData) {
    return (
      <SessionManager>
        <div style={styles.container}>
          <div style={styles.error}>{error}</div>
        </div>
      </SessionManager>
    );
  }

  // Main render
  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'admin', 'manager']}
      requireBusiness={true}
      componentName="SettingsScreen"
    >
      <SecurityWrapper>
        <SessionManager>
          <div style={styles.container}>
            <div style={styles.header}>
              <h2>Business Settings</h2>
              <p>Update your business information and manage system access</p>
              <p style={styles.deploymentDate}>Deployed: November 17, 2025 v2</p>
            </div>

            {/* Tab Navigation */}
            <div style={styles.tabNav}>
              <PermissionGate permission="business.settings.view" fallback={null}>
                <button 
                  style={{...styles.tab, ...(activeTab === 'basic' ? styles.activeTab : {})}}
                  onClick={() => setActiveTab('basic')}
                >
                  📋 Basic Info
                </button>
              </PermissionGate>

              <PermissionGate permission="business.hours.edit" fallback={null}>
                <button 
                  style={{...styles.tab, ...(activeTab === 'hours' ? styles.activeTab : {})}}
                  onClick={() => setActiveTab('hours')}
                >
                  🕐 Hours
                </button>
              </PermissionGate>

              <PermissionGate permission="business.hours.edit" fallback={null}>
                <button 
                  style={{...styles.tab, ...(activeTab === 'holidays' ? styles.activeTab : {})}}
                  onClick={() => setActiveTab('holidays')}
                >
                  🎄 Holidays
                </button>
              </PermissionGate>

              <PermissionGate permission="admin.roles.view" fallback={null}>
                <button 
                  style={{...styles.tab, ...(activeTab === 'roles' ? styles.activeTab : {})}}
                  onClick={() => setActiveTab('roles')}
                >
                  🔑 Roles & Access
                </button>
              </PermissionGate>

              <PermissionGate permission="business.settings.edit" fallback={null}>
                <button 
                  style={{...styles.tab, ...(activeTab === 'colors' ? styles.activeTab : {})}}
                  onClick={() => setActiveTab('colors')}
                >
                  🎨 Colors
                </button>
              </PermissionGate>

              <PermissionGate permission="business.settings.edit" fallback={null}>
                <button
                  style={{...styles.tab, ...(activeTab === 'scheduling' ? styles.activeTab : {})}}
                  onClick={() => setActiveTab('scheduling')}
                >
                  📆 Scheduling
                </button>
              </PermissionGate>

              <PermissionGate permission="business.tavari_pay.manage" requireOwner fallback={null}>
                <button 
                  style={{...styles.tab, ...(activeTab === 'tavari-pay' ? styles.activeTab : {})}}
                  onClick={() => setActiveTab('tavari-pay')}
                >
                  💳 Tavari Pay
                </button>
              </PermissionGate>
            </div>

            <div style={styles.content}>
              {/* Basic Information Tab */}
              {activeTab === 'basic' && businessData && canEditBasicInfo && (
                <BasicInfoTab
                  businessData={businessData}
                  handleChange={handleChange}
                  styles={styles}
                  brandingData={brandingData}
                  setBrandingData={setBrandingData}
                  handleUploadAsset={handleUploadAsset}
                />
              )}

              {/* Operating Hours Tab */}
              {activeTab === 'hours' && businessData && canEditHours && (
                <OperatingHoursTab
                  businessData={businessData}
                  handleChange={handleChange}
                  handleHoursChange={handleHoursChange}
                  handleDayClosedToggle={handleDayClosedToggle}
                  styles={styles}
                  defaultHours={defaultHours}
                />
              )}

              {/* Holiday Hours Tab */}
              {activeTab === 'holidays' && businessData && canEditHours && (
                <HolidayHoursTab
                  businessData={businessData}
                  addHoliday={addHoliday}
                  updateHoliday={updateHoliday}
                  updateHolidayHours={updateHolidayHours}
                  removeHoliday={removeHoliday}
                  styles={styles}
                />
              )}

              {/* Role Management Tab */}
              {activeTab === 'roles' && canManageRoles && (
                <RoleManagementTab
                  businessId={selectedBusinessId}
                  styles={styles}
                />
              )}

              {/* Colors Tab */}
              {activeTab === 'colors' && canEditBasicInfo && (
                <ColorsTab
                  brandingData={brandingData}
                  setBrandingData={setBrandingData}
                  canEdit={canEditBasicInfo}
                />
              )}

              {activeTab === 'scheduling' && canEditHours && (
                <SchedulingSettingsTab
                  businessId={selectedBusinessId}
                  operatingHours={businessData?.operating_hours}
                  initialSettings={schedulingSettings}
                  onSettingsUpdated={(updated) => setSchedulingSettings(updated)}
                  onShowSuccess={() => setShowSuccessModal(true)}
                />
              )}

              {/* Tavari Pay Tab */}
              {activeTab === 'tavari-pay' && canManageTavariPay && renderTavariPayTab()}

              {error && businessData && (
                <div style={styles.errorMessage}>
                  {error}
                </div>
              )}
            </div>

            {/* Only show save button for tabs that need it */}
            {['basic', 'hours', 'holidays', 'colors'].includes(activeTab) && (
              <div style={styles.actions}>
                <button 
                  onClick={() => navigate('/dashboard/audit-logs')} 
                  style={styles.secondaryButtonBottom}
                >
                  View Audit Logs
                </button>
                
                <button 
                  onClick={handleSave} 
                  disabled={saving || !businessData} 
                  style={styles.primaryButtonBottom}
                >
                  {saving ? 'Saving Changes...' : 'Save Business Settings'}
                </button>
              </div>
            )}

            {/* Success Modal */}
            <SuccessModal 
              isOpen={showSuccessModal} 
              onClose={handleModalClose} 
            />
          </div>
        </SessionManager>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '20px',
    paddingTop: '120px',
    boxSizing: 'border-box'
  },
  header: {
    marginBottom: '20px',
    textAlign: 'center'
  },
  tabNav: {
    display: 'flex',
    gap: '2px',
    marginBottom: '30px',
    backgroundColor: '#e5e7eb',
    borderRadius: '8px',
    padding: '4px'
  },
  tab: {
    flex: 1,
    padding: '12px 20px',
    backgroundColor: 'transparent',
    color: '#6b7280',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  activeTab: {
    backgroundColor: 'white',
    color: '#008080',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    marginBottom: '20px'
  },
  section: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '25px',
    marginBottom: '20px',
    border: '1px solid #e5e7eb'
  },
  sectionTitle: {
    margin: '0 0 20px 0',
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#1f2937',
    borderBottom: '2px solid #008080',
    paddingBottom: '8px'
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '14px',
    margin: '8px 0 0 0'
  },
  deploymentDate: {
    color: '#9ca3af',
    fontSize: '12px',
    margin: '4px 0 0 0',
    fontStyle: 'italic'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: '6px'
  },
  input: {
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    transition: 'border-color 0.2s ease'
  },
  select: {
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    backgroundColor: 'white',
    cursor: 'pointer'
  },
  helpText: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
    fontStyle: 'italic'
  },
  errorMessage: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '20px',
    border: '1px solid #fecaca'
  },
  actions: {
    display: 'flex',
    gap: '15px',
    justifyContent: 'space-between'
  },
  secondaryButtonBottom: {
    flex: 1,
    padding: '15px',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  primaryButtonBottom: {
    flex: 2,
    padding: '15px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '200px',
    fontSize: '18px',
    color: '#6b7280'
  },
  error: {
    textAlign: 'center',
    padding: '40px',
    color: '#dc2626',
    fontSize: '16px'
  },
  // Tavari Pay specific styles
  tavariPayHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '25px'
  },
  onboardingCard: {
    backgroundColor: '#f9fafb',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    padding: '30px',
    marginTop: '20px'
  },
  approvedCard: {
    backgroundColor: '#f0fdf4',
    border: '2px solid #86efac',
    borderRadius: '8px',
    padding: '30px',
    marginTop: '20px'
  },
  featureList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '12px',
    margin: '20px 0'
  },
  featureItem: {
    fontSize: '15px',
    color: '#374151',
    padding: '8px 0'
  },
  primaryButton: {
    padding: '12px 24px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '10px'
  },
  secondaryButton: {
    padding: '12px 24px',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginTop: '20px'
  },
  detailItem: {
    padding: '15px',
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e7eb'
  },
  detailLabel: {
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: '4px'
  },
  detailValue: {
    fontSize: '16px',
    color: '#1f2937',
    fontWeight: '500'
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '15px',
    border: '1px solid #fecaca',
    fontSize: '14px'
  },
  warningBanner: {
    backgroundColor: '#fef3c7',
    color: '#d97706',
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '15px',
    border: '1px solid #fde68a',
    fontSize: '14px'
  }
};

export default SettingsScreen;
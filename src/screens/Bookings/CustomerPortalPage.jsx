// src/screens/Bookings/CustomerPortalPage.jsx
// Customer-facing booking portal. Public route: /customer-portal/:businessId/portal

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiX } from 'react-icons/fi';
import waiverOTPService from '../../services/Waivers/WaiverOTPService';
import {
  clearCustomerPortalSession,
  loadCustomerPortalSession,
  saveCustomerPortalSession,
} from '../../utils/customerPortalSession';
import { fetchTavariApiBookingCatalog } from '../../services/TavariApis/tavariApisCatalog';
import {
  mergePortalActivityWithCatalog,
} from '../../utils/bookingPortalActivityDisplay';

const PORTAL_CORE_LOAD_TIMEOUT_MS = 20000;

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out. Please refresh and try again.`)), timeoutMs);
    }),
  ]);
}

function enrichActivitiesWithCatalog(rawActivities, catalogActivities) {
  const catalogByActivityId = new Map(
    (catalogActivities || []).map((activity) => [activity.id, activity]),
  );

  const enriched = (rawActivities || []).map((activity) => {
    const catalogActivity = catalogByActivityId.get(activity.id);
    const mergedActivity = mergePortalActivityWithCatalog(activity, catalogActivity);
    const pricing = catalogActivity
      ? {
          startingPrice: Number(catalogActivity.startingPrice) || 0,
          startingPriceFormatted: catalogActivity.startingPriceFormatted || '',
        }
      : {
          startingPrice: 0,
          startingPriceFormatted: '',
        };
    return {
      ...mergedActivity,
      display_order: activity.display_order ?? mergedActivity.display_order ?? 0,
      startingPrice: pricing.startingPrice,
      startingPriceFormatted: pricing.startingPriceFormatted,
    };
  });

  return enriched.sort((a, b) => {
    const orderDiff = (Number(a.display_order) || 0) - (Number(b.display_order) || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.activity_name || '').localeCompare(String(b.activity_name || ''));
  });
}

const CustomerPortalPage = () => {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [business, setBusiness] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [types, setTypes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [sectionsByActivity, setSectionsByActivity] = useState({});
  const [selectedTypeId, setSelectedTypeId] = useState(null);
  const [expandedSectionIndex, setExpandedSectionIndex] = useState({});
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [showAccountCreation, setShowAccountCreation] = useState(false);
  const [loadingOTP, setLoadingOTP] = useState(false);
  const [customerAccount, setCustomerAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    city: '',
  });

  useEffect(() => {
    if (!businessId) return;
    loadData();
  }, [businessId]);

  // Deep link: ?type=<booking_types.id> pre-selects a booking category in the sidebar
  useEffect(() => {
    const typeParam = searchParams.get('type');
    if (!typeParam) return;
    if (!types.length) return;
    if (types.some((t) => t.id === typeParam)) {
      setSelectedTypeId(typeParam);
    } else {
      setSelectedTypeId(null);
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete('type');
          return n;
        },
        { replace: true }
      );
    }
  }, [searchParams, types, setSearchParams]);

  const selectCategoryFilter = (typeId) => {
    setSelectedTypeId(typeId);
    if (typeId == null) {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete('type');
          return n;
        },
        { replace: true }
      );
    } else {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('type', typeId);
          return n;
        },
        { replace: true }
      );
    }
  };

  const fetchPortalCustomerByPhone = useCallback(async (normalizedPhone) => {
    const { data, error } = await supabase.rpc('bookings_get_portal_customer_by_phone', {
      p_business_id: businessId,
      p_phone_number: normalizedPhone,
    });

    if (error) throw error;

    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }, [businessId]);

  const fetchPortalCustomerAccount = useCallback(async (customerId) => {
    const { data, error } = await supabase.rpc('bookings_get_portal_customer_account', {
      p_customer_id: customerId,
      p_business_id: businessId,
    });

    if (error) throw error;

    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;

    const restorePortalSession = async () => {
      const savedSession = loadCustomerPortalSession(businessId);
      if (!savedSession?.id) return;

      try {
        const customer = await fetchPortalCustomerAccount(savedSession.id);
        if (!customer?.id) {
          clearCustomerPortalSession(businessId);
          return;
        }

        const hydratedCustomer = {
          ...savedSession,
          ...customer,
          phone: customer.phone || customer.customer_phone || savedSession.phone || '',
          email: customer.email || customer.customer_email || savedSession.email || '',
          customer_email: customer.customer_email || customer.email || savedSession.customer_email || '',
        };

        setCustomerAccount(hydratedCustomer);
        setOtpVerified(true);
      } catch (_error) {
        clearCustomerPortalSession(businessId);
      }
    };

    restorePortalSession();
  }, [businessId, fetchPortalCustomerAccount]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [businessRes, brandingRes, typesRes, activitiesRes] = await withTimeout(
        Promise.all([
          supabase.from('businesses').select('id, name, business_address, business_email, business_phone, business_website').eq('id', businessId).single(),
          supabase.from('app_branding').select('logo_url').eq('business_id', businessId).maybeSingle(),
          supabase
            .from('booking_types')
            .select('id, type_name, display_name, display_order')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .order('display_order', { ascending: true })
            .order('type_name', { ascending: true }),
          supabase
            .from('booking_activities')
            .select('id, activity_name, type_id, description, website_package_inclusions, display_order')
            .eq('business_id', businessId)
            .eq('is_active', true)
            .eq('portal_visible', true)
            .order('display_order', { ascending: true })
            .order('activity_name', { ascending: true }),
        ]),
        PORTAL_CORE_LOAD_TIMEOUT_MS,
        'Loading booking portal',
      );

      if (businessRes.error || !businessRes.data) {
        setError('Business not found.');
        return;
      }

      if (activitiesRes.error) {
        console.error('[CustomerPortal] booking_activities load failed:', activitiesRes.error);
      }

      const rawActivities = activitiesRes.data || [];

      setBusiness(businessRes.data);
      setLogoUrl(brandingRes.data?.logo_url || null);
      setTypes(
        [...(typesRes.data || [])].sort((a, b) => {
          const orderDiff = (Number(a.display_order) || 0) - (Number(b.display_order) || 0);
          if (orderDiff !== 0) return orderDiff;
          return String(a.display_name || a.type_name || '').localeCompare(String(b.display_name || b.type_name || ''));
        }),
      );
      setActivities(enrichActivitiesWithCatalog(rawActivities, []));

      const activityIds = rawActivities.map((a) => a.id);
      if (activityIds.length === 0) {
        setSectionsByActivity({});
        return;
      }

      void (async () => {
        try {
          const [catalogRes, sectionsRes] = await Promise.all([
            fetchTavariApiBookingCatalog(businessId).catch((catalogError) => {
              console.error('[CustomerPortal] booking catalog load failed:', catalogError);
              return { activities: [] };
            }),
            supabase
              .from('booking_activity_sections')
              .select('id, activity_id, section_header, section_details, display_order')
              .in('activity_id', activityIds)
              .order('display_order'),
          ]);

          setActivities(enrichActivitiesWithCatalog(rawActivities, catalogRes?.activities || []));

          const byActivity = {};
          (sectionsRes.data || []).forEach((s) => {
            if (!byActivity[s.activity_id]) byActivity[s.activity_id] = [];
            byActivity[s.activity_id].push({
              id: s.id,
              header: s.section_header,
              details: s.section_details,
              display_order: s.display_order,
            });
          });
          Object.keys(byActivity).forEach((id) => {
            byActivity[id].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
          });
          setSectionsByActivity(byActivity);
        } catch (enrichError) {
          console.error('[CustomerPortal] portal enrich failed:', enrichError);
        }
      })();
    } catch (e) {
      setError(e?.message || 'Failed to load portal.');
    } finally {
      setLoading(false);
    }
  };

  const filteredActivities = selectedTypeId
    ? activities.filter((a) => a.type_id === selectedTypeId)
    : activities;

  const setSectionForActivity = (activityId, index) => {
    setExpandedSectionIndex((prev) => ({ ...prev, [activityId]: index }));
  };

  const resetLoginState = () => {
    setShowLoginModal(false);
    setShowAccountCreation(false);
    setOtpSent(false);
    setOtpCode('');
    setPhoneNumber('');
  };

  const handlePhoneSubmit = async () => {
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setLoadingOTP(true);
    try {
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const existingCustomer = await fetchPortalCustomerByPhone(normalizedPhone);

      if (existingCustomer?.id && existingCustomer?.customer_email) {
        const result = await waiverOTPService.generateOTP(
          businessId,
          normalizedPhone,
          existingCustomer.customer_email,
          existingCustomer.id
        );

        if (result.success) {
          clearCustomerPortalSession(businessId);
          setOtpSent(true);
          setShowAccountCreation(false);
          toast.success(`OTP sent to ${result.email || existingCustomer.customer_email || 'your email'}`);
        } else {
          toast.error(result.error || 'Failed to send OTP');
        }
        return;
      }

      if (existingCustomer?.id) {
        const existingNameParts = String(existingCustomer.customer_name || '').trim().split(/\s+/).filter(Boolean);
        setAccountForm((prev) => ({
          ...prev,
          firstName: prev.firstName || existingNameParts[0] || '',
          lastName: prev.lastName || existingNameParts.slice(1).join(' ') || '',
          email: prev.email || existingCustomer.customer_email || '',
        }));
      }

      setOtpSent(false);
      setShowAccountCreation(true);
      toast.success(
        existingCustomer?.id
          ? 'Please add your email address to continue.'
          : 'Create your account to continue.'
      );
    } catch (error) {
      console.error('Error sending OTP:', error);
      toast.error('Error sending OTP. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  const handleOTPVerify = async () => {
    if (!otpCode || otpCode.length !== 6) {
      toast.error('Please enter a valid 6-digit OTP code');
      return;
    }

    setLoadingOTP(true);
    try {
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const result = await waiverOTPService.verifyOTP(normalizedPhone, otpCode, businessId);

      if (!result.valid) {
        toast.error(result.error || 'Invalid OTP code');
        return;
      }

      const customerId = result.customerId ?? result.customer_id;
      if (!customerId) {
        toast.error('Could not find your customer account');
        return;
      }

      const customer = await fetchPortalCustomerAccount(customerId);
      const hydratedCustomer = {
        id: customerId,
        phone: normalizedPhone || result.phone_number,
        email: result.email,
        customer_email: result.email,
        ...customer,
      };

      setCustomerAccount(hydratedCustomer);
      setOtpVerified(true);
      saveCustomerPortalSession(businessId, hydratedCustomer);
      toast.success('You are now signed in');
      resetLoginState();
      navigate(`/customer-portal/${businessId}/account/bookings`);
    } catch (error) {
      console.error('Error verifying OTP:', error);
      toast.error('Error verifying OTP. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!accountForm.firstName || !accountForm.lastName || !accountForm.email) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoadingOTP(true);
    try {
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const { data: customerRows, error: customerError } = await supabase.rpc('bookings_create_or_get_portal_customer', {
        p_business_id: businessId,
        p_phone_number: normalizedPhone,
        p_email: accountForm.email,
        p_first_name: accountForm.firstName,
        p_last_name: accountForm.lastName,
        p_city: accountForm.city || null,
      });

      if (customerError) throw customerError;

      const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
      if (!customer?.id) {
        throw new Error('Failed to create account');
      }

      const hydratedCustomer = {
        ...customer,
        phone: normalizedPhone,
        email: customer.customer_email || accountForm.email,
        customer_email: customer.customer_email || accountForm.email,
        customer_name: customer.customer_name || `${accountForm.firstName} ${accountForm.lastName}`.trim(),
      };

      setCustomerAccount(hydratedCustomer);
      setOtpVerified(true);
      saveCustomerPortalSession(businessId, hydratedCustomer);
      toast.success('Account created successfully');
      resetLoginState();
      navigate(`/customer-portal/${businessId}/account/bookings`);
    } catch (error) {
      console.error('Error creating account:', error);
      toast.error('Error creating account. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  const handleSignOut = () => {
    clearCustomerPortalSession(businessId);
    setCustomerAccount(null);
    setOtpVerified(false);
    setShowAccountCreation(false);
    setOtpSent(false);
    setOtpCode('');
    setPhoneNumber('');
    toast.success('Signed out');
  };

  if (loading) {
    return (
      <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  if (error || !business) {
    return (
      <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={styles.error}>
          {error || 'Business not found.'}
          <Link to="/" style={styles.homeLink}>Go home</Link>
        </div>
      </div>
    );
  }

  const displayName = (t) => t.display_name || t.type_name || '';

  return (
    <div style={styles.page}>
      {/* Top: logo left, then business info */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          {logoUrl && (
            <img src={logoUrl} alt="" style={styles.logo} />
          )}
          <div style={styles.businessInfo}>
            <h1 style={styles.businessName}>{business.name}</h1>
            {business.business_website && (
              <a href={business.business_website.startsWith('http') ? business.business_website : `https://${business.business_website}`} target="_blank" rel="noopener noreferrer" style={styles.link}>
                {business.business_website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {business.business_address && <div style={styles.meta}>{business.business_address}</div>}
            {business.business_email && <div style={styles.meta}>{business.business_email}</div>}
            {business.business_phone && <div style={styles.meta}>{business.business_phone}</div>}
          </div>
          <div style={styles.headerActions}>
            {otpVerified && customerAccount?.id ? (
              <>
                <div style={styles.accountBadge}>
                  Signed in as {customerAccount.customer_name || customerAccount.customer_email || customerAccount.email || customerAccount.phone || 'Customer'}
                </div>
                <Link
                  to={`/customer-portal/${businessId}/account`}
                  style={{
                    ...styles.primaryAction,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  My account
                </Link>
                <button type="button" style={styles.secondaryAction} onClick={handleSignOut}>
                  Sign Out
                </button>
              </>
            ) : (
              <button type="button" style={styles.primaryAction} onClick={() => setShowLoginModal(true)}>
                Customer Login
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Two columns: 1/3 categories, 2/3 activities */}
      <div style={styles.columns}>
        <aside style={styles.aside}>
          <h2 style={styles.asideTitle}>Booking categories</h2>
          <div style={styles.categoryList}>
            <button
              type="button"
              style={{
                ...styles.categoryItem,
                ...(selectedTypeId === null ? styles.categoryItemActive : {}),
              }}
              onClick={() => selectCategoryFilter(null)}
            >
              All
            </button>
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                style={{
                  ...styles.categoryItem,
                  ...(selectedTypeId === t.id ? styles.categoryItemActive : {}),
                }}
                onClick={() => selectCategoryFilter(t.id)}
              >
                {displayName(t)}
              </button>
            ))}
          </div>
        </aside>

        <main style={styles.main}>
          <h2 style={styles.mainTitle}>Regular booking types &amp; special events</h2>
          <div style={styles.cards}>
            {filteredActivities.map((a) => {
              const sections = sectionsByActivity[a.id] || [];
              const currentIndex = expandedSectionIndex[a.id] ?? 0;
              const showing = sections[currentIndex];
              const activityUrl = `/customer-portal/${businessId}/portal/${a.id}`;

              return (
                <div key={a.id} style={styles.card}>
                  <div style={styles.cardTopRow}>
                    <h3 style={styles.cardHeader}>{a.activity_name}</h3>
                    {a.startingPriceFormatted ? (
                      <div style={styles.cardStartingPrice}>
                        <span style={styles.cardStartingPriceLabel}>Starting at</span>
                        <span style={styles.cardStartingPriceAmount}>{a.startingPriceFormatted}</span>
                      </div>
                    ) : null}
                  </div>
                  {sections.length > 0 && (
                    <>
                      <div style={styles.sectionContent}>
                        {showing && (
                          <>
                            <div style={styles.sectionHeader}>{showing.header}</div>
                            <div style={styles.sectionDetails}>{showing.details}</div>
                          </>
                        )}
                      </div>
                      {sections.length > 1 && (
                        <div style={styles.sectionButtons}>
                          {sections.map((_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              style={{
                                ...styles.sectionBtn,
                                ...(currentIndex === idx ? styles.sectionBtnActive : {}),
                              }}
                              onClick={() => setSectionForActivity(a.id, idx)}
                            >
                              {idx + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {sections.length === 0 && (
                    <div style={styles.cardMeta}>No additional information.</div>
                  )}
                  <div style={styles.cardActionWrap}>
                    <Link to={activityUrl} style={styles.cardActionSecondary}>
                      Check Availability
                    </Link>
                    <Link to={activityUrl} style={styles.cardAction}>
                      Book Now
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredActivities.length === 0 && (
            <div style={styles.empty}>No activities to show.</div>
          )}
        </main>
      </div>

      {showLoginModal && (
        <div style={styles.modalOverlay} onClick={resetLoginState}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                {showAccountCreation ? 'Create Account' : 'Customer Login'}
              </div>
              <button type="button" onClick={resetLoginState} style={styles.modalClose} aria-label="Close">
                <FiX size={24} />
              </button>
            </div>
            <div style={styles.modalBody}>
              {showAccountCreation ? (
                <div style={styles.formStack}>
                  <p style={styles.modalText}>Create your account so your saved information is available before you book.</p>
                  <input
                    type="text"
                    value={accountForm.firstName}
                    onChange={(e) => setAccountForm((prev) => ({ ...prev, firstName: e.target.value }))}
                    placeholder="First name"
                    style={styles.input}
                  />
                  <input
                    type="text"
                    value={accountForm.lastName}
                    onChange={(e) => setAccountForm((prev) => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Last name"
                    style={styles.input}
                  />
                  <input
                    type="email"
                    value={accountForm.email}
                    onChange={(e) => setAccountForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="Email address"
                    style={styles.input}
                  />
                  <input
                    type="text"
                    value={accountForm.city}
                    onChange={(e) => setAccountForm((prev) => ({ ...prev, city: e.target.value }))}
                    placeholder="City"
                    style={styles.input}
                  />
                  <button
                    type="button"
                    onClick={handleCreateAccount}
                    disabled={loadingOTP || !accountForm.firstName || !accountForm.lastName || !accountForm.email}
                    style={{
                      ...styles.primaryAction,
                      width: '100%',
                      ...(loadingOTP || !accountForm.firstName || !accountForm.lastName || !accountForm.email ? styles.disabledAction : {}),
                    }}
                  >
                    {loadingOTP ? 'Creating Account...' : 'Create Account'}
                  </button>
                </div>
              ) : !otpSent ? (
                <div style={styles.formStack}>
                  <p style={styles.modalText}>Enter your phone number to sign in to your customer account.</p>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="(555) 123-4567"
                    style={styles.input}
                  />
                  <button
                    type="button"
                    onClick={handlePhoneSubmit}
                    disabled={loadingOTP || !phoneNumber}
                    style={{
                      ...styles.primaryAction,
                      width: '100%',
                      ...(loadingOTP || !phoneNumber ? styles.disabledAction : {}),
                    }}
                  >
                    {loadingOTP ? 'Next...' : 'Next'}
                  </button>
                </div>
              ) : (
                <div style={styles.formStack}>
                  <p style={styles.modalText}>Enter the 6-digit code sent to your email address.</p>
                  <div
                    role="status"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1e3a8a',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ display: 'block', marginBottom: 4, color: '#1e40af' }}>
                      Check your junk or spam folder
                    </strong>
                    If you do not see the code in your inbox within a few minutes, check junk, spam, or promotions.
                    Mark the message as Not junk / Not spam so future emails reach you.
                  </div>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    style={{ ...styles.input, ...styles.otpInput }}
                  />
                  <button
                    type="button"
                    onClick={handleOTPVerify}
                    disabled={loadingOTP || otpCode.length !== 6}
                    style={{
                      ...styles.primaryAction,
                      width: '100%',
                      ...(loadingOTP || otpCode.length !== 6 ? styles.disabledAction : {}),
                    }}
                  >
                    {loadingOTP ? 'Verifying...' : 'Verify Code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpSent(false);
                      setOtpCode('');
                    }}
                    style={{ ...styles.secondaryAction, width: '100%' }}
                  >
                    Use a different phone number
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50,
    fontFamily: TavariStyles.typography?.fontFamily || 'system-ui, sans-serif',
  },
  loading: {
    padding: 48,
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
  },
  error: {
    padding: 48,
    textAlign: 'center',
    color: TavariStyles.colors.danger,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  homeLink: {
    color: TavariStyles.colors.primary,
    fontWeight: 600,
  },
  header: {
    backgroundColor: 'white',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    padding: '24px 32px',
  },
  headerInner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 24,
    maxWidth: 1200,
    margin: '0 auto',
  },
  headerActions: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  logo: {
    width: 80,
    height: 80,
    objectFit: 'contain',
    flexShrink: 0,
  },
  businessInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    textAlign: 'left',
  },
  accountBadge: {
    fontSize: 14,
    color: TavariStyles.colors.gray700,
    backgroundColor: TavariStyles.colors.gray100,
    borderRadius: 999,
    padding: '10px 14px',
    maxWidth: 360,
  },
  businessName: {
    fontSize: 24,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
    margin: '0 0 4px',
  },
  link: {
    fontSize: 14,
    color: TavariStyles.colors.primary,
    textDecoration: 'none',
  },
  meta: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
  },
  primaryAction: {
    border: 'none',
    borderRadius: 8,
    padding: '12px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    boxSizing: 'border-box',
  },
  secondaryAction: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 8,
    padding: '12px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: 'white',
    color: TavariStyles.colors.gray800,
    boxSizing: 'border-box',
  },
  disabledAction: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: 32,
    maxWidth: 1200,
    margin: '0 auto',
    padding: 32,
  },
  aside: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  asideTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
  },
  categoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  categoryItem: {
    padding: '12px 16px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 8,
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: TavariStyles.colors.gray700,
    textAlign: 'left',
  },
  categoryItemActive: {
    borderColor: TavariStyles.colors.primary,
    backgroundColor: `${TavariStyles.colors.primary}12`,
    color: TavariStyles.colors.primary,
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  mainTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
  },
  cards: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  cardHeader: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    margin: 0,
    flex: 1,
    minWidth: 0,
  },
  cardStartingPrice: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    textAlign: 'right',
    flexShrink: 0,
    gap: 2,
  },
  cardStartingPriceLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: TavariStyles.colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  cardStartingPriceAmount: {
    fontSize: 18,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
    whiteSpace: 'nowrap',
  },
  cardMeta: {
    fontSize: 14,
    color: TavariStyles.colors.gray500,
  },
  descriptionList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 14,
    color: TavariStyles.colors.gray700,
    lineHeight: 1.6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sectionContent: {
    fontSize: 14,
    color: TavariStyles.colors.gray700,
  },
  sectionHeader: {
    fontWeight: 600,
    marginBottom: 8,
    color: TavariStyles.colors.gray900,
  },
  sectionDetails: {
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  },
  sectionButtons: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    color: TavariStyles.colors.gray600,
  },
  sectionBtnActive: {
    borderColor: TavariStyles.colors.primary,
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
  },
  cardActionWrap: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  cardActionSecondary: {
    padding: '10px 20px',
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.primary}`,
    backgroundColor: 'white',
    color: TavariStyles.colors.primary,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
    textAlign: 'center',
  },
  cardAction: {
    padding: '10px 20px',
    borderRadius: 8,
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
    textAlign: 'center',
  },
  empty: {
    fontSize: 14,
    color: TavariStyles.colors.gray500,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 16,
    zIndex: 1000,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    boxSizing: 'border-box',
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    maxHeight: 'calc(100dvh - 32px)',
    margin: 'auto',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'white',
    borderRadius: 16,
    boxShadow: '0 20px 60px rgba(15, 23, 42, 0.2)',
    boxSizing: 'border-box',
    minHeight: 0,
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  modalClose: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    padding: 4,
    flexShrink: 0,
  },
  modalBody: {
    padding: 24,
    minWidth: 0,
    minHeight: 0,
    flex: '1 1 auto',
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    boxSizing: 'border-box',
  },
  modalText: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
    margin: 0,
  },
  formStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    minWidth: 0,
    width: '100%',
  },
  input: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: '12px 16px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 8,
    fontSize: 16,
  },
  otpInput: {
    textAlign: 'center',
    letterSpacing: '8px',
    fontFamily: 'monospace',
  },
};

export default CustomerPortalPage;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiCheckCircle, FiPlus, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import waiverOTPService from '../../services/Waivers/WaiverOTPService';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import {
  clearCustomerPortalSession,
  loadCustomerPortalSession,
  saveCustomerPortalSession,
} from '../../utils/customerPortalSession';
import { getCampRegistrationPortalPath } from '../../constants/camperRegistrationForm';
import BirthdateCalendarPicker from '../../components/UI/BirthdateCalendarPicker';
import PortalCustomerErrorModal from '../../components/Bookings/PortalCustomerErrorModal';

const emptyBirthdate = () => ({ year: '', month: '', day: '' });

function formatStatusLabel(status) {
  if (status === 'valid') return { label: 'Complete', tone: 'valid' };
  if (status === 'expired') return { label: 'Expired — update required', tone: 'expired' };
  return { label: 'Not on file', tone: 'missing' };
}

function statusColors(tone) {
  if (tone === 'valid') {
    return { bg: '#ecfdf5', border: '#10b981', text: '#065f46' };
  }
  if (tone === 'expired') {
    return { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' };
  }
  return { bg: '#fff7ed', border: '#f59e0b', text: '#92400e' };
}

const CustomerPortalCampRegistrationPage = () => {
  const { businessId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [business, setBusiness] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [formTitle, setFormTitle] = useState('Camp registration & medical form');
  const [formIntro, setFormIntro] = useState('');

  const [customerAccount, setCustomerAccount] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [customerError, setCustomerError] = useState(null);

  const showCustomerError = useCallback((message, title = 'Something went wrong') => {
    const text =
      typeof message === 'string'
        ? message
        : message?.message || 'We could not complete that step.';
    setCustomerError({
      message: String(text || 'We could not complete that step.'),
      title: typeof title === 'string' && title.trim() ? title : 'Something went wrong',
    });
  }, []);

  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [showAccountCreation, setShowAccountCreation] = useState(false);
  const [loadingOTP, setLoadingOTP] = useState(false);
  const [accountForm, setAccountForm] = useState({ firstName: '', lastName: '', email: '', city: '' });

  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipant, setNewParticipant] = useState({
    firstName: '',
    lastName: '',
    birthdate: emptyBirthdate(),
  });
  const [savingParticipant, setSavingParticipant] = useState(false);

  const returnPath = useMemo(() => getCampRegistrationPortalPath(businessId), [businessId]);

  const fetchPortalCustomerByPhone = useCallback(
    async (normalizedPhone) => {
      const { data, error: rpcError } = await supabase.rpc('bookings_get_portal_customer_by_phone', {
        p_business_id: businessId,
        p_phone_number: normalizedPhone,
      });
      if (rpcError) throw rpcError;
      if (Array.isArray(data)) return data[0] || null;
      return data || null;
    },
    [businessId]
  );

  const fetchPortalCustomerAccount = useCallback(
    async (customerId) => {
      const { data, error: rpcError } = await supabase.rpc('bookings_get_portal_customer_account', {
        p_customer_id: customerId,
        p_business_id: businessId,
      });
      if (rpcError) throw rpcError;
      if (Array.isArray(data)) return data[0] || null;
      return data || null;
    },
    [businessId]
  );

  const loadParticipants = useCallback(
    async (customerId, customerRecord) => {
      if (!businessId || !customerId) return;
      setLoadingParticipants(true);
      try {
        const { data: rows, error: rpcError } = await supabase.rpc('bookings_get_portal_participants', {
          p_customer_id: customerId,
          p_business_id: businessId,
        });

        let list = [];
        if (!rpcError && rows) {
          list = Array.isArray(rows) ? rows : rows ? [rows] : [];
        }

        if (list.length === 0 && customerRecord) {
          const nameParts = String(customerRecord.customer_name || '').trim().split(/\s+/).filter(Boolean);
          list = [
            {
              id: customerRecord.id,
              first_name: nameParts[0] || '',
              last_name: nameParts.slice(1).join(' ') || '',
              date_of_birth: customerRecord.date_of_birth ?? null,
              participant_type: 'primary',
              is_account_owner: true,
            },
          ];
        }

        camperRegistrationService.setBusinessId(businessId);
        const registrations = await camperRegistrationService.getCustomerRegistrations(customerId);
        const enriched = camperRegistrationService.enrichParticipants(list, registrations, true);
        setParticipants(enriched);
      } catch (loadError) {
        console.error(loadError);
        showCustomerError(loadError?.message || 'Could not load campers on your account');
      } finally {
        setLoadingParticipants(false);
      }
    },
    [businessId]
  );

  const hydrateCustomer = useCallback(
    async (customerId, extras = {}) => {
      const customer = await fetchPortalCustomerAccount(customerId);
      if (!customer?.id) throw new Error('Customer account not found');

      const hydrated = {
        ...customer,
        ...extras,
        id: customerId,
        phone: extras.phone || customer.phone || customer.customer_phone || '',
        email: extras.email || customer.email || customer.customer_email || '',
        customer_email: extras.customer_email || customer.customer_email || customer.email || '',
      };

      setCustomerAccount(hydrated);
      saveCustomerPortalSession(businessId, hydrated);
      await loadParticipants(customerId, hydrated);
      return hydrated;
    },
    [businessId, fetchPortalCustomerAccount, loadParticipants]
  );

  useEffect(() => {
    if (!businessId) return;

    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const [businessRes, brandingRes, template] = await Promise.all([
          supabase
            .from('businesses')
            .select('id, name, business_email, business_phone, business_address, business_website')
            .eq('id', businessId)
            .single(),
          supabase.from('app_branding').select('logo_url').eq('business_id', businessId).maybeSingle(),
          camperRegistrationService.getFormTemplate(businessId),
        ]);

        if (businessRes.error || !businessRes.data) {
          setError('Business not found.');
          return;
        }

        setBusiness(businessRes.data);
        setLogoUrl(brandingRes.data?.logo_url || null);
        setFormTitle(template?.form_title || 'Camp registration & medical form');
        setFormIntro(template?.form_intro || '');

        const savedSession = loadCustomerPortalSession(businessId);
        if (savedSession?.id) {
          await hydrateCustomer(savedSession.id, savedSession);
        }
      } catch (initError) {
        setError(initError?.message || 'Failed to load page.');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [businessId, hydrateCustomer]);

  const minorCampers = useMemo(
    () => participants.filter((p) => camperRegistrationService.participantRequiresCamperRegistration(p, true)),
    [participants]
  );

  const handlePhoneSubmit = async () => {
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      showCustomerError('Please enter a valid phone number');
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
          toast.success(`Verification code sent to ${result.email || existingCustomer.customer_email}`);
        } else {
          showCustomerError(result.error || 'Failed to send verification code');
        }
        return;
      }

      if (existingCustomer?.id) {
        const nameParts = String(existingCustomer.customer_name || '').trim().split(/\s+/).filter(Boolean);
        setAccountForm((prev) => ({
          ...prev,
          firstName: prev.firstName || nameParts[0] || '',
          lastName: prev.lastName || nameParts.slice(1).join(' ') || '',
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
    } catch (submitError) {
      console.error(submitError);
      showCustomerError('Could not send verification code. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  const handleOTPVerify = async () => {
    if (!otpCode || otpCode.length !== 6) {
      showCustomerError('Please enter the 6-digit code');
      return;
    }

    setLoadingOTP(true);
    try {
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const result = await waiverOTPService.verifyOTP(normalizedPhone, otpCode, businessId);

      if (!result.valid) {
        showCustomerError(result.error || 'Invalid verification code');
        return;
      }

      const customerId = result.customerId ?? result.customer_id;
      if (!customerId) {
        showCustomerError('Could not find your customer account');
        return;
      }

      await hydrateCustomer(customerId, {
        phone: normalizedPhone,
        email: result.email,
        customer_email: result.email,
      });

      setOtpSent(false);
      setOtpCode('');
      setPhoneNumber('');
      setShowAccountCreation(false);
      toast.success('Signed in');
    } catch (verifyError) {
      console.error(verifyError);
      showCustomerError('Could not verify code. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!accountForm.firstName || !accountForm.lastName || !accountForm.email) {
      showCustomerError('Please fill in all required fields');
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
      if (!customer?.id) throw new Error('Failed to create account');

      await hydrateCustomer(customer.id, {
        phone: normalizedPhone,
        email: customer.customer_email || accountForm.email,
        customer_email: customer.customer_email || accountForm.email,
        customer_name: customer.customer_name || `${accountForm.firstName} ${accountForm.lastName}`.trim(),
      });

      setShowAccountCreation(false);
      setOtpSent(false);
      setPhoneNumber('');
      toast.success('Account ready — add each camper below');
    } catch (createError) {
      console.error(createError);
      showCustomerError(createError?.message || 'Could not create account');
    } finally {
      setLoadingOTP(false);
    }
  };

  const handleSignOut = () => {
    clearCustomerPortalSession(businessId);
    setCustomerAccount(null);
    setParticipants([]);
    setOtpSent(false);
    setOtpCode('');
    setPhoneNumber('');
    setShowAccountCreation(false);
    toast.success('Signed out');
  };

  const openFormForParticipant = (participant) => {
    if (!participant?.id) return;
    navigate(`/customer-portal/${businessId}/camper-registration/${participant.id}`, {
      state: {
        participant,
        customerAccount,
        returnUrl: returnPath,
      },
    });
  };

  const handleAddParticipant = async () => {
    if (!customerAccount?.id) return;
    if (!newParticipant.firstName.trim() || !newParticipant.lastName.trim()) {
      showCustomerError('First and last name are required');
      return;
    }
    const { year, month, day } = newParticipant.birthdate;
    if (!year || !month || !day) {
      showCustomerError('Birthdate is required');
      return;
    }

    const dateOfBirth = `${year}-${month}-${day}`;
    setSavingParticipant(true);
    try {
      const { data: rows, error: rpcError } = await supabase.rpc('bookings_add_portal_participant', {
        p_business_id: businessId,
        p_customer_id: customerAccount.id,
        p_first_name: newParticipant.firstName.trim(),
        p_last_name: newParticipant.lastName.trim(),
        p_date_of_birth: dateOfBirth,
        p_participant_type: 'minor',
      });

      if (rpcError) throw rpcError;

      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row?.id) throw new Error('Could not save camper');

      await loadParticipants(customerAccount.id, customerAccount);
      setShowAddParticipant(false);
      setNewParticipant({ firstName: '', lastName: '', birthdate: emptyBirthdate() });
      toast.success('Camper added');

      const participant = {
        ...row,
        participant_type: 'minor',
        is_minor: true,
      };
      openFormForParticipant(participant);
    } catch (addError) {
      console.error(addError);
      showCustomerError(addError?.message || 'Could not add camper');
    } finally {
      setSavingParticipant(false);
    }
  };

  if (loading) {
    return <div style={styles.centered}>Loading…</div>;
  }

  if (error || !business) {
    return (
      <div style={styles.centered}>
        {error || 'Business not found.'}
      </div>
    );
  }

  const businessName = business.name || 'Camp';

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          {logoUrl ? (
            <img src={logoUrl} alt="" style={styles.logo} />
          ) : null}
          <div>
            <h1 style={styles.businessName}>{businessName}</h1>
            <p style={styles.headerSubtitle}>{formTitle}</p>
          </div>
        </div>
        {customerAccount ? (
          <button type="button" onClick={handleSignOut} style={styles.secondaryBtn}>
            Sign out
          </button>
        ) : null}
      </header>

      <main style={styles.main}>
        {formIntro ? <p style={styles.intro}>{formIntro}</p> : null}

        {!customerAccount ? (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Sign in to continue</h2>
            <p style={styles.cardText}>
              Use the phone number on your customer account. We will email you a one-time verification code — no booking
              is required.
            </p>

            {!showAccountCreation ? (
              <>
                <label style={styles.label}>Mobile phone</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="(555) 555-0100"
                  style={styles.input}
                  disabled={otpSent}
                />

                {!otpSent ? (
                  <button type="button" onClick={handlePhoneSubmit} disabled={loadingOTP} style={styles.primaryBtn}>
                    {loadingOTP ? 'Sending…' : 'Continue'}
                  </button>
                ) : (
                  <>
                    <label style={{ ...styles.label, marginTop: 16 }}>Verification code</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit code"
                      style={styles.input}
                    />
                    <button type="button" onClick={handleOTPVerify} disabled={loadingOTP} style={styles.primaryBtn}>
                      {loadingOTP ? 'Verifying…' : 'Verify & sign in'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpSent(false);
                        setOtpCode('');
                      }}
                      style={styles.linkBtn}
                    >
                      Use a different phone number
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <p style={styles.cardText}>We need an email on file to send your verification code.</p>
                <label style={styles.label}>First name</label>
                <input
                  style={styles.input}
                  value={accountForm.firstName}
                  onChange={(e) => setAccountForm((p) => ({ ...p, firstName: e.target.value }))}
                />
                <label style={styles.label}>Last name</label>
                <input
                  style={styles.input}
                  value={accountForm.lastName}
                  onChange={(e) => setAccountForm((p) => ({ ...p, lastName: e.target.value }))}
                />
                <label style={styles.label}>Email</label>
                <input
                  type="email"
                  style={styles.input}
                  value={accountForm.email}
                  onChange={(e) => setAccountForm((p) => ({ ...p, email: e.target.value }))}
                />
                <button type="button" onClick={handleCreateAccount} disabled={loadingOTP} style={styles.primaryBtn}>
                  {loadingOTP ? 'Saving…' : 'Continue'}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div style={styles.accountBanner}>
              Signed in as{' '}
              <strong>{customerAccount.customer_name || customerAccount.customer_email || 'your account'}</strong>
            </div>

            <div style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <h2 style={styles.cardTitle}>Your campers</h2>
                <button type="button" onClick={() => setShowAddParticipant(true)} style={styles.secondaryBtn}>
                  <FiPlus size={16} /> Add camper
                </button>
              </div>
              <p style={styles.cardText}>
                Complete or update the annual registration and medical form for each child attending camp. Forms are valid
                for one year from the date signed.
              </p>

              {loadingParticipants ? (
                <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray600 }}>Loading campers…</div>
              ) : minorCampers.length === 0 ? (
                <div style={styles.emptyBox}>
                  <p style={{ margin: 0 }}>
                    No campers found on your account yet. Add each child who will attend camp, then complete their form.
                  </p>
                  <button type="button" onClick={() => setShowAddParticipant(true)} style={styles.primaryBtn}>
                    Add your first camper
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {minorCampers.map((participant) => {
                    const status = formatStatusLabel(participant.camper_registration_status);
                    const colors = statusColors(status.tone);
                    const name =
                      `${participant.first_name || ''} ${participant.last_name || ''}`.trim() || 'Camper';
                    const dob = participant.date_of_birth
                      ? new Date(participant.date_of_birth).toLocaleDateString('en-CA')
                      : null;
                    const expiresAt = participant.camper_registration_document?.expires_at;

                    return (
                      <div
                        key={participant.id}
                        style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: 12,
                          padding: 16,
                          background: colors.bg,
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 12,
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: TavariStyles.colors.gray900 }}>{name}</div>
                          {dob ? (
                            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
                              Date of birth: {dob}
                            </div>
                          ) : null}
                          <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginTop: 6 }}>
                            {status.tone === 'valid' && expiresAt ? (
                              <>
                                <FiCheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                Valid until {new Date(expiresAt).toLocaleDateString('en-CA')}
                              </>
                            ) : (
                              status.label
                            )}
                          </div>
                        </div>
                        <button type="button" onClick={() => openFormForParticipant(participant)} style={styles.primaryBtn}>
                          {status.tone === 'valid' ? 'Update form' : 'Complete form'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {showAddParticipant ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add camper</h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddParticipant(false);
                  setNewParticipant({ firstName: '', lastName: '', birthdate: emptyBirthdate() });
                }}
                style={styles.iconBtn}
                aria-label="Close"
              >
                <FiX size={20} />
              </button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: TavariStyles.colors.gray600 }}>
              Enter your child&apos;s legal name and birthdate. Only minors need this registration form.
            </p>
            <label style={styles.label}>First name</label>
            <input
              style={styles.input}
              value={newParticipant.firstName}
              onChange={(e) => setNewParticipant((p) => ({ ...p, firstName: e.target.value }))}
            />
            <label style={styles.label}>Last name</label>
            <input
              style={styles.input}
              value={newParticipant.lastName}
              onChange={(e) => setNewParticipant((p) => ({ ...p, lastName: e.target.value }))}
            />
            <label style={styles.label}>Birthdate</label>
            <div style={{ marginBottom: 16 }}>
              <BirthdateCalendarPicker
                value={newParticipant.birthdate}
                onChange={(birthdate) => setNewParticipant((p) => ({ ...p, birthdate }))}
                yearRangeBack={19}
                popoverZIndex={10001}
              />
            </div>
            <button type="button" onClick={handleAddParticipant} disabled={savingParticipant} style={styles.primaryBtn}>
              {savingParticipant ? 'Saving…' : 'Save & open form'}
            </button>
          </div>
        </div>
      ) : null}

      <PortalCustomerErrorModal
        open={Boolean(customerError)}
        title={customerError?.title}
        message={customerError?.message}
        businessName={business?.name}
        phone={business?.business_phone}
        email={business?.business_email}
        onClose={() => setCustomerError(null)}
      />
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: TavariStyles.colors.gray50,
  },
  centered: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    color: TavariStyles.colors.gray600,
  },
  header: {
    background: '#fff',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  headerInner: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  logo: {
    height: 48,
    width: 'auto',
    objectFit: 'contain',
  },
  businessName: {
    margin: 0,
    fontSize: 23,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  headerSubtitle: {
    margin: '4px 0 0',
    fontSize: 14,
    color: TavariStyles.colors.gray600,
  },
  main: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '32px 16px 48px',
  },
  intro: {
    margin: '0 0 20px',
    fontSize: 15,
    lineHeight: 1.6,
    color: TavariStyles.colors.gray700,
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    padding: 24,
  },
  cardHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  cardTitle: {
    margin: '0 0 8px',
    fontSize: 20,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  cardText: {
    margin: '0 0 20px',
    fontSize: 14,
    lineHeight: 1.55,
    color: TavariStyles.colors.gray600,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontWeight: 600,
    fontSize: 13,
    color: TavariStyles.colors.gray800,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
    marginBottom: 12,
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 18px',
    borderRadius: 8,
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 14px',
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    color: TavariStyles.colors.gray800,
  },
  linkBtn: {
    marginTop: 12,
    border: 'none',
    background: 'transparent',
    color: TavariStyles.colors.primary,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
  },
  accountBanner: {
    marginBottom: 16,
    padding: '12px 16px',
    borderRadius: 8,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    fontSize: 14,
    color: '#1e40af',
  },
  emptyBox: {
    padding: 24,
    borderRadius: 8,
    background: TavariStyles.colors.gray50,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    alignItems: 'flex-start',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 10000,
  },
  modal: {
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    width: 'min(480px, 100%)',
    maxHeight: '90vh',
    overflow: 'auto',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iconBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 4,
  },
};

export default CustomerPortalCampRegistrationPage;

// PortalLogin.jsx - Employee Portal OTP Login Screen
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { sessionPersistence } from '../../services/SessionPersistence';
import { clearAllAuthData } from '../../utils/authCleanup';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import { setEmployeePortalProfiles, setEmployeePortalSelectedProfile } from '../../utils/employeeProfileSelection';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { membershipUserIdOrFilter } from '../../utils/employeePortalMembership';
import { TavariStyles } from '../../utils/TavariStyles';

const PortalLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [verificationId, setVerificationId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(() => {
    const storedPreference = localStorage.getItem('stayLoggedInPreference');
    return storedPreference === null ? true : storedPreference === 'true';
  });

  const phoneInputRef = useRef(null);
  const codeInputRef = useRef(null);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) return;

      const publicUserId = await getPublicUserId(session.user.email);
      if (!publicUserId) return;

      const hasAccess = await checkEmployeeAccess(session, publicUserId);
      if (hasAccess) navigate(employeeAppPath('/portal'), { replace: true });
    };

    checkSession();
  }, [navigate]);

  const handleRequestCode = async (event) => {
    event.preventDefault();
    setErrorMsg('');

    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 10) {
      setErrorMsg('Please enter a valid phone number.');
      return;
    }

    setIsLoading(true);
    try {
      clearAllAuthData('employee_portal_otp_request');
      const data = await invokeEmployeePortalOtp({
        action: 'request',
        phone: normalizedPhone,
      });

      setMaskedEmail(data?.masked_email || '');
      setStep(2);
      toast.success(data?.masked_email ? `Code sent to ${data.masked_email}` : data?.message || 'Verification code sent if the phone is on file.');
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (error) {
      console.error('[PortalLogin] OTP request failed:', error);
      setErrorMsg(toUserFacingLoginError(error, 'Could not send a verification code. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();
    setErrorMsg('');

    const normalizedPhone = normalizePhone(phone);
    let code = otpCode.replace(/\D/g, '').slice(0, 6);
    if (code.length === 5) code = code.padStart(6, '0');
    if (code.length !== 6) {
      setErrorMsg('Please enter the 6-digit code.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await invokeEmployeePortalOtp({
        action: 'verify',
        phone: normalizedPhone,
        otp_code: code,
        profile_selection: true,
      });

      if (data?.selection_required) {
        const availableProfiles = Array.isArray(data.profiles) ? data.profiles : [];
        setEmployeePortalProfiles(availableProfiles);
        setProfiles(availableProfiles);
        setVerificationId(data.verification_id || '');
        setStep(3);
        toast.success('Choose the profile you want to open.');
        return;
      }

      if (!data?.email || !data?.token_hash) {
        throw new Error('That code didn’t work. Check the number or request a new code.');
      }

      const availableProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      setEmployeePortalProfiles(availableProfiles);
      await finishOtpSignIn(data, availableProfiles[0] || data.employee || null);
    } catch (error) {
      console.error('[PortalLogin] OTP verify failed:', error);
      setErrorMsg(toUserFacingLoginError(error, 'Could not verify that code. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileSelection = async (profile) => {
    setErrorMsg('');
    setIsLoading(true);
    try {
      const data = await invokeEmployeePortalOtp({
        action: 'select_profile',
        verification_id: verificationId,
        employee_id: profile.employee_id,
        business_id: profile.business_id,
      });

      if (!data?.email || !data?.token_hash) {
        throw new Error('Could not open that workplace profile. Try another or request a new code.');
      }

      setEmployeePortalProfiles(Array.isArray(data.profiles) ? data.profiles : profiles);
      await finishOtpSignIn(data, profile);
    } catch (error) {
      console.error('[PortalLogin] profile selection failed:', error);
      setErrorMsg(toUserFacingLoginError(error, 'Could not open that profile. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const finishOtpSignIn = async (data, profile) => {
    const { data: authData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: data.type || 'magiclink',
    });

    if (verifyError) {
      throw new Error(mapVerifyOtpClientError(verifyError.message));
    }
    if (authData?.session) {
      await supabase.auth.setSession({
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      });
    }

    const session = authData?.session;
    const publicUserId = await getPublicUserId(data.email);
    const hasAccess = session && publicUserId ? await checkEmployeeAccess(session, publicUserId) : false;
    if (!hasAccess) {
      await supabase.auth.signOut();
      setErrorMsg('Access denied. This portal is for employees only.');
      return;
    }

    if (stayLoggedIn) {
      sessionPersistence.enablePersistence();
      sessionPersistence.startAutoRefresh();
      localStorage.setItem('stayLoggedInPreference', 'true');
    } else {
      sessionPersistence.disablePersistence();
      localStorage.setItem('stayLoggedInPreference', 'false');
    }

    completeProfileSelection(profile);
  };

  const completeProfileSelection = (profile) => {
    if (profile) setEmployeePortalSelectedProfile(profile);
    localStorage.setItem('employeePortalOtpLogin', 'true');
    const returnUrl = new URLSearchParams(location.search).get('returnUrl') || employeeAppPath('/portal');
    navigate(returnUrl, { replace: true });
    toast.success('Welcome to your Employee Portal!');
  };

  const handleBack = () => {
    setStep(1);
    setOtpCode('');
    setMaskedEmail('');
    setProfiles([]);
    setVerificationId('');
    setErrorMsg('');
    setTimeout(() => phoneInputRef.current?.focus(), 100);
  };

  return (
    <div style={styles.container}>
      <div style={styles.loginCard}>
        <div style={styles.header}>
          <h1 style={styles.title}>Employee Portal</h1>
          <p style={styles.subtitle}>
            {step === 1
              ? 'Enter your phone number to receive a login code by email.'
              : step === 2
                ? `Enter the 6-digit code${maskedEmail ? ` sent to ${maskedEmail}` : ' sent to your email on file'}.`
                : 'Choose which employee profile you want to open.'}
          </p>
        </div>

        {step === 1 ? (
          <form onSubmit={handleRequestCode} style={styles.form}>
            {errorMsg && <div style={styles.errorMsg}>{errorMsg}</div>}

            <div style={styles.inputGroup}>
              <label htmlFor="phone" style={styles.label}>Phone Number</label>
              <input
                ref={phoneInputRef}
                id="phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(555) 555-5555"
                required
                disabled={isLoading}
                style={styles.input}
                autoFocus
              />
            </div>

            <button type="submit" disabled={isLoading} style={{ ...styles.button, opacity: isLoading ? 0.7 : 1 }}>
              {isLoading ? 'Sending Code...' : 'Send Email Code'}
            </button>
          </form>
        ) : step === 2 ? (
          <form onSubmit={handleVerifyCode} style={styles.form}>
            {errorMsg && <div style={styles.errorMsg}>{errorMsg}</div>}

            <div style={styles.inputGroup}>
              <label htmlFor="otpCode" style={styles.label}>Verification Code</label>
              <input
                ref={codeInputRef}
                id="otpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                required
                disabled={isLoading}
                style={{ ...styles.input, ...styles.codeInput }}
                autoFocus
              />
            </div>

            <div style={styles.checkboxWrapper}>
              <TavariCheckbox
                checked={stayLoggedIn}
                onChange={(checked) => setStayLoggedIn(checked)}
                label="Stay logged in"
              />
            </div>

            <button type="button" onClick={handleRequestCode} disabled={isLoading} style={styles.linkButton}>
              Resend code
            </button>

            <div style={styles.actions}>
              <button type="button" onClick={handleBack} style={{ ...styles.button, ...styles.secondaryButton }}>
                Back
              </button>
              <button type="submit" disabled={isLoading} style={{ ...styles.button, flex: 2, opacity: isLoading ? 0.7 : 1 }}>
                {isLoading ? 'Verifying...' : 'Sign In'}
              </button>
            </div>
          </form>
        ) : (
          <div style={styles.form}>
            {errorMsg && <div style={styles.errorMsg}>{errorMsg}</div>}
            <div style={styles.profileList}>
              {profiles.map((profile) => (
                <button
                  key={`${profile.employee_id}-${profile.business_id}`}
                  type="button"
                  style={styles.profileButton}
                  onClick={() => handleProfileSelection(profile)}
                  disabled={isLoading}
                >
                  <span style={styles.profileBusiness}>{profile.business_name || 'Business'}</span>
                  <span style={styles.profileName}>{profile.employee_name || profile.email}</span>
                  {profile.terminated && <span style={styles.profileMeta}>Terminated - temporary access</span>}
                </button>
              ))}
            </div>
            <button type="button" onClick={handleBack} style={{ ...styles.button, ...styles.secondaryButton }}>
              Back
            </button>
          </div>
        )}

        <div style={styles.footer}>
          <p style={styles.helperText}>The code is sent to the employee email address on file.</p>
          <p style={styles.versionText}>Tavari Employee Portal | May 9 2026 V1</p>
        </div>
      </div>
    </div>
  );
};

async function invokeEmployeePortalOtp(body) {
  const { data, error } = await supabase.functions.invoke('employee-portal-otp-action', { body });
  if (error) {
    throw await parseFunctionsInvokeError(error);
  }
  if (data && data.ok === false && typeof data.error === 'string') {
    throw new Error(data.error);
  }
  return data;
}

async function parseFunctionsInvokeError(error) {
  if (error?.name === 'FunctionsHttpError' && error.context?.clone) {
    try {
      const parsed = await error.context.clone().json();
      if (typeof parsed?.error === 'string') {
        return new Error(parsed.error);
      }
    } catch (_) {
      /* ignore */
    }
  }
  const raw = String(error?.message || '');
  if (/non-2xx|FunctionsHttpError|Edge Function returned/i.test(raw)) {
    return new Error('Something went wrong on our end. Please try again or request a new code.');
  }
  return error instanceof Error ? error : new Error('Something went wrong. Please try again.');
}

function toUserFacingLoginError(error, fallback) {
  if (!(error instanceof Error) || !error.message) {
    return fallback;
  }
  const msg = error.message;
  if (/non-2xx|FunctionsHttpError|Edge Function returned|FunctionsFetchError/i.test(msg)) {
    return 'Something went wrong. Please try again or request a new code.';
  }
  return msg;
}

function mapVerifyOtpClientError(authMessage) {
  const m = String(authMessage || '');
  if (/expir/i.test(m)) return 'This sign-in step expired. Go back and request a new code.';
  if (/invalid|token|session|Only the token/i.test(m)) {
    return 'That sign-in couldn’t be confirmed. Request a new code and try again.';
  }
  return 'Could not complete sign-in. Try again or request a new code.';
}

const checkEmployeeAccess = async (session, publicUserId) => {
  const { data: businessUsers, error: businessError } = await supabase
    .from('business_users')
    .select('user_id, business_id, role')
    .eq('user_id', publicUserId)
    .limit(1);

  if (!businessError && businessUsers?.length > 0) return true;

  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('user_id, business_id, role, active')
    .or(membershipUserIdOrFilter(session.user.id, publicUserId))
    .eq('active', true)
    .limit(1);

  return Boolean(userRoles?.length);
};

const normalizePhone = (value) => {
  const digits = String(value || '').normalize('NFKC').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
};

const styles = {
  container: {
    minHeight: '100vh',
    width: '100%',
    maxWidth: '100vw',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TavariStyles.colors.gray50,
    padding: TavariStyles.spacing.xl,
    boxSizing: 'border-box',
    overflowX: 'hidden'
  },
  loginCard: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius?.xl || '16px',
    padding: TavariStyles.spacing['2xl'],
    boxShadow: TavariStyles.shadows?.lg || '0 10px 40px rgba(0,0,0,0.1)',
    boxSizing: 'border-box',
    overflowWrap: 'anywhere'
  },
  header: {
    textAlign: 'center',
    marginBottom: TavariStyles.spacing.xl
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray900,
    marginBottom: TavariStyles.spacing.sm
  },
  subtitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.md,
    lineHeight: 1.5
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },
  label: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    color: TavariStyles.colors.gray700
  },
  input: {
    width: '100%',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    fontSize: TavariStyles.typography.fontSize.base,
    backgroundColor: TavariStyles.colors.white,
    transition: 'border-color 0.2s',
    boxSizing: 'border-box'
  },
  codeInput: {
    textAlign: 'center',
    letterSpacing: '0.4em',
    fontSize: '24px',
    fontWeight: 800
  },
  errorMsg: {
    backgroundColor: TavariStyles.colors.danger + '15',
    color: TavariStyles.colors.danger,
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    fontSize: TavariStyles.typography.fontSize.sm,
    textAlign: 'center'
  },
  button: {
    width: '100%',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    cursor: 'pointer',
    transition: 'opacity 0.2s'
  },
  secondaryButton: {
    backgroundColor: TavariStyles.colors.gray300,
    color: TavariStyles.colors.gray700,
    flex: 1
  },
  checkboxWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  linkButton: {
    border: 'none',
    backgroundColor: 'transparent',
    color: TavariStyles.colors.primary,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    cursor: 'pointer',
    textAlign: 'center'
  },
  actions: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.sm
  },
  profileList: {
    display: 'grid',
    gap: TavariStyles.spacing.md
  },
  profileButton: {
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '14px',
    backgroundColor: TavariStyles.colors.white,
    padding: TavariStyles.spacing.lg,
    textAlign: 'left',
    cursor: 'pointer',
    display: 'grid',
    gap: '4px'
  },
  profileBusiness: {
    color: TavariStyles.colors.gray900,
    fontWeight: TavariStyles.typography.fontWeight.bold
  },
  profileName: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  profileMeta: {
    color: TavariStyles.colors.warning || '#b45309',
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  footer: {
    marginTop: TavariStyles.spacing.xl,
    textAlign: 'center'
  },
  helperText: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    lineHeight: 1.4
  },
  versionText: {
    marginTop: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray400,
    textAlign: 'center'
  }
};

export default PortalLogin;

import React, { useEffect, useMemo, useState } from 'react';
import { FiCheckCircle, FiExternalLink } from 'react-icons/fi';
import { Link, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { getBusinessWebsiteUrl, getCampRegistrationPortalPath } from '../../constants/camperRegistrationForm';
import { TavariStyles } from '../../utils/TavariStyles';

const REDIRECT_SECONDS = 16;

const CamperRegistrationCompletePage = () => {
  const { businessId } = useParams();
  const location = useLocation();
  const camperName = location.state?.camperName || 'Your camper';
  const wasUpdate = location.state?.wasUpdate === true;

  const [loading, setLoading] = useState(true);
  const [businessName, setBusinessName] = useState('');
  const [logoUrl, setLogoUrl] = useState(null);
  const [websiteUrl, setWebsiteUrl] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

  const websiteLabel = useMemo(() => {
    if (!websiteUrl) return '';
    try {
      return new URL(websiteUrl).host.replace(/^www\./, '');
    } catch {
      return websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
  }, [websiteUrl]);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      setLoading(true);
      try {
        const [businessRes, brandingRes] = await Promise.all([
          supabase.from('businesses').select('name, business_website').eq('id', businessId).single(),
          supabase.from('app_branding').select('logo_url').eq('business_id', businessId).maybeSingle(),
        ]);
        if (businessRes.data) {
          setBusinessName(businessRes.data.name || '');
          setWebsiteUrl(getBusinessWebsiteUrl(businessRes.data.business_website));
        }
        setLogoUrl(brandingRes.data?.logo_url || null);
      } finally {
        setLoading(false);
      }
    })();
  }, [businessId]);

  useEffect(() => {
    if (!websiteUrl) return undefined;

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          window.location.assign(websiteUrl);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [websiteUrl]);

  if (loading) {
    return <div style={styles.centered}>Loading…</div>;
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {logoUrl ? <img src={logoUrl} alt="" style={styles.logo} /> : null}

        <div style={styles.iconWrap}>
          <FiCheckCircle size={56} color="#059669" />
        </div>

        <h1 style={styles.title}>{wasUpdate ? 'Registration updated' : 'Registration complete'}</h1>

        <p style={styles.message}>
          Thank you! <strong>{camperName}</strong>&apos;s camp registration and medical form has been saved
          {businessName ? ` with ${businessName}` : ''}.
        </p>

        <p style={styles.submessage}>
          {wasUpdate
            ? 'Your updated information is on file and valid for one year from today’s date.'
            : 'Your form is on file and valid for one year from today’s date.'}
        </p>

        {websiteUrl ? (
          <div style={styles.redirectBox}>
            <p style={styles.redirectText}>
              Redirecting you to {websiteLabel || 'our website'} in{' '}
              <strong>{secondsLeft}</strong> second{secondsLeft === 1 ? '' : 's'}…
            </p>
            <a href={websiteUrl} style={styles.primaryButton}>
              <FiExternalLink size={18} />
              Go to {websiteLabel || 'website'} now
            </a>
          </div>
        ) : (
          <p style={styles.submessage}>
            You can close this page. If you need to complete a form for another camper, use the link below.
          </p>
        )}

        <Link to={getCampRegistrationPortalPath(businessId)} style={styles.secondaryLink}>
          Complete another camper&apos;s form
        </Link>
      </div>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: TavariStyles.colors.gray50,
    padding: '32px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: TavariStyles.colors.gray600,
  },
  card: {
    width: 'min(520px, 100%)',
    background: '#fff',
    borderRadius: 16,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    padding: '36px 28px',
    textAlign: 'center',
    boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
  },
  logo: {
    height: 48,
    width: 'auto',
    objectFit: 'contain',
    marginBottom: 20,
  },
  iconWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    margin: '0 0 12px',
    fontSize: 28,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  message: {
    margin: '0 0 12px',
    fontSize: 16,
    lineHeight: 1.55,
    color: TavariStyles.colors.gray700,
  },
  submessage: {
    margin: '0 0 24px',
    fontSize: 14,
    lineHeight: 1.5,
    color: TavariStyles.colors.gray600,
  },
  redirectBox: {
    padding: 20,
    borderRadius: 12,
    background: '#ecfdf5',
    border: '1px solid #10b981',
    marginBottom: 20,
  },
  redirectText: {
    margin: '0 0 16px',
    fontSize: 14,
    color: '#065f46',
    lineHeight: 1.5,
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 20px',
    borderRadius: 8,
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    textDecoration: 'none',
  },
  secondaryLink: {
    display: 'inline-block',
    fontSize: 14,
    fontWeight: 600,
    color: TavariStyles.colors.primary,
    textDecoration: 'none',
  },
};

export default CamperRegistrationCompletePage;

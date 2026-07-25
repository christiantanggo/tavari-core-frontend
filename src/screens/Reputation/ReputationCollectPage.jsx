import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const starRowStyle = {
  display: 'flex',
  gap: 12,
  justifyContent: 'center',
  marginBottom: 24,
  flexWrap: 'wrap',
};

function StarButton({ selected, value, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      style={{
        width: 52,
        height: 52,
        borderRadius: 12,
        border: selected ? `2px solid ${TavariStyles.colors.primary}` : `1px solid ${TavariStyles.colors.gray300}`,
        background: selected ? TavariStyles.colors.infoBg : '#fff',
        fontSize: 23,
        cursor: 'pointer',
        lineHeight: 1,
      }}
      aria-label={`${value} stars`}
    >
      ★
    </button>
  );
}

export default function ReputationCollectPage() {
  const { token, businessId } = useParams();
  const isInviteMode = Boolean(token && !businessId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [minStars, setMinStars] = useState(4);
  const [privacyUrl, setPrivacyUrl] = useState('');
  const [termsUrl, setTermsUrl] = useState('');

  const [rating, setRating] = useState(null);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const anonSessionKey = useMemo(() => {
    const k = `reputation_sess_${businessId || 'x'}`;
    try {
      let s = sessionStorage.getItem(k);
      if (!s) {
        s = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        sessionStorage.setItem(k, s);
      }
      return s;
    } catch {
      return `${Date.now()}-${Math.random()}`;
    }
  }, [businessId]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        if (isInviteMode) {
          const { data, error: e } = await supabase.rpc('reputation_public_invite_preview', {
            p_secret: token,
          });
          if (e) throw e;
          if (!data?.ok) {
            setError(data?.error === 'invalid_token' ? 'This link is not valid.' : 'Unable to load review page.');
            setLoading(false);
            return;
          }
          setBusinessName(data.business_name || 'Business');
          setEnabled(data.enabled !== false);
          setMinStars(Number(data.min_stars_redirect_google) || 4);
          setPrivacyUrl(data.privacy_policy_url || '');
          setTermsUrl(data.terms_url || '');
          if (data.expired) setError('This review link has expired.');
          if (data.already_used) setError('This link was already used.');
        } else if (businessId) {
          const { data, error: e } = await supabase.rpc('reputation_public_landing_meta', {
            p_business_id: businessId,
          });
          if (e) throw e;
          if (!data?.ok) {
            setError(data?.error === 'not_found' ? 'Business not found.' : 'Unable to load review page.');
            setLoading(false);
            return;
          }
          setBusinessName(data.business_name || 'Business');
          setEnabled(!!data.enabled);
          setMinStars(Number(data.min_stars_redirect_google) || 4);
          setPrivacyUrl(data.privacy_policy_url || '');
          setTermsUrl(data.terms_url || '');
        } else {
          setError('Missing link parameters.');
        }
      } catch (err) {
        console.error(err);
        setError('Something went wrong loading this page.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, businessId, isInviteMode]);

  const showComment = rating != null && rating < minStars;

  /** Pass explicitRating when firing immediately after star tap so we don't read stale state. */
  const submit = async (explicitRating) => {
    const r = explicitRating !== undefined ? explicitRating : rating;
    if (r == null || submitting) return;
    const needsLowRatingComment = r < minStars;
    if (needsLowRatingComment && comment.trim().length < 2) {
      const msg = 'Please add a brief comment (at least 2 characters).';
      setError(msg);
      toast.error(msg);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (isInviteMode) {
        const { data, error: e } = await supabase.rpc('reputation_public_submit_invite', {
          p_token_secret: token,
          p_rating: r,
          p_comment: comment.trim(),
        });
        if (e) throw e;
        if (!data?.ok) {
          setError(data?.error === 'already_used' ? 'This link was already used.' : 'Could not submit.');
          return;
        }
        setResult(data);
        if (data.redirect_google && data.google_review_url) {
          await supabase.rpc('reputation_public_ack_google_click', { p_token_secret: token });
          window.location.href = data.google_review_url;
          return;
        }
      } else {
        const { data, error: e } = await supabase.rpc('reputation_public_submit_anonymous', {
          p_business_id: businessId,
          p_rating: r,
          p_comment: comment.trim(),
          p_session_key: anonSessionKey,
        });
        if (e) throw e;
        if (!data?.ok) {
          setError(data?.error === 'already_submitted' ? 'You already submitted feedback from this device.' : 'Could not submit.');
          return;
        }
        setResult(data);
        if (data.redirect_google && data.google_review_url) {
          await supabase.rpc('reputation_public_ack_google_click_anonymous', {
            p_business_id: businessId,
            p_session_key: anonSessionKey,
          });
          window.location.href = data.google_review_url;
          return;
        }
      }
      setDone(true);
    } catch (err) {
      console.error(err);
      setError('Submission failed. Please try again.');
      toast.error('Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontFamily: TavariStyles.typography.fontFamily }}>
        Loading…
      </div>
    );
  }

  if (!enabled && !error) {
    return (
      <div style={{ padding: 48, maxWidth: 520, margin: '0 auto', fontFamily: TavariStyles.typography.fontFamily }}>
        <h2 style={{ marginTop: 0 }}>{businessName}</h2>
        <p>Reputation collection is not enabled for this business.</p>
      </div>
    );
  }

  if (done || (result && !result.redirect_google)) {
    return (
      <div style={{ padding: 48, maxWidth: 520, margin: '0 auto', fontFamily: TavariStyles.typography.fontFamily }}>
        <h2 style={{ marginTop: 0, color: TavariStyles.colors.primary }}>Thank you</h2>
        <p>Your feedback helps us improve. We appreciate you taking the time.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 560, margin: '0 auto', fontFamily: TavariStyles.typography.fontFamily }}>
      <h2 style={{ marginTop: 0, textAlign: 'center' }}>{businessName}</h2>
      <p style={{ textAlign: 'center', color: TavariStyles.colors.gray600 }}>
        How was your experience? Tap a star rating below.
      </p>

      {error ? (
        <p style={{ color: TavariStyles.colors.danger, textAlign: 'center' }}>{error}</p>
      ) : null}

      {rating != null && rating >= minStars && error && !submitting ? (
        <button
          type="button"
          onClick={() => submit(rating)}
          style={{
            marginTop: 12,
            width: '100%',
            padding: '12px 20px',
            borderRadius: 10,
            border: `1px solid ${TavariStyles.colors.primary}`,
            background: '#fff',
            color: TavariStyles.colors.primary,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      ) : null}

      <div style={starRowStyle}>
        {[1, 2, 3, 4, 5].map((v) => (
          <StarButton
            key={v}
            value={v}
            selected={rating === v}
            onSelect={(val) => {
              setRating(val);
              if (error && /^Please add a brief comment/i.test(error)) setError('');
              if (val >= minStars) {
                submit(val);
              }
            }}
          />
        ))}
      </div>

      {showComment ? (
        <>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
            Tell us what we could improve (optional but helpful)
          </label>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (error && /^Please add a brief comment/i.test(error)) setError('');
            }}
            rows={4}
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${TavariStyles.colors.gray300}`,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </>
      ) : null}

      {(privacyUrl || termsUrl) && (
        <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 16 }}>
          {privacyUrl ? (
            <a href={privacyUrl} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          ) : null}{' '}
          {privacyUrl && termsUrl ? ' · ' : ''}
          {termsUrl ? (
            <a href={termsUrl} target="_blank" rel="noreferrer">
              Terms
            </a>
          ) : null}
        </div>
      )}

      {rating != null && rating < minStars ? (
        <button
          type="button"
          onClick={() => submit()}
          disabled={submitting}
          style={{
            marginTop: 24,
            width: '100%',
            padding: '14px 20px',
            borderRadius: 10,
            border: 'none',
            background: TavariStyles.colors.primary,
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Sending…' : 'Submit feedback'}
        </button>
      ) : submitting ? (
        <p style={{ marginTop: 24, textAlign: 'center', fontWeight: 600, color: TavariStyles.colors.gray700 }}>
          {rating != null && rating >= minStars ? 'Opening review page…' : 'Sending…'}
        </p>
      ) : null}
    </div>
  );
}

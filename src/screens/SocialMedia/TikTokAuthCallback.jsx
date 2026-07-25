// screens/SocialMedia/TikTokAuthCallback.jsx
// Handles TikTok OAuth callback redirect
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, X, Loader } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import { TikTokOAuthService } from '../../services/socialMedia/TikTokOAuthService';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

const TikTokAuthCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const processCallback = async () => {
      // Extract OAuth parameters from URL
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      // Handle error case
      if (error) {
        setStatus('error');
        setErrorMessage(errorDescription || error || 'Authentication failed');
        toast.error('TikTok authentication failed');
        return;
      }

      // Verify state token (CSRF protection)
      if (state && !TikTokOAuthService.verifyStateToken(state)) {
        setStatus('error');
        setErrorMessage('Invalid state token. Please try connecting again.');
        toast.error('Security verification failed');
        return;
      }

      // Handle success case - authorization code received
      if (code) {
        setStatus('processing');
        
        try {
          // Get business ID from session storage (stored during OAuth initiation)
          // Or get from URL params if passed
          let businessId = sessionStorage.getItem('tiktok_oauth_business_id') ||
                          new URLSearchParams(window.location.search).get('business_id');
          
          if (!businessId) {
            // Try to get from user's default business
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
              throw new Error('Not authenticated');
            }

            // Query user's businesses
            const { data: userRoles } = await supabase
              .from('user_roles')
              .select('business_id')
              .eq('user_id', session.user.id)
              .eq('active', true)
              .limit(1)
              .single();

            if (!userRoles?.business_id) {
              throw new Error('Business ID not found. Please ensure you have an active business.');
            }
            
            businessId = userRoles.business_id;
          }

          // Get redirect URI (must match the one used in OAuth request)
          const redirectUri = `${window.location.origin}/auth/tiktok/callback`;

          // Exchange authorization code for access token
          const result = await TikTokOAuthService.exchangeCodeForToken(
            code,
            redirectUri,
            businessId
          );

          if (result.success) {
            setStatus('success');
            toast.success('TikTok account connected successfully!');
            
            // Clean up session storage
            sessionStorage.removeItem('tiktok_oauth_business_id');
            
            // Redirect to dashboard after 2 seconds
            setTimeout(() => {
              navigate('/dashboard/social-media');
            }, 2000);
          } else {
            throw new Error(result.error || 'Failed to connect TikTok account');
          }
        } catch (error) {
          console.error('TikTok OAuth callback error:', error);
          setStatus('error');
          setErrorMessage(error.message || 'Failed to connect TikTok account');
          toast.error(error.message || 'Failed to connect TikTok account');
        }
      } else {
        // No code or error - invalid callback
        setStatus('error');
        setErrorMessage('Invalid authentication response. Please try again.');
        toast.error('Invalid authentication response');
      }
    };

    processCallback();
  }, [searchParams, navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f9fafb',
      padding: '20px',
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        padding: '48px',
        maxWidth: '500px',
        width: '100%',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        textAlign: 'center',
      }}>
        {status === 'processing' && (
          <>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: '#f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <Loader size={40} color={TavariStyles.colors.primary || '#008080'} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
            <h2 style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#1f2937',
              marginBottom: '12px',
            }}>
              Completing Authentication
            </h2>
            <p style={{
              fontSize: '16px',
              color: '#6b7280',
            }}>
              Please wait while we connect your TikTok account...
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: '#00f2ea',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <Check size={40} color="#ffffff" />
            </div>
            <h2 style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#1f2937',
              marginBottom: '12px',
            }}>
              Connected to TikTok
            </h2>
            <p style={{
              fontSize: '16px',
              color: '#6b7280',
              marginBottom: '24px',
            }}>
              Your TikTok account has been successfully connected!
            </p>
            <p style={{
              fontSize: '14px',
              color: '#9ca3af',
            }}>
              Redirecting to dashboard...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: '#fee2e2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <X size={40} color="#dc2626" />
            </div>
            <h2 style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#1f2937',
              marginBottom: '12px',
            }}>
              Authentication Failed
            </h2>
            <p style={{
              fontSize: '16px',
              color: '#6b7280',
              marginBottom: '24px',
            }}>
              {errorMessage}
            </p>
            <button
              onClick={() => navigate('/dashboard/social-media')}
              style={{
                padding: '12px 32px',
                backgroundColor: TavariStyles.colors.primary || '#008080',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                marginRight: '12px',
              }}
            >
              Back to Dashboard
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 32px',
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </>
        )}
      </div>

      {/* Add spinner animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default TikTokAuthCallback;


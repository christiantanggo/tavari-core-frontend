// PersonalInfoFormScreen.jsx - Redirects to portal for personal info completion
import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const PersonalInfoFormScreen = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    // Simple validation and redirect - same flow as contract signing
    const handleRedirect = async () => {
      if (!token) {
        // No token - redirect immediately
        navigate('/portal/login', { replace: true });
        return;
      }

      try {
        // Quick validation - check if token exists in users or contracts
        const [userResult, contractResult] = await Promise.allSettled([
          supabase
            .from('users')
            .select('id, email, personal_info_token')
            .eq('personal_info_token', token)
            .maybeSingle(),
          supabase
            .from('hr_contracts')
            .select('employee_email, employee_id, personal_info_token')
            .eq('personal_info_token', token)
            .maybeSingle()
        ]);

        const userData = userResult.status === 'fulfilled' && !userResult.value.error ? userResult.value.data : null;
        const contractData = contractResult.status === 'fulfilled' && !contractResult.value.error ? contractResult.value.data : null;

        if (userData || contractData) {
          // Token is valid - store it for PortalLayout
          sessionStorage.setItem('personal_info_token', token);
          sessionStorage.setItem('personal_info_redirect', 'true');
          if (userData?.email) {
            sessionStorage.setItem('personal_info_user_email', userData.email);
          } else if (contractData?.employee_email) {
            sessionStorage.setItem('personal_info_user_email', contractData.employee_email);
          }
        }
        // If token is invalid, still redirect - PortalLayout will handle it

        // Check if already logged in
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          navigate('/portal', { replace: true });
        } else {
          navigate('/portal/login', { replace: true });
        }
      } catch (error) {
        // On any error, just redirect to login
        console.error('Error validating personal info token:', error);
        navigate('/portal/login', { replace: true });
      }
    };

    // Small delay to ensure component renders
    const timer = setTimeout(handleRedirect, 100);
    return () => clearTimeout(timer);
  }, [token, navigate]);

  // Simple loading state - redirects immediately
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h2 style={styles.title}>Redirecting to Employee Portal...</h2>
          <p style={styles.subtitle}>
            Please wait while we redirect you to complete your personal information.
          </p>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '20px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    padding: '32px',
    maxWidth: '800px',
    width: '100%'
  },
  header: {
    marginBottom: '24px',
    textAlign: 'center'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333'
  },
  subtitle: {
    fontSize: '14px',
    color: '#666'
  }
};

export default PersonalInfoFormScreen;

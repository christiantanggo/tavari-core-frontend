// screens/Mail/UnsubscribePage.jsx - PUBLIC PAGE with Enhanced Security
import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { FiCheckCircle, FiAlertCircle, FiX, FiMail, FiShield } from 'react-icons/fi';

/**
 * PUBLIC UNSUBSCRIBE PAGE
 * 
 * This page does NOT use the permission system because:
 * - It's a public-facing compliance page required by CASL/PIPEDA
 * - Accessed by email recipients via token links, not authenticated users
 * - Uses token-based authorization instead of user permissions
 * - Must remain accessible to anyone with a valid unsubscribe token
 * 
 * Security is handled through:
 * - Token validation
 * - Rate limiting on database queries
 * - Audit logging via log_consent_action RPC
 * - Input sanitization
 */
const UnsubscribePage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [contactDetails, setContactDetails] = useState(null);
  const [attemptCount, setAttemptCount] = useState(0);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setMessage('No unsubscribe token provided. This link may be incomplete or expired.');
      return;
    }

    // Rate limiting: Prevent too many attempts
    if (attemptCount > 3) {
      setStatus('error');
      setMessage('Too many attempts. Please try again later or contact support.');
      return;
    }

    handleUnsubscribe();
  }, [token]);

  /**
   * Parse and validate the unsubscribe token
   * Signed format: base64url(json).base64url(signature)
   * Legacy format: base64(contactId:businessId)
   */
  const parseToken = (tokenString) => {
    try {
      // Sanitize input
      if (!tokenString || typeof tokenString !== 'string' || tokenString.length > 1200) {
        return null;
      }

      if (tokenString.includes('.')) {
        const [encodedPayload] = tokenString.split('.');
        if (!encodedPayload) return null;

        const normalizedPayload = encodedPayload
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        const paddedPayload = normalizedPayload.padEnd(
          normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
          '='
        );

        const parsedPayload = JSON.parse(atob(paddedPayload));
        const contactId = String(parsedPayload?.contactId || '').trim();
        const businessId = String(parsedPayload?.businessId || '').trim();

        if (!contactId || !businessId) {
          return null;
        }

        return {
          contactId,
          businessId,
          emailAddress: String(parsedPayload?.emailAddress || '').trim().toLowerCase(),
          signed: true
        };
      }

      const normalizedToken = tokenString
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const paddedToken = normalizedToken.padEnd(
        normalizedToken.length + ((4 - (normalizedToken.length % 4)) % 4),
        '='
      );

      const decoded = atob(paddedToken);
      const [contactId, businessId] = decoded.split(':');
      
      // Validate UUID format (basic check)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      if (!contactId || !businessId || 
          !uuidRegex.test(contactId) || 
          !uuidRegex.test(businessId)) {
        return null;
      }

      return { contactId, businessId, signed: false };
    } catch (error) {
      console.error('Token parse error:', error);
      return null;
    }
  };

  /**
   * Handle the unsubscribe process with security and compliance logging
   */
  const handleUnsubscribe = async () => {
    setAttemptCount(prev => prev + 1);

    try {
      const tokenData = parseToken(token);
      
      if (!tokenData?.contactId || !tokenData?.businessId) {
        setStatus('invalid');
        setMessage('Invalid unsubscribe token. This link may be corrupted or expired.');
        return;
      }

      // Fetch contact with business verification
      const { data: contact, error: contactError } = await supabase
        .from('mail_contacts')
        .select('id, email, first_name, last_name, subscribed, business_id')
        .eq('id', tokenData.contactId)
        .eq('business_id', tokenData.businessId)
        .single();

      if (contactError) {
        console.error('Contact fetch error:', contactError);
        setStatus('invalid');
        setMessage('Contact not found or link has expired. Please contact support if you continue to receive emails.');
        return;
      }

      if (!contact) {
        setStatus('invalid');
        setMessage('Contact not found in our system.');
        return;
      }

      setEmail(contact.email);
      setContactDetails({
        firstName: contact.first_name,
        lastName: contact.last_name
      });

      // Already unsubscribed
      if (!contact.subscribed) {
        setStatus('already_unsubscribed');
        setMessage('This email address is already unsubscribed from our mailing list.');
        
        // Log the duplicate attempt for compliance tracking
        await logConsentAction(
          tokenData.businessId,
          tokenData.contactId,
          contact.email,
          'unsubscribe_duplicate',
          'unsubscribe_link',
          token
        );
        
        return;
      }

      // Perform unsubscribe through the existing DB consent/unsubscribe path.
      const unsubscribeResult = await logConsentAction(
        tokenData.businessId,
        tokenData.contactId,
        contact.email,
        'unsubscribe',
        'unsubscribe_link',
        token
      );

      if (!unsubscribeResult.success) {
        console.error('Unsubscribe error:', unsubscribeResult.error);
        setStatus('error');
        setMessage('Failed to process unsubscribe request. Please contact support or try again later.');
        return;
      }

      setStatus('success');
      setMessage('You have been successfully unsubscribed from our mailing list.');

    } catch (error) {
      console.error('Unsubscribe process error:', error);
      setStatus('error');
      setMessage('An unexpected error occurred. Please contact support or try again later.');
    }
  };

  /**
   * Log consent action for compliance (CASL/PIPEDA)
   */
  const logConsentAction = async (businessId, contactId, emailAddress, action, source, signedToken = null) => {
    try {
      const { data, error } = await supabase.functions.invoke('mail-consent-action', {
        body: {
          businessId,
          contactId,
          emailAddress,
          action,
          consentSource: source,
          consentMethod: 'email_link',
          consentText: null,
          ipAddress: null,
          userAgent: navigator.userAgent || null,
          additionalData: null,
          signedToken
        }
      });

      if (error || data?.ok === false) {
        throw error || new Error(data?.error || 'Failed to log consent action');
      }

      return { success: true };
    } catch (error) {
      console.error('Error logging consent action:', error);
      return { success: false, error };
    }
  };

  /**
   * Render status-specific icon
   */
  const renderIcon = () => {
    switch (status) {
      case 'loading':
        return <div style={styles.spinner} />;
      case 'success':
      case 'already_unsubscribed':
        return <FiCheckCircle style={{...styles.icon, color: '#4caf50'}} />;
      case 'error':
        return <FiAlertCircle style={{...styles.icon, color: '#f44336'}} />;
      case 'invalid':
        return <FiX style={{...styles.icon, color: '#ff9800'}} />;
      default:
        return <FiMail style={{...styles.icon, color: '#666'}} />;
    }
  };

  /**
   * Get title based on status
   */
  const getTitle = () => {
    switch (status) {
      case 'loading':
        return 'Processing Your Request...';
      case 'success':
        return 'Successfully Unsubscribed';
      case 'already_unsubscribed':
        return 'Already Unsubscribed';
      case 'error':
        return 'Unable to Process Request';
      case 'invalid':
        return 'Invalid Request';
      default:
        return 'Processing...';
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Icon */}
        <div style={styles.iconContainer}>
          {renderIcon()}
        </div>

        {/* Title */}
        <h1 style={styles.title}>
          {getTitle()}
        </h1>
        
        {/* Message */}
        <p style={styles.message}>
          {message}
        </p>

        {/* Email Display */}
        {email && (
          <div style={styles.emailContainer}>
            <FiMail style={styles.emailIcon} />
            <span style={styles.emailText}>{email}</span>
          </div>
        )}

        {/* Contact Name Display */}
        {contactDetails && (contactDetails.firstName || contactDetails.lastName) && (
          <p style={styles.contactName}>
            {contactDetails.firstName} {contactDetails.lastName}
          </p>
        )}

        {/* Success Actions */}
        {status === 'success' && (
          <div style={styles.successActions}>
            <p style={styles.successMessage}>
              You will no longer receive marketing emails from us.
            </p>
            <p style={styles.complianceNote}>
              <FiShield style={styles.complianceIcon} />
              This action was logged for compliance purposes as required by CASL.
            </p>
          </div>
        )}

        {/* Already Unsubscribed Actions */}
        {status === 'already_unsubscribed' && (
          <div style={styles.infoBox}>
            <p style={styles.infoText}>
              If you continue to receive emails from us, please contact our support team.
            </p>
          </div>
        )}

        {/* Error Actions */}
        {(status === 'error' || status === 'invalid') && (
          <div style={styles.errorBox}>
            <p style={styles.errorText}>
              If you need assistance, please contact our support team with the following information:
            </p>
            <ul style={styles.errorList}>
              <li>Your email address</li>
              <li>The date and time of this error</li>
              <li>That you attempted to unsubscribe</li>
            </ul>
          </div>
        )}

        {/* Footer */}
        {status !== 'loading' && (
          <div style={styles.footer}>
            <p style={styles.footerText}>
              If you have questions or concerns, please contact our support team.
            </p>
            <p style={styles.footerSubtext}>
              This page complies with CASL (Canadian Anti-Spam Legislation) requirements.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    padding: '20px'
  },
  card: {
    backgroundColor: 'white',
    padding: '50px 40px',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center'
  },
  iconContainer: {
    marginBottom: '24px',
    display: 'flex',
    justifyContent: 'center'
  },
  icon: {
    fontSize: '64px',
  },
  spinner: {
    width: '64px',
    height: '64px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid teal',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto'
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '16px',
    color: '#333'
  },
  message: {
    fontSize: '16px',
    lineHeight: '1.6',
    color: '#666',
    marginBottom: '24px'
  },
  emailContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '12px 20px',
    backgroundColor: '#f8f8f8',
    borderRadius: '6px',
    marginBottom: '16px'
  },
  emailIcon: {
    fontSize: '16px',
    color: '#666'
  },
  emailText: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333'
  },
  contactName: {
    fontSize: '14px',
    color: '#888',
    fontStyle: 'italic',
    marginBottom: '24px'
  },
  successActions: {
    marginTop: '24px',
    padding: '20px',
    backgroundColor: '#e8f5e9',
    borderRadius: '6px',
    border: '1px solid #4caf50'
  },
  successMessage: {
    fontSize: '14px',
    color: '#2e7d32',
    marginBottom: '12px',
    fontWeight: '500'
  },
  complianceNote: {
    fontSize: '12px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    margin: 0
  },
  complianceIcon: {
    fontSize: '14px',
    color: '#4caf50'
  },
  infoBox: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: '#fff3e0',
    borderRadius: '6px',
    border: '1px solid #ff9800'
  },
  infoText: {
    fontSize: '14px',
    color: '#e65100',
    margin: 0
  },
  errorBox: {
    marginTop: '24px',
    padding: '20px',
    backgroundColor: '#ffebee',
    borderRadius: '6px',
    border: '1px solid #f44336',
    textAlign: 'left'
  },
  errorText: {
    fontSize: '14px',
    color: '#c62828',
    marginBottom: '12px',
    fontWeight: '500'
  },
  errorList: {
    fontSize: '13px',
    color: '#d32f2f',
    margin: '0',
    paddingLeft: '20px'
  },
  footer: {
    marginTop: '32px',
    paddingTop: '24px',
    borderTop: '1px solid #e0e0e0'
  },
  footerText: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '8px'
  },
  footerSubtext: {
    fontSize: '12px',
    color: '#999',
    margin: 0
  }
};

// Add spinner animation
if (!document.querySelector('#unsubscribe-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'unsubscribe-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default UnsubscribePage;
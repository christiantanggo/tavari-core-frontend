// CertificateExpiryBanner.jsx - Banner for expiring certificates tied to shift premiums
import React from 'react';
import { X, AlertCircle, Calendar, Award, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';

const CertificateExpiryBanner = ({ certificate, onClose, onRenew }) => {
  const navigate = useNavigate();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiryDate = new Date(certificate.expiry_date);
  expiryDate.setHours(0, 0, 0, 0);
  
  const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
  const isExpired = daysUntilExpiry < 0;
  const daysExpired = Math.abs(daysUntilExpiry);
  
  // Determine if banner should be red (on expiry date or up to 5 days after)
  const isRed = isExpired && daysExpired <= 5;
  
  const handleRenew = () => {
    // Navigate to certificates page and dismiss this certificate permanently
    onRenew();
    navigate('/portal/certificates');
  };

  const styles = {
    banner: {
      backgroundColor: isRed ? '#fee2e2' : '#fef3c7',
      border: `2px solid ${isRed ? '#dc2626' : '#f59e0b'}`,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.lg,
      display: 'flex',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.md,
      position: 'relative'
    },
    icon: {
      flexShrink: 0,
      color: isRed ? '#dc2626' : '#f59e0b',
      marginTop: TavariStyles.spacing.xs
    },
    content: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: isRed ? '#991b1b' : '#92400e',
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    employeeName: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: isRed ? '#dc2626' : '#f59e0b',
      marginBottom: TavariStyles.spacing.xs
    },
    message: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: isRed ? '#991b1b' : '#92400e',
      lineHeight: 1.6,
      margin: 0
    },
    certificateInfo: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: isRed ? '#991b1b' : '#92400e'
    },
    infoItem: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    expiryStatus: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: isRed ? '#dc2626' : '#f59e0b'
    },
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center',
      flexShrink: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: isRed ? '#991b1b' : '#92400e',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      transition: 'background-color 0.2s',
      flexShrink: 0
    },
    renewButton: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: 'none',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      backgroundColor: isRed ? '#dc2626' : '#f59e0b',
      color: TavariStyles.colors.white,
      transition: 'all 0.2s'
    }
  };

  return (
    <div style={styles.banner}>
      <AlertCircle size={24} style={styles.icon} />
      
      <div style={styles.content}>
        <h3 style={styles.title}>
          {isExpired ? 'Certificate Expired' : 'Certificate Expiring Soon'}
        </h3>
        
        {certificate.employee_name && certificate.employee_name !== 'Your' && (
          <div style={styles.employeeName}>
            Employee: {certificate.employee_name}
          </div>
        )}
        
        <p style={styles.message}>
          {isExpired 
            ? `${certificate.employee_name || 'Your'} ${certificate.certificate_name} certificate expired ${daysExpired} day${daysExpired !== 1 ? 's' : ''} ago. This certificate is required for the "${certificate.premium_name}" shift premium.`
            : `${certificate.employee_name || 'Your'} ${certificate.certificate_name} certificate will expire in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}. This certificate is required for the "${certificate.premium_name}" shift premium.`
          }
        </p>
        
        <div style={styles.certificateInfo}>
          <div style={styles.infoItem}>
            <Award size={16} />
            <span><strong>Certificate:</strong> {certificate.certificate_name}</span>
          </div>
          <div style={styles.infoItem}>
            <Calendar size={16} />
            <span><strong>Expiry Date:</strong> {new Date(certificate.expiry_date).toLocaleDateString('en-CA', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}</span>
          </div>
          <div style={styles.expiryStatus}>
            {isExpired 
              ? `⚠️ Expired ${daysExpired} day${daysExpired !== 1 ? 's' : ''} ago`
              : `⚠️ Expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}`
            }
          </div>
        </div>
      </div>
      
      <div style={styles.actions}>
        <button
          style={styles.renewButton}
          onClick={handleRenew}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9';
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          Renew Certificate
          <ArrowRight size={16} />
        </button>
        <button
          style={styles.closeButton}
          onClick={onClose}
          onMouseEnter={(e) => e.target.style.backgroundColor = isRed ? '#fecaca' : '#fef3c7'}
          onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
          title="Close (will show again tomorrow if still expiring)"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
};

export default CertificateExpiryBanner;


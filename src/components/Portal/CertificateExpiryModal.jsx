// CertificateExpiryModal.jsx - Modal for expiring certificates tied to shift premiums
import React from 'react';
import { X, AlertCircle, Calendar, Award } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';

const CertificateExpiryModal = ({ certificate, onClose, onRenew }) => {
  const navigate = useNavigate();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiryDate = new Date(certificate.expiry_date);
  expiryDate.setHours(0, 0, 0, 0);
  
  const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
  const isExpired = daysUntilExpiry < 0;
  const daysExpired = Math.abs(daysUntilExpiry);
  
  // Determine if modal should be red (on expiry date or up to 5 days after)
  const isRed = isExpired && daysExpired <= 5;
  
  const handleRenew = () => {
    // Navigate to certificates page and dismiss this certificate permanently
    onRenew();
    navigate('/portal/certificates');
  };

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.md
    },
    modal: {
      backgroundColor: isRed ? '#fee2e2' : TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      maxWidth: '500px',
      width: '100%',
      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
      border: isRed ? '2px solid #dc2626' : `1px solid ${TavariStyles.colors.gray200}`
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.lg
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: isRed ? '#991b1b' : TavariStyles.colors.gray900,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      flex: 1
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: isRed ? '#991b1b' : TavariStyles.colors.gray600,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      transition: 'background-color 0.2s'
    },
    content: {
      marginBottom: TavariStyles.spacing.lg
    },
    message: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: isRed ? '#991b1b' : TavariStyles.colors.gray700,
      lineHeight: 1.6,
      marginBottom: TavariStyles.spacing.md
    },
    certificateInfo: {
      backgroundColor: isRed ? '#fecaca' : TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.md
    },
    infoRow: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: isRed ? '#991b1b' : TavariStyles.colors.gray700
    },
    expiryStatus: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: isRed ? '#dc2626' : '#f59e0b',
      marginTop: TavariStyles.spacing.sm
    },
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'flex-end'
    },
    button: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: 'none',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    renewButton: {
      backgroundColor: isRed ? '#dc2626' : TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    closeButtonText: {
      backgroundColor: 'transparent',
      color: isRed ? '#991b1b' : TavariStyles.colors.gray700,
      border: `1px solid ${isRed ? '#991b1b' : TavariStyles.colors.gray300}`
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <AlertCircle size={24} />
            {isExpired ? 'Certificate Expired' : 'Certificate Expiring Soon'}
          </h2>
          <button
            style={styles.closeButton}
            onClick={onClose}
            onMouseEnter={(e) => e.target.style.backgroundColor = isRed ? '#fecaca' : TavariStyles.colors.gray100}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
          >
            <X size={20} />
          </button>
        </div>
        
        <div style={styles.content}>
          <p style={styles.message}>
            {isExpired 
              ? `Your ${certificate.certificate_name} certificate expired ${daysExpired} day${daysExpired !== 1 ? 's' : ''} ago. This certificate is required for the "${certificate.premium_name}" shift premium.`
              : `Your ${certificate.certificate_name} certificate will expire in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}. This certificate is required for the "${certificate.premium_name}" shift premium.`
            }
          </p>
          
          <div style={styles.certificateInfo}>
            <div style={styles.infoRow}>
              <Award size={16} />
              <strong>Certificate:</strong> {certificate.certificate_name}
            </div>
            <div style={styles.infoRow}>
              <Calendar size={16} />
              <strong>Expiry Date:</strong> {new Date(certificate.expiry_date).toLocaleDateString('en-CA', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </div>
            {certificate.premium_name && (
              <div style={styles.infoRow}>
                <strong>Required for:</strong> {certificate.premium_name} Premium
              </div>
            )}
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
            style={{ ...styles.button, ...styles.closeButtonText }}
            onClick={onClose}
          >
            Close
          </button>
          <button
            style={{ ...styles.button, ...styles.renewButton }}
            onClick={handleRenew}
          >
            Renew Certificate
          </button>
        </div>
      </div>
    </div>
  );
};

export default CertificateExpiryModal;








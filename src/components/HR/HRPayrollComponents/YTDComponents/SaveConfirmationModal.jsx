// components/HR/HRPayrollComponents/YTDComponents/SaveConfirmationModal.jsx
import React from 'react';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';

const SaveConfirmationModal = ({ isOpen, onClose, type = 'success', message, title }) => {
  if (!isOpen) return null;

  const modalConfig = {
    success: {
      icon: CheckCircle,
      iconColor: '#10b981',
      bgColor: '#f0fdf4',
      borderColor: '#86efac',
      title: title || 'Success!',
      buttonColor: '#10b981'
    },
    error: {
      icon: AlertTriangle,
      iconColor: '#ef4444',
      bgColor: '#fef2f2',
      borderColor: '#fca5a5',
      title: title || 'Error',
      buttonColor: '#ef4444'
    }
  };

  const config = modalConfig[type] || modalConfig.success;
  const Icon = config.icon;

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      animation: 'fadeIn 0.2s ease-in-out'
    },
    modal: {
      backgroundColor: 'white',
      borderRadius: '16px',
      padding: '40px',
      textAlign: 'center',
      maxWidth: '500px',
      width: '90%',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      position: 'relative',
      animation: 'slideUp 0.3s ease-out'
    },
    closeButton: {
      position: 'absolute',
      top: '16px',
      right: '16px',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '8px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background-color 0.2s',
      color: '#6b7280'
    },
    iconContainer: {
      width: '80px',
      height: '80px',
      borderRadius: '50%',
      backgroundColor: config.bgColor,
      border: `3px solid ${config.borderColor}`,
      color: config.iconColor,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 24px',
      animation: type === 'success' ? 'scaleIn 0.4s ease-out' : 'shake 0.5s ease-out'
    },
    title: {
      margin: '0 0 16px',
      fontSize: '24px',
      color: '#1f2937',
      fontWeight: 'bold'
    },
    message: {
      margin: '0 0 32px',
      fontSize: '16px',
      color: '#6b7280',
      lineHeight: '1.6'
    },
    button: {
      backgroundColor: config.buttonColor,
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      padding: '12px 32px',
      fontSize: '16px',
      fontWeight: 'bold',
      cursor: 'pointer',
      minWidth: '120px',
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }
  };

  return (
    <>
      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideUp {
            from { 
              opacity: 0;
              transform: translateY(20px);
            }
            to { 
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes scaleIn {
            0% { 
              transform: scale(0);
              opacity: 0;
            }
            50% {
              transform: scale(1.1);
            }
            100% { 
              transform: scale(1);
              opacity: 1;
            }
          }
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
          }
        `}
      </style>
      <div style={styles.overlay} onClick={onClose}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <button
            style={styles.closeButton}
            onClick={onClose}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <X size={20} />
          </button>

          <div style={styles.iconContainer}>
            <Icon size={48} strokeWidth={2.5} />
          </div>

          <h2 style={styles.title}>{config.title}</h2>
          <p style={styles.message}>{message}</p>

          <button
            style={styles.button}
            onClick={onClose}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            OK
          </button>
        </div>
      </div>
    </>
  );
};

export default SaveConfirmationModal;
// components/HR/HRPayrollComponents/PayStatementEmailModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Mail, Info } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';

const PayStatementEmailModal = ({ isOpen, onClose, onSave, defaultSubject, defaultBody, defaultFromName }) => {
  const [subject, setSubject] = useState(defaultSubject || 'Your Pay Statement - {{PayPeriodEnd}}');
  const [body, setBody] = useState(defaultBody || `Dear {{FirstName}} {{LastName}},

Your pay statement for the period ending {{PayPeriodEnd}} is now available.

To view and download your pay statement, please click the link below:
{{StatementLink}}

If you have any questions about your pay statement, please contact your payroll department.

Thank you,
{{BusinessName}}`);
  const [fromName, setFromName] = useState(defaultFromName || '');

  // Update all fields when modal opens (only on open, not on every prop change)
  useEffect(() => {
    if (isOpen) {
      console.log('[PayStatementEmailModal] Opening modal with defaults:', {
        defaultSubject: defaultSubject?.substring(0, 50),
        defaultBody: defaultBody?.substring(0, 100),
        defaultFromName: defaultFromName
      });
      setSubject(defaultSubject || 'Your Pay Statement - {{PayPeriodEnd}}');
      setBody(defaultBody || `Dear {{FirstName}} {{LastName}},

Your pay statement for the period ending {{PayPeriodEnd}} is attached to this email.

If you have any questions about your pay statement, please contact your payroll department.

Thank you,
{{BusinessName}}`);
      setFromName(defaultFromName || '');
    }
  }, [isOpen]); // Only depend on isOpen, not the default values

  const availablePresets = [
    { label: 'First Name', value: '{{FirstName}}', description: "Employee's first name" },
    { label: 'Last Name', value: '{{LastName}}', description: "Employee's last name" },
    { label: 'Full Name', value: '{{FullName}}', description: "Employee's full name" },
    { label: 'Email', value: '{{Email}}', description: "Employee's email address" },
    { label: 'Pay Period Start', value: '{{PayPeriodStart}}', description: 'Start date of pay period' },
    { label: 'Pay Period End', value: '{{PayPeriodEnd}}', description: 'End date of pay period' },
    { label: 'Pay Date', value: '{{PayDate}}', description: 'Date payment is issued' },
    { label: 'Net Pay', value: '{{NetPay}}', description: 'Net pay amount for this period' },
    { label: 'Gross Pay', value: '{{GrossPay}}', description: 'Gross pay amount for this period' },
    { label: 'Business Name', value: '{{BusinessName}}', description: 'Your business name' },
    { label: 'Statement Link', value: '{{StatementLink}}', description: 'Link to view/download statement (required for emails)' }
  ];

  const insertPreset = (presetValue) => {
    if (document.activeElement.tagName === 'TEXTAREA') {
      const textarea = document.activeElement;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const newText = text.substring(0, start) + presetValue + text.substring(end);
      textarea.value = newText;
      textarea.selectionStart = textarea.selectionEnd = start + presetValue.length;
      textarea.focus();
      
      // Update state based on which field is focused
      if (textarea.id === 'email-subject') {
        setSubject(newText);
      } else if (textarea.id === 'email-body') {
        setBody(newText);
      }
    }
  };

  const handleSave = () => {
    if (!subject.trim()) {
      toast.error('Email subject is required');
      return;
    }
    if (!body.trim()) {
      toast.error('Email body is required');
      return;
    }
    // Note: StatementLink is no longer required since we're attaching PDFs directly
    if (!fromName.trim()) {
      toast.error('Email display name is required');
      return;
    }
    console.log('[PayStatementEmailModal] Saving config:', {
      subjectLength: subject.length,
      bodyLength: body.length,
      bodyPreview: body.substring(0, 200),
      fromName: fromName
    });
    onSave({ subject, body, fromName });
    onClose();
  };

  if (!isOpen) return null;

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
      padding: TavariStyles.spacing.lg
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '700px',
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    headerTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: TavariStyles.spacing.xs,
      color: TavariStyles.colors.gray500,
      display: 'flex',
      alignItems: 'center',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      transition: 'all 0.2s'
    },
    content: {
      padding: TavariStyles.spacing.xl,
      overflowY: 'auto',
      flex: 1
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.sm
    },
    input: {
      width: '100%',
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontFamily: TavariStyles.typography.fontFamily?.sans || 'inherit',
      boxSizing: 'border-box'
    },
    textarea: {
      width: '100%',
      minHeight: '200px',
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontFamily: TavariStyles.typography.fontFamily?.sans || 'inherit',
      resize: 'vertical',
      boxSizing: 'border-box'
    },
    presetsSection: {
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    presetsTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    presetsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.xs
    },
    presetButton: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.xs,
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'all 0.2s',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    },
    presetValue: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.primary,
      fontFamily: 'monospace'
    },
    presetDescription: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md
    },
    button: {
      ...TavariStyles.components.button?.base || {
        padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        border: 'none',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s'
      }
    },
    primaryButton: {
      ...TavariStyles.components.button?.variants?.primary || {
        backgroundColor: TavariStyles.colors.primary,
        color: TavariStyles.colors.white
      }
    },
    secondaryButton: {
      ...TavariStyles.components.button?.variants?.secondary || {
        backgroundColor: TavariStyles.colors.gray100,
        color: TavariStyles.colors.gray700,
        border: `1px solid ${TavariStyles.colors.gray300}`
      }
    },
    infoBox: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.info + '15',
      border: `1px solid ${TavariStyles.colors.info}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      gap: TavariStyles.spacing.sm
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <Mail size={20} />
            Configure Pay Statement Email
          </div>
          <button style={styles.closeButton} onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.infoBox}>
            <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Tip:</strong> Click on any preset below to insert it into your email. Make sure to include <code style={{ backgroundColor: TavariStyles.colors.gray100, padding: '2px 4px', borderRadius: '3px' }}>{'{{StatementLink}}'}</code> in the body so employees can access their statement.
            </div>
          </div>

          <div style={styles.section}>
            <label style={styles.label} htmlFor="email-from-name">
              Email Display Name (From Name)
            </label>
            <input
              id="email-from-name"
              type="text"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Payroll Department"
              style={styles.input}
            />
            <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
              This is how your name will appear in the "From" field of the email (e.g., "The Company - HR" or "Payroll Department")
            </div>
          </div>

          <div style={styles.section}>
            <label style={styles.label} htmlFor="email-subject">
              Email Subject
            </label>
            <input
              id="email-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Your Pay Statement - {{PayPeriodEnd}}"
              style={styles.input}
            />
          </div>

          <div style={styles.section}>
            <label style={styles.label} htmlFor="email-body">
              Email Body
            </label>
            <textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Dear {{FirstName}}..."
              style={styles.textarea}
            />
          </div>

          <div style={styles.presetsSection}>
            <div style={styles.presetsTitle}>
              <Info size={16} />
              Available Presets (Click to Insert)
            </div>
            <div style={styles.presetsGrid}>
              {availablePresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  style={styles.presetButton}
                  onClick={() => insertPreset(preset.value)}
                  title={preset.description}
                >
                  <span style={styles.presetValue}>{preset.value}</span>
                  <span style={styles.presetDescription}>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button
            style={{ ...styles.button, ...styles.secondaryButton }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            onClick={handleSave}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default PayStatementEmailModal;


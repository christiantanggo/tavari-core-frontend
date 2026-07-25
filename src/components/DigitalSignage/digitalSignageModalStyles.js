import { TavariStyles } from '../../utils/TavariStyles';

const PAD = TavariStyles.spacing['2xl'];
const PAD_MD = TavariStyles.spacing.lg;

/**
 * Shared modal chrome for Digital Signage forms (consistent padding and layout).
 * @param {{ maxWidth?: string }} [options]
 */
export function getDigitalSignageModalStyles(options = {}) {
  const maxWidth = options.maxWidth || '520px';

  const fieldBase = {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    backgroundColor: TavariStyles.colors.white,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: TavariStyles.typography.fontFamily,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    color: TavariStyles.colors.gray800
  };

  return {
    overlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: PAD_MD
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.modal || TavariStyles.shadows.lg,
      width: '100%',
      maxWidth,
      maxHeight: 'min(90vh, 900px)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: PAD_MD,
      padding: `${PAD} ${PAD} ${PAD_MD}`,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      flexShrink: 0
    },
    headerText: {
      flex: '1 1 auto',
      minWidth: 0
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0,
      lineHeight: 1.25
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      margin: `${TavariStyles.spacing.xs} 0 0`,
      lineHeight: 1.5
    },
    closeButton: {
      background: TavariStyles.colors.gray100,
      border: 'none',
      borderRadius: TavariStyles.borderRadius.md,
      cursor: 'pointer',
      width: '36px',
      height: '36px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: TavariStyles.colors.gray600,
      flexShrink: 0
    },
    body: {
      padding: PAD,
      overflowY: 'auto',
      flex: '1 1 auto'
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: PAD_MD
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.45,
      margin: 0
    },
    input: fieldBase,
    select: fieldBase,
    textarea: {
      ...fieldBase,
      minHeight: '100px',
      resize: 'vertical',
      lineHeight: 1.45
    },
    checkboxRow: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.base
    },
    actions: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md,
      justifyContent: 'flex-end',
      paddingTop: PAD_MD,
      marginTop: TavariStyles.spacing.sm,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    buttonPrimary: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.xl}`
    },
    buttonSecondary: {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.xl}`
    }
  };
}

/** Dark overlay preview modal (content preview). */
export function getDigitalSignagePreviewModalStyles() {
  const previewPad = TavariStyles.spacing['2xl'];
  return {
    overlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.lg
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      width: '100%',
      maxWidth: '1200px',
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      boxShadow: TavariStyles.shadows.modal || TavariStyles.shadows.lg
    },
    closeButton: {
      position: 'absolute',
      top: TavariStyles.spacing.md,
      right: TavariStyles.spacing.md,
      background: 'rgba(0, 0, 0, 0.55)',
      border: 'none',
      borderRadius: '50%',
      width: '40px',
      height: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: TavariStyles.colors.white,
      zIndex: 10
    },
    body: {
      padding: previewPad,
      overflowY: 'auto'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.lg}`
    },
    preview: {
      width: '100%',
      maxHeight: '70vh',
      objectFit: 'contain',
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.gray100
    },
    video: {
      width: '100%',
      maxHeight: '70vh',
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.black
    },
    meta: {
      marginTop: previewPad,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    metaRow: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs,
      lineHeight: 1.45
    }
  };
}

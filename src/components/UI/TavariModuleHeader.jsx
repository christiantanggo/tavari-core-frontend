import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

const TavariModuleHeader = ({
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  actionNode = null,
  actionVariant = 'primary',
  actionDisabled = false,
  actionButtonStyle = {},
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionIcon,
  secondaryActionDisabled = false,
  secondaryActionButtonStyle = {},
  containerStyle = {},
  titleStyle = {},
  descriptionStyle = {},
  contentStyle = {},
  actionContainerStyle = {}
}) => {
  const renderButton = ({
    label,
    onClick,
    icon,
    variant = 'primary',
    disabled = false,
    buttonStyle = {}
  }) => {
    if (!label) {
      return null;
    }

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          ...styles.actionButton,
          ...(variant === 'secondary' ? styles.actionButtonSecondary : {}),
          ...(disabled ? styles.actionButtonDisabled : {}),
          ...buttonStyle
        }}
      >
        {icon && <span style={styles.actionIcon}>{icon}</span>}
        <span>{label}</span>
      </button>
    );
  };

  const renderActionContent = () => {
    if (actionNode) {
      return actionNode;
    }

    if (!secondaryActionLabel && !actionLabel) {
      return null;
    }

    return (
      <>
        {renderButton({
          label: secondaryActionLabel,
          onClick: onSecondaryAction,
          icon: secondaryActionIcon,
          variant: 'secondary',
          disabled: secondaryActionDisabled,
          buttonStyle: secondaryActionButtonStyle
        })}
        {renderButton({
          label: actionLabel,
          onClick: onAction,
          icon: actionIcon,
          variant: actionVariant,
          disabled: actionDisabled,
          buttonStyle: actionButtonStyle
        })}
      </>
    );
  };

  const actionContent = renderActionContent();

  return (
    <div
      style={{
        ...styles.container,
        ...(actionContent ? styles.containerWithAction : styles.containerWithoutAction),
        ...containerStyle
      }}
    >
      <div style={{ ...styles.content, ...contentStyle }}>
        <h1 style={{ ...styles.title, ...titleStyle }}>{title}</h1>
        {description && <p style={{ ...styles.description, ...descriptionStyle }}>{description}</p>}
      </div>

      {actionContent && (
        <div style={{ ...styles.actionContainer, ...actionContainerStyle }}>
          {actionContent}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    display: 'grid',
    gap: TavariStyles.spacing.lg,
    paddingTop: 'clamp(10px, 1.5vw, 18px)',
    marginBottom: TavariStyles.spacing.xl,
    alignItems: 'stretch'
  },
  containerWithAction: {
    gridTemplateColumns: 'minmax(0, 1fr) auto'
  },
  containerWithoutAction: {
    gridTemplateColumns: 'minmax(0, 1fr)'
  },
  content: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    textAlign: 'left'
  },
  title: {
    margin: 0,
    fontSize: 'clamp(28px, 3vw, 32px)',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray900,
    lineHeight: 1.15,
    letterSpacing: '-0.02em'
  },
  description: {
    margin: '8px 0 0 0',
    fontSize: '15px',
    color: TavariStyles.colors.gray600,
    lineHeight: 1.45,
    maxWidth: '720px'
  },
  actionContainer: {
    display: 'flex',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    gap: TavariStyles.spacing.sm,
    minWidth: '250px'
  },
  actionButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    width: '100%',
    minWidth: '150px',
    height: '100%',
    padding: `0 ${TavariStyles.spacing.xl}`,
    borderRadius: TavariStyles.borderRadius.lg,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.sm,
    textAlign: 'center',
    whiteSpace: 'nowrap'
  },
  actionButtonSecondary: {
    ...TavariStyles.components.button.variants.secondary,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    color: TavariStyles.colors.gray800,
    backgroundColor: TavariStyles.colors.white
  },
  actionButtonDisabled: {
    opacity: 0.65,
    cursor: 'not-allowed'
  },
  actionIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};

export default TavariModuleHeader;

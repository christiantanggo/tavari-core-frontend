// Step 110: Create WaiverEmptyState.jsx
// Empty state component for waivers
import React from 'react';
import { FiFileText, FiPlus, FiSearch } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const WaiverEmptyState = ({ 
  type = 'waivers', 
  onAction, 
  actionLabel = 'Get Started',
  message = null 
}) => {
  const getConfig = () => {
    switch (type) {
      case 'waivers':
        return {
          icon: <FiFileText size={64} style={{ color: TavariStyles.colors.gray400 }} />,
          title: 'No Waivers Yet',
          description: message || 'Start by creating a waiver template or uploading a paper waiver.',
          actionLabel: 'Create Template',
          actionIcon: <FiPlus />
        };
      case 'templates':
        return {
          icon: <FiFileText size={64} style={{ color: TavariStyles.colors.gray400 }} />,
          title: 'No Templates Created',
          description: message || 'Create your first waiver template to get started.',
          actionLabel: 'Create Template',
          actionIcon: <FiPlus />
        };
      case 'search':
        return {
          icon: <FiSearch size={64} style={{ color: TavariStyles.colors.gray400 }} />,
          title: 'No Results Found',
          description: message || 'Try adjusting your search criteria.',
          actionLabel: null,
          actionIcon: null
        };
      default:
        return {
          icon: <FiFileText size={64} style={{ color: TavariStyles.colors.gray400 }} />,
          title: 'No Items',
          description: message || 'Get started by creating your first item.',
          actionLabel: actionLabel,
          actionIcon: <FiPlus />
        };
    }
  };

  const config = getConfig();

  return (
    <div style={styles.container}>
      <div style={styles.iconContainer}>
        {config.icon}
      </div>
      <h3 style={styles.title}>{config.title}</h3>
      <p style={styles.description}>{config.description}</p>
      {config.actionLabel && onAction && (
        <button
          onClick={onAction}
          style={styles.actionButton}
        >
          {config.actionIcon} {config.actionLabel}
        </button>
      )}
    </div>
  );
};

const styles = {
  container: {
    textAlign: 'center',
    padding: `${TavariStyles.spacing.xl} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px dashed ${TavariStyles.colors.gray300}`
  },
  iconContainer: {
    marginBottom: TavariStyles.spacing.md,
    display: 'flex',
    justifyContent: 'center'
  },
  title: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm
  },
  description: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.lg,
    maxWidth: '400px',
    marginLeft: 'auto',
    marginRight: 'auto'
  },
  actionButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600'
  }
};

export default WaiverEmptyState;





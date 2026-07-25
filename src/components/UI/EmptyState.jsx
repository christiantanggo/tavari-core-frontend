// src/components/UI/EmptyState.jsx
// Standardized empty state component for all modules
import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * EmptyState - Standardized empty state component
 * 
 * @param {string} icon - Icon emoji or component
 * @param {string} title - Main title text
 * @param {string} description - Description text
 * @param {object} primaryAction - { label, onClick } for primary CTA
 * @param {object} secondaryAction - { label, href } for secondary link
 * @param {string} variant - 'default' | 'minimal' | 'large'
 */
const EmptyState = ({ 
  icon = '📭', 
  title, 
  description, 
  primaryAction, 
  secondaryAction,
  variant = 'default'
}) => {
  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: variant === 'large' 
        ? TavariStyles?.spacing?.['3xl'] || '64px' 
        : TavariStyles?.spacing?.['2xl'] || '48px',
      textAlign: 'center',
      minHeight: variant === 'large' ? '400px' : '300px'
    },
    icon: {
      fontSize: variant === 'large' ? '80px' : '64px',
      marginBottom: TavariStyles?.spacing?.lg || '16px',
      opacity: 0.8
    },
    title: {
      fontSize: variant === 'large' 
        ? TavariStyles?.typography?.fontSize?.['2xl'] || '24px'
        : TavariStyles?.typography?.fontSize?.xl || '20px',
      fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
      color: TavariStyles?.colors?.gray900 || '#111827',
      marginBottom: TavariStyles?.spacing?.sm || '8px'
    },
    description: {
      fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
      color: TavariStyles?.colors?.gray600 || '#4b5563',
      marginBottom: TavariStyles?.spacing?.xl || '24px',
      maxWidth: '500px',
      lineHeight: 1.6
    },
    actions: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles?.spacing?.md || '12px',
      alignItems: 'center'
    },
    primaryButton: {
      padding: '12px 24px',
      backgroundColor: TavariStyles?.colors?.primary || '#008080',
      color: TavariStyles?.colors?.white || '#ffffff',
      border: 'none',
      borderRadius: TavariStyles?.borderRadius?.lg || '8px',
      fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
      fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      minWidth: '200px'
    },
    secondaryLink: {
      color: TavariStyles?.colors?.primary || '#008080',
      textDecoration: 'none',
      fontSize: TavariStyles?.typography?.fontSize?.sm || '14px',
      fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
      cursor: 'pointer',
      transition: 'color 0.2s ease'
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.icon}>{icon}</div>
      {title && <h3 style={styles.title}>{title}</h3>}
      {description && <p style={styles.description}>{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div style={styles.actions}>
          {primaryAction && (
            <button
              style={styles.primaryButton}
              onClick={primaryAction.onClick}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = TavariStyles?.colors?.primaryDark || '#006666';
                e.target.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = TavariStyles?.colors?.primary || '#008080';
                e.target.style.transform = 'scale(1)';
              }}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <a
              href={secondaryAction.href}
              style={styles.secondaryLink}
              onClick={secondaryAction.onClick}
              onMouseEnter={(e) => {
                e.target.style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                e.target.style.textDecoration = 'none';
              }}
            >
              {secondaryAction.label}
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;




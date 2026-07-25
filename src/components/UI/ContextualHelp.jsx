// src/components/UI/ContextualHelp.jsx
// Contextual help tooltip component
import React, { useState } from 'react';
import { FiHelpCircle } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * ContextualHelp - Inline help tooltip
 * 
 * @param {string} content - Help text to display
 * @param {string} position - 'top' | 'bottom' | 'left' | 'right'
 * @param {string} size - 'sm' | 'md' | 'lg'
 */
const ContextualHelp = ({ 
  content, 
  position = 'top',
  size = 'md',
  module = null,
  section = null
}) => {
  const [isVisible, setIsVisible] = useState(false);

  const styles = {
    container: {
      position: 'relative',
      display: 'inline-block',
      marginLeft: '4px'
    },
    icon: {
      color: TavariStyles?.colors?.gray400 || '#9ca3af',
      cursor: 'pointer',
      transition: 'color 0.2s ease',
      fontSize: size === 'sm' ? '14px' : size === 'lg' ? '20px' : '16px'
    },
    tooltip: {
      position: 'absolute',
      zIndex: 1000,
      backgroundColor: TavariStyles?.colors?.gray900 || '#111827',
      color: TavariStyles?.colors?.white || '#ffffff',
      padding: TavariStyles?.spacing?.sm || '8px',
      borderRadius: TavariStyles?.borderRadius?.md || '8px',
      fontSize: TavariStyles?.typography?.fontSize?.sm || '14px',
      maxWidth: '300px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      whiteSpace: 'normal',
      lineHeight: 1.5,
      ...getPositionStyles(position)
    },
    arrow: {
      position: 'absolute',
      width: 0,
      height: 0,
      borderStyle: 'solid',
      ...getArrowStyles(position)
    }
  };

  function getPositionStyles(pos) {
    const offset = '8px';
    switch (pos) {
      case 'top':
        return { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: offset };
      case 'bottom':
        return { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: offset };
      case 'left':
        return { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: offset };
      case 'right':
        return { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: offset };
      default:
        return { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: offset };
    }
  }

  function getArrowStyles(pos) {
    const size = '6px';
    switch (pos) {
      case 'top':
        return { 
          top: '100%', 
          left: '50%', 
          transform: 'translateX(-50%)',
          borderWidth: `${size} ${size} 0 ${size}`,
          borderColor: `${TavariStyles?.colors?.gray900 || '#111827'} transparent transparent transparent`
        };
      case 'bottom':
        return { 
          bottom: '100%', 
          left: '50%', 
          transform: 'translateX(-50%)',
          borderWidth: `0 ${size} ${size} ${size}`,
          borderColor: `transparent transparent ${TavariStyles?.colors?.gray900 || '#111827'} transparent`
        };
      case 'left':
        return { 
          left: '100%', 
          top: '50%', 
          transform: 'translateY(-50%)',
          borderWidth: `${size} 0 ${size} ${size}`,
          borderColor: `transparent transparent transparent ${TavariStyles?.colors?.gray900 || '#111827'}`
        };
      case 'right':
        return { 
          right: '100%', 
          top: '50%', 
          transform: 'translateY(-50%)',
          borderWidth: `${size} ${size} ${size} 0`,
          borderColor: `transparent ${TavariStyles?.colors?.gray900 || '#111827'} transparent transparent`
        };
      default:
        return {};
    }
  }

  if (!content) return null;

  return (
    <div
      style={styles.container}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <FiHelpCircle style={styles.icon} />
      {isVisible && (
        <div style={styles.tooltip}>
          <div style={styles.arrow} />
          {content}
        </div>
      )}
    </div>
  );
};

export default ContextualHelp;




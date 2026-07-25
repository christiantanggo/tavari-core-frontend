// src/components/Waivers/WaiverWidget.jsx
// Embeddable widget/floating button for waiver signing
// Can be embedded via code or used as a floating button

import React, { useState, useEffect } from 'react';
import { FiFileText, FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const WaiverWidget = ({ businessId, templateKey, position = 'bottom-right', style = {} }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [widgetUrl, setWidgetUrl] = useState('');

  useEffect(() => {
    // Generate widget URL
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/waiver/${businessId}/${templateKey}`;
    setWidgetUrl(url);
  }, [businessId, templateKey]);

  const handleClick = () => {
    if (widgetUrl) {
      window.open(widgetUrl, '_blank', 'width=800,height=600');
    }
  };

  const positionStyles = {
    'bottom-right': {
      bottom: '20px',
      right: '20px'
    },
    'bottom-left': {
      bottom: '20px',
      left: '20px'
    },
    'top-right': {
      top: '20px',
      right: '20px'
    },
    'top-left': {
      top: '20px',
      left: '20px'
    },
    'center-right': {
      top: '50%',
      right: '20px',
      transform: 'translateY(-50%)'
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        style={{
          ...styles.floatingButton,
          ...positionStyles[position],
          ...style
        }}
      >
        <FiFileText style={styles.buttonIcon} />
        <span style={styles.buttonText}>Sign Waiver</span>
      </div>
    </>
  );
};

const styles = {
  floatingButton: {
    position: 'fixed',
    padding: '1rem 1.5rem',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    boxShadow: TavariStyles.shadows.xl,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    zIndex: 9999,
    transition: 'all 0.2s',
    fontSize: '1rem',
    fontWeight: '600'
  },
  buttonIcon: {
    fontSize: '1.25rem'
  },
  buttonText: {
    whiteSpace: 'nowrap'
  }
};

export default WaiverWidget;






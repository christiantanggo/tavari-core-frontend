// src/components/UI/SkeletonLoader.jsx
// Standardized skeleton loading component
import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * SkeletonLoader - Standardized skeleton loading component
 * 
 * @param {string} variant - 'card' | 'list' | 'table' | 'text' | 'custom'
 * @param {number} count - Number of skeleton items to show
 * @param {object} style - Custom styles
 */
const SkeletonLoader = ({ variant = 'card', count = 1, style = {} }) => {
  const baseStyles = {
    skeleton: {
      backgroundColor: TavariStyles?.colors?.gray200 || '#e5e7eb',
      borderRadius: TavariStyles?.borderRadius?.md || '8px',
      animation: 'pulse 1.5s ease-in-out infinite'
    },
    card: {
      width: '100%',
      height: '200px',
      marginBottom: TavariStyles?.spacing?.md || '16px'
    },
    list: {
      width: '100%',
      height: '60px',
      marginBottom: TavariStyles?.spacing?.sm || '8px'
    },
    table: {
      width: '100%',
      height: '50px',
      marginBottom: TavariStyles?.spacing?.xs || '4px'
    },
    text: {
      width: '100%',
      height: '20px',
      marginBottom: TavariStyles?.spacing?.xs || '4px'
    }
  };

  const variants = {
    card: () => (
      <div style={{ ...baseStyles.skeleton, ...baseStyles.card, ...style }}>
        <div style={{ 
          width: '60%', 
          height: '20px', 
          backgroundColor: TavariStyles?.colors?.gray300 || '#d1d5db',
          borderRadius: '4px',
          margin: '16px'
        }} />
        <div style={{ 
          width: '40%', 
          height: '16px', 
          backgroundColor: TavariStyles?.colors?.gray300 || '#d1d5db',
          borderRadius: '4px',
          margin: '0 16px 16px'
        }} />
      </div>
    ),
    list: () => (
      <div style={{ ...baseStyles.skeleton, ...baseStyles.list, ...style }}>
        <div style={{ 
          width: '30%', 
          height: '16px', 
          backgroundColor: TavariStyles?.colors?.gray300 || '#d1d5db',
          borderRadius: '4px',
          margin: '12px 16px'
        }} />
      </div>
    ),
    table: () => (
      <div style={{ ...baseStyles.skeleton, ...baseStyles.table, ...style }}>
        <div style={{ 
          display: 'flex',
          gap: '16px',
          padding: '12px 16px'
        }}>
          <div style={{ width: '20%', height: '16px', backgroundColor: TavariStyles?.colors?.gray300 || '#d1d5db', borderRadius: '4px' }} />
          <div style={{ width: '30%', height: '16px', backgroundColor: TavariStyles?.colors?.gray300 || '#d1d5db', borderRadius: '4px' }} />
          <div style={{ width: '25%', height: '16px', backgroundColor: TavariStyles?.colors?.gray300 || '#d1d5db', borderRadius: '4px' }} />
          <div style={{ width: '25%', height: '16px', backgroundColor: TavariStyles?.colors?.gray300 || '#d1d5db', borderRadius: '4px' }} />
        </div>
      </div>
    ),
    text: () => (
      <div style={{ ...baseStyles.skeleton, ...baseStyles.text, ...style }} />
    )
  };

  const SkeletonItem = variants[variant] || variants.card;

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonItem key={index} />
      ))}
    </>
  );
};

export default SkeletonLoader;




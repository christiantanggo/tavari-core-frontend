// tavariLayoutUtils.js
// Utility functions for Tavari layout standards
// Provides consistent spacing, grid layouts, and responsive helpers

import { TavariStyles } from './TavariStyles';

/**
 * Get standard container styles with 20px padding
 * Tavari Standard: Always use 20px padding on all outer edges
 */
export const getContainerStyles = (additionalStyles = {}) => {
  return {
    padding: TavariStyles?.spacing?.xl || '20px', // 20px
    ...additionalStyles
  };
};

/**
 * Get 3x grid layout styles for employee interfaces
 * Tavari Standard: Three evenly spaced square buttons per row
 */
export const getEmployeeGridStyles = (gap = TavariStyles?.spacing?.xl || '20px') => {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: gap,
    width: '100%'
  };
};

/**
 * Get responsive grid that adapts to screen size
 * Mobile: 1 column, Tablet: 2 columns, Desktop: 3 columns
 */
export const getResponsiveGridStyles = (gap = TavariStyles?.spacing?.xl || '20px') => {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: gap,
    width: '100%',
    '@media (min-width: 768px)': {
      gridTemplateColumns: 'repeat(2, 1fr)'
    },
    '@media (min-width: 1024px)': {
      gridTemplateColumns: 'repeat(3, 1fr)'
    }
  };
};

/**
 * Get centered content styles
 * Tavari Standard: Dynamically centered layouts are preferred
 */
export const getCenteredContentStyles = (maxWidth = '1200px') => {
  return {
    maxWidth: maxWidth,
    margin: '0 auto',
    width: '100%'
  };
};

/**
 * Get standard button grid item styles (for 3x grid)
 */
export const getGridButtonStyles = () => {
  return {
    aspectRatio: '1',
    minHeight: '120px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  };
};

/**
 * Check if screen is mobile
 */
export const isMobile = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
};

/**
 * Check if screen is tablet
 */
export const isTablet = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= 768 && window.innerWidth < 1024;
};

/**
 * Check if screen is desktop
 */
export const isDesktop = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= 1024;
};

/**
 * Get responsive font size
 * Tavari Standard: Font sizes should increase on larger screens
 */
export const getResponsiveFontSize = (baseSize, scaleFactor = 1.2) => {
  if (isDesktop()) {
    return `${parseFloat(baseSize) * scaleFactor}px`;
  }
  return baseSize;
};

/**
 * Get responsive spacing
 */
export const getResponsiveSpacing = (baseSpacing, scaleFactor = 1.2) => {
  if (isDesktop()) {
    return `${parseFloat(baseSpacing) * scaleFactor}px`;
  }
  return baseSpacing;
};

export default {
  getContainerStyles,
  getEmployeeGridStyles,
  getResponsiveGridStyles,
  getCenteredContentStyles,
  getGridButtonStyles,
  isMobile,
  isTablet,
  isDesktop,
  getResponsiveFontSize,
  getResponsiveSpacing
};


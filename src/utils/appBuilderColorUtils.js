// Step 74: Create appBuilderColorUtils.js
// Color manipulation utilities

/**
 * Convert hex to RGB
 * @param {string} hex - Hex color (#RRGGBB)
 * @returns {Object} - {r, g, b}
 */
export const hexToRgb = (hex) => {
  if (!hex) return null;
  
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

/**
 * Convert RGB to hex
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} - Hex color (#RRGGBB)
 */
export const rgbToHex = (r, g, b) => {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

/**
 * Get contrast color (black or white) for text on background
 * @param {string} backgroundColor - Background color (hex)
 * @returns {string} - '#000000' or '#ffffff'
 */
export const getContrastColor = (backgroundColor) => {
  const rgb = hexToRgb(backgroundColor);
  if (!rgb) return '#000000';
  
  // Calculate relative luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  
  return luminance > 0.5 ? '#000000' : '#ffffff';
};

/**
 * Generate color palette from primary color
 * @param {string} primaryColor - Primary color (hex)
 * @returns {Object} - Color palette
 */
export const generateColorPalette = (primaryColor) => {
  const rgb = hexToRgb(primaryColor);
  if (!rgb) return null;

  // Generate lighter and darker variants
  const lighten = (r, g, b, factor) => ({
    r: Math.min(255, r + (255 - r) * factor),
    g: Math.min(255, g + (255 - g) * factor),
    b: Math.min(255, b + (255 - b) * factor)
  });

  const darken = (r, g, b, factor) => ({
    r: Math.max(0, r * (1 - factor)),
    g: Math.max(0, g * (1 - factor)),
    b: Math.max(0, b * (1 - factor))
  });

  return {
    primary: primaryColor,
    light: rgbToHex(...Object.values(lighten(rgb.r, rgb.g, rgb.b, 0.3))),
    dark: rgbToHex(...Object.values(darken(rgb.r, rgb.g, rgb.b, 0.3))),
    lighter: rgbToHex(...Object.values(lighten(rgb.r, rgb.g, rgb.b, 0.6))),
    darker: rgbToHex(...Object.values(darken(rgb.r, rgb.g, rgb.b, 0.6)))
  };
};

/**
 * Validate color accessibility (WCAG contrast ratio)
 * @param {string} foreground - Foreground color (hex)
 * @param {string} background - Background color (hex)
 * @returns {Object} - {accessible: boolean, ratio: number, level: string}
 */
export const validateColorAccessibility = (foreground, background) => {
  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);
  
  if (!fgRgb || !bgRgb) {
    return { accessible: false, ratio: 0, level: 'N/A' };
  }

  // Calculate relative luminance
  const getLuminance = (r, g, b) => {
    const [rs, gs, bs] = [r, g, b].map(val => {
      val = val / 255;
      return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const fgLum = getLuminance(fgRgb.r, fgRgb.g, fgRgb.b);
  const bgLum = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
  
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  let level = 'AA';
  if (ratio >= 7) level = 'AAA';
  else if (ratio >= 4.5) level = 'AA';
  else if (ratio >= 3) level = 'AA Large';
  else level = 'Fail';

  return {
    accessible: ratio >= 4.5,
    ratio: Math.round(ratio * 100) / 100,
    level
  };
};





// utils/TavariStyles.js - Centralized Style System for Tavari POS
// Consistent styling across all components

export const TavariStyles = {
  // Color Palette
  colors: {
    // Primary Brand Colors
    primary: '#008080',           // Teal
    primaryLight: '#20b2aa',
    primaryDark: '#006666',
    
    // Secondary Colors
    secondary: '#3b82f6',         // Blue
    success: '#10b981',           // Green
    warning: '#f59e0b',           // Orange/Amber
    danger: '#ef4444',            // Red
    info: '#06b6d4',              // Cyan
    
    // Neutral Colors
    white: '#ffffff',
    gray50: '#f9fafb',
    gray100: '#f3f4f6',
    gray200: '#e5e7eb',
    gray300: '#d1d5db',
    gray400: '#9ca3af',
    gray500: '#6b7280',
    gray600: '#4b5563',
    gray700: '#374151',
    gray800: '#1f2937',
    gray900: '#111827',
    black: '#000000',
    
    // Status Colors
    errorBg: '#fee2e2',
    errorText: '#dc2626',
    successBg: '#dcfce7',
    successText: '#16a34a',
    warningBg: '#fef3c7',
    warningText: '#d97706',
    infoBg: '#dbeafe',
    infoText: '#2563eb',
    
    // POS Specific
    loyaltyGreen: '#4CAF50',
    discountRed: '#ff6b6b',
    cashGreen: '#059669',
    cardBlue: '#3b82f6'
  },

  // Typography
  typography: {
    // Font Families
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMono: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
    
    // Font Sizes
    fontSize: {
      xs: '15px',
      sm: '16px',
      base: '18px',
      md: '19px',
      lg: '20px',
      xl: '23px',
      '2xl': '25px',
      '3xl': '30px',
      '4xl': '40px'
    },
    
    // Font Weights
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700'
    },
    
    // Line Heights
    lineHeight: {
      tight: '1.2',
      normal: '1.4',
      relaxed: '1.6'
    }
  },

  // Spacing
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '32px',
    '4xl': '40px',
    '5xl': '48px',
    '6xl': '64px'
  },

  // Border Radius
  borderRadius: {
    none: '0',
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
    full: '9999px'
  },

  // Shadows
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    modal: '0 20px 25px -5px rgba(0, 0, 0, 0.3)'
  },

  // Transitions
  transitions: {
    fast: '0.1s ease',
    normal: '0.2s ease',
    slow: '0.3s ease'
  },

  // Layout Mixins
  layout: {
    // Container
    container: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      backgroundColor: '#f8f9fa',
      padding: '20px',
      paddingTop: '100px',
      boxSizing: 'border-box'
    },
    
    // Flex utilities
    flexCenter: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    
    flexBetween: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    
    flexColumn: {
      display: 'flex',
      flexDirection: 'column'
    },
    
    // Card
    card: {
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }
  },

  // Component Styles
  components: {
    // Buttons
    button: {
      base: {
        padding: '12px 24px',
        border: 'none',
        borderRadius: '6px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: '0.2s ease',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px'
      },
      
      variants: {
        primary: {
          backgroundColor: '#008080',
          color: '#ffffff'
        },
        secondary: {
          backgroundColor: '#f3f4f6',
          color: '#374151',
          border: '1px solid #d1d5db'
        },
        success: {
          backgroundColor: '#10b981',
          color: '#ffffff'
        },
        warning: {
          backgroundColor: '#f59e0b',
          color: '#ffffff'
        },
        danger: {
          backgroundColor: '#ef4444',
          color: '#ffffff'
        },
        ghost: {
          backgroundColor: 'transparent',
          color: '#374151',
          border: '1px solid #d1d5db'
        }
      },
      
      sizes: {
        sm: {
          padding: '8px 16px',
          fontSize: '13px'
        },
        md: {
          padding: '12px 24px',
          fontSize: '14px'
        },
        lg: {
          padding: '16px 32px',
          fontSize: '16px'
        }
      }
    },

    // Form Elements
    form: {
      input: {
        padding: '12px 16px',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        fontSize: '14px',
        transition: 'border-color 0.2s',
        fontFamily: 'inherit',
        backgroundColor: '#ffffff',
        width: '90%'
      },
      
      label: {
        fontSize: '14px',
        fontWeight: '600',
        color: '#374151',
        marginBottom: '8px',
        display: 'block'
      },
      
      select: {
        padding: '12px 16px',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        fontSize: '14px',
        backgroundColor: '#ffffff',
        cursor: 'pointer',
        width: '90%'
      },
      
      textarea: {
        padding: '12px 16px',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        fontSize: '14px',
        transition: 'border-color 0.2s',
        fontFamily: 'inherit',
        backgroundColor: '#ffffff',
        width: '90%',
        resize: 'vertical'
      }
    },

    // Tables
    table: {
      container: {
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        overflow: 'auto',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      },
      
      table: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '13px'
      },
      
      headerRow: {
        backgroundColor: '#f9fafb',
        borderBottom: '2px solid #e5e7eb'
      },
      
      th: {
        padding: '16px 12px',
        textAlign: 'left',
        fontWeight: '600',
        color: '#374151',
        fontSize: '18px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      },
      
      row: {
        transition: 'background-color 0.2s ease',
        borderBottom: '1px solid #f3f4f6'
      },
      
      td: {
        padding: '16px 12px',
        verticalAlign: 'middle'
      }
    },

    // Modals
    modal: {
      overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      },
      
      content: {
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        maxWidth: '500px',
        width: '90%',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
      },
      
      header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 24px',
        borderBottom: '1px solid #e5e7eb'
      },
      
      body: {
        flex: 1,
        padding: '24px',
        overflowY: 'auto'
      },
      
      footer: {
        display: 'flex',
        gap: '12px',
        padding: '20px 24px',
        borderTop: '1px solid #e5e7eb',
        justifyContent: 'flex-end'
      }
    },

    // Banners/Alerts
    banner: {
      base: {
        padding: '15px',
        borderRadius: '8px',
        marginBottom: '20px',
        fontWeight: 'bold'
      },
      
      variants: {
        error: {
          backgroundColor: '#fee2e2',
          color: '#dc2626'
        },
        success: {
          backgroundColor: '#dcfce7',
          color: '#16a34a'
        },
        warning: {
          backgroundColor: '#fef3c7',
          color: '#d97706'
        },
        info: {
          backgroundColor: '#dbeafe',
          color: '#2563eb'
        }
      }
    },

    // Loading States
    loading: {
      container: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '200px',
        fontSize: '13px',
        color: '#6b7280'
      },
      
      spinner: {
        width: '40px',
        height: '40px',
        border: '4px solid #f3f4f6',
        borderTop: '4px solid #008080',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }
    }
  },

  // POS Specific Styles
  pos: {
    // Cart styles
    cart: {
      container: {
        backgroundColor: '#fff',
        borderLeft: '1px solid #ddd',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '400px',
        position: 'relative'
      },
      
      item: {
        borderBottom: '1px solid #eee',
        marginBottom: '8px',
        padding: '12px 8px',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'background-color 0.2s ease'
      },
      
      summary: {
        borderTop: '2px solid #ddd',
        paddingTop: '12px',
        marginTop: '12px'
      }
    },

    // Tax styles
    tax: {
      section: {
        backgroundColor: '#f8f9fa',
        padding: '8px 12px',
        borderRadius: '4px',
        margin: '8px 0',
        border: '1px solid #e9ecef'
      },
      
      row: {
        display: 'flex',
        justifyContent: 'space-between',
        margin: '3px 0',
        fontSize: '13px',
        fontWeight: '500',
        color: '#333'
      },
      
      rebate: {
        display: 'flex',
        justifyContent: 'space-between',
        margin: '3px 0',
        fontSize: '14px',
        fontWeight: '500',
        color: '#4CAF50'
      }
    },

    // Loyalty styles
    loyalty: {
      banner: {
        backgroundColor: '#008080',
        color: 'white',
        padding: '12px',
        borderRadius: '6px',
        marginBottom: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      },
      
      active: {
        backgroundColor: '#4CAF50',
        color: 'white',
        padding: '10px',
        borderRadius: '6px',
        marginBottom: '12px',
        textAlign: 'center',
        fontSize: '14px',
        fontWeight: 'bold'
      }
    },

    // Category preview
    categoryPreview: {
      width: '40px',
      height: '40px',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid #d1d5db'
    }
  },

  // Utility functions
  utils: {
    // Merge styles
    merge: (...styles) => {
      return Object.assign({}, ...styles);
    },
    
    // Create responsive styles
    responsive: (baseStyle, breakpoints) => {
      return {
        ...baseStyle,
        '@media (max-width: 768px)': breakpoints.mobile || {},
        '@media (max-width: 1024px)': breakpoints.tablet || {}
      };
    },
    
    // Create hover states
    hover: (baseStyle, hoverStyle) => {
      return {
        ...baseStyle,
        ':hover': hoverStyle
      };
    },
    
    // Create disabled states
    disabled: (baseStyle, disabledStyle) => {
      return {
        ...baseStyle,
        ':disabled': {
          cursor: 'not-allowed',
          opacity: 0.6,
          ...disabledStyle
        }
      };
    }
  },

  // Animation keyframes (CSS-in-JS)
  keyframes: {
    spin: `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `,
    
    fadeIn: `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `,
    
    slideUp: `
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `
  },

  // Breakpoints
  breakpoints: {
    mobile: '768px',
    tablet: '1024px',
    desktop: '1280px',
    wide: '1536px'
  }
};

// Compatibility aliases (Digital Signage and other modules expect these paths)
TavariStyles.layouts = {
  container: {
    ...TavariStyles.layout.container,
    maxWidth: '1400px',
    margin: '0 auto',
    width: '100%'
  },
  centerContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    minHeight: '400px',
    padding: TavariStyles.spacing['4xl']
  }
};

TavariStyles.typography.heading = {
  h1: {
    fontSize: TavariStyles.typography.fontSize['3xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    margin: 0
  },
  h2: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    margin: 0
  },
  h3: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    margin: 0
  },
  h4: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    margin: 0
  }
};

TavariStyles.typography.body = {
  fontSize: TavariStyles.typography.fontSize.base,
  color: TavariStyles.colors.gray600,
  lineHeight: TavariStyles.typography.lineHeight.normal,
  margin: 0
};

TavariStyles.components.card = { ...TavariStyles.layout.card };
TavariStyles.components.input = { ...TavariStyles.components.form.input };
TavariStyles.components.button.primary = {
  ...TavariStyles.components.button.base,
  ...TavariStyles.components.button.variants.primary
};
TavariStyles.components.button.secondary = {
  ...TavariStyles.components.button.base,
  ...TavariStyles.components.button.variants.secondary
};

// Export individual sections for easier importing
export const { colors, typography, spacing, components, pos, utils } = TavariStyles;

export default TavariStyles;
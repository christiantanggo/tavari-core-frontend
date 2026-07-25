// components/HR/YTDComponents/index.js - FIXED Export file for YTD Components
/**
 * Centralized exports for all YTD (Year-to-Date) components and utilities
 * Provides easy importing across the Tavari HR system
 * 
 * Usage:
 * import { YTDSummaryCard, YTDDetailModal, useYTDCalculations } from '../YTDComponents';
 * 
 * Or individual imports:
 * import { YTDSummaryCard } from '../YTDComponents/YTDSummaryCard';
 */

// Import components first to use in default export
import YTDSummaryCardComponent from './YTDSummaryCard';
import YTDDetailModalComponent from './YTDDetailModal';
import YTDManualEntryModalComponent from './YTDManualEntryModal';
import { useYTDCalculations } from '../../../hooks/useYTDCalculations';

// Core YTD Components - Named exports
export { default as YTDSummaryCard } from './YTDSummaryCard';
export { default as YTDDetailModal } from './YTDDetailModal';
export { default as YTDManualEntryModal } from './YTDManualEntryModal';

// YTD Hook - Export from hooks
export { useYTDCalculations } from '../../../hooks/useYTDCalculations';

/**
 * YTD Component Configuration
 * Default props and configuration for YTD components
 */
export const YTD_DEFAULTS = {
  // Default security settings for YTD components
  SECURITY_LEVEL: 'critical',
  REQUIRED_ROLES: ['owner', 'manager', 'hr_admin'],
  
  // Default formatting options
  CURRENCY_PRECISION: 2,
  HOURS_PRECISION: 2,
  
  // Validation thresholds
  MAX_REASONABLE_VALUES: {
    regular_hours: 4000,
    overtime_hours: 2000,
    lieu_hours: 1000,
    stat_hours: 200,
    holiday_hours: 200,
    hours_worked: 5000,
    regular_income: 500000,
    overtime_income: 300000,
    lieu_income: 150000,
    vacation_pay: 50000,
    shift_premiums: 100000,
    stat_earnings: 25000,
    holiday_earnings: 25000,
    bonus: 200000,
    federal_tax: 150000,
    provincial_tax: 100000,
    cpp_deduction: 10000,
    ei_deduction: 5000,
    additional_tax: 50000,
    gross_pay: 750000,
    net_pay: 600000
  },
  
  // Modal default sizes
  MODAL_SIZES: {
    summary: { maxWidth: '500px' },
    detail: { maxWidth: '900px' },
    entry: { maxWidth: '1000px' }
  }
};

/**
 * YTD Field Definitions
 * Metadata about YTD fields for dynamic form generation
 */
export const YTD_FIELD_DEFINITIONS = {
  // Hours fields
  hours: {
    regular_hours: {
      label: 'Regular Hours',
      type: 'number',
      category: 'hours',
      required: false,
      min: 0,
      step: 0.01,
      icon: '⏰'
    },
    overtime_hours: {
      label: 'Overtime Hours',
      type: 'number',
      category: 'hours',
      required: false,
      min: 0,
      step: 0.01,
      icon: '⚡'
    },
    lieu_hours: {
      label: 'Lieu Hours',
      type: 'number',
      category: 'hours',
      required: false,
      min: 0,
      step: 0.01,
      icon: '🔄'
    },
    stat_hours: {
      label: 'Stat Holiday Hours',
      type: 'number',
      category: 'hours',
      required: false,
      min: 0,
      step: 0.01,
      advanced: true,
      icon: '🏛️'
    },
    holiday_hours: {
      label: 'Holiday Hours',
      type: 'number',
      category: 'hours',
      required: false,
      min: 0,
      step: 0.01,
      advanced: true,
      icon: '🌴'
    },
    hours_worked: {
      label: 'Total Hours Worked',
      type: 'number',
      category: 'hours',
      required: false,
      min: 0,
      step: 0.01,
      calculated: true,
      icon: '📊'
    }
  },
  
  // Earnings fields
  earnings: {
    regular_income: {
      label: 'Regular Income',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      icon: '💰'
    },
    overtime_income: {
      label: 'Overtime Income',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      icon: '💸'
    },
    lieu_income: {
      label: 'Lieu Income',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      icon: '🔄'
    },
    vacation_pay: {
      label: 'Vacation Pay',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      icon: '🏖️'
    },
    shift_premiums: {
      label: 'Premium Pay',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      icon: '⭐'
    },
    stat_earnings: {
      label: 'Stat Holiday Pay',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      advanced: true,
      icon: '🏛️'
    },
    holiday_earnings: {
      label: 'Holiday Pay',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      advanced: true,
      icon: '🌴'
    },
    bonus: {
      label: 'Bonuses',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      advanced: true,
      icon: '🎁'
    },
    gross_pay: {
      label: 'Gross Pay',
      type: 'currency',
      category: 'earnings',
      required: false,
      min: 0,
      step: 0.01,
      calculated: true,
      primary: true,
      icon: '💵'
    }
  },
  
  // Deductions fields
  deductions: {
    federal_tax: {
      label: 'Federal Tax',
      type: 'currency',
      category: 'deductions',
      required: false,
      min: 0,
      step: 0.01,
      icon: '🏛️'
    },
    provincial_tax: {
      label: 'Provincial Tax',
      type: 'currency',
      category: 'deductions',
      required: false,
      min: 0,
      step: 0.01,
      icon: '🏢'
    },
    cpp_deduction: {
      label: 'CPP Deduction',
      type: 'currency',
      category: 'deductions',
      required: false,
      min: 0,
      step: 0.01,
      icon: '👥'
    },
    ei_deduction: {
      label: 'EI Deduction',
      type: 'currency',
      category: 'deductions',
      required: false,
      min: 0,
      step: 0.01,
      icon: '🛡️'
    },
    additional_tax: {
      label: 'Additional Tax',
      type: 'currency',
      category: 'deductions',
      required: false,
      min: 0,
      step: 0.01,
      icon: '📄'
    },
    net_pay: {
      label: 'Net Pay',
      type: 'currency',
      category: 'totals',
      required: false,
      min: 0,
      step: 0.01,
      calculated: true,
      primary: true,
      icon: '💎'
    }
  }
};

/**
 * YTD Helper Functions
 * Utility functions for working with YTD data
 */
export const YTDHelpers = {
  /**
   * Get all field definitions for a specific category
   */
  getFieldsByCategory: (category) => {
    const allFields = { 
      ...YTD_FIELD_DEFINITIONS.hours, 
      ...YTD_FIELD_DEFINITIONS.earnings, 
      ...YTD_FIELD_DEFINITIONS.deductions 
    };
    return Object.entries(allFields)
      .filter(([key, field]) => field.category === category)
      .reduce((acc, [key, field]) => ({ ...acc, [key]: field }), {});
  },
  
  /**
   * Get only basic fields (non-advanced)
   */
  getBasicFields: () => {
    const allFields = { 
      ...YTD_FIELD_DEFINITIONS.hours, 
      ...YTD_FIELD_DEFINITIONS.earnings, 
      ...YTD_FIELD_DEFINITIONS.deductions 
    };
    return Object.entries(allFields)
      .filter(([key, field]) => !field.advanced)
      .reduce((acc, [key, field]) => ({ ...acc, [key]: field }), {});
  },
  
  /**
   * Get only advanced fields
   */
  getAdvancedFields: () => {
    const allFields = { 
      ...YTD_FIELD_DEFINITIONS.hours, 
      ...YTD_FIELD_DEFINITIONS.earnings, 
      ...YTD_FIELD_DEFINITIONS.deductions 
    };
    return Object.entries(allFields)
      .filter(([key, field]) => field.advanced)
      .reduce((acc, [key, field]) => ({ ...acc, [key]: field }), {});
  },
  
  /**
   * Get calculated fields
   */
  getCalculatedFields: () => {
    const allFields = { 
      ...YTD_FIELD_DEFINITIONS.hours, 
      ...YTD_FIELD_DEFINITIONS.earnings, 
      ...YTD_FIELD_DEFINITIONS.deductions 
    };
    return Object.entries(allFields)
      .filter(([key, field]) => field.calculated)
      .reduce((acc, [key, field]) => ({ ...acc, [key]: field }), {});
  },
  
  /**
   * Calculate derived YTD values
   */
  calculateDerived: (ytdData) => {
    const totalHours = (ytdData.regular_hours || 0) + 
                      (ytdData.overtime_hours || 0) + 
                      (ytdData.lieu_hours || 0) + 
                      (ytdData.stat_hours || 0) + 
                      (ytdData.holiday_hours || 0);
    
    const totalEarnings = (ytdData.regular_income || 0) + 
                         (ytdData.overtime_income || 0) + 
                         (ytdData.lieu_income || 0) + 
                         (ytdData.vacation_pay || 0) + 
                         (ytdData.shift_premiums || 0) + 
                         (ytdData.stat_earnings || 0) + 
                         (ytdData.holiday_earnings || 0) + 
                         (ytdData.bonus || 0);
    
    const totalDeductions = (ytdData.federal_tax || 0) + 
                           (ytdData.provincial_tax || 0) + 
                           (ytdData.cpp_deduction || 0) + 
                           (ytdData.ei_deduction || 0) + 
                           (ytdData.additional_tax || 0);
    
    const netPay = totalEarnings - totalDeductions;
    const averageHourlyRate = totalHours > 0 ? totalEarnings / totalHours : 0;
    
    return {
      totalHours,
      totalEarnings,
      totalDeductions,
      netPay,
      averageHourlyRate,
      effectiveTaxRate: totalEarnings > 0 ? totalDeductions / totalEarnings : 0
    };
  },
  
  /**
   * Validate YTD data for logical consistency
   */
  validateYTDData: (ytdData) => {
    const errors = [];
    const warnings = [];
    const derived = YTDHelpers.calculateDerived(ytdData);
    
    // Check if totals match derived calculations
    if (Math.abs((ytdData.hours_worked || 0) - derived.totalHours) > 0.01) {
      errors.push(`Total hours (${ytdData.hours_worked}) doesn't match sum of individual hours (${derived.totalHours})`);
    }
    
    if (Math.abs((ytdData.gross_pay || 0) - derived.totalEarnings) > 0.01) {
      errors.push(`Gross pay (${ytdData.gross_pay}) doesn't match sum of earnings (${derived.totalEarnings})`);
    }
    
    if (Math.abs((ytdData.net_pay || 0) - derived.netPay) > 0.01) {
      errors.push(`Net pay (${ytdData.net_pay}) doesn't match gross minus deductions (${derived.netPay})`);
    }
    
    // Reasonable value checks
    Object.entries(YTD_DEFAULTS.MAX_REASONABLE_VALUES).forEach(([field, maxValue]) => {
      if ((ytdData[field] || 0) > maxValue) {
        warnings.push(`${field} value (${ytdData[field]}) seems unusually high (max suggested: ${maxValue})`);
      }
    });
    
    // Negative value checks
    Object.keys(ytdData).forEach(field => {
      if ((ytdData[field] || 0) < 0) {
        errors.push(`${field} cannot be negative`);
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      derived
    };
  },
  
  /**
   * Format YTD data for display
   */
  formatForDisplay: (ytdData, formatFunction = null) => {
    const formatter = formatFunction || ((value) => Number(value || 0).toFixed(2));
    const formatted = {};
    
    Object.entries(ytdData).forEach(([key, value]) => {
      const fieldDef = YTD_FIELD_DEFINITIONS.hours[key] || 
                      YTD_FIELD_DEFINITIONS.earnings[key] || 
                      YTD_FIELD_DEFINITIONS.deductions[key];
      
      if (fieldDef) {
        if (fieldDef.type === 'currency') {
          formatted[key] = `$${formatter(value)}`;
        } else if (fieldDef.type === 'number') {
          formatted[key] = formatter(value);
        } else {
          formatted[key] = value;
        }
      } else {
        formatted[key] = value;
      }
    });
    
    return formatted;
  },
  
  /**
   * Get empty YTD data structure
   */
  getEmptyYTDData: () => {
    const emptyData = {};
    
    Object.keys(YTD_FIELD_DEFINITIONS.hours).forEach(key => {
      emptyData[key] = 0;
    });
    Object.keys(YTD_FIELD_DEFINITIONS.earnings).forEach(key => {
      emptyData[key] = 0;
    });
    Object.keys(YTD_FIELD_DEFINITIONS.deductions).forEach(key => {
      emptyData[key] = 0;
    });
    
    return emptyData;
  }
};

/**
 * YTD Constants
 * Common constants used across YTD components
 */
export const YTD_CONSTANTS = {
  // Database table name
  TABLE_NAME: 'hrpayroll_ytd_data',
  
  // Tax year boundaries
  TAX_YEAR_START: { month: 0, day: 1 }, // January 1st
  TAX_YEAR_END: { month: 11, day: 31 }, // December 31st
  
  // Canadian tax limits by year (CRA T4127). Update annually as new editions are published.
  CRA_LIMITS: {
    2024: {
      EI_MAX_INSURABLE: 63200,
      CPP_MAX_PENSIONABLE: 68500,
      EI_RATE: 0.0166,
      CPP_RATE: 0.0595
    },
    2025: {
      EI_MAX_INSURABLE: 65700,
      CPP_MAX_PENSIONABLE: 71300,
      EI_RATE: 0.0164,
      CPP_RATE: 0.0595
    },
    2026: {
      EI_MAX_INSURABLE: 68900,
      CPP_MAX_PENSIONABLE: 74600,
      EI_RATE: 0.0163,
      CPP_RATE: 0.0595
    }
  },
  // Backwards-compat alias for callers expecting 2025 specifically.
  CRA_2025_LIMITS: {
    EI_MAX_INSURABLE: 65700,
    CPP_MAX_PENSIONABLE: 71300,
    EI_RATE: 0.0164,
    CPP_RATE: 0.0595
  },
  // Current year limits (used by callers that don't pick a specific year).
  CRA_2026_LIMITS: {
    EI_MAX_INSURABLE: 68900,
    CPP_MAX_PENSIONABLE: 74600,
    EI_RATE: 0.0163,
    CPP_RATE: 0.0595
  },
  
  // Security audit event types
  AUDIT_EVENTS: {
    YTD_VIEWED: 'ytd_data_viewed',
    YTD_EDITED: 'ytd_data_edited',
    YTD_CALCULATED: 'ytd_data_calculated',
    YTD_VALIDATED: 'ytd_data_validated',
    YTD_EXPORTED: 'ytd_data_exported'
  },
  
  // Component states
  COMPONENT_STATES: {
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error',
    SAVING: 'saving',
    VALIDATING: 'validating'
  }
};

// No default export needed - index.js files typically just re-export named exports
// If a default export is needed elsewhere, import the individual components directly
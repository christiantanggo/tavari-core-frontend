/**
 * Visual treatment for `pos_loyalty_accounts.account_card_style` in POS / profile UIs.
 * Keep in sync with DB CHECK on `pos_loyalty_accounts.account_card_style`.
 */
export const ACCOUNT_CARD_STYLE_IDS = [
  'default',
  'info',
  'success',
  'warning',
  'danger',
  'banned'
];

export const ACCOUNT_CARD_STYLE_OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: 'info', label: 'Info (blue)' },
  { id: 'success', label: 'Success (green)' },
  { id: 'warning', label: 'Warning (amber)' },
  { id: 'danger', label: 'Alert (red-orange)' },
  { id: 'banned', label: 'Banned (red) — use with check-in block' }
];

const SURFACES = {
  default: {
    backgroundColor: 'transparent',
    borderLeft: '3px solid transparent',
    boxShadow: 'none'
  },
  info: {
    backgroundColor: '#eff6ff',
    borderLeft: '3px solid #3b82f6',
    boxShadow: 'inset 0 0 0 1px #bfdbfe'
  },
  success: {
    backgroundColor: '#f0fdf4',
    borderLeft: '3px solid #22c55e',
    boxShadow: 'inset 0 0 0 1px #bbf7d0'
  },
  warning: {
    backgroundColor: '#fffbeb',
    borderLeft: '3px solid #f59e0b',
    boxShadow: 'inset 0 0 0 1px #fde68a'
  },
  danger: {
    backgroundColor: '#fff7ed',
    borderLeft: '3px solid #ea580c',
    boxShadow: 'inset 0 0 0 1px #fed7aa'
  },
  banned: {
    backgroundColor: '#fef2f2',
    borderLeft: '3px solid #b91c1c',
    boxShadow: 'inset 0 0 0 1px #fecaca'
  }
};

/**
 * Row / card surface (table row or padded summary).
 * @param {string} [styleId]
 * @returns {import('react').CSSProperties}
 */
export function getAccountCardStyleSurface(styleId) {
  const key = ACCOUNT_CARD_STYLE_IDS.includes(styleId) ? styleId : 'default';
  return SURFACES[key] || SURFACES.default;
}

/**
 * Merges table-row base with accent (hover still handled by :hover if needed; we override background on hover in caller).
 * @param {string} [styleId]
 * @param {import('react').CSSProperties} [base]
 */
export function mergeCustomerTableRowStyle(styleId, base = {}) {
  return { ...base, ...getAccountCardStyleSurface(styleId) };
}

export const FUNDING_STATUSES = [
  { value: 'idea', label: 'Idea' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

export const FUNDING_APPLICATION_TYPES = [
  { value: 'grant', label: 'Grant' },
  { value: 'loan', label: 'Loan' },
  { value: 'line_of_credit', label: 'Line of credit' },
  { value: 'investor', label: 'Investor' },
  { value: 'other', label: 'Other' },
];

export const FUNDING_ENTITY_SCOPES = [
  { value: 'current_business', label: 'Current business' },
  { value: 'expansion', label: 'Expansion scenario' },
  { value: 'new_venture', label: 'New venture' },
  { value: 'multi', label: 'Multi-business package' },
];

export const FUNDING_SCENARIO_TYPES = [
  { value: 'current', label: 'Current operations' },
  { value: 'expansion', label: 'Expansion' },
  { value: 'new_venture', label: 'New venture' },
  { value: 'custom', label: 'Custom' },
];

export const DEFAULT_PLAN_SECTIONS = [
  { section_key: 'executive_summary', title: 'Executive Summary' },
  { section_key: 'company_overview', title: 'Company Overview' },
  { section_key: 'market_analysis', title: 'Market Analysis' },
  { section_key: 'products_services', title: 'Products & Services' },
  { section_key: 'marketing_sales', title: 'Marketing & Sales' },
  { section_key: 'operations', title: 'Operations' },
  { section_key: 'management_team', title: 'Management Team' },
  { section_key: 'use_of_funds', title: 'Use of Funds' },
  { section_key: 'financial_projections', title: 'Financial Projections' },
  { section_key: 'risk_analysis', title: 'Risk Analysis' },
  { section_key: 'appendices', title: 'Appendices' },
];

export const DATA_PULL_OPTIONS = [
  { key: 'business_profile', label: 'Business profile' },
  { key: 'address', label: 'Address' },
  { key: 'tax_number', label: 'Tax number' },
  { key: 'operating_hours', label: 'Operating hours' },
  { key: 'live_pnl', label: 'Live P&L (Accounting)' },
  { key: 'live_balance_sheet', label: 'Live balance sheet' },
  { key: 'live_cash_flow', label: 'Live cash flow' },
  { key: 'payroll_summary', label: 'Payroll summary' },
  { key: 'pos_sales', label: 'POS sales summary' },
  { key: 'projections', label: 'Funding projections' },
  { key: 'collateral', label: 'Collateral' },
  { key: 'personal_net_worth', label: 'Personal net worth' },
];

export const DEDUCTLY_PROVINCES = [
  'ontario',
  'british-columbia',
  'alberta',
  'quebec',
  'manitoba',
  'saskatchewan',
  'nova-scotia',
  'new-brunswick',
  'newfoundland-labrador',
  'prince-edward-island',
  'northwest-territories',
  'nunavut',
  'yukon',
];

export const DEDUCTLY_INDUSTRIES = [
  'technology',
  'retail',
  'manufacturing',
  'food-beverage',
  'healthcare',
  'professional-services',
  'construction',
  'agriculture',
  'creative',
  'other',
];

export const STATUS_COLORS = {
  idea: '#6b7280',
  draft: '#3b82f6',
  ready: '#8b5cf6',
  submitted: '#f59e0b',
  approved: '#059669',
  denied: '#dc2626',
  withdrawn: '#9ca3af',
};

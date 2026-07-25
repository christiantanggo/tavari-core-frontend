/** Display names for Tavari modules (sidebar + deactivation UI). */
export const MODULE_DISPLAY_NAMES = {
  pos: 'Tavari POS',
  dining: 'Tavari Dining',
  inbox: 'Tavari Inbox',
  waivers: 'Tavari Waivers',
  bookings: 'Tavari Bookings',
  accounting: 'Tavari Accounting',
  invoices: 'Tavari Invoices',
  funding: 'Tavari Funding',
  tasks: 'Tavari Task Manager',
  forms: 'Tavari Forms',
  scheduling: 'Tavari Scheduling',
  hr: 'Tavari HR',
  payroll: 'Tavari Payroll',
  mail: 'Tavari Mail',
  social_media: 'Tavari AI Social Media Agent',
  reputation: 'Tavari Reputation',
  reminders: 'Tavari Reminder',
  tavari_apis: 'Tavari APIs',
  voice_agent: 'Tavari Voice Agent',
  custom_voice_agent: 'Tavari Custom Voice Agent',
  appbuilder: 'Tavari App Builder',
  music: 'Tavari Music',
  recipe_builder: 'Tavari Recipe Manager',
  liquor: 'Tavari Liquor Management',
  vending: 'Tavari Vending',
  power_bank: 'Tavari Power Bank',
  digital_signage: 'Tavari Digital Signage',
  loyalty: 'Tavari Loyalty',
  dividend_income: 'Dividend Income',
};

export function getModuleDisplayName(moduleKey, moduleName) {
  const key = (moduleKey || '').toLowerCase();
  const raw = (moduleName || MODULE_DISPLAY_NAMES[key] || key).trim();
  if (/^tavari\s/i.test(raw)) return raw;
  return `Tavari ${raw}`;
}

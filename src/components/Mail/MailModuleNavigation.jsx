import React from 'react';
import {
  FiActivity,
  FiCalendar,
  FiEdit3,
  FiFileText,
  FiPieChart,
  FiSettings,
  FiShield,
  FiUsers
} from 'react-icons/fi';
import TavariTabSystemComponent from '../UI/TavariTabSystemComponent';

const MAIL_TABS = [
  {
    id: 'create-campaign',
    label: 'Create Campaign',
    icon: FiEdit3,
    to: '/dashboard/mail/builder',
    matchPaths: [
      { path: '/dashboard/mail/builder', end: true },
      { path: '/dashboard/mail/builder/:campaignId', end: true }
    ]
  },
  {
    id: 'view-campaigns',
    label: 'View Campaigns',
    icon: FiFileText,
    to: '/dashboard/mail/campaigns',
    matchPaths: [
      { path: '/dashboard/mail/campaigns', end: true },
      { path: '/dashboard/mail/campaigns/:campaignId', end: true },
      { path: '/dashboard/mail/campaigns/:campaignId/preview', end: true },
      { path: '/dashboard/mail/campaigns/:campaignId/results', end: true },
      { path: '/dashboard/mail/preview/:campaignId', end: true },
      { path: '/dashboard/mail/results/:campaignId', end: true },
      { path: '/dashboard/mail/sender/:campaignId', end: true }
    ]
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: FiFileText,
    to: '/dashboard/mail/templates',
    matchPaths: [{ path: '/dashboard/mail/templates', end: true }]
  },
  {
    id: 'manage-contacts',
    label: 'Manage Contacts',
    icon: FiUsers,
    to: '/dashboard/mail/contacts',
    matchPaths: [
      { path: '/dashboard/mail/contacts', end: true },
      { path: '/dashboard/mail/contacts/segments', end: true },
      { path: '/dashboard/mail/contacts/edit/:id', end: true }
    ]
  }
];

export const MAIL_USAGE_TABS = [
  { id: 'overview', label: 'Overview', icon: FiPieChart },
  { id: 'history', label: 'History', icon: FiCalendar },
  { id: 'monitor-logs', label: 'Monitor & Logs', icon: FiActivity },
  { id: 'compliance', label: 'Compliance', icon: FiShield },
  { id: 'settings', label: 'Settings', icon: FiSettings, requiresElevated: true }
];

export function MailModuleTabs() {
  return (
    <TavariTabSystemComponent
      tabs={MAIL_TABS}
      mode="route"
      ariaLabel="Mail module navigation"
      variant="module"
      fullWidth={false}
      containerStyle={{ marginBottom: 20 }}
    />
  );
}

export function MailModuleSubTabs({ tabs = [], activeTab, onTabChange, ariaLabel = 'Mail sub navigation' }) {
  if (!tabs.length) {
    return null;
  }

  return (
    <TavariTabSystemComponent
      tabs={tabs}
      mode="state"
      activeTab={activeTab}
      onTabChange={onTabChange}
      ariaLabel={ariaLabel}
      variant="module"
      fullWidth={false}
      containerStyle={{ marginBottom: 20 }}
    />
  );
}

export function MailUsageTabs({ tabs = MAIL_USAGE_TABS, activeTab, onTabChange }) {
  return (
    <MailModuleSubTabs
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      ariaLabel="Mail usage navigation"
    />
  );
}


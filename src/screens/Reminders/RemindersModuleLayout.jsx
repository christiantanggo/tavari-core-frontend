import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Bell, CheckCircle, History, ListChecks, Plus, Settings } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const REMINDER_TABS = [
  {
    id: 'active',
    label: 'Active reminders',
    icon: Bell,
    to: '/dashboard/reminders',
    matchPaths: [
      { path: '/dashboard/reminders', end: true },
      { path: '/dashboard/reminders/active', end: true },
    ],
  },
  {
    id: 'reminders',
    label: 'Reminders',
    icon: ListChecks,
    to: '/dashboard/reminders/manage',
    isActive: ({ pathname }) => {
      if (pathname === '/dashboard/reminders/manage' || pathname === '/dashboard/reminders/new') return true;
      if (
        pathname === '/dashboard/reminders'
        || pathname === '/dashboard/reminders/active'
        || pathname === '/dashboard/reminders/completed'
        || pathname === '/dashboard/reminders/history'
        || pathname === '/dashboard/reminders/settings'
      ) return false;
      return /^\/dashboard\/reminders\/[^/]+$/.test(pathname);
    },
  },
  {
    id: 'completed',
    label: 'Completed',
    icon: CheckCircle,
    to: '/dashboard/reminders/completed',
    matchPaths: [{ path: '/dashboard/reminders/completed', end: true }],
  },
  {
    id: 'history',
    label: 'Send history',
    icon: History,
    to: '/dashboard/reminders/history',
    matchPaths: [{ path: '/dashboard/reminders/history', end: true }],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    to: '/dashboard/reminders/settings',
    matchPaths: [{ path: '/dashboard/reminders/settings', end: true }],
  },
];

const layoutStyles = {
  shell: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    padding: '20px',
    paddingTop: '80px',
    boxSizing: 'border-box',
  },
};

export default function RemindersModuleLayout() {
  const navigate = useNavigate();

  return (
    <div style={layoutStyles.shell}>
      <TavariModuleHeader
        title="Tavari Reminder"
        description="Manage active reminder work, schedules, employee recipients, and repeat-until-complete follow-ups."
        actionLabel="+ New Reminder"
        actionIcon={<Plus size={18} />}
        onAction={() => navigate('/dashboard/reminders/new')}
      />
      <TavariTabSystemComponent
        tabs={REMINDER_TABS}
        mode="route"
        ariaLabel="Tavari Reminder module navigation"
      />
      <Outlet />
    </div>
  );
}

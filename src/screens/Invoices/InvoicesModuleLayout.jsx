import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import {
  FileText,
  Clock,
  CheckCircle,
  History,
  Layers,
  Plus,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import ModuleCatalogService from '../../services/ModuleCatalogService';

const INVOICE_TABS = [
  {
    id: 'all',
    label: 'All invoices',
    icon: FileText,
    to: '/dashboard/invoices',
    matchPaths: [{ path: '/dashboard/invoices', end: true }],
  },
  {
    id: 'drafts',
    label: 'Drafts',
    icon: FileText,
    to: '/dashboard/invoices/drafts',
    matchPaths: [{ path: '/dashboard/invoices/drafts', end: true }],
  },
  {
    id: 'unpaid',
    label: 'Unpaid',
    icon: Clock,
    to: '/dashboard/invoices/unpaid',
    matchPaths: [{ path: '/dashboard/invoices/unpaid', end: true }],
  },
  {
    id: 'paid',
    label: 'Paid',
    icon: CheckCircle,
    to: '/dashboard/invoices/paid',
    matchPaths: [{ path: '/dashboard/invoices/paid', end: true }],
  },
  {
    id: 'summary',
    label: 'Summary',
    icon: Layers,
    to: '/dashboard/invoices/summary',
    matchPaths: [{ path: '/dashboard/invoices/summary', end: true }],
  },
  {
    id: 'recurring',
    label: 'Recurring',
    icon: RefreshCw,
    to: '/dashboard/invoices/recurring',
    matchPaths: [
      { path: '/dashboard/invoices/recurring', end: true },
      { path: '/dashboard/invoices/recurring/new', end: true },
      { path: '/dashboard/invoices/recurring/:id', end: true },
    ],
  },
  {
    id: 'history',
    label: 'History',
    icon: History,
    to: '/dashboard/invoices/history',
    matchPaths: [{ path: '/dashboard/invoices/history', end: true }],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    to: '/dashboard/invoices/settings',
    matchPaths: [{ path: '/dashboard/invoices/settings', end: true }],
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

export default function InvoicesModuleLayout() {
  const navigate = useNavigate();
  const { isEnabled, loading } = useModuleEnabled('invoices');

  useEffect(() => {
    ModuleCatalogService.trackModuleUsage('invoices');
  }, []);

  if (loading) {
    return (
      <div style={{ ...layoutStyles.shell, textAlign: 'center', paddingTop: '120px' }}>
        Loading Tavari Invoices…
      </div>
    );
  }

  if (!isEnabled) {
    return (
      <div style={{ ...layoutStyles.shell, textAlign: 'center', paddingTop: '120px' }}>
        <h2 style={{ marginBottom: '8px' }}>Tavari Invoices is not activated</h2>
        <p style={{ color: TavariStyles.colors.gray600 }}>
          Enable this module from the dashboard marketplace to send and manage invoices.
        </p>
      </div>
    );
  }

  return (
    <div style={layoutStyles.shell}>
      <TavariModuleHeader
        title="Tavari Invoices"
        description="Send invoices, collect payments, and build tax summary invoices from paid receipts and bookings."
        actionLabel="+ New Invoice"
        actionIcon={<Plus size={18} />}
        onAction={() => navigate('/dashboard/invoices/new')}
        secondaryActionLabel="Summary Invoice"
        onSecondaryAction={() => navigate('/dashboard/invoices/new?type=summary')}
      />
      <TavariTabSystemComponent
        tabs={INVOICE_TABS}
        mode="route"
        ariaLabel="Tavari Invoices module navigation"
      />
      <Outlet />
    </div>
  );
}

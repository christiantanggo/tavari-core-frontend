import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Tag, Printer, Settings } from 'lucide-react';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import { useBusinessContext } from '../../contexts/BusinessContext';
import * as DealsService from '../../services/Deals/DealsService';
import { gcStyles } from '../GiftCards/giftCardStyles';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard/deals', end: true },
  { id: 'manage', label: 'Deals', icon: Tag, to: '/dashboard/deals/manage' },
  { id: 'print', label: 'Print vouchers', icon: Printer, to: '/dashboard/deals/print' },
  { id: 'settings', label: 'Settings', icon: Settings, to: '/dashboard/deals/settings' },
];

export default function DealsModuleLayout() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { isEnabled, loading } = useModuleEnabled('deals');

  useEffect(() => {
    if (selectedBusinessId && isEnabled) {
      DealsService.bootstrapDeals(selectedBusinessId).catch(() => {});
    }
  }, [selectedBusinessId, isEnabled]);

  useEffect(() => {
    if (!loading && isEnabled === false) {
      navigate('/dashboard/modules/deals', { replace: true });
    }
  }, [loading, isEnabled, navigate]);

  if (loading) {
    return <div style={gcStyles.outer}><div style={gcStyles.empty}>Loading Deals…</div></div>;
  }
  if (!isEnabled) return null;

  return (
    <div style={gcStyles.outer}>
      <TavariModuleHeader
        title="Deals & Coupons"
        description="Website deals, printable coupons, and promotional vouchers (not prepaid gift cards)."
        actionLabel="New deal"
        onAction={() => navigate('/dashboard/deals/manage')}
        secondaryActionLabel="Settings"
        onSecondaryAction={() => navigate('/dashboard/deals/settings')}
      />
      <TavariTabSystemComponent tabs={TABS} mode="route" ariaLabel="Deals module" variant="module" />
      <Outlet />
    </div>
  );
}

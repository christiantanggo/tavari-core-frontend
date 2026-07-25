import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CreditCard,
  PlusCircle,
  Package,
  Percent,
  Palette,
  Settings,
  BarChart3,
} from 'lucide-react';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import { useBusinessContext } from '../../contexts/BusinessContext';
import ModuleCatalogService from '../../services/ModuleCatalogService';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles } from './giftCardStyles';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard/gift-cards', end: true },
  { id: 'cards', label: 'Cards', icon: CreditCard, to: '/dashboard/gift-cards/cards' },
  { id: 'issue', label: 'Sell / Issue', icon: PlusCircle, to: '/dashboard/gift-cards/issue' },
  { id: 'products', label: 'Products', icon: Package, to: '/dashboard/gift-cards/products' },
  { id: 'promotions', label: 'Deals & Promos', icon: Percent, to: '/dashboard/gift-cards/promotions' },
  { id: 'designs', label: 'Designs', icon: Palette, to: '/dashboard/gift-cards/designs' },
  { id: 'reports', label: 'Reports', icon: BarChart3, to: '/dashboard/gift-cards/reports' },
  { id: 'settings', label: 'Settings', icon: Settings, to: '/dashboard/gift-cards/settings' },
];

export default function GiftCardsModuleLayout() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { isEnabled, loading } = useModuleEnabled('gift_cards');

  useEffect(() => {
    if (selectedBusinessId && isEnabled) {
      GiftCardService.bootstrapGiftCards(selectedBusinessId).catch(() => {});
    }
  }, [selectedBusinessId, isEnabled]);

  useEffect(() => {
    if (!loading && isEnabled === false) {
      navigate('/dashboard/modules/gift_cards', { replace: true });
    }
  }, [loading, isEnabled, navigate]);

  if (loading) {
    return <div style={gcStyles.outer}><div style={gcStyles.empty}>Loading Gift Cards…</div></div>;
  }

  if (!isEnabled) {
    return null;
  }

  return (
    <div style={gcStyles.outer}>
      <TavariModuleHeader
        title="Gift Cards"
        description="Sell digital gift cards, redeem balances, and track outstanding liability."
        actionLabel="Issue card"
        onAction={() => navigate('/dashboard/gift-cards/issue')}
        secondaryActionLabel="Settings"
        onSecondaryAction={() => navigate('/dashboard/gift-cards/settings')}
      />
      <TavariTabSystemComponent
        tabs={TABS}
        mode="route"
        ariaLabel="Gift Cards module"
        variant="module"
      />
      <Outlet />
    </div>
  );
}

// Keep catalog tracking when landing
GiftCardsModuleLayout.trackUsage = async (businessId) => {
  try {
    ModuleCatalogService.setBusinessId(businessId);
    await ModuleCatalogService.trackModuleUsage('gift_cards');
  } catch {
    /* non-critical */
  }
};

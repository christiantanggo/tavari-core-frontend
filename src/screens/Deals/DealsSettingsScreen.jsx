import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import * as DealsService from '../../services/Deals/DealsService';
import { gcStyles as s } from '../GiftCards/giftCardStyles';

export default function DealsSettingsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const [settings, setSettings] = useState(null);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    await DealsService.bootstrapDeals(selectedBusinessId);
    setSettings(await DealsService.getDealSettings(selectedBusinessId));
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load settings'));
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      const saved = await DealsService.saveDealSettings(selectedBusinessId, {
        show_on_booking_portal: settings.show_on_booking_portal,
        show_on_customer_portal: settings.show_on_customer_portal,
        show_on_customer_app: settings.show_on_customer_app,
        show_on_website: settings.show_on_website,
      });
      setSettings(saved);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  if (!settings) return <div style={s.empty}>Loading…</div>;

  return (
    <form style={s.panel} onSubmit={save}>
      <h3 style={{ marginTop: 0 }}>Where deals appear</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        <TavariCheckbox
          id="deals-booking"
          checked={!!settings.show_on_booking_portal}
          onChange={(v) => setSettings((st) => ({ ...st, show_on_booking_portal: v }))}
          label="Booking portal"
        />
        <TavariCheckbox
          id="deals-customer"
          checked={!!settings.show_on_customer_portal}
          onChange={(v) => setSettings((st) => ({ ...st, show_on_customer_portal: v }))}
          label="Customer portal"
        />
        <TavariCheckbox
          id="deals-app"
          checked={!!settings.show_on_customer_app}
          onChange={(v) => setSettings((st) => ({ ...st, show_on_customer_app: v }))}
          label="Customer app"
        />
        <TavariCheckbox
          id="deals-web"
          checked={!!settings.show_on_website}
          onChange={(v) => setSettings((st) => ({ ...st, show_on_website: v }))}
          label="Website / embedded deals"
        />
      </div>
      <button type="submit" style={{ ...s.button, marginTop: 16 }}>Save</button>
    </form>
  );
}

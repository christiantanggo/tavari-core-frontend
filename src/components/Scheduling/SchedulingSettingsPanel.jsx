import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import SchedulingSettingsTab from '../Settings/SchedulingSettingsTab';
import ModuleDeactivationPanel from '../Modules/ModuleDeactivationPanel';
import toast from 'react-hot-toast';

const SchedulingSettingsPanel = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [operatingHours, setOperatingHours] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError('');

    try {
      const [{ data: businessData, error: businessError }, { data: settingsData, error: settingsError }] = await Promise.all([
        supabase
          .from('businesses')
          .select('operating_hours')
          .eq('id', businessId)
          .maybeSingle(),
        supabase
          .from('scheduling_settings')
          .select('*')
          .eq('business_id', businessId)
          .maybeSingle()
      ]);

      if (businessError && businessError.code !== 'PGRST116') {
        throw businessError;
      }

      if (settingsError && settingsError.code !== 'PGRST116') {
        throw settingsError;
      }

      setOperatingHours(businessData?.operating_hours || null);
      setSettings(settingsData || null);
    } catch (err) {
      console.error('Failed to load scheduling settings:', err);
      setError(err.message || 'Unable to load scheduling settings');
      toast.error(err.message || 'Unable to load scheduling settings');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!businessId) {
    return (
      <div style={styles.centered}>
        <p style={styles.message}>Select a business to configure scheduling settings.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.centered}>
        <p style={styles.message}>Loading scheduling settings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.centered}>
        <p style={{ ...styles.message, color: '#dc2626' }}>{error}</p>
        <button type="button" style={styles.reloadButton} onClick={loadData}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={styles.kioskCard}>
        <div>
          <h2 style={styles.kioskTitle}>Browser Time Clock Kiosk</h2>
          <p style={styles.kioskText}>
            Open the browser kiosk in a separate window for employees to clock in, clock out, and record breaks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const { origin } = window.location;
            /** Prefer tablet subdomain when this is the default store; otherwise same-origin path. */
            const kioskUrl =
              businessId === 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
                ? `https://legacy-punchclock.tavarios.ca/time-clock-kiosk/${encodeURIComponent(businessId)}`
                : `${origin}/time-clock-kiosk/${encodeURIComponent(businessId)}`;
            const windowFeatures = 'width=1920,height=1080,fullscreen=yes,resizable=yes,scrollbars=no';
            const kioskWindow = window.open(
              kioskUrl,
              `TimeClock-${businessId}`,
              windowFeatures
            );
            if (!kioskWindow) {
              alert('Please enable popups for this site to open the time clock');
            }
          }}
          style={styles.kioskButton}
        >
          Open Time Clock Kiosk
        </button>
      </div>

      <SchedulingSettingsTab
        businessId={businessId}
        operatingHours={operatingHours}
        initialSettings={settings}
        onSettingsUpdated={(updated) => {
          setSettings(updated);
          toast.success('Scheduling settings updated');
        }}
        onShowSuccess={() => toast.success('Scheduling settings saved')}
      />

      <ModuleDeactivationPanel moduleKey="scheduling" />
    </div>
  );
};

const styles = {
  centered: {
    padding: '40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px'
  },
  message: {
    color: '#4b5563',
    fontSize: '16px'
  },
  reloadButton: {
    padding: '10px 18px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#008080',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600
  },
  kioskCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    padding: '20px',
    marginBottom: '24px',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    backgroundColor: '#f9fafb',
    flexWrap: 'wrap'
  },
  kioskTitle: {
    margin: 0,
    marginBottom: '6px',
    fontSize: '20px',
    color: '#111827'
  },
  kioskText: {
    margin: 0,
    color: '#6b7280',
    fontSize: '14px'
  },
  kioskButton: {
    padding: '14px 22px',
    fontSize: '16px',
    fontWeight: 600,
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  }
};

export default SchedulingSettingsPanel;


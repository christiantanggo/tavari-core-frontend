// src/screens/MusicV2/MusicV2Dashboard.jsx
// Music V2 Dashboard with monitoring and status information
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMonitor, FiSettings, FiMusic, FiHardDrive, FiCalendar, FiArrowLeft } from 'react-icons/fi';
import { useBusiness } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import DesktopMusicStatusDashboard from '../../components/Desktop/DesktopMusicStatusDashboard';
import PlaybackMonitor from '../../components/Music/PlaybackMonitor';
import DesktopCacheMonitor from '../../components/Desktop/DesktopCacheMonitor';
import DesktopScheduleMonitor from '../../components/Desktop/DesktopScheduleMonitor';
import InstallationListManager from '../../components/Desktop/InstallationListManager';
import toast from 'react-hot-toast';

const MusicV2Dashboard = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    // Check if running in Electron
    setIsElectron(!!window.electronAPI);
    
    if (business?.id) {
      loadLocation();
    }
  }, [business?.id]);

  const loadLocation = async () => {
    try {
      setLoading(true);
      const { data: locationData, error } = await supabase
        .from('music_v2_locations')
        .select('*')
        .eq('business_id', business.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setLocation(locationData);
    } catch (error) {
      console.error('Error loading location:', error);
      toast.error('Failed to load location');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading dashboard...</div>
      </div>
    );
  }

  if (!location) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ marginBottom: '1rem' }}>Music V2 Location Not Found</h2>
        <p style={{ marginBottom: '1.5rem', color: '#666' }}>
          Music V2 requires a location to be set up first.
        </p>
        <button
          onClick={() => navigate('/dashboard/music/v2/settings')}
          style={{ 
            padding: '0.75rem 1.5rem', 
            backgroundColor: '#20c997',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          Set Up Music V2 Location
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button
          onClick={() => navigate('/dashboard/music/dashboard')}
          style={styles.backButton}
        >
          <FiArrowLeft size={20} />
          Back to Music Dashboard
        </button>
        <div style={styles.headerContent}>
          <FiMonitor size={32} style={styles.headerIcon} />
          <div>
            <h1 style={styles.title}>Music V2 Dashboard</h1>
            <p style={styles.subtitle}>
              Real-time monitoring and status for {business?.name || 'your business'}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/dashboard/music/v2/settings')}
          style={styles.settingsButton}
        >
          <FiSettings size={20} />
          Settings
        </button>
      </div>

      {/* Monitoring Dashboard - Show in Electron or web */}
      {isElectron ? (
        <DesktopMusicStatusDashboard />
      ) : (
        <div style={styles.monitorsGrid}>
          {/* Playback Monitor - Shows current song */}
          <div style={styles.monitorSection}>
            <div style={styles.sectionHeader}>
              <FiMusic size={20} style={styles.sectionIcon} />
              <h3 style={styles.sectionTitle}>Playback Status</h3>
            </div>
            <PlaybackMonitor />
          </div>

          {/* Cache Monitor - Shows what's cached (Electron only) */}
          {isElectron && (
            <div style={styles.monitorSection}>
              <div style={styles.sectionHeader}>
                <FiHardDrive size={20} style={styles.sectionIcon} />
                <h3 style={styles.sectionTitle}>Cache Status</h3>
              </div>
              <DesktopCacheMonitor />
            </div>
          )}

          {/* Schedule Monitor - Shows schedules */}
          <div style={styles.monitorSection}>
            <div style={styles.sectionHeader}>
              <FiCalendar size={20} style={styles.sectionIcon} />
              <h3 style={styles.sectionTitle}>Schedule Status</h3>
            </div>
            <DesktopScheduleMonitor />
          </div>

          {/* Installation Management - Desktop installations */}
          <div style={styles.monitorSection}>
            <InstallationListManager />
          </div>
        </div>
      )}

      {/* Location Info Card */}
      <div style={styles.infoCard}>
        <h3 style={styles.infoCardTitle}>Location Information</h3>
        <div style={styles.infoGrid}>
          <div style={styles.infoItem}>
            <strong>Location ID:</strong> {location.id.substring(0, 8)}...
          </div>
          <div style={styles.infoItem}>
            <strong>Ad Frequency:</strong> {location.default_ad_frequency?.replace('_', ' ') || 'Not set'}
          </div>
          <div style={styles.infoItem}>
            <strong>Music Volume:</strong> {Math.round((location.music_volume || 0.7) * 100)}%
          </div>
          <div style={styles.infoItem}>
            <strong>Ad Volume:</strong> {Math.round((location.ad_volume || 0.8) * 100)}%
          </div>
          <div style={styles.infoItem}>
            <strong>Status:</strong> 
            <span style={{ 
              color: location.is_active ? '#28a745' : '#dc3545',
              marginLeft: '8px'
            }}>
              {location.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '100%',
    padding: '2rem',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '2rem',
    flexWrap: 'wrap',
    gap: '1rem',
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  headerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    flex: 1,
  },
  headerIcon: {
    color: '#20c997',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    margin: '4px 0 0 0',
  },
  settingsButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    backgroundColor: '#20c997',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  monitorsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '20px',
    marginBottom: '2rem',
  },
  monitorSection: {
    display: 'flex',
    flexDirection: 'column',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '15px',
    paddingBottom: '10px',
    borderBottom: '1px solid #e9ecef',
  },
  sectionIcon: {
    color: '#20c997',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  infoCard: {
    backgroundColor: '#f8f9fa',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    padding: '20px',
    marginTop: '2rem',
  },
  infoCardTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 15px 0',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '15px',
  },
  infoItem: {
    fontSize: '14px',
    color: '#333',
  },
};

export default MusicV2Dashboard;


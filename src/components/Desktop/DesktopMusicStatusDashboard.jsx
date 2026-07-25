// src/components/Desktop/DesktopMusicStatusDashboard.jsx
// Unified monitoring dashboard combining playback, cache, and schedule status
import React from 'react';
import { FiMonitor, FiMusic, FiHardDrive, FiCalendar } from 'react-icons/fi';
import PlaybackMonitor from '../Music/PlaybackMonitor';
import DesktopCacheMonitor from './DesktopCacheMonitor';
import DesktopScheduleMonitor from './DesktopScheduleMonitor';

const DesktopMusicStatusDashboard = () => {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiMonitor size={28} style={styles.headerIcon} />
        <div>
          <h2 style={styles.title}>Music System Status</h2>
          <p style={styles.subtitle}>Real-time monitoring of playback, cache, and schedules</p>
        </div>
      </div>

      <div style={styles.monitorsGrid}>
        {/* Playback Monitor - Shows current song */}
        <div style={styles.monitorSection}>
          <div style={styles.sectionHeader}>
            <FiMusic size={20} style={styles.sectionIcon} />
            <h3 style={styles.sectionTitle}>Playback Status</h3>
          </div>
          <PlaybackMonitor />
        </div>

        {/* Cache Monitor - Shows what's cached */}
        <div style={styles.monitorSection}>
          <div style={styles.sectionHeader}>
            <FiHardDrive size={20} style={styles.sectionIcon} />
            <h3 style={styles.sectionTitle}>Cache Status</h3>
          </div>
          <DesktopCacheMonitor />
        </div>

        {/* Schedule Monitor - Shows schedules */}
        <div style={styles.monitorSection}>
          <div style={styles.sectionHeader}>
            <FiCalendar size={20} style={styles.sectionIcon} />
            <h3 style={styles.sectionTitle}>Schedule Status</h3>
          </div>
          <DesktopScheduleMonitor />
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '100%',
    marginBottom: '30px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    marginBottom: '25px',
    paddingBottom: '15px',
    borderBottom: '2px solid #e9ecef',
  },
  headerIcon: {
    color: '#20c997',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    margin: '4px 0 0 0',
  },
  monitorsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '20px',
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
};

export default DesktopMusicStatusDashboard;




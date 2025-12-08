// src/components/Music/SystemMonitor.jsx
import React, { useState, useEffect } from 'react';
import { FiWifi, FiHardDrive, FiCpu, FiAlertTriangle, FiCheckCircle, FiRefreshCw } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';

const SystemMonitor = () => {
  const { business } = useBusiness();
  const [systemStatus, setSystemStatus] = useState({
    online: true,
    lastHeartbeat: new Date(),
    uptime: 0,
    audioStatus: 'ready',
    dbConnection: 'connected',
    storageAccess: 'available',
    errorCount: 0,
    lastRestart: null
  });
  
  const [systemLogs, setSystemLogs] = useState([]);
  const [autoRestartEnabled, setAutoRestartEnabled] = useState(true);
  const [healthCheckInterval, setHealthCheckInterval] = useState(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartCountdown, setRestartCountdown] = useState(0);

  // System health monitoring
  useEffect(() => {
    if (business?.id) {
      startHealthMonitoring();
      loadSystemLogs();
      
      // Set up auto-restart monitoring
      setupAutoRestart();
    }

    return () => {
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
      }
    };
  }, [business?.id]);

  // Countdown effect for restart
  useEffect(() => {
    if (restartCountdown > 0) {
      const timer = setTimeout(() => {
        setRestartCountdown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (restartCountdown === 0 && isRestarting) {
      // Actually restart now
      window.location.reload();
    }
  }, [restartCountdown, isRestarting]);

  const startHealthMonitoring = () => {
    // Monitor system health every 30 seconds
    const interval = setInterval(async () => {
      await performHealthCheck();
    }, 30000);
    
    setHealthCheckInterval(interval);
    
    // Initial health check
    performHealthCheck();
  };

  const performHealthCheck = async () => {
    try {
      const startTime = Date.now();
      
      // Test database connection
      const { data: dbTest, error: dbError } = await supabase
        .from('music_settings')
        .select('business_id')
        .eq('business_id', business.id)
        .limit(1);
      
      const dbStatus = dbError ? 'error' : 'connected';
      const responseTime = Date.now() - startTime;
      
      // Test storage access
      const { data: storageTest, error: storageError } = await supabase.storage
        .from('music-files')
        .list('', { limit: 1 });
      
      const storageStatus = storageError ? 'error' : 'available';
      
      // Check browser audio capabilities (without creating AudioContext to avoid errors)
      // AudioContext creation requires user interaction, so we skip this check
      const audioStatus = 'ready'; // Assume ready - actual audio will work when user interacts
      
      // Update system status
      setSystemStatus(prev => ({
        ...prev,
        online: true,
        lastHeartbeat: new Date(),
        dbConnection: dbStatus,
        storageAccess: storageStatus,
        audioStatus: audioStatus,
        uptime: prev.uptime + 30, // Add 30 seconds
        errorCount: (dbStatus === 'error' || storageStatus === 'error' || audioStatus === 'error') 
          ? prev.errorCount + 1 : Math.max(0, prev.errorCount - 1)
      }));
      
      // Log system status
      await logSystemEvent({
        type: 'health_check',
        status: 'success',
        details: {
          db_status: dbStatus,
          storage_status: storageStatus,
          audio_status: audioStatus,
          response_time: responseTime
        }
      });
      
      // Check if auto-restart is needed
      if (autoRestartEnabled && (dbStatus === 'error' || storageStatus === 'error' || audioStatus === 'error')) {
        const errorThreshold = 3; // Restart after 3 consecutive errors
        if (systemStatus.errorCount >= errorThreshold) {
          await triggerAutoRestart('Multiple system errors detected');
        }
      }
      
    } catch (error) {
      console.error('Health check failed:', error);
      
      setSystemStatus(prev => ({
        ...prev,
        online: false,
        errorCount: prev.errorCount + 1
      }));
      
      await logSystemEvent({
        type: 'health_check',
        status: 'error',
        details: { error: error.message }
      });
    }
  };

  const setupAutoRestart = () => {
    // Listen for page visibility changes (browser tab switching)
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for window focus/blur (app switching)
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('blur', handleWindowBlur);
    
    // Listen for network changes
    window.addEventListener('online', handleNetworkOnline);
    window.addEventListener('offline', handleNetworkOffline);
    
    // Register service worker for background reliability (if supported)
    if ('serviceWorker' in navigator) {
      registerServiceWorker();
    }
    
    // Log startup
    logSystemEvent({
      type: 'startup',
      status: 'success',
      details: { 
        user_agent: navigator.userAgent,
        timestamp: new Date().toISOString()
      }
    });
  };

  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      await logSystemEvent({
        type: 'tab_focus',
        status: 'success',
        details: { action: 'tab_became_visible' }
      });
      
      // Resume health monitoring
      if (!healthCheckInterval) {
        startHealthMonitoring();
      }
    } else {
      await logSystemEvent({
        type: 'tab_blur',
        status: 'info',
        details: { action: 'tab_became_hidden' }
      });
    }
  };

  const handleWindowFocus = async () => {
    await logSystemEvent({
      type: 'window_focus',
      status: 'success',
      details: { action: 'window_gained_focus' }
    });
  };

  const handleWindowBlur = async () => {
    await logSystemEvent({
      type: 'window_blur', 
      status: 'info',
      details: { action: 'window_lost_focus' }
    });
  };

  const handleNetworkOnline = async () => {
    await logSystemEvent({
      type: 'network_change',
      status: 'success',
      details: { action: 'network_online' }
    });
    
    // Restart health monitoring
    startHealthMonitoring();
  };

  const handleNetworkOffline = async () => {
    await logSystemEvent({
      type: 'network_change',
      status: 'warning',
      details: { action: 'network_offline' }
    });
  };

  const registerServiceWorker = async () => {
    try {
      const isLocalhost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
      const isSecure = window.isSecureContext || isLocalhost;
      const isHMR = import.meta && import.meta.hot; // Vite dev flag

      // Only register when secure, not in HMR, and in production
      if (!('serviceWorker' in navigator) || !isSecure || isHMR) {
        console.debug('[SW] Skipping service worker registration (dev/HMR or not secure).');
        return;
      }

      // Register a real service worker file located in /public/sw.js
      const registration = await navigator.serviceWorker.register('/sw.js', {
        type: 'module',
      });
      console.log('[SW] Registered successfully:', registration);

      await logSystemEvent({
        type: 'service_worker',
        status: 'success',
        details: { action: 'registered' },
      });
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  };

  const triggerAutoRestart = async (reason) => {
    try {
      await logSystemEvent({
        type: 'auto_restart',
        status: 'warning',
        details: { reason, timestamp: new Date().toISOString() }
      });
      
      setSystemStatus(prev => ({
        ...prev,
        lastRestart: new Date(),
        errorCount: 0,
        uptime: 0
      }));
      
      // Set restart flag for audio player to detect
      localStorage.setItem('tavari_music_restarted', 'true');
      
      // Start countdown for restart
      setIsRestarting(true);
      setRestartCountdown(5); // 5 second countdown
      
    } catch (error) {
      console.error('Auto-restart failed:', error);
    }
  };

  const manualRestart = async () => {
    if (!confirm('Are you sure you want to restart the music system? Music will automatically resume playing.')) {
      return;
    }
    
    await triggerAutoRestart('Manual restart requested');
  };

  const logSystemEvent = async (event) => {
    try {
      const { error } = await supabase
        .from('music_system_logs')
        .insert({
          business_id: business.id,
          log_type: event.type,
          message: `${event.type}: ${event.status}`,
          details: event.details,
          logged_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
      // Update local logs with unique IDs
      setSystemLogs(prev => [
        {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Unique ID
          log_type: event.type,
          message: `${event.type}: ${event.status}`,
          details: event.details,
          logged_at: new Date().toISOString()
        },
        ...prev.slice(0, 49) // Keep last 50 logs
      ]);
      
    } catch (error) {
      console.error('Failed to log system event:', error);
    }
  };

  const loadSystemLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('music_system_logs')
        .select('*')
        .eq('business_id', business.id)
        .order('logged_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      setSystemLogs(data || []);
    } catch (error) {
      console.error('Error loading system logs:', error);
    }
  };

  const clearLogs = async () => {
    if (!confirm('Are you sure you want to clear all system logs?')) return;
    
    try {
      const { error } = await supabase
        .from('music_system_logs')
        .delete()
        .eq('business_id', business.id);
      
      if (error) throw error;
      setSystemLogs([]);
    } catch (error) {
      console.error('Error clearing logs:', error);
    }
  };

  const formatUptime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'connected':
      case 'available':
      case 'ready':
      case 'success':
        return '#28a745';
      case 'warning':
        return '#ffc107';
      case 'error':
        return '#dc3545';
      default:
        return '#6c757d';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'connected':
      case 'available':
      case 'ready':
      case 'success':
        return <FiCheckCircle />;
      case 'warning':
        return <FiAlertTriangle />;
      case 'error':
        return <FiAlertTriangle />;
      default:
        return <FiCpu />;
    }
  };

  return (
    <div style={styles.container}>
      {/* Restart Countdown Overlay */}
      {isRestarting && (
        <div style={styles.restartOverlay}>
          <div style={styles.restartModal}>
            <FiRefreshCw size={48} style={styles.restartIcon} />
            <h3 style={styles.restartTitle}>System Restarting</h3>
            <p style={styles.restartMessage}>
              Music will automatically resume playing...
            </p>
            <div style={styles.countdown}>
              {restartCountdown}
            </div>
          </div>
        </div>
      )}

      <div style={styles.header}>
        <h3 style={styles.title}>System Monitor</h3>
        <div style={styles.headerActions}>
          <button
            style={styles.restartButton}
            onClick={manualRestart}
            title="Manual Restart"
            disabled={isRestarting}
          >
            <FiRefreshCw size={16} />
            Restart
          </button>
        </div>
      </div>

      {/* System Status */}
      <div style={styles.statusGrid}>
        <div style={styles.statusCard}>
          <div style={styles.statusHeader}>
            <FiWifi size={20} style={{ color: getStatusColor(systemStatus.dbConnection) }} />
            <span>Database</span>
          </div>
          <div style={styles.statusValue}>
            {getStatusIcon(systemStatus.dbConnection)}
            {systemStatus.dbConnection}
          </div>
        </div>

        <div style={styles.statusCard}>
          <div style={styles.statusHeader}>
            <FiHardDrive size={20} style={{ color: getStatusColor(systemStatus.storageAccess) }} />
            <span>Storage</span>
          </div>
          <div style={styles.statusValue}>
            {getStatusIcon(systemStatus.storageAccess)}
            {systemStatus.storageAccess}
          </div>
        </div>

        <div style={styles.statusCard}>
          <div style={styles.statusHeader}>
            <FiCpu size={20} style={{ color: getStatusColor(systemStatus.audioStatus) }} />
            <span>Audio</span>
          </div>
          <div style={styles.statusValue}>
            {getStatusIcon(systemStatus.audioStatus)}
            {systemStatus.audioStatus}
          </div>
        </div>

        <div style={styles.statusCard}>
          <div style={styles.statusHeader}>
            <FiCheckCircle size={20} style={{ color: systemStatus.online ? '#28a745' : '#dc3545' }} />
            <span>Uptime</span>
          </div>
          <div style={styles.statusValue}>
            {formatUptime(systemStatus.uptime)}
          </div>
        </div>
      </div>

      {/* Auto-restart Settings */}
      <div style={styles.settingsSection}>
        <h4 style={styles.sectionTitle}>Reliability Settings</h4>
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>
            <input
              type="checkbox"
              checked={autoRestartEnabled}
              onChange={(e) => setAutoRestartEnabled(e.target.checked)}
            />
            <span>Auto-restart on errors</span>
          </label>
          <p style={styles.settingDescription}>
            Automatically restart the system when critical errors are detected. Music will resume automatically.
          </p>
        </div>
      </div>

      {/* System Logs */}
      <div style={styles.logsSection}>
        <div style={styles.logsHeader}>
          <h4 style={styles.sectionTitle}>System Logs</h4>
          <button style={styles.clearButton} onClick={clearLogs}>
            Clear Logs
          </button>
        </div>
        
        <div style={styles.logsList}>
          {systemLogs.length === 0 ? (
            <div style={styles.emptyLogs}>No system logs available</div>
          ) : (
            systemLogs.slice(0, 10).map((log, index) => (
              <div key={log.id || `log-${index}-${log.logged_at}`} style={styles.logItem}>
                <div style={styles.logTimestamp}>
                  {new Date(log.logged_at).toLocaleString()}
                </div>
                <div style={styles.logMessage}>
                  <span style={{
                    ...styles.logType,
                    color: getStatusColor(log.log_type)
                  }}>
                    {log.log_type}
                  </span>
                  {log.message}
                </div>
                {log.details && (
                  <div style={styles.logDetails}>
                    {JSON.stringify(log.details, null, 2)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Last Update */}
      <div style={styles.footer}>
        <small style={styles.lastUpdate}>
          Last heartbeat: {systemStatus.lastHeartbeat.toLocaleTimeString()}
          {systemStatus.errorCount > 0 && (
            <span style={{ color: '#dc3545', marginLeft: '10px' }}>
              {systemStatus.errorCount} error(s)
            </span>
          )}
        </small>
      </div>
    </div>
  );
};

const styles = {
  container: {
    backgroundColor: '#f8f9fa',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    padding: '20px',
    margin: '20px 0',
    position: 'relative',
  },
  restartOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  restartModal: {
    backgroundColor: '#fff',
    padding: '40px',
    borderRadius: '12px',
    textAlign: 'center',
    maxWidth: '400px',
    margin: '20px',
  },
  restartIcon: {
    color: '#20c997',
    marginBottom: '20px',
    animation: 'spin 2s linear infinite',
  },
  restartTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '10px',
  },
  restartMessage: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '20px',
  },
  countdown: {
    fontSize: '48px',
    fontWeight: 'bold',
    color: '#20c997',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0',
  },
  headerActions: {
    display: 'flex',
    gap: '10px',
  },
  restartButton: {
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    marginBottom: '25px',
  },
  statusCard: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
  },
  statusHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#666',
  },
  statusValue: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  settingsSection: {
    marginBottom: '25px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 15px 0',
  },
  settingItem: {
    marginBottom: '15px',
  },
  settingLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  settingDescription: {
    fontSize: '12px',
    color: '#666',
    margin: '5px 0 0 24px',
  },
  logsSection: {
    marginBottom: '20px',
  },
  logsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
  },
  clearButton: {
    backgroundColor: '#6c757d',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  logsList: {
    maxHeight: '200px',
    overflowY: 'auto',
    backgroundColor: '#fff',
    border: '1px solid #e9ecef',
    borderRadius: '4px',
  },
  emptyLogs: {
    padding: '20px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px',
  },
  logItem: {
    padding: '10px',
    borderBottom: '1px solid #f8f9fa',
    fontSize: '12px',
  },
  logTimestamp: {
    color: '#999',
    marginBottom: '4px',
  },
  logMessage: {
    color: '#333',
    marginBottom: '4px',
  },
  logType: {
    fontWeight: 'bold',
    marginRight: '8px',
    textTransform: 'uppercase',
  },
  logDetails: {
    backgroundColor: '#f8f9fa',
    padding: '5px',
    borderRadius: '3px',
    fontFamily: 'monospace',
    fontSize: '10px',
    color: '#666',
    whiteSpace: 'pre-wrap',
  },
  footer: {
    textAlign: 'center',
    paddingTop: '15px',
    borderTop: '1px solid #e9ecef',
  },
  lastUpdate: {
    color: '#666',
  },
};

// Add CSS for spinner animation if not already present
if (!document.querySelector('#system-monitor-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'system-monitor-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default SystemMonitor;
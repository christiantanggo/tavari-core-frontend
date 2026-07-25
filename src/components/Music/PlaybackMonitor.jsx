// src/components/Music/PlaybackMonitor.jsx
// Real-time playback monitoring dashboard
import React, { useState, useEffect } from 'react';
import { FiMusic, FiPlay, FiPause, FiSkipForward, FiCheckCircle, FiXCircle, FiClock, FiWifi, FiWifiOff, FiMonitor, FiGlobe } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { playbackTrackingService } from '../../services/PlaybackTrackingService';
import { globalMusicService } from '../../services/GlobalMusicService';

const PlaybackMonitor = () => {
  const { business } = useBusiness();
  const [playbackState, setPlaybackState] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);
  const [queueStatus, setQueueStatus] = useState({ queued: 0, active: 0, online: true });
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState('all'); // 'all', 'browser', or installation_id
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState({
    totalPlays: 0,
    completedPlays: 0,
    skippedPlays: 0,
    totalDuration: 0
  });

  const loadDevices = async () => {
    console.log('🔍 [PlaybackMonitor] loadDevices called', { businessId: business?.id });
    if (!business?.id) {
      console.log('⚠️ [PlaybackMonitor] No business ID, skipping device load');
      return;
    }

    try {
      console.log('📡 [PlaybackMonitor] Fetching installations from database...');
      // Get all installations for this business
      const { data: installations, error } = await supabase
        .from('music_installations')
        .select('id, device_name, device_fingerprint, status, last_seen')
        .eq('business_id', business.id)
        .eq('status', 'active')
        .order('device_name', { ascending: true });

      console.log('📦 [PlaybackMonitor] Installations query result:', { 
        installations, 
        error,
        count: installations?.length || 0 
      });

      if (error) {
        console.error('❌ [PlaybackMonitor] Error loading installations:', error);
      }

      // Build device list: browser + installations
      const deviceList = [
        { id: 'all', name: 'All Devices', type: 'all', icon: FiMusic },
        { id: 'browser', name: 'Browser Music Player', type: 'browser', icon: FiGlobe }
      ];

      if (installations && installations.length > 0) {
        console.log(`✅ [PlaybackMonitor] Found ${installations.length} installations, adding to device list`);
        installations.forEach(inst => {
          const deviceEntry = {
            id: inst.id,
            name: inst.device_name || `Desktop Kiosk (${inst.id.substring(0, 8)})`,
            type: 'desktop',
            icon: FiMonitor,
            lastSeen: inst.last_seen
          };
          console.log('  ➕ Adding device:', deviceEntry);
          deviceList.push(deviceEntry);
        });
      } else {
        console.log('ℹ️ [PlaybackMonitor] No installations found, only showing browser option');
      }

      console.log('📋 [PlaybackMonitor] Final device list:', deviceList);
      console.log('📋 [PlaybackMonitor] Setting devices state with', deviceList.length, 'devices');
      setDevices(deviceList);
      console.log('✅ [PlaybackMonitor] Devices state updated');
      
      // Set default to 'all' if not set
      if (selectedDevice === 'all' && deviceList.length > 0) {
        console.log('✅ [PlaybackMonitor] Default device is already "all"');
      }
    } catch (error) {
      console.error('❌ [PlaybackMonitor] Error loading devices:', error);
    }
  };

  useEffect(() => {
    if (!business?.id) return;

    // Load available devices first
    loadDevices();

    // Subscribe to music service state changes
    const unsubscribe = globalMusicService.addListener((state) => {
      setPlaybackState(state);
    });

    // Load recent logs
    loadRecentLogs();
    loadStats();

    // Update queue status
    updateQueueStatus();

    // Set up interval to refresh data
    const interval = setInterval(() => {
      loadRecentLogs();
      loadStats();
      updateQueueStatus();
    }, 10000); // Every 10 seconds

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [business?.id, selectedDevice]);


  const updateQueueStatus = () => {
    const status = playbackTrackingService.getQueueStatus();
    setQueueStatus(status);
  };

  const loadRecentLogs = async () => {
    console.log('🔍 [PlaybackMonitor] loadRecentLogs called', { 
      businessId: business?.id, 
      selectedDevice 
    });
    
    if (!business?.id) {
      console.log('⚠️ [PlaybackMonitor] No business ID, skipping log load');
      return;
    }

    try {
      // Build query with device filter
      let query = supabase
        .from('music_v2_playback_logs')
        .select('*')
        .eq('business_id', business.id)
        .eq('log_type', 'song');

      console.log('🔍 [PlaybackMonitor] Base query built, selectedDevice:', selectedDevice);

      // Filter by device if not 'all'
      if (selectedDevice === 'browser') {
        console.log('🌐 [PlaybackMonitor] Filtering for browser (installation_id IS NULL)');
        // Browser players have null installation_id
        query = query.is('installation_id', null);
      } else if (selectedDevice !== 'all') {
        console.log('🖥️ [PlaybackMonitor] Filtering for installation:', selectedDevice);
        // Specific installation
        query = query.eq('installation_id', selectedDevice);
      } else {
        console.log('🌍 [PlaybackMonitor] Showing all devices (no filter)');
      }
      // If 'all', no additional filter

      console.log('📡 [PlaybackMonitor] Executing query...');
      const { data: logs, error: logsError } = await query
        .order('start_time', { ascending: false })
        .limit(20);

      console.log('📦 [PlaybackMonitor] Query result:', { 
        logsCount: logs?.length || 0, 
        error: logsError,
        sampleLogs: logs?.slice(0, 3) 
      });

      if (logsError) throw logsError;

      if (!logs || logs.length === 0) {
        setRecentLogs([]);
        setLoading(false);
        return;
      }

      // Get unique track IDs
      const trackIds = [...new Set(logs.map(log => log.track_id).filter(Boolean))];
      
      // Fetch track details if we have track IDs
      let tracksMap = {};
      if (trackIds.length > 0) {
        const { data: tracks, error: tracksError } = await supabase
          .from('music_tracks')
          .select('id, title, artist')
          .in('id', trackIds);

        if (!tracksError && tracks) {
          tracksMap = tracks.reduce((acc, track) => {
            acc[track.id] = track;
            return acc;
          }, {});
        }
      }

      // Combine logs with track data
      const logsWithTracks = logs.map(log => ({
        ...log,
        music_tracks: log.track_id ? tracksMap[log.track_id] || null : null
      }));

      console.log('✅ [PlaybackMonitor] Setting recent logs:', logsWithTracks.length, 'logs');
      setRecentLogs(logsWithTracks);
      setLoading(false);
      console.log('✅ [PlaybackMonitor] Recent logs loaded and state updated');
    } catch (error) {
      console.error('❌ [PlaybackMonitor] Error loading recent logs:', error);
      setLoading(false);
    }
  };

  const loadStats = async () => {
    console.log('🔍 [PlaybackMonitor] loadStats called', { 
      businessId: business?.id, 
      selectedDevice 
    });
    
    if (!business?.id) return;

    try {
      // Get stats for last 24 hours
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      let query = supabase
        .from('music_v2_playback_logs')
        .select('completed, skipped, duration_played')
        .eq('business_id', business.id)
        .eq('log_type', 'song')
        .gte('start_time', yesterday.toISOString());

      console.log('🔍 [PlaybackMonitor] Stats query - selectedDevice:', selectedDevice);

      // Filter by device if not 'all'
      if (selectedDevice === 'browser') {
        console.log('🌐 [PlaybackMonitor] Stats: Filtering for browser');
        query = query.is('installation_id', null);
      } else if (selectedDevice !== 'all') {
        console.log('🖥️ [PlaybackMonitor] Stats: Filtering for installation:', selectedDevice);
        query = query.eq('installation_id', selectedDevice);
      } else {
        console.log('🌍 [PlaybackMonitor] Stats: Showing all devices');
      }

      console.log('📡 [PlaybackMonitor] Executing stats query...');
      const { data, error } = await query;
      
      console.log('📊 [PlaybackMonitor] Stats query result:', { 
        dataCount: data?.length || 0, 
        error 
      });

      if (error) throw error;

      const stats = {
        totalPlays: data?.length || 0,
        completedPlays: data?.filter(log => log.completed && !log.skipped).length || 0,
        skippedPlays: data?.filter(log => log.skipped).length || 0,
        totalDuration: data?.reduce((sum, log) => sum + (log.duration_played || 0), 0) || 0
      };

      console.log('📊 [PlaybackMonitor] Calculated stats:', stats);
      setStats(stats);
      console.log('✅ [PlaybackMonitor] Stats state updated');
    } catch (error) {
      console.error('❌ [PlaybackMonitor] Error loading stats:', error);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const selectedDeviceInfo = devices.find(d => d.id === selectedDevice);
  const DeviceIcon = selectedDeviceInfo?.icon || FiMusic;

  console.log('🎨 [PlaybackMonitor] Rendering component', {
    devicesCount: devices.length,
    selectedDevice,
    devices: devices.map(d => ({ id: d.id, name: d.name })),
    selectedDeviceInfo
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiMusic size={24} style={styles.headerIcon} />
        <h3 style={styles.title}>Playback Monitor</h3>
        <div style={styles.headerRight}>
          {/* Device Selector */}
          {devices.length > 0 ? (
            <div style={styles.deviceSelectorWrapper}>
              <select
                value={selectedDevice}
                onChange={(e) => {
                  const newValue = e.target.value;
                  console.log('🔄 [PlaybackMonitor] Device dropdown changed!', {
                    oldValue: selectedDevice,
                    newValue: newValue,
                    event: e,
                    targetValue: e.target.value
                  });
                  setSelectedDevice(newValue);
                  console.log('✅ [PlaybackMonitor] selectedDevice state updated to:', newValue);
                }}
                style={styles.deviceSelector}
                onFocus={() => console.log('👆 [PlaybackMonitor] Dropdown focused')}
                onBlur={() => console.log('👋 [PlaybackMonitor] Dropdown blurred')}
              >
                {devices.map(device => {
                  const isSelected = device.id === selectedDevice;
                  console.log(`  📝 Rendering option: ${device.id} = ${device.name} (selected: ${isSelected})`);
                  return (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: '#999' }}>
              Loading devices... (devices.length = {devices.length})
            </div>
          )}
          <div style={styles.statusIndicator}>
            {queueStatus.online ? (
              <FiWifi size={16} color="#28a745" title="Online" />
            ) : (
              <FiWifiOff size={16} color="#dc3545" title="Offline" />
            )}
          </div>
        </div>
      </div>

      {/* Current Playback - Only show if viewing browser or all */}
      {playbackState && (selectedDevice === 'browser' || selectedDevice === 'all') && (
        <div style={styles.currentPlayback}>
          <h4 style={styles.sectionTitle}>
            Now Playing {selectedDevice === 'all' && '(This Browser)'}
          </h4>
          {playbackState.currentTrack ? (
            <div style={styles.nowPlaying}>
              <div style={styles.trackInfo}>
                <div style={styles.trackTitle}>
                  {playbackState.isPlaying ? (
                    <FiPlay size={16} color="#28a745" style={styles.playIcon} />
                  ) : (
                    <FiPause size={16} color="#ffc107" style={styles.playIcon} />
                  )}
                  <strong>{playbackState.currentTrack.title || 'Unknown'}</strong>
                </div>
                <div style={styles.trackArtist}>
                  {playbackState.currentTrack.artist || 'Unknown Artist'}
                </div>
                <div style={styles.trackProgress}>
                  {formatDuration(playbackState.currentTime)} / {formatDuration(playbackState.duration)}
                </div>
              </div>
            </div>
          ) : (
            <div style={styles.noTrack}>No track playing</div>
          )}
        </div>
      )}

      {/* Statistics */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Total Plays (24h)</div>
          <div style={styles.statValue}>{stats.totalPlays}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Completed</div>
          <div style={styles.statValue}>{stats.completedPlays}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Skipped</div>
          <div style={styles.statValue}>{stats.skippedPlays}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Total Duration</div>
          <div style={styles.statValue}>{formatDuration(stats.totalDuration)}</div>
        </div>
      </div>

      {/* Queue Status */}
      <div style={styles.queueStatus}>
        <div style={styles.queueItem}>
          <span>Queued Logs:</span>
          <strong>{queueStatus.queued}</strong>
        </div>
        <div style={styles.queueItem}>
          <span>Active Tracks:</span>
          <strong>{queueStatus.active}</strong>
        </div>
        <div style={styles.queueItem}>
          <span>Status:</span>
          <strong style={{ color: queueStatus.online ? '#28a745' : '#dc3545' }}>
            {queueStatus.online ? 'Online' : 'Offline'}
          </strong>
        </div>
      </div>

      {/* Recent Playback History */}
      <div style={styles.historySection}>
        <h4 style={styles.sectionTitle}>Recent Playback History</h4>
        {loading ? (
          <div style={styles.loading}>Loading...</div>
        ) : recentLogs.length === 0 ? (
          <div style={styles.noData}>No playback history yet</div>
        ) : (
          <div style={styles.logsList}>
            {recentLogs.map((log) => (
              <div key={log.id} style={styles.logItem}>
                <div style={styles.logIcon}>
                  {log.completed && !log.skipped ? (
                    <FiCheckCircle size={16} color="#28a745" />
                  ) : log.skipped ? (
                    <FiSkipForward size={16} color="#ffc107" />
                  ) : (
                    <FiClock size={16} color="#6c757d" />
                  )}
                </div>
                <div style={styles.logContent}>
                  <div style={styles.logTrack}>
                    {log.music_tracks?.title || 'Unknown Track'}
                    {log.music_tracks?.artist && (
                      <span style={styles.logArtist}> - {log.music_tracks.artist}</span>
                    )}
                  </div>
                  <div style={styles.logMeta}>
                    {formatTime(log.start_time)}
                    {log.duration_played && (
                      <span> • {formatDuration(log.duration_played)}</span>
                    )}
                    {log.skipped && <span style={styles.skippedBadge}> • Skipped</span>}
                    {log.completed && !log.skipped && (
                      <span style={styles.completedBadge}> • Completed</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },
  headerIcon: {
    color: '#20c997',
  },
  title: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
    flex: 1,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  deviceSelectorWrapper: {
    position: 'relative',
    zIndex: 1000,
  },
  deviceSelector: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
    backgroundColor: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
    minWidth: '200px',
    position: 'relative',
    zIndex: 1000,
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
  },
  currentPlayback: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '20px',
    border: '1px solid #e9ecef',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 15px 0',
  },
  nowPlaying: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '5px',
  },
  playIcon: {
    flexShrink: 0,
  },
  trackArtist: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '5px',
  },
  trackProgress: {
    fontSize: '13px',
    color: '#999',
  },
  noTrack: {
    color: '#999',
    fontStyle: 'italic',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
  },
  statCard: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
    textAlign: 'center',
  },
  statLabel: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '8px',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
  },
  queueStatus: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '20px',
    border: '1px solid #e9ecef',
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap',
  },
  queueItem: {
    fontSize: '14px',
    color: '#333',
    display: 'flex',
    gap: '8px',
  },
  historySection: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
  },
  loading: {
    textAlign: 'center',
    color: '#999',
    padding: '20px',
  },
  noData: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
    padding: '20px',
  },
  logsList: {
    maxHeight: '400px',
    overflowY: 'auto',
  },
  logItem: {
    display: 'flex',
    gap: '12px',
    padding: '10px',
    borderBottom: '1px solid #f0f0f0',
  },
  logIcon: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
  },
  logContent: {
    flex: 1,
  },
  logTrack: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
    marginBottom: '4px',
  },
  logArtist: {
    fontWeight: 'normal',
    color: '#666',
  },
  logMeta: {
    fontSize: '13px',
    color: '#999',
  },
  skippedBadge: {
    color: '#ffc107',
    fontWeight: '500',
  },
  completedBadge: {
    color: '#28a745',
    fontWeight: '500',
  },
};

export default PlaybackMonitor;


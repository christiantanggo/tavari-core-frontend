// src/components/Desktop/DesktopCacheMonitor.jsx
// Real-time cache monitoring for desktop app
import React, { useState, useEffect } from 'react';
import { FiHardDrive, FiDownload, FiTrash2, FiRefreshCw, FiCheckCircle, FiAlertTriangle, FiXCircle } from 'react-icons/fi';
import { desktopMusicService } from '../../services/DesktopMusicService';

const DesktopCacheMonitor = () => {
  const [cacheStats, setCacheStats] = useState(null);
  const [cachedTracks, setCachedTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!window.electronAPI) {
      setError('Not running in Electron');
      setLoading(false);
      return;
    }

    loadCacheStats();
    const interval = setInterval(loadCacheStats, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, []);

  const loadCacheStats = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get cache statistics from DesktopMusicService
      const stats = await desktopMusicService.getCacheStats();
      
      if (stats) {
        setCacheStats(stats);
        
        // Get list of cached tracks (if available)
        if (stats.cachedTracks && Array.isArray(stats.cachedTracks)) {
          setCachedTracks(stats.cachedTracks);
        }
      } else {
        setCacheStats({
          totalTracks: 0,
          totalSizeMB: 0,
          hitRate: 0,
          oldestTrack: null,
          newestTrack: null
        });
        setCachedTracks([]);
      }
    } catch (err) {
      console.error('Error loading cache stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm('Are you sure you want to clear all cached tracks? This will free up disk space but tracks will need to be re-downloaded.')) {
      return;
    }

    try {
      await desktopMusicService.clearCache();
      await loadCacheStats();
      alert('Cache cleared successfully');
    } catch (err) {
      alert('Failed to clear cache: ' + err.message);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getCacheHealthColor = (hitRate) => {
    if (hitRate >= 80) return '#28a745';
    if (hitRate >= 50) return '#ffc107';
    return '#dc3545';
  };

  if (!window.electronAPI) {
    return (
      <div style={styles.container}>
        <div style={styles.notAvailable}>
          <FiXCircle size={24} />
          <p>Cache monitoring only available in desktop app</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiHardDrive size={24} style={styles.headerIcon} />
        <h3 style={styles.title}>Cache Monitor</h3>
        <div style={styles.headerActions}>
          <button style={styles.refreshButton} onClick={loadCacheStats} title="Refresh cache stats">
            <FiRefreshCw size={16} />
          </button>
          <button style={styles.clearButton} onClick={handleClearCache} title="Clear cache">
            <FiTrash2 size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div style={styles.errorSection}>
          <FiAlertTriangle size={16} />
          <span>Error: {error}</span>
        </div>
      )}

      {loading && !cacheStats ? (
        <div style={styles.loading}>Loading cache statistics...</div>
      ) : (
        <>
          {/* Cache Statistics */}
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Cached Tracks</div>
              <div style={styles.statValue}>
                {cacheStats?.totalTracks || 0}
              </div>
              <div style={styles.statSubtext}>
                {cacheStats?.totalTracks > 0 ? (
                  <FiCheckCircle size={14} color="#28a745" />
                ) : (
                  <FiXCircle size={14} color="#999" />
                )}
                {' '}Tracks cached
              </div>
            </div>

            <div style={styles.statCard}>
              <div style={styles.statLabel}>Cache Size</div>
              <div style={styles.statValue}>
                {cacheStats?.totalSizeMB ? cacheStats.totalSizeMB.toFixed(1) : '0.0'} MB
              </div>
              <div style={styles.statSubtext}>
                {cacheStats?.maxSizeMB ? `of ${cacheStats.maxSizeMB} MB max` : 'No limit set'}
              </div>
            </div>

            <div style={styles.statCard}>
              <div style={styles.statLabel}>Cache Hit Rate</div>
              <div style={{
                ...styles.statValue,
                color: getCacheHealthColor(cacheStats?.hitRate || 0)
              }}>
                {cacheStats?.hitRate ? cacheStats.hitRate.toFixed(1) : '0.0'}%
              </div>
              <div style={styles.statSubtext}>
                {cacheStats?.hitRate >= 80 ? 'Excellent' : 
                 cacheStats?.hitRate >= 50 ? 'Good' : 'Low'}
              </div>
            </div>

            <div style={styles.statCard}>
              <div style={styles.statLabel}>Status</div>
              <div style={styles.statValue}>
                {cacheStats?.totalTracks > 0 ? (
                  <FiCheckCircle size={24} color="#28a745" />
                ) : (
                  <FiXCircle size={24} color="#999" />
                )}
              </div>
              <div style={styles.statSubtext}>
                {cacheStats?.totalTracks > 0 ? 'Active' : 'No cache'}
              </div>
            </div>
          </div>

          {/* Cache Details */}
          {cacheStats && (
            <div style={styles.detailsSection}>
              <h4 style={styles.sectionTitle}>Cache Details</h4>
              <div style={styles.detailsGrid}>
                <div style={styles.detailItem}>
                  <strong>Oldest Track:</strong> {formatDate(cacheStats.oldestTrack)}
                </div>
                <div style={styles.detailItem}>
                  <strong>Newest Track:</strong> {formatDate(cacheStats.newestTrack)}
                </div>
                {cacheStats.diskSpaceFree && (
                  <div style={styles.detailItem}>
                    <strong>Free Disk Space:</strong> {cacheStats.diskSpaceFree.toFixed(1)} GB
                  </div>
                )}
                {cacheStats.cacheDirectory && (
                  <div style={styles.detailItem}>
                    <strong>Cache Location:</strong> {cacheStats.cacheDirectory}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cached Tracks List */}
          {cachedTracks.length > 0 && (
            <div style={styles.tracksSection}>
              <h4 style={styles.sectionTitle}>
                Cached Tracks ({cachedTracks.length})
              </h4>
              <div style={styles.tracksList}>
                {cachedTracks.slice(0, 10).map((track, index) => (
                  <div key={track.id || index} style={styles.trackItem}>
                    <FiCheckCircle size={14} color="#28a745" style={styles.trackIcon} />
                    <div style={styles.trackInfo}>
                      <div style={styles.trackTitle}>
                        {track.title || 'Unknown Track'}
                      </div>
                      {track.artist && (
                        <div style={styles.trackArtist}>{track.artist}</div>
                      )}
                      {track.cachedAt && (
                        <div style={styles.trackMeta}>
                          Cached: {formatDate(track.cachedAt)}
                          {track.fileSizeMB && ` • ${track.fileSizeMB.toFixed(2)} MB`}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {cachedTracks.length > 10 && (
                  <div style={styles.moreTracks}>
                    + {cachedTracks.length - 10} more tracks cached
                  </div>
                )}
              </div>
            </div>
          )}

          {cachedTracks.length === 0 && cacheStats?.totalTracks === 0 && (
            <div style={styles.emptyState}>
              <FiDownload size={48} style={styles.emptyIcon} />
              <p>No tracks cached yet</p>
              <p style={styles.emptySubtext}>
                Tracks will be cached automatically as they play
              </p>
            </div>
          )}
        </>
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
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
  headerActions: {
    display: 'flex',
    gap: '8px',
  },
  refreshButton: {
    backgroundColor: '#20c997',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorSection: {
    backgroundColor: '#f8d7da',
    border: '1px solid #f5c6cb',
    color: '#721c24',
    padding: '10px',
    borderRadius: '4px',
    marginBottom: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
  },
  loading: {
    textAlign: 'center',
    color: '#999',
    padding: '40px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
    marginBottom: '4px',
  },
  statSubtext: {
    fontSize: '11px',
    color: '#999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
  },
  detailsSection: {
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
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '10px',
  },
  detailItem: {
    fontSize: '14px',
    color: '#333',
  },
  tracksSection: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
  },
  tracksList: {
    maxHeight: '300px',
    overflowY: 'auto',
  },
  trackItem: {
    display: 'flex',
    gap: '12px',
    padding: '10px',
    borderBottom: '1px solid #f0f0f0',
  },
  trackIcon: {
    flexShrink: 0,
    marginTop: '2px',
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
    marginBottom: '4px',
  },
  trackArtist: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '4px',
  },
  trackMeta: {
    fontSize: '11px',
    color: '#999',
  },
  moreTracks: {
    textAlign: 'center',
    padding: '10px',
    color: '#999',
    fontSize: '13px',
    fontStyle: 'italic',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#999',
  },
  emptyIcon: {
    color: '#ccc',
    marginBottom: '10px',
  },
  emptySubtext: {
    fontSize: '13px',
    marginTop: '5px',
  },
  notAvailable: {
    textAlign: 'center',
    padding: '40px',
    color: '#999',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
};

export default DesktopCacheMonitor;




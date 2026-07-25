// src/components/Desktop/DesktopScheduleMonitor.jsx
// Real-time schedule monitoring for desktop app
import React, { useState, useEffect } from 'react';
import { FiCalendar, FiClock, FiCheckCircle, FiXCircle, FiRefreshCw, FiPlay, FiPause } from 'react-icons/fi';
import { globalMusicService } from '../../services/GlobalMusicService';

const DesktopScheduleMonitor = () => {
  const [schedules, setSchedules] = useState([]);
  const [activeSchedule, setActiveSchedule] = useState(null);
  const [currentPlaylist, setCurrentPlaylist] = useState(null);
  const [nextSchedule, setNextSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    loadScheduleData();
    const interval = setInterval(loadScheduleData, 5000); // Update every 5 seconds

    // Subscribe to music service state changes
    const unsubscribe = globalMusicService.addListener((state) => {
      setCurrentPlaylist({
        id: state.currentPlaylistId,
        name: state.playlistInfo?.name || 'Shuffle All',
        type: state.isShuffleAllMode ? 'shuffle' : 'playlist'
      });
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const loadScheduleData = async () => {
    try {
      setLoading(true);
      
      // Get schedules from GlobalMusicService
      const state = globalMusicService.getState();
      
      // Get schedules (if available in service)
      const serviceSchedules = globalMusicService.schedules || [];
      setSchedules(serviceSchedules);
      
      // Get active schedule
      const active = globalMusicService.activeSchedule || null;
      setActiveSchedule(active);
      
      // Calculate next schedule
      const next = calculateNextSchedule(serviceSchedules);
      setNextSchedule(next);
      
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error loading schedule data:', err);
    } finally {
      setLoading(false);
    }
  };

  const calculateNextSchedule = (schedulesList) => {
    if (!schedulesList || schedulesList.length === 0) return null;

    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    const currentTime = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight

    let nextSchedule = null;
    let minTimeUntil = Infinity;

    schedulesList.forEach(schedule => {
      if (!schedule.is_active) return;

      const scheduleDay = schedule.day_of_week;
      const startTime = parseTime(schedule.start_time);
      const endTime = parseTime(schedule.end_time);

      // Check if schedule is today
      if (scheduleDay === currentDay) {
        // If start time hasn't passed today
        if (startTime > currentTime) {
          const timeUntil = startTime - currentTime;
          if (timeUntil < minTimeUntil) {
            minTimeUntil = timeUntil;
            nextSchedule = { ...schedule, timeUntil, isToday: true };
          }
        }
        // If schedule is currently active, check if it ends today
        else if (startTime <= currentTime && endTime > currentTime) {
          // Schedule is active, next is when it ends (or tomorrow's schedule)
          // For now, just mark as active
        }
      }

      // Check if schedule is in the next 7 days
      let daysUntil = scheduleDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // Next week

      const timeUntil = (daysUntil * 24 * 60) + startTime - currentTime;
      if (timeUntil < minTimeUntil && timeUntil > 0) {
        minTimeUntil = timeUntil;
        nextSchedule = { ...schedule, timeUntil, isToday: false, daysUntil };
      }
    });

    return nextSchedule;
  };

  const parseTime = (timeString) => {
    if (!timeString) return 0;
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };

  const formatTimeUntil = (minutes) => {
    if (minutes < 60) {
      return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days} days`;
  };

  const formatTime = (timeString) => {
    if (!timeString) return 'N/A';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes.padStart(2, '0')} ${ampm}`;
  };

  const getDayName = (dayNumber) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayNumber] || 'Unknown';
  };

  const isScheduleActive = (schedule) => {
    if (!schedule || !schedule.is_active) return false;
    if (activeSchedule && activeSchedule.id === schedule.id) return true;
    
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const startTime = parseTime(schedule.start_time);
    const endTime = parseTime(schedule.end_time);

    return schedule.day_of_week === currentDay && 
           startTime <= currentTime && 
           endTime > currentTime;
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiCalendar size={24} style={styles.headerIcon} />
        <h3 style={styles.title}>Schedule Monitor</h3>
        <div style={styles.headerActions}>
          <button style={styles.refreshButton} onClick={loadScheduleData} title="Refresh schedules">
            <FiRefreshCw size={16} />
          </button>
          {lastUpdate && (
            <span style={styles.lastUpdate}>
              Updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {loading && schedules.length === 0 ? (
        <div style={styles.loading}>Loading schedules...</div>
      ) : (
        <>
          {/* Current Status */}
          <div style={styles.statusSection}>
            <h4 style={styles.sectionTitle}>Current Status</h4>
            <div style={styles.statusGrid}>
              <div style={styles.statusCard}>
                <div style={styles.statusLabel}>Active Schedule</div>
                <div style={styles.statusValue}>
                  {activeSchedule ? (
                    <>
                      <FiCheckCircle size={20} color="#28a745" />
                      <span>{activeSchedule.playlist?.name || 'Scheduled Playlist'}</span>
                    </>
                  ) : (
                    <>
                      <FiXCircle size={20} color="#999" />
                      <span>None (Shuffle Mode)</span>
                    </>
                  )}
                </div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusLabel}>Current Playlist</div>
                <div style={styles.statusValue}>
                  {currentPlaylist ? (
                    <>
                      <FiPlay size={20} color="#20c997" />
                      <span>{currentPlaylist.name}</span>
                    </>
                  ) : (
                    <>
                      <FiPause size={20} color="#999" />
                      <span>Shuffle All</span>
                    </>
                  )}
                </div>
              </div>

              <div style={styles.statusCard}>
                <div style={styles.statusLabel}>Total Schedules</div>
                <div style={styles.statusValue}>
                  {schedules.length}
                </div>
                <div style={styles.statusSubtext}>
                  {schedules.filter(s => s.is_active).length} active
                </div>
              </div>
            </div>
          </div>

          {/* Next Schedule */}
          {nextSchedule && (
            <div style={styles.nextScheduleSection}>
              <h4 style={styles.sectionTitle}>Next Schedule Activation</h4>
              <div style={styles.nextScheduleCard}>
                <div style={styles.nextScheduleHeader}>
                  <FiClock size={20} style={styles.clockIcon} />
                  <div>
                    <div style={styles.nextScheduleName}>
                      {nextSchedule.playlist?.name || 'Scheduled Playlist'}
                    </div>
                    <div style={styles.nextScheduleTime}>
                      {getDayName(nextSchedule.day_of_week)} at {formatTime(nextSchedule.start_time)}
                    </div>
                  </div>
                </div>
                <div style={styles.nextScheduleCountdown}>
                  In {formatTimeUntil(nextSchedule.timeUntil)}
                </div>
              </div>
            </div>
          )}

          {/* All Schedules List */}
          {schedules.length > 0 && (
            <div style={styles.schedulesSection}>
              <h4 style={styles.sectionTitle}>
                All Schedules ({schedules.length})
              </h4>
              <div style={styles.schedulesList}>
                {schedules.map((schedule) => {
                  const isActive = isScheduleActive(schedule);
                  return (
                    <div 
                      key={schedule.id} 
                      style={{
                        ...styles.scheduleItem,
                        borderLeft: isActive ? '4px solid #28a745' : '4px solid #e9ecef',
                        backgroundColor: isActive ? '#f0f9ff' : '#fff'
                      }}
                    >
                      <div style={styles.scheduleHeader}>
                        <div style={styles.scheduleIcon}>
                          {isActive ? (
                            <FiCheckCircle size={18} color="#28a745" />
                          ) : schedule.is_active ? (
                            <FiClock size={18} color="#ffc107" />
                          ) : (
                            <FiXCircle size={18} color="#999" />
                          )}
                        </div>
                        <div style={styles.scheduleInfo}>
                          <div style={styles.scheduleName}>
                            {schedule.playlist?.name || 'Unknown Playlist'}
                            {isActive && (
                              <span style={styles.activeBadge}>ACTIVE</span>
                            )}
                            {!schedule.is_active && (
                              <span style={styles.inactiveBadge}>INACTIVE</span>
                            )}
                          </div>
                          <div style={styles.scheduleDetails}>
                            {getDayName(schedule.day_of_week)} • {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                            {schedule.priority && ` • Priority: ${schedule.priority}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {schedules.length === 0 && (
            <div style={styles.emptyState}>
              <FiCalendar size={48} style={styles.emptyIcon} />
              <p>No schedules configured</p>
              <p style={styles.emptySubtext}>
                Create schedules in the Music Schedules section
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
    flexWrap: 'wrap',
    gap: '10px',
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
    alignItems: 'center',
    gap: '10px',
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
  lastUpdate: {
    fontSize: '13px',
    color: '#999',
  },
  loading: {
    textAlign: 'center',
    color: '#999',
    padding: '40px',
  },
  statusSection: {
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
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
  },
  statusCard: {
    padding: '15px',
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
  },
  statusLabel: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '8px',
  },
  statusValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusSubtext: {
    fontSize: '11px',
    color: '#999',
    marginTop: '4px',
  },
  nextScheduleSection: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '20px',
    border: '1px solid #e9ecef',
  },
  nextScheduleCard: {
    backgroundColor: '#f0f9ff',
    padding: '15px',
    borderRadius: '6px',
    border: '2px solid #20c997',
  },
  nextScheduleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
  },
  clockIcon: {
    color: '#20c997',
  },
  nextScheduleName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  nextScheduleTime: {
    fontSize: '14px',
    color: '#666',
  },
  nextScheduleCountdown: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#20c997',
    textAlign: 'center',
    padding: '10px',
    backgroundColor: '#fff',
    borderRadius: '4px',
  },
  schedulesSection: {
    backgroundColor: '#fff',
    padding: '15px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
  },
  schedulesList: {
    maxHeight: '400px',
    overflowY: 'auto',
  },
  scheduleItem: {
    padding: '12px',
    marginBottom: '10px',
    borderRadius: '6px',
    border: '1px solid #e9ecef',
  },
  scheduleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  scheduleIcon: {
    flexShrink: 0,
  },
  scheduleInfo: {
    flex: 1,
  },
  scheduleName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#333',
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  activeBadge: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#fff',
    backgroundColor: '#28a745',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  inactiveBadge: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#fff',
    backgroundColor: '#999',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  scheduleDetails: {
    fontSize: '13px',
    color: '#666',
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
};

export default DesktopScheduleMonitor;




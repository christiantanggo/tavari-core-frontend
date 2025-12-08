// src/screens/Music/ScheduleCalendarView.jsx - WITH PERMISSION SYSTEM INTEGRATION
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FiPlus, FiCalendar, FiClock, FiAlertTriangle, FiX, FiChevronLeft, FiChevronRight, FiLock } from 'react-icons/fi';
import styles from './PlaylistManager.module.css';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';

/**
 * Schedule Calendar View - Visual week calendar for schedules
 * Receives permissions from parent MusicSchedules component
 */
const ScheduleCalendarView = ({ schedules, playlists, business, onScheduleUpdate, permissions }) => {
  // Debug logging
  console.log('ScheduleCalendarView Props:', {
    schedules: schedules,
    playlists: playlists,
    schedulesLength: schedules?.length,
    playlistsLength: playlists?.length,
    permissions
  });

  // Destructure permissions passed from parent
  const {
    canManage = false,
    canCreate = false,
    canEdit = false,
    canDelete = false
  } = permissions || {};

  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);
  const [showCalendarScheduleModal, setShowCalendarScheduleModal] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  });

  // Form states
  const [scheduleForm, setScheduleForm] = useState({
    playlist_id: '',
    schedule_date: null,
    start_time: '',
    end_time: '',
    priority: 1,
    active: true,
    immediate_switch: false,
    loop_playlist: true,
    stop_when_complete: false,
    repeat_type: 'once',
    repeat_until: null
  });

  // Handle loop playlist change
  const handleLoopPlaylistChange = (checked) => {
    if (checked) {
      setScheduleForm(prev => ({ 
        ...prev, 
        loop_playlist: true,
        stop_when_complete: false
      }));
    } else {
      setScheduleForm(prev => ({ 
        ...prev, 
        loop_playlist: false
      }));
    }
  };

  // Handle stop when complete change
  const handleStopWhenCompleteChange = (checked) => {
    if (checked) {
      setScheduleForm(prev => ({ 
        ...prev, 
        stop_when_complete: true,
        loop_playlist: false
      }));
    } else {
      setScheduleForm(prev => ({ 
        ...prev, 
        stop_when_complete: false
      }));
    }
  };

  // Time slots for calendar (24-hour format)
  const timeSlots = [];
  for (let hour = 0; hour < 24; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
  }

  // Generate week dates
  const getWeekDates = () => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeekStart);
      date.setDate(currentWeekStart.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const weekDates = getWeekDates();

  // Days of week with actual dates
  const daysOfWeek = [
    { id: 0, name: 'Sunday', short: 'Sun' },
    { id: 1, name: 'Monday', short: 'Mon' },
    { id: 2, name: 'Tuesday', short: 'Tue' },
    { id: 3, name: 'Wednesday', short: 'Wed' },
    { id: 4, name: 'Thursday', short: 'Thu' },
    { id: 5, name: 'Friday', short: 'Fri' },
    { id: 6, name: 'Saturday', short: 'Sat' }
  ];

  // Navigation functions
  const goToPreviousWeek = () => {
    const newWeekStart = new Date(currentWeekStart);
    newWeekStart.setDate(currentWeekStart.getDate() - 7);
    setCurrentWeekStart(newWeekStart);
  };

  const goToNextWeek = () => {
    const newWeekStart = new Date(currentWeekStart);
    newWeekStart.setDate(currentWeekStart.getDate() + 7);
    setCurrentWeekStart(newWeekStart);
  };

  const goToCurrentWeek = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    setCurrentWeekStart(weekStart);
  };

  // Check schedule conflicts
  const checkScheduleConflicts = (newSchedule) => {
    const conflicts = [];
    const newStart = new Date(`2000-01-01T${newSchedule.start_time}`);
    const newEnd = new Date(`2000-01-01T${newSchedule.end_time}`);

    const schedulesOnDate = schedules.filter(s => {
      if (newSchedule.schedule_date) {
        return s.schedule_date === newSchedule.schedule_date;
      }
      return false;
    });
    
    schedulesOnDate.forEach(existing => {
      const existingStart = new Date(`2000-01-01T${existing.start_time}`);
      const existingEnd = new Date(`2000-01-01T${existing.end_time}`);
      
      if ((newStart < existingEnd && newEnd > existingStart)) {
        conflicts.push(existing);
      }
    });

    return conflicts;
  };

  // Create schedule with permission check
  const createSchedule = async (e) => {
    e.preventDefault();

    // Permission check
    if (!canCreate) {
      toast.error('You do not have permission to create schedules');
      return;
    }

    if (!business?.id || !scheduleForm.playlist_id || !scheduleForm.schedule_date) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      // Check for conflicts
      const conflicts = checkScheduleConflicts(scheduleForm);
      if (conflicts.length > 0) {
        const confirmCreate = window.confirm(`Warning: This schedule conflicts with ${conflicts.length} existing schedule(s). Continue anyway?`);
        if (!confirmCreate) return;
      }

      // Create schedule for the specific date
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id || null;

      const scheduleInsert = {
        playlist_id: scheduleForm.playlist_id,
        schedule_date: scheduleForm.schedule_date,
        start_time: scheduleForm.start_time,
        end_time: scheduleForm.end_time,
        priority: scheduleForm.priority,
        active: scheduleForm.active,
        immediate_switch: scheduleForm.immediate_switch,
        loop_playlist: scheduleForm.loop_playlist,
        stop_when_complete: scheduleForm.stop_when_complete,
        repeat_type: scheduleForm.repeat_type,
        repeat_until: scheduleForm.repeat_until,
        business_id: business.id,
        created_by: userId
      };

      const { error } = await supabase
        .from('music_playlist_schedules')
        .insert([scheduleInsert]);

      if (error) throw error;

      await onScheduleUpdate();
      setShowCalendarScheduleModal(false);
      setSelectedTimeSlot(null);
      setScheduleForm({
        playlist_id: '',
        schedule_date: null,
        start_time: '',
        end_time: '',
        priority: 1,
        active: true,
        immediate_switch: false,
        loop_playlist: true,
        stop_when_complete: false,
        repeat_type: 'once',
        repeat_until: null
      });

      toast.success('Schedule created successfully');
    } catch (error) {
      console.error('Error creating schedule:', error);
      toast.error('Error creating schedule: ' + error.message);
    }
  };

  // Format time for display
  const formatTime = (timeString) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour12 = hours % 12 || 12;
    const ampm = hours < 12 ? 'AM' : 'PM';
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Format date for display
  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  // Format week range for display
  const formatWeekRange = () => {
    const endDate = new Date(currentWeekStart);
    endDate.setDate(currentWeekStart.getDate() + 6);
    
    return `${formatDate(currentWeekStart)} - ${formatDate(endDate)}, ${currentWeekStart.getFullYear()}`;
  };

  // Handle calendar time slot click with permission check
  const handleTimeSlotClick = (dateIndex, time) => {
    // Permission check
    if (!canCreate) {
      toast.error('You do not have permission to create schedules');
      return;
    }

    const selectedDate = weekDates[dateIndex];
    const dateString = selectedDate.toISOString().split('T')[0];
    
    setSelectedTimeSlot({ dateIndex, time, date: selectedDate });
    setScheduleForm(prev => ({
      ...prev,
      schedule_date: dateString,
      start_time: time,
      end_time: addHourToTime(time)
    }));
    setShowCalendarScheduleModal(true);
  };

  // Add hour to time string
  const addHourToTime = (timeString) => {
    const [hours, minutes] = timeString.split(':');
    const newHour = (parseInt(hours) + 1) % 24;
    return `${newHour.toString().padStart(2, '0')}:${minutes}`;
  };

  // Get schedule for specific date and time
  const getScheduleForTimeSlot = (dateIndex, time) => {
    const selectedDate = weekDates[dateIndex];
    const dateString = selectedDate.toISOString().split('T')[0];
    
    const matchingSchedule = schedules.find(schedule => {
      const scheduleStart = schedule.start_time;
      const scheduleEnd = schedule.end_time;
      
      const timeInRange = time >= scheduleStart && time < scheduleEnd;
      
      if (!timeInRange) {
        return false;
      }
      
      const scheduleDate = new Date(schedule.schedule_date + 'T00:00:00');
      const currentDate = new Date(dateString + 'T00:00:00');
      
      switch (schedule.repeat_type) {
        case 'once':
          return schedule.schedule_date === dateString;
          
        case 'daily':
          if (currentDate < scheduleDate) return false;
          if (schedule.repeat_until) {
            const repeatUntil = new Date(schedule.repeat_until + 'T00:00:00');
            if (currentDate > repeatUntil) return false;
          }
          return true;
          
        case 'weekly':
          if (currentDate < scheduleDate) return false;
          if (currentDate.getDay() !== scheduleDate.getDay()) return false;
          if (schedule.repeat_until) {
            const repeatUntil = new Date(schedule.repeat_until + 'T00:00:00');
            if (currentDate > repeatUntil) return false;
          }
          return true;
          
        case 'monthly':
          if (currentDate < scheduleDate) return false;
          if (currentDate.getDate() !== scheduleDate.getDate()) return false;
          if (schedule.repeat_until) {
            const repeatUntil = new Date(schedule.repeat_until + 'T00:00:00');
            if (currentDate > repeatUntil) return false;
          }
          return true;
          
        default:
          return schedule.schedule_date === dateString;
      }
    });

    return matchingSchedule || null;
  };

  // Check if date is today
  const isToday = (date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  return (
    <div>
      {/* Permission Notice */}
      {!canCreate && (
        <div style={{
          padding: '16px',
          backgroundColor: '#EFF6FF',
          border: '2px solid #3B82F6',
          borderRadius: '8px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <FiLock size={20} style={{ color: '#1E40AF' }} />
          <span style={{ color: '#1E40AF', fontWeight: '500' }}>
            View Only Mode - You can view schedules but cannot create new ones. Contact your administrator for schedule management access.
          </span>
        </div>
      )}

      {/* Calendar Description and Navigation */}
      <div className={styles.playlistCard} style={{ marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2 className={styles.playlistTitle}>Weekly Schedule Calendar</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button
              onClick={goToPreviousWeek}
              className={`${styles.iconButton} ${styles.primary}`}
              title="Previous Week"
            >
              <FiChevronLeft />
            </button>
            <button
              onClick={goToCurrentWeek}
              className={`${styles.button} ${styles.secondary}`}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              Today
            </button>
            <button
              onClick={goToNextWeek}
              className={`${styles.iconButton} ${styles.primary}`}
              title="Next Week"
            >
              <FiChevronRight />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className={styles.playlistDescription}>
            Week of {formatWeekRange()}
          </p>
          <p className={styles.playlistDescription}>
            {canCreate 
              ? 'Click on any time slot to create a new schedule for that specific date and time'
              : 'View-only mode - schedule creation requires additional permissions'}
          </p>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className={styles.playlistCard} style={{ padding: '0', overflow: 'hidden' }}>
        {/* Calendar Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '120px repeat(7, 1fr)',
          backgroundColor: '#14B8A6',
          borderBottom: '2px solid #0d9488'
        }}>
          <div style={{
            padding: '15px',
            color: 'white',
            fontWeight: 'bold',
            textAlign: 'center',
            borderRight: '1px solid #0d9488'
          }}>
            <FiClock style={{ marginRight: '8px' }} />
            Time
          </div>
          {daysOfWeek.map((day, index) => (
            <div key={day.id} style={{
              padding: '15px',
              color: 'white',
              fontWeight: 'bold',
              textAlign: 'center',
              borderRight: index < 6 ? '1px solid #0d9488' : 'none',
              backgroundColor: isToday(weekDates[index]) ? '#0d9488' : '#14B8A6'
            }}>
              <div>{day.short}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                {formatDate(weekDates[index])}
              </div>
            </div>
          ))}
        </div>

        {/* Calendar Body */}
        <div style={{
          maxHeight: '500px',
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: '120px repeat(7, 1fr)'
        }}>
          {timeSlots.map((time) => (
            <React.Fragment key={time}>
              {/* Time Label */}
              <div style={{
                padding: '15px',
                backgroundColor: '#f0fdfa',
                borderRight: '1px solid #14B8A6',
                borderBottom: '1px solid #e5e7eb',
                fontWeight: 'bold',
                textAlign: 'center',
                color: '#1f2937',
                fontSize: '0.9rem'
              }}>
                {formatTime(time)}
              </div>
              
              {/* Day Columns */}
              {weekDates.map((date, dateIndex) => {
                const schedule = getScheduleForTimeSlot(dateIndex, time);
                const isPastDate = date < new Date().setHours(0, 0, 0, 0);
                const isClickable = canCreate && !isPastDate;
                
                return (
                  <div
                    key={`${dateIndex}-${time}`}
                    onClick={() => isClickable && handleTimeSlotClick(dateIndex, time)}
                    style={{
                      padding: '8px',
                      minHeight: '60px',
                      cursor: isClickable ? 'pointer' : isPastDate ? 'not-allowed' : 'default',
                      border: '1px solid #e5e7eb',
                      backgroundColor: schedule 
                        ? `${schedule.playlist_color}20` 
                        : isPastDate 
                          ? '#f9fafb' 
                          : isToday(date) 
                            ? '#f0fdfa' 
                            : '#ffffff',
                      borderLeft: schedule ? `4px solid ${schedule.playlist_color}` : '1px solid #e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      opacity: isPastDate ? 0.6 : !canCreate && !schedule ? 0.8 : 1
                    }}
                    onMouseEnter={(e) => {
                      if (isClickable && !schedule) {
                        e.target.style.backgroundColor = '#f0fdfa';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isClickable && !schedule) {
                        e.target.style.backgroundColor = isToday(date) ? '#f0fdfa' : '#ffffff';
                      }
                    }}
                    title={
                      schedule 
                        ? `${schedule.playlist_name} (${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)})` 
                        : isPastDate 
                          ? 'Past date' 
                          : canCreate
                            ? `Click to create schedule for ${formatDate(date)}`
                            : 'View only - permission required to create schedules'
                    }
                  >
                    {schedule ? (
                      <div style={{
                        backgroundColor: schedule.playlist_color,
                        color: 'white',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        textAlign: 'center',
                        width: '100%',
                        fontSize: '0.8rem',
                        fontWeight: 'bold'
                      }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {schedule.playlist_name}
                        </div>
                        <div style={{ opacity: 0.9, fontSize: '0.7rem', marginTop: '2px' }}>
                          {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                        </div>
                      </div>
                    ) : !isPastDate && canCreate ? (
                      <FiPlus style={{ color: '#14B8A6', fontSize: '1.2rem' }} />
                    ) : !isPastDate && !canCreate ? (
                      <FiLock style={{ color: '#9CA3AF', fontSize: '1rem' }} />
                    ) : null}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Calendar Legend */}
      <div className={styles.playlistCard} style={{ marginTop: '30px' }}>
        <h3 className={styles.playlistTitle} style={{ marginBottom: '15px' }}>Schedule Legend</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
          {playlists.slice(0, 8).map(playlist => (
            <div key={playlist.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                marginRight: '10px',
                backgroundColor: playlist.color_code,
                border: '1px solid #e5e7eb'
              }}></div>
              <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#4b5563' }}>{playlist.name}</span>
            </div>
          ))}
          {playlists.length > 8 && (
            <div style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: '500' }}>
              +{playlists.length - 8} more playlists
            </div>
          )}
        </div>
      </div>

      {/* Create Schedule Modal */}
      {showCalendarScheduleModal && canCreate && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                Create Schedule for {selectedTimeSlot && formatDate(selectedTimeSlot.date)}
              </h2>
              <button
                onClick={() => {
                  setShowCalendarScheduleModal(false);
                  setSelectedTimeSlot(null);
                  setScheduleForm({
                    playlist_id: '',
                    schedule_date: null,
                    start_time: '',
                    end_time: '',
                    priority: 1,
                    active: true,
                    immediate_switch: false,
                    loop_playlist: true,
                    stop_when_complete: false,
                    repeat_type: 'once',
                    repeat_until: null
                  });
                }}
                className={styles.closeButton}
              >
                <FiX />
              </button>
            </div>
            <form onSubmit={createSchedule}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Playlist</label>
                <select
                  value={scheduleForm.playlist_id}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, playlist_id: e.target.value }))}
                  className={styles.select}
                  required
                >
                  <option value="">Select a playlist</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Schedule Date</label>
                <input
                  type="date"
                  value={scheduleForm.schedule_date || ''}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, schedule_date: e.target.value }))}
                  className={styles.input}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Start Time</label>
                  <input
                    type="time"
                    value={scheduleForm.start_time}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, start_time: e.target.value }))}
                    className={styles.input}
                    required
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>End Time</label>
                  <input
                    type="time"
                    value={scheduleForm.end_time}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, end_time: e.target.value }))}
                    className={styles.input}
                    required
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Priority (1-10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={scheduleForm.priority}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
                  className={styles.input}
                />
                <small style={{ color: '#6b7280', fontSize: '0.8rem' }}>
                  Higher numbers = higher priority when schedules overlap
                </small>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Playback Options</label>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <TavariCheckbox
                    checked={scheduleForm.loop_playlist}
                    onChange={handleLoopPlaylistChange}
                    label="Loop playlist (restart when finished)"
                    size="md"
                  />
                  <TavariCheckbox
                    checked={scheduleForm.stop_when_complete}
                    onChange={handleStopWhenCompleteChange}
                    label="Stop when playlist completes (switch to shuffle)"
                    size="md"
                  />
                  <TavariCheckbox
                    checked={scheduleForm.immediate_switch}
                    onChange={(checked) => setScheduleForm(prev => ({ ...prev, immediate_switch: checked }))}
                    label="Switch immediately when schedule starts (interrupt current track)"
                    size="md"
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Repeat Type</label>
                <select
                  value={scheduleForm.repeat_type}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, repeat_type: e.target.value }))}
                  className={styles.select}
                >
                  <option value="once">One Time Only</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              {scheduleForm.repeat_type !== 'once' && (
                <div className={styles.formGroup}>
                  <label className={styles.label}>Repeat Until</label>
                  <input
                    type="date"
                    value={scheduleForm.repeat_until || ''}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, repeat_until: e.target.value }))}
                    className={styles.input}
                  />
                </div>
              )}

              {/* Conflict warning */}
              {scheduleForm.playlist_id && scheduleForm.schedule_date && scheduleForm.start_time && scheduleForm.end_time && (
                (() => {
                  const conflicts = checkScheduleConflicts(scheduleForm);
                  return conflicts.length > 0 && (
                    <div style={{
                      padding: '15px',
                      backgroundColor: '#fef3c7',
                      border: '2px solid #f59e0b',
                      borderRadius: '8px',
                      marginBottom: '20px',
                      display: 'flex',
                      alignItems: 'center'
                    }}>
                      <FiAlertTriangle style={{ color: '#d97706', marginRight: '10px', fontSize: '1.2rem' }} />
                      <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#92400e' }}>
                        Warning: This schedule conflicts with {conflicts.length} existing schedule(s)
                      </span>
                    </div>
                  );
                })()
              )}

              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={() => {
                    setShowCalendarScheduleModal(false);
                    setSelectedTimeSlot(null);
                    setScheduleForm({
                      playlist_id: '',
                      schedule_date: null,
                      start_time: '',
                      end_time: '',
                      priority: 1,
                      active: true,
                      immediate_switch: false,
                      loop_playlist: true,
                      stop_when_complete: false,
                      repeat_type: 'once',
                      repeat_until: null
                    });
                  }}
                  className={`${styles.button} ${styles.secondary}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.button} ${styles.primary}`}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleCalendarView;
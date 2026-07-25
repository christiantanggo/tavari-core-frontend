// screens/MusicV2/ScheduleEditor.jsx
// Hourly schedule editor for Music V2 system

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiSave, FiTrash2, FiCopy } from 'react-icons/fi';
import { useBusiness } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

const ScheduleEditor = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const [location, setLocation] = useState(null);
  const [scheduleBlocks, setScheduleBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null); // null = all days, 0-6 = specific day
  const [operatingHours, setOperatingHours] = useState(null);
  const [holidayHours, setHolidayHours] = useState([]);
  const [showOperatingHours, setShowOperatingHours] = useState(true);

  const daysOfWeek = [
    { value: null, label: 'All Days' },
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' }
  ];

  // Day order for display (Sunday first)
  const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const playlistTypes = [
    { value: 'upbeat', label: 'Upbeat', description: 'Energetic music for busy hours' },
    { value: 'background', label: 'Background', description: 'Chill, low-key music' },
    { value: 'upscale', label: 'Upscale', description: 'Jazzy, sophisticated music' }
  ];

  const adFrequencyOptions = [
    { value: null, label: 'Use Default', description: 'Use location default setting' },
    { value: 'zero_ads', label: 'No Ads', description: 'Ad-free during this time' },
    { value: 'one_per_8', label: '1 Ad Every 8 Songs', description: 'Light ad frequency' },
    { value: 'one_per_7', label: '1 Ad Every 7 Songs', description: 'Light ad frequency' },
    { value: 'one_per_6', label: '1 Ad Every 6 Songs', description: 'Moderate ad frequency' },
    { value: 'one_per_5', label: '1 Ad Every 5 Songs', description: 'Moderate ad frequency' },
    { value: 'one_per_4', label: '1 Ad Every 4 Songs', description: 'Higher ad frequency' },
    { value: 'one_per_3', label: '1 Ad Every 3 Songs', description: 'Maximum ad frequency' }
  ];

  useEffect(() => {
    if (business?.id) {
      loadData();
    }
  }, [business?.id]);

  const loadData = async () => {
    try {
      // Load location
      const { data: locationData, error: locationError } = await supabase
        .from('music_v2_locations')
        .select('*')
        .eq('business_id', business.id)
        .maybeSingle();

      if (locationError && locationError.code !== 'PGRST116') {
        throw locationError;
      }

      if (locationData) {
        setLocation(locationData);
      }

      // Load business operating hours and holidays
      const { data: businessData, error: businessError } = await supabase
        .from('businesses')
        .select('operating_hours, holiday_hours')
        .eq('id', business.id)
        .single();

      if (!businessError && businessData) {
        // Set operating hours with defaults if needed
        const defaultHours = {
          monday: { open: '09:00', close: '17:00', closed: false },
          tuesday: { open: '09:00', close: '17:00', closed: false },
          wednesday: { open: '09:00', close: '17:00', closed: false },
          thursday: { open: '09:00', close: '17:00', closed: false },
          friday: { open: '09:00', close: '17:00', closed: false },
          saturday: { open: '10:00', close: '16:00', closed: false },
          sunday: { open: '12:00', close: '16:00', closed: true }
        };
        
        setOperatingHours(businessData.operating_hours || defaultHours);
        setHolidayHours(Array.isArray(businessData.holiday_hours) ? businessData.holiday_hours : []);
      }

      // Load schedule blocks
      const { data: blocks, error: blocksError } = await supabase
        .from('music_v2_schedule_blocks')
        .select('*')
        .eq('location_id', locationData?.id || '')
        .eq('is_active', true)
        .order('day_of_week', { nullsFirst: true })
        .order('start_hour');

      if (blocksError) throw blocksError;
      setScheduleBlocks(blocks || []);

      setLoading(false);
    } catch (error) {
      console.error('Error loading schedule:', error);
      toast.error('Failed to load schedule');
      setLoading(false);
    }
  };

  const handleAddBlock = () => {
    if (!location) {
      toast.error('Location not found');
      return;
    }

    const newBlock = {
      id: `temp-${Date.now()}`,
      location_id: location.id,
      day_of_week: selectedDay,
      start_hour: 9,
      end_hour: 17,
      playlist_type: 'background',
      ad_frequency: null,
      content_rating: null,
      is_active: true,
      isNew: true
    };

    setScheduleBlocks([...scheduleBlocks, newBlock]);
  };

  const handleUpdateBlock = (blockId, updates) => {
    setScheduleBlocks(blocks =>
      blocks.map(block =>
        block.id === blockId ? { ...block, ...updates } : block
      )
    );
  };

  const handleDeleteBlock = (blockId) => {
    setScheduleBlocks(blocks => blocks.filter(block => block.id !== blockId));
  };

  const handleSave = async () => {
    if (!location || saving) return;

    setSaving(true);

    try {
      // Delete removed blocks (those not in current list)
      const existingBlockIds = scheduleBlocks
        .filter(b => !b.isNew && b.id && !b.id.startsWith('temp-'))
        .map(b => b.id);

      if (existingBlockIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('music_v2_schedule_blocks')
          .delete()
          .eq('location_id', location.id)
          .not('id', 'in', `(${existingBlockIds.join(',')})`);

        if (deleteError) throw deleteError;
      }

      // Upsert all blocks
      const blocksToSave = scheduleBlocks.map(block => ({
        location_id: location.id,
        day_of_week: block.day_of_week,
        start_hour: block.start_hour,
        end_hour: block.end_hour,
        playlist_type: block.playlist_type,
        ad_frequency: block.ad_frequency,
        content_rating: block.content_rating,
        is_active: true
      }));

      // For new blocks, insert
      const newBlocks = scheduleBlocks.filter(b => b.isNew || b.id?.startsWith('temp-'));
      if (newBlocks.length > 0) {
        const { error: insertError } = await supabase
          .from('music_v2_schedule_blocks')
          .insert(newBlocks.map(b => ({
            location_id: location.id,
            day_of_week: b.day_of_week,
            start_hour: b.start_hour,
            end_hour: b.end_hour,
            playlist_type: b.playlist_type,
            ad_frequency: b.ad_frequency,
            content_rating: b.content_rating,
            is_active: true
          })));

        if (insertError) throw insertError;
      }

      // For existing blocks, update
      const existingBlocks = scheduleBlocks.filter(b => !b.isNew && !b.id?.startsWith('temp-'));
      for (const block of existingBlocks) {
        const { error: updateError } = await supabase
          .from('music_v2_schedule_blocks')
          .update({
            day_of_week: block.day_of_week,
            start_hour: block.start_hour,
            end_hour: block.end_hour,
            playlist_type: block.playlist_type,
            ad_frequency: block.ad_frequency,
            content_rating: block.content_rating,
            updated_at: new Date().toISOString()
          })
          .eq('id', block.id);

        if (updateError) throw updateError;
      }

      toast.success('Schedule saved successfully!', {
        duration: 3000,
        style: {
          background: '#28a745',
          color: '#fff',
          fontSize: '16px',
          padding: '16px'
        }
      });

      // Reload data
      await loadData();
    } catch (error) {
      console.error('Error saving schedule:', error);
      toast.error('Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  const getBlocksForDay = (dayValue) => {
    return scheduleBlocks.filter(block => block.day_of_week === dayValue);
  };

  const formatTime = (hour) => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  };

  const timeToHour = (timeString) => {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours;
  };

  const getDayName = (dayOfWeek) => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[dayOfWeek] || null;
  };

  const isHourInOperatingHours = (hour, dayOfWeek) => {
    if (!operatingHours) return true; // If no operating hours, allow all
    
    const dayName = dayOfWeek !== null ? getDayName(dayOfWeek) : null;
    
    // Check if it's a holiday
    const today = new Date();
    const currentDateStr = today.toISOString().split('T')[0];
    const isHoliday = holidayHours.some(holiday => {
      if (!holiday.date) return false;
      const holidayDate = new Date(holiday.date);
      const holidayDateStr = holidayDate.toISOString().split('T')[0];
      return holidayDateStr === currentDateStr;
    });

    if (isHoliday) {
      // Check holiday hours
      const holiday = holidayHours.find(h => {
        const hDate = new Date(h.date);
        return hDate.toISOString().split('T')[0] === currentDateStr;
      });
      
      if (holiday && holiday.closed) return false;
      if (holiday && holiday.hours) {
        const openHour = timeToHour(holiday.hours.open);
        const closeHour = timeToHour(holiday.hours.close);
        return hour >= openHour && hour < closeHour;
      }
      return false;
    }

    // Check regular operating hours
    if (dayOfWeek === null) {
      // For "all days", check if any day is open at this hour
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      return days.some(day => {
        const dayHours = operatingHours[day];
        if (!dayHours || dayHours.closed) return false;
        const openHour = timeToHour(dayHours.open);
        const closeHour = timeToHour(dayHours.close);
        return hour >= openHour && hour < closeHour;
      });
    }

    if (!dayName) return true;
    const dayHours = operatingHours[dayName];
    if (!dayHours || dayHours.closed) return false;
    
    const openHour = timeToHour(dayHours.open);
    const closeHour = timeToHour(dayHours.close);
    return hour >= openHour && hour < closeHour;
  };

  const getOperatingHoursForDay = (dayOfWeek) => {
    if (!operatingHours) return null;
    if (dayOfWeek === null) return null; // All days - can't show specific hours
    
    const dayName = getDayName(dayOfWeek);
    if (!dayName) return null;
    
    return operatingHours[dayName];
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading schedule...</div>
      </div>
    );
  }

  if (!location) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Location not found. Please go back to the dashboard.</div>
        <button
          onClick={() => navigate('/dashboard/music-v2/dashboard')}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const filteredBlocks = selectedDay === null
    ? scheduleBlocks
    : scheduleBlocks.filter(b => b.day_of_week === selectedDay);

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <button
        onClick={() => navigate('/dashboard/music-v2/dashboard')}
        style={{
          marginBottom: '1rem',
          padding: '0.5rem 1rem',
          backgroundColor: '#6c757d',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}
      >
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>Schedule Editor</h1>
          <p style={{ color: '#666' }}>
            Set hourly schedule blocks to control which playlists play and when ads appear throughout the day.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={handleAddBlock}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            + Add Time Block
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 'bold'
            }}
          >
            <FiSave /> {saving ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      </div>

      {/* Operating Hours Info */}
      {operatingHours && showOperatingHours && (
        <div style={{
          backgroundColor: '#e7f3ff',
          border: '1px solid #b3d9ff',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
            <div>
              <h3 style={{ margin: 0, marginBottom: '0.5rem', fontSize: '1rem', fontWeight: 'bold' }}>
                📅 Operating Hours Reference
              </h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#666' }}>
                Your business operating hours. Schedule blocks outside these hours will still work but may not be needed.
              </p>
            </div>
            <button
              onClick={() => setShowOperatingHours(false)}
              style={{
                padding: '0.25rem 0.5rem',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.25rem',
                color: '#666'
              }}
            >
              ×
            </button>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.5rem',
            fontSize: '0.875rem'
          }}>
            {dayOrder.map(day => {
              const hours = operatingHours[day];
              if (!hours) return null;
              return (
                <div key={day} style={{
                  padding: '0.5rem',
                  backgroundColor: '#fff',
                  borderRadius: '4px',
                  border: '1px solid #b3d9ff'
                }}>
                  <div style={{ fontWeight: 'bold', textTransform: 'capitalize', marginBottom: '0.25rem' }}>
                    {day}
                  </div>
                  {hours.closed ? (
                    <div style={{ color: '#dc3545' }}>Closed</div>
                  ) : (
                    <div style={{ color: '#28a745' }}>
                      {hours.open} - {hours.close}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {holidayHours.length > 0 && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #b3d9ff' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                Upcoming Holidays:
              </div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>
                {holidayHours.slice(0, 3).map((holiday, idx) => (
                  <div key={idx} style={{ marginBottom: '0.25rem' }}>
                    {holiday.name || 'Holiday'}: {holiday.date} {holiday.closed ? '(Closed)' : `(${holiday.hours?.open || 'N/A'} - ${holiday.hours?.close || 'N/A'})`}
                  </div>
                ))}
                {holidayHours.length > 3 && (
                  <div style={{ fontStyle: 'italic', color: '#999' }}>
                    + {holidayHours.length - 3} more holiday{holidayHours.length - 3 !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!showOperatingHours && (
        <button
          onClick={() => setShowOperatingHours(true)}
          style={{
            marginBottom: '1.5rem',
            padding: '0.5rem 1rem',
            backgroundColor: '#e7f3ff',
            color: '#007bff',
            border: '1px solid #b3d9ff',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.875rem'
          }}
        >
          Show Operating Hours
        </button>
      )}

      {/* Day Filter */}
      <div style={{
        backgroundColor: '#f8f9fa',
        padding: '1rem',
        borderRadius: '8px',
        marginBottom: '2rem',
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap'
      }}>
        <div style={{ fontWeight: 'bold', marginRight: '1rem', display: 'flex', alignItems: 'center' }}>
          Filter by Day:
        </div>
        {daysOfWeek.map(day => {
          const dayHours = getOperatingHoursForDay(day.value);
          return (
            <button
              key={day.value ?? 'all'}
              onClick={() => setSelectedDay(day.value)}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: selectedDay === day.value ? '#007bff' : '#fff',
                color: selectedDay === day.value ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: selectedDay === day.value ? 'bold' : 'normal',
                position: 'relative'
              }}
              title={dayHours ? (dayHours.closed ? 'Closed' : `${dayHours.open} - ${dayHours.close}`) : ''}
            >
              {day.label}
              {dayHours && dayHours.closed && (
                <span style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.75rem',
                  opacity: 0.7
                }}>
                  (Closed)
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Schedule Blocks */}
      {filteredBlocks.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '2px dashed #ddd'
        }}>
          <p style={{ fontSize: '1.25rem', color: '#666', marginBottom: '1rem' }}>
            No schedule blocks configured
          </p>
          <p style={{ color: '#999', marginBottom: '1.5rem' }}>
            Add time blocks to control when different playlists play throughout the day.
          </p>
          <button
            onClick={handleAddBlock}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            + Add Your First Time Block
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredBlocks.map((block, index) => (
            <div
              key={block.id || index}
              style={{
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '1.5rem',
                backgroundColor: '#fff'
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '1rem', alignItems: 'end' }}>
                {/* Day */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    Day
                  </label>
                  <select
                    value={block.day_of_week ?? ''}
                    onChange={(e) => handleUpdateBlock(block.id, { day_of_week: e.target.value === '' ? null : parseInt(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    <option value="">All Days</option>
                    {daysOfWeek.slice(1).map(day => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </div>

                {/* Start Hour */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    Start Time
                  </label>
                  <select
                    value={block.start_hour}
                    onChange={(e) => handleUpdateBlock(block.id, { start_hour: parseInt(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: isHourInOperatingHours(block.start_hour, block.day_of_week) 
                        ? '1px solid #ddd' 
                        : '2px solid #ffc107',
                      backgroundColor: isHourInOperatingHours(block.start_hour, block.day_of_week) 
                        ? '#fff' 
                        : '#fffbf0'
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{formatTime(i)}</option>
                    ))}
                  </select>
                  {!isHourInOperatingHours(block.start_hour, block.day_of_week) && (
                    <div style={{ fontSize: '0.75rem', color: '#ffc107', marginTop: '0.25rem' }}>
                      ⚠ Outside operating hours
                    </div>
                  )}
                </div>

                {/* End Hour */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    End Time
                  </label>
                  <select
                    value={block.end_hour}
                    onChange={(e) => handleUpdateBlock(block.id, { end_hour: parseInt(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: isHourInOperatingHours(block.end_hour, block.day_of_week) 
                        ? '1px solid #ddd' 
                        : '2px solid #ffc107',
                      backgroundColor: isHourInOperatingHours(block.end_hour, block.day_of_week) 
                        ? '#fff' 
                        : '#fffbf0'
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{formatTime(i)}</option>
                    ))}
                  </select>
                  {!isHourInOperatingHours(block.end_hour, block.day_of_week) && (
                    <div style={{ fontSize: '0.75rem', color: '#ffc107', marginTop: '0.25rem' }}>
                      ⚠ Outside operating hours
                    </div>
                  )}
                </div>

                {/* Playlist Type */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    Playlist
                  </label>
                  <select
                    value={block.playlist_type}
                    onChange={(e) => handleUpdateBlock(block.id, { playlist_type: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    {playlistTypes.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                {/* Delete Button */}
                <div>
                  <button
                    onClick={() => handleDeleteBlock(block.id)}
                    style={{
                      padding: '0.5rem',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Delete this time block"
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </div>

              {/* Additional Options Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                {/* Ad Frequency Override */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    Ad Frequency (Optional)
                  </label>
                  <select
                    value={block.ad_frequency || ''}
                    onChange={(e) => handleUpdateBlock(block.id, { ad_frequency: e.target.value || null })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    {adFrequencyOptions.map(opt => (
                      <option key={opt.value || 'default'} value={opt.value || ''}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Content Rating Override */}
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    Content Rating (Optional)
                  </label>
                  <select
                    value={block.content_rating || ''}
                    onChange={(e) => handleUpdateBlock(block.id, { content_rating: e.target.value || null })}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    <option value="">Use Default</option>
                    <option value="kids_safe">Kids Safe</option>
                    <option value="family">Family</option>
                    <option value="general">General</option>
                  </select>
                </div>
              </div>

              {/* Time Display */}
              <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#666' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>
                    {block.day_of_week === null ? 'All Days' : daysOfWeek.find(d => d.value === block.day_of_week)?.label} • 
                    {formatTime(block.start_hour)} - {formatTime(block.end_hour)} • 
                    {playlistTypes.find(p => p.value === block.playlist_type)?.label}
                  </span>
                  {block.ad_frequency && (
                    <span>• Ad Frequency: {adFrequencyOptions.find(a => a.value === block.ad_frequency)?.label}</span>
                  )}
                  {(() => {
                    const startInHours = isHourInOperatingHours(block.start_hour, block.day_of_week);
                    const endInHours = isHourInOperatingHours(block.end_hour, block.day_of_week);
                    if (!startInHours || !endInHours) {
                      return (
                        <span style={{ 
                          color: '#ffc107', 
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}>
                          ⚠ Outside Operating Hours
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
                {(() => {
                  const dayHours = getOperatingHoursForDay(block.day_of_week);
                  if (dayHours && !dayHours.closed) {
                    return (
                      <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.25rem' }}>
                        Operating Hours: {dayHours.open} - {dayHours.close}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help Text */}
      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        backgroundColor: '#e7f3ff',
        borderRadius: '8px',
        border: '1px solid #b3d9ff'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>💡 Tips</h3>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#666' }}>
          <li>Set <strong>day_of_week</strong> to "All Days" to apply the same schedule every day</li>
          <li>Set specific days for different schedules (e.g., weekend vs weekday)</li>
          <li>Time blocks can overlap - the system will use the most specific match</li>
          <li>Leave Ad Frequency as "Use Default" to use your location's default setting</li>
          <li>Use Content Rating overrides for special times (e.g., kids-safe during morning hours)</li>
        </ul>
      </div>
    </div>
  );
};

export default ScheduleEditor;

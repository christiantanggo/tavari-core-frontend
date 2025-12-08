import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { FiCalendar, FiClock } from 'react-icons/fi';
import { useBusiness } from '../../contexts/BusinessContext';
import ScheduleCalendarView from './ScheduleCalendarView';
import ScheduleListView from './ScheduleListView';
import styles from './PlaylistManager.module.css';

const MusicSchedules = () => {
  const [activeTab, setActiveTab] = useState('calendar');
  const [schedules, setSchedules] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const { business } = useBusiness();

  // Load schedules
  const loadSchedules = async () => {
    if (!business?.id) {
      console.log('No business ID found');
      return;
    }
    
    console.log('Loading schedules for business:', business.id);
    
    try {
      // First, let's see what's actually in the database
      const { data: allData, error: allError } = await supabase
        .from('music_playlist_schedules')
        .select(`
          *,
          playlist:music_playlists(name, color_code)
        `)
        .eq('business_id', business.id);

      if (allError) {
        console.error('Error loading all schedules:', allError);
        throw allError;
      }
      
      console.log('🔍 ALL SCHEDULES IN DATABASE:', allData);
      console.log('📊 Total schedules found:', allData?.length || 0);
      
      // Show breakdown of schedule types
      const withScheduleDate = allData?.filter(s => s.schedule_date !== null) || [];
      const withDayOfWeek = allData?.filter(s => s.day_of_week !== null) || [];
      const activeSchedules = allData?.filter(s => s.active === true) || [];
      
      console.log('📅 Schedules with schedule_date:', withScheduleDate.length);
      console.log('📅 Schedules with day_of_week:', withDayOfWeek.length);
      console.log('✅ Active schedules:', activeSchedules.length);
      
      // Filter for schedules with schedule_date (new system) OR day_of_week (old system)
      const { data, error } = await supabase
        .from('music_playlist_schedules')
        .select(`
          *,
          playlist:music_playlists(name, color_code)
        `)
        .eq('business_id', business.id)
        .eq('active', true);

      if (error) {
        console.error('Error loading active schedules:', error);
        throw error;
      }
      
      console.log('✅ ACTIVE SCHEDULES:', data);
      
      // Process schedules for display - handle both new and old formats
      const processedSchedules = data
        .filter(schedule => schedule.schedule_date !== null) // Only show date-based schedules
        .map(schedule => ({
          ...schedule,
          playlist_name: schedule.playlist?.name,
          playlist_color: schedule.playlist?.color_code || '#14B8A6'
        }))
        .sort((a, b) => {
          // Sort by date first, then by time
          if (a.schedule_date !== b.schedule_date) {
            return new Date(a.schedule_date) - new Date(b.schedule_date);
          }
          return a.start_time.localeCompare(b.start_time);
        });
      
      console.log('🎯 PROCESSED SCHEDULES FOR DISPLAY:', processedSchedules);
      console.log('📈 Schedules that will show in UI:', processedSchedules.length);
      
      setSchedules(processedSchedules);

      // 🔥 CRITICAL FIX: Force GlobalMusicService to reload schedules
      if (window.globalMusicService && window.globalMusicService.isInitialized) {
        console.log('🔄 Reloading GlobalMusicService schedules...');
        await window.globalMusicService.loadSchedules();
        console.log('✅ GlobalMusicService schedules reloaded!');
        
        // Force immediate schedule check
        window.globalMusicService.checkSchedules();
        console.log('✅ Schedule check triggered!');
      }
    } catch (error) {
      console.error('❌ Error loading schedules:', error);
    }
  };

  // Load playlists
  const loadPlaylists = async () => {
    if (!business?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('music_playlists')
        .select('*')
        .eq('business_id', business.id)
        .order('name', { ascending: true });

      if (error) throw error;
      setPlaylists(data || []);
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  };

  // Load all data
  useEffect(() => {
    if (business?.id) {
      setLoading(true);
      Promise.all([loadSchedules(), loadPlaylists()])
        .finally(() => setLoading(false));
    }
  }, [business?.id]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading schedules...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Music Schedules</h1>
        <p className={styles.subtitle}>Schedule playlists to play automatically on specific dates and times</p>
      </div>

      {/* Tab Navigation - Tavari Style */}
      <div className={styles.actionGrid} style={{ gridTemplateColumns: '1fr 1fr', marginBottom: '40px' }}>
        <button
          onClick={() => setActiveTab('calendar')}
          className={`${styles.actionButton} ${activeTab === 'calendar' ? styles.activeTab : ''}`}
          style={{
            backgroundColor: activeTab === 'calendar' ? '#14B8A6' : 'white',
            color: activeTab === 'calendar' ? 'white' : '#374151',
            borderColor: '#14B8A6'
          }}
        >
          <FiCalendar className={styles.actionIcon} style={{ color: activeTab === 'calendar' ? 'white' : '#14B8A6' }} />
          Weekly Calendar
        </button>
        <button
          onClick={() => setActiveTab('schedules')}
          className={`${styles.actionButton} ${activeTab === 'schedules' ? styles.activeTab : ''}`}
          style={{
            backgroundColor: activeTab === 'schedules' ? '#14B8A6' : 'white',
            color: activeTab === 'schedules' ? 'white' : '#374151',
            borderColor: '#14B8A6'
          }}
        >
          <FiClock className={styles.actionIcon} style={{ color: activeTab === 'schedules' ? 'white' : '#14B8A6' }} />
          Schedule List
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'calendar' && (
        <ScheduleCalendarView
          schedules={schedules}
          playlists={playlists}
          business={business}
          onScheduleUpdate={loadSchedules}
        />
      )}

      {activeTab === 'schedules' && (
        <ScheduleListView
          schedules={schedules}
          playlists={playlists}
          business={business}
          onScheduleUpdate={loadSchedules}
        />
      )}
    </div>
  );
};

export default MusicSchedules;
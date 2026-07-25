import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FiDownload, FiRefreshCw } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const REPORT_OPTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'High-level music, playlist, schedule, and ad performance.'
  },
  {
    id: 'library',
    label: 'Library Health',
    description: 'Track uploads, shuffle coverage, and the latest songs added.'
  },
  {
    id: 'playlists',
    label: 'Playlist Activity',
    description: 'Review playlist sizes, schedule coverage, and upcoming runs.'
  },
  {
    id: 'ads',
    label: 'Ads & Revenue',
    description: 'Review ad plays, provider performance, and earned revenue.'
  },
  {
    id: 'history',
    label: 'Playback History',
    description: 'See which songs played, when they played, and which kiosk or player played them.'
  }
];

const TIMEFRAME_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' }
];

const HISTORY_GROUPING_OPTIONS = [
  { value: 'plays', label: 'By Play' },
  { value: 'day', label: 'By Day' },
  { value: 'month', label: 'By Month' }
];

const defaultData = {
  totalTracks: 0,
  recentUploads: 0,
  shuffleTracks: 0,
  playlists: [],
  installations: [],
  activeSchedules: 0,
  scheduledPlaylistCount: 0,
  upcomingSchedules: [],
  recentTracks: [],
  browserHasPlayback: false,
  browserPlayers: [],
  playbackLogs: [],
  totalSongPlays: 0,
  completedSongPlays: 0,
  skippedSongPlays: 0,
  playbackByKiosk: [],
  adPlays: 0,
  totalRevenue: 0,
  topProvider: null,
  revenueByProvider: [],
  dailyRevenue: [],
  selectedPlaylist: null
};

const formatCurrency = (value) => (
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD'
  }).format(Number(value || 0))
);

const formatNumber = (value) => (
  new Intl.NumberFormat('en-CA').format(Number(value || 0))
);

const formatDate = (value) => {
  if (!value) return 'Not set';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return 'Not set';

  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(parsedDate);
};

const formatDateTime = (value) => {
  if (!value) return 'Not set';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return 'Not set';

  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsedDate);
};

const formatMonthYear = (value) => {
  if (!value) return 'Not set';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return 'Not set';

  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'long'
  }).format(parsedDate);
};

const formatBrowserPlayerName = (deviceId) => {
  if (!deviceId) {
    return 'Browser Music Player';
  }

  const shortId = deviceId.length > 8 ? deviceId.slice(-8) : deviceId;
  return `Browser Player (${shortId})`;
};

const getDateRange = (timeframe, customDateStart, customDateEnd) => {
  const now = new Date();
  const start = new Date();

  switch (timeframe) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case '7d':
      start.setDate(now.getDate() - 7);
      break;
    case '30d':
      start.setDate(now.getDate() - 30);
      break;
    case '90d':
      start.setDate(now.getDate() - 90);
      break;
    case 'month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'year':
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'custom':
      return {
        start: customDateStart ? new Date(`${customDateStart}T00:00:00`).toISOString() : start.toISOString(),
        end: customDateEnd ? new Date(`${customDateEnd}T23:59:59`).toISOString() : now.toISOString()
      };
    default:
      start.setDate(now.getDate() - 30);
      break;
  }

  return {
    start: start.toISOString(),
    end: now.toISOString()
  };
};

const downloadJson = (filename, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const downloadCsv = (filename, rows) => {
  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const dedupePlaybackLogsForExport = (logs) => {
  const dedupedMap = new Map();

  (logs || []).forEach((log) => {
    const uniqueKey = [
      log.track_id || log.song_title || 'unknown-track',
      log.installation_id || 'browser',
      log.device_id || 'no-device',
      log.start_time || 'no-start-time'
    ].join('|');

    const existingLog = dedupedMap.get(uniqueKey);

    if (!existingLog) {
      dedupedMap.set(uniqueKey, log);
      return;
    }

    const existingScore =
      (existingLog.completed ? 4 : 0) +
      (existingLog.skipped ? 2 : 0) +
      (existingLog.duration_played ? 1 : 0);
    const candidateScore =
      (log.completed ? 4 : 0) +
      (log.skipped ? 2 : 0) +
      (log.duration_played ? 1 : 0);

    if (candidateScore > existingScore) {
      dedupedMap.set(uniqueKey, log);
      return;
    }

    if (candidateScore === existingScore && (log.duration_played || 0) > (existingLog.duration_played || 0)) {
      dedupedMap.set(uniqueKey, log);
    }
  });

  return Array.from(dedupedMap.values());
};

const MusicReportsContent = ({ businessId, canEditMusicReports }) => {
  const [reportType, setReportType] = useState('overview');
  const [timeframe, setTimeframe] = useState('30d');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('all');
  const [selectedKioskId, setSelectedKioskId] = useState('all');
  const [historyGrouping, setHistoryGrouping] = useState('plays');
  const [exportFormat, setExportFormat] = useState('json');
    const playbackHistoryLimit = reportType === 'history' ? 1000 : 200;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reportData, setReportData] = useState(defaultData);

  const loadMusicReportData = useCallback(async () => {
    if (!businessId) return;

    const { start, end } = getDateRange(timeframe, customDateStart, customDateEnd);

    try {
      setLoading(true);
      setError(null);

      const playlistsQuery = supabase
        .from('music_playlists')
        .select(`
          id,
          name,
          playlist_type,
          color_code,
          created_at,
          track_count:music_playlist_tracks(count)
        `)
        .eq('business_id', businessId)
        .order('name', { ascending: true });

      const activeSchedulesQuery = supabase
        .from('music_playlist_schedules')
        .select(`
          id,
          playlist_id,
          schedule_date,
          day_of_week,
          start_time,
          end_time,
          active,
          repeat_type,
          playlist:music_playlists(id, name, color_code)
        `)
        .eq('business_id', businessId)
        .eq('active', true);

      const installationsQuery = supabase
        .from('music_installations')
        .select('id, device_name, status, last_seen')
        .eq('business_id', businessId)
        .order('device_name', { ascending: true });

      const totalTracksQuery = supabase
        .from('music_tracks')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId);

      const recentUploadsCountQuery = supabase
        .from('music_tracks')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('uploaded_at', start)
        .lte('uploaded_at', end);

      const shuffleTracksQuery = supabase
        .from('music_tracks')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('include_in_shuffle', true);

      const recentTracksQuery = supabase
        .from('music_tracks')
        .select('id, title, artist, uploaded_at, include_in_shuffle')
        .eq('business_id', businessId)
        .order('uploaded_at', { ascending: false })
        .limit(5);

      const adPlaysQuery = supabase
        .from('music_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('played_at', start)
        .lte('played_at', end);

      const revenueQuery = supabase
        .from('music_ad_revenue_detailed')
        .select('business_payout, api_provider, created_at')
        .eq('business_id', businessId)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });

      const playbackLogsQuery = supabase
        .from('music_v2_playback_logs')
        .select(`
          id,
          track_id,
          playlist_id,
          installation_id,
          device_id,
          start_time,
          end_time,
          duration_played,
          completed,
          skipped,
          log_type
        `)
        .eq('business_id', businessId)
        .eq('log_type', 'song')
        .gte('start_time', start)
        .lte('start_time', end)
        .order('start_time', { ascending: false })
        .limit(playbackHistoryLimit);

      const browserPlayersQuery = supabase
        .from('music_v2_playback_logs')
        .select('device_id')
        .eq('business_id', businessId)
        .eq('log_type', 'song')
        .is('installation_id', null)
        .filter('device_id', 'not.is', 'null')
        .gte('start_time', start)
        .lte('start_time', end);

      const legacyBrowserPlaybackQuery = supabase
        .from('music_v2_playback_logs')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('log_type', 'song')
        .is('installation_id', null)
        .is('device_id', null)
        .gte('start_time', start)
        .lte('start_time', end);

      if (selectedPlaylistId !== 'all') {
        activeSchedulesQuery.eq('playlist_id', selectedPlaylistId);
        playbackLogsQuery.eq('playlist_id', selectedPlaylistId);
        browserPlayersQuery.eq('playlist_id', selectedPlaylistId);
        legacyBrowserPlaybackQuery.eq('playlist_id', selectedPlaylistId);
      }

      if (selectedKioskId === 'browser-legacy') {
        playbackLogsQuery.is('installation_id', null);
        playbackLogsQuery.is('device_id', null);
      } else if (selectedKioskId.startsWith('browser:')) {
        playbackLogsQuery.is('installation_id', null);
        playbackLogsQuery.eq('device_id', selectedKioskId.replace('browser:', ''));
      } else if (selectedKioskId !== 'all') {
        playbackLogsQuery.eq('installation_id', selectedKioskId);
      }

      const [
        { data: playlistsData, error: playlistsError },
        { data: schedulesData, error: schedulesError },
        { data: installationsData, error: installationsError },
        { count: totalTracks, error: totalTracksError },
        { count: recentUploads, error: recentUploadsError },
        { count: shuffleTracks, error: shuffleTracksError },
        { data: recentTracksData, error: recentTracksError },
        { data: playbackLogsData, error: playbackLogsError },
        { data: browserPlayersData, error: browserPlayersError },
        { count: legacyBrowserPlaybackCount, error: legacyBrowserPlaybackError },
        { count: adPlays, error: adPlaysError },
        { data: revenueRows, error: revenueError }
      ] = await Promise.all([
        playlistsQuery,
        activeSchedulesQuery,
        installationsQuery,
        totalTracksQuery,
        recentUploadsCountQuery,
        shuffleTracksQuery,
        recentTracksQuery,
        playbackLogsQuery,
        browserPlayersQuery,
        legacyBrowserPlaybackQuery,
        adPlaysQuery,
        revenueQuery
      ]);

      if (playlistsError) throw playlistsError;
      if (schedulesError) throw schedulesError;
      if (installationsError) throw installationsError;
      if (totalTracksError) throw totalTracksError;
      if (recentUploadsError) throw recentUploadsError;
      if (shuffleTracksError) throw shuffleTracksError;
      if (recentTracksError) throw recentTracksError;
      if (playbackLogsError) throw playbackLogsError;
      if (browserPlayersError) throw browserPlayersError;
      if (legacyBrowserPlaybackError) throw legacyBrowserPlaybackError;
      if (adPlaysError) throw adPlaysError;
      if (revenueError) throw revenueError;

      const playlists = (playlistsData || []).map((playlist) => ({
        ...playlist,
        track_count: playlist.track_count?.[0]?.count || 0
      }));

      const selectedPlaylist = selectedPlaylistId === 'all'
        ? null
        : playlists.find((playlist) => playlist.id === selectedPlaylistId) || null;

      const allInstallations = (installationsData || []).map((installation) => ({
        ...installation,
        label: installation.device_name || `Desktop Kiosk (${installation.id.substring(0, 8)})`
      }));

      const installationPlaybackCountPromises = allInstallations.map((installation) => (
        supabase
          .from('music_v2_playback_logs')
          .select('*', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('log_type', 'song')
          .eq('installation_id', installation.id)
      ));

      const installationPlaybackCounts = await Promise.all(installationPlaybackCountPromises);

      const installations = allInstallations.filter((installation, index) => {
        const result = installationPlaybackCounts[index];
        if (result?.error) {
          throw result.error;
        }

        return (result?.count || 0) > 0;
      });

      const installationsMap = installations.reduce((map, installation) => {
        map[installation.id] = installation.label;
        return map;
      }, {});

      const browserPlayers = [...new Set((browserPlayersData || []).map((row) => row.device_id).filter(Boolean))]
        .map((deviceId) => ({
          id: `browser:${deviceId}`,
          device_id: deviceId,
          label: formatBrowserPlayerName(deviceId)
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const upcomingSchedules = (schedulesData || [])
        .map((schedule) => ({
          ...schedule,
          sortKey: `${schedule.schedule_date || '9999-12-31'}T${schedule.start_time || '23:59:59'}`
        }))
        .sort((a, b) => new Date(a.sortKey) - new Date(b.sortKey))
        .slice(0, 6);

      const scheduledPlaylistCount = new Set(
        (schedulesData || []).map((schedule) => schedule.playlist_id).filter(Boolean)
      ).size;

      const playbackTrackIds = [...new Set((playbackLogsData || []).map((log) => log.track_id).filter(Boolean))];
      let playbackTracksMap = {};

      if (playbackTrackIds.length > 0) {
        const { data: playbackTracks, error: playbackTracksError } = await supabase
          .from('music_tracks')
          .select('id, title, artist')
          .in('id', playbackTrackIds);

        if (playbackTracksError) throw playbackTracksError;

        playbackTracksMap = (playbackTracks || []).reduce((map, track) => {
          map[track.id] = track;
          return map;
        }, {});
      }

      const playbackLogs = (playbackLogsData || []).map((log) => {
        const kioskName = log.installation_id
          ? installationsMap[log.installation_id] || `Desktop Kiosk (${log.installation_id.substring(0, 8)})`
          : formatBrowserPlayerName(log.device_id);
        const track = log.track_id ? playbackTracksMap[log.track_id] : null;

        return {
          ...log,
          kiosk_name: kioskName,
          song_title: track?.title || 'Unknown track',
          song_artist: track?.artist || 'Unknown artist'
        };
      });

      const dedupedPlaybackLogs = dedupePlaybackLogsForExport(playbackLogs)
        .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

      const totalSongPlays = dedupedPlaybackLogs.length;
      const completedSongPlays = dedupedPlaybackLogs.filter((log) => log.completed).length;
      const skippedSongPlays = dedupedPlaybackLogs.filter((log) => log.skipped).length;

      const playbackByKiosk = Object.entries(
        dedupedPlaybackLogs.reduce((accumulator, log) => {
          accumulator[log.kiosk_name] = (accumulator[log.kiosk_name] || 0) + 1;
          return accumulator;
        }, {})
      )
        .map(([name, plays]) => ({ name, plays }))
        .sort((a, b) => b.plays - a.plays);

      const availableKioskIds = new Set([
        'all',
        ...((legacyBrowserPlaybackCount || 0) > 0 ? ['browser-legacy'] : []),
        ...browserPlayers.map((browserPlayer) => browserPlayer.id),
        ...installations.map((installation) => installation.id)
      ]);

      if (!availableKioskIds.has(selectedKioskId)) {
        setSelectedKioskId('all');
      }

      const revenueByProviderMap = {};
      const dailyRevenueMap = {};

      (revenueRows || []).forEach((row) => {
        const amount = Number(row.business_payout || 0);
        const providerName = row.api_provider || 'Unknown';
        const dayKey = row.created_at?.split('T')?.[0] || 'Unknown';

        revenueByProviderMap[providerName] = (revenueByProviderMap[providerName] || 0) + amount;
        dailyRevenueMap[dayKey] = (dailyRevenueMap[dayKey] || 0) + amount;
      });

      const revenueByProvider = Object.entries(revenueByProviderMap)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

      const dailyRevenue = Object.entries(dailyRevenueMap)
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 7);

      setReportData({
        totalTracks: totalTracks || 0,
        recentUploads: recentUploads || 0,
        shuffleTracks: shuffleTracks || 0,
        playlists,
        installations,
        activeSchedules: (schedulesData || []).length,
        scheduledPlaylistCount,
        upcomingSchedules,
        recentTracks: recentTracksData || [],
        browserHasPlayback: (legacyBrowserPlaybackCount || 0) > 0,
        browserPlayers,
        playbackLogs: dedupedPlaybackLogs,
        totalSongPlays,
        completedSongPlays,
        skippedSongPlays,
        playbackByKiosk,
        adPlays: adPlays || 0,
        totalRevenue: (revenueRows || []).reduce((sum, row) => sum + Number(row.business_payout || 0), 0),
        topProvider: revenueByProvider[0] || null,
        revenueByProvider,
        dailyRevenue,
        selectedPlaylist
      });
    } catch (loadError) {
      console.error('Error loading music reports:', loadError);
      setError(loadError.message || 'Failed to load music reports.');
    } finally {
      setLoading(false);
    }
  }, [businessId, customDateEnd, customDateStart, selectedKioskId, selectedPlaylistId, timeframe]);

  useEffect(() => {
    loadMusicReportData();
  }, [loadMusicReportData]);

  const metrics = useMemo(() => {
    const averageTracksPerPlaylist = reportData.playlists.length
      ? reportData.playlists.reduce((sum, playlist) => sum + playlist.track_count, 0) / reportData.playlists.length
      : 0;

    const averageRevenuePerPlay = reportData.adPlays > 0
      ? reportData.totalRevenue / reportData.adPlays
      : 0;

    switch (reportType) {
      case 'library':
        return [
          { label: 'Total Tracks', value: formatNumber(reportData.totalTracks) },
          { label: 'New Uploads In Range', value: formatNumber(reportData.recentUploads) },
          { label: 'Shuffle Enabled', value: formatNumber(reportData.shuffleTracks) },
          {
            label: 'Shuffle Coverage',
            value: reportData.totalTracks > 0
              ? `${Math.round((reportData.shuffleTracks / reportData.totalTracks) * 100)}%`
              : '0%'
          }
        ];
      case 'playlists':
        return [
          { label: 'Playlists', value: formatNumber(reportData.playlists.length) },
          { label: 'Avg Tracks / Playlist', value: averageTracksPerPlaylist.toFixed(1) },
          { label: 'Active Schedules', value: formatNumber(reportData.activeSchedules) },
          { label: 'Scheduled Playlists', value: formatNumber(reportData.scheduledPlaylistCount) }
        ];
      case 'ads':
        return [
          { label: 'Ad Plays', value: formatNumber(reportData.adPlays) },
          { label: 'Revenue', value: formatCurrency(reportData.totalRevenue) },
          { label: 'Revenue / Play', value: formatCurrency(averageRevenuePerPlay) },
          { label: 'Top Provider', value: reportData.topProvider?.name || 'No provider data' }
        ];
      case 'history':
        return [
          { label: 'Song Plays', value: formatNumber(reportData.totalSongPlays) },
          { label: 'Completed Plays', value: formatNumber(reportData.completedSongPlays) },
          { label: 'Skipped Plays', value: formatNumber(reportData.skippedSongPlays) },
          { label: 'Active Kiosks / Players', value: formatNumber(reportData.playbackByKiosk.length) }
        ];
      case 'overview':
      default:
        return [
          { label: 'Tracks', value: formatNumber(reportData.totalTracks) },
          { label: 'Playlists', value: formatNumber(reportData.playlists.length) },
          { label: 'Active Schedules', value: formatNumber(reportData.activeSchedules) },
          { label: 'Ad Revenue', value: formatCurrency(reportData.totalRevenue) }
        ];
    }
  }, [reportData, reportType]);

  const historyGroupedRows = useMemo(() => {
    const groupedMap = new Map();

    reportData.playbackLogs.forEach((log) => {
      const dateValue = new Date(log.start_time);
      const groupKey = historyGrouping === 'month'
        ? `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}`
        : dateValue.toISOString().split('T')[0];

      const existing = groupedMap.get(groupKey) || {
        label: historyGrouping === 'month' ? formatMonthYear(log.start_time) : formatDate(log.start_time),
        plays: 0,
        uniqueSongs: new Set(),
        kiosks: new Set(),
        completed: 0,
        skipped: 0
      };

      existing.plays += 1;
      existing.uniqueSongs.add(`${log.song_title}::${log.song_artist}`);
      existing.kiosks.add(log.kiosk_name);
      if (log.completed) existing.completed += 1;
      if (log.skipped) existing.skipped += 1;

      groupedMap.set(groupKey, existing);
    });

    return Array.from(groupedMap.entries())
      .map(([key, value]) => ({
        key,
        label: value.label,
        plays: value.plays,
        uniqueSongs: value.uniqueSongs.size,
        kiosks: value.kiosks.size,
        completed: value.completed,
        skipped: value.skipped
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [historyGrouping, reportData.playbackLogs]);

  const buildCsvRows = () => {
    const metricRows = metrics.map((metric) => ({
      Section: 'Metric',
      Name: metric.label,
      Value: metric.value,
      Detail: '',
      Date: '',
      Kiosk: '',
      Song: '',
      Artist: '',
      Status: '',
      DurationSeconds: ''
    }));

    switch (reportType) {
      case 'library':
        return [
          ...metricRows,
          ...reportData.recentTracks.map((track) => ({
            Section: 'Recent Upload',
            Name: track.title || 'Untitled track',
            Value: track.include_in_shuffle ? 'In shuffle' : 'Manual only',
            Detail: track.artist || 'Unknown artist',
            Date: formatDate(track.uploaded_at),
            Kiosk: '',
            Song: '',
            Artist: '',
            Status: '',
            DurationSeconds: ''
          }))
        ];
      case 'playlists':
        return [
          ...metricRows,
          ...reportData.playlists.map((playlist) => ({
            Section: 'Playlist',
            Name: playlist.name,
            Value: playlist.track_count,
            Detail: playlist.playlist_type || '',
            Date: formatDate(playlist.created_at),
            Kiosk: '',
            Song: '',
            Artist: '',
            Status: '',
            DurationSeconds: ''
          }))
        ];
      case 'ads':
        return [
          ...metricRows,
          ...reportData.revenueByProvider.map((provider) => ({
            Section: 'Revenue Provider',
            Name: provider.name,
            Value: provider.amount,
            Detail: formatCurrency(provider.amount),
            Date: '',
            Kiosk: '',
            Song: '',
            Artist: '',
            Status: '',
            DurationSeconds: ''
          }))
        ];
      case 'history':
        if (historyGrouping === 'day' || historyGrouping === 'month') {
          return [
            ...metricRows,
            ...historyGroupedRows.map((row) => ({
              Section: historyGrouping === 'month' ? 'Playback By Month' : 'Playback By Day',
              Name: row.label,
              Value: row.plays,
              Detail: `${row.uniqueSongs} unique songs`,
              Date: row.label,
              Kiosk: `${row.kiosks} kiosks/players`,
              Song: '',
              Artist: '',
              Status: `${row.completed} completed / ${row.skipped} skipped`,
              DurationSeconds: ''
            }))
          ];
        }

        return [
          ...metricRows,
          ...reportData.playbackLogs.map((log) => ({
            Section: 'Playback',
            Name: log.kiosk_name,
            Value: formatDateTime(log.start_time),
            Detail: '',
            Date: formatDate(log.start_time),
            Kiosk: log.kiosk_name,
            Song: log.song_title,
            Artist: log.song_artist,
            Status: log.completed ? 'Completed' : log.skipped ? 'Skipped' : 'In progress',
            DurationSeconds: log.duration_played || ''
          }))
        ];
      case 'overview':
      default:
        return [
          ...metricRows,
          ...reportData.playlists.slice().sort((a, b) => b.track_count - a.track_count).slice(0, 5).map((playlist) => ({
            Section: 'Top Playlist',
            Name: playlist.name,
            Value: playlist.track_count,
            Detail: playlist.playlist_type || '',
            Date: '',
            Kiosk: '',
            Song: '',
            Artist: '',
            Status: '',
            DurationSeconds: ''
          }))
        ];
    }
  };

  const handleExport = () => {
    if (!canEditMusicReports) {
      toast.error('You do not have permission to export music reports');
      return;
    }

    if (exportFormat === 'csv') {
      downloadCsv(`music-report-${reportType}-${Date.now()}.csv`, buildCsvRows());
    } else {
      downloadJson(`music-report-${reportType}-${Date.now()}.json`, {
        reportType,
        timeframe,
        customDateStart,
        customDateEnd,
        selectedPlaylistId,
        selectedKioskId,
        generatedAt: new Date().toISOString(),
        data: reportData
      });
    }

    toast.success('Music report exported');
  };

  const styles = {
    container: {
      padding: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.white
    },
    headerRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.lg,
      flexWrap: 'wrap',
      marginBottom: TavariStyles.spacing.xl
    },
    headingBlock: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    title: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    subtitle: {
      margin: 0,
      color: TavariStyles.colors.gray600,
      maxWidth: '760px'
    },
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap'
    },
    exportGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    controlButton: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      cursor: 'pointer',
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    panel: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.gray50
    },
    segmentedControls: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap',
      marginBottom: TavariStyles.spacing.lg
    },
    segmentButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius.full,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer',
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    segmentButtonActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.primary}`
    },
    filterGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: TavariStyles.spacing.md
    },
    fieldGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    fieldLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    fieldInput: {
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.white
    },
    metricGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.xl
    },
    metricCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows.sm
    },
    metricLabel: {
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.xs
    },
    metricValue: {
      color: TavariStyles.colors.gray900,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    contentGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    sectionCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg
    },
    sectionTitle: {
      margin: `0 0 ${TavariStyles.spacing.md} 0`,
      color: TavariStyles.colors.gray800,
      fontSize: TavariStyles.typography.fontSize.lg
    },
    list: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    listRow: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      paddingBottom: TavariStyles.spacing.sm,
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`
    },
    listValue: {
      color: TavariStyles.colors.gray600,
      textAlign: 'right'
    },
    helperText: {
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.md
    },
    error: {
      backgroundColor: '#FEF2F2',
      color: '#B91C1C',
      border: '1px solid #FECACA',
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg
    },
    loading: {
      padding: TavariStyles.spacing.xl,
      textAlign: 'center',
      color: TavariStyles.colors.gray600
    },
    empty: {
      color: TavariStyles.colors.gray500,
      padding: `${TavariStyles.spacing.md} 0`
    }
  };

  const renderOverview = () => (
    <div style={styles.contentGrid}>
      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Most Populated Playlists</h3>
        <div style={styles.list}>
          {reportData.playlists.slice().sort((a, b) => b.track_count - a.track_count).slice(0, 5).map((playlist) => (
            <div key={playlist.id} style={styles.listRow}>
              <div>{playlist.name}</div>
              <div style={styles.listValue}>{formatNumber(playlist.track_count)} tracks</div>
            </div>
          ))}
          {reportData.playlists.length === 0 && <div style={styles.empty}>No playlists found for this business.</div>}
        </div>
      </div>

      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Upcoming Scheduled Playlists</h3>
        <div style={styles.list}>
          {reportData.upcomingSchedules.map((schedule) => (
            <div key={schedule.id} style={styles.listRow}>
              <div>
                <div>{schedule.playlist?.name || 'Unnamed playlist'}</div>
                <div style={styles.helperText}>
                  {schedule.schedule_date ? formatDate(schedule.schedule_date) : `Day ${schedule.day_of_week ?? '-'}`}
                </div>
              </div>
              <div style={styles.listValue}>
                {schedule.start_time || 'Start TBD'} - {schedule.end_time || 'End TBD'}
              </div>
            </div>
          ))}
          {reportData.upcomingSchedules.length === 0 && <div style={styles.empty}>No active schedules match the current filter.</div>}
        </div>
      </div>
    </div>
  );

  const renderLibrary = () => (
    <div style={styles.contentGrid}>
      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Recent Uploads</h3>
        <p style={styles.helperText}>Latest tracks added to the music library.</p>
        <div style={styles.list}>
          {reportData.recentTracks.map((track) => (
            <div key={track.id} style={styles.listRow}>
              <div>
                <div>{track.title || 'Untitled track'}</div>
                <div style={styles.helperText}>{track.artist || 'Unknown artist'}</div>
              </div>
              <div style={styles.listValue}>
                <div>{formatDate(track.uploaded_at)}</div>
                <div>{track.include_in_shuffle ? 'In shuffle' : 'Manual only'}</div>
              </div>
            </div>
          ))}
          {reportData.recentTracks.length === 0 && <div style={styles.empty}>No uploaded tracks found yet.</div>}
        </div>
      </div>

      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Library Health Notes</h3>
        <div style={styles.list}>
          <div style={styles.listRow}>
            <div>Shuffle-ready tracks</div>
            <div style={styles.listValue}>{formatNumber(reportData.shuffleTracks)}</div>
          </div>
          <div style={styles.listRow}>
            <div>Tracks not in shuffle</div>
            <div style={styles.listValue}>{formatNumber(Math.max(reportData.totalTracks - reportData.shuffleTracks, 0))}</div>
          </div>
          <div style={styles.listRow}>
            <div>Uploads in selected period</div>
            <div style={styles.listValue}>{formatNumber(reportData.recentUploads)}</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPlaylists = () => (
    <div style={styles.contentGrid}>
      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Playlist Summary</h3>
        {reportData.selectedPlaylist ? (
          <div style={styles.list}>
            <div style={styles.listRow}>
              <div>Selected playlist</div>
              <div style={styles.listValue}>{reportData.selectedPlaylist.name}</div>
            </div>
            <div style={styles.listRow}>
              <div>Playlist type</div>
              <div style={styles.listValue}>{reportData.selectedPlaylist.playlist_type || 'Unknown'}</div>
            </div>
            <div style={styles.listRow}>
              <div>Tracks in playlist</div>
              <div style={styles.listValue}>{formatNumber(reportData.selectedPlaylist.track_count)}</div>
            </div>
            <div style={styles.listRow}>
              <div>Created</div>
              <div style={styles.listValue}>{formatDate(reportData.selectedPlaylist.created_at)}</div>
            </div>
          </div>
        ) : (
          <div style={styles.list}>
            {reportData.playlists.map((playlist) => (
              <div key={playlist.id} style={styles.listRow}>
                <div>
                  <div>{playlist.name}</div>
                  <div style={styles.helperText}>{playlist.playlist_type || 'Unknown type'}</div>
                </div>
                <div style={styles.listValue}>{formatNumber(playlist.track_count)} tracks</div>
              </div>
            ))}
            {reportData.playlists.length === 0 && <div style={styles.empty}>No playlists created yet.</div>}
          </div>
        )}
      </div>

      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Upcoming Runs</h3>
        <div style={styles.list}>
          {reportData.upcomingSchedules.map((schedule) => (
            <div key={schedule.id} style={styles.listRow}>
              <div>
                <div>{schedule.playlist?.name || 'Unnamed playlist'}</div>
                <div style={styles.helperText}>{schedule.repeat_type || 'One time'}</div>
              </div>
              <div style={styles.listValue}>
                <div>{schedule.schedule_date ? formatDate(schedule.schedule_date) : `Day ${schedule.day_of_week ?? '-'}`}</div>
                <div>{schedule.start_time || 'Start TBD'} - {schedule.end_time || 'End TBD'}</div>
              </div>
            </div>
          ))}
          {reportData.upcomingSchedules.length === 0 && <div style={styles.empty}>No schedules match the current playlist filter.</div>}
        </div>
      </div>
    </div>
  );

  const renderAds = () => (
    <div style={styles.contentGrid}>
      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Revenue By Provider</h3>
        <div style={styles.list}>
          {reportData.revenueByProvider.map((provider) => (
            <div key={provider.name} style={styles.listRow}>
              <div>{provider.name}</div>
              <div style={styles.listValue}>{formatCurrency(provider.amount)}</div>
            </div>
          ))}
          {reportData.revenueByProvider.length === 0 && <div style={styles.empty}>No ad revenue recorded in this date range.</div>}
        </div>
      </div>

      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Recent Revenue Days</h3>
        <div style={styles.list}>
          {reportData.dailyRevenue.map((day) => (
            <div key={day.date} style={styles.listRow}>
              <div>{formatDate(day.date)}</div>
              <div style={styles.listValue}>{formatCurrency(day.amount)}</div>
            </div>
          ))}
          {reportData.dailyRevenue.length === 0 && <div style={styles.empty}>No recent revenue days available.</div>}
        </div>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div style={styles.contentGrid}>
      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>
          {historyGrouping === 'plays'
            ? 'Recent Songs Played'
            : historyGrouping === 'day'
              ? 'Songs Played By Day'
              : 'Songs Played By Month'}
        </h3>
        <p style={styles.helperText}>
          {historyGrouping === 'plays'
            ? 'The latest tracked song plays for the selected date range, playlist, and kiosk filter.'
            : 'Grouped playback totals for the selected date range, playlist, and kiosk filter.'}
        </p>
        <div style={styles.list}>
          {historyGrouping === 'plays' && reportData.playbackLogs.map((log) => (
            <div key={log.id} style={styles.listRow}>
              <div>
                <div>{log.song_title}</div>
                <div style={styles.helperText}>{log.song_artist}</div>
                <div style={styles.helperText}>{log.kiosk_name}</div>
              </div>
              <div style={styles.listValue}>
                <div>{formatDateTime(log.start_time)}</div>
                <div>
                  {log.completed ? 'Completed' : log.skipped ? 'Skipped' : 'In progress'}
                </div>
                <div>{log.duration_played ? `${formatNumber(log.duration_played)} sec` : 'Duration n/a'}</div>
              </div>
            </div>
          ))}
          {(historyGrouping === 'day' || historyGrouping === 'month') && historyGroupedRows.map((row) => (
            <div key={row.key} style={styles.listRow}>
              <div>
                <div>{row.label}</div>
                <div style={styles.helperText}>{row.uniqueSongs} unique songs</div>
                <div style={styles.helperText}>{row.kiosks} kiosks / players</div>
              </div>
              <div style={styles.listValue}>
                <div>{formatNumber(row.plays)} plays</div>
                <div>{formatNumber(row.completed)} completed</div>
                <div>{formatNumber(row.skipped)} skipped</div>
              </div>
            </div>
          ))}
          {((historyGrouping === 'plays' && reportData.playbackLogs.length === 0) ||
            ((historyGrouping === 'day' || historyGrouping === 'month') && historyGroupedRows.length === 0)) && (
            <div style={styles.empty}>No song playback history was found for the current filters.</div>
          )}
        </div>
      </div>

      <div style={styles.sectionCard}>
        <h3 style={styles.sectionTitle}>Plays By Kiosk / Player</h3>
        <p style={styles.helperText}>
          Compare how many songs were played from each kiosk or browser player.
        </p>
        <div style={styles.list}>
          {reportData.playbackByKiosk.map((entry) => (
            <div key={entry.name} style={styles.listRow}>
              <div>{entry.name}</div>
              <div style={styles.listValue}>{formatNumber(entry.plays)} plays</div>
            </div>
          ))}
          {reportData.playbackByKiosk.length === 0 && (
            <div style={styles.empty}>No kiosk playback totals are available for the current filters.</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <div style={styles.headingBlock}>
          <h2 style={styles.title}>Music Reports</h2>
          <p style={styles.subtitle}>
            Use the controls below to review library growth, playlist usage, schedule activity, and ad revenue from the music module.
          </p>
        </div>

        <div style={styles.actions}>
          <button type="button" style={styles.controlButton} onClick={loadMusicReportData}>
            <FiRefreshCw />
            Refresh
          </button>
          <div style={styles.exportGroup}>
            <button type="button" style={styles.controlButton} onClick={handleExport}>
              <FiDownload />
              Export
            </button>
            <select
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value)}
              style={styles.fieldInput}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      <div style={styles.panel}>
        <div style={styles.segmentedControls}>
          {REPORT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setReportType(option.id)}
              style={{
                ...styles.segmentButton,
                ...(reportType === option.id ? styles.segmentButtonActive : {})
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p style={styles.helperText}>
          {REPORT_OPTIONS.find((option) => option.id === reportType)?.description}
        </p>

        <div style={styles.filterGrid}>
          <div style={styles.fieldGroup}>
            <label htmlFor="music-report-range" style={styles.fieldLabel}>Date Range</label>
            <select
              id="music-report-range"
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value)}
              style={styles.fieldInput}
            >
              {TIMEFRAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {timeframe === 'custom' && (
            <>
              <div style={styles.fieldGroup}>
                <label htmlFor="music-report-start" style={styles.fieldLabel}>Start Date</label>
                <input
                  id="music-report-start"
                  type="date"
                  value={customDateStart}
                  onChange={(event) => setCustomDateStart(event.target.value)}
                  style={styles.fieldInput}
                />
              </div>

              <div style={styles.fieldGroup}>
                <label htmlFor="music-report-end" style={styles.fieldLabel}>End Date</label>
                <input
                  id="music-report-end"
                  type="date"
                  value={customDateEnd}
                  onChange={(event) => setCustomDateEnd(event.target.value)}
                  style={styles.fieldInput}
                />
              </div>
            </>
          )}

          <div style={styles.fieldGroup}>
            <label htmlFor="music-report-playlist" style={styles.fieldLabel}>Playlist Filter</label>
            <select
              id="music-report-playlist"
              value={selectedPlaylistId}
              onChange={(event) => setSelectedPlaylistId(event.target.value)}
              style={styles.fieldInput}
            >
              <option value="all">All playlists</option>
              {reportData.playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.fieldGroup}>
            <label htmlFor="music-report-kiosk" style={styles.fieldLabel}>Kiosk / Player</label>
            <select
              id="music-report-kiosk"
              value={selectedKioskId}
              onChange={(event) => setSelectedKioskId(event.target.value)}
              style={styles.fieldInput}
            >
              <option value="all">All kiosks and players</option>
              {reportData.browserHasPlayback && (
                <option value="browser-legacy">Browser Music Player</option>
              )}
              {reportData.browserPlayers.map((browserPlayer) => (
                <option key={browserPlayer.id} value={browserPlayer.id}>
                  {browserPlayer.label}
                </option>
              ))}
              {reportData.installations.map((installation) => (
                <option key={installation.id} value={installation.id}>
                  {installation.label}
                </option>
              ))}
            </select>
          </div>

          {reportType === 'history' && (
            <div style={styles.fieldGroup}>
              <label htmlFor="music-report-history-grouping" style={styles.fieldLabel}>History View</label>
              <select
                id="music-report-history-grouping"
                value={historyGrouping}
                onChange={(event) => setHistoryGrouping(event.target.value)}
                style={styles.fieldInput}
              >
                {HISTORY_GROUPING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div style={styles.loading}>Loading music report data...</div>
      ) : (
        <>
          <div style={styles.metricGrid}>
            {metrics.map((metric) => (
              <div key={metric.label} style={styles.metricCard}>
                <div style={styles.metricLabel}>{metric.label}</div>
                <div style={styles.metricValue}>{metric.value}</div>
              </div>
            ))}
          </div>

          {reportType === 'overview' && renderOverview()}
          {reportType === 'library' && renderLibrary()}
          {reportType === 'playlists' && renderPlaylists()}
          {reportType === 'ads' && renderAds()}
          {reportType === 'history' && renderHistory()}
        </>
      )}
    </div>
  );
};

export default MusicReportsContent;

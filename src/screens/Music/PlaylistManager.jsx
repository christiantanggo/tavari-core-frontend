// src/screens/Music/PlaylistManager.jsx - WITH PERMISSION SYSTEM INTEGRATION
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { FiPlus, FiEdit, FiTrash, FiMusic, FiShuffle, FiList, FiX, FiSkipForward, FiLock, FiAlertCircle } from 'react-icons/fi';

// Tavari Build Standards - Required imports
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

// Context
import { useBusiness } from '../../contexts/BusinessContext';

// Components
import TrackManagerModal from './TrackManagerModal';
import styles from './PlaylistManager.module.css';

/**
 * Playlist Manager - Create and manage music playlists
 * Integrates with Tavari permission system for access control
 */
const PlaylistManager = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();

  // Tavari standardized authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'PlaylistManager'
  });

  // Permission system integration
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Tavari standardized security
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: false, // DISABLED - prevents AudioContext errors
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'PlaylistManager',
    sensitiveComponent: false
  });

  const [playlists, setPlaylists] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [showTrackManager, setShowTrackManager] = useState(null);
  const [showDeleteWarning, setShowDeleteWarning] = useState(null);

  // Form states
  const [playlistForm, setPlaylistForm] = useState({
    name: '',
    description: '',
    playlist_type: 'ordered',
    color_code: '#14B8A6',
    shuffle_include_new_uploads: true,
    priority: 1
  });

  // Permission checks based on permissionRegistry.js
  const canViewPlaylists = true; // Anyone with access can view
  const canCreatePlaylists = hasPermission('music.playlists.create') || hasElevatedPrivileges();
  const canEditPlaylists = hasPermission('music.playlists.create') || hasElevatedPrivileges();
  const canDeletePlaylists = hasPermission('music.playlists.create') || hasElevatedPrivileges();
  const canForceSkip = hasPermission('music.control.play_pause') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewPlaylists) {
      toast.error('You do not have permission to view playlists');
      navigate('/dashboard/music/dashboard');
    }
  }, [permissionsLoading, canViewPlaylists, navigate]);

  // Helper function to get random color for playlists
  const getRandomColor = () => {
    const colors = [
      '#14B8A6', '#10B981', '#0D9488', '#059669', 
      '#047857', '#065F46', '#064E3B', '#022C22'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // Load playlists with security logging
  const loadPlaylists = async () => {
    if (!business?.id) return;
    
    try {
      // Security logging
      if (security && security.logSecurityEvent) {
        await security.logSecurityEvent('playlists_accessed', {
          business_id: business.id,
          user_id: auth.authUser?.id,
          permissions: {
            canCreate: canCreatePlaylists,
            canEdit: canEditPlaylists,
            canDelete: canDeletePlaylists
          }
        }, 'low');
      }

      const { data, error } = await supabase
        .from('music_playlists')
        .select(`
          *,
          track_count:music_playlist_tracks(count)
        `)
        .eq('business_id', business.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Process track counts
      const processedPlaylists = data.map(playlist => ({
        ...playlist,
        track_count: playlist.track_count?.[0]?.count || 0
      }));
      
      setPlaylists(processedPlaylists);
    } catch (error) {
      console.error('Error loading playlists:', error);
      toast.error('Failed to load playlists');
    }
  };

  // Load tracks for playlist creation
  const loadTracks = async () => {
    if (!business?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('music_tracks')
        .select('*')
        .eq('business_id', business.id)
        .order('title', { ascending: true });

      if (error) throw error;
      setTracks(data || []);
    } catch (error) {
      console.error('Error loading tracks:', error);
      toast.error('Failed to load tracks');
    }
  };

  // Load all data
  useEffect(() => {
    if (business?.id && !permissionsLoading) {
      setLoading(true);
      Promise.all([loadPlaylists(), loadTracks()])
        .finally(() => setLoading(false));
    }
  }, [business?.id, permissionsLoading]);

  // Create playlist with permission check
  const createPlaylist = async (e) => {
    e.preventDefault();

    // Permission check
    if (!canCreatePlaylists) {
      toast.error('You do not have permission to create playlists');
      return;
    }

    if (!business?.id) {
      toast.error('Please select a business first');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('music_playlists')
        .insert([{
          name: playlistForm.name,
          description: playlistForm.description,
          playlist_type: playlistForm.playlist_type,
          color_code: playlistForm.color_code || getRandomColor(),
          shuffle_include_new_uploads: playlistForm.shuffle_include_new_uploads,
          business_id: business.id
        }])
        .select()
        .single();

      if (error) throw error;

      // Security logging
      await security.logSecurityEvent?.('playlist_created', {
        playlist_id: data.id,
        playlist_name: data.name,
        created_by: auth.authUser.id,
        business_id: business.id
      }, 'low');

      setPlaylists(prev => [data, ...prev]);
      setShowCreatePlaylist(false);
      setPlaylistForm({
        name: '',
        description: '',
        playlist_type: 'ordered',
        color_code: '#14B8A6',
        shuffle_include_new_uploads: true,
        priority: 1
      });

      toast.success('Playlist created successfully');
    } catch (error) {
      console.error('Error creating playlist:', error);
      toast.error('Error creating playlist: ' + error.message);
    }
  };

  // Check if playlist is used in schedules
  const checkPlaylistSchedules = async (playlistId) => {
    try {
      const { data, error } = await supabase
        .from('music_playlist_schedules')
        .select(`
          id,
          schedule_date,
          day_of_week,
          start_time,
          end_time,
          active,
          repeat_type
        `)
        .eq('playlist_id', playlistId)
        .eq('business_id', business.id);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error checking playlist schedules:', error);
      return [];
    }
  };

  // Initiate playlist deletion with schedule check and permission
  const initiateDeletePlaylist = async (playlist) => {
    // Permission check
    if (!canDeletePlaylists) {
      toast.error('You do not have permission to delete playlists');
      return;
    }

    console.log('🗑️ Checking schedules for playlist:', playlist.name);
    
    const schedules = await checkPlaylistSchedules(playlist.id);
    
    if (schedules.length > 0) {
      console.log('⚠️ Found', schedules.length, 'schedule(s) using this playlist');
      setShowDeleteWarning({
        playlist,
        schedules
      });
    } else {
      console.log('✅ No schedules found, proceeding with deletion');
      if (window.confirm(`Are you sure you want to delete "${playlist.name}"? This action cannot be undone.`)) {
        await deletePlaylist(playlist.id);
      }
    }
  };

  // Delete playlist with permission check
  const deletePlaylist = async (playlistId, forceDelete = false) => {
    // Permission check
    if (!canDeletePlaylists) {
      toast.error('You do not have permission to delete playlists');
      return;
    }

    try {
      if (forceDelete) {
        console.log('🗑️ Force deleting playlist and all schedules:', playlistId);
        
        // Delete all schedules first
        const { error: schedulesError } = await supabase
          .from('music_playlist_schedules')
          .delete()
          .eq('playlist_id', playlistId)
          .eq('business_id', business.id);

        if (schedulesError) {
          console.warn('Schedules delete warning:', schedulesError);
        }
      }

      // Delete all tracks from the playlist
      const { error: tracksError } = await supabase
        .from('music_playlist_tracks')
        .delete()
        .eq('playlist_id', playlistId);

      if (tracksError) {
        console.error('Error removing tracks from playlist:', tracksError);
        throw new Error(`Failed to remove tracks from playlist: ${tracksError.message}`);
      }

      // Delete the playlist itself
      const { error: playlistError } = await supabase
        .from('music_playlists')
        .delete()
        .eq('id', playlistId)
        .eq('business_id', business.id);

      if (playlistError) {
        console.error('Error deleting playlist:', playlistError);
        throw new Error(`Failed to delete playlist: ${playlistError.message}`);
      }

      console.log('✅ Successfully deleted playlist');

      // Security logging
      await security.logSecurityEvent?.('playlist_deleted', {
        playlist_id: playlistId,
        deleted_by: auth.authUser.id,
        business_id: business.id,
        force_delete: forceDelete
      }, 'medium');

      // Update local state
      setPlaylists(prev => prev.filter(p => p.id !== playlistId));
      setShowDeleteWarning(null);
      
      toast.success('Playlist deleted successfully');
      
    } catch (error) {
      console.error('Error deleting playlist:', error);
      toast.error('Error deleting playlist: ' + error.message);
    }
  };

  // Force skip current playlist with permission check
  const forceSkipPlaylist = async () => {
    // Permission check
    if (!canForceSkip) {
      toast.error('You do not have permission to force skip playlists');
      return;
    }

    try {
      console.log('⏭️ Force skipping current playlist');
      
      // Check if globalMusicService is available
      if (window.globalMusicService) {
        // Force switch to shuffle mode
        await window.globalMusicService.switchToShuffle();
        
        // Security logging
        await security.logSecurityEvent?.('playlist_force_skipped', {
          forced_by: auth.authUser.id,
          business_id: business.id
        }, 'low');

        toast.success('Switched to shuffle mode');
      } else {
        console.error('GlobalMusicService not available');
        toast.error('Music service not available. Try refreshing the page.');
      }
    } catch (error) {
      console.error('Error force skipping playlist:', error);
      toast.error('Error switching playlist: ' + error.message);
    }
  };

  // Format schedule info for display
  const formatScheduleInfo = (schedule) => {
    const time = `${schedule.start_time} - ${schedule.end_time}`;
    
    if (schedule.schedule_date) {
      const date = new Date(schedule.schedule_date + 'T00:00:00').toLocaleDateString();
      const repeatInfo = schedule.repeat_type !== 'once' ? ` (${schedule.repeat_type})` : '';
      return `${date} ${time}${repeatInfo}`;
    } else if (schedule.day_of_week !== null) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `${days[schedule.day_of_week]} ${time}`;
    }
    
    return time;
  };

  // Show loading while permissions are being checked
  if (permissionsLoading || loading) {
    return (
      <POSAuthWrapper
        componentName="PlaylistManager"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper
          componentName="PlaylistManager"
          sensitiveComponent={false}
        >
          <div className={styles.container}>
            <div className={styles.loading}>
              {permissionsLoading ? 'Loading permissions...' : 'Loading playlists...'}
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  // Show access denied if no permission
  if (!canViewPlaylists) {
    return (
      <POSAuthWrapper
        componentName="PlaylistManager"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper
          componentName="PlaylistManager"
          sensitiveComponent={false}
        >
          <div className={styles.container}>
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              backgroundColor: 'white',
              borderRadius: '8px',
              border: '1px solid #ddd',
              marginTop: '40px'
            }}>
              <FiLock size={64} style={{ color: '#f44336', marginBottom: '20px' }} />
              <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>Access Denied</h2>
              <p style={{ fontSize: '16px', color: '#666', marginBottom: '20px' }}>
                You do not have permission to view playlists.
              </p>
              <button 
                onClick={() => navigate('/dashboard/music/dashboard')}
                className={styles.primaryButton}
              >
                Back to Music Dashboard
              </button>
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      componentName="PlaylistManager"
      requiredRoles={['manager', 'owner']}
    >
      <SecurityWrapper
        componentName="PlaylistManager"
        sensitiveComponent={false}
        enableRateLimiting={true}
        enableAuditLogging={true}
      >
        <div className={styles.container}>
          {/* Header */}
          <div className={styles.header}>
            <h1 className={styles.title}>Playlist Manager</h1>
            <p className={styles.subtitle}>Create and manage playlists for your music system</p>
            {!canCreatePlaylists && !canEditPlaylists && !canDeletePlaylists && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                backgroundColor: '#EFF6FF',
                border: '2px solid #3B82F6',
                borderRadius: '6px',
                color: '#1E40AF',
                fontSize: '14px',
                fontWeight: '500',
                marginTop: '12px'
              }}>
                <FiAlertCircle />
                <span>View Only - Contact admin to create or edit playlists</span>
              </div>
            )}
          </div>

          {/* Action Buttons - Tavari 3x Grid Standard with Permissions */}
          <div className={styles.actionGrid}>
            {/* Create Playlist Button - Protected */}
            <PermissionGate
              permission="music.playlists.create"
              fallback={
                <button
                  disabled
                  className={styles.actionButton}
                  style={{ opacity: 0.5, cursor: 'not-allowed' }}
                  title="Permission required to create playlists"
                >
                  <FiLock className={styles.actionIcon} />
                  Create Playlist
                </button>
              }
            >
              <button
                onClick={() => setShowCreatePlaylist(true)}
                className={styles.actionButton}
              >
                <FiPlus className={styles.actionIcon} />
                Create Playlist
              </button>
            </PermissionGate>

            {/* Force Skip Button - Protected */}
            <PermissionGate
              permission="music.control.play_pause"
              fallback={
                <button
                  disabled
                  className={styles.actionButton}
                  style={{ opacity: 0.5, cursor: 'not-allowed', borderColor: '#f59e0b', color: '#f59e0b' }}
                  title="Permission required to force skip"
                >
                  <FiLock className={styles.actionIcon} />
                  Force Skip
                </button>
              }
            >
              <button
                onClick={forceSkipPlaylist}
                className={styles.actionButton}
                style={{ borderColor: '#f59e0b', color: '#f59e0b' }}
              >
                <FiSkipForward className={styles.actionIcon} />
                Force Skip Playlist
              </button>
            </PermissionGate>

            <button disabled className={styles.actionButton}>
              <FiEdit className={styles.actionIcon} />
              Bulk Edit
            </button>
          </div>

          {/* Playlists Grid */}
          {playlists.length > 0 ? (
            <div className={styles.playlistGrid}>
              {playlists.map((playlist) => (
                <div key={playlist.id} className={styles.playlistCard}>
                  <div className={styles.playlistHeader}>
                    <div className={styles.playlistInfo}>
                      <div
                        className={styles.colorIndicator}
                        style={{ backgroundColor: playlist.color_code }}
                      />
                      <div>
                        <h3 className={styles.playlistTitle}>{playlist.name}</h3>
                        <div className={styles.playlistMeta}>
                          {playlist.playlist_type === 'shuffle' ? (
                            <><FiShuffle /> Shuffle</>
                          ) : (
                            <><FiList /> Ordered</>
                          )}
                          <span>• {playlist.track_count} tracks</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.playlistActions}>
                      {/* Manage Tracks Button - Protected */}
                      {canEditPlaylists ? (
                        <button
                          onClick={() => setShowTrackManager(playlist)}
                          className={`${styles.iconButton} ${styles.primary}`}
                          title="Manage Tracks"
                        >
                          <FiMusic />
                        </button>
                      ) : (
                        <button
                          disabled
                          className={`${styles.iconButton}`}
                          style={{ opacity: 0.5, cursor: 'not-allowed' }}
                          title="Permission required to manage tracks"
                        >
                          <FiLock />
                        </button>
                      )}
                      
                      {/* Delete Button - Protected */}
                      {canDeletePlaylists ? (
                        <button
                          onClick={() => initiateDeletePlaylist(playlist)}
                          className={`${styles.iconButton} ${styles.danger}`}
                          title="Delete Playlist"
                        >
                          <FiTrash />
                        </button>
                      ) : (
                        <button
                          disabled
                          className={`${styles.iconButton}`}
                          style={{ opacity: 0.5, cursor: 'not-allowed' }}
                          title="Permission required to delete playlists"
                        >
                          <FiLock />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {playlist.description && (
                    <p className={styles.playlistDescription}>{playlist.description}</p>
                  )}
                  
                  <div className={styles.playlistDate}>
                    <div>Created {new Date(playlist.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <FiMusic className={styles.emptyIcon} />
              <h3 className={styles.emptyTitle}>No playlists yet</h3>
              <p className={styles.emptyDescription}>Create your first playlist to get started</p>
              {canCreatePlaylists ? (
                <button onClick={() => setShowCreatePlaylist(true)} className={styles.primaryButton}>
                  Create Playlist
                </button>
              ) : (
                <p style={{ color: '#666', marginTop: '16px' }}>
                  Contact your administrator to create playlists
                </p>
              )}
            </div>
          )}

          {/* Track Manager Modal - Pass permissions */}
          {showTrackManager && (
            <TrackManagerModal
              playlist={showTrackManager}
              onClose={() => setShowTrackManager(null)}
              onUpdate={loadPlaylists}
              permissions={{
                canEdit: canEditPlaylists
              }}
            />
          )}

          {/* Delete Warning Modal */}
          {showDeleteWarning && (
            <div className={styles.modalOverlay}>
              <div className={styles.modal}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>⚠️ Playlist Used in Schedules</h2>
                  <button
                    onClick={() => setShowDeleteWarning(null)}
                    className={styles.closeButton}
                  >
                    <FiX />
                  </button>
                </div>
                
                <div style={{ marginBottom: '20px' }}>
                  <p style={{ fontSize: '16px', marginBottom: '15px' }}>
                    The playlist "<strong>{showDeleteWarning.playlist.name}</strong>" is currently used in the following schedules:
                  </p>
                  
                  <div style={{ 
                    backgroundColor: '#fef3c7', 
                    border: '1px solid #f59e0b', 
                    borderRadius: '8px', 
                    padding: '15px',
                    marginBottom: '20px'
                  }}>
                    {showDeleteWarning.schedules.map((schedule, index) => (
                      <div key={schedule.id} style={{ marginBottom: '8px' }}>
                        <strong>Schedule {index + 1}:</strong> {formatScheduleInfo(schedule)}
                        {schedule.active && <span style={{ color: '#059669', marginLeft: '10px' }}>• Active</span>}
                        {!schedule.active && <span style={{ color: '#6b7280', marginLeft: '10px' }}>• Inactive</span>}
                      </div>
                    ))}
                  </div>
                  
                  <p style={{ fontSize: '14px', color: '#666' }}>
                    Deleting this playlist will also remove all associated schedules. This action cannot be undone.
                  </p>
                </div>

                <div className={styles.buttonGroup}>
                  <button
                    onClick={() => setShowDeleteWarning(null)}
                    className={`${styles.button} ${styles.secondary}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deletePlaylist(showDeleteWarning.playlist.id, true)}
                    className={`${styles.button} ${styles.primary}`}
                    style={{ backgroundColor: '#dc3545', borderColor: '#dc3545' }}
                  >
                    Delete Playlist & Schedules
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Create Playlist Modal */}
          {showCreatePlaylist && canCreatePlaylists && (
            <div className={styles.modalOverlay}>
              <div className={styles.modal}>
                <div className={styles.modalHeader}>
                  <h2 className={styles.modalTitle}>Create New Playlist</h2>
                  <button
                    onClick={() => setShowCreatePlaylist(false)}
                    className={styles.closeButton}
                  >
                    <FiX />
                  </button>
                </div>
                <form onSubmit={createPlaylist}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Playlist Name</label>
                    <input
                      type="text"
                      value={playlistForm.name}
                      onChange={(e) => setPlaylistForm(prev => ({ ...prev, name: e.target.value }))}
                      className={styles.input}
                      required
                    />
                  </div>
                  
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Description</label>
                    <textarea
                      value={playlistForm.description}
                      onChange={(e) => setPlaylistForm(prev => ({ ...prev, description: e.target.value }))}
                      className={styles.textarea}
                      rows="3"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Playlist Type</label>
                    <select
                      value={playlistForm.playlist_type}
                      onChange={(e) => setPlaylistForm(prev => ({ ...prev, playlist_type: e.target.value }))}
                      className={styles.select}
                    >
                      <option value="ordered">Ordered</option>
                      <option value="shuffle">Shuffle</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Color</label>
                    <input
                      type="color"
                      value={playlistForm.color_code}
                      onChange={(e) => setPlaylistForm(prev => ({ ...prev, color_code: e.target.value }))}
                      className={styles.colorInput}
                    />
                  </div>

                  {playlistForm.playlist_type === 'shuffle' && (
                    <div className={styles.formGroup}>
                      <label className={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={playlistForm.shuffle_include_new_uploads}
                          onChange={(e) => setPlaylistForm(prev => ({ 
                            ...prev, 
                            shuffle_include_new_uploads: e.target.checked 
                          }))}
                          className={styles.checkbox}
                        />
                        Include new uploads automatically
                      </label>
                    </div>
                  )}

                  <div className={styles.buttonGroup}>
                    <button
                      type="button"
                      onClick={() => setShowCreatePlaylist(false)}
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
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default PlaylistManager;
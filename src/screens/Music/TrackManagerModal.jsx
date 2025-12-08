import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { FiPlus, FiTrash, FiMusic, FiX, FiMove, FiLock } from 'react-icons/fi';
import styles from './PlaylistManager.module.css';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

const TrackManagerModal = ({ playlist, onClose, onUpdate }) => {
  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    isManager,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canEditPlaylists = hasPermission('music.playlists.create') || hasElevatedPrivileges();
  const canAddTracks = hasPermission('music.playlists.create') || hasElevatedPrivileges();
  const canRemoveTracks = hasPermission('music.playlists.create') || hasElevatedPrivileges();
  const canReorderTracks = hasPermission('music.playlists.create') || hasElevatedPrivileges();

  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [availableTracks, setAvailableTracks] = useState([]);
  const [trackSearchTerm, setTrackSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Load playlist tracks
  const loadPlaylistTracks = async () => {
    if (!playlist?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('music_playlist_tracks')
        .select(`
          *,
          track:music_tracks(*)
        `)
        .eq('playlist_id', playlist.id)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setPlaylistTracks(data || []);
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
      toast.error('Error loading playlist tracks');
    }
  };

  // Load available tracks
  const loadAvailableTracks = async () => {
    if (!playlist?.business_id) return;
    
    try {
      const { data, error } = await supabase
        .from('music_tracks')
        .select('*')
        .eq('business_id', playlist.business_id)
        .order('title', { ascending: true });

      if (error) throw error;
      setAvailableTracks(data || []);
    } catch (error) {
      console.error('Error loading available tracks:', error);
      toast.error('Error loading available tracks');
    }
  };

  // Load data on mount
  useEffect(() => {
    if (playlist?.id) {
      setLoading(true);
      Promise.all([loadPlaylistTracks(), loadAvailableTracks()])
        .finally(() => setLoading(false));
    }
  }, [playlist?.id]);

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Add track to playlist
  const addTrackToPlaylist = async (trackId) => {
    // Permission check
    if (!canAddTracks) {
      toast.error('You do not have permission to add tracks to playlists');
      return;
    }

    try {
      // Get current max sort order
      const { data: maxOrder } = await supabase
        .from('music_playlist_tracks')
        .select('sort_order')
        .eq('playlist_id', playlist.id)
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextOrder = (maxOrder?.[0]?.sort_order || 0) + 1;

      const { error } = await supabase
        .from('music_playlist_tracks')
        .insert([{
          playlist_id: playlist.id,
          track_id: trackId,
          sort_order: nextOrder
        }]);

      if (error) throw error;
      
      await loadPlaylistTracks();
      onUpdate(); // Update parent component
      toast.success('Track added to playlist');
    } catch (error) {
      console.error('Error adding track to playlist:', error);
      toast.error('Error adding track: ' + error.message);
    }
  };

  // Remove track from playlist
  const removeTrackFromPlaylist = async (trackId) => {
    // Permission check
    if (!canRemoveTracks) {
      toast.error('You do not have permission to remove tracks from playlists');
      return;
    }

    try {
      const { error } = await supabase
        .from('music_playlist_tracks')
        .delete()
        .eq('playlist_id', playlist.id)
        .eq('track_id', trackId);

      if (error) throw error;
      
      await loadPlaylistTracks();
      onUpdate(); // Update parent component
      toast.success('Track removed from playlist');
    } catch (error) {
      console.error('Error removing track from playlist:', error);
      toast.error('Error removing track: ' + error.message);
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (e, index) => {
    // Permission check
    if (!canReorderTracks) {
      e.preventDefault();
      toast.error('You do not have permission to reorder tracks');
      return;
    }

    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    
    // Permission check
    if (!canReorderTracks) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'move';
    
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e) => {
    // Only clear if we're actually leaving the track item
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = async (e, dropIndex) => {
    e.preventDefault();
    
    // Permission check
    if (!canReorderTracks) {
      toast.error('You do not have permission to reorder tracks');
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    try {
      // Create a copy of the tracks array
      const updatedTracks = [...playlistTracks];
      
      // Remove the dragged item
      const [draggedTrack] = updatedTracks.splice(draggedIndex, 1);
      
      // Insert at the new position
      updatedTracks.splice(dropIndex, 0, draggedTrack);
      
      // Update the local state immediately for instant feedback
      setPlaylistTracks(updatedTracks);
      
      // Update sort_order for all affected tracks in the database
      // Using composite key (playlist_id + track_id) to identify records
      const updates = updatedTracks.map((track, index) => ({
        playlist_id: track.playlist_id,
        track_id: track.track_id,
        sort_order: index + 1
      }));

      // Batch update all tracks using composite key
      for (const update of updates) {
        const { error } = await supabase
          .from('music_playlist_tracks')
          .update({ sort_order: update.sort_order })
          .eq('playlist_id', update.playlist_id)
          .eq('track_id', update.track_id);

        if (error) throw error;
      }

      // Reload to ensure consistency
      await loadPlaylistTracks();
      onUpdate(); // Update parent component
      toast.success('Tracks reordered successfully');
      
    } catch (error) {
      console.error('Error reordering tracks:', error);
      toast.error('Error reordering tracks: ' + error.message);
      // Reload on error to restore correct order
      await loadPlaylistTracks();
    } finally {
      setDraggedIndex(null);
      setDragOverIndex(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Filter available tracks based on search
  const filteredAvailableTracks = availableTracks.filter(track => 
    !playlistTracks.some(pt => pt.track.id === track.id) &&
    (track.title.toLowerCase().includes(trackSearchTerm.toLowerCase()) ||
     track.artist?.toLowerCase().includes(trackSearchTerm.toLowerCase()))
  );

  if (!playlist) return null;

  // Show loading while permissions are being checked
  if (permissionsLoading) {
    const modalStyle = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      padding: '20px'
    };

    return (
      <div style={modalStyle}>
        <div style={{ 
          backgroundColor: 'white', 
          padding: '40px', 
          borderRadius: '12px',
          textAlign: 'center' 
        }}>
          Loading permissions...
        </div>
      </div>
    );
  }

  // Show access denied if no permission to edit playlists
  if (!canEditPlaylists) {
    const modalStyle = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      padding: '20px'
    };

    const modalContentStyle = {
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '40px',
      maxWidth: '500px',
      textAlign: 'center'
    };

    return (
      <div style={modalStyle} onClick={onClose}>
        <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
          <FiLock size={64} style={{ color: '#f44336', marginBottom: '20px' }} />
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>Access Denied</h2>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '20px' }}>
            You do not have permission to manage playlist tracks.
          </p>
          <p style={{ fontSize: '14px', color: '#999', marginBottom: '30px' }}>
            Contact your manager or administrator for access.
          </p>
          <button
            onClick={onClose}
            className={styles.primaryButton}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const modalStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    padding: '20px'
  };

  const modalContentStyle = {
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '2px solid #14B8A6',
    padding: '30px',
    width: '100%',
    maxWidth: '900px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)'
  };

  const trackManagerStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '25px',
    flex: 1,
    minHeight: 0
  };

  const trackSectionStyle = {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  };

  const trackListStyle = {
    border: '2px solid #14B8A6',
    borderRadius: '8px',
    padding: '15px',
    height: '350px',
    overflowY: 'auto',
    backgroundColor: '#fafafa'
  };

  return (
    <div 
      style={modalStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div style={modalContentStyle}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Manage Tracks: {playlist.name}</h2>
          <button
            onClick={onClose}
            className={styles.closeButton}
          >
            <FiX />
          </button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading tracks...</div>
        ) : (
          <div style={trackManagerStyle}>
            {/* Current Playlist Tracks */}
            <div style={trackSectionStyle}>
              <div className={styles.trackSectionHeader}>
                <h3 className={styles.trackSectionTitle}>
                  Current Tracks ({playlistTracks.length})
                </h3>
                {playlistTracks.length > 0 && canReorderTracks && (
                  <p style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>
                    <FiMove style={{ marginRight: '5px' }} />
                    Drag to reorder
                  </p>
                )}
                {playlistTracks.length > 0 && !canReorderTracks && (
                  <p style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600 }}>
                    <FiLock style={{ marginRight: '5px' }} />
                    Reorder disabled
                  </p>
                )}
              </div>
              <div style={trackListStyle}>
                {playlistTracks.map((playlistTrack, index) => (
                  <div 
                    key={`${playlistTrack.playlist_id}-${playlistTrack.track_id}`}
                    className={styles.trackItem}
                    draggable={canReorderTracks}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    style={{
                      cursor: canReorderTracks ? 'grab' : 'default',
                      opacity: draggedIndex === index ? 0.5 : 1,
                      border: dragOverIndex === index ? '2px solid #14B8A6' : '1px solid #e5e7eb',
                      transform: dragOverIndex === index ? 'scale(1.02)' : 'scale(1)',
                      transition: 'all 0.2s ease',
                      backgroundColor: draggedIndex === index ? '#f0fdfa' : 'white'
                    }}
                  >
                    <div className={styles.trackInfo}>
                      {canReorderTracks ? (
                        <FiMove 
                          style={{ 
                            marginRight: '10px', 
                            color: '#14B8A6',
                            cursor: 'grab',
                            fontSize: '1.2rem'
                          }} 
                        />
                      ) : (
                        <FiLock 
                          style={{ 
                            marginRight: '10px', 
                            color: '#9ca3af',
                            fontSize: '1.2rem'
                          }} 
                        />
                      )}
                      <span className={styles.trackNumber}>{index + 1}.</span>
                      <div className={styles.trackDetails}>
                        <h4>{playlistTrack.track.title}</h4>
                        <p>{playlistTrack.track.artist}</p>
                      </div>
                    </div>
                    
                    <PermissionGate 
                      permission="music.playlists.create"
                      fallback={
                        <button
                          disabled
                          className={`${styles.iconButton} ${styles.danger}`}
                          title="Permission required to remove tracks"
                          style={{ opacity: 0.5, cursor: 'not-allowed' }}
                        >
                          <FiLock />
                        </button>
                      }
                    >
                      <button
                        onClick={() => removeTrackFromPlaylist(playlistTrack.track.id)}
                        className={`${styles.iconButton} ${styles.danger}`}
                        title="Remove Track"
                      >
                        <FiTrash />
                      </button>
                    </PermissionGate>
                  </div>
                ))}
                {playlistTracks.length === 0 && (
                  <div className={styles.trackEmptyState}>
                    <FiMusic className={styles.trackEmptyIcon} />
                    <p>No tracks in this playlist yet</p>
                    {!canAddTracks && (
                      <p style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '10px' }}>
                        You need permission to add tracks
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Available Tracks */}
            <div style={trackSectionStyle}>
              <div className={styles.trackSectionHeader}>
                <h3 className={styles.trackSectionTitle}>Available Tracks</h3>
                <input
                  type="text"
                  placeholder="Search tracks..."
                  value={trackSearchTerm}
                  onChange={(e) => setTrackSearchTerm(e.target.value)}
                  className={styles.searchInput}
                />
              </div>
              <div style={trackListStyle}>
                {filteredAvailableTracks.map((track) => (
                  <div key={track.id} className={styles.trackItem}>
                    <div className={styles.trackInfo}>
                      <div className={styles.trackDetails}>
                        <h4>{track.title}</h4>
                        <p>{track.artist}</p>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => addTrackToPlaylist(track.id)}
                      className={`${styles.iconButton} ${styles.addTrackButton}`}
                      title={canAddTracks ? 'Add Track to Playlist' : 'Permission required to add tracks'}
                      disabled={!canAddTracks}
                      style={{
                        opacity: canAddTracks ? 1 : 0.5,
                        cursor: canAddTracks ? 'pointer' : 'not-allowed'
                      }}
                    >
                      <FiPlus style={{ marginRight: '6px' }} />
                      Add
                    </button>
                  </div>
                ))}
                {filteredAvailableTracks.length === 0 && (
                  <div className={styles.trackEmptyState}>
                    <FiMusic className={styles.trackEmptyIcon} />
                    <p>
                      {trackSearchTerm ? 'No tracks match your search' : 'All tracks already added'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackManagerModal;
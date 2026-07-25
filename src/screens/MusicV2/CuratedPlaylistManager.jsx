// screens/MusicV2/CuratedPlaylistManager.jsx
// TOSA/Admin interface for managing curated playlists

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiPlus, FiSave, FiTrash2, FiMusic, FiEdit2 } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

const CuratedPlaylistManager = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [playlistTracks, setPlaylistTracks] = useState([]);
  const [availableTracks, setAvailableTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [showTrackModal, setShowTrackModal] = useState(false);

  const playlistTypes = [
    { value: 'upbeat', label: 'Upbeat', color: '#ff6b6b' },
    { value: 'background', label: 'Background', color: '#4ecdc4' },
    { value: 'upscale', label: 'Upscale', color: '#ffe66d' }
  ];

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load plans
      const { data: plansData, error: plansError } = await supabase
        .from('music_v2_plans')
        .select('*')
        .eq('is_active', true)
        .order('plan_key');

      if (plansError) throw plansError;
      setPlans(plansData || []);

      // Load playlists
      const { data: playlistsData, error: playlistsError } = await supabase
        .from('music_v2_curated_playlists')
        .select(`
          *,
          plan:music_v2_plans(*)
        `)
        .eq('is_active', true)
        .order('plan_id')
        .order('playlist_type');

      if (playlistsError) throw playlistsError;
      setPlaylists(playlistsData || []);

      // Load available tracks (global tracks)
      const { data: tracksData, error: tracksError } = await supabase
        .from('music_v2_global_tracks')
        .select('*')
        .eq('status', 'approved')
        .order('title');

      if (tracksError) throw tracksError;
      setAvailableTracks(tracksData || []);

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load playlists');
      setLoading(false);
    }
  };

  const loadPlaylistTracks = async (playlistId) => {
    try {
      const { data, error } = await supabase
        .from('music_v2_playlist_tracks')
        .select(`
          *,
          global_track:music_v2_global_tracks!track_id(*),
          business_track:music_tracks!track_id(*)
        `)
        .eq('playlist_id', playlistId)
        .order('track_order');

      if (error) throw error;

      // Map tracks with proper source
      const mappedTracks = (data || []).map(pt => {
        if (pt.track_source === 'global' && pt.global_track) {
          return {
            ...pt,
            track: pt.global_track,
            title: pt.global_track.title,
            artist: pt.global_track.artist,
            duration: pt.global_track.duration
          };
        } else if (pt.track_source === 'business' && pt.business_track) {
          return {
            ...pt,
            track: pt.business_track,
            title: pt.business_track.title,
            artist: pt.business_track.artist,
            duration: pt.business_track.duration
          };
        }
        return pt;
      });

      setPlaylistTracks(mappedTracks);
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
      toast.error('Failed to load playlist tracks');
    }
  };

  const handleCreatePlaylist = async (formData) => {
    try {
      const { data, error } = await supabase
        .from('music_v2_curated_playlists')
        .insert({
          plan_id: formData.plan_id,
          playlist_type: formData.playlist_type,
          name: formData.name,
          description: formData.description,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Playlist created successfully!');
      setShowPlaylistModal(false);
      await loadData();
    } catch (error) {
      console.error('Error creating playlist:', error);
      toast.error('Failed to create playlist');
    }
  };

  const handleAddTrack = async (playlistId, trackId, trackSource) => {
    try {
      // Get current max order
      const { data: existingTracks } = await supabase
        .from('music_v2_playlist_tracks')
        .select('track_order')
        .eq('playlist_id', playlistId)
        .order('track_order', { ascending: false })
        .limit(1);

      const nextOrder = existingTracks && existingTracks.length > 0
        ? (existingTracks[0].track_order || 0) + 1
        : 1;

      const { error } = await supabase
        .from('music_v2_playlist_tracks')
        .insert({
          playlist_id: playlistId,
          track_id: trackId,
          track_source: trackSource,
          track_order: nextOrder
        });

      if (error) throw error;

      toast.success('Track added to playlist!');
      await loadPlaylistTracks(playlistId);
      setShowTrackModal(false);
    } catch (error) {
      console.error('Error adding track:', error);
      toast.error('Failed to add track');
    }
  };

  const handleRemoveTrack = async (playlistTrackId) => {
    try {
      const { error } = await supabase
        .from('music_v2_playlist_tracks')
        .delete()
        .eq('id', playlistTrackId);

      if (error) throw error;

      toast.success('Track removed from playlist!');
      await loadPlaylistTracks(selectedPlaylist.id);
    } catch (error) {
      console.error('Error removing track:', error);
      toast.error('Failed to remove track');
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading playlists...</div>
      </div>
    );
  }

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
          <h1 style={{ marginBottom: '0.5rem' }}>Curated Playlist Manager</h1>
          <p style={{ color: '#666' }}>
            Manage curated playlists for each plan and playlist type. These playlists are used by all businesses.
          </p>
        </div>
        <button
          onClick={() => setShowPlaylistModal(true)}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: 'bold'
          }}
        >
          <FiPlus /> Create Playlist
        </button>
      </div>

      {/* Playlists Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        {playlists.map(playlist => {
          const typeInfo = playlistTypes.find(t => t.value === playlist.playlist_type);
          return (
            <div
              key={playlist.id}
              onClick={() => {
                setSelectedPlaylist(playlist);
                loadPlaylistTracks(playlist.id);
              }}
              style={{
                border: `2px solid ${selectedPlaylist?.id === playlist.id ? typeInfo?.color || '#007bff' : '#ddd'}`,
                borderRadius: '8px',
                padding: '1.5rem',
                backgroundColor: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div>
                  <div style={{
                    display: 'inline-block',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '12px',
                    backgroundColor: typeInfo?.color || '#6c757d',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: 'bold',
                    marginBottom: '0.5rem'
                  }}>
                    {typeInfo?.label || playlist.playlist_type}
                  </div>
                  <h3 style={{ margin: '0.5rem 0', fontSize: '1.25rem' }}>{playlist.name}</h3>
                  <div style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                    {playlist.plan?.name || 'Unknown Plan'}
                  </div>
                </div>
                <FiMusic style={{ fontSize: '1.5rem', color: typeInfo?.color || '#6c757d' }} />
              </div>
              {playlist.description && (
                <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  {playlist.description}
                </p>
              )}
              <div style={{ fontSize: '0.875rem', color: '#999' }}>
                Click to manage tracks
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Playlist Tracks */}
      {selectedPlaylist && (
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '1.5rem',
          backgroundColor: '#fff',
          marginTop: '2rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, marginBottom: '0.25rem' }}>{selectedPlaylist.name}</h2>
              <div style={{ color: '#666', fontSize: '0.875rem' }}>
                {playlistTracks.length} track{playlistTracks.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button
              onClick={() => setShowTrackModal(true)}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <FiPlus /> Add Track
            </button>
          </div>

          {playlistTracks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
              No tracks in this playlist. Add tracks to get started.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {playlistTracks.map((pt, index) => (
                <div
                  key={pt.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.75rem',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '4px',
                    gap: '1rem'
                  }}
                >
                  <div style={{ width: '30px', textAlign: 'center', color: '#666', fontWeight: 'bold' }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{pt.title || 'Unknown Track'}</div>
                    <div style={{ fontSize: '0.875rem', color: '#666' }}>
                      {pt.artist || 'Unknown Artist'} • {formatDuration(pt.duration)}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#999' }}>
                    {pt.track_source === 'global' ? 'Global' : 'Business'}
                  </div>
                  <button
                    onClick={() => handleRemoveTrack(pt.id)}
                    style={{
                      padding: '0.5rem',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                    title="Remove track"
                  >
                    <FiTrash2 />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Playlist Modal */}
      {showPlaylistModal && (
        <CreatePlaylistModal
          plans={plans}
          playlistTypes={playlistTypes}
          onClose={() => setShowPlaylistModal(false)}
          onCreate={handleCreatePlaylist}
        />
      )}

      {/* Add Track Modal */}
      {showTrackModal && selectedPlaylist && (
        <AddTrackModal
          availableTracks={availableTracks}
          onClose={() => setShowTrackModal(false)}
          onAdd={(trackId, trackSource) => handleAddTrack(selectedPlaylist.id, trackId, trackSource)}
        />
      )}
    </div>
  );
};

// Create Playlist Modal Component
const CreatePlaylistModal = ({ plans, playlistTypes, onClose, onCreate }) => {
  const [formData, setFormData] = useState({
    plan_id: '',
    playlist_type: 'background',
    name: '',
    description: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.plan_id || !formData.name) {
      toast.error('Please fill in all required fields');
      return;
    }
    onCreate(formData);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '2rem',
        maxWidth: '500px',
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Create New Playlist</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Plan *
            </label>
            <select
              value={formData.plan_id}
              onChange={(e) => setFormData({ ...formData, plan_id: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd'
              }}
            >
              <option value="">Select a plan</option>
              {plans.map(plan => (
                <option key={plan.id} value={plan.id}>{plan.name}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Playlist Type *
            </label>
            <select
              value={formData.playlist_type}
              onChange={(e) => setFormData({ ...formData, playlist_type: e.target.value })}
              required
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

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Morning Upbeat Mix"
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd'
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
              rows={3}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Create Playlist
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Add Track Modal Component
const AddTrackModal = ({ availableTracks, onClose, onAdd }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTracks = availableTracks.filter(track =>
    track.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    track.artist?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '2rem',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Add Track to Playlist</h2>
        
        <input
          type="text"
          placeholder="Search tracks..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem',
            borderRadius: '4px',
            border: '1px solid #ddd',
            marginBottom: '1rem'
          }}
        />

        <div style={{ maxHeight: '400px', overflow: 'auto' }}>
          {filteredTracks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
              No tracks found
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {filteredTracks.map(track => (
                <div
                  key={track.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.75rem',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '4px'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 'bold' }}>{track.title}</div>
                    <div style={{ fontSize: '0.875rem', color: '#666' }}>
                      {track.artist || 'Unknown Artist'} • {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                    </div>
                  </div>
                  <button
                    onClick={() => onAdd(track.id, 'global')}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default CuratedPlaylistManager;



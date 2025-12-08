// src/components/Music/AudioPlayer.jsx
import React, { useState, useEffect } from 'react';
import { FiPlay, FiPause, FiSkipForward, FiSkipBack, FiVolume2, FiShuffle, FiList } from 'react-icons/fi';
import { globalMusicService } from '../../services/GlobalMusicService';

const AudioPlayer = () => {
  const [state, setState] = useState(globalMusicService.getState());

  useEffect(() => {
    // Listen to music service state changes
    const unsubscribe = globalMusicService.addListener(setState);
    
    // Get initial state
    setState(globalMusicService.getState());
    
    return unsubscribe;
  }, []);

  // Remote control integration
  useEffect(() => {
    const handleRemoteCommand = (event, command) => {
      switch (command.action) {
        case 'play':
          globalMusicService.play();
          break;
        case 'pause':
          globalMusicService.pause();
          break;
        case 'skip':
          globalMusicService.next();
          break;
        case 'volume':
          globalMusicService.setVolume(command.value);
          break;
      }
    };

    const handleRemoteRequest = (event, request) => {
      if (request.action === 'getCurrentTrack') {
        window.electronAPI?.reportCurrentTrack(state);
      }
    };

    if (window.electronAPI) {
      window.addEventListener('remote-command', handleRemoteCommand);
      window.addEventListener('remote-request', handleRemoteRequest);
      
      return () => {
        window.removeEventListener('remote-command', handleRemoteCommand);
        window.removeEventListener('remote-request', handleRemoteRequest);
      };
    }
  }, [state]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={styles.player}>
      {/* Status Indicator */}
      <div style={styles.statusIndicator}>
        <div style={styles.connectionDot} />
        <span style={styles.statusText}>
          {globalMusicService.isInitialized ? 'Ready' : 'Loading...'}
        </span>
      </div>

      {/* Track Info */}
      <div style={styles.trackInfo}>
        {state.currentTrack ? (
          <>
            <div style={styles.trackTitle}>
              🎵 {state.currentTrack.title}
            </div>
            <div style={styles.trackArtist}>
              {state.currentTrack.artist || 'Unknown Artist'}
            </div>
            <div style={styles.playlistInfo}>
              {state.shuffleMode ? (
                <>🔀 Shuffle • {state.playedCount}/{state.totalTracks} played</>
              ) : (
                <>📋 Playlist • Track {state.currentIndex + 1}/{state.totalTracks}</>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={styles.trackTitle}>No track loaded</div>
            <div style={styles.trackArtist}>Music will start automatically</div>
          </>
        )}
      </div>

      {/* Progress Bar */}
      <div style={styles.progressContainer}>
        <span style={styles.timeDisplay}>{formatTime(state.currentTime)}</span>
        <div style={styles.progressBar}>
          <div 
            style={{
              ...styles.progressFill,
              width: state.duration ? `${(state.currentTime / state.duration) * 100}%` : '0%'
            }}
          />
        </div>
        <span style={styles.timeDisplay}>{formatTime(state.duration)}</span>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <button
          style={styles.controlButton}
          onClick={() => globalMusicService.previous()}
          title="Previous Track"
        >
          <FiSkipBack size={18} />
        </button>

        <button
          style={styles.playButton}
          onClick={() => globalMusicService.togglePlay()}
        >
          {state.isPlaying ? <FiPause size={24} /> : <FiPlay size={24} />}
        </button>

        <button
          style={styles.controlButton}
          onClick={() => globalMusicService.next()}
          title="Next Track"
        >
          <FiSkipForward size={18} />
        </button>
      </div>

      {/* Volume Control */}
      <div style={styles.volumeContainer}>
        <FiVolume2 size={18} style={styles.volumeIcon} />
        <input
          style={styles.volumeSlider}
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={state.volume}
          onChange={(e) => globalMusicService.setVolume(parseFloat(e.target.value))}
        />
        <span style={styles.volumeDisplay}>{Math.round(state.volume * 100)}%</span>
      </div>

      {/* Mode Controls */}
      <div style={styles.modeControls}>
        <button
          style={{
            ...styles.modeButton,
            ...(state.shuffleMode ? styles.activeModeButton : {})
          }}
          onClick={() => globalMusicService.switchToShuffle()}
          title="Shuffle Mode"
        >
          <FiShuffle size={16} />
          Shuffle
        </button>
        
        <button
          style={{
            ...styles.modeButton,
            ...(!state.shuffleMode ? styles.activeModeButton : {})
          }}
          title="Playlist Mode"
        >
          <FiList size={16} />
          Playlist
        </button>
      </div>
    </div>
  );
};

const styles = {
  player: {
    backgroundColor: '#fff',
    border: '2px solid #20c997',
    borderRadius: '12px',
    padding: '20px',
    maxWidth: '600px',
    margin: '0 auto',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    position: 'relative',
  },
  statusIndicator: {
    position: 'absolute',
    top: '15px',
    right: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  connectionDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#28a745',
  },
  statusText: {
    fontSize: '12px',
    color: '#666',
    fontWeight: '500',
  },
  trackInfo: {
    textAlign: 'center',
    marginBottom: '20px',
    marginTop: '10px',
  },
  trackTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  trackArtist: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '8px',
  },
  playlistInfo: {
    fontSize: '12px',
    color: '#999',
    fontWeight: '500',
  },
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '20px',
  },
  timeDisplay: {
    fontSize: '12px',
    color: '#666',
    minWidth: '35px',
  },
  progressBar: {
    flex: 1,
    height: '6px',
    backgroundColor: '#e9ecef',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#20c997',
    transition: 'width 0.1s ease',
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '15px',
    marginBottom: '20px',
  },
  controlButton: {
    backgroundColor: '#f8f9fa',
    border: '2px solid #e9ecef',
    borderRadius: '50%',
    width: '45px',
    height: '45px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#666',
    transition: 'all 0.2s',
  },
  playButton: {
    backgroundColor: '#20c997',
    border: '2px solid #20c997',
    borderRadius: '50%',
    width: '60px',
    height: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#fff',
    transition: 'all 0.2s',
  },
  volumeContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '15px',
  },
  volumeIcon: {
    color: '#666',
  },
  volumeSlider: {
    flex: 1,
    height: '4px',
    borderRadius: '2px',
    background: '#e9ecef',
    outline: 'none',
    cursor: 'pointer',
  },
  volumeDisplay: {
    fontSize: '12px',
    color: '#666',
    minWidth: '35px',
  },
  modeControls: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
  },
  modeButton: {
    backgroundColor: '#f8f9fa',
    border: '1px solid #e9ecef',
    borderRadius: '6px',
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#666',
    transition: 'all 0.2s',
  },
  activeModeButton: {
    backgroundColor: '#20c997',
    borderColor: '#20c997',
    color: '#fff',
  },
};

export default AudioPlayer;

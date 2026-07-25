// screens/SocialMedia/TikTokCreatePost.jsx
// Create and schedule TikTok posts (demo flow)
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Video, Calendar, Check } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const TikTokCreatePost = () => {
  const navigate = useNavigate();
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [caption, setCaption] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);

  const handleVideoSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.type.startsWith('video/')) {
        setSelectedVideo(file);
        toast.success('Video selected');
      } else {
        toast.error('Please select a video file');
      }
    }
  };

  const handleSchedulePost = () => {
    if (!selectedVideo) {
      toast.error('Please select a video');
      return;
    }

    if (!caption.trim()) {
      toast.error('Please add a caption');
      return;
    }

    setIsScheduling(true);
    // Simulate scheduling
    setTimeout(() => {
      setIsScheduling(false);
      setIsScheduled(true);
      toast.success('Your TikTok post has been scheduled.');
    }, 2000);
  };

  if (isScheduled) {
    return (
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '40px 20px',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '48px',
          textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          maxWidth: '500px',
          width: '100%',
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: '#00f2ea',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <Check size={40} color="#ffffff" />
          </div>
          <h2 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#000000',
            marginBottom: '12px',
          }}>
            Your TikTok post has been scheduled.
          </h2>
          <p style={{
            fontSize: '16px',
            color: '#666',
            marginBottom: '32px',
          }}>
            Your video will be posted to TikTok at the scheduled time.
          </p>
          <button
            onClick={() => navigate('/dashboard/social-media')}
            style={{
              padding: '12px 32px',
              backgroundColor: TavariStyles.colors.primary || '#008080',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: '1000px',
      margin: '0 auto',
      padding: '40px 20px',
      minHeight: '100vh',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '32px',
      }}>
        <button
          onClick={() => navigate('/dashboard/social-media')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            marginRight: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ArrowLeft size={24} color={TavariStyles.colors.gray700 || '#374151'} />
        </button>
        <h1 style={{
          fontSize: '28px',
          fontWeight: 'bold',
          color: TavariStyles.colors.gray900 || '#1f2937',
          margin: 0,
        }}>
          Create New Post
        </h1>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '32px',
        '@media (max-width: 768px)': {
          gridTemplateColumns: '1fr',
        },
      }}>
        {/* Left Column - Video Upload */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: '#1f2937',
            marginBottom: '24px',
          }}>
            Select Video
          </h2>

          {!selectedVideo ? (
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 20px',
                border: '2px dashed #d1d5db',
                borderRadius: '12px',
                cursor: 'pointer',
                backgroundColor: '#f9fafb',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = TavariStyles.colors.primary || '#008080';
                e.currentTarget.style.backgroundColor = '#f0fdfa';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#d1d5db';
                e.currentTarget.style.backgroundColor = '#f9fafb';
              }}
            >
              <input
                type="file"
                accept="video/*"
                onChange={handleVideoSelect}
                style={{ display: 'none' }}
              />
              <Video size={48} color="#9ca3af" style={{ marginBottom: '16px' }} />
              <div style={{
                fontSize: '16px',
                fontWeight: '500',
                color: '#374151',
                marginBottom: '8px',
              }}>
                Click to upload video
              </div>
              <div style={{
                fontSize: '14px',
                color: '#6b7280',
              }}>
                MP4, MOV, or AVI up to 500MB
              </div>
            </label>
          ) : (
            <div style={{
              position: 'relative',
              borderRadius: '12px',
              overflow: 'hidden',
              backgroundColor: '#000000',
            }}>
              <video
                src={URL.createObjectURL(selectedVideo)}
                controls
                style={{
                  width: '100%',
                  maxHeight: '400px',
                  display: 'block',
                }}
              />
              <button
                onClick={() => setSelectedVideo(null)}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  padding: '8px 16px',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Change Video
              </button>
              <div style={{
                padding: '12px',
                backgroundColor: '#f9fafb',
                fontSize: '14px',
                color: '#374151',
              }}>
                <strong>File:</strong> {selectedVideo.name}<br />
                <strong>Size:</strong> {(selectedVideo.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Post Details */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: '#1f2937',
            marginBottom: '24px',
          }}>
            Post Details
          </h2>

          {/* Caption */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '8px',
            }}>
              Caption
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write a caption for your TikTok video..."
              style={{
                width: '100%',
                minHeight: '120px',
                padding: '12px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
            <div style={{
              fontSize: '13px',
              color: '#6b7280',
              marginTop: '4px',
            }}>
              {caption.length} / 2200 characters
            </div>
          </div>

          {/* Schedule */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '8px',
            }}>
              <Calendar size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
              Schedule Post
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                style={{
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                style={{
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
            </div>
            {!scheduleDate && !scheduleTime && (
              <div style={{
                fontSize: '13px',
                color: '#6b7280',
                marginTop: '4px',
              }}>
                Leave empty to post immediately
              </div>
            )}
          </div>

          {/* Schedule Button */}
          <button
            onClick={handleSchedulePost}
            disabled={isScheduling || !selectedVideo || !caption.trim()}
            style={{
              width: '100%',
              padding: '14px 24px',
              backgroundColor: isScheduling || !selectedVideo || !caption.trim()
                ? '#d1d5db'
                : '#000000',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: isScheduling || !selectedVideo || !caption.trim()
                ? 'not-allowed'
                : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {isScheduling ? 'Scheduling...' : 'Schedule Post'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TikTokCreatePost;



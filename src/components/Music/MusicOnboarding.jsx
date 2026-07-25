// src/components/Music/MusicOnboarding.jsx
// Onboarding wizard for Music module first-time setup
import React, { useState, useEffect } from 'react';
import { FiX, FiCheck, FiMusic, FiUpload, FiList, FiCalendar, FiDollarSign } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const MusicOnboarding = ({ businessId, onComplete, onSkip }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [loading, setLoading] = useState(false);

  const steps = [
    {
      id: 'welcome',
      title: 'Welcome to Tavari Music',
      description: 'Let\'s get your music system set up in just a few steps.',
      icon: <FiMusic size={48} />,
      content: (
        <div style={styles.stepContent}>
          <p>You'll learn how to:</p>
          <ul style={styles.featureList}>
            <li>Upload and manage your music library</li>
            <li>Create playlists for different times of day</li>
            <li>Schedule music automatically</li>
            <li>Track ad revenue and performance</li>
          </ul>
        </div>
      )
    },
    {
      id: 'upload',
      title: 'Upload Your First Track',
      description: 'Start by uploading a music file to your library.',
      icon: <FiUpload size={48} />,
      content: (
        <div style={styles.stepContent}>
          <p>Upload at least one track to get started. You can upload:</p>
          <ul style={styles.featureList}>
            <li>MP3, WAV, or other audio formats</li>
            <li>Individual files or bulk uploads</li>
            <li>Music will be automatically organized</li>
          </ul>
          <button
            style={styles.actionButton}
            onClick={() => {
              window.location.href = '/dashboard/music?tab=upload';
            }}
          >
            Go to Upload
          </button>
        </div>
      ),
      canSkip: true
    },
    {
      id: 'playlist',
      title: 'Create Your First Playlist',
      description: 'Organize your music into playlists for different moods or times.',
      icon: <FiList size={48} />,
      content: (
        <div style={styles.stepContent}>
          <p>Playlists help you organize music and schedule it automatically.</p>
          <button
            style={styles.actionButton}
            onClick={() => {
              window.location.href = '/dashboard/music?tab=playlists';
            }}
          >
            Create Playlist
          </button>
        </div>
      ),
      canSkip: true
    },
    {
      id: 'schedule',
      title: 'Set Up Your Schedule',
      description: 'Automate your music with time-based schedules.',
      icon: <FiCalendar size={48} />,
      content: (
        <div style={styles.stepContent}>
          <p>Create schedules to automatically play different music at different times.</p>
          <button
            style={styles.actionButton}
            onClick={() => {
              window.location.href = '/dashboard/music?tab=schedules';
            }}
          >
            Create Schedule
          </button>
        </div>
      ),
      canSkip: true
    },
    {
      id: 'complete',
      title: 'You\'re All Set!',
      description: 'Your music system is ready to use.',
      icon: <FiCheck size={48} />,
      content: (
        <div style={styles.stepContent}>
          <p>You can always access help and tutorials from the Help Center.</p>
        </div>
      )
    }
  ];

  useEffect(() => {
    loadOnboardingStatus();
  }, [businessId]);

  const loadOnboardingStatus = async () => {
    if (!businessId) return;

    try {
      const { data } = await supabase
        .from('module_onboarding_status')
        .select('completed, completed_steps')
        .eq('business_id', businessId)
        .eq('module_key', 'music')
        .single();

      if (data) {
        setCompletedSteps(data.completed_steps || []);
        if (data.completed) {
          onComplete?.();
        }
      }
    } catch (error) {
      console.error('Error loading onboarding status:', error);
    }
  };

  const markStepComplete = async (stepId) => {
    if (!businessId) return;

    setLoading(true);
    try {
      const newCompletedSteps = [...completedSteps, stepId];
      
      await supabase
        .from('module_onboarding_status')
        .upsert({
          business_id: businessId,
          module_key: 'music',
          completed_steps: newCompletedSteps,
          completed: newCompletedSteps.length >= steps.length - 1, // -1 for welcome step
          last_accessed_at: new Date().toISOString()
        }, {
          onConflict: 'business_id,module_key'
        });

      setCompletedSteps(newCompletedSteps);

      if (newCompletedSteps.length >= steps.length - 1) {
        toast.success('Onboarding complete!');
        setTimeout(() => {
          onComplete?.();
        }, 1000);
      }
    } catch (error) {
      console.error('Error saving onboarding status:', error);
      toast.error('Failed to save progress');
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    const currentStepData = steps[currentStep];
    if (currentStepData.id !== 'welcome' && currentStepData.id !== 'complete') {
      markStepComplete(currentStepData.id);
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete?.();
    }
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    } else {
      onComplete?.();
    }
  };

  const currentStepData = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  if (!businessId) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
          <button style={styles.closeButton} onClick={handleSkip}>
            <FiX size={20} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.iconContainer}>
            {currentStepData.icon}
          </div>
          <h2 style={styles.title}>{currentStepData.title}</h2>
          <p style={styles.description}>{currentStepData.description}</p>
          {currentStepData.content}
        </div>

        <div style={styles.footer}>
          <div style={styles.stepIndicator}>
            Step {currentStep + 1} of {steps.length}
          </div>
          <div style={styles.actions}>
            {currentStepData.canSkip && (
              <button style={styles.skipButton} onClick={handleSkip}>
                Skip
              </button>
            )}
            <button
              style={styles.nextButton}
              onClick={handleNext}
              disabled={loading}
            >
              {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px'
  },
  modal: {
    backgroundColor: TavariStyles?.colors?.white || '#ffffff',
    borderRadius: TavariStyles?.borderRadius?.xl || '16px',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
  },
  header: {
    position: 'relative',
    padding: TavariStyles?.spacing?.lg || '16px',
    borderBottom: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`
  },
  progressBar: {
    height: '4px',
    backgroundColor: TavariStyles?.colors?.gray200 || '#e5e7eb',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: TavariStyles?.colors?.primary || '#008080',
    transition: 'width 0.3s ease'
  },
  closeButton: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles?.colors?.gray500 || '#6b7280',
    padding: '4px'
  },
  content: {
    padding: TavariStyles?.spacing?.['2xl'] || '32px',
    textAlign: 'center'
  },
  iconContainer: {
    marginBottom: TavariStyles?.spacing?.lg || '16px',
    color: TavariStyles?.colors?.primary || '#008080'
  },
  title: {
    fontSize: TavariStyles?.typography?.fontSize?.['2xl'] || '24px',
    fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
    color: TavariStyles?.colors?.gray900 || '#111827',
    marginBottom: TavariStyles?.spacing?.sm || '8px'
  },
  description: {
    fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
    color: TavariStyles?.colors?.gray600 || '#4b5563',
    marginBottom: TavariStyles?.spacing?.xl || '24px'
  },
  stepContent: {
    textAlign: 'left',
    marginTop: TavariStyles?.spacing?.lg || '16px'
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: '16px 0'
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: '16px 0'
  },
  actionButton: {
    padding: '12px 24px',
    backgroundColor: TavariStyles?.colors?.primary || '#008080',
    color: TavariStyles?.colors?.white || '#ffffff',
    border: 'none',
    borderRadius: TavariStyles?.borderRadius?.lg || '8px',
    fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
    cursor: 'pointer',
    marginTop: TavariStyles?.spacing?.md || '12px'
  },
  footer: {
    padding: TavariStyles?.spacing?.lg || '16px',
    borderTop: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  stepIndicator: {
    fontSize: TavariStyles?.typography?.fontSize?.sm || '14px',
    color: TavariStyles?.colors?.gray600 || '#4b5563'
  },
  actions: {
    display: 'flex',
    gap: TavariStyles?.spacing?.md || '12px'
  },
  skipButton: {
    padding: '10px 20px',
    backgroundColor: 'transparent',
    color: TavariStyles?.colors?.gray600 || '#4b5563',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: TavariStyles?.borderRadius?.lg || '8px',
    fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
    cursor: 'pointer'
  },
  nextButton: {
    padding: '10px 24px',
    backgroundColor: TavariStyles?.colors?.primary || '#008080',
    color: TavariStyles?.colors?.white || '#ffffff',
    border: 'none',
    borderRadius: TavariStyles?.borderRadius?.lg || '8px',
    fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
    cursor: 'pointer'
  }
};

export default MusicOnboarding;




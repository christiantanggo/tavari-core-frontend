// screens/MusicV2/MusicV2Settings.jsx
// Settings screen - ad frequency, volume, and other configuration

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiVolume2, FiCheck, FiMonitor } from 'react-icons/fi';
import { useBusiness } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import { pricingEngine } from '../../services/music-v2/PricingEngine';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';

const MusicV2Settings = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const [location, setLocation] = useState(null);
  const [pricingOptions, setPricingOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [adFrequency, setAdFrequency] = useState('one_per_6');
  const [musicVolume, setMusicVolume] = useState(0.7);
  const [adVolume, setAdVolume] = useState(0.8);
  const [playlistChangeBehavior, setPlaylistChangeBehavior] = useState('after_current_song');
  const [contentRating, setContentRating] = useState('family');
  const [creatingLocation, setCreatingLocation] = useState(false);

  useEffect(() => {
    if (business?.id) {
      loadLocation();
    }
  }, [business?.id]);

  const loadLocation = async () => {
    try {
      const { data: locationData, error } = await supabase
        .from('music_v2_locations')
        .select(`
          *,
          plan:music_v2_plans(*)
        `)
        .eq('business_id', business.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (locationData) {
        setLocation(locationData);
        setAdFrequency(locationData.default_ad_frequency || 'one_per_6');
        setMusicVolume(locationData.music_volume || 0.7);
        setAdVolume(locationData.ad_volume || 0.8);
        setPlaylistChangeBehavior(locationData.playlist_change_behavior || 'after_current_song');
        setContentRating(locationData.content_rating || 'family');

        // Load pricing options
        if (locationData.plan?.plan_key) {
          const options = await pricingEngine.getPricingOptions(locationData.plan.plan_key);
          setPricingOptions(options || []);
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading location:', error);
      toast.error('Failed to load settings');
      setLoading(false);
    }
  };

  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = async () => {
    if (!location || saving) return;

    setSaving(true);
    setSaveSuccess(false);

    try {
      const { error } = await supabase
        .from('music_v2_locations')
        .update({
          default_ad_frequency: adFrequency,
          music_volume: musicVolume,
          ad_volume: adVolume,
          playlist_change_behavior: playlistChangeBehavior,
          content_rating: contentRating,
          updated_at: new Date().toISOString()
        })
        .eq('id', location.id);

      if (error) throw error;

      // Show success message
      toast.success('Settings saved successfully!', {
        duration: 3000,
        style: {
          background: '#28a745',
          color: '#fff',
          fontSize: '16px',
          padding: '16px'
        }
      });
      
      setSaveSuccess(true);
      
      // Reload location to confirm changes
      await loadLocation();
      
      // Hide success message after 3 seconds
      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings. Please try again.', {
        duration: 4000,
        style: {
          background: '#dc3545',
          color: '#fff',
          fontSize: '16px',
          padding: '16px'
        }
      });
    } finally {
      setSaving(false);
    }
  };

  const getCurrentPricing = () => {
    return pricingOptions.find(opt => opt.adFrequency === adFrequency);
  };

  const adFrequencyOptions = [
    { value: 'zero_ads', label: 'No Ads', description: 'Ad-free experience - pay monthly subscription' },
    { value: 'one_per_8', label: '1 Ad Every 8 Songs', description: 'Light ad frequency - minimal interruptions' },
    { value: 'one_per_7', label: '1 Ad Every 7 Songs', description: 'Light ad frequency - minimal interruptions' },
    { value: 'one_per_6', label: '1 Ad Every 6 Songs', description: 'Moderate ad frequency - balanced experience' },
    { value: 'one_per_5', label: '1 Ad Every 5 Songs', description: 'Moderate ad frequency - balanced experience' },
    { value: 'one_per_4', label: '1 Ad Every 4 Songs', description: 'Higher ad frequency - more revenue potential' },
    { value: 'one_per_3', label: '1 Ad Every 3 Songs', description: 'Maximum ad frequency - highest revenue potential' }
  ];

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading settings...</div>
      </div>
    );
  }

  const handleCreateLocation = async () => {
    if (!business?.id) {
      toast.error('Business ID not found');
      return;
    }

    setCreatingLocation(true);
    try {
      // Create a default Music V2 location for this business
      const { data: newLocation, error } = await supabase
        .from('music_v2_locations')
        .insert({
          business_id: business.id,
          tenant_id: business.id, // tenant_id is also required
          default_ad_frequency: 'one_per_6',
          music_volume: 0.7,
          ad_volume: 0.8,
          playlist_change_behavior: 'after_current_song',
          content_rating: 'family',
          is_active: true
        })
        .select(`
          *,
          plan:music_v2_plans(*)
        `)
        .single();

      if (error) {
        throw error;
      }

      setLocation(newLocation);
      setAdFrequency(newLocation.default_ad_frequency || 'one_per_6');
      setMusicVolume(newLocation.music_volume || 0.7);
      setAdVolume(newLocation.ad_volume || 0.8);
      setPlaylistChangeBehavior(newLocation.playlist_change_behavior || 'after_current_song');
      setContentRating(newLocation.content_rating || 'family');

      toast.success('Music V2 location created successfully!', {
        duration: 3000,
        style: {
          background: '#28a745',
          color: '#fff',
          fontSize: '16px',
          padding: '16px'
        }
      });
    } catch (error) {
      console.error('Error creating location:', error);
      toast.error('Failed to create location: ' + (error.message || 'Unknown error'), {
        duration: 4000,
        style: {
          background: '#dc3545',
          color: '#fff',
          fontSize: '16px',
          padding: '16px'
        }
      });
    } finally {
      setCreatingLocation(false);
    }
  };

  if (!location) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ marginBottom: '1rem' }}>Music V2 Location Not Found</h2>
        <p style={{ marginBottom: '1.5rem', color: '#666' }}>
          Music V2 requires a location to be set up first. You can either:
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleCreateLocation}
            disabled={creatingLocation}
            style={{ 
              padding: '0.75rem 1.5rem', 
              backgroundColor: creatingLocation ? '#6c757d' : '#20c997',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: creatingLocation ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: creatingLocation ? 0.7 : 1
            }}
          >
            {creatingLocation ? 'Creating...' : 'Set Up Music V2 Location'}
          </button>
          <button
            onClick={() => navigate('/dashboard/music/dashboard')}
            style={{ 
              padding: '0.75rem 1.5rem', 
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Back to Music Dashboard
          </button>
        </div>
        <p style={{ marginTop: '1.5rem', fontSize: '13px', color: '#999' }}>
          Note: Music V2 is a separate system from the classic music player. 
          Setting up a location will enable Music V2 features for this business.
        </p>
      </div>
    );
  }

  const currentPricing = getCurrentPricing();

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
        <button
          onClick={() => navigate('/dashboard/music/v2/dashboard')}
          style={{ padding: '0.5rem 1rem', backgroundColor: '#20c997', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiMonitor size={16} /> Dashboard
        </button>
        <button
          onClick={() => navigate('/dashboard/music/dashboard')}
          style={{ padding: '0.5rem 1rem', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiArrowLeft size={16} /> Back to Music Dashboard
        </button>
      </div>

      <h1 style={{ marginBottom: '2rem' }}>Music Settings</h1>

      {/* Ad Frequency Section */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        backgroundColor: '#fff'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Ad Frequency</h2>
        <p style={{ color: '#666', marginBottom: '1rem' }}>
          Choose how often ads play. More ads = lower cost or higher revenue share.
        </p>

        <div style={{ marginBottom: '1rem' }}>
          {adFrequencyOptions.map((option) => (
            <label
              key={option.value}
              style={{
                display: 'block',
                padding: '0.75rem',
                marginBottom: '0.5rem',
                border: `2px solid ${adFrequency === option.value ? '#007bff' : '#ddd'}`,
                borderRadius: '4px',
                cursor: 'pointer',
                backgroundColor: adFrequency === option.value ? '#e7f3ff' : '#fff'
              }}
            >
              <input
                type="radio"
                name="adFrequency"
                value={option.value}
                checked={adFrequency === option.value}
                onChange={(e) => setAdFrequency(e.target.value)}
                style={{ marginRight: '0.5rem' }}
              />
              <strong>{option.label}</strong>
              <span style={{ color: '#666', marginLeft: '0.5rem' }}>— {option.description}</span>
            </label>
          ))}
        </div>

        {currentPricing && (
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '1rem',
            borderRadius: '4px',
            border: '1px solid #dee2e6'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Current Pricing:</div>
            <div style={{ fontSize: '1.25rem', color: currentPricing.mode === 'revenue_share' ? '#28a745' : '#007bff' }}>
              {currentPricing.displayText}
            </div>
            {currentPricing.mode === 'revenue_share' && (
              <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.5rem' }}>
                You'll earn {currentPricing.value}% of ad revenue generated at your location.
              </div>
            )}
            {currentPricing.mode === 'fixed_cost' && currentPricing.value > 0 && (
              <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.5rem' }}>
                Monthly subscription fee. You keep 100% of ad revenue.
              </div>
            )}
            {currentPricing.mode === 'fixed_cost' && currentPricing.value === 0 && (
              <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.5rem' }}>
                Free! You keep 100% of ad revenue.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Volume Controls */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        backgroundColor: '#fff'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Volume Controls</h2>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            <FiVolume2 style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Music Volume: {Math.round(musicVolume * 100)}%
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={musicVolume}
            onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
            style={{
              width: '100%',
              height: '8px',
              borderRadius: '4px',
              background: `linear-gradient(to right, #007bff 0%, #007bff ${musicVolume * 100}%, #ddd ${musicVolume * 100}%, #ddd 100%)`,
              outline: 'none',
              WebkitAppearance: 'none',
              appearance: 'none'
            }}
            onInput={(e) => {
              e.target.style.background = `linear-gradient(to right, #007bff 0%, #007bff ${e.target.value * 100}%, #ddd ${e.target.value * 100}%, #ddd 100%)`;
            }}
          />
          <style>{`
            input[type="range"]::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: #007bff;
              cursor: pointer;
              border: 2px solid #fff;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            input[type="range"]::-moz-range-thumb {
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: #007bff;
              cursor: pointer;
              border: 2px solid #fff;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
          `}</style>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            <FiVolume2 style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Ad Volume: {Math.round(adVolume * 100)}%
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={adVolume}
            onChange={(e) => setAdVolume(parseFloat(e.target.value))}
            style={{
              width: '100%',
              height: '8px',
              borderRadius: '4px',
              background: `linear-gradient(to right, #28a745 0%, #28a745 ${adVolume * 100}%, #ddd ${adVolume * 100}%, #ddd 100%)`,
              outline: 'none',
              WebkitAppearance: 'none',
              appearance: 'none'
            }}
            onInput={(e) => {
              e.target.style.background = `linear-gradient(to right, #28a745 0%, #28a745 ${e.target.value * 100}%, #ddd ${e.target.value * 100}%, #ddd 100%)`;
            }}
          />
          <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
            Ad volume is typically set lower than music volume for better customer experience.
          </div>
        </div>
      </div>

      {/* Playback Behavior */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        backgroundColor: '#fff'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Playback Behavior</h2>

        <label style={{ display: 'block', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Playlist Change Behavior:</div>
          <select
            value={playlistChangeBehavior}
            onChange={(e) => setPlaylistChangeBehavior(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid #ddd'
            }}
          >
            <option value="immediate">Change immediately</option>
            <option value="after_current_song">Change after current song finishes</option>
          </select>
          <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
            {playlistChangeBehavior === 'immediate'
              ? 'Playlist will switch immediately when schedule changes.'
              : 'Playlist will switch after the current song finishes playing.'}
          </div>
        </label>

        <label style={{ display: 'block' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Content Rating:</div>
          <select
            value={contentRating}
            onChange={(e) => setContentRating(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid #ddd'
            }}
          >
            <option value="kids_safe">Kids Safe - Completely family-friendly</option>
            <option value="family">Family - General audience, no explicit content</option>
            <option value="general">General - May include some mature themes</option>
          </select>
        </label>
      </div>

      {/* Success Message */}
      {saveSuccess && (
        <div style={{
          backgroundColor: '#d4edda',
          border: '1px solid #c3e6cb',
          color: '#155724',
          padding: '1rem',
          borderRadius: '4px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontWeight: 'bold'
        }}>
          <FiCheck style={{ fontSize: '1.25rem' }} />
          Settings saved successfully!
        </div>
      )}

      {/* Save Button */}
      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', alignItems: 'center' }}>
        {saveSuccess && (
          <span style={{ color: '#28a745', fontWeight: 'bold', marginRight: '1rem' }}>
            ✓ Saved
          </span>
        )}
        <button
          onClick={() => navigate('/dashboard/music-v2/dashboard')}
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
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: saveSuccess ? '#28a745' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
            fontWeight: 'bold',
            transition: 'background-color 0.3s'
          }}
        >
          {saving ? 'Saving...' : saveSuccess ? '✓ Saved!' : 'Save Settings'}
        </button>
      </div>

      <ModuleDeactivationPanel moduleKey="music" />
    </div>
  );
};

export default MusicV2Settings;

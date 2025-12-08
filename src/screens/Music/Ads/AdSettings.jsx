// src/screens/Music/Ads/AdSettings.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../supabaseClient';
import { useBusiness } from '../../../contexts/BusinessContext';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { usePermissions } from '../../../hooks/usePermissions';
import PermissionGate from '../../../components/Auth/PermissionGate';
import SessionManager from '../../../components/SessionManager';
import toast from 'react-hot-toast';
import { FiLock } from 'react-icons/fi';

const AdSettings = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const { profile } = useUserProfile();
  
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
  const canEditSettings = hasPermission('music.settings.edit') || hasElevatedPrivileges();
  const canManageAds = hasPermission('music.ads.manage') || hasElevatedPrivileges();
  const canAccessSettings = hasAnyPermission(['music.settings.edit', 'music.ads.manage']) || hasElevatedPrivileges();
  const canViewRevenue = hasAnyPermission(['reports.financial.view', 'music.ads.manage']) || hasElevatedPrivileges();
  
  const [settings, setSettings] = useState({
    // Global Ad Settings
    adsEnabled: true,
    adFrequency: 5,
    maxAdsPerHour: 6,
    volumeAdjustment: 0.8,
    
    // API Provider Settings
    enabledProviders: {},
    
    // Revenue Settings
    minimumPayout: 25.00,
    payoutSchedule: 'monthly',
    
    // Content Filtering
    contentFiltering: {
      explicitContent: false,
      politicalAds: false,
      alcoholAds: false
    },
    
    // Targeting Preferences
    targetingPreferences: {
      businessType: 'restaurant',
      location: 'Ontario, Canada',
      demographics: ['18-34', '35-54'],
      interests: ['dining', 'entertainment', 'local']
    }
  });

  const [apiProviders, setApiProviders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showTargetingModal, setShowTargetingModal] = useState(false);
  const [testingProvider, setTestingProvider] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (business?.id && !permissionsLoading) {
      if (!canAccessSettings) {
        toast.error('You do not have permission to access ad settings');
        navigate('/dashboard/music');
        return;
      }
      
      loadSettings();
      loadApiProviders();
    }
  }, [business?.id, permissionsLoading, canAccessSettings]);

  const loadSettings = async () => {
    if (!business?.id) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Load music settings
      const { data: musicSettings, error: musicError } = await supabase
        .from('music_settings')
        .select('*')
        .eq('business_id', business.id)
        .single();

      if (musicError && musicError.code !== 'PGRST116') throw musicError;
      
      // Load business API settings
      const { data: apiSettings, error: apiError } = await supabase
        .from('music_business_ad_apis')
        .select('*')
        .eq('business_id', business.id);

      if (apiError) throw apiError;
      
      // Process settings
      const loadedSettings = {
        adsEnabled: musicSettings?.ad_enabled !== false,
        adFrequency: musicSettings?.ad_frequency || 5,
        maxAdsPerHour: musicSettings?.max_ads_per_hour || 6,
        volumeAdjustment: musicSettings?.ad_volume_adjustment || 0.8,
        enabledProviders: {},
        minimumPayout: 25.00,
        payoutSchedule: 'monthly',
        contentFiltering: {
          explicitContent: false,
          politicalAds: false,
          alcoholAds: false
        },
        targetingPreferences: {
          businessType: business.type || 'restaurant',
          location: business.location || 'Ontario, Canada',
          demographics: ['18-34', '35-54'],
          interests: ['dining', 'entertainment', 'local']
        }
      };
      
      // Process API settings
      apiSettings?.forEach(setting => {
        loadedSettings.enabledProviders[setting.api_name || 'unknown'] = setting.enabled !== false;
        if (setting.minimum_payout) {
          loadedSettings.minimumPayout = parseFloat(setting.minimum_payout);
        }
        if (setting.payment_schedule) {
          loadedSettings.payoutSchedule = setting.payment_schedule;
        }
        
        // Load content filtering and targeting from settings JSONB
        if (setting.settings) {
          if (setting.settings.content_filtering) {
            loadedSettings.contentFiltering = {
              ...loadedSettings.contentFiltering,
              ...setting.settings.content_filtering
            };
          }
          if (setting.settings.targeting_preferences) {
            loadedSettings.targetingPreferences = {
              ...loadedSettings.targetingPreferences,
              ...setting.settings.targeting_preferences
            };
          }
        }
      });
      
      setSettings(loadedSettings);
      
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  const loadApiProviders = async () => {
    try {
      const { data: providers, error } = await supabase
        .from('music_ad_apis')
        .select('*')
        .eq('active', true)
        .order('priority', { ascending: true });

      if (error) throw error;
      
      setApiProviders(providers || []);
      
      // Initialize enabled providers state
      const enabledState = {};
      providers?.forEach(provider => {
        enabledState[provider.api_name] = true; // Default to enabled
      });
      
      setSettings(prev => ({
        ...prev,
        enabledProviders: { ...enabledState, ...prev.enabledProviders }
      }));
      
    } catch (err) {
      toast.error('Failed to load API providers');
    }
  };

  const updateSetting = (path, value) => {
    // Permission check
    if (!canEditSettings) {
      toast.error('You do not have permission to edit settings');
      return;
    }

    setSettings(prev => {
      const newSettings = { ...prev };
      const keys = path.split('.');
      let current = newSettings;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return newSettings;
    });
    setIsDirty(true);
  };

  const saveSettings = async () => {
    // Permission check
    if (!canEditSettings) {
      toast.error('You do not have permission to save settings');
      return;
    }

    if (!business?.id) return;
    
    try {
      setIsSaving(true);
      setError(null);
      
      // Save music settings
      const { error: musicError } = await supabase
        .from('music_settings')
        .upsert({
          business_id: business.id,
          ad_enabled: settings.adsEnabled,
          ad_frequency: settings.adFrequency,
          max_ads_per_hour: settings.maxAdsPerHour,
          ad_volume_adjustment: settings.volumeAdjustment,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'business_id'
        });

      if (musicError) throw musicError;
      
      // Save API provider settings
      const apiPromises = apiProviders.map(async (provider) => {
        const providerSettings = {
          business_id: business.id,
          api_id: provider.id,
          enabled: settings.enabledProviders[provider.api_name] !== false,
          minimum_payout: settings.minimumPayout,
          payment_schedule: settings.payoutSchedule,
          settings: {
            content_filtering: settings.contentFiltering,
            targeting_preferences: settings.targetingPreferences
          },
          updated_at: new Date().toISOString()
        };
        
        return supabase
          .from('music_business_ad_apis')
          .upsert(providerSettings, {
            onConflict: 'business_id,api_id'
          });
      });
      
      const results = await Promise.all(apiPromises);
      const errors = results.filter(result => result.error);
      
      if (errors.length > 0) {
        throw new Error(`Failed to save some API settings: ${errors[0].error.message}`);
      }
      
      setIsDirty(false);
      toast.success('Ad settings saved successfully');
      
    } catch (err) {
      setError(err.message);
      toast.error('Failed to save settings: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const testAdProvider = async (providerName) => {
    // Permission check
    if (!canManageAds) {
      toast.error('You do not have permission to test ad providers');
      return;
    }

    try {
      setTestingProvider(providerName);
      
      // Simulate API test
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // In a real implementation, this would test the actual API
      const success = Math.random() > 0.2; // 80% success rate for testing
      
      if (success) {
        toast.success(`${providerName} test successful - API is responding correctly`);
      } else {
        toast.error(`${providerName} test failed - Check your API credentials`);
      }
      
    } catch (err) {
      toast.error(`${providerName} test failed: ${err.message}`);
    } finally {
      setTestingProvider(null);
    }
  };

  const clearAdCache = async () => {
    // Permission check
    if (!canManageAds) {
      toast.error('You do not have permission to clear ad cache');
      return;
    }

    const confirmed = window.confirm(
      'This will remove all cached ads and force fresh requests from all providers. Continue?'
    );
    
    if (confirmed) {
      try {
        // Clear cache from database
        const { error } = await supabase
          .from('music_ad_cache')
          .delete()
          .eq('business_id', business.id);
        
        if (error) throw error;
        
        toast.success('Ad cache cleared successfully');
      } catch (err) {
        toast.error('Failed to clear cache: ' + err.message);
      }
    }
  };

  const getProviderStatus = (provider) => {
    // This would normally check real API status
    const statuses = ['healthy', 'degraded', 'error'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  };

  const getProviderStatusColor = (status) => {
    switch (status) {
      case 'healthy': return '#4caf50';
      case 'degraded': return '#ff9800';
      case 'error': return '#f44336';
      default: return '#666';
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount);
  };

  // Show loading while permissions are being checked
  if (permissionsLoading) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <div style={styles.loadingText}>Loading permissions...</div>
        </div>
      </SessionManager>
    );
  }

  // Show access denied if no permission
  if (!canAccessSettings) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <FiLock size={64} style={{ color: '#f44336', marginBottom: '20px' }} />
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>Access Denied</h2>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '20px' }}>
            You do not have permission to access ad settings.
          </p>
          <p style={{ fontSize: '14px', color: '#999', marginBottom: '30px' }}>
            Contact your manager or administrator for access.
          </p>
          <button 
            onClick={() => navigate('/dashboard/music')} 
            style={styles.retryButton}
          >
            Return to Music Dashboard
          </button>
        </div>
      </SessionManager>
    );
  }

  if (isLoading) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <div style={styles.loadingText}>Loading ad settings...</div>
        </div>
      </SessionManager>
    );
  }

  if (error) {
    return (
      <SessionManager>
        <div style={styles.errorContainer}>
          <div style={styles.errorText}>Error loading settings: {error}</div>
          <button onClick={() => window.location.reload()} style={styles.retryButton}>
            Retry
          </button>
        </div>
      </SessionManager>
    );
  }

  return (
    <SessionManager>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.card}>
          <h1 style={styles.title}>Ad Settings</h1>
          <p style={styles.subtitle}>Configure ad serving, revenue sharing, and content preferences</p>
          {!canEditSettings && (
            <div style={{ 
              marginTop: '15px', 
              padding: '10px', 
              backgroundColor: '#fff3cd', 
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <FiLock size={16} style={{ color: '#856404' }} />
              <span style={{ color: '#856404', fontSize: '14px' }}>
                View-only mode - You need edit permissions to modify settings
              </span>
            </div>
          )}
        </div>

        {/* Global Ad Settings */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>General Settings</h2>

          <div style={styles.settingRow}>
            <div style={styles.settingInfo}>
              <h3 style={styles.settingLabel}>
                Enable Advertisements
                {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
              </h3>
              <p style={styles.settingDescription}>Turn ads on or off for your music system</p>
            </div>
            <label style={styles.switch}>
              <input
                type="checkbox"
                checked={settings.adsEnabled}
                onChange={(e) => updateSetting('adsEnabled', e.target.checked)}
                disabled={!canEditSettings}
              />
              <span style={styles.slider}></span>
            </label>
          </div>

          <div style={styles.divider} />

          <div style={styles.settingRow}>
            <div style={styles.settingInfo}>
              <h3 style={styles.settingLabel}>
                Ad Frequency: Every {settings.adFrequency} songs
                {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
              </h3>
              <p style={styles.settingDescription}>How often ads play between music tracks</p>
            </div>
            <div style={styles.frequencyControls}>
              <button
                onClick={() => updateSetting('adFrequency', Math.max(3, settings.adFrequency - 1))}
                disabled={settings.adFrequency <= 3 || !canEditSettings}
                style={{
                  ...styles.controlButton,
                  opacity: (settings.adFrequency <= 3 || !canEditSettings) ? 0.5 : 1,
                  cursor: (settings.adFrequency <= 3 || !canEditSettings) ? 'not-allowed' : 'pointer'
                }}
              >
                -
              </button>
              <span style={styles.frequencyValue}>{settings.adFrequency}</span>
              <button
                onClick={() => updateSetting('adFrequency', Math.min(15, settings.adFrequency + 1))}
                disabled={settings.adFrequency >= 15 || !canEditSettings}
                style={{
                  ...styles.controlButton,
                  opacity: (settings.adFrequency >= 15 || !canEditSettings) ? 0.5 : 1,
                  cursor: (settings.adFrequency >= 15 || !canEditSettings) ? 'not-allowed' : 'pointer'
                }}
              >
                +
              </button>
            </div>
          </div>

          <div style={styles.divider} />

          <div style={styles.settingRow}>
            <div style={styles.settingInfo}>
              <h3 style={styles.settingLabel}>
                Max Ads Per Hour: {settings.maxAdsPerHour}
                {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
              </h3>
              <p style={styles.settingDescription}>Limit total ads played per hour</p>
            </div>
            <div style={styles.frequencyControls}>
              <button
                onClick={() => updateSetting('maxAdsPerHour', Math.max(1, settings.maxAdsPerHour - 1))}
                disabled={settings.maxAdsPerHour <= 1 || !canEditSettings}
                style={{
                  ...styles.controlButton,
                  opacity: (settings.maxAdsPerHour <= 1 || !canEditSettings) ? 0.5 : 1,
                  cursor: (settings.maxAdsPerHour <= 1 || !canEditSettings) ? 'not-allowed' : 'pointer'
                }}
              >
                -
              </button>
              <span style={styles.frequencyValue}>{settings.maxAdsPerHour}</span>
              <button
                onClick={() => updateSetting('maxAdsPerHour', Math.min(12, settings.maxAdsPerHour + 1))}
                disabled={settings.maxAdsPerHour >= 12 || !canEditSettings}
                style={{
                  ...styles.controlButton,
                  opacity: (settings.maxAdsPerHour >= 12 || !canEditSettings) ? 0.5 : 1,
                  cursor: (settings.maxAdsPerHour >= 12 || !canEditSettings) ? 'not-allowed' : 'pointer'
                }}
              >
                +
              </button>
            </div>
          </div>

          <div style={styles.divider} />

          <div style={styles.settingRow}>
            <div style={styles.settingInfo}>
              <h3 style={styles.settingLabel}>
                Ad Volume: {Math.round(settings.volumeAdjustment * 100)}%
                {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
              </h3>
              <p style={styles.settingDescription}>Volume level for advertisements relative to music</p>
            </div>
            <div style={styles.frequencyControls}>
              <button
                onClick={() => updateSetting('volumeAdjustment', Math.max(0.3, Math.round((settings.volumeAdjustment - 0.1) * 10) / 10))}
                disabled={settings.volumeAdjustment <= 0.3 || !canEditSettings}
                style={{
                  ...styles.controlButton,
                  opacity: (settings.volumeAdjustment <= 0.3 || !canEditSettings) ? 0.5 : 1,
                  cursor: (settings.volumeAdjustment <= 0.3 || !canEditSettings) ? 'not-allowed' : 'pointer'
                }}
              >
                -
              </button>
              <span style={styles.frequencyValue}>{Math.round(settings.volumeAdjustment * 100)}%</span>
              <button
                onClick={() => updateSetting('volumeAdjustment', Math.min(1.0, Math.round((settings.volumeAdjustment + 0.1) * 10) / 10))}
                disabled={settings.volumeAdjustment >= 1.0 || !canEditSettings}
                style={{
                  ...styles.controlButton,
                  opacity: (settings.volumeAdjustment >= 1.0 || !canEditSettings) ? 0.5 : 1,
                  cursor: (settings.volumeAdjustment >= 1.0 || !canEditSettings) ? 'not-allowed' : 'pointer'
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* API Provider Settings */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Ad Providers</h2>
          <p style={styles.sectionDescription}>
            Enable or disable specific advertising platforms
          </p>

          {apiProviders.length === 0 ? (
            <div style={styles.noDataText}>No API providers configured</div>
          ) : (
            apiProviders.map((provider) => {
              const status = getProviderStatus(provider);
              const isEnabled = settings.enabledProviders[provider.api_name] !== false;
              
              return (
                <React.Fragment key={provider.id}>
                  <div style={styles.settingRow}>
                    <div style={styles.settingInfo}>
                      <h3 style={styles.settingLabel}>
                        {provider.display_name}
                        {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
                      </h3>
                      <p style={styles.settingDescription}>
                        Priority: {provider.priority} • Status: {status}
                        {provider.rate_limit_requests && ` • ${provider.rate_limit_requests} req/hr`}
                      </p>
                    </div>
                    <div style={styles.providerControls}>
                      <span 
                        style={{
                          ...styles.statusIndicator,
                          backgroundColor: getProviderStatusColor(status)
                        }}
                      />
                      <PermissionGate
                        permission="music.ads.manage"
                        fallback={
                          <button
                            disabled
                            style={{ ...styles.testButton, opacity: 0.5, cursor: 'not-allowed' }}
                            title="Permission required to test providers"
                          >
                            <FiLock size={12} />
                          </button>
                        }
                      >
                        <button
                          onClick={() => testAdProvider(provider.display_name)}
                          disabled={testingProvider === provider.display_name || !isEnabled}
                          style={styles.testButton}
                        >
                          {testingProvider === provider.display_name ? '🧪 Testing...' : '🧪 Test'}
                        </button>
                      </PermissionGate>
                      <label style={styles.switch}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => updateSetting(`enabledProviders.${provider.api_name}`, e.target.checked)}
                          disabled={!canEditSettings}
                        />
                        <span style={styles.slider}></span>
                      </label>
                    </div>
                  </div>
                  <div style={styles.divider} />
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Revenue & Payout Settings */}
        <PermissionGate
          permissions={['reports.financial.view', 'music.ads.manage', 'music.settings.edit']}
          requireAny
          fallback={
            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>Revenue & Payouts</h2>
              <div style={{ 
                padding: '40px', 
                textAlign: 'center',
                backgroundColor: '#fff3cd',
                borderRadius: '8px'
              }}>
                <FiLock size={48} style={{ color: '#ff9800', marginBottom: '15px' }} />
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>Access Restricted</h3>
                <p style={{ color: '#856404' }}>
                  You need financial reporting permissions to view revenue settings.
                </p>
              </div>
            </div>
          }
        >
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>Revenue & Payouts</h2>

            <div style={styles.settingRow}>
              <div style={styles.settingInfo}>
                <h3 style={styles.settingLabel}>
                  Minimum Payout: {formatCurrency(settings.minimumPayout)}
                  {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
                </h3>
                <p style={styles.settingDescription}>Minimum amount before payout is processed</p>
              </div>
              <button
                onClick={() => {
                  if (!canEditSettings) {
                    toast.error('You do not have permission to edit settings');
                    return;
                  }
                  const amount = prompt('Enter minimum payout amount (CAD):', settings.minimumPayout.toString());
                  if (amount && !isNaN(parseFloat(amount)) && parseFloat(amount) >= 10) {
                    updateSetting('minimumPayout', parseFloat(amount));
                  } else if (amount) {
                    toast.error('Please enter a valid amount (minimum $10 CAD)');
                  }
                }}
                style={styles.editButton}
                disabled={!canEditSettings}
              >
                {canEditSettings ? 'Edit' : <FiLock size={14} />}
              </button>
            </div>

            <div style={styles.divider} />

            <div style={styles.settingRow}>
              <div style={styles.settingInfo}>
                <h3 style={styles.settingLabel}>
                  Payout Schedule
                  {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
                </h3>
                <p style={styles.settingDescription}>How often payouts are processed</p>
              </div>
              <select
                value={settings.payoutSchedule}
                onChange={(e) => updateSetting('payoutSchedule', e.target.value)}
                style={styles.select}
                disabled={!canEditSettings}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
          </div>
        </PermissionGate>

        {/* Content Filtering */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Content Filtering</h2>
          <p style={styles.sectionDescription}>
            Block specific types of advertisements
          </p>

          {[
            { key: 'explicitContent', label: 'Block Explicit Content', desc: 'Prevent ads with explicit language or content' },
            { key: 'politicalAds', label: 'Block Political Ads', desc: 'Prevent political campaign advertisements' },
            { key: 'alcoholAds', label: 'Block Alcohol Ads', desc: 'Prevent alcohol and beverage advertisements' }
          ].map((filter, index) => (
            <React.Fragment key={filter.key}>
              <div style={styles.settingRow}>
                <div style={styles.settingInfo}>
                  <h3 style={styles.settingLabel}>
                    {filter.label}
                    {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
                  </h3>
                  <p style={styles.settingDescription}>{filter.desc}</p>
                </div>
                <label style={styles.switch}>
                  <input
                    type="checkbox"
                    checked={settings.contentFiltering[filter.key]}
                    onChange={(e) => updateSetting(`contentFiltering.${filter.key}`, e.target.checked)}
                    disabled={!canEditSettings}
                  />
                  <span style={styles.slider}></span>
                </label>
              </div>
              {index < 2 && <div style={styles.divider} />}
            </React.Fragment>
          ))}
        </div>

        {/* Targeting Preferences */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Ad Targeting</h2>
          
          <div style={styles.settingRow}>
            <div style={styles.settingInfo}>
              <h3 style={styles.settingLabel}>
                Business Type
                {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
              </h3>
              <p style={styles.settingDescription}>{settings.targetingPreferences.businessType}</p>
            </div>
            <button
              onClick={() => canEditSettings && setShowTargetingModal(true)}
              style={styles.editButton}
              disabled={!canEditSettings}
            >
              {canEditSettings ? 'Change' : <FiLock size={14} />}
            </button>
          </div>

          <div style={styles.divider} />

          <div style={styles.settingRow}>
            <div style={styles.settingInfo}>
              <h3 style={styles.settingLabel}>
                Location
                {!canEditSettings && <FiLock size={14} style={{ marginLeft: '8px', color: '#999' }} />}
              </h3>
              <p style={styles.settingDescription}>{settings.targetingPreferences.location}</p>
            </div>
            <button
              onClick={() => {
                if (!canEditSettings) {
                  toast.error('You do not have permission to edit settings');
                  return;
                }
                const location = prompt('Enter your location:', settings.targetingPreferences.location);
                if (location && location.trim()) {
                  updateSetting('targetingPreferences.location', location.trim());
                }
              }}
              style={styles.editButton}
              disabled={!canEditSettings}
            >
              {canEditSettings ? 'Edit' : <FiLock size={14} />}
            </button>
          </div>
        </div>

        {/* Testing & Maintenance */}
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Testing & Maintenance</h2>

          <div style={styles.testingButtons}>
            <PermissionGate
              permission="music.ads.manage"
              fallback={
                <button
                  disabled
                  style={{ ...styles.testButton, opacity: 0.5, cursor: 'not-allowed' }}
                >
                  <FiLock size={16} style={{ marginRight: '8px' }} />
                  Clear Ad Cache
                </button>
              }
            >
              <button
                onClick={clearAdCache}
                style={styles.testButton}
              >
                🗑️ Clear Ad Cache
              </button>
            </PermissionGate>

            <button
              onClick={() => navigate('/dashboard/music/ads/dashboard')}
              style={styles.testButton}
            >
              📊 View Analytics
            </button>

            <PermissionGate
              permissions={['reports.financial.view', 'music.ads.manage']}
              requireAny
              fallback={
                <button
                  disabled
                  style={{ ...styles.testButton, opacity: 0.5, cursor: 'not-allowed' }}
                >
                  <FiLock size={16} style={{ marginRight: '8px' }} />
                  Revenue Reports
                </button>
              }
            >
              <button
                onClick={() => navigate('/dashboard/music/ads/revenue')}
                style={styles.testButton}
              >
                💰 Revenue Reports
              </button>
            </PermissionGate>
          </div>
        </div>

        {/* Save Button */}
        {isDirty && canEditSettings && (
          <div style={styles.card}>
            <div style={styles.saveSection}>
              <button
                onClick={saveSettings}
                disabled={isSaving}
                style={{
                  ...styles.saveButton,
                  opacity: isSaving ? 0.6 : 1,
                  cursor: isSaving ? 'not-allowed' : 'pointer'
                }}
              >
                {isSaving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}

        {/* Targeting Modal */}
        {showTargetingModal && canEditSettings && (
          <div style={styles.modalOverlay} onClick={() => setShowTargetingModal(false)}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h2 style={styles.modalTitle}>Business Type</h2>

              <div style={styles.modalContent}>
                {[
                  'restaurant', 'retail', 'entertainment', 'fitness', 
                  'automotive', 'healthcare', 'beauty', 'education'
                ].map((type) => (
                  <div key={type} style={styles.radioRow}>
                    <label style={styles.radioLabel}>
                      <input
                        type="radio"
                        name="businessType"
                        value={type}
                        checked={settings.targetingPreferences.businessType === type}
                        onChange={() => updateSetting('targetingPreferences.businessType', type)}
                        style={styles.radio}
                      />
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </label>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowTargetingModal(false)}
                style={styles.closeButton}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </SessionManager>
  );
};

const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e9ecef',
    borderTop: '4px solid #009688',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '15px'
  },
  loadingText: {
    fontSize: '16px',
    color: '#666'
  },
  errorText: {
    fontSize: '16px',
    color: '#f44336',
    marginBottom: '20px',
    textAlign: 'center'
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#009688',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 8px 0'
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: 0
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
    margin: '0 0 5px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  sectionDescription: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
    margin: '0 0 20px 0'
  },
  settingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px 0'
  },
  settingInfo: {
    flex: 1,
    marginRight: '20px'
  },
  settingLabel: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#333',
    marginBottom: '5px',
    margin: '0 0 5px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  settingDescription: {
    fontSize: '14px',
    color: '#666',
    margin: 0
  },
  switch: {
    position: 'relative',
    display: 'inline-block',
    width: '50px',
    height: '24px'
  },
  slider: {
    position: 'absolute',
    cursor: 'pointer',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ccc',
    transition: '0.4s',
    borderRadius: '24px'
  },
  frequencyControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  controlButton: {
    width: '32px',
    height: '32px',
    border: '1px solid #009688',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#009688',
    fontSize: '16px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  frequencyValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    minWidth: '40px',
    textAlign: 'center'
  },
  divider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '15px 0'
  },
  providerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  statusIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  testButton: {
    padding: '6px 12px',
    border: '1px solid #009688',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#009688',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  editButton: {
    padding: '8px 16px',
    border: '1px solid #009688',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#009688',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    backgroundColor: '#fff',
    cursor: 'pointer'
  },
  noDataText: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    padding: '20px 0'
  },
  testingButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  saveSection: {
    textAlign: 'center'
  },
  saveButton: {
    padding: '12px 30px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#009688',
    color: '#fff',
    fontSize: '16px',
    fontWeight: '500',
    minWidth: '200px'
  },
  modalOverlay: {
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
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '30px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: '20px',
    margin: '0 0 20px 0'
  },
  modalContent: {
    marginBottom: '30px'
  },
  radioRow: {
    marginBottom: '10px'
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '16px',
    color: '#333',
    cursor: 'pointer'
  },
  radio: {
    marginRight: '10px'
  },
  closeButton: {
    padding: '10px 20px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#fff',
    color: '#333',
    cursor: 'pointer',
    fontSize: '14px',
    display: 'block',
    margin: '0 auto'
  }
};

// Add CSS for switch styling and animations
if (!document.querySelector('#ad-settings-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'ad-settings-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    input[type="checkbox"] {
      opacity: 0;
      width: 0;
      height: 0;
    }
    
    input:checked + .slider {
      background-color: #009688;
    }
    
    input:disabled + .slider {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    input:checked + .slider:before {
      transform: translateX(26px);
    }
    
    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.4s;
      border-radius: 50%;
    }
    
    button:hover:not(:disabled) {
      opacity: 0.8;
    }
    
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    select:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(styleSheet);
}

export default AdSettings;
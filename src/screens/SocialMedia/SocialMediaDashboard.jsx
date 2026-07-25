// screens/SocialMedia/SocialMediaDashboard.jsx
// Main dashboard for social media management
import React, { useState, useEffect } from 'react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import { Instagram, Facebook, Twitter, Music, Settings, Plus, BarChart3 } from 'lucide-react';
import SocialMediaConfigModal from '../../components/SocialMedia/SocialMediaConfigModal';
import SocialMediaContentManager from '../../components/SocialMedia/SocialMediaContentManager';
import SocialMediaAnalytics from '../../components/SocialMedia/SocialMediaAnalytics';
import SocialMediaPostsList from '../../components/SocialMedia/SocialMediaPostsList';
import { ConfigService } from '../../services/socialMedia/ConfigService';
import toast from 'react-hot-toast';
import ModuleSettingsTabContent from '../../components/Modules/ModuleSettingsTabContent';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const SOCIAL_MEDIA_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'posts', label: 'Posts' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const SocialMediaDashboard = () => {
  const { selectedBusinessId, businessData } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'SocialMediaDashboard'
  });

  const [activeTab, setActiveTab] = useState('overview');
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [configService] = useState(new ConfigService());

  useEffect(() => {
    if (selectedBusinessId) {
      loadConfigs();
    }
  }, [selectedBusinessId]);

  const loadConfigs = async () => {
    try {
      setLoading(true);
      const loadedConfigs = await configService.getBusinessConfig(selectedBusinessId);
      setConfigs(loadedConfigs);
    } catch (error) {
      console.error('Error loading configs:', error);
      toast.error('Failed to load social media configurations');
    } finally {
      setLoading(false);
    }
  };

  const handleConfigurePlatform = (platform) => {
    setSelectedPlatform(platform);
    setShowConfigModal(true);
  };


  const handleConfigSaved = () => {
    setShowConfigModal(false);
    setSelectedPlatform(null);
    loadConfigs();
  };

  const platforms = [
    { id: 'instagram', name: 'Instagram', icon: Instagram, color: '#E4405F' },
    { id: 'facebook', name: 'Facebook', icon: Facebook, color: '#1877F2' },
    { id: 'twitter', name: 'Twitter/X', icon: Twitter, color: '#1DA1F2' },
    { id: 'tiktok', name: 'TikTok', icon: Music, color: '#000000' },
  ];

  const styles = {
    container: {
      maxWidth: '1400px',
      margin: '0 auto',
      padding: TavariStyles.spacing.xl,
    },
    header: {
      marginBottom: TavariStyles.spacing.xl,
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm,
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
    },
    platformsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
    },
    platformCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
    },
    platformIcon: {
      width: '48px',
      height: '48px',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    platformName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
    },
    platformStatus: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
    },
    configureButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      width: '100%',
    },
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <TavariModuleHeader
        title="Tavari Social Media"
        description="Configure platforms, manage AI-powered content, publish posts, and review analytics."
        actionLabel="+ Connect Platform"
        actionIcon={<Plus size={18} />}
        onAction={() => {
          setActiveTab('overview');
          setSelectedPlatform('instagram');
          setShowConfigModal(true);
        }}
      />

      <TavariTabSystemComponent
        tabs={SOCIAL_MEDIA_TABS}
        mode="state"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Social Media module"
        variant="module"
      />

      {activeTab === 'overview' && (
        <div>
          <div style={styles.platformsGrid}>
            {platforms.map(platform => {
              const config = configs.find(c => c.platform === platform.id);
              const Icon = platform.icon;
              const isConfigured = config && config.credentials?.accessToken;
              const isEnabled = config?.preferences?.postingEnabled;

              return (
                <div key={platform.id} style={styles.platformCard}>
                  <div
                    style={{
                      ...styles.platformIcon,
                      backgroundColor: platform.color + '20',
                      color: platform.color,
                    }}
                  >
                    <Icon size={24} />
                  </div>
                  <div style={styles.platformName}>{platform.name}</div>
                  <div style={styles.platformStatus}>
                    {isConfigured
                      ? isEnabled
                        ? '✓ Active'
                        : '⏸ Paused'
                      : '⚙️ Not Configured'}
                  </div>
                  <button
                    style={styles.configureButton}
                    onClick={() => handleConfigurePlatform(platform.id)}
                  >
                    {isConfigured ? 'Configure' : 'Set Up'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'content' && (
        <SocialMediaContentManager businessId={selectedBusinessId} />
      )}

      {activeTab === 'posts' && (
        <SocialMediaPostsList businessId={selectedBusinessId} />
      )}

      {activeTab === 'analytics' && (
        <SocialMediaAnalytics businessId={selectedBusinessId} />
      )}

      {activeTab === 'settings' && (
        <ModuleSettingsTabContent moduleKey="social_media" />
      )}

      {showConfigModal && (
        <SocialMediaConfigModal
          isOpen={showConfigModal}
          onClose={() => {
            setShowConfigModal(false);
            setSelectedPlatform(null);
          }}
          onSave={handleConfigSaved}
          businessId={selectedBusinessId}
          platform={selectedPlatform}
          existingConfig={configs.find(c => c.platform === selectedPlatform)}
        />
      )}

    </div>
  );
};

export default SocialMediaDashboard;


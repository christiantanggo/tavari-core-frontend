// screens/VoiceAgent/VoiceAgentDashboard.jsx
// Main dashboard for AI Voice Agent management
// 
// IMPORTANT: This component is used in TWO locations:
// 1. /tavari-voice/dashboard - Voice-only interface (no sidebar) via VoiceOnlyLayout
// 2. /dashboard/voice-agent - Full Tavari dashboard (with sidebar) via DashboardLayout
// 
// All updates to this component automatically apply to BOTH routes.
// Layout-specific adjustments (padding, spacing) should be handled in the respective layouts.
import React, { useState, useEffect } from 'react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import { Phone, Plus, BarChart3, Settings, PhoneCall, Users, TrendingUp, RefreshCw, Calendar, MessageSquare, FileText, Activity, BookOpen } from 'lucide-react';
import VoiceAgentService from '../../services/VoiceAgent/VoiceAgentService';
import ModuleCatalogService from '../../services/ModuleCatalogService';
import toast from 'react-hot-toast';
import AgentList from '../../components/VoiceAgent/AgentList';
import AgentAnalytics from '../../components/VoiceAgent/AgentAnalytics';
import AgentBookings from '../../components/VoiceAgent/AgentBookings';
import AgentMessages from '../../components/VoiceAgent/AgentMessages';
import AgentLogs from '../../components/VoiceAgent/AgentLogs';
import AgentSystemHealth from '../../components/VoiceAgent/AgentSystemHealth';
import AgentKnowledgeBase from '../../components/VoiceAgent/AgentKnowledgeBase';
import CreateAgentModal from '../../components/VoiceAgent/CreateAgentModal';
import AgentSettings from '../../components/VoiceAgent/AgentSettings';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const VOICE_AGENT_TABS = [
  { id: 'agents', label: 'Agents', icon: Phone },
  { id: 'analytics', label: 'Call History', icon: BarChart3 },
  { id: 'bookings', label: 'Bookings', icon: Calendar },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'health', label: 'System Health', icon: Activity },
  { id: 'knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const VoiceAgentDashboard = () => {
  const { selectedBusinessId, businessData } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'VoiceAgentDashboard'
  });

  const [activeTab, setActiveTab] = useState('agents');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [analytics, setAnalytics] = useState({
    totalCalls: 0,
    answeredCalls: 0,
    leadsCaptured: 0,
    bookingsCaptured: 0,
    callsHandledAutomatically: 0,
    automatedHandlingRate: '0.0',
    leadConversionRate: '0.0',
    conversionRate: '0.0'
  });
  const [voiceAgentService] = useState(new VoiceAgentService());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (selectedBusinessId) {
      voiceAgentService.setBusinessId(selectedBusinessId);
      loadData();
      trackModuleUsage();
    }
  }, [selectedBusinessId]);

  const trackModuleUsage = async () => {
    try {
      ModuleCatalogService.setBusinessId(selectedBusinessId);
      await ModuleCatalogService.trackModuleUsage('voice_agent');
    } catch (error) {
      // Silently fail - usage tracking is non-critical
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [agentsData, analyticsData] = await Promise.all([
        voiceAgentService.getAgents(),
        voiceAgentService.getAnalytics().catch(err => {
          console.error('Error loading analytics:', err);
          // Return default analytics object if fetch fails
          return {
            totalCalls: 0,
            answeredCalls: 0,
            leadsCaptured: 0,
            bookingsCaptured: 0,
            callsHandledAutomatically: 0,
            automatedHandlingRate: '0.0',
            leadConversionRate: '0.0',
            conversionRate: '0.0'
          };
        }),
      ]);
      setAgents(agentsData);
      console.log('📊 Analytics data loaded:', analyticsData);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error('Error loading voice agents:', error);
      toast.error('Failed to load voice agents');
    } finally {
      setLoading(false);
    }
  };

  const handleAgentCreated = () => {
    setShowCreateModal(false);
    loadData();
  };

  const handleSyncCalls = async () => {
    try {
      setSyncing(true);
      toast.loading('Syncing calls from Vapi API...', { id: 'sync-calls' });
      
      const result = await voiceAgentService.syncCalls(null, 7); // Sync last 7 days
      
      console.log('✅ Calls synced:', result);
      
      toast.success(
        `✅ Synced ${result.stats?.newCalls || 0} new calls, updated ${result.stats?.updatedCalls || 0} existing calls`,
        { id: 'sync-calls', duration: 5000 }
      );
      
      // Reload data to show updated analytics
      await loadData();
    } catch (error) {
      console.error('❌ Error syncing calls:', error);
      
      // Provide helpful error messages
      let errorMessage = error.message || 'Failed to sync calls';
      
      if (errorMessage.includes('No agents found')) {
        errorMessage = 'No voice agents found. Please create an agent first, then sync calls.';
      } else if (errorMessage.includes('not found')) {
        errorMessage = 'Sync function not available. Please try again in a few moments or contact support.';
      }
      
      toast.error(`❌ ${errorMessage}`, { id: 'sync-calls', duration: 6000 });
    } finally {
      setSyncing(false);
    }
  };

  const styles = {
    container: {
      maxWidth: '1400px',
      margin: '0 auto',
      padding: TavariStyles.spacing.xl,
    },
    header: {
      marginBottom: TavariStyles.spacing.xl,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
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
    createButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
    },
    statCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    },
    statValue: {
      fontSize: '33px',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs,
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
    },
  };

  // Add CSS animation for spinning icon
  const spinKeyframes = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;

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
    <>
      <style>{spinKeyframes}</style>
    <div style={styles.container}>
      <TavariModuleHeader
        title="Tavari AI Voice Agent"
        description="Manage AI phone agents that answer calls 24/7, capture leads, and schedule appointments."
        secondaryActionLabel={syncing ? 'Syncing...' : 'Sync Calls'}
        secondaryActionIcon={<RefreshCw size={18} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />}
        onSecondaryAction={handleSyncCalls}
        secondaryActionDisabled={syncing}
        actionLabel="Create Agent"
        actionIcon={<Plus size={18} />}
        onAction={() => setShowCreateModal(true)}
      />

      {/* Stats Overview - Always show, even if analytics are loading or empty */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{analytics?.totalCalls ?? 0}</div>
          <div style={styles.statLabel}>Total Calls</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{analytics?.answeredCalls ?? 0}</div>
          <div style={styles.statLabel}>Answered</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{analytics?.callsHandledAutomatically ?? 0}</div>
          <div style={styles.statLabel}>Handled Automatically</div>
          <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
            No human intervention needed
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{analytics?.automatedHandlingRate ?? '0.0'}%</div>
          <div style={styles.statLabel}>Automated Handling Rate</div>
          <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
            % of answered calls handled by AI
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{analytics?.leadsCaptured ?? 0}</div>
          <div style={styles.statLabel}>Leads Captured</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{analytics?.bookingsCaptured ?? 0}</div>
          <div style={styles.statLabel}>Bookings Made</div>
        </div>
      </div>

      <TavariTabSystemComponent
        tabs={VOICE_AGENT_TABS}
        mode="state"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Voice Agent module"
        variant="module"
      />

      {/* Tab Content */}
      {activeTab === 'agents' && (
        <AgentList
          agents={agents}
          businessId={selectedBusinessId}
          onRefresh={loadData}
          voiceAgentService={voiceAgentService}
        />
      )}

      {activeTab === 'analytics' && (
        <AgentAnalytics
          businessId={selectedBusinessId}
          voiceAgentService={voiceAgentService}
        />
      )}

      {activeTab === 'bookings' && (
        <AgentBookings
          businessId={selectedBusinessId}
          voiceAgentService={voiceAgentService}
        />
      )}

      {activeTab === 'messages' && (
        <AgentMessages
          businessId={selectedBusinessId}
          voiceAgentService={voiceAgentService}
        />
      )}

      {activeTab === 'logs' && (
        <AgentLogs
          businessId={selectedBusinessId}
          voiceAgentService={voiceAgentService}
        />
      )}

      {activeTab === 'health' && (
        <AgentSystemHealth
          businessId={selectedBusinessId}
          voiceAgentService={voiceAgentService}
        />
      )}

      {activeTab === 'knowledge-base' && (
        <AgentKnowledgeBase
          businessId={selectedBusinessId}
          voiceAgentService={voiceAgentService}
        />
      )}

      {activeTab === 'settings' && (
        <AgentSettings
          businessId={selectedBusinessId}
          voiceAgentService={voiceAgentService}
          onSaved={loadData}
        />
      )}

      {showCreateModal && (
        <CreateAgentModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleAgentCreated}
          businessId={selectedBusinessId}
          businessData={businessData}
          voiceAgentService={voiceAgentService}
        />
      )}
    </div>
    </>
  );
};

export default VoiceAgentDashboard;



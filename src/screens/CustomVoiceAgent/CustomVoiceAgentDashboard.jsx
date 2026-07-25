// screens/CustomVoiceAgent/CustomVoiceAgentDashboard.jsx
// Main dashboard for Custom AI Voice Agent management
// Uses Telnyx + OpenAI Realtime directly (no VAPI)
import React, { useState, useEffect } from 'react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import { Phone, Plus, BarChart3, Settings, Calendar, MessageSquare, FileText, Activity, BookOpen } from 'lucide-react';
import CustomVoiceAgentService from '../../services/CustomVoiceAgent/CustomVoiceAgentService';
import ModuleCatalogService from '../../services/ModuleCatalogService';
import toast from 'react-hot-toast';
import CustomAgentList from '../../components/CustomVoiceAgent/CustomAgentList';
import CustomAgentAnalytics from '../../components/CustomVoiceAgent/CustomAgentAnalytics';
import CustomAgentBookings from '../../components/CustomVoiceAgent/CustomAgentBookings';
import CustomAgentMessages from '../../components/CustomVoiceAgent/CustomAgentMessages';
import CustomAgentLogs from '../../components/CustomVoiceAgent/CustomAgentLogs';
import CustomAgentSystemHealth from '../../components/CustomVoiceAgent/CustomAgentSystemHealth';
import CustomAgentKnowledgeBase from '../../components/CustomVoiceAgent/CustomAgentKnowledgeBase';
import CreateCustomAgentModal from '../../components/CustomVoiceAgent/CreateCustomAgentModal';
import CustomAgentSettings from '../../components/CustomVoiceAgent/CustomAgentSettings';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const CUSTOM_VOICE_AGENT_TABS = [
  { id: 'agents', label: 'Agents', icon: Phone },
  { id: 'analytics', label: 'Call History', icon: BarChart3 },
  { id: 'bookings', label: 'Bookings', icon: Calendar },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'health', label: 'System Health', icon: Activity },
  { id: 'knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const CustomVoiceAgentDashboard = () => {
  const { selectedBusinessId, businessData } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'CustomVoiceAgentDashboard'
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
  const [customVoiceAgentService] = useState(new CustomVoiceAgentService());

  useEffect(() => {
    if (selectedBusinessId) {
      customVoiceAgentService.setBusinessId(selectedBusinessId);
      loadData();
      trackModuleUsage();
    }
  }, [selectedBusinessId]);

  const trackModuleUsage = async () => {
    try {
      ModuleCatalogService.setBusinessId(selectedBusinessId);
      await ModuleCatalogService.trackModuleUsage('custom_voice_agent');
    } catch (error) {
      // Silently fail - usage tracking is non-critical
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      console.log('📥 Loading data for business:', selectedBusinessId);
      
      const [agentsData, analyticsData] = await Promise.all([
        customVoiceAgentService.getAgents().catch(err => {
          console.error('❌ Error loading agents:', err);
          toast.error('Failed to load agents: ' + (err.message || 'Unknown error'));
          return [];
        }),
        customVoiceAgentService.getAnalytics().catch(err => {
          console.error('Error loading analytics:', err);
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
      
      console.log('📋 Agents data received:', agentsData);
      console.log('📊 Analytics data loaded:', analyticsData);
      
      setAgents(agentsData || []);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error('Error loading custom voice agents:', error);
      toast.error('Failed to load custom voice agents: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleAgentCreated = () => {
    setShowCreateModal(false);
    loadData();
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
        title="Tavari Custom Voice Agent"
        description="Manage custom AI phone agents using Telnyx and OpenAI Realtime. Answer calls 24/7, capture leads, and schedule appointments."
        actionLabel="Create Agent"
        actionIcon={<Plus size={18} />}
        onAction={() => setShowCreateModal(true)}
      />

      {/* Stats Overview */}
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
        tabs={CUSTOM_VOICE_AGENT_TABS}
        mode="state"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Custom Voice Agent module"
        variant="module"
      />

      {/* Tab Content */}
      {activeTab === 'agents' && (
        <CustomAgentList
          agents={agents}
          businessId={selectedBusinessId}
          onRefresh={loadData}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {activeTab === 'analytics' && (
        <CustomAgentAnalytics
          businessId={selectedBusinessId}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {activeTab === 'bookings' && (
        <CustomAgentBookings
          businessId={selectedBusinessId}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {activeTab === 'messages' && (
        <CustomAgentMessages
          businessId={selectedBusinessId}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {activeTab === 'logs' && (
        <CustomAgentLogs
          businessId={selectedBusinessId}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {activeTab === 'health' && (
        <CustomAgentSystemHealth
          businessId={selectedBusinessId}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {activeTab === 'knowledge-base' && (
        <CustomAgentKnowledgeBase
          businessId={selectedBusinessId}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {activeTab === 'settings' && (
        <CustomAgentSettings
          businessId={selectedBusinessId}
          customVoiceAgentService={customVoiceAgentService}
          onSaved={loadData}
        />
      )}

      {showCreateModal && (
        <CreateCustomAgentModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleAgentCreated}
          businessId={selectedBusinessId}
          businessData={businessData}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}
    </div>
  );
};

export default CustomVoiceAgentDashboard;


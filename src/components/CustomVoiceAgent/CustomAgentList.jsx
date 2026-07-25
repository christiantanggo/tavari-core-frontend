// components/CustomVoiceAgent/CustomAgentList.jsx
// List of custom voice agents with status and actions
import React, { useState } from 'react';
import { Phone, Play, Pause, Settings, Trash2, PhoneCall } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import CustomEditAgentModal from './CustomEditAgentModal';
import CustomPhoneNumberBrowser from './CustomPhoneNumberBrowser';

const CustomAgentList = ({ agents, businessId, onRefresh, customVoiceAgentService }) => {
  const [editingAgent, setEditingAgent] = useState(null);
  const [showPhoneBrowser, setShowPhoneBrowser] = useState(false);
  const [phoneBrowserAgent, setPhoneBrowserAgent] = useState(null);
  
  const handleToggleActive = async (agent) => {
    // If deactivating, just update the flag
    if (agent.is_active) {
      try {
        await customVoiceAgentService.updateAgent(agent.id, {
          is_active: false,
        });
        toast.success('Agent deactivated');
        onRefresh();
      } catch (error) {
        console.error('Error deactivating agent:', error);
        toast.error('Failed to deactivate agent');
      }
      return;
    }

    // If activating, show phone number browser
    setPhoneBrowserAgent(agent);
    setShowPhoneBrowser(true);
  };

  const handlePhoneNumberSelected = async (phoneNumberData) => {
    if (!phoneBrowserAgent) return;

    const phoneNumber = typeof phoneNumberData === 'string' 
      ? phoneNumberData 
      : phoneNumberData.phone_number || phoneNumberData;

    // Check if forwarding is enabled
    const isForwarding = phoneNumberData?.is_forwarding || phoneNumberData?.forward_enabled;
    const forwardToPhone = phoneNumberData?.forward_to_phone;
    const ringCount = phoneNumberData?.ring_count || 3;

    try {
      console.log('🚀 Activating custom agent:', phoneBrowserAgent.id, 'with phone:', phoneNumber);
      if (isForwarding) {
        console.log('📞 Forwarding enabled:', { forwardToPhone, ringCount });
      }
      
      toast.loading('Connecting phone number to Telnyx...', { id: 'activating' });
      
      // Connect Telnyx phone number (replaces VAPI)
      await customVoiceAgentService.connectPhoneNumber(phoneBrowserAgent.id, phoneNumber);
      
      // If forwarding is enabled, update agent with forwarding settings
      if (isForwarding && forwardToPhone) {
        await customVoiceAgentService.updateAgent(phoneBrowserAgent.id, {
          forward_to_phone: forwardToPhone,
          ring_count: ringCount,
        });
        
        toast.loading('Configuring call forwarding...', { id: 'forwarding' });
      }
      
      toast.success('Agent activated successfully!', { id: 'activating' });
      if (isForwarding) {
        toast.success('Call forwarding configured!', { id: 'forwarding' });
      }
      console.log('✅ Custom agent activated successfully');
      setShowPhoneBrowser(false);
      setPhoneBrowserAgent(null);
      onRefresh();
    } catch (error) {
      console.error('❌ Error activating custom agent:', error);
      toast.error('Failed to activate agent: ' + (error.message || 'Unknown error'), { id: 'activating' });
    }
  };

  const handleDelete = async (agent) => {
    if (!window.confirm(`Are you sure you want to delete "${agent.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await customVoiceAgentService.deleteAgent(agent.id);
      toast.success('Agent deleted');
      onRefresh();
    } catch (error) {
      console.error('Error deleting agent:', error);
      toast.error('Failed to delete agent');
    }
  };

  if (!agents || agents.length === 0) {
    return (
      <div style={{
        backgroundColor: TavariStyles.colors.white,
        borderRadius: TavariStyles.borderRadius?.lg || '12px',
        padding: TavariStyles.spacing['3xl'],
        textAlign: 'center',
        border: `1px solid ${TavariStyles.colors.gray200}`,
      }}>
        <Phone size={48} color={TavariStyles.colors.gray400} style={{ marginBottom: '16px', margin: '0 auto 16px' }} />
        <h3 style={{
          fontSize: TavariStyles.typography.fontSize.xl,
          fontWeight: TavariStyles.typography.fontWeight.semibold,
          color: TavariStyles.colors.gray900,
          marginBottom: '8px',
        }}>
          No Custom Voice Agents Yet
        </h3>
        <p style={{
          fontSize: TavariStyles.typography.fontSize.base,
          color: TavariStyles.colors.gray600,
          marginBottom: '24px',
        }}>
          Create your first custom AI voice agent using Telnyx + OpenAI Realtime
        </p>
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
      gap: TavariStyles.spacing.lg,
    }}>
      {agents.map(agent => (
        <div
          key={agent.id}
          style={{
            backgroundColor: TavariStyles.colors.white,
            borderRadius: TavariStyles.borderRadius?.lg || '12px',
            padding: TavariStyles.spacing.xl,
            border: `1px solid ${TavariStyles.colors.gray200}`,
            boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: TavariStyles.spacing.md,
          }}>
            <div style={{ flex: 1 }}>
              <h3 style={{
                fontSize: TavariStyles.typography.fontSize.lg,
                fontWeight: TavariStyles.typography.fontWeight.semibold,
                color: TavariStyles.colors.gray900,
                marginBottom: '4px',
              }}>
                {agent.name}
              </h3>
              {agent.description && (
                <p style={{
                  fontSize: TavariStyles.typography.fontSize.sm,
                  color: TavariStyles.colors.gray600,
                }}>
                  {agent.description}
                </p>
              )}
            </div>
            <div style={{
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: '600',
              backgroundColor: agent.is_active ? '#d1fae5' : '#fee2e2',
              color: agent.is_active ? '#065f46' : '#991b1b',
            }}>
              {agent.is_active ? 'Active' : 'Inactive'}
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: TavariStyles.spacing.sm,
            marginBottom: TavariStyles.spacing.md,
            flexWrap: 'wrap',
          }}>
            {agent.industry_type && (
              <span style={{
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '13px',
                backgroundColor: TavariStyles.colors.gray100,
                color: TavariStyles.colors.gray700,
              }}>
                {agent.industry_type}
              </span>
            )}
            {agent.phone_number && (
              <span style={{
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '13px',
                backgroundColor: TavariStyles.colors.gray100,
                color: TavariStyles.colors.gray700,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <PhoneCall size={12} />
                {agent.phone_number}
              </span>
            )}
          </div>

          <div style={{
            display: 'flex',
            gap: TavariStyles.spacing.sm,
            marginTop: TavariStyles.spacing.md,
            paddingTop: TavariStyles.spacing.md,
            borderTop: `1px solid ${TavariStyles.colors.gray200}`,
          }}>
            <button
              onClick={() => handleToggleActive(agent)}
              style={{
                flex: 1,
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                backgroundColor: agent.is_active ? TavariStyles.colors.gray200 : TavariStyles.colors.primary || '#008080',
                color: agent.is_active ? TavariStyles.colors.gray700 : TavariStyles.colors.white,
                border: 'none',
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                fontSize: TavariStyles.typography.fontSize.sm,
                fontWeight: TavariStyles.typography.fontWeight.medium,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: TavariStyles.spacing.xs,
              }}
            >
              {agent.is_active ? <Pause size={16} /> : <Play size={16} />}
              {agent.is_active ? 'Pause' : 'Activate'}
            </button>
            <button
              onClick={() => setEditingAgent(agent)}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                backgroundColor: 'transparent',
                color: TavariStyles.colors.gray600,
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                fontSize: TavariStyles.typography.fontSize.sm,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Settings size={16} />
            </button>
            <button
              onClick={() => handleDelete(agent)}
              style={{
                padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                backgroundColor: 'transparent',
                color: '#dc2626',
                border: `1px solid #fee2e2`,
                borderRadius: TavariStyles.borderRadius?.md || '8px',
                fontSize: TavariStyles.typography.fontSize.sm,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}

      {editingAgent && (
        <CustomEditAgentModal
          isOpen={!!editingAgent}
          onClose={() => setEditingAgent(null)}
          agent={editingAgent}
          onSuccess={async () => {
            await onRefresh();
            setTimeout(() => {
              setEditingAgent(null);
            }, 3000);
          }}
          customVoiceAgentService={customVoiceAgentService}
        />
      )}

      {showPhoneBrowser && (
        <CustomPhoneNumberBrowser
          isOpen={showPhoneBrowser}
          onClose={() => {
            setShowPhoneBrowser(false);
            setPhoneBrowserAgent(null);
          }}
          onSelect={handlePhoneNumberSelected}
          businessId={businessId}
          showPurchaseOption={true}
        />
      )}
    </div>
  );
};

export default CustomAgentList;


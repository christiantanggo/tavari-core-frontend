// components/VoiceAgent/EditAgentModal.jsx
// Modal for editing basic voice agent settings (name, description, voice, confidence, notifications)
import React, { useState, useEffect } from 'react';
import { X, Save, Phone } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import PhoneNumberBrowser from './PhoneNumberBrowser';
import { usePOSAuth } from '../../hooks/usePOSAuth';

const EditAgentModal = ({ isOpen, onClose, agent, onSuccess, voiceAgentService }) => {
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Form data
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    voiceId: 'alloy',
    voiceStyle: '',
    confidenceThreshold: 98.0,
    ringCountBeforeAnswer: 3,
    messageNotificationEmail: '',
    issueNotificationEmail: '',
  });

  // Phone number browser
  const [showPhoneBrowser, setShowPhoneBrowser] = useState(false);
  const { selectedBusinessId } = usePOSAuth({ requireBusiness: false });

  // Load all data when modal opens
  useEffect(() => {
    if (isOpen && agent && voiceAgentService) {
      loadAllData();
    }
  }, [isOpen, agent, voiceAgentService]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // Load agent data
      if (agent) {
        setFormData({
          name: agent.name || '',
          description: agent.description || '',
          voiceId: agent.voice_id || 'alloy',
          voiceStyle: agent.voice_style || '',
          confidenceThreshold: agent.confidence_threshold || 98.0,
          ringCountBeforeAnswer: agent.ring_count_before_answer || 3,
          messageNotificationEmail: agent.message_notification_email || '',
          issueNotificationEmail: agent.issue_notification_email || '',
        });
      }

      setSaveStatus(null);
      setSaveMessage('');
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load agent data');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !agent) return null;


  const handleSave = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Validate required fields
    if (!formData.name || !formData.name.trim()) {
      toast.error('Agent name is required');
      setSaveStatus('error');
      setSaveMessage('Agent name is required');
      return;
    }


    if (!voiceAgentService) {
      toast.error('Voice agent service is not available');
      return;
    }

    setSaving(true);
    setSaveStatus(null);
    setSaveMessage('Saving changes...');
    const toastId = toast.loading('Saving agent changes...');

    try {
      // Build update payload
      const updatePayload = {
        name: formData.name.trim(),
        description: formData.description?.trim() || null,
        voice_id: formData.voiceId || 'alloy',
        voice_style: formData.voiceStyle || null,
        confidence_threshold: parseFloat(formData.confidenceThreshold) || 98.0,
        ring_count_before_answer: parseInt(formData.ringCountBeforeAnswer) || 3,
        message_notification_email: formData.messageNotificationEmail?.trim() || null,
        issue_notification_email: formData.issueNotificationEmail?.trim() || null,
      };

      console.log('💾 Saving agent with payload:', updatePayload);

      // Update agent in database
      const updatedAgent = await voiceAgentService.updateAgent(agent.id, updatePayload);
      console.log('✅ Agent updated:', updatedAgent);

      // Rebuild the assistant when saving to ensure it has latest settings
      // Knowledge base (FAQs, messages, personality) is managed separately in Knowledge Base tab
      if (agent.vapi_assistant_id) {
        console.log('🔄 Rebuilding Vapi assistant with latest agent settings...');
        setSaveMessage('Rebuilding Vapi assistant with latest settings...');
        toast.loading('Rebuilding Vapi assistant...', { id: 'vapi-update' });

        try {
          await voiceAgentService.rebuildVapiAssistant(agent.id);
          console.log('✅ Vapi assistant rebuilt successfully!');
          toast.success('✅ Vapi assistant rebuilt! Changes are now active.', { id: 'vapi-update', duration: 5000 });
        } catch (vapiError) {
          console.error('❌ Failed to rebuild Vapi assistant:', vapiError);
          toast.error('⚠️ Database updated, but failed to rebuild Vapi assistant. Changes may not be active until next call.', { id: 'vapi-update', duration: 6000 });
        }
      }

      setSaveStatus('success');
      setSaveMessage('✅ Agent updated successfully! All changes have been saved. The voice agent will use the updated settings on the next phone call.');
      toast.success('✅ Agent updated successfully!', { id: toastId, duration: 4000 });

      // Refresh data
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (onSuccess) {
        onSuccess();
      }

    } catch (error) {
      console.error('❌ Error updating agent:', error);
      const errorMessage = error.message || 'Unknown error';
      setSaveStatus('error');
      setSaveMessage(`❌ Failed to update agent: ${errorMessage}`);
      toast.error(`❌ Failed to update agent: ${errorMessage}`, { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePhoneNumber = () => {
    setShowPhoneBrowser(true);
  };

  const handlePhoneNumberSelected = async (phoneNumberData) => {
    const phoneNumber = typeof phoneNumberData === 'string' 
      ? phoneNumberData 
      : phoneNumberData.phone_number || phoneNumberData;

    try {
      toast.loading('Updating phone number...', { id: 'phone-update' });
      await voiceAgentService.createVapiAgent(agent.id, phoneNumber);
      toast.success('Phone number updated!', { id: 'phone-update' });
      setShowPhoneBrowser(false);
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Error updating phone number:', error);
      toast.error('Failed to update phone number: ' + (error.message || 'Unknown error'), { id: 'phone-update' });
    }
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
      zIndex: 1000,
      padding: TavariStyles.spacing.lg,
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '900px',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0,0,0,0.1)',
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      backgroundColor: TavariStyles.colors.white,
      zIndex: 10,
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
    },
    content: {
      padding: TavariStyles.spacing.xl,
    },
    section: {
      marginBottom: TavariStyles.spacing.xl,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    sectionSubtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.md,
    },
    label: {
      display: 'block',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box',
    },
    textarea: {
      width: '100%',
      minHeight: '120px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontFamily: 'inherit',
      resize: 'vertical',
    },
    phoneSection: {
      padding: TavariStyles.spacing.md,
      backgroundColor: '#fef3c7',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.md,
      border: '1px solid #fbbf24',
    },
    phoneInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: '#92400e',
      marginBottom: TavariStyles.spacing.sm,
    },
    phoneButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: '#f59e0b',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
      position: 'sticky',
      bottom: 0,
      backgroundColor: TavariStyles.colors.white,
      zIndex: 10,
    },
    cancelButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    saveButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      cursor: saving ? 'not-allowed' : 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      opacity: saving ? 0.6 : 1,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    businessInfoDisplay: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      whiteSpace: 'pre-line',
    },
    infoNote: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.xs,
    },
    faqItem: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.sm,
    },
    faqActions: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      marginTop: TavariStyles.spacing.sm,
    },
    buttonSmall: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    },
  };

  if (loading) {
    return (
      <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div>Loading agent data...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Edit Agent: {agent.name}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <X size={24} color={TavariStyles.colors.gray600} />
          </button>
        </div>

        <div style={styles.content}>
          {/* Save Status Message */}
          {(saveStatus || saveMessage) && (
            <div style={{
              backgroundColor: saveStatus === 'success' ? '#d1fae5' : saveStatus === 'error' ? '#fee2e2' : '#dbeafe',
              border: `2px solid ${saveStatus === 'success' ? '#10b981' : saveStatus === 'error' ? '#ef4444' : '#3b82f6'}`,
              color: saveStatus === 'success' ? '#065f46' : saveStatus === 'error' ? '#991b1b' : '#1e40af',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: TavariStyles.typography.fontSize.base,
            }}>
              {saveMessage || (saving ? 'Saving...' : '')}
            </div>
          )}

          {/* Phone Number Section */}
          <div style={styles.phoneSection}>
            <div style={styles.phoneInfo}>
              <strong>📞 Phone Number:</strong> {agent.phone_number || 'Not connected'}
            </div>
            <button onClick={handleUpdatePhoneNumber} style={styles.phoneButton}>
              <Phone size={16} />
              {agent.phone_number ? 'Update Phone Number' : 'Connect Phone Number'}
            </button>
          </div>

          {/* Basic Agent Settings */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>🤖 Agent Settings</h3>
            <p style={styles.sectionSubtitle}>
              Manage basic agent settings here. For FAQs, personality, and messages, use the Knowledge Base tab.
            </p>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Agent Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={styles.input}
                placeholder="e.g., Main Receptionist"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                style={styles.input}
                placeholder="Brief description"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Voice</label>
                <select
                  value={formData.voiceId}
                  onChange={(e) => setFormData({ ...formData, voiceId: e.target.value })}
                  style={styles.input}
                >
                  <option value="alloy">Alloy (Neutral, Balanced)</option>
                  <option value="echo">Echo (Male, Clear)</option>
                  <option value="fable">Fable (British, Storytelling)</option>
                  <option value="onyx">Onyx (Deep Male)</option>
                  <option value="nova">Nova (Warm Female)</option>
                  <option value="shimmer">Shimmer (Soft Female)</option>
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Voice Style</label>
                <select
                  value={formData.voiceStyle}
                  onChange={(e) => setFormData({ ...formData, voiceStyle: e.target.value })}
                  style={styles.input}
                >
                  <option value="">Default</option>
                  <option value="conversational">Conversational</option>
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="energetic">Energetic</option>
                  <option value="calm">Calm</option>
                  <option value="authoritative">Authoritative</option>
                  <option value="warm">Warm</option>
                  <option value="casual">Casual</option>
                </select>
              </div>
            </div>
          </div>


          {/* Confidence & Message Settings */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>🎯 Confidence & Message Settings</h3>
            <p style={styles.sectionSubtitle}>
              Configure when the AI should take a message instead of answering (Phase 1: Voicemail System)
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Confidence Threshold (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formData.confidenceThreshold}
                  onChange={(e) => setFormData({ ...formData, confidenceThreshold: e.target.value })}
                  style={styles.input}
                />
                <p style={styles.infoNote}>
                  If AI confidence is below this, it will take a message for callback. Default: 98%
                </p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Rings Before Answer</label>
                <input
                  type="number"
                  min="2"
                  max="5"
                  value={formData.ringCountBeforeAnswer}
                  onChange={(e) => setFormData({ ...formData, ringCountBeforeAnswer: e.target.value })}
                  style={styles.input}
                />
                <p style={styles.infoNote}>
                  Number of rings before AI answers (2-5). Default: 3
                </p>
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Message Notification Email</label>
              <input
                type="email"
                value={formData.messageNotificationEmail}
                onChange={(e) => setFormData({ ...formData, messageNotificationEmail: e.target.value })}
                style={styles.input}
                placeholder="email@example.com"
              />
              <p style={styles.infoNote}>
                Email address to receive notifications when AI takes a message or callback booking. Leave empty to use business email.
              </p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Issue Notification Email (Optional)</label>
              <input
                type="email"
                value={formData.issueNotificationEmail}
                onChange={(e) => setFormData({ ...formData, issueNotificationEmail: e.target.value })}
                style={styles.input}
                placeholder="email@example.com"
              />
              <p style={styles.infoNote}>
                Separate email for AI-identified issues and knowledge gaps. If not set, uses message notification email or business email.
              </p>
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
          <button 
            type="button"
            onClick={handleSave} 
            disabled={saving} 
            style={styles.saveButton}
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {showPhoneBrowser && (
        <PhoneNumberBrowser
          isOpen={showPhoneBrowser}
          onClose={() => setShowPhoneBrowser(false)}
          onSelect={handlePhoneNumberSelected}
          businessId={selectedBusinessId || agent?.business_id}
          showPurchaseOption={true}
        />
      )}
    </div>
  );
};

export default EditAgentModal;

// components/VoiceAgent/CreateAgentModal.jsx
// Modal for creating a new voice agent with industry templates
import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import { INDUSTRY_TEMPLATES } from '../../constants/voiceAgentTemplates';
import toast from 'react-hot-toast';

const CreateAgentModal = ({ isOpen, onClose, onSuccess, businessId, businessData, voiceAgentService }) => {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    industryType: '',
    systemPrompt: '',
    firstMessage: '',
        voiceProvider: 'openai',
        voiceId: 'alloy',
        voiceStyle: '',
    modelProvider: 'openai',
    modelName: 'gpt-4',
    temperature: 0.7,
    maxTokens: 250,
    businessName: businessData?.name || '',
    businessHours: '',
    businessAddress: businessData?.address || '',
    businessPhone: businessData?.phone || '',
    servicesConfig: {},
    knowledgeBase: '',
  });

  if (!isOpen) return null;

  const handleIndustrySelect = (industryType) => {
    if (industryType === 'custom') {
      setFormData(prev => ({
        ...prev,
        industryType: 'custom',
        systemPrompt: '',
        firstMessage: '',
      }));
      setStep(2);
      return;
    }

    const template = INDUSTRY_TEMPLATES[industryType];
    if (template) {
      // Replace placeholders with business data
      let systemPrompt = template.systemPrompt;
      let firstMessage = template.firstMessage;
      
      systemPrompt = systemPrompt.replace(/\[NAME\]/g, formData.businessName);
      systemPrompt = systemPrompt.replace(/\[COMPANY\]/g, formData.businessName);
      systemPrompt = systemPrompt.replace(/\[PRACTICE NAME\]/g, formData.businessName);
      firstMessage = firstMessage.replace(/\[NAME\]/g, formData.businessName);
      firstMessage = firstMessage.replace(/\[COMPANY\]/g, formData.businessName);
      firstMessage = firstMessage.replace(/\[PRACTICE NAME\]/g, formData.businessName);

      setFormData(prev => ({
        ...prev,
        industryType,
        systemPrompt,
        firstMessage,
        voiceId: template.voiceId || 'alloy',
      }));
    }
    setStep(2);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.systemPrompt || !formData.knowledgeBase) {
      toast.error('Please fill in all required fields (Name, System Prompt, and Knowledge Base)');
      return;
    }

    setSaving(true);
    try {
      await voiceAgentService.createAgent({
        ...formData,
        knowledge_base: formData.knowledgeBase,
      });
      toast.success('Voice agent created successfully!');
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Error creating agent:', error);
      toast.error('Failed to create agent: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
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
      maxWidth: '700px',
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
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
    },
    content: {
      padding: TavariStyles.spacing.xl,
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
    industryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.md,
    },
    industryCard: {
      padding: TavariStyles.spacing.lg,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      textAlign: 'center',
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
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
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Create Voice Agent</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <X size={24} color={TavariStyles.colors.gray600} />
          </button>
        </div>

        <div style={styles.content}>
          {step === 1 && (
            <>
              <h3 style={{ fontSize: TavariStyles.typography.fontSize.lg, fontWeight: '600', marginBottom: TavariStyles.spacing.md }}>
                Select Industry Template
              </h3>
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.lg }}>
                Choose a template to get started quickly, or create a custom agent
              </p>
              <div style={styles.industryGrid}>
                {Object.entries(INDUSTRY_TEMPLATES).map(([key, template]) => (
                  <div
                    key={key}
                    onClick={() => handleIndustrySelect(key)}
                    style={styles.industryCard}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = TavariStyles.colors.primary || '#008080';
                      e.currentTarget.style.backgroundColor = '#f0fdfa';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>
                      {key === 'fec' && '🎉'}
                      {key === 'restaurant' && '🍕'}
                      {key === 'medical' && '🏥'}
                      {key === 'salon' && '💇'}
                      {key === 'contractor' && '🔧'}
                      {key === 'gym' && '💪'}
                      {key === 'realEstate' && '🏠'}
                      {key === 'autoRepair' && '🚗'}
                      {key === 'daycare' && '👶'}
                    </div>
                    <div style={{ fontWeight: '600', textTransform: 'capitalize' }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </div>
                  </div>
                ))}
                <div
                  onClick={() => handleIndustrySelect('custom')}
                  style={styles.industryCard}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = TavariStyles.colors.primary || '#008080';
                    e.currentTarget.style.backgroundColor = '#f0fdfa';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚙️</div>
                  <div style={{ fontWeight: '600' }}>Custom</div>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>Agent Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  style={styles.input}
                  placeholder="e.g., Main Receptionist, Sales Line"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  style={styles.input}
                  placeholder="Brief description of this agent"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Knowledge Base *
                  <span style={{ fontSize: '13px', color: TavariStyles.colors.gray500, fontWeight: 'normal', marginLeft: '8px' }}>
                    (Business-specific information, rules, policies, FAQs)
                  </span>
                </label>
                <textarea
                  value={formData.knowledgeBase}
                  onChange={(e) => setFormData({ ...formData, knowledgeBase: e.target.value })}
                  style={{ ...styles.textarea, minHeight: '200px' }}
                  placeholder="Enter all the information the AI should know about your business. For example:
- Business hours and policies
- Rules and regulations
- Pricing information
- Services offered
- Common questions and answers
- Any specific information customers might ask about

The AI will ONLY answer questions based on this information. If asked about something not listed here, it will redirect the caller to speak with someone at your business."
                />
                <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                  ⚠️ Important: The AI will only answer questions based on this knowledge base. Unknown questions will be redirected to your business.
                </p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Knowledge Base *
                  <span style={{ fontSize: '13px', color: TavariStyles.colors.gray500, fontWeight: 'normal', marginLeft: '8px' }}>
                    (Business-specific information, rules, policies, FAQs)
                  </span>
                </label>
                <textarea
                  value={formData.knowledgeBase}
                  onChange={(e) => setFormData({ ...formData, knowledgeBase: e.target.value })}
                  style={{ ...styles.textarea, minHeight: '200px' }}
                  placeholder="Enter all the information the AI should know about your business. For example:
- Business hours and policies
- Rules and regulations
- Pricing information
- Services offered
- Common questions and answers
- Any specific information customers might ask about

The AI will ONLY answer questions based on this information. If asked about something not listed here, it will redirect the caller to speak with someone at your business."
                />
                <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                  ⚠️ Important: The AI will only answer questions based on this knowledge base. Unknown questions will be redirected to your business.
                </p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>System Prompt *</label>
                <textarea
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                  style={styles.textarea}
                  placeholder="Instructions for the AI agent..."
                />
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
                  This defines how the agent behaves and what information it has access to
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>First Message</label>
                <input
                  type="text"
                  value={formData.firstMessage}
                  onChange={(e) => setFormData({ ...formData, firstMessage: e.target.value })}
                  style={styles.input}
                  placeholder="What the agent says when answering"
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

              <div style={styles.formGroup}>
                <label style={styles.label}>Business Hours</label>
                <input
                  type="text"
                  value={formData.businessHours}
                  onChange={(e) => setFormData({ ...formData, businessHours: e.target.value })}
                  style={styles.input}
                  placeholder="e.g., Mon-Fri 9am-9pm, Sat-Sun 10am-10pm"
                />
              </div>
            </>
          )}
        </div>

        <div style={styles.footer}>
          {step === 2 && (
            <button onClick={() => setStep(1)} style={styles.cancelButton}>
              Back
            </button>
          )}
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
          {step === 2 && (
            <button onClick={handleSave} disabled={saving} style={styles.saveButton}>
              <Save size={18} />
              {saving ? 'Creating...' : 'Create Agent'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateAgentModal;


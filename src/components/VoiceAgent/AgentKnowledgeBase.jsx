// components/VoiceAgent/AgentKnowledgeBase.jsx
// Unified Knowledge Base management for all AI agents (voice, SMS, email)
import React, { useState, useEffect, useCallback } from 'react';
import { BookOpen, Save, Plus, Edit2, Trash2, ArrowUp, ArrowDown, Info, Loader, CheckCircle2 } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { usePOSAuth } from '../../hooks/usePOSAuth';

const AgentKnowledgeBase = ({ businessId, voiceAgentService }) => {
  const { selectedBusinessId } = usePOSAuth({ requireBusiness: false });
  const effectiveBusinessId = businessId || selectedBusinessId;
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState(null);
  
  // Knowledge Base data
  const [knowledgeBase, setKnowledgeBase] = useState({
    first_message: '',
    last_message: '',
    personality_prompt: '',
    knowledge_base_text: '',
  });
  
  // FAQs
  const [faqs, setFaqs] = useState([]);
  const [editingFaq, setEditingFaq] = useState(null);
  const [newFaq, setNewFaq] = useState({ question: '', answer: '' });
  
  // Business info (read-only)
  const [businessInfo, setBusinessInfo] = useState(null);
  
  // Load all data
  useEffect(() => {
    if (effectiveBusinessId && voiceAgentService) {
      loadAllData();
    }
  }, [effectiveBusinessId, voiceAgentService]);
  
  const loadAllData = async () => {
    setLoading(true);
    try {
      // Load knowledge base
      if (voiceAgentService?.getKnowledgeBase) {
        try {
          const kb = await voiceAgentService.getKnowledgeBase(effectiveBusinessId);
          if (kb) {
            setKnowledgeBase({
              first_message: kb.first_message || '',
              last_message: kb.last_message || '',
              personality_prompt: kb.personality_prompt || '',
              knowledge_base_text: kb.knowledge_base_text || '',
            });
          }
        } catch (error) {
          console.error('Error loading knowledge base:', error);
          // Knowledge base might not exist yet, that's okay
        }
      }
      
      // Load FAQs
      if (voiceAgentService?.getBusinessFAQs) {
        try {
          const loadedFaqs = await voiceAgentService.getBusinessFAQs(effectiveBusinessId);
          setFaqs(loadedFaqs || []);
        } catch (error) {
          console.error('Error loading FAQs:', error);
          toast.error('Failed to load FAQs');
        }
      }
      
      // Load business info
      if (voiceAgentService?.getBusinessInfo) {
        try {
          const business = await voiceAgentService.getBusinessInfo();
          setBusinessInfo(business);
        } catch (error) {
          console.error('Error loading business info:', error);
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load knowledge base data');
    } finally {
      setLoading(false);
    }
  };
  
  const handleKnowledgeBaseChange = (field, value) => {
    setKnowledgeBase(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSaveKnowledgeBase = async () => {
    if (!effectiveBusinessId || !voiceAgentService?.saveKnowledgeBase) {
      toast.error('Save functionality not available');
      return;
    }
    
    setSaving(true);
    try {
      await voiceAgentService.saveKnowledgeBase(effectiveBusinessId, knowledgeBase);
      toast.success('Knowledge base saved successfully');
      
      // Auto-rebuild all agents after saving
      await rebuildAllAgents('Knowledge base updated');
    } catch (error) {
      console.error('Error saving knowledge base:', error);
      toast.error('Failed to save knowledge base: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };
  
  // FAQ Management
  const handleAddFaq = async () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) {
      toast.error('Please enter both question and answer');
      return;
    }
    
    setSaving(true);
    try {
      const createdFaq = await voiceAgentService.createBusinessFAQ(effectiveBusinessId, {
        question: newFaq.question.trim(),
        answer: newFaq.answer.trim(),
        is_active: true,
      });
      
      setFaqs([...faqs, createdFaq]);
      setNewFaq({ question: '', answer: '' });
      toast.success('FAQ added successfully');
      
      // Auto-rebuild all agents
      await rebuildAllAgents('FAQ added');
    } catch (error) {
      console.error('Error adding FAQ:', error);
      toast.error('Failed to add FAQ: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };
  
  const handleUpdateFaq = async (faqId, updates) => {
    setSaving(true);
    try {
      const updatedFaq = await voiceAgentService.updateBusinessFAQ(faqId, updates);
      setFaqs(faqs.map(faq => faq.id === faqId ? updatedFaq : faq));
      setEditingFaq(null);
      toast.success('FAQ updated successfully');
      
      // Auto-rebuild all agents
      await rebuildAllAgents('FAQ updated');
    } catch (error) {
      console.error('Error updating FAQ:', error);
      toast.error('Failed to update FAQ: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };
  
  const handleDeleteFaq = async (faqId) => {
    if (!confirm('Are you sure you want to delete this FAQ?')) return;
    
    setSaving(true);
    try {
      await voiceAgentService.deleteBusinessFAQ(faqId);
      setFaqs(faqs.filter(faq => faq.id !== faqId));
      toast.success('FAQ deleted successfully');
      
      // Auto-rebuild all agents
      await rebuildAllAgents('FAQ deleted');
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      toast.error('Failed to delete FAQ: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };
  
  const handleMoveFaq = async (faqId, direction) => {
    const index = faqs.findIndex(f => f.id === faqId);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= faqs.length) return;
    
    setSaving(true);
    try {
      const currentOrder = faqs[index].display_order || index;
      const targetOrder = faqs[newIndex].display_order || newIndex;
      
      await voiceAgentService.updateBusinessFAQ(faqs[index].id, { display_order: targetOrder });
      await voiceAgentService.updateBusinessFAQ(faqs[newIndex].id, { display_order: currentOrder });
      
      // Reload FAQs to get updated order
      const reloadedFaqs = await voiceAgentService.getBusinessFAQs(effectiveBusinessId);
      setFaqs(reloadedFaqs || []);
      toast.success('FAQ order updated');
      
      // Auto-rebuild all agents
      await rebuildAllAgents('FAQ order updated');
    } catch (error) {
      console.error('Error moving FAQ:', error);
      toast.error('Failed to move FAQ');
    } finally {
      setSaving(false);
    }
  };
  
  // Rebuild all agents
  const rebuildAllAgents = async (reason = 'Knowledge base updated') => {
    if (!voiceAgentService?.rebuildAllAgents) {
      console.warn('rebuildAllAgents method not available');
      return;
    }
    
    setRebuilding(true);
    setRebuildStatus(null);
    
    try {
      toast.loading('Rebuilding all active agents...', { id: 'rebuild-all' });
      const result = await voiceAgentService.rebuildAllAgents(effectiveBusinessId);
      
      setRebuildStatus({
        success: true,
        message: `All agents rebuilt successfully! ${result.successCount || 0} agent(s) updated.`,
      });
      
      toast.success(`✅ All agents rebuilt! ${result.successCount || 0} agent(s) updated.`, { 
        id: 'rebuild-all',
        duration: 5000 
      });
    } catch (error) {
      console.error('Error rebuilding agents:', error);
      setRebuildStatus({
        success: false,
        message: `Failed to rebuild agents: ${error.message || 'Unknown error'}`,
      });
      toast.error('⚠️ Failed to rebuild some agents. Check logs for details.', { 
        id: 'rebuild-all',
        duration: 6000 
      });
    } finally {
      setRebuilding(false);
    }
  };
  
  // Format operating hours
  const formatOperatingHours = (hoursJsonb) => {
    if (!hoursJsonb || typeof hoursJsonb !== 'object') return 'Hours not available.';
    
    const dayNames = {
      monday: 'Monday',
      tuesday: 'Tuesday',
      wednesday: 'Wednesday',
      thursday: 'Thursday',
      friday: 'Friday',
      saturday: 'Saturday',
      sunday: 'Sunday'
    };
    
    const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const result = [];
    
    for (const dayKey of dayKeys) {
      const dayData = hoursJsonb[dayKey];
      if (dayData) {
        if (dayData.closed === true) {
          result.push(`${dayNames[dayKey]}: Closed`);
        } else {
          const open = dayData.open || '';
          const close = dayData.close || '';
          result.push(`${dayNames[dayKey]}: ${open} - ${close}`);
        }
      }
    }
    
    return result.join('\n') || 'Hours not available.';
  };
  
  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      maxWidth: '1200px',
      margin: '0 auto',
    },
    header: {
      marginBottom: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xs,
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
    },
    section: {
      marginBottom: TavariStyles.spacing['2xl'],
      padding: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
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
      marginBottom: TavariStyles.spacing.lg,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.lg,
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
    textareaLarge: {
      width: '100%',
      minHeight: '200px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontFamily: 'inherit',
      resize: 'vertical',
    },
    infoNote: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.xs,
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
    rebuildStatus: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    rebuildStatusSuccess: {
      backgroundColor: '#d1fae5',
      border: '1px solid #10b981',
      color: '#065f46',
    },
    rebuildStatusError: {
      backgroundColor: '#fee2e2',
      border: '1px solid #ef4444',
      color: '#991b1b',
    },
    rebuildStatusLoading: {
      backgroundColor: '#dbeafe',
      border: '1px solid #3b82f6',
      color: '#1e40af',
    },
  };
  
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <Loader size={32} className="animate-spin" style={{ color: TavariStyles.colors.primary }} />
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600, marginTop: '16px' }}>
          Loading knowledge base...
        </div>
      </div>
    );
  }
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>
          <BookOpen size={28} />
          Knowledge Base
        </h1>
        <p style={styles.subtitle}>
          Manage shared knowledge base for all AI agents (voice, SMS, email). Changes automatically rebuild all active agents.
        </p>
      </div>
      
      {/* Rebuild Status */}
      {rebuildStatus && (
        <div
          style={{
            ...styles.rebuildStatus,
            ...(rebuildStatus.success
              ? styles.rebuildStatusSuccess
              : styles.rebuildStatusError),
          }}
        >
          {rebuildStatus.success ? (
            <CheckCircle2 size={20} />
          ) : (
            <Info size={20} />
          )}
          <span>{rebuildStatus.message}</span>
        </div>
      )}
      
      {rebuilding && (
        <div style={{ ...styles.rebuildStatus, ...styles.rebuildStatusLoading }}>
          <Loader size={20} className="animate-spin" />
          <span>Rebuilding all active agents...</span>
        </div>
      )}
      
      {/* Business Information (Read-Only) */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <Info size={20} />
          Business Information
        </h3>
        <p style={styles.sectionSubtitle}>
          This information is automatically included in your AI agents. To update, go to Settings → Basic Info.
        </p>
        {businessInfo ? (
          <div style={styles.businessInfoDisplay}>
            <div><strong>Name:</strong> {businessInfo.name}</div>
            {businessInfo.business_address && (
              <div><strong>Address:</strong> {businessInfo.business_address}</div>
            )}
            {businessInfo.business_city && businessInfo.business_state && (
              <div>
                <strong>City/State:</strong> {businessInfo.business_city}, {businessInfo.business_state}
              </div>
            )}
            {businessInfo.business_phone && (
              <div><strong>Phone:</strong> {businessInfo.business_phone}</div>
            )}
            {businessInfo.business_email && (
              <div><strong>Email:</strong> {businessInfo.business_email}</div>
            )}
            {businessInfo.business_website && (
              <div><strong>Website:</strong> {businessInfo.business_website}</div>
            )}
            {businessInfo.timezone && (
              <div><strong>Timezone:</strong> {businessInfo.timezone}</div>
            )}
            {businessInfo.operating_hours && (
              <div style={{ marginTop: '8px' }}>
                <strong>Operating Hours:</strong>
                <div style={{ marginTop: '4px', whiteSpace: 'pre-line' }}>
                  {formatOperatingHours(businessInfo.operating_hours)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={styles.businessInfoDisplay}>
            Business information not available. Please check your Business Settings.
          </div>
        )}
      </div>
      
      {/* Personality Prompt */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>🎭 Personality & System Prompt</h3>
        <p style={styles.sectionSubtitle}>
          Define the AI's personality, tone, and general behavior. This applies to all agents.
        </p>
        <div style={styles.formGroup}>
          <label style={styles.label}>Personality Prompt *</label>
          <textarea
            value={knowledgeBase.personality_prompt}
            onChange={(e) => handleKnowledgeBaseChange('personality_prompt', e.target.value)}
            style={styles.textareaLarge}
            placeholder="Instructions for the AI agent on how to behave, tone, and general guidance..."
          />
          <p style={styles.infoNote}>
            This defines the AI's personality and behavior. FAQs below provide specific question-answer pairs.
          </p>
        </div>
      </div>
      
      {/* Messages */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>💬 Messages</h3>
        <p style={styles.sectionSubtitle}>
          Opening and closing messages for your AI agents.
        </p>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>First Message (Opening Greeting)</label>
          <input
            type="text"
            value={knowledgeBase.first_message}
            onChange={(e) => handleKnowledgeBaseChange('first_message', e.target.value)}
            style={styles.input}
            placeholder="What the agent says when answering the phone"
          />
          <p style={styles.infoNote}>
            The greeting message when the AI agent answers a call.
          </p>
        </div>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>Last Message (Closing/Goodbye)</label>
          <input
            type="text"
            value={knowledgeBase.last_message}
            onChange={(e) => handleKnowledgeBaseChange('last_message', e.target.value)}
            style={styles.input}
            placeholder="What the agent says when ending the call"
          />
          <p style={styles.infoNote}>
            The closing message when the AI agent ends a call.
          </p>
        </div>
      </div>
      
      {/* Additional Knowledge Base */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>📚 Additional Knowledge Base</h3>
        <p style={styles.sectionSubtitle}>
          Additional knowledge content beyond FAQs (product details, policies, etc.).
        </p>
        <div style={styles.formGroup}>
          <label style={styles.label}>Knowledge Base Text</label>
          <textarea
            value={knowledgeBase.knowledge_base_text}
            onChange={(e) => handleKnowledgeBaseChange('knowledge_base_text', e.target.value)}
            style={styles.textareaLarge}
            placeholder="Additional knowledge base content that will be available to all AI agents..."
          />
          <p style={styles.infoNote}>
            This content will be included in the AI's knowledge base alongside FAQs.
          </p>
        </div>
      </div>
      
      {/* FAQ Management */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>❓ Frequently Asked Questions</h3>
        <p style={styles.sectionSubtitle}>
          Add question-answer pairs. The AI will use these to answer specific questions with high confidence. Changes automatically rebuild all active agents.
        </p>
        
        {/* Existing FAQs */}
        {faqs.length > 0 && (
          <div style={{ marginBottom: TavariStyles.spacing.md }}>
            {faqs.map((faq, index) => (
              <div key={faq.id} style={styles.faqItem}>
                {editingFaq?.id === faq.id ? (
                  <div>
                    <input
                      type="text"
                      value={editingFaq.question}
                      onChange={(e) => setEditingFaq({ ...editingFaq, question: e.target.value })}
                      placeholder="Question"
                      style={{ ...styles.input, marginBottom: '8px' }}
                    />
                    <textarea
                      value={editingFaq.answer}
                      onChange={(e) => setEditingFaq({ ...editingFaq, answer: e.target.value })}
                      placeholder="Answer"
                      style={styles.textarea}
                    />
                    <div style={styles.faqActions}>
                      <button
                        onClick={() => handleUpdateFaq(faq.id, editingFaq)}
                        style={{ ...styles.buttonSmall, backgroundColor: '#10b981', color: 'white' }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingFaq(null)}
                        style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Q: {faq.question}</div>
                    <div style={{ color: TavariStyles.colors.gray600 }}>A: {faq.answer}</div>
                    <div style={styles.faqActions}>
                      <button
                        onClick={() => setEditingFaq({ ...faq })}
                        style={{ ...styles.buttonSmall, backgroundColor: '#3b82f6', color: 'white' }}
                      >
                        <Edit2 size={14} />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteFaq(faq.id)}
                        style={{ ...styles.buttonSmall, backgroundColor: '#ef4444', color: 'white' }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                      {index > 0 && (
                        <button
                          onClick={() => handleMoveFaq(faq.id, 'up')}
                          style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                          title="Move up"
                        >
                          <ArrowUp size={14} />
                        </button>
                      )}
                      {index < faqs.length - 1 && (
                        <button
                          onClick={() => handleMoveFaq(faq.id, 'down')}
                          style={{ ...styles.buttonSmall, backgroundColor: '#6b7280', color: 'white' }}
                          title="Move down"
                        >
                          <ArrowDown size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* Add New FAQ */}
        <div style={styles.faqItem}>
          <input
            type="text"
            value={newFaq.question}
            onChange={(e) => setNewFaq({ ...newFaq, question: e.target.value })}
            placeholder="Enter question..."
            style={{ ...styles.input, marginBottom: '8px' }}
          />
          <textarea
            value={newFaq.answer}
            onChange={(e) => setNewFaq({ ...newFaq, answer: e.target.value })}
            placeholder="Enter answer..."
            style={styles.textarea}
          />
          <button
            onClick={handleAddFaq}
            disabled={saving}
            style={{ ...styles.buttonSmall, backgroundColor: '#10b981', color: 'white', marginTop: '8px' }}
          >
            <Plus size={14} />
            Add FAQ
          </button>
        </div>
      </div>
      
      {/* Save Button */}
      <div style={{ 
        marginTop: TavariStyles.spacing.xl,
        paddingTop: TavariStyles.spacing.xl,
        borderTop: `2px solid ${TavariStyles.colors.gray200}`,
        display: 'flex',
        justifyContent: 'flex-end',
        gap: TavariStyles.spacing.md,
      }}>
        <button
          onClick={handleSaveKnowledgeBase}
          disabled={saving || rebuilding}
          style={{
            padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
            border: 'none',
            borderRadius: TavariStyles.borderRadius?.md || '8px',
            backgroundColor: saving || rebuilding ? TavariStyles.colors.gray400 : (TavariStyles.colors.primary || '#008080'),
            color: TavariStyles.colors.white,
            cursor: saving || rebuilding ? 'not-allowed' : 'pointer',
            fontSize: TavariStyles.typography.fontSize.base,
            fontWeight: TavariStyles.typography.fontWeight.semibold,
            display: 'flex',
            alignItems: 'center',
            gap: TavariStyles.spacing.sm,
          }}
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save & Rebuild All Agents'}
        </button>
      </div>
    </div>
  );
};

export default AgentKnowledgeBase;

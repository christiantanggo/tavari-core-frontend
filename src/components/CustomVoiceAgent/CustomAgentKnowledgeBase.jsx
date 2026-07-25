// components/CustomVoiceAgent/CustomAgentKnowledgeBase.jsx
// Knowledge Base management for custom voice agents
import React, { useState, useEffect } from 'react';
import { BookOpen, Save, Plus, Edit2, Trash2 } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';

const CustomAgentKnowledgeBase = ({ businessId, customVoiceAgentService }) => {
  const { selectedBusinessId } = usePOSAuth({ requireBusiness: false });
  const effectiveBusinessId = businessId || selectedBusinessId;
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [knowledgeBase, setKnowledgeBase] = useState({
    first_message: '',
    last_message: '',
    personality_prompt: '',
    knowledge_base_text: '',
    products_pricing: '',
  });
  
  const [faqs, setFaqs] = useState([]);
  const [editingFaq, setEditingFaq] = useState(null);
  const [newFaq, setNewFaq] = useState({ question: '', answer: '', category: '' });

  useEffect(() => {
    if (effectiveBusinessId) {
      loadAllData();
    }
  }, [effectiveBusinessId]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // Load knowledge base
      const { data: kb, error: kbError } = await supabase
        .from('custom_voice_agent_knowledge_base')
        .select('*')
        .eq('business_id', effectiveBusinessId)
        .single();

      if (kbError && kbError.code !== 'PGRST116') throw kbError;

      if (kb) {
        setKnowledgeBase({
          first_message: kb.first_message || '',
          last_message: kb.last_message || '',
          personality_prompt: kb.personality_prompt || '',
          knowledge_base_text: kb.knowledge_base_text || '',
          products_pricing: kb.products_pricing || '',
        });
      }
      
      // Load FAQs
      const { data: faqsData, error: faqsError } = await supabase
        .from('custom_voice_agent_faqs')
        .select('*')
        .eq('business_id', effectiveBusinessId)
        .is('agent_id', null)
        .order('display_order', { ascending: true });

      if (faqsError) throw faqsError;
      setFaqs(faqsData || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load knowledge base');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveKnowledgeBase = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('custom_voice_agent_knowledge_base')
        .upsert({
          business_id: effectiveBusinessId,
          ...knowledgeBase,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'business_id' });

      if (error) throw error;
      toast.success('Knowledge base saved successfully');
    } catch (error) {
      console.error('Error saving knowledge base:', error);
      toast.error('Failed to save knowledge base');
    } finally {
      setSaving(false);
    }
  };

  const handleAddFaq = async () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) {
      toast.error('Please enter both question and answer');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('custom_voice_agent_faqs')
        .insert({
          business_id: effectiveBusinessId,
          question: newFaq.question.trim(),
          answer: newFaq.answer.trim(),
          category: newFaq.category || null,
          is_active: true,
          display_order: faqs.length,
        })
        .select()
        .single();

      if (error) throw error;
      setFaqs([...faqs, data]);
      setNewFaq({ question: '', answer: '', category: '' });
      toast.success('FAQ added successfully');
    } catch (error) {
      console.error('Error adding FAQ:', error);
      toast.error('Failed to add FAQ');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFaq = async (faqId) => {
    if (!window.confirm('Are you sure you want to delete this FAQ?')) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('custom_voice_agent_faqs')
        .delete()
        .eq('id', faqId);

      if (error) throw error;
      setFaqs(faqs.filter(f => f.id !== faqId));
      toast.success('FAQ deleted successfully');
    } catch (error) {
      console.error('Error deleting FAQ:', error);
      toast.error('Failed to delete FAQ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading knowledge base...</div>
      </div>
    );
  }

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
    },
    section: {
      marginBottom: TavariStyles.spacing['2xl'],
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.md,
    },
    label: {
      display: 'block',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
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
    saveButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: saving ? 'not-allowed' : 'pointer',
      opacity: saving ? 0.6 : 1,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    faqCard: {
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.sm,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <BookOpen size={20} />
          Knowledge Base
        </h3>
        
        <div style={styles.formGroup}>
          <label style={styles.label}>First Message</label>
          <input
            type="text"
            value={knowledgeBase.first_message}
            onChange={(e) => setKnowledgeBase({ ...knowledgeBase, first_message: e.target.value })}
            style={styles.input}
            placeholder="Opening greeting"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Last Message</label>
          <input
            type="text"
            value={knowledgeBase.last_message}
            onChange={(e) => setKnowledgeBase({ ...knowledgeBase, last_message: e.target.value })}
            style={styles.input}
            placeholder="Closing message"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Personality Prompt</label>
          <textarea
            value={knowledgeBase.personality_prompt}
            onChange={(e) => setKnowledgeBase({ ...knowledgeBase, personality_prompt: e.target.value })}
            style={styles.textarea}
            placeholder="AI personality and behavior instructions"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Knowledge Base Text</label>
          <textarea
            value={knowledgeBase.knowledge_base_text}
            onChange={(e) => setKnowledgeBase({ ...knowledgeBase, knowledge_base_text: e.target.value })}
            style={{ ...styles.textarea, minHeight: '200px' }}
            placeholder="Business information, rules, policies, etc."
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Products & Pricing</label>
          <textarea
            value={knowledgeBase.products_pricing}
            onChange={(e) => setKnowledgeBase({ ...knowledgeBase, products_pricing: e.target.value })}
            style={styles.textarea}
            placeholder="Products, services, and pricing information"
          />
        </div>

        <button onClick={handleSaveKnowledgeBase} disabled={saving} style={styles.saveButton}>
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Knowledge Base'}
        </button>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>
          <BookOpen size={20} />
          FAQs
        </h3>

        <div style={styles.formGroup}>
          <input
            type="text"
            value={newFaq.question}
            onChange={(e) => setNewFaq({ ...newFaq, question: e.target.value })}
            style={styles.input}
            placeholder="Question"
          />
          <textarea
            value={newFaq.answer}
            onChange={(e) => setNewFaq({ ...newFaq, answer: e.target.value })}
            style={{ ...styles.textarea, minHeight: '80px', marginTop: TavariStyles.spacing.xs }}
            placeholder="Answer"
          />
          <button
            onClick={handleAddFaq}
            disabled={saving}
            style={{
              ...styles.saveButton,
              marginTop: TavariStyles.spacing.xs,
              fontSize: TavariStyles.typography.fontSize.sm,
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
            }}
          >
            <Plus size={16} />
            Add FAQ
          </button>
        </div>

        {faqs.map(faq => (
          <div key={faq.id} style={styles.faqCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>{faq.question}</div>
                <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
                  {faq.answer}
                </div>
              </div>
              <button
                onClick={() => handleDeleteFaq(faq.id)}
                style={{
                  padding: '4px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#dc2626',
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomAgentKnowledgeBase;


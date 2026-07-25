// components/VoiceAgent/KnowledgeBaseModals/LayoutModal.jsx
// Modal for managing call layout (how calls are answered and ended)
import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';
import BaseKnowledgeModal from './BaseKnowledgeModal';

const LayoutModal = ({ isOpen, onClose, businessId, voiceAgentService, knowledgeBase, onSave }) => {
  const [layout, setLayout] = useState({
    answer_message: '',
    end_message: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && knowledgeBase) {
      setLayout({
        answer_message: knowledgeBase.layout_answer_message || knowledgeBase.first_message || '',
        end_message: knowledgeBase.layout_end_message || knowledgeBase.last_message || '',
      });
    }
  }, [isOpen, knowledgeBase]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await voiceAgentService.saveKnowledgeBase(businessId, {
        ...knowledgeBase,
        layout_answer_message: layout.answer_message,
        layout_end_message: layout.end_message,
        first_message: layout.answer_message, // Keep for backward compatibility
        last_message: layout.end_message, // Keep for backward compatibility
      });
      toast.success('Layout saved successfully');
      if (onSave) onSave();
      onClose();
    } catch (error) {
      console.error('Error saving layout:', error);
      toast.error('Failed to save layout: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const styles = {
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
    infoNote: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.xs,
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xl,
    },
    saveButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: saving ? TavariStyles.colors.gray400 : (TavariStyles.colors.primary || '#008080'),
      color: TavariStyles.colors.white,
      cursor: saving ? 'not-allowed' : 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
  };

  return (
    <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Layout" width="700px">
      <div style={styles.formGroup}>
        <label style={styles.label}>How Calls Are Answered *</label>
        <input
          type="text"
          value={layout.answer_message}
          onChange={(e) => setLayout({ ...layout, answer_message: e.target.value })}
          placeholder="What the agent says when answering the phone"
          style={styles.input}
        />
        <p style={styles.infoNote}>
          This is the greeting message when the AI agent answers a call.
        </p>
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>How Calls Are Ended *</label>
        <input
          type="text"
          value={layout.end_message}
          onChange={(e) => setLayout({ ...layout, end_message: e.target.value })}
          placeholder="What the agent says when ending the call"
          style={styles.input}
        />
        <p style={styles.infoNote}>
          This is the closing message when the AI agent ends a call.
        </p>
      </div>

      <div style={styles.footer}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={styles.saveButton}
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Layout'}
        </button>
      </div>
    </BaseKnowledgeModal>
  );
};

export default LayoutModal;


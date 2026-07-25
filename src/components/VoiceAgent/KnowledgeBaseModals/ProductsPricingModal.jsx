// components/VoiceAgent/KnowledgeBaseModals/ProductsPricingModal.jsx
// Modal for managing Products & Pricing
import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';
import BaseKnowledgeModal from './BaseKnowledgeModal';

const ProductsPricingModal = ({ isOpen, onClose, businessId, voiceAgentService, knowledgeBase, onSave }) => {
  const [productsPricing, setProductsPricing] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && knowledgeBase) {
      setProductsPricing(knowledgeBase.products_pricing || '');
    }
  }, [isOpen, knowledgeBase]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await voiceAgentService.saveKnowledgeBase(businessId, {
        ...knowledgeBase,
        products_pricing: productsPricing,
      });
      toast.success('Products & Pricing saved successfully');
      if (onSave) onSave();
      onClose();
    } catch (error) {
      console.error('Error saving products & pricing:', error);
      toast.error('Failed to save: ' + (error.message || 'Unknown error'));
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
    textarea: {
      width: '100%',
      minHeight: '300px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontFamily: 'monospace',
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
    <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Products & Pricing" width="900px">
      <div style={styles.formGroup}>
        <label style={styles.label}>Products & Pricing Information</label>
        <textarea
          value={productsPricing}
          onChange={(e) => setProductsPricing(e.target.value)}
          placeholder="Enter your products and pricing information here. For example:&#10;&#10;Party Packages:&#10;Option 1: $299.99 plus tax - 1 party room, up to 12 kids...&#10;Option 2: $574.99 plus tax - 2 party rooms, up to 24 kids...&#10;&#10;Admission:&#10;Ages 0-23 months: $8.40 plus tax&#10;Ages 2-17: $12.39 plus tax..."
          style={styles.textarea}
        />
        <p style={styles.infoNote}>
          Enter your products and pricing information. This will be available to all AI agents. Later, this will integrate with your POS system.
        </p>
      </div>

      <div style={styles.footer}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={styles.saveButton}
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Products & Pricing'}
        </button>
      </div>
    </BaseKnowledgeModal>
  );
};

export default ProductsPricingModal;


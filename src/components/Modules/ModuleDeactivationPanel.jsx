import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiAlertTriangle, FiPower } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import AppBuilderModuleService from '../../services/AppBuilder/AppBuilderModuleService';
import { getModuleDisplayName } from '../../constants/moduleDisplayNames';
import { TavariStyles } from '../../utils/TavariStyles';

const styles = {
  panel: {
    marginTop: TavariStyles.spacing?.xl || '32px',
    padding: TavariStyles.spacing?.lg || '24px',
    border: `1px solid ${TavariStyles.colors?.gray300 || '#ddd'}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    backgroundColor: TavariStyles.colors?.gray50 || '#fafafa',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: TavariStyles.spacing?.sm || '8px',
  },
  title: {
    margin: 0,
    fontSize: TavariStyles.typography?.fontSize?.lg || '18px',
    fontWeight: TavariStyles.typography?.fontWeight?.semibold || 600,
    color: TavariStyles.colors?.gray800 || '#333',
  },
  description: {
    margin: `0 0 ${TavariStyles.spacing?.md || '16px'} 0`,
    fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
    color: TavariStyles.colors?.gray600 || '#666',
    lineHeight: 1.5,
  },
  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: TavariStyles.spacing?.md || '16px',
    marginBottom: TavariStyles.spacing?.md || '16px',
    backgroundColor: '#fff8e6',
    border: '1px solid #f5d76e',
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
    color: '#7a5c00',
  },
  actions: {
    display: 'flex',
    gap: TavariStyles.spacing?.sm || '8px',
    flexWrap: 'wrap',
  },
  deactivateButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    backgroundColor: TavariStyles.colors?.danger || '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
  },
  confirmButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    backgroundColor: TavariStyles.colors?.danger || '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
  },
  cancelButton: {
    padding: '10px 16px',
    backgroundColor: '#fff',
    color: TavariStyles.colors?.gray700 || '#444',
    border: `1px solid ${TavariStyles.colors?.gray300 || '#ccc'}`,
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    fontWeight: 500,
    cursor: 'pointer',
    fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
  },
  compact: {
    marginTop: TavariStyles.spacing?.lg || '24px',
  },
};

/**
 * Deactivate the current module (removes from sidebar; reactivate from Home).
 */
const ModuleDeactivationPanel = ({ moduleKey, moduleName, compact = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { hasElevatedPrivileges } = usePermissions();
  const { isOwner, isManager } = usePOSAuth({
    requiredRoles: null,
    requireBusiness: true,
    componentName: 'ModuleDeactivationPanel',
  });

  const [confirming, setConfirming] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const canDeactivate = hasElevatedPrivileges() || isOwner || isManager;
  const displayName = getModuleDisplayName(moduleKey, moduleName);

  if (!canDeactivate || !moduleKey) {
    return null;
  }

  const handleDeactivate = async () => {
    if (!selectedBusinessId) {
      toast.error('No business selected');
      return;
    }

    try {
      setDeactivating(true);
      AppBuilderModuleService.setBusinessId(selectedBusinessId);
      await AppBuilderModuleService.disableModule(moduleKey);

      window.dispatchEvent(
        new CustomEvent('module-deactivated', {
          detail: {
            moduleKey,
            businessId: selectedBusinessId,
            moduleName: displayName,
          },
        })
      );

      toast.success(`${displayName} deactivated. Reactivate it anytime from Home.`);

      await new Promise((resolve) => setTimeout(resolve, 100));
      navigate('/dashboard/home');
    } catch (error) {
      console.error('Error deactivating module:', error);
      toast.error('Failed to deactivate module. Please try again.');
    } finally {
      setDeactivating(false);
      setConfirming(false);
    }
  };

  return (
    <div style={{ ...styles.panel, ...(compact ? styles.compact : {}) }}>
      <div style={styles.headerRow}>
        <FiPower size={20} color={TavariStyles.colors?.gray600 || '#666'} />
        <h3 style={styles.title}>Module activation</h3>
      </div>
      <p style={styles.description}>
        Deactivating <strong>{displayName}</strong> removes it from the left sidebar. Your data is kept —
        go to <strong>Home</strong> to reactivate the module anytime.
      </p>

      {!confirming ? (
        <button
          type="button"
          style={styles.deactivateButton}
          onClick={() => setConfirming(true)}
        >
          <FiPower size={16} />
          Deactivate module
        </button>
      ) : (
        <>
          <div style={styles.warningBox}>
            <FiAlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              Are you sure you want to deactivate <strong>{displayName}</strong>? It will disappear from
              the sidebar until you reactivate it from Home.
            </span>
          </div>
          <div style={styles.actions}>
            <button
              type="button"
              style={styles.confirmButton}
              onClick={handleDeactivate}
              disabled={deactivating}
            >
              <FiPower size={16} />
              {deactivating ? 'Deactivating…' : 'Yes, deactivate'}
            </button>
            <button
              type="button"
              style={styles.cancelButton}
              onClick={() => setConfirming(false)}
              disabled={deactivating}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ModuleDeactivationPanel;

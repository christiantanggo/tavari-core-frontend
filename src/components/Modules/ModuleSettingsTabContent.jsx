import React from 'react';
import { FiSettings } from 'react-icons/fi';
import ModuleDeactivationPanel from './ModuleDeactivationPanel';
import { getModuleDisplayName } from '../../constants/moduleDisplayNames';
import { TavariStyles } from '../../utils/TavariStyles';

const styles = {
  container: {
    padding: TavariStyles.spacing?.lg || '24px',
    maxWidth: '900px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: TavariStyles.spacing?.lg || '24px',
  },
  title: {
    margin: 0,
    fontSize: TavariStyles.typography?.fontSize?.xl || '22px',
    fontWeight: TavariStyles.typography?.fontWeight?.semibold || 600,
    color: TavariStyles.colors?.gray800 || '#333',
  },
  subtitle: {
    margin: `${TavariStyles.spacing?.xs || '4px'} 0 0 0`,
    fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
    color: TavariStyles.colors?.gray600 || '#666',
  },
};

/**
 * Default settings tab for modules without module-specific settings.
 */
const ModuleSettingsTabContent = ({ moduleKey, moduleName }) => {
  const displayName = getModuleDisplayName(moduleKey, moduleName);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <FiSettings size={24} color={TavariStyles.colors?.primary || '#008080'} />
        <div>
          <h2 style={styles.title}>{displayName} settings</h2>
          <p style={styles.subtitle}>Module configuration and activation</p>
        </div>
      </div>
      <ModuleDeactivationPanel moduleKey={moduleKey} moduleName={moduleName} compact />
    </div>
  );
};

export default ModuleSettingsTabContent;

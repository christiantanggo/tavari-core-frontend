// Step 86: Create WaiverTemplateManagementScreen.jsx
// Manage waiver templates
import React, { useEffect, useMemo, useState } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiFileText, FiX, FiLock } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import { useWaiverTemplates } from '../../hooks/useWaiverTemplates';
import WaiverTemplateService from '../../services/Waivers/WaiverTemplateService';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import WaiverTemplateWizard from '../../components/Waivers/WaiverTemplateWizard';
import toast from 'react-hot-toast';

const WaiverTemplateManagementScreen = () => {
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiverTemplateManagementScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const containerStyle = useWaiversShellStyle(styles.container);
  useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'WaiverTemplateManagementScreen',
    sensitiveComponent: true
  });

  const { templates, loading, createTemplate, updateTemplate, createTemplateVersion, deleteTemplate } = useWaiverTemplates();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [editingTemplate, setEditingTemplate] = useState({
    templateName: '',
    templateKey: '',
    waiverTitle: '',
    waiverContent: '',
    version: 1,
    isLocked: false,
    signatureCount: 0
  });
  const [updating, setUpdating] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [loadingStationConfig, setLoadingStationConfig] = useState(true);
  const [savingStationConfig, setSavingStationConfig] = useState(false);
  const [stationMode, setStationMode] = useState('single');
  const [stationDefaultTemplateKey, setStationDefaultTemplateKey] = useState('');
  const [loadedStationTemplateConfig, setLoadedStationTemplateConfig] = useState([]);
  const [stationTemplateSelections, setStationTemplateSelections] = useState([]);

  const canManageTemplates = hasPermission('waivers.templates.manage') || hasElevatedPrivileges();
  const activeTemplates = useMemo(
    () => templates.filter((template) => template.is_active),
    [templates]
  );

  useEffect(() => {
    let cancelled = false;

    const loadStationConfig = async () => {
      if (!auth.selectedBusinessId) {
        setLoadingStationConfig(false);
        return;
      }

      try {
        setLoadingStationConfig(true);
        WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
        const settings = await WaiverSettingsService.getGlobalSettings();
        if (cancelled) return;

        setStationMode(settings?.waiver_station_mode === 'multi' ? 'multi' : 'single');
        setStationDefaultTemplateKey(
          String(settings?.waiver_station_default_template_key || '').trim()
        );
        setLoadedStationTemplateConfig(
          Array.isArray(settings?.waiver_station_templates) ? settings.waiver_station_templates : []
        );
      } catch (error) {
        console.error('Error loading waiver station settings:', error);
        if (!cancelled) {
          toast.error('Error loading waiver station settings');
        }
      } finally {
        if (!cancelled) {
          setLoadingStationConfig(false);
        }
      }
    };

    loadStationConfig();

    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    setStationTemplateSelections((previous) =>
      activeTemplates.map((template) => {
        const previousMatch = previous.find(
          (item) => item.templateId === template.id || item.templateKey === template.template_key
        );
        const configuredMatch = loadedStationTemplateConfig.find(
          (item) => item?.templateId === template.id || item?.templateKey === template.template_key
        );

        return {
          templateId: template.id,
          templateKey: template.template_key,
          templateName: template.template_name,
          waiverTitle: template.waiver_title,
          selected: configuredMatch ? true : !!previousMatch?.selected,
          displayName:
            previousMatch?.displayName ||
            String(configuredMatch?.displayName || '').trim() ||
            String(template.waiver_title || '').trim() ||
            String(template.template_name || '').trim() ||
            String(template.template_key || '').trim()
        };
      })
    );

    setStationDefaultTemplateKey((previousKey) => {
      if (activeTemplates.some((template) => template.template_key === previousKey)) {
        return previousKey;
      }
      return activeTemplates[0]?.template_key || '';
    });
  }, [activeTemplates, loadedStationTemplateConfig]);

  const handleSaveStationConfig = async () => {
    if (!auth.selectedBusinessId) {
      toast.error('Business ID is required');
      return;
    }

    if (stationMode === 'single' && !stationDefaultTemplateKey) {
      toast.error('Choose the default waiver to show to customers');
      return;
    }

    const selectedMultiTemplates = stationTemplateSelections
      .filter((item) => item.selected)
      .map((item) => ({
        templateId: item.templateId,
        templateKey: item.templateKey,
        displayName:
          String(item.displayName || '').trim() ||
          String(item.waiverTitle || '').trim() ||
          String(item.templateName || '').trim() ||
          String(item.templateKey || '').trim()
      }));

    if (stationMode === 'multi' && selectedMultiTemplates.length === 0) {
      toast.error('Select at least one waiver for multi-waiver mode');
      return;
    }

    try {
      setSavingStationConfig(true);
      WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
      await WaiverSettingsService.updateSetting('waiver_station_mode', stationMode);
      await WaiverSettingsService.updateSetting(
        'waiver_station_default_template_key',
        stationDefaultTemplateKey || null
      );
      await WaiverSettingsService.updateSetting(
        'waiver_station_templates',
        selectedMultiTemplates
      );
      setLoadedStationTemplateConfig(selectedMultiTemplates);
      toast.success('Waiver station settings saved');
    } catch (error) {
      console.error('Error saving waiver station settings:', error);
      toast.error('Error saving waiver station settings');
    } finally {
      setSavingStationConfig(false);
    }
  };

  const updateStationTemplateSelection = (templateKey, updates) => {
    setStationTemplateSelections((current) =>
      current.map((item) =>
        item.templateKey === templateKey
          ? {
              ...item,
              ...updates
            }
          : item
      )
    );
  };

  const handleDelete = async (templateId) => {
    const template = templates.find((row) => row.id === templateId);
    if (template?.is_locked) {
      toast.error('Signed waiver templates cannot be deleted. Deactivate them and create a new version instead.');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this template?')) {
      return;
    }

    try {
      await deleteTemplate(templateId);
      toast.success('Template deleted');
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Error deleting template');
    }
  };

  const handleDeactivateTemplate = async (templateId) => {
    const template = templates.find((row) => row.id === templateId);
    if (!template) return;

    if (!window.confirm('Deactivate this locked template? Existing signed waivers will keep using it as their legal record.')) {
      return;
    }

    try {
      await updateTemplate(templateId, { isActive: false });
      toast.success('Template deactivated');
    } catch (error) {
      console.error('Error deactivating template:', error);
      toast.error('Error deactivating template');
    }
  };

  // Generate template key from title (slugify)
  const generateTemplateKey = (title) => {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  };

  const handleSaveWizardTemplate = async (wizardData) => {
    if (!wizardData.waiverTitle.trim()) {
      toast.error('Waiver title is required');
      return;
    }

    try {
      // Generate template name and key from waiver title
      const templateName = wizardData.waiverTitle.trim();
      const templateKey = generateTemplateKey(wizardData.waiverTitle) || 'waiver-template-' + Date.now();

      // Prepare fields_config with all wizard data
      const fieldsConfig = {
        logoUrl: wizardData.logoUrl || null,
        participantFields: wizardData.participantFields || {},
        minorFields: wizardData.minorFields || {},
        notifications: wizardData.notifications || {}
      };

      await createTemplate({
        templateName: templateName,
        templateKey: templateKey,
        waiverTitle: wizardData.waiverTitle,
        waiverContent: wizardData.waiverContent || '',
        requiresDigitalSignature: wizardData.signatureRequired !== false,
        fieldsConfig: fieldsConfig
      });
      toast.success('Template created successfully');
      setShowCreateModal(false);
    } catch (error) {
      console.error('Error creating template:', error);
      toast.error('Error creating template: ' + (error.message || 'Unknown error'));
      throw error;
    }
  };

  const handleEditTemplate = async (templateId) => {
    setEditingTemplateId(templateId);
    setLoadingTemplate(true);
    setShowEditModal(true);
    
    try {
      WaiverTemplateService.setBusinessId(auth.selectedBusinessId);
      const template = await WaiverTemplateService.getTemplateById(templateId);
      setEditingTemplate({
        templateName: template.template_name || '',
        templateKey: template.template_key || '',
        waiverTitle: template.waiver_title || '',
        waiverContent: template.waiver_content || '',
        version: template.version || 1,
        isLocked: !!template.is_locked,
        signatureCount: template.signature_count || 0
      });
    } catch (error) {
      console.error('Error loading template:', error);
      toast.error('Error loading template: ' + (error.message || 'Unknown error'));
      setShowEditModal(false);
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleSaveTemplateChanges = async () => {
    if (!editingTemplate.templateName.trim()) {
      toast.error('Template name is required');
      return;
    }

    setUpdating(true);
    try {
      if (editingTemplate.isLocked) {
        await createTemplateVersion(editingTemplateId, {
          templateName: editingTemplate.templateName,
          waiverTitle: editingTemplate.waiverTitle || editingTemplate.templateName,
          waiverContent: editingTemplate.waiverContent || '',
          changesSummary: `Created from locked version ${editingTemplate.version}`
        });
        toast.success('New waiver template version created and activated');
      } else {
        await updateTemplate(editingTemplateId, {
          templateName: editingTemplate.templateName,
          waiverTitle: editingTemplate.waiverTitle || editingTemplate.templateName,
          waiverContent: editingTemplate.waiverContent || ''
        });
        toast.success('Template updated successfully');
      }

      setShowEditModal(false);
      setEditingTemplateId(null);
      setEditingTemplate({
        templateName: '',
        templateKey: '',
        waiverTitle: '',
        waiverContent: '',
        version: 1,
        isLocked: false,
        signatureCount: 0
      });
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Error saving template: ' + (error.message || 'Unknown error'));
    } finally {
      setUpdating(false);
    }
  };

  if (auth.authLoading) {
    return (
      <POSAuthWrapper componentName="WaiverTemplateManagementScreen">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canManageTemplates) {
    return (
      <POSAuthWrapper componentName="WaiverTemplateManagementScreen">
        <div style={TavariStyles.errorContainer}>
          <h2>Access Denied</h2>
          <p>You do not have permission to manage templates.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="WaiverTemplateManagementScreen">
      <SecurityWrapper componentName="WaiverTemplateManagementScreen" sensitiveComponent={true}>
        <div style={containerStyle}>
          <div style={styles.stationConfigCard}>
            <div style={styles.stationConfigHeader}>
              <div>
                <h2 style={styles.stationConfigTitle}>Waiver Station Setup</h2>
                <p style={styles.stationConfigSubtitle}>
                  Choose whether customers see one default waiver or choose from multiple
                  customer-friendly waiver names.
                </p>
              </div>
              <button
                onClick={handleSaveStationConfig}
                style={styles.stationSaveButton}
                disabled={savingStationConfig || loadingStationConfig || activeTemplates.length === 0}
              >
                {savingStationConfig ? 'Saving...' : 'Save Station Setup'}
              </button>
            </div>

            {loadingStationConfig ? (
              <p style={styles.stationHelpText}>Loading waiver station settings...</p>
            ) : activeTemplates.length === 0 ? (
              <p style={styles.stationHelpText}>
                Create at least one active waiver template before setting up the waiver station.
              </p>
            ) : (
              <>
                <div style={styles.modeToggleRow}>
                  <button
                    type="button"
                    onClick={() => setStationMode('single')}
                    style={{
                      ...styles.modeToggleButton,
                      ...(stationMode === 'single' ? styles.modeToggleButtonActive : {})
                    }}
                  >
                    Single Waiver
                  </button>
                  <button
                    type="button"
                    onClick={() => setStationMode('multi')}
                    style={{
                      ...styles.modeToggleButton,
                      ...(stationMode === 'multi' ? styles.modeToggleButtonActive : {})
                    }}
                  >
                    Multi Waiver
                  </button>
                </div>

                {stationMode === 'single' ? (
                  <div style={styles.stationFieldGroup}>
                    <label style={styles.stationFieldLabel}>Default waiver shown to customers</label>
                    <select
                      value={stationDefaultTemplateKey}
                      onChange={(e) => setStationDefaultTemplateKey(e.target.value)}
                      style={styles.stationSelect}
                    >
                      {activeTemplates.map((template) => (
                        <option key={template.id} value={template.template_key}>
                          {template.waiver_title || template.template_name || template.template_key}
                        </option>
                      ))}
                    </select>
                    <p style={styles.stationHelpText}>
                      Customers go straight into this waiver without seeing a chooser.
                    </p>
                  </div>
                ) : (
                  <div style={styles.stationFieldGroup}>
                    <label style={styles.stationFieldLabel}>Waivers available on the station</label>
                    <div style={styles.stationTemplateList}>
                      {stationTemplateSelections.map((template) => (
                        <div key={template.templateId} style={styles.stationTemplateRow}>
                          <TavariCheckbox
                            checked={template.selected}
                            onChange={(checked) =>
                              updateStationTemplateSelection(template.templateKey, {
                                selected: checked
                              })
                            }
                            label={template.waiverTitle || template.templateName || template.templateKey}
                            size="md"
                            id={`station-template-${template.templateId}`}
                            name={`station-template-${template.templateKey}`}
                            style={styles.stationCheckbox}
                            labelStyle={styles.stationCheckboxText}
                          />
                          <input
                            type="text"
                            value={template.displayName}
                            onChange={(e) =>
                              updateStationTemplateSelection(template.templateKey, {
                                displayName: e.target.value
                              })
                            }
                            style={styles.stationInput}
                            disabled={!template.selected}
                            placeholder="Customer-facing display name"
                          />
                        </div>
                      ))}
                    </div>
                    <p style={styles.stationHelpText}>
                      The chooser only appears when more than one selected waiver is active.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <div style={styles.header}>
            <div>
              <h1 style={styles.title}>Waiver Templates</h1>
              <p style={styles.subtitle}>Create and manage waiver templates</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              style={styles.createButton}
            >
              <FiPlus /> Create Template
            </button>
          </div>

          {loading ? (
            <div style={styles.loading}>
              <p>Loading templates...</p>
            </div>
          ) : templates.length > 0 ? (
            <div style={styles.templatesGrid}>
              {templates.map(template => (
                <div key={template.id} style={styles.templateCard}>
                  <div style={styles.templateHeader}>
                    <FiFileText size={24} style={{ color: TavariStyles.colors.primary }} />
                    <h3 style={styles.templateName}>{template.template_name}</h3>
                    {template.is_active ? (
                      <span style={styles.activeBadge}>Active</span>
                    ) : (
                      <span style={styles.inactiveBadge}>Inactive</span>
                    )}
                  </div>
                  <p style={styles.templateKey}>Key: {template.template_key}</p>
                  <p style={styles.templateVersion}>
                    Version: {template.version}
                    {template.is_locked
                      ? ` · Locked after ${template.signature_count || 0} signed waiver${(template.signature_count || 0) === 1 ? '' : 's'}`
                      : ' · Editable until first signature'}
                  </p>
                  {template.is_locked ? (
                    <div style={styles.lockedNotice}>
                      <FiLock /> Legal record locked. Changes create a new active version.
                    </div>
                  ) : null}
                  <div style={styles.templateActions}>
                    <button
                      onClick={() => handleEditTemplate(template.id)}
                      style={styles.actionButton}
                    >
                      <FiEdit /> {template.is_locked ? 'New Version' : 'Edit'}
                    </button>
                    {template.is_locked && template.is_active ? (
                      <button
                        onClick={() => handleDeactivateTemplate(template.id)}
                        style={{ ...styles.actionButton, ...styles.deactivateButton }}
                      >
                        <FiLock /> Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDelete(template.id)}
                        style={{ ...styles.actionButton, ...styles.deleteButton }}
                        disabled={template.is_locked}
                      >
                        <FiTrash2 /> Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              <FiFileText size={48} style={{ color: TavariStyles.colors.gray400 }} />
              <p>No templates created yet</p>
              <button
                onClick={() => setShowCreateModal(true)}
                style={styles.createButton}
              >
                <FiPlus /> Create Your First Template
              </button>
            </div>
          )}
        </div>

        {/* Create Template Wizard */}
        {showCreateModal && (
          <WaiverTemplateWizard
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSave={handleSaveWizardTemplate}
            businessId={auth.selectedBusinessId}
            isEditing={false}
          />
        )}

        {/* Edit Template Modal */}
        {showEditModal && (
          <div style={modalStyles.overlay} onClick={() => setShowEditModal(false)}>
            <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
              <div style={modalStyles.header}>
                <h2 style={modalStyles.title}>
                  {editingTemplate.isLocked ? 'Create New Template Version' : 'Edit Template'}
                </h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  style={modalStyles.closeButton}
                >
                  <FiX size={20} />
                </button>
              </div>

              <div style={modalStyles.content}>
                {loadingTemplate ? (
                  <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl, color: TavariStyles.colors.gray600 }}>
                    <p>Loading template...</p>
                  </div>
                ) : (
                  <>
                    {editingTemplate.isLocked ? (
                      <div style={modalStyles.lockedNotice}>
                        <FiLock />
                        <div>
                          <strong>This version has signed waivers and cannot be edited.</strong>
                          <p>
                            Saving will create version {(editingTemplate.version || 1) + 1}, activate it for future
                            signers, and keep version {editingTemplate.version || 1} unchanged for existing signed records.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    <div style={modalStyles.field}>
                      <label style={modalStyles.label}>
                        Template Name *
                      </label>
                      <input
                        type="text"
                        value={editingTemplate.templateName}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, templateName: e.target.value })}
                        style={modalStyles.input}
                        placeholder="e.g., Standard Waiver"
                      />
                    </div>

                    <div style={modalStyles.field}>
                      <label style={modalStyles.label}>
                        Template Key
                      </label>
                      <input
                        type="text"
                        value={editingTemplate.templateKey}
                        disabled
                        style={{ ...modalStyles.input, backgroundColor: TavariStyles.colors.gray100, color: TavariStyles.colors.gray600 }}
                        placeholder="e.g., standard-waiver"
                      />
                      <p style={modalStyles.helpText}>
                        Template key cannot be changed after creation
                      </p>
                    </div>

                    <div style={modalStyles.field}>
                      <label style={modalStyles.label}>
                        Waiver Title
                      </label>
                      <input
                        type="text"
                        value={editingTemplate.waiverTitle}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, waiverTitle: e.target.value })}
                        style={modalStyles.input}
                        placeholder="e.g., Liability Release and Assumption of Risk"
                      />
                    </div>

                    <div style={modalStyles.field}>
                      <label style={modalStyles.label}>
                        Waiver Content
                      </label>
                      <textarea
                        value={editingTemplate.waiverContent}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, waiverContent: e.target.value })}
                        style={modalStyles.textarea}
                        placeholder="Enter waiver content here..."
                        rows={10}
                      />
                    </div>
                  </>
                )}
              </div>

              <div style={modalStyles.footer}>
                <button
                  onClick={() => setShowEditModal(false)}
                  style={modalStyles.cancelButton}
                  disabled={updating || loadingTemplate}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTemplateChanges}
                  style={modalStyles.createButton}
                  disabled={updating || loadingTemplate || !editingTemplate.templateName.trim()}
                >
                  {updating
                    ? (editingTemplate.isLocked ? 'Creating Version...' : 'Updating...')
                    : (editingTemplate.isLocked ? 'Create New Version' : 'Update Template')}
                </button>
              </div>
            </div>
          </div>
        )}
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.background,
    padding: TavariStyles.spacing.xl,
    paddingTop: 0
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.xl
  },
  title: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  subtitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    margin: 0
  },
  createButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600'
  },
  stationConfigCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows.sm
  },
  stationConfigHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg
  },
  stationConfigTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: '700',
    color: TavariStyles.colors.text,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  stationConfigSubtitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    maxWidth: '640px',
    lineHeight: 1.5
  },
  stationSaveButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  modeToggleRow: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.lg
  },
  modeToggleButton: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600'
  },
  modeToggleButtonActive: {
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    borderColor: TavariStyles.colors.primary
  },
  stationFieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  stationFieldLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '600',
    color: TavariStyles.colors.text
  },
  stationSelect: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    backgroundColor: TavariStyles.colors.white
  },
  stationTemplateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  stationTemplateRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1fr) minmax(240px, 1.4fr)',
    gap: TavariStyles.spacing.md,
    alignItems: 'center',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius.md
  },
  stationCheckbox: {
    width: '100%'
  },
  stationCheckboxText: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.text,
    fontWeight: '500'
  },
  stationInput: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: 'inherit'
  },
  stationHelpText: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0
  },
  loading: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  },
  templatesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: TavariStyles.spacing.md
  },
  templateCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.lg,
    boxShadow: TavariStyles.shadows.sm
  },
  templateHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.md
  },
  templateName: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0,
    flex: 1
  },
  activeBadge: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    backgroundColor: TavariStyles.colors.success,
    color: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.full,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: '600'
  },
  inactiveBadge: {
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    backgroundColor: TavariStyles.colors.gray300,
    color: TavariStyles.colors.gray600,
    borderRadius: TavariStyles.borderRadius.full,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: '600'
  },
  templateKey: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.xs
  },
  templateVersion: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: TavariStyles.spacing.md
  },
  templateActions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm
  },
  actionButton: {
    flex: 1,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: TavariStyles.colors.gray100,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.sm,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: TavariStyles.spacing.xs,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  deleteButton: {
    backgroundColor: '#FEE2E2',
    color: TavariStyles.colors.error
  },
  deactivateButton: {
    backgroundColor: '#FEF3C7',
    color: '#92400E'
  },
  lockedNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.xs,
    padding: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.sm,
    backgroundColor: '#FFFBEB',
    color: '#92400E',
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.4
  },
  emptyState: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  }
};

const modalStyles = {
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
    padding: TavariStyles.spacing.md
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    width: '100%',
    maxWidth: '600px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: TavariStyles.shadows.xl
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.lg,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },
  title: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: '600',
    color: TavariStyles.colors.text,
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: TavariStyles.spacing.xs,
    color: TavariStyles.colors.gray600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: {
    padding: TavariStyles.spacing.lg,
    overflowY: 'auto',
    flex: 1
  },
  field: {
    marginBottom: TavariStyles.spacing.lg
  },
  label: {
    display: 'block',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: '500',
    color: TavariStyles.colors.text,
    marginBottom: TavariStyles.spacing.xs
  },
  input: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: 'inherit'
  },
  textarea: {
    width: '100%',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: 'inherit',
    resize: 'vertical'
  },
  helpText: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    marginTop: TavariStyles.spacing.xs,
    marginBottom: 0
  },
  lockedNotice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: TavariStyles.spacing.sm,
    padding: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg,
    backgroundColor: '#FFFBEB',
    border: '1px solid #FCD34D',
    borderRadius: TavariStyles.borderRadius.md,
    color: '#92400E',
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.lg,
    borderTop: `1px solid ${TavariStyles.colors.gray200}`
  },
  cancelButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.text,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '500'
  },
  createButton: {
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: '600',
    opacity: 1
  },
  loading: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl,
    color: TavariStyles.colors.gray600
  }
};

export default WaiverTemplateManagementScreen;





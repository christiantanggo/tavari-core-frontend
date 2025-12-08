// components/HR/HRSettingsComponents/DocumentManagementTab.jsx - Document Management Settings
import React from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const DocumentManagementTab = ({
  settings,
  onSettingsChange,
  selectedBusinessId,
  businessData,
  userRole,
  authUser,
  saving
}) => {
  // Security context for document management settings
  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'DocumentManagementTab',
    sensitiveComponent: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  const handleInputChange = async (field, value) => {
    await logSecurityEvent('document_settings_change', {
      field,
      business_id: selectedBusinessId
    }, 'low');

    onSettingsChange(field, value);
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xl
    },
    section: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.lg} 0`
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.xl
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      ...TavariStyles.components.form?.input || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white
      },
      width: '90%'
    },
    select: {
      ...TavariStyles.components.form?.select || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white,
        cursor: 'pointer'
      },
      width: '90%'
    },
    toggleGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    toggleItem: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    description: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.xs
    },
    warningBox: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warningText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.md
    },
    infoBox: {
      backgroundColor: TavariStyles.colors.infoBg,
      color: TavariStyles.colors.infoText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.md
    }
  };

  return (
    <div style={styles.container}>
      {/* Document Retention Policies */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Document Retention Policies</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Employee Records Retention (years)
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={settings.document_retention_years || 7}
              onChange={(e) => handleInputChange('document_retention_years', parseInt(e.target.value) || 7)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              How long to retain employee documents after termination (Canadian requirement: minimum 3 years)
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Payroll Records Retention (years)
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={settings.payroll_retention_years || 6}
              onChange={(e) => handleInputChange('payroll_retention_years', parseInt(e.target.value) || 6)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Retention period for payroll records and tax documents (CRA requirement: 6 years)
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Safety Records Retention (years)
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={settings.safety_records_retention_years || 20}
              onChange={(e) => handleInputChange('safety_records_retention_years', parseInt(e.target.value) || 20)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Retention period for workplace safety and incident records
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Training Records Retention (years)
            </label>
            <input
              type="number"
              min="1"
              max="30"
              value={settings.training_records_retention_years || 10}
              onChange={(e) => handleInputChange('training_records_retention_years', parseInt(e.target.value) || 10)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              How long to keep employee training certificates and completion records
            </span>
          </div>
        </div>

        <div style={styles.warningBox}>
          <strong>Legal Compliance:</strong> Retention periods must meet or exceed provincial and federal legal requirements. 
          Consult with legal counsel to ensure compliance with employment standards and privacy legislation.
        </div>
      </div>

      {/* Document Access and Security */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Document Access and Security</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_document_encryption ?? true}
              onChange={(checked) => handleInputChange('require_document_encryption', checked)}
              label="Require document encryption"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All uploaded documents are encrypted before storage for enhanced security
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.log_document_access ?? true}
              onChange={(checked) => handleInputChange('log_document_access', checked)}
              label="Log all document access"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Maintain audit logs of who accessed which documents and when
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_document_approval ?? false}
              onChange={(checked) => handleInputChange('require_document_approval', checked)}
              label="Require approval for sensitive document access"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Sensitive documents require manager approval before employees can access them
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.watermark_documents ?? false}
              onChange={(checked) => handleInputChange('watermark_documents', checked)}
              label="Add watermarks to downloaded documents"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Automatically add company watermarks to documents when downloaded
            </span>
          </div>
        </div>

        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Document Access Level
            </label>
            <select
              value={settings.default_document_access_level || 'manager_only'}
              onChange={(e) => handleInputChange('default_document_access_level', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="employee_self">Employee Self-Access Only</option>
              <option value="manager_only">Manager and HR Only</option>
              <option value="hr_only">HR Only</option>
              <option value="owner_only">Owner Only</option>
            </select>
            <span style={styles.description}>
              Default access level for employee documents
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Document Download Restrictions
            </label>
            <select
              value={settings.document_download_restrictions || 'unrestricted'}
              onChange={(e) => handleInputChange('document_download_restrictions', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="unrestricted">Unrestricted</option>
              <option value="manager_approval">Require Manager Approval</option>
              <option value="hr_approval">Require HR Approval</option>
              <option value="no_download">View Only (No Downloads)</option>
            </select>
            <span style={styles.description}>
              Restrictions on document downloads by employees and managers
            </span>
          </div>
        </div>
      </div>

      {/* File Upload and Storage Settings */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>File Upload and Storage Settings</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Maximum File Size (MB)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={settings.max_file_size_mb || 10}
              onChange={(e) => handleInputChange('max_file_size_mb', parseInt(e.target.value) || 10)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Maximum size for individual file uploads
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Storage Quota per Employee (MB)
            </label>
            <input
              type="number"
              min="10"
              max="1000"
              value={settings.storage_quota_per_employee_mb || 100}
              onChange={(e) => handleInputChange('storage_quota_per_employee_mb', parseInt(e.target.value) || 100)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Total storage space allocated per employee for documents
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Allowed File Types
            </label>
            <select
              value={settings.allowed_file_types || 'documents_images'}
              onChange={(e) => handleInputChange('allowed_file_types', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="documents_only">Documents Only (PDF, DOC, DOCX)</option>
              <option value="documents_images">Documents and Images</option>
              <option value="documents_images_video">Documents, Images, and Video</option>
              <option value="all_safe">All Safe File Types</option>
            </select>
            <span style={styles.description}>
              Types of files that can be uploaded to the system
            </span>
          </div>
        </div>

        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.scan_uploads_for_viruses ?? true}
              onChange={(checked) => handleInputChange('scan_uploads_for_viruses', checked)}
              label="Scan uploads for viruses and malware"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Automatically scan all uploaded files for security threats
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.auto_backup_documents ?? true}
              onChange={(checked) => handleInputChange('auto_backup_documents', checked)}
              label="Automatically backup documents"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Create automatic backups of all employee documents
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.version_control_documents ?? false}
              onChange={(checked) => handleInputChange('version_control_documents', checked)}
              label="Enable document version control"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Keep track of document versions and allow rollback to previous versions
            </span>
          </div>
        </div>
      </div>

      {/* Document Categories and Organization */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Document Categories and Organization</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_document_categories ?? true}
              onChange={(checked) => handleInputChange('require_document_categories', checked)}
              label="Require document categorization"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All uploaded documents must be assigned to a category
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.auto_categorize_documents ?? false}
              onChange={(checked) => handleInputChange('auto_categorize_documents', checked)}
              label="Automatically categorize documents"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Use AI to automatically suggest document categories based on content
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_document_tags ?? false}
              onChange={(checked) => handleInputChange('require_document_tags', checked)}
              label="Require document tags"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Documents must have descriptive tags for better organization and search
            </span>
          </div>
        </div>

        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Document Naming Convention
            </label>
            <select
              value={settings.document_naming_convention || 'free_form'}
              onChange={(e) => handleInputChange('document_naming_convention', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="free_form">Free Form</option>
              <option value="structured">Structured (Category_Date_Name)</option>
              <option value="employee_id">Employee ID Based</option>
              <option value="department_based">Department Based</option>
            </select>
            <span style={styles.description}>
              Standardized naming convention for uploaded documents
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Archive Old Documents (days)
            </label>
            <input
              type="number"
              min="30"
              max="3650"
              value={settings.auto_archive_days || 365}
              onChange={(e) => handleInputChange('auto_archive_days', parseInt(e.target.value) || 365)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Automatically archive documents older than this many days
            </span>
          </div>
        </div>
      </div>

      {/* Compliance and Reporting */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Compliance and Reporting</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.generate_compliance_reports ?? true}
              onChange={(checked) => handleInputChange('generate_compliance_reports', checked)}
              label="Generate compliance reports"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Automatically generate reports for compliance audits and record keeping
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_missing_documents ?? true}
              onChange={(checked) => handleInputChange('notify_missing_documents', checked)}
              label="Notify of missing required documents"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert HR when employees are missing required documents
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.track_document_expiry ?? true}
              onChange={(checked) => handleInputChange('track_document_expiry', checked)}
              label="Track document expiry dates"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Monitor expiry dates for certificates, licenses, and other time-sensitive documents
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.privacy_compliance_mode ?? true}
              onChange={(checked) => handleInputChange('privacy_compliance_mode', checked)}
              label="Enable privacy compliance mode"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Enhanced privacy protections to comply with PIPEDA and provincial privacy laws
            </span>
          </div>
        </div>

        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Document Expiry Warning (days)
            </label>
            <input
              type="number"
              min="1"
              max="365"
              value={settings.document_expiry_warning_days || 30}
              onChange={(e) => handleInputChange('document_expiry_warning_days', parseInt(e.target.value) || 30)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Days before document expiry to send warning notifications
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Compliance Report Frequency
            </label>
            <select
              value={settings.compliance_report_frequency || 'monthly'}
              onChange={(e) => handleInputChange('compliance_report_frequency', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
              <option value="on_demand">On Demand Only</option>
            </select>
            <span style={styles.description}>
              How often to generate automated compliance reports
            </span>
          </div>
        </div>

        <div style={styles.infoBox}>
          <strong>Document Security Best Practices:</strong>
          <br />• Regularly review access permissions and remove unnecessary access
          <br />• Implement strong password policies for document systems
          <br />• Train employees on proper document handling procedures
          <br />• Conduct periodic security audits of document storage systems
          <br />• Ensure compliance with industry-specific regulations (if applicable)
        </div>
      </div>

      {/* Legal and Regulatory Compliance */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Legal and Regulatory Compliance</h3>
        
        <div style={styles.warningBox}>
          <strong>Important Legal Notice:</strong> Document retention and management requirements vary by province and industry. 
          The settings above are general guidelines. Always consult with legal counsel to ensure your document management 
          practices comply with:
          <br />• Provincial employment standards legislation
          <br />• Personal Information Protection and Electronic Documents Act (PIPEDA)
          <br />• Canada Revenue Agency record-keeping requirements
          <br />• Industry-specific regulations (healthcare, finance, etc.)
          <br />• Workers' compensation board requirements
        </div>

        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.gdpr_compliance_mode ?? false}
              onChange={(checked) => handleInputChange('gdpr_compliance_mode', checked)}
              label="Enable GDPR compliance features (for EU employees)"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Additional privacy protections for employees subject to GDPR regulations
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.right_to_be_forgotten ?? true}
              onChange={(checked) => handleInputChange('right_to_be_forgotten', checked)}
              label="Support right to be forgotten requests"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Allow for complete removal of employee data upon request (subject to legal retention requirements)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentManagementTab;
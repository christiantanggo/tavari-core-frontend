import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';

const ComplianceTrackingModal = ({ 
  isOpen, 
  onClose, 
  employee, 
  businessId,
  onComplianceCreated 
}) => {
  const navigate = useNavigate();

  // Authentication state (inline like TabScreen)
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const [formData, setFormData] = useState({
    complianceType: '',
    startDate: '',
    dueDate: '',
    expiryDate: '',
    probationEndDate: '',
    probationMonths: 3,
    complianceNotes: ''
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [contractFiles, setContractFiles] = useState([]);

  // Compliance type options
  const complianceTypes = [
    { value: 'probation_period', label: 'Probation Period' },
    { value: 'contract_expiry', label: 'Contract Expiry' },
    { value: 'certification_expiry', label: 'Certification Expiry' },
    { value: 'policy_acknowledgment', label: 'Policy Acknowledgment' },
    { value: 'training_requirement', label: 'Training Requirement' },
    { value: 'performance_review', label: 'Performance Review' }
  ];

  // Authentication setup (copied from TabScreen pattern)
  useEffect(() => {
    const initializeAuth = async () => {
      if (!isOpen) return;

      try {
        console.log('ComplianceTrackingModal: Initializing authentication...');
        
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error || !session?.user) {
          console.error('ComplianceTrackingModal: No valid session');
          setAuthError('Authentication required');
          return;
        }

        setAuthUser(session.user);

        if (!businessId) {
          setAuthError('No business selected');
          return;
        }

        // Verify user has access to this business
        const { data: userRole, error: roleError } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('business_id', businessId)
          .eq('active', true)
          .single();

        if (roleError || !userRole) {
          console.error('ComplianceTrackingModal: User not authorized for this business:', roleError);
          setAuthError('Not authorized for this business');
          return;
        }

        console.log('ComplianceTrackingModal: User role verified:', userRole.role);
        setAuthLoading(false);

      } catch (err) {
        console.error('ComplianceTrackingModal: Authentication error:', err);
        setAuthError(err.message);
        setAuthLoading(false);
      }
    };

    if (isOpen) {
      initializeAuth();
      resetForm();
      loadContractFiles();
    }
  }, [isOpen, businessId]);

  const loadContractFiles = async () => {
    if (!employee?.id || !businessId) return;

    try {
      const { data, error } = await supabase
        .from('contract_files')
        .select('id, file_name, uploaded_at, file_type, file_size, storage_path')
        .eq('business_id', businessId)
        .eq('employee_id', employee.id)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;

      setContractFiles(data || []);
    } catch (error) {
      console.error('Error loading contract files:', error);
      setContractFiles([]);
    }
  };

  const resetForm = () => {
    setFormData({
      complianceType: '',
      startDate: '',
      dueDate: '',
      expiryDate: '',
      probationEndDate: '',
      probationMonths: 3,
      complianceNotes: ''
    });
    setErrors({});
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }

    // Auto-calculate dates for probation period
    if (field === 'complianceType' && value === 'probation_period') {
      if (employee?.hire_date) {
        const hireDate = new Date(employee.hire_date);
        const probationEnd = new Date(hireDate);
        probationEnd.setMonth(probationEnd.getMonth() + formData.probationMonths);
        
        const reviewDue = new Date(probationEnd);
        reviewDue.setDate(reviewDue.getDate() - 7); // 1 week before

        setFormData(prev => ({
          ...prev,
          startDate: employee.hire_date,
          dueDate: reviewDue.toISOString().split('T')[0],
          probationEndDate: probationEnd.toISOString().split('T')[0]
        }));
      }
    }

    // Auto-calculate probation end date when months change
    if (field === 'probationMonths' && formData.complianceType === 'probation_period' && formData.startDate) {
      const startDate = new Date(formData.startDate);
      const probationEnd = new Date(startDate);
      probationEnd.setMonth(probationEnd.getMonth() + parseInt(value));
      
      const reviewDue = new Date(probationEnd);
      reviewDue.setDate(reviewDue.getDate() - 7);

      setFormData(prev => ({
        ...prev,
        dueDate: reviewDue.toISOString().split('T')[0],
        probationEndDate: probationEnd.toISOString().split('T')[0]
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.complianceType) {
      newErrors.complianceType = 'Compliance type is required';
    }

    if (!formData.startDate) {
      newErrors.startDate = 'Start date is required';
    }

    if (!formData.dueDate) {
      newErrors.dueDate = 'Due date is required';
    }

    // Validate date logic
    if (formData.startDate && formData.dueDate && new Date(formData.dueDate) < new Date(formData.startDate)) {
      newErrors.dueDate = 'Due date cannot be before start date';
    }

    if (formData.expiryDate && formData.startDate && new Date(formData.expiryDate) < new Date(formData.startDate)) {
      newErrors.expiryDate = 'Expiry date cannot be before start date';
    }

    if (formData.probationEndDate && formData.startDate && new Date(formData.probationEndDate) < new Date(formData.startDate)) {
      newErrors.probationEndDate = 'Probation end date cannot be before start date';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Get the current contract file (if any)
      const currentContract = contractFiles[0];

      // Special handling for probation period
      if (formData.complianceType === 'probation_period') {
        const { data, error } = await supabase.rpc('create_probation_compliance_from_contract', {
          p_business_id: businessId,
          p_employee_id: employee.id,
          p_contract_file_id: currentContract?.id || null,
          p_hire_date: formData.startDate,
          p_created_by: authUser.id,
          p_probation_months: formData.probationMonths
        });

        if (error) throw error;
        console.log('Probation compliance created:', data);
      } else {
        // General compliance record
        const { data, error } = await supabase.rpc('create_compliance_record', {
          p_business_id: businessId,
          p_employee_id: employee.id,
          p_contract_file_id: currentContract?.id || null,
          p_compliance_type: formData.complianceType,
          p_start_date: formData.startDate,
          p_due_date: formData.dueDate,
          p_created_by: authUser.id,
          p_expiry_date: formData.expiryDate || null,
          p_probation_end_date: formData.probationEndDate || null,
          p_compliance_notes: formData.complianceNotes || null
        });

        if (error) throw error;
        console.log('Compliance record created:', data);
      }
      
      // Close modal and refresh parent component
      onClose();
      if (onComplianceCreated) {
        onComplianceCreated();
      }
      
    } catch (error) {
      console.error('Error creating compliance record:', error);
      setErrors({ submit: 'Failed to create compliance record. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const renderTypeSpecificFields = () => {
    switch (formData.complianceType) {
      case 'probation_period':
        return (
          <>
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Probation Period (Months)</label>
              <select
                style={styles.formSelect}
                value={formData.probationMonths}
                onChange={(e) => handleInputChange('probationMonths', parseInt(e.target.value))}
              >
                <option value={1}>1 Month</option>
                <option value={2}>2 Months</option>
                <option value={3}>3 Months</option>
                <option value={6}>6 Months</option>
                <option value={12}>12 Months</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.formLabel}>Probation End Date</label>
              <input
                type="date"
                style={styles.formInput}
                value={formData.probationEndDate}
                onChange={(e) => handleInputChange('probationEndDate', e.target.value)}
                readOnly
              />
              <div style={styles.fieldNote}>
                Automatically calculated based on start date and probation months
              </div>
            </div>
          </>
        );
        
      case 'contract_expiry':
      case 'certification_expiry':
        return (
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Expiry Date *</label>
            <input
              type="date"
              style={{
                ...styles.formInput,
                borderColor: errors.expiryDate ? '#dc2626' : '#008080'
              }}
              value={formData.expiryDate}
              onChange={(e) => handleInputChange('expiryDate', e.target.value)}
            />
            {errors.expiryDate && (
              <div style={styles.errorMessage}>{errors.expiryDate}</div>
            )}
          </div>
        );
        
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  // Loading and error states (same pattern as TabScreen)
  if (authLoading) {
    return (
      <div style={styles.modalOverlay}>
        <div style={styles.modal}>
          <div style={{...styles.container, justifyContent: 'center', alignItems: 'center', height: '200px'}}>
            <h3>Loading Compliance Tracking...</h3>
            <p>Authenticating user and loading business data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={styles.modalOverlay}>
        <div style={styles.modal}>
          <div style={{...styles.container, justifyContent: 'center', alignItems: 'center', height: '200px'}}>
            <h3>Authentication Error</h3>
            <p>{authError}</p>
            <button 
              style={styles.createButton}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Create Compliance Record</h2>
          <button onClick={onClose} style={styles.modalClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={styles.modalContent}>
          {/* Employee Info */}
          <div style={styles.employeeInfo}>
            <h3 style={styles.sectionTitle}>Employee Information</h3>
            <p style={styles.employeeDetails}>
              {employee?.first_name} {employee?.last_name} - {employee?.position}
            </p>
            {employee?.hire_date && (
              <p style={styles.employeeDetails}>
                Hire Date: {new Date(employee.hire_date).toLocaleDateString()}
              </p>
            )}
            {contractFiles.length > 0 && (
              <p style={styles.contractDetails}>
                Current Contract: {contractFiles[0]?.file_name}
              </p>
            )}
          </div>

          {/* Compliance Type */}
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Compliance Type *</label>
            <select
              style={{
                ...styles.formSelect,
                borderColor: errors.complianceType ? '#dc2626' : '#008080'
              }}
              value={formData.complianceType}
              onChange={(e) => handleInputChange('complianceType', e.target.value)}
            >
              <option value="">Select compliance type</option>
              {complianceTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {errors.complianceType && (
              <div style={styles.errorMessage}>{errors.complianceType}</div>
            )}
          </div>

          {/* Start Date */}
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Start Date *</label>
            <input
              type="date"
              style={{
                ...styles.formInput,
                borderColor: errors.startDate ? '#dc2626' : '#008080'
              }}
              value={formData.startDate}
              onChange={(e) => handleInputChange('startDate', e.target.value)}
            />
            {errors.startDate && (
              <div style={styles.errorMessage}>{errors.startDate}</div>
            )}
          </div>

          {/* Due Date */}
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Due Date *</label>
            <input
              type="date"
              style={{
                ...styles.formInput,
                borderColor: errors.dueDate ? '#dc2626' : '#008080'
              }}
              value={formData.dueDate}
              onChange={(e) => handleInputChange('dueDate', e.target.value)}
            />
            {errors.dueDate && (
              <div style={styles.errorMessage}>{errors.dueDate}</div>
            )}
            <div style={styles.fieldNote}>
              Date by which compliance action should be completed
            </div>
          </div>

          {/* Type-specific fields */}
          {renderTypeSpecificFields()}

          {/* Compliance Notes */}
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Notes</label>
            <textarea
              style={styles.formTextarea}
              rows="3"
              value={formData.complianceNotes}
              onChange={(e) => handleInputChange('complianceNotes', e.target.value)}
              placeholder="Additional notes about this compliance requirement..."
            />
          </div>

          {errors.submit && (
            <div style={styles.errorBanner}>
              {errors.submit}
            </div>
          )}

          {/* Form Actions */}
          <div style={styles.formActions}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={styles.cancelButton}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.createButton,
                opacity: loading ? 0.5 : 1
              }}
            >
              {loading ? 'Creating...' : 'Create Compliance Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const styles = {
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '700px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f8f9fa'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px'
  },
  modalContent: {
    padding: '20px',
    overflowY: 'auto',
    flex: 1
  },
  container: {
    display: 'flex',
    flexDirection: 'column'
  },
  employeeInfo: {
    backgroundColor: '#f8f9fa',
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px',
    border: '1px solid #e5e7eb'
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '8px',
    margin: 0
  },
  employeeDetails: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '4px 0'
  },
  contractDetails: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '4px 0',
    fontStyle: 'italic'
  },
  formGroup: {
    marginBottom: '20px'
  },
  formLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: '6px'
  },
  formInput: {
    width: '100%',
    padding: '12px',
    border: '2px solid #008080',
    borderRadius: '6px',
    fontSize: '16px',
    boxSizing: 'border-box'
  },
  formSelect: {
    width: '100%',
    padding: '12px',
    border: '2px solid #008080',
    borderRadius: '6px',
    fontSize: '16px',
    backgroundColor: 'white',
    boxSizing: 'border-box'
  },
  formTextarea: {
    width: '100%',
    padding: '12px',
    border: '2px solid #008080',
    borderRadius: '6px',
    fontSize: '16px',
    boxSizing: 'border-box',
    resize: 'vertical'
  },
  fieldNote: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
    fontStyle: 'italic'
  },
  errorMessage: {
    color: '#dc2626',
    fontSize: '14px',
    marginTop: '4px'
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '20px'
  },
  formActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    paddingTop: '15px',
    borderTop: '1px solid #e5e7eb'
  },
  cancelButton: {
    padding: '12px 20px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  createButton: {
    padding: '12px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  }
};

export default ComplianceTrackingModal;
// components/HR/ContractModals.jsx - Contract Creation Flow Modals
import React, { useState, useEffect } from 'react';
import { X, Calendar, CheckCircle2, Send, Save, Eye } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import TavariCheckbox from '../UI/TavariCheckbox';
import SpecialConsiderationsEditor from './SpecialConsiderationsEditor';
import toast from 'react-hot-toast';
import { formatDateForBusiness, formatDateShort, formatDateNumeric, getBusinessTimezone } from '../../utils/businessDateFormat';
// KEY TERMS MODAL — employee fields are never auto-filled from email (per-business silo)
export const KeyTermsModal = ({ isOpen, onClose, data, onSave, businessData, businessId }) => {
  const [formData, setFormData] = useState(data);
  const [minWage, setMinWage] = useState('');
  const [vacationPay, setVacationPay] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [managers, setManagers] = useState([]);
  const [loadingManagers, setLoadingManagers] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Set initial form data
      setFormData(data);
      // Load business settings (including minimum wage) and auto-populate if needed
      loadBusinessSettings();
      loadManagers();
    }
  }, [data, businessData, businessId, isOpen]);

  const loadManagers = async () => {
    if (!businessId) return;
    try {
      setLoadingManagers(true);
      const { data: managerData, error } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          full_name,
          employee_number,
          business_users!inner(business_id, role)
        `)
        .eq('business_users.business_id', businessId)
        .in('business_users.role', ['owner', 'admin', 'manager'])
        .order('first_name');

      if (error) throw error;
      setManagers(managerData || []);
    } catch (error) {
      console.error('Error loading managers for contract:', error);
      toast.error('Failed to load managers');
    } finally {
      setLoadingManagers(false);
    }
  };

  const formatManagerName = (manager) => {
    if (!manager) return '';
    const name =
      manager.full_name?.trim() ||
      `${manager.first_name || ''} ${manager.last_name || ''}`.trim();
    return manager.employee_number ? `${name} (#${manager.employee_number})` : name;
  };

  const loadBusinessSettings = async () => {
    // Load business address and email for auto-fill
    if (businessData) {
      setFormData(prev => ({
        ...prev,
        primaryWorkLocation: businessData.business_address || businessData.address || '',
        employerContactEmail: businessData.business_email || businessData.email || ''
      }));
    }

    // Load minimum wage from hr_settings table
    if (businessId) {
      try {
        const { data: hrSettings, error } = await supabase
          .from('hr_settings')
          .select('minimum_wage_regular')
          .eq('business_id', businessId)
          .single();

        let wageValue = '';
        if (!error && hrSettings?.minimum_wage_regular) {
          wageValue = hrSettings.minimum_wage_regular.toString();
          setMinWage(wageValue);
        } else {
          // Default fallback to Ontario 2024 minimum wage
          wageValue = '17.20';
          setMinWage(wageValue);
        }

        // Auto-populate baseHourlyWage if it's empty, null, or undefined
        // Check for empty string, null, undefined, or whitespace-only
        setFormData(prev => {
          const currentWage = prev.baseHourlyWage;
          const isEmpty = !currentWage || currentWage.toString().trim() === '';
          return {
            ...prev,
            baseHourlyWage: isEmpty ? wageValue : currentWage
          };
        });

        // Load vacation pay rate (typically 4% in Ontario)
        const vacationRate = businessData?.vacation_pay_rate || '4';
        setVacationPay(vacationRate);
        setFormData(prev => {
          const currentVacation = prev.vacationPayRate;
          const isEmpty = !currentVacation || currentVacation.toString().trim() === '';
          return {
            ...prev,
            vacationPayRate: isEmpty ? vacationRate : currentVacation
          };
        });
      } catch (error) {
        console.error('Error loading payroll settings:', error);
        // Set defaults on error
        const defaultWage = '17.20';
        setMinWage(defaultWage);
        setVacationPay('4');
        // Still auto-populate on error
        setFormData(prev => {
          const currentWage = prev.baseHourlyWage;
          const isEmpty = !currentWage || currentWage.toString().trim() === '';
          return {
            ...prev,
            baseHourlyWage: isEmpty ? defaultWage : currentWage
          };
        });
      }
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Auto-calculate probationary period from start date
    if (field === 'contractStartDate' && value) {
      const startDate = new Date(value);
      const probationEnd = new Date(startDate);
      probationEnd.setDate(probationEnd.getDate() + 90);
      // Format as YYYY-MM-DD
      setFormData(prev => ({ 
        ...prev, 
        probationaryPeriod: 90,
        probationEndDate: probationEnd.toISOString().split('T')[0]
      }));
    }
  };

  // Generate default contract preamble from key terms
  const generateDefaultPreamble = (keyTerms, businessData) => {
    const employerName = businessData?.business_name || businessData?.name || '[EMPLOYER NAME]';
    const employerAddress = businessData?.business_address || businessData?.address || '[EMPLOYER ADDRESS]';
    const employeeName = `${keyTerms.firstName || ''} ${keyTerms.lastName || ''}`.trim() || '[EMPLOYEE NAME]';
    const employeeAddress = keyTerms.employeeAddress || '[EMPLOYEE ADDRESS]';
    const employeePhone = keyTerms.employeePhone || '[EMPLOYEE PHONE]';
    
    // Get date components
    let day = '[DATE]';
    let month = '[MONTH]';
    let year = '[YEAR]';
    
    if (keyTerms.contractStartDate) {
      const startDate = new Date(keyTerms.contractStartDate);
      day = startDate.getDate().toString();
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      month = months[startDate.getMonth()];
      year = startDate.getFullYear().toString();
    }
    
    return `THIS EMPLOYMENT CONTRACT (the "Agreement") dated this ${day} day of ${month}, ${year}

${employerName} of ${employerAddress}

(the "Employer")

${employeeName} of ${employeeAddress}
Phone: ${employeePhone}

(the "Employee")

BACKGROUND:

The employer is of the opinion that the Employee has the necessary qualifications, experience and abilities to assist and benefit the Employer in its business.

The Employer desires to employ the Employee and the Employee has agreed to accept and enter such employment upon the terms and conditions set out in this Agreement.

IN CONSIDERATION OF the matters described above and of the mutual benefits and obligations set forth in this Agreement, the receipt and sufficiency of which consideration is hereby acknowledged, the parties to this Agreement agree as follows:`;
  };

  const handleSave = () => {
    const phoneDigits = String(formData.employeePhone || '').replace(/\D/g, '');
    if (!formData.firstName || !formData.lastName || !formData.positionTitle || !formData.employeeAddress || !formData.employeePhone || phoneDigits.length < 10 || !formData.employeeEmail || !formData.managerId) {
      toast.error('Please fill in all required fields (including manager and a valid phone number with at least 10 digits)');
      return;
    }
    
    // Generate preamble if it doesn't exist or if key terms have changed
    const preamble = formData.contractPreamble || generateDefaultPreamble(formData, businessData);
    const selectedManager = managers.find((mgr) => mgr.id === formData.managerId);
    
    onSave({
      ...formData,
      managerName: formatManagerName(selectedManager),
      contractPreamble: preamble
    });
  };

  if (!isOpen) return null;

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.largeModal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>Step 1: Key Terms Summary</h2>
          <button onClick={onClose} style={modalStyles.closeButton}>
            <X size={24} />
          </button>
        </div>
        <div style={modalStyles.body}>
          <div style={modalStyles.formGrid}>
            <div style={modalStyles.formGroup}>
              <label>First Name *</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleChange('firstName', e.target.value)}
                style={modalStyles.input}
              />
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Last Name *</label>
              <input
                type="text"
                value={formData.lastName || ''}
                onChange={(e) => handleChange('lastName', e.target.value)}
                style={modalStyles.input}
              />
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Position Title *</label>
              <input
                type="text"
                value={formData.positionTitle || ''}
                onChange={(e) => handleChange('positionTitle', e.target.value)}
                style={modalStyles.input}
                placeholder="e.g., Seasonal Clerk - Server"
              />
            </div>

            <div style={modalStyles.formGroup}>
              <label>Manager *</label>
              <select
                value={formData.managerId || ''}
                onChange={(e) => handleChange('managerId', e.target.value)}
                style={modalStyles.input}
                disabled={loadingManagers}
              >
                <option value="">
                  {loadingManagers ? 'Loading managers...' : 'Select manager'}
                </option>
                {managers.map((mgr) => (
                  <option key={mgr.id} value={mgr.id}>
                    {formatManagerName(mgr)}
                  </option>
                ))}
              </select>
              <div style={modalStyles.hint}>
                Used for employee profile and certificate approval notifications
              </div>
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Employee Address *</label>
              <input
                type="text"
                value={formData.employeeAddress || ''}
                onChange={(e) => handleChange('employeeAddress', e.target.value)}
                style={modalStyles.input}
                placeholder="e.g., 150 Vermont Street, Lasalle, ON, N9J 1C9"
              />
            </div>

            <div style={modalStyles.formGroup}>
              <label>Employee Phone *</label>
              <input
                type="tel"
                value={formData.employeePhone || ''}
                onChange={(e) => handleChange('employeePhone', e.target.value)}
                style={modalStyles.input}
                placeholder="e.g., 519-555-1234"
                autoComplete="tel"
              />
              <div style={modalStyles.hint}>Required for employee portal access after signing</div>
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Employment Type *</label>
              <select
                value={formData.employmentType || 'permanent'}
                onChange={(e) => handleChange('employmentType', e.target.value)}
                style={modalStyles.input}
              >
                <option value="permanent">Permanent</option>
                <option value="seasonal">Seasonal</option>
                <option value="temporary-contract">Temporary Contract</option>
              </select>
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Employment Status *</label>
              <select
                value={formData.employmentStatus || 'full-time'}
                onChange={(e) => handleChange('employmentStatus', e.target.value)}
                style={modalStyles.input}
              >
                <option value="full-time">Full Time</option>
                <option value="part-time">Part Time</option>
              </select>
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Contract Start Date *</label>
              <input
                type="date"
                value={formData.contractStartDate}
                onChange={(e) => handleChange('contractStartDate', e.target.value)}
                style={modalStyles.input}
              />
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Contract End Date</label>
              <input
                type="date"
                value={formData.contractEndDate}
                onChange={(e) => handleChange('contractEndDate', e.target.value)}
                style={modalStyles.input}
              />
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Probationary Period (Days)</label>
              <input
                type="number"
                value={formData.probationaryPeriod}
                onChange={(e) => handleChange('probationaryPeriod', parseInt(e.target.value) || 90)}
                style={modalStyles.input}
              />
              {formData.probationEndDate && (
                <div style={modalStyles.hint}>Ends: {formatDateShort(formData.probationEndDate, getBusinessTimezone(businessData))}</div>
              )}
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Base Hourly Wage *</label>
              <input
                type="number"
                step="0.01"
                value={formData.baseHourlyWage}
                onChange={(e) => handleChange('baseHourlyWage', e.target.value)}
                placeholder={minWage}
                style={modalStyles.input}
              />
              <div style={modalStyles.hint}>Minimum wage: ${minWage}/hr</div>
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Vacation Pay Rate (%) *</label>
              <input
                type="number"
                step="0.01"
                value={formData.vacationPayRate}
                onChange={(e) => handleChange('vacationPayRate', e.target.value)}
                placeholder={vacationPay}
                style={modalStyles.input}
              />
              <div style={modalStyles.hint}>Default: {vacationPay}%</div>
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Primary Work Location *</label>
              <input
                type="text"
                value={formData.primaryWorkLocation}
                onChange={(e) => handleChange('primaryWorkLocation', e.target.value)}
                style={modalStyles.input}
              />
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Employer Contact Email *</label>
              <input
                type="email"
                value={formData.employerContactEmail}
                onChange={(e) => handleChange('employerContactEmail', e.target.value)}
                style={modalStyles.input}
              />
            </div>
            
            <div style={modalStyles.formGroup}>
              <label>Employee Email *</label>
              <input
                type="email"
                value={formData.employeeEmail}
                onChange={(e) => handleChange('employeeEmail', e.target.value)}
                style={modalStyles.input}
              />
            </div>
          </div>
          
          {/* Contract Preamble Editor */}
          <div style={{ marginTop: '24px', borderTop: '2px solid #e0e0e0', paddingTop: '24px' }}>
            <div style={modalStyles.formGroup}>
              <label style={{ ...modalStyles.formLabel, marginBottom: '8px', display: 'block' }}>
                Contract Preamble (Auto-filled from key terms above)
              </label>
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>
                This section will appear at the beginning of every contract. It is automatically populated from the key terms above, but you can edit it as needed.
              </div>
              <textarea
                value={formData.contractPreamble || generateDefaultPreamble(formData, businessData)}
                onChange={(e) => handleChange('contractPreamble', e.target.value)}
                style={{
                  ...modalStyles.input,
                  minHeight: '300px',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  width: '100%',
                  resize: 'vertical'
                }}
                placeholder="Contract preamble will be auto-generated from key terms..."
              />
              <button
                type="button"
                onClick={() => {
                  const regenerated = generateDefaultPreamble(formData, businessData);
                  handleChange('contractPreamble', regenerated);
                }}
                style={{
                  marginTop: '8px',
                  padding: '6px 12px',
                  fontSize: '13px',
                  backgroundColor: '#f0f0f0',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Regenerate from Key Terms
              </button>
            </div>
          </div>
        </div>
        <div style={modalStyles.footer}>
          <button onClick={onClose} style={modalStyles.cancelButton}>Cancel</button>
          <button 
            onClick={() => setShowPreview(true)} 
            style={{
              ...modalStyles.cancelButton,
              backgroundColor: '#f0f0f0',
              border: '1px solid #ccc',
              marginRight: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Eye size={16} />
            Preview Preamble
          </button>
          <button onClick={handleSave} style={modalStyles.saveButton}>Save & Continue</button>
        </div>
      </div>
      
      {/* Preview Modal */}
      {showPreview && (
        <div style={modalStyles.overlay} onClick={() => setShowPreview(false)}>
          <div style={{
            ...modalStyles.largeModal,
            maxWidth: '800px',
            maxHeight: '85vh'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={modalStyles.header}>
              <h2>Contract Preamble Preview</h2>
              <button onClick={() => setShowPreview(false)} style={modalStyles.closeButton}>
                <X size={24} />
              </button>
            </div>
            <div style={{
              ...modalStyles.body,
              backgroundColor: '#fafafa',
              fontFamily: 'serif',
              lineHeight: '1.8',
              fontSize: '14px',
              padding: '40px',
              whiteSpace: 'pre-wrap'
            }}>
              <div style={{
                backgroundColor: 'white',
                padding: '40px',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                maxWidth: '700px',
                margin: '0 auto'
              }}>
                {(formData.contractPreamble || generateDefaultPreamble(formData, businessData)).split('\n').map((line, idx) => {
                  const trimmed = line.trim();
                  if (trimmed === '') return <div key={idx} style={{ marginBottom: '12px' }}>&nbsp;</div>;
                  
                  // Style party labels
                  if (trimmed === '(the "Employer")' || trimmed === '(the "Employee")') {
                    return <div key={idx} style={{ 
                      textAlign: 'center', 
                      fontStyle: 'italic', 
                      marginBottom: '12px',
                      color: '#555'
                    }}>{trimmed}</div>;
                  }
                  
                  // Style section titles
                  if (trimmed === 'BACKGROUND:' || trimmed === 'IN CONSIDERATION OF') {
                    return <div key={idx} style={{ 
                      fontWeight: 'bold', 
                      marginTop: '24px', 
                      marginBottom: '12px',
                      fontSize: '15px',
                      textTransform: 'uppercase'
                    }}>{trimmed}</div>;
                  }
                  
                  // Style party names with addresses
                  const employerName = businessData?.business_name || businessData?.name || '';
                  const employeeName = `${formData.firstName || ''} ${formData.lastName || ''}`.trim();
                  if (trimmed.includes(' of ') && (trimmed.includes(employerName) || trimmed.includes(employeeName))) {
                    const nameMatch = trimmed.match(/(.+?)\s+of\s+(.+)/);
                    if (nameMatch) {
                      return <div key={idx} style={{ 
                        textAlign: 'center', 
                        marginBottom: '12px',
                        lineHeight: '1.6'
                      }}>
                        <strong>{nameMatch[1].trim()}</strong> of {nameMatch[2].trim()}
                      </div>;
                    }
                  }
                  
                  // Style date line
                  if (trimmed.includes('THIS EMPLOYMENT CONTRACT') || trimmed.includes('dated this')) {
                    return <div key={idx} style={{ 
                      textAlign: 'center', 
                      marginBottom: '16px',
                      fontSize: '15px'
                    }}>{trimmed}</div>;
                  }
                  
                  // Regular paragraphs
                  return <div key={idx} style={{ 
                    marginBottom: '12px',
                    textAlign: trimmed.startsWith('The employer') || trimmed.startsWith('The Employer') || trimmed.startsWith('IN CONSIDERATION OF') ? 'left' : 'center',
                    lineHeight: '1.8'
                  }}>{trimmed}</div>;
                })}
              </div>
            </div>
            <div style={modalStyles.footer}>
              <button onClick={() => setShowPreview(false)} style={modalStyles.saveButton}>Close Preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// SELECT TERMS MODAL
export const SelectTermsModal = ({ isOpen, onClose, selectedTerms, onSave, businessId }) => {
  const [employeeTypeFilter, setEmployeeTypeFilter] = useState('all');
  const [availableTerms, setAvailableTerms] = useState([]);
  const [selectedTermIds, setSelectedTermIds] = useState([]);

  useEffect(() => {
    if (isOpen && businessId) {
      console.log('[SelectTermsModal] Modal opened, loading templates', { isOpen, businessId, employeeTypeFilter });
      loadContractTemplates();
    } else {
      console.log('[SelectTermsModal] Modal not ready', { isOpen, businessId });
    }
  }, [isOpen, businessId, employeeTypeFilter]);

  const loadContractTemplates = async () => {
    console.log('[SelectTermsModal] loadContractTemplates called', { businessId, employeeTypeFilter });
    
    try {
      // Load templates first
      console.log('[SelectTermsModal] Fetching templates from contract_templates table...');
      console.log('[SelectTermsModal] Query: SELECT * FROM contract_templates WHERE business_id =', businessId, 'AND is_active = true');
      
      const { data: templates, error: templatesError } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true);

      console.log('[SelectTermsModal] Templates query result:', {
        templatesCount: templates?.length || 0,
        templates: templates,
        error: templatesError,
        errorCode: templatesError?.code,
        errorMessage: templatesError?.message,
        errorHint: templatesError?.hint
      });

      // If error indicates table doesn't exist, try without filters to confirm
      if (templatesError) {
        console.error('[SelectTermsModal] Templates error:', templatesError);
        
        // Check if it's a table not found error
        if (templatesError.code === '42P01' || templatesError.message?.includes('does not exist')) {
          console.error('[SelectTermsModal] Table contract_templates does not exist. Run the SQL to create it.');
          toast.error('Contract templates table not found. Please create it first.');
        }
        
        throw templatesError;
      }

      if (!templates || templates.length === 0) {
        console.log('[SelectTermsModal] No templates found. Checking if table has any templates at all...');
        
        // Try to fetch any templates without filters to see if table exists and has data
        const { data: allTemplates, error: checkError } = await supabase
          .from('contract_templates')
          .select('id, business_id, template_name, is_active')
          .limit(10);
        
        console.log('[SelectTermsModal] All templates check (no filters):', {
          count: allTemplates?.length || 0,
          templates: allTemplates,
          error: checkError
        });
        
        if (allTemplates && allTemplates.length > 0) {
          console.warn('[SelectTermsModal] Templates exist but none match business_id or is_active filter');
          console.warn('[SelectTermsModal] Sample template business_ids:', allTemplates.map(t => t.business_id));
        }
        
        setAvailableTerms([]);
        return;
      }

      // Load sections separately
      const templateIds = templates.map(t => t.id);
      console.log('[SelectTermsModal] Fetching sections for template IDs:', templateIds);
      
      const { data: sections, error: sectionsError } = await supabase
        .from('contract_template_sections')
        .select('*')
        .in('template_id', templateIds);

      console.log('[SelectTermsModal] Sections query result:', {
        sectionsCount: sections?.length || 0,
        sections: sections,
        error: sectionsError
      });

      if (sectionsError) {
        console.error('[SelectTermsModal] Sections error:', sectionsError);
        throw sectionsError;
      }

      // Map sections to templates and filter based on employeeTypeFilter
      // IMPORTANT: Deduplicate sections by title to avoid duplicates from multiple templates
      const filteredSections = [];
      const seenSectionTitles = new Set(); // Track seen section titles to prevent duplicates
      console.log('[SelectTermsModal] Processing sections with filter:', employeeTypeFilter);
      
      (templates || []).forEach(template => {
        const templateSections = (sections || []).filter(s => s.template_id === template.id);
        console.log(`[SelectTermsModal] Template "${template.template_name}" has ${templateSections.length} sections`);
        
        templateSections.forEach(section => {
          // If required_for is missing, default to 'all'
          const requiredFor = section.required_for || 'all';
          const matchesFilter = employeeTypeFilter === 'all' || requiredFor === employeeTypeFilter || requiredFor === 'all';
          
          // Create a unique key from title (normalized to lowercase and trimmed)
          const sectionTitleKey = (section.title || '').trim().toLowerCase();
          
          // Skip if we've already seen this section title (deduplication)
          if (seenSectionTitles.has(sectionTitleKey)) {
            console.log(`[SelectTermsModal] Skipping duplicate section "${section.title}" from template "${template.template_name}"`);
            return;
          }
          
          console.log(`[SelectTermsModal] Section "${section.title}":`, {
            required_for: section.required_for,
            requiredFor,
            employeeTypeFilter,
            matchesFilter
          });
          
          if (matchesFilter) {
            seenSectionTitles.add(sectionTitleKey); // Mark as seen
            filteredSections.push({
              ...section,
              template_name: template.template_name,
              template_id: template.id,
              required_for: requiredFor
            });
          }
        });
      });

      console.log('[SelectTermsModal] Final filtered sections:', {
        count: filteredSections.length,
        sections: filteredSections.map(s => ({ id: s.id, title: s.title, required_for: s.required_for }))
      });

      setAvailableTerms(filteredSections);
      
      // Auto-select ALL terms every time (sections and subsections)
      const allTermIds = filteredSections.map(s => s.id);
      console.log('[SelectTermsModal] Auto-selecting all terms:', allTermIds);
      setSelectedTermIds(allTermIds);
    } catch (error) {
      console.error('[SelectTermsModal] Error loading templates:', error);
      toast.error('Failed to load contract templates');
    }
  };

  const toggleTerm = (termId) => {
    setSelectedTermIds(prev => 
      prev.includes(termId) 
        ? prev.filter(id => id !== termId)
        : [...prev, termId]
    );
  };

  const handleSave = () => {
    const terms = availableTerms.filter(t => selectedTermIds.includes(t.id));
    
    // CRITICAL: Deduplicate by title to prevent duplicate sections from multiple templates
    const uniqueTerms = [];
    const seenTitles = new Set();
    
    terms.forEach(term => {
      const titleKey = (term.title || '').trim().toLowerCase();
      if (!seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        uniqueTerms.push(term);
      }
    });
    
    console.log('[SelectTermsModal] Saving terms:', {
      beforeDedup: terms.length,
      afterDedup: uniqueTerms.length,
      terms: uniqueTerms.map(t => ({ id: t.id, title: t.title }))
    });
    
    onSave(uniqueTerms);
  };

  if (!isOpen) return null;

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.largeModal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>Step 3: Select Contract Terms</h2>
          <button onClick={onClose} style={modalStyles.closeButton}>
            <X size={24} />
          </button>
        </div>
        <div style={modalStyles.body}>
          <div style={modalStyles.filterGroup}>
            <label>Filter by Employee Type:</label>
            <select
              value={employeeTypeFilter}
              onChange={(e) => setEmployeeTypeFilter(e.target.value)}
              style={modalStyles.input}
            >
              <option value="all">All Employees</option>
              <option value="management">Management Only</option>
              <option value="hourly">Hourly Employees</option>
              <option value="salaried">Salaried Employees</option>
            </select>
          </div>
          
          <div style={modalStyles.termsList}>
            {availableTerms.length === 0 ? (
              <div style={modalStyles.emptyState}>No terms available. Create templates in the &quot;Contract Templates&quot; tab.</div>
            ) : (
              availableTerms.map((term, index) => {
                // Auto-number terms based on their order (skip header types)
                const termNumber = term.section_type === 'header' ? null : index;
                const titleWithoutNumber = term.title.replace(/^\d+\.\s*/, '');
                const displayTitle = term.section_type === 'header' 
                  ? term.title 
                  : `${index}. ${titleWithoutNumber}`;

                return (
                <div key={term.id} style={modalStyles.termItem}>
                  <TavariCheckbox
                    checked={selectedTermIds.includes(term.id)}
                    onChange={() => toggleTerm(term.id)}
                    label={displayTitle}
                  />
                  {term.is_required && (
                    <span style={modalStyles.requiredBadge}>Required</span>
                  )}
                  <div style={modalStyles.termPreview}>{term.content.substring(0, 100)}...</div>
                </div>
                );
              })
            )}
          </div>
        </div>
        <div style={modalStyles.footer}>
          <button onClick={onClose} style={modalStyles.cancelButton}>Cancel</button>
          <button onClick={handleSave} style={modalStyles.saveButton}>Save & Continue</button>
        </div>
      </div>
    </div>
  );
};

// SPECIAL CONSIDERATIONS MODAL
export const SpecialConsiderationsModal = ({ isOpen, onClose, data, onSave }) => {
  // Initialize with proper structure if data is in old format
  const initializeFormData = (inputData) => {
    if (!inputData || typeof inputData.profitSharing !== 'object') {
      // Old format - convert to new format
      return {
        notApplicable: inputData?.notApplicable || false,
        profitSharing: {
          enabled: inputData?.profitSharing || false,
          title: 'Profit Sharing',
          sections: inputData?.profitSharingClause ? [{ title: '', content: inputData.profitSharingClause, subsections: [] }] : []
        },
        shiftPremium: {
          enabled: inputData?.shiftPremium || false,
          title: 'Shift Premium',
          sections: inputData?.shiftPremiumClause ? [{ title: '', content: inputData.shiftPremiumClause, subsections: [] }] : []
        },
        signingBonus: {
          enabled: inputData?.signingBonus || false,
          title: 'Signing Bonus',
          sections: inputData?.signingBonusClause ? [{ title: '', content: inputData.signingBonusClause, subsections: [] }] : []
        },
        other: {
          enabled: inputData?.other || false,
          title: 'Other Considerations',
          sections: inputData?.otherClause ? [{ title: '', content: inputData.otherClause, subsections: [] }] : []
        }
      };
    }
    return inputData;
  };

  const [formData, setFormData] = useState(() => initializeFormData(data));

  useEffect(() => {
    if (isOpen) {
      setFormData(initializeFormData(data));
    }
  }, [data, isOpen]);

  const handleToggle = (type, enabled) => {
    // If N/A is checked, disable all others
    if (type === 'notApplicable' && enabled) {
      setFormData(prev => ({
        ...prev,
        notApplicable: true,
        profitSharing: { ...prev.profitSharing, enabled: false },
        shiftPremium: { ...prev.shiftPremium, enabled: false },
        signingBonus: { ...prev.signingBonus, enabled: false },
        other: { ...prev.other, enabled: false }
      }));
    } else if (type !== 'notApplicable' && enabled) {
      // If any consideration is enabled, disable N/A
      setFormData(prev => ({
        ...prev,
        notApplicable: false,
        [type]: { ...prev[type], enabled: true }
      }));
    } else {
      // Just toggle the specific consideration
      setFormData(prev => ({
        ...prev,
        [type]: { ...prev[type], enabled: enabled }
      }));
    }
  };

  const handleConsiderationChange = (type, updatedData) => {
    setFormData(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        ...updatedData,
        // CRITICAL: Preserve the enabled state from the current formData, don't overwrite it
        enabled: prev[type]?.enabled !== undefined ? prev[type].enabled : false
      }
    }));
  };

  const handleSave = () => {
    onSave(formData);
  };

  if (!isOpen) return null;

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.largeModal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>Step 2: Special Considerations</h2>
          <button onClick={onClose} style={modalStyles.closeButton}>
            <X size={24} />
          </button>
        </div>
        <div style={modalStyles.body}>
          <p style={{ marginBottom: '24px', color: '#6b7280' }}>
            Add any additional features or clauses that are out of the ordinary for this employee.
          </p>
          
          {/* N/A Option */}
          <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
            <TavariCheckbox
              checked={formData.notApplicable || false}
              onChange={(checked) => handleChange('notApplicable', checked)}
              label="No Special Considerations (N/A)"
            />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', opacity: formData.notApplicable ? 0.5 : 1, pointerEvents: formData.notApplicable ? 'none' : 'auto' }}>
            <SpecialConsiderationsEditor
              type="profitSharing"
              label="Profit Sharing"
              data={formData.profitSharing || { enabled: false, title: 'Profit Sharing', sections: [] }}
              enabled={formData.profitSharing?.enabled || false}
              onToggle={(enabled) => handleToggle('profitSharing', enabled)}
              onChange={(updated) => handleConsiderationChange('profitSharing', updated)}
              disabled={formData.notApplicable}
            />
            
            <SpecialConsiderationsEditor
              type="shiftPremium"
              label="Shift Premium"
              data={formData.shiftPremium || { enabled: false, title: 'Shift Premium', sections: [] }}
              enabled={formData.shiftPremium?.enabled || false}
              onToggle={(enabled) => handleToggle('shiftPremium', enabled)}
              onChange={(updated) => handleConsiderationChange('shiftPremium', updated)}
              disabled={formData.notApplicable}
            />
            
            <SpecialConsiderationsEditor
              type="signingBonus"
              label="Signing Bonus"
              data={formData.signingBonus || { enabled: false, title: 'Signing Bonus', sections: [] }}
              enabled={formData.signingBonus?.enabled || false}
              onToggle={(enabled) => handleToggle('signingBonus', enabled)}
              onChange={(updated) => handleConsiderationChange('signingBonus', updated)}
              disabled={formData.notApplicable}
            />
            
            <SpecialConsiderationsEditor
              type="other"
              label="Other Considerations"
              data={formData.other || { enabled: false, title: 'Other Considerations', sections: [] }}
              enabled={formData.other?.enabled || false}
              onToggle={(enabled) => handleToggle('other', enabled)}
              onChange={(updated) => handleConsiderationChange('other', updated)}
              disabled={formData.notApplicable}
            />
          </div>
        </div>
        <div style={modalStyles.footer}>
          <button onClick={onClose} style={modalStyles.cancelButton}>Cancel</button>
          <button onClick={handleSave} style={modalStyles.saveButton}>Save & Continue</button>
        </div>
      </div>
    </div>
  );
};

// REVIEW CONTRACT MODAL
export const ReviewContractModal = ({ isOpen, onClose, contractData, onSaveDraft, onOpenSendModal, businessData, title }) => {
  const [saving, setSaving] = React.useState(false);
  
  const generateContractPreview = () => {
    const { keyTerms, specialConsiderations, selectedTerms, contractPreamble } = contractData;
    
    // Get business timezone for date formatting
    const businessTimezone = getBusinessTimezone(businessData);
    
    // Format dates using business timezone
    const formatDate = (dateString) => {
      if (!dateString) return 'N/A';
      return formatDateForBusiness(dateString, businessTimezone);
    };
    
    const formatDateNumericForContract = (dateString) => {
      if (!dateString) return 'N/A';
      return formatDateForBusiness(dateString, businessTimezone);
    };
    
    // Get date parts for header using business timezone
    // The header date should be TODAY's date, not the contract start date
    // Get today's date in business timezone - format as YYYY-MM-DD first, then parse directly
    const today = new Date();
    const todayInBusinessTZ = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: businessTimezone
    }).format(today);
    
    // Parse the date string directly (YYYY-MM-DD format) - no timezone conversion issues
    const [yearStr, monthStr, dayStr] = todayInBusinessTZ.split('-');
    const year = parseInt(yearStr);
    const monthIndex = parseInt(monthStr) - 1;
    const day = parseInt(dayStr);
    
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = months[monthIndex] || 'January';
    
    // Format employment type properly
    const formatEmploymentType = (type, status) => {
      const typeMap = {
        'permanent': 'Permanent',
        'seasonal': 'Seasonal',
        'temporary-contract': 'Temporary Contract'
      };
      const statusMap = {
        'full-time': 'Full Time',
        'part-time': 'Part Time'
      };
      const typeDisplay = typeMap[type] || type;
      const statusDisplay = statusMap[status] || status;
      return status ? `${typeDisplay}, ${statusDisplay}` : typeDisplay;
    };
    
    // Render special considerations with sections and subsections
    const renderSpecialConsiderations = (considerations) => {
      if (!considerations) return '';
      
      let html = '';
      
      // Handle old format (backward compatibility)
      if (typeof considerations.profitSharing === 'boolean') {
        // Only render if the consideration is actually selected/enabled AND has content
        if (considerations.profitSharing && considerations.profitSharingClause && considerations.profitSharingClause.trim()) {
          html += `<h3>Profit Sharing</h3><p>${considerations.profitSharingClause}</p>`;
        }
        if (considerations.shiftPremium && considerations.shiftPremiumClause && considerations.shiftPremiumClause.trim()) {
          html += `<h3>Shift Premium</h3><p>${considerations.shiftPremiumClause}</p>`;
        }
        if (considerations.signingBonus && considerations.signingBonusClause && considerations.signingBonusClause.trim()) {
          html += `<h3>Signing Bonus</h3><p>${considerations.signingBonusClause}</p>`;
        }
        if (considerations.other && considerations.otherClause && considerations.otherClause.trim()) {
          html += `<h3>Other Considerations</h3><p>${considerations.otherClause}</p>`;
        }
        return html;
      }
      
      // New format with sections and subsections
      const considerationsList = [
        { key: 'profitSharing', label: 'Profit Sharing' },
        { key: 'shiftPremium', label: 'Shift Premium' },
        { key: 'signingBonus', label: 'Signing Bonus' },
        { key: 'other', label: 'Other Considerations' }
      ];
      
      considerationsList.forEach(({ key, label }) => {
        const consideration = considerations[key];
        
        // ONLY SHOW IF EXPLICITLY ENABLED === true
        // If enabled is not exactly true, DO NOT RENDER AT ALL
        if (!consideration || consideration.enabled !== true) {
          return; // SKIP - Do not show this consideration
        }
        
        // Must have sections array with content
        if (!Array.isArray(consideration.sections) || consideration.sections.length === 0) {
          return; // SKIP - No sections
        }
        
        // Helper function to escape HTML entities
        const escapeHtml = (text) => {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        };
        
        // Helper function to render content with paragraph breaks preserved
        const renderContentWithParagraphs = (content) => {
          if (!content || !content.trim()) return '';
          // Split by double newlines (empty lines) to preserve paragraph breaks
          const paragraphs = content.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
          if (paragraphs.length === 0) return '';
          // If only one paragraph, return single <p> tag with escaped HTML
          if (paragraphs.length === 1) return `<p>${escapeHtml(paragraphs[0])}</p>`;
          // Multiple paragraphs - return each in its own <p> tag with escaped HTML
          return paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
        };
        
        // Check if any section has actual content
        const hasContent = consideration.sections.some(section => {
          if (!section) return false;
          const hasTitle = section.title && section.title.trim().length > 0;
          const hasContentText = section.content && section.content.trim().length > 0;
          const hasSubs = Array.isArray(section.subsections) && section.subsections.length > 0;
          const hasSubContent = hasSubs && section.subsections.some(sub => 
            (sub?.title && sub.title.trim().length > 0) || 
            (sub?.content && sub.content.trim().length > 0)
          );
          return hasTitle || hasContentText || hasSubContent;
        });
        
        if (!hasContent) {
          return; // SKIP - No content in sections
        }
        
        // RENDER THIS CONSIDERATION
        html += `<h3>${consideration.title || label}</h3>`;
        
        consideration.sections.forEach((section) => {
          if (!section) return;
          
          const hasTitle = section.title && section.title.trim().length > 0;
          const hasContentText = section.content && section.content.trim().length > 0;
          const hasSubs = Array.isArray(section.subsections) && section.subsections.length > 0;
          const hasSubContent = hasSubs && section.subsections.some(sub => 
            (sub?.title && sub.title.trim().length > 0) || 
            (sub?.content && sub.content.trim().length > 0)
          );
          
          if (hasTitle || hasContentText || hasSubContent) {
            if (hasTitle) {
              html += `<h4>${section.title.trim()}</h4>`;
            }
            if (hasContentText) {
              html += renderContentWithParagraphs(section.content);
            }
            
            if (hasSubs) {
              section.subsections.forEach((subsection) => {
                if (!subsection) return;
                const subTitle = subsection.title && subsection.title.trim().length > 0;
                const subContent = subsection.content && subsection.content.trim().length > 0;
                if (subTitle || subContent) {
                  if (subTitle) html += `<h5><strong>${subsection.title.trim()}</strong></h5>`;
                  if (subContent) html += renderContentWithParagraphs(subsection.content);
                }
              });
            }
          }
        });
      });
      
      return html;
    };
    
    // Get employer info from businessData or keyTerms
    const employerName = businessData?.business_name || businessData?.name || '[EMPLOYER NAME]';
    const employerAddress = businessData?.business_address || businessData?.address || '[EMPLOYER ADDRESS]';
    const employeeName = `${keyTerms.firstName || ''} ${keyTerms.lastName || ''}`.trim() || '[EMPLOYEE NAME]';
    const employeeAddress = keyTerms.employeeAddress || '[EMPLOYEE ADDRESS]';
    const employeePhone = keyTerms.employeePhone || '[EMPLOYEE PHONE]';
    
    // Calculate probation end date
    let probationEndDate = '';
    if (keyTerms.contractStartDate && keyTerms.probationaryPeriod) {
      // Parse date directly to avoid timezone issues
      let startDate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(keyTerms.contractStartDate)) {
        const [year, month, day] = keyTerms.contractStartDate.split('-').map(Number);
        startDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      } else {
        startDate = new Date(keyTerms.contractStartDate);
      }
      
      const endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + (keyTerms.probationaryPeriod || 90));
      
      // Format as YYYY-MM-DD in business timezone
      const year = endDate.getUTCFullYear();
      const month = String(endDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(endDate.getUTCDate()).padStart(2, '0');
      const endDateStr = `${year}-${month}-${day}`;
      probationEndDate = formatDateNumericForContract(endDateStr);
    }
    
    // Remove duplicates from selectedTerms by using a Set with term IDs
    // Also filter out subsections - only render parent sections (subsections are nested in placeholder_tags)
    const uniqueTerms = [];
    const seenIds = new Set();
    const seenTitles = new Set(); // Also check by title to catch duplicates without IDs
    
    (selectedTerms || []).forEach(term => {
      if (!term) return; // Skip null/undefined
      
      // Skip if this is a subsection (has parent_section_id or section_type === 'subsection')
      if (term.parent_section_id || term.section_type === 'subsection') {
        return; // Skip subsections - they're rendered as part of their parent section
      }
      
      // Create a unique key from ID or title
      const uniqueKey = term.id || term.title;
      if (!uniqueKey) return; // Skip if no ID or title
      
      // Check if we've seen this term before (by ID or by title)
      const isDuplicateById = term.id && seenIds.has(term.id);
      const isDuplicateByTitle = term.title && seenTitles.has(term.title.trim().toLowerCase());
      
      if (isDuplicateById || isDuplicateByTitle) {
        return; // Skip duplicates
      }
      
      // Mark as seen
      if (term.id) seenIds.add(term.id);
      if (term.title) seenTitles.add(term.title.trim().toLowerCase());
      
      uniqueTerms.push(term);
    });
    
    // Separate header section from other sections
    const headerSection = uniqueTerms.find(term => term.section_type === 'header');
    const otherTerms = uniqueTerms.filter(term => term.section_type !== 'header');
    
    // Debug logging
    console.log('[ReviewContractModal] Selected terms count:', selectedTerms?.length || 0);
    console.log('[ReviewContractModal] Unique terms count:', uniqueTerms.length);
    console.log('[ReviewContractModal] Other terms count:', otherTerms.length);
    console.log('[ReviewContractModal] Other terms:', otherTerms.map(t => ({ id: t.id, title: t.title })));
    
    // Helper function for day suffix (1st, 2nd, 3rd, etc.)
    const getDaySuffix = (day) => {
      if (day >= 11 && day <= 13) return 'th';
      switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
      }
    };
    
    // Number sections and subsections
    
    let sectionNumber = 2; // Start from 2 (Key Terms Summary is section 1)
    let subsectionNumber = 0;
    
    const renderTermWithNumbering = (term, index) => {
      // Skip numbering for header
      if (term.section_type === 'header') {
        let content = term.content || '';
        // Replace placeholders in header
        content = content.replace(/\[DATE\]/g, day.toString());
        content = content.replace(/\[MONTH\]/g, month);
        content = content.replace(/\[YEAR\]/g, year.toString());
        content = content.replace(/\[EMPLOYER NAME\]/g, employerName);
        content = content.replace(/\[EMPLOYER ADDRESS\]/g, employerAddress);
        content = content.replace(/\[EMPLOYEE NAME\]/g, employeeName);
        content = content.replace(/\[EMPLOYEE ADDRESS\]/g, employeeAddress);
        content = content.replace(/\[EMPLOYEE PHONE\]/g, employeePhone);
        
        return `<div>${content}</div>`;
      }
      
      // Number regular sections (skip Key Terms Summary since it's already numbered as 1)
      const titleWithoutNumber = (term.title || '').replace(/^\d+\.\s*/, '');
      const isKeyTerms = titleWithoutNumber.toLowerCase().includes('key terms summary') || 
                         titleWithoutNumber.toLowerCase().includes('employment contract – key terms');
      
      if (isKeyTerms) {
        // Don't number Key Terms Summary, it's already section 1
        let html = `<h3>1. EMPLOYMENT CONTRACT – KEY TERMS SUMMARY</h3>`;
        html += `<p>${term.content || ''}</p>`;
        return html;
      }
      
      // Number other sections starting from 2
      const currentSectionNumber = sectionNumber++;
      subsectionNumber = 0; // Reset subsection number for new section
      
      let html = '';
      
      // Only render if there's a title or content
      if (titleWithoutNumber || term.content) {
        html = `<div class="contract-section">`;
        if (titleWithoutNumber) {
          html += `<div class="contract-section-title">${currentSectionNumber}. ${titleWithoutNumber}</div>`;
        }
        if (term.content) {
          // Replace placeholders in content
          let content = term.content;
          content = content.replace(/\[EMPLOYER NAME\]/g, employerName);
          content = content.replace(/\[EMPLOYER ADDRESS\]/g, employerAddress);
          content = content.replace(/\[EMPLOYEE NAME\]/g, employeeName);
          content = content.replace(/\[EMPLOYEE ADDRESS\]/g, employeeAddress);
          content = content.replace(/\[EMPLOYEE PHONE\]/g, employeePhone);
          content = content.replace(/\[DATE\]/g, day.toString());
          content = content.replace(/\[MONTH\]/g, month);
          content = content.replace(/\[YEAR\]/g, year.toString());
          
          html += `<div class="contract-section-content">`;
          // Helper function to escape HTML entities
          const escapeHtml = (text) => {
            if (typeof text !== 'string') return '';
            return text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          };
          
          // Helper function to render content with paragraph breaks preserved
          const renderContentWithParagraphs = (contentText) => {
            if (!contentText || !contentText.trim()) return '';
            // Split by double newlines (empty lines) to preserve paragraph breaks
            const paragraphs = contentText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
            if (paragraphs.length === 0) return '';
            // If only one paragraph, return single <p> tag with escaped HTML
            if (paragraphs.length === 1) return `<p>${escapeHtml(paragraphs[0])}</p>`;
            // Multiple paragraphs - return each in its own <p> tag with escaped HTML
            return paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('');
          };
          html += renderContentWithParagraphs(content);
          html += `</div>`;
        }
        
        // Render subsections if they exist
        if (term.placeholder_tags && Array.isArray(term.placeholder_tags) && term.placeholder_tags.length > 0) {
          term.placeholder_tags.forEach((subsection) => {
            if (!subsection) return;
            subsectionNumber++;
            const subTitle = subsection.title || '';
            const subContent = subsection.content || '';
            // Remove any existing numbering from subsection title
            const cleanSubTitle = subTitle.replace(/^\d+\.\d+\.?\s*/, '');
            
            // Only render if there's content
            if (cleanSubTitle || subContent) {
              let subContentProcessed = subContent;
              subContentProcessed = subContentProcessed.replace(/\[EMPLOYER NAME\]/g, employerName);
              subContentProcessed = subContentProcessed.replace(/\[EMPLOYER ADDRESS\]/g, employerAddress);
              subContentProcessed = subContentProcessed.replace(/\[EMPLOYEE NAME\]/g, employeeName);
              subContentProcessed = subContentProcessed.replace(/\[EMPLOYEE ADDRESS\]/g, employeeAddress);
              subContentProcessed = subContentProcessed.replace(/\[EMPLOYEE PHONE\]/g, employeePhone);
              
              html += `<div class="contract-section-content" style="margin-left: 20px;">`;
              
              // Helper function to escape HTML entities
              const escapeHtml = (text) => {
                if (typeof text !== 'string') return '';
                return text
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;');
              };
              
              // Render subsection title if it exists
              if (cleanSubTitle) {
                html += `<p style="text-indent: -15px; padding-left: 15px; margin-bottom: 8px;"><strong>${currentSectionNumber}.${subsectionNumber}.</strong> ${escapeHtml(cleanSubTitle)}</p>`;
              }
              
              // Render subsection content with paragraph breaks preserved
              if (subContentProcessed && subContentProcessed.trim()) {
                const contentParagraphs = subContentProcessed.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
                if (contentParagraphs.length > 0) {
                  contentParagraphs.forEach((paragraph, paraIndex) => {
                    if (paraIndex === 0 && !cleanSubTitle) {
                      // First paragraph of subsection without title - add subsection number
                      html += `<p style="text-indent: -15px; padding-left: 15px; margin-bottom: 8px;"><strong>${currentSectionNumber}.${subsectionNumber}.</strong> ${escapeHtml(paragraph)}</p>`;
                    } else {
                      // Subsequent paragraphs or paragraphs after a title
                      html += `<p style="margin-left: 20px; padding-left: 15px; margin-bottom: 8px;">${escapeHtml(paragraph)}</p>`;
                    }
                  });
                }
              }
              
              html += `</div>`;
            }
          });
        }
        
        html += `</div>`;
      }
      
      return html;
    };
    
    // Format employment type for title (combine type + status)
    const getEmploymentTypeTitle = (type, status) => {
      // Use provided values or fallback to keyTerms if not provided
      const employmentType = type || keyTerms?.employmentType || keyTerms?.contract_type || 'permanent';
      const employmentStatus = status || keyTerms?.employmentStatus || keyTerms?.employment_status || 'full-time';
      
      const typeMap = {
        'permanent': 'PERMANENT',
        'seasonal': 'SEASONAL',
        'temporary-contract': 'TEMPORARY CONTRACT',
        'temporary': 'TEMPORARY'
      };
      const statusMap = {
        'full-time': 'FULL TIME',
        'part-time': 'PART TIME',
        'fulltime': 'FULL TIME',
        'parttime': 'PART TIME'
      };
      
      const normalizedType = employmentType?.toLowerCase()?.trim();
      const normalizedStatus = employmentStatus?.toLowerCase()?.trim();
      
      const typeDisplay = typeMap[normalizedType] || (normalizedType ? normalizedType.toUpperCase() : 'PERMANENT');
      const statusDisplay = statusMap[normalizedStatus] || (normalizedStatus ? normalizedStatus.toUpperCase() : 'FULL TIME');
      
      if (typeDisplay && statusDisplay) {
        return `${typeDisplay} ${statusDisplay}`;
      }
      return typeDisplay || statusDisplay || 'PERMANENT FULL TIME';
    };
    
    // Format employment type for display (combine when needed)
    const getEmploymentTypeDisplay = (type, status) => {
      // Use provided values or fallback to keyTerms if not provided
      const employmentType = type || keyTerms?.employmentType || keyTerms?.contract_type || 'permanent';
      const employmentStatus = status || keyTerms?.employmentStatus || keyTerms?.employment_status || 'full-time';
      
      const typeMap = {
        'permanent': 'Permanent',
        'seasonal': 'Seasonal',
        'temporary-contract': 'Temporary Contract',
        'temporary': 'Temporary'
      };
      const statusMap = {
        'full-time': 'Full Time',
        'part-time': 'Part Time',
        'fulltime': 'Full Time',
        'parttime': 'Part Time'
      };
      
      const normalizedType = employmentType?.toLowerCase()?.trim();
      const normalizedStatus = employmentStatus?.toLowerCase()?.trim();
      
      const typeDisplay = typeMap[normalizedType] || (normalizedType ? normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1) : 'Permanent');
      const statusDisplay = statusMap[normalizedStatus] || (normalizedStatus ? normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1).replace('-', ' ') : 'Full Time');
      
      if (typeDisplay && statusDisplay) {
        return `${typeDisplay}, ${statusDisplay}`;
      }
      return typeDisplay || statusDisplay || 'Permanent, Full Time';
    };
    
    // Format wage with minimum wage clause
    const formatWage = (wage) => {
      const wageNum = parseFloat(wage) || 0;
      return `$${wageNum.toFixed(2)} per hour or current Ontario minimum wage, whichever is greater`;
    };
    
    // Format vacation pay
    const formatVacationPay = (rate) => {
      return `${rate || '4'}% (paid weekly)`;
    };
    
    return `
      <style>
        body { font-family: Arial, sans-serif; padding: 8px; line-height: 1.4; font-size: 8px; margin: 0; }
        .contract-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 10px;
        }
        .contract-logo {
          font-size: 8px;
        }
        .contract-page-number {
          text-align: right;
          font-size: 6px;
          color: #666;
        }
        .contract-title {
          text-align: center;
          margin: 10px 0;
        }
        .contract-title-main {
          font-size: 13px;
          font-weight: bold;
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .contract-title-sub {
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .contract-intro {
          margin-bottom: 10px;
          text-align: center;
        }
        .contract-intro p {
          margin: 5px 0;
          line-height: 1.4;
        }
        .contract-intro .party-name {
          font-weight: bold;
        }
        .contract-intro .party-label {
          font-style: italic;
        }
        .contract-section {
          margin: 8px 0;
        }
        .contract-section-title {
          font-weight: bold;
          font-size: 8px;
          margin-bottom: 5px;
        }
        .contract-section-content {
          line-height: 1.4;
          margin-bottom: 8px;
        }
        .key-terms-summary {
          margin: 10px 0;
        }
        .key-terms-summary-title {
          font-weight: bold;
          font-size: 8px;
          margin-bottom: 8px;
        }
        .key-terms-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 15px;
        }
        .key-terms-row {
          margin: 4px 0;
          line-height: 1.4;
        }
        .key-terms-label {
          font-weight: bold;
          display: inline;
        }
        .key-terms-value {
          margin-left: 5px;
        }
        h2 {
          font-size: 9px;
          font-weight: bold;
          margin: 8px 0 5px 0;
        }
        h3 {
          font-size: 9px;
          font-weight: bold;
          margin: 6px 0 4px 0;
        }
        h4 {
          font-size: 8px;
          font-weight: bold;
          margin: 5px 0 3px 0;
        }
        p {
          margin: 4px 0;
          line-height: 1.4;
        }
      </style>
      
      <div class="contract-header">
        <div class="contract-logo"></div>
        <div class="contract-page-number">Page | 1</div>
      </div>
      
      <div class="contract-title">
        <div class="contract-title-main">EMPLOYMENT CONTRACT</div>
        <div class="contract-title-sub">${getEmploymentTypeTitle(keyTerms.employmentType, keyTerms.employmentStatus)}</div>
      </div>
      
      <div class="contract-intro">
        ${contractPreamble ? contractPreamble.split('\n').map(line => {
          const trimmed = line.trim();
          if (trimmed === '') return '<p>&nbsp;</p>';
          
          // Handle party labels
          if (trimmed === '(the "Employer")' || trimmed === '(the "Employee")') {
            return `<p class="party-label">${trimmed}</p>`;
          }
          
          // Handle section titles
          if (trimmed === 'BACKGROUND:' || trimmed === 'IN CONSIDERATION OF') {
            return `<div class="contract-section-title">${trimmed}</div>`;
          }
          
          // Handle paragraphs that start with "The employer" or "The Employer"
          if (trimmed.startsWith('The employer') || trimmed.startsWith('The Employer')) {
            return `<div class="contract-section-content"><p>${trimmed}</p></div>`;
          }
          
          // Handle "IN CONSIDERATION OF" paragraph
          if (trimmed.startsWith('IN CONSIDERATION OF')) {
            return `<div class="contract-section-content"><p>${trimmed}</p></div>`;
          }
          
          // Handle party names with addresses (format: "Name of Address")
          if (trimmed.includes(' of ') && (trimmed.includes(employerName) || trimmed.includes(employeeName) || trimmed.includes('[EMPLOYER NAME]') || trimmed.includes('[EMPLOYEE NAME]'))) {
            const nameMatch = trimmed.match(/(.+?)\s+of\s+(.+)/);
            if (nameMatch) {
              return `<p><span class="party-name">${nameMatch[1].trim()}</span> of ${nameMatch[2].trim()}</p>`;
            }
          }
          
          // Handle date line
          if (trimmed.includes('dated this') || trimmed.includes('THIS EMPLOYMENT CONTRACT')) {
            return `<p>${trimmed}</p>`;
          }
          
          // Default: regular paragraph
          return `<p>${trimmed}</p>`;
        }).join('') : `
        <p>THIS EMPLOYMENT CONTRACT (the "Agreement") dated this ${day}${getDaySuffix(day)} day of ${month}, ${year}</p>
        <p><span class="party-name">${employerName}</span> of ${employerAddress}</p>
        <p class="party-label">(the "Employer")</p>
        <p><span class="party-name">${employeeName}</span> of ${employeeAddress}</p>
        <p>Phone: ${employeePhone}</p>
        <p class="party-label">(the "Employee")</p>
        <div class="contract-section-title">BACKGROUND:</div>
        <div class="contract-section-content">
          <p>The employer is of the opinion that the Employee has the necessary qualifications, experience and abilities to assist and benefit the Employer in its business.</p>
          <p>The Employer desires to employ the Employee and the Employee has agreed to accept and enter such employment upon the terms and conditions set out in this Agreement.</p>
        </div>
        <div class="contract-section-title">IN CONSIDERATION OF</div>
        <div class="contract-section-content">
          <p>IN CONSIDERATION OF the matters described above and of the mutual benefits and obligations set forth in this Agreement, the receipt and sufficiency of which consideration is hereby acknowledged, the parties to this Agreement agree as follows:</p>
        </div>
        `}
      </div>
      
      <div class="key-terms-summary">
        <div class="key-terms-summary-title">1. EMPLOYMENT CONTRACT – KEY TERMS SUMMARY</div>
        <div class="key-terms-container">
          <div class="key-terms-column">
            <div class="key-terms-row">
              <span class="key-terms-label">Employee Name:</span>
              <span class="key-terms-value">${keyTerms.firstName || ''} ${keyTerms.lastName || ''}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Position:</span>
              <span class="key-terms-value">${keyTerms.positionTitle || '[POSITION]'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employment Type:</span>
              <span class="key-terms-value">${getEmploymentTypeDisplay(keyTerms.employmentType, keyTerms.employmentStatus)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Contract Start Date:</span>
              <span class="key-terms-value">${formatDateNumericForContract(keyTerms.contractStartDate)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Contract End Date:</span>
              <span class="key-terms-value">${keyTerms.contractEndDate ? formatDateNumericForContract(keyTerms.contractEndDate) : 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Probationary Period:</span>
              <span class="key-terms-value">${keyTerms.probationaryPeriod || 90} days (Ends ${probationEndDate || 'N/A'})</span>
            </div>
          </div>
          <div class="key-terms-column">
            <div class="key-terms-row">
              <span class="key-terms-label">Base Hourly Wage:</span>
              <span class="key-terms-value">${formatWage(keyTerms.baseHourlyWage)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Vacation Pay Rate:</span>
              <span class="key-terms-value">${formatVacationPay(keyTerms.vacationPayRate)}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Primary Work Location:</span>
              <span class="key-terms-value">${keyTerms.primaryWorkLocation || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employer Contact Email:</span>
              <span class="key-terms-value">${keyTerms.employerContactEmail || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Manager:</span>
              <span class="key-terms-value">${keyTerms.managerName || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employee Phone:</span>
              <span class="key-terms-value">${keyTerms.employeePhone || 'N/A'}</span>
            </div>
            <div class="key-terms-row">
              <span class="key-terms-label">Employee Email:</span>
              <span class="key-terms-value">${keyTerms.employeeEmail || 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>
      
      ${renderSpecialConsiderations(specialConsiderations)}
      
      ${otherTerms.length > 0 ? `
      <h2>Contract Terms</h2>
      ${otherTerms
        .filter(term => {
          const titleLower = (term.title || '').toLowerCase();
          return !titleLower.includes('key terms summary') && 
                 !titleLower.includes('employment contract – key terms') &&
                 term.section_type !== 'header';
        })
        .map((term, index) => renderTermWithNumbering(term, index))
        .join('')}
      ` : `
      <div class="contract-section">
        <div class="contract-section-content">
          <p><em>No contract terms have been selected. Please go back and select terms from the template.</em></p>
        </div>
      </div>
      `}
      
      <div class="contract-section" style="margin-top: 20px;">
        <div class="contract-section-content" style="text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 15px;">
          IN WITNESS WHEREOF
        </div>
        <div class="contract-section-content" style="margin-bottom: 15px;">
          <p>The parties have duly affixed their signatures as of the date indicated below, and acknowledge agreement to the terms, including those summarized in the Key Terms Summary at the beginning of this Agreement.</p>
        </div>
        
        <div style="margin-top: 40px; page-break-inside: avoid;">
          <div style="margin-bottom: 40px;">
            <p style="margin-bottom: 8px; font-weight: bold;"><strong>For the Employer</strong></p>
            <p style="margin-bottom: 8px;">${businessData?.business_name || businessData?.name || '[EMPLOYER NAME]'}</p>
            <p style="margin-bottom: 20px;">By its authorized representative:</p>
            <div style="margin-top: 0;">
              <p style="margin-bottom: 4px; font-size: 8px;">Authorized Representative</p>
              <div style="border-bottom: 1px solid #000; height: 50px; margin-bottom: 20px; min-width: 200px;"></div>
            </div>
            <div style="margin-top: 0;">
              <p style="margin-bottom: 4px; font-size: 8px;">Date:</p>
              <div style="border-bottom: 1px solid #000; height: 50px; min-width: 200px;"></div>
            </div>
          </div>
          
          <div style="margin-top: 40px;">
            <p style="margin-bottom: 8px; font-weight: bold;"><strong>For the Employee:</strong></p>
            <div style="margin-top: 0;">
              <p style="margin-bottom: 4px; font-size: 8px;">Employee Signature:</p>
              <div style="border-bottom: 1px solid #000; height: 50px; margin-bottom: 20px; min-width: 200px;"></div>
            </div>
            <div style="margin-top: 0;">
              <p style="margin-bottom: 4px; font-size: 8px;">Date:</p>
              <div style="border-bottom: 1px solid #000; height: 50px; min-width: 200px;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  };
  
  const handleSaveDraft = async () => {
    console.log('[ReviewContractModal] Save Contract button clicked');
    console.log('[ReviewContractModal] onSaveDraft prop:', typeof onSaveDraft);
    console.log('[ReviewContractModal] contractData:', contractData);
    console.log('[ReviewContractModal] saving state:', saving);
    
    if (saving) {
      console.log('[ReviewContractModal] Already saving, ignoring click');
      return;
    }
    
    if (!onSaveDraft) {
      console.error('[ReviewContractModal] onSaveDraft is not provided!');
      toast.error('Save function not available');
      return;
    }
    
    setSaving(true);
    try {
      console.log('[ReviewContractModal] Calling onSaveDraft...');
      await onSaveDraft(contractData);
      console.log('[ReviewContractModal] onSaveDraft completed successfully');
      // Close modal after successful save
      onClose();
    } catch (error) {
      console.error('[ReviewContractModal] Error in handleSaveDraft:', error);
      toast.error('Failed to save contract: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenSend = () => {
    if (onOpenSendModal) {
      onOpenSendModal();
    }
  };

  if (!isOpen) return null;

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.largeModal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>{title || 'Step 4: Review Contract'}</h2>
          <button onClick={onClose} style={modalStyles.closeButton}>
            <X size={24} />
          </button>
        </div>
        <div style={modalStyles.body}>
          <div style={modalStyles.reviewContent} dangerouslySetInnerHTML={{ __html: generateContractPreview() }} />
        </div>
        <div style={modalStyles.footer}>
          <button onClick={onClose} style={modalStyles.cancelButton}>Back</button>
          <button 
            onClick={handleSaveDraft} 
            disabled={saving}
            style={{ 
              ...modalStyles.saveButton, 
              marginRight: '8px',
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            <Save size={18} style={{ marginRight: '8px' }} />
            {saving ? 'Saving...' : 'Save Contract'}
          </button>
          <button onClick={handleOpenSend} style={modalStyles.sendButton}>
            <Send size={18} style={{ marginRight: '8px' }} />
            Send Contract
          </button>
        </div>
      </div>
    </div>
  );
};

// MODAL STYLES
const modalStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  largeModal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '900px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    borderBottom: '2px solid #e5e7eb',
    backgroundColor: '#f8f9fa'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px'
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px'
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '2px solid #e5e7eb',
    backgroundColor: '#f8f9fa'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '20px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  input: {
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px'
  },
  hint: {
    fontSize: '13px',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  filterGroup: {
    marginBottom: '20px'
  },
  termsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  termItem: {
    padding: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px'
  },
  requiredBadge: {
    padding: '4px 8px',
    backgroundColor: '#fef3c7',
    color: '#d97706',
    fontSize: '11px',
    fontWeight: 'bold',
    borderRadius: '4px'
  },
  termPreview: {
    fontSize: '13px',
    color: '#6b7280',
    marginTop: '8px'
  },
  reviewContent: {
    padding: '10px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
    maxWidth: '100%'
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280'
  },
  cancelButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600'
  },
  saveButton: {
    padding: '12px 24px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600'
  },
  sendButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 24px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600'
  },
  contractList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  contractItem: {
    padding: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  contractName: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '4px'
  },
  contractDate: {
    fontSize: '14px',
    color: '#6b7280'
  },
  considerationItem: {
    padding: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  clauseTextarea: {
    width: '100%',
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical'
  }
};


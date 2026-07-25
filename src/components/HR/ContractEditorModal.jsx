// components/HR/ContractEditorModal.jsx - Contract Editor with Section Builder & Print
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Edit2, Save, Printer, FileText, AlertCircle, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

const ContractEditorModal = ({ isOpen, onClose, contract, employee, businessId, businessData, onContractSaved }) => {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState(null);
  const [contractRecord, setContractRecord] = useState(null);

  // Default contract sections template
  const defaultSections = [
    {
      id: 'header',
      title: 'Employment Agreement',
      content: `This Employment Agreement ("Agreement") is entered into on ${new Date().toLocaleDateString()} between ${businessData?.business_name || '[Business Name]'} ("Employer") and ${employee?.first_name} ${employee?.last_name} ("Employee").`,
      section_order: 1,
      is_required: true,
      section_type: 'header'
    },
    {
      id: 'position',
      title: '1. Position and Duties',
      content: `The Employee is hired for the position of ${employee?.position || '[Position]'}. The Employee agrees to perform all duties assigned by the Employer and to devote their full business time and attention to the business of the Employer.`,
      section_order: 2,
      is_required: true,
      section_type: 'standard'
    },
    {
      id: 'compensation',
      title: '2. Compensation',
      content: `The Employee shall receive compensation at a rate of $${employee?.wage || '[Wage]'} per hour. Payment will be made on a bi-weekly basis in accordance with the Employer's standard payroll schedule.`,
      section_order: 3,
      is_required: true,
      section_type: 'standard'
    },
    {
      id: 'hours',
      title: '3. Hours of Work',
      content: `The Employee's normal hours of work shall be as scheduled by the Employer. The Employee may be required to work additional hours as reasonably necessary to fulfill their duties.`,
      section_order: 4,
      is_required: false,
      section_type: 'standard'
    },
    {
      id: 'benefits',
      title: '4. Benefits',
      content: `The Employee shall be entitled to benefits as outlined in the Employee Handbook, including but not limited to vacation time, sick leave, and statutory holidays in accordance with applicable employment standards legislation.`,
      section_order: 5,
      is_required: false,
      section_type: 'standard'
    },
    {
      id: 'termination',
      title: '5. Termination',
      content: `Either party may terminate this Agreement by providing written notice in accordance with applicable employment standards legislation. The Employer reserves the right to terminate the Employee's employment for just cause without notice or pay in lieu of notice.`,
      section_order: 6,
      is_required: true,
      section_type: 'standard'
    },
    {
      id: 'confidentiality',
      title: '6. Confidentiality',
      content: `The Employee agrees to maintain confidentiality of all proprietary information, trade secrets, and confidential business information of the Employer both during and after employment.`,
      section_order: 7,
      is_required: true,
      section_type: 'standard'
    },
    {
      id: 'signatures',
      title: 'Signatures',
      content: `By signing below, both parties acknowledge that they have read, understood, and agree to be bound by the terms of this Agreement.\n\n_________________________\nEmployer Signature\nDate: __________\n\n_________________________\nEmployee Signature\nDate: __________`,
      section_order: 8,
      is_required: true,
      section_type: 'signature'
    }
  ];

  useEffect(() => {
    if (isOpen && employee) {
      loadContractData();
    }
  }, [isOpen, employee]);

  const loadContractData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load or create contract record
      let { data: contractData, error: contractError } = await supabase
        .from('hr_contracts')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('business_id', businessId)
        .single();

      if (contractError && contractError.code !== 'PGRST116') {
        throw contractError;
      }

      // Create contract if doesn't exist
      if (!contractData) {
        const { data: newContract, error: createError } = await supabase
          .from('hr_contracts')
          .insert({
            employee_id: employee.id,
            business_id: businessId,
            contract_type: 'employment',
            status: 'draft',
            start_date: employee.hire_date || new Date().toISOString().split('T')[0],
            wage_amount: employee.wage,
            wage_type: 'hourly'
          })
          .select()
          .single();

        if (createError) throw createError;
        contractData = newContract;
      }

      setContractRecord(contractData);

      // Load contract sections
      const { data: sectionsData, error: sectionsError } = await supabase
        .from('contract_sections')
        .select('*')
        .eq('contract_id', contractData.id)
        .order('section_order', { ascending: true });

      if (sectionsError) throw sectionsError;

      // Use default template if no sections exist
      if (!sectionsData || sectionsData.length === 0) {
        setSections(defaultSections);
      } else {
        setSections(sectionsData);
      }

    } catch (error) {
      console.error('Error loading contract data:', error);
      setError('Failed to load contract. Using default template.');
      setSections(defaultSections);
    } finally {
      setLoading(false);
    }
  };

  const handleAddSection = () => {
    const newSection = {
      id: `temp_${Date.now()}`,
      title: 'New Section',
      content: 'Enter section content here...',
      section_order: sections.length + 1,
      is_required: false,
      section_type: 'standard'
    };

    setSections([...sections, newSection]);
    setEditMode(true);
  };

  const handleUpdateSection = (sectionId, field, value) => {
    setSections(sections.map(section =>
      section.id === sectionId ? { ...section, [field]: value } : section
    ));
  };

  const handleDeleteSection = (sectionId) => {
    const section = sections.find(s => s.id === sectionId);
    
    if (section.is_required) {
      toast.error('Cannot delete required sections');
      return;
    }

    if (confirm('Are you sure you want to delete this section?')) {
      setSections(sections.filter(s => s.id !== sectionId));
    }
  };

  const handleMoveSection = (sectionId, direction) => {
    const index = sections.findIndex(s => s.id === sectionId);
    if (index === -1) return;

    const newSections = [...sections];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= sections.length) return;

    [newSections[index], newSections[targetIndex]] = [newSections[targetIndex], newSections[index]];

    newSections.forEach((section, idx) => {
      section.section_order = idx + 1;
    });

    setSections(newSections);
  };

  const handleSaveContract = async () => {
    if (!contractRecord) {
      toast.error('Contract record not found');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Delete existing sections
      const { error: deleteError } = await supabase
        .from('contract_sections')
        .delete()
        .eq('contract_id', contractRecord.id);

      if (deleteError) throw deleteError;

      // Insert updated sections
      const sectionsToInsert = sections.map(section => ({
        contract_id: contractRecord.id,
        title: section.title,
        content: section.content,
        section_order: section.section_order,
        is_required: section.is_required,
        section_type: section.section_type
      }));

      const { error: insertError } = await supabase
        .from('contract_sections')
        .insert(sectionsToInsert);

      if (insertError) throw insertError;

      toast.success('Contract saved successfully');
      setEditMode(false);

      if (onContractSaved) {
        onContractSaved(contractRecord.id);
      }

    } catch (error) {
      console.error('Error saving contract:', error);
      toast.error('Failed to save contract');
      setError('Failed to save contract. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrintContract = () => {
    const printWindow = window.open('', '_blank');
    const printContent = generatePrintableHTML();
    
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  const generatePrintableHTML = () => {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Employment Agreement - ${employee.first_name} ${employee.last_name}</title>
          <style>
            @page {
              size: letter;
              margin: 1in;
            }
            
            body {
              font-family: 'Times New Roman', Times, serif;
              font-size: 12pt;
              line-height: 1.6;
              color: #000;
              max-width: 8.5in;
              margin: 0 auto;
            }
            
            .contract-header {
              text-align: center;
              margin-bottom: 40px;
              border-bottom: 2px solid #000;
              padding-bottom: 20px;
            }
            
            .contract-title {
              font-size: 18pt;
              font-weight: bold;
              margin-bottom: 10px;
            }
            
            .contract-meta {
              font-size: 10pt;
              color: #666;
            }
            
            .section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            
            .section-title {
              font-size: 14pt;
              font-weight: bold;
              margin-bottom: 10px;
              color: #000;
            }
            
            .section-content {
              text-align: justify;
              white-space: pre-wrap;
              line-height: 1.8;
            }
            
            .signature-section {
              margin-top: 60px;
              page-break-inside: avoid;
            }
            
            .business-info {
              margin-top: 40px;
              padding-top: 20px;
              border-top: 1px solid #ccc;
              font-size: 10pt;
              color: #666;
              text-align: center;
            }
            
            @media print {
              body { margin: 0; }
              .no-print { display: none !important; }
            }
          </style>
        </head>
        <body>
          <div class="contract-header">
            <div class="contract-title">Employment Agreement</div>
            <div class="contract-meta">
              ${businessData?.business_name || 'Business Name'}<br/>
              Effective Date: ${contractRecord?.start_date ? new Date(contractRecord.start_date).toLocaleDateString() : 'N/A'}<br/>
              Employee: ${employee.first_name} ${employee.last_name}<br/>
              Position: ${employee.position || 'N/A'}
            </div>
          </div>
          
          ${sections.map(section => `
            <div class="section ${section.section_type === 'signature' ? 'signature-section' : ''}">
              <div class="section-title">${section.title}</div>
              <div class="section-content">${section.content}</div>
            </div>
          `).join('')}
          
          <div class="business-info">
            ${businessData?.business_name || 'Business Name'}<br/>
            ${businessData?.business_address || ''}<br/>
            Document generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
          </div>
          
          <div class="no-print" style="position: fixed; top: 20px; right: 20px;">
            <button onclick="window.print()" style="padding: 10px 20px; background-color: #008080; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
              Print Document
            </button>
            <button onclick="window.close()" style="padding: 10px 20px; background-color: #666; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin-left: 10px;">
              Close
            </button>
          </div>
        </body>
      </html>
    `;
  };

  if (!isOpen) return null;
  
  if (!employee) return null;

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>
              <FileText size={24} style={{ marginRight: '8px' }} />
              {editMode ? 'Edit Contract' : 'View Contract'}
            </h2>
            <p style={styles.modalSubtitle}>
              {employee?.first_name || 'Employee'} {employee?.last_name || ''} - Employment Agreement
            </p>
          </div>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        {error && (
          <div style={styles.errorBanner}>
            <AlertCircle size={20} style={{ marginRight: '8px' }} />
            {error}
          </div>
        )}

        {loading ? (
          <div style={styles.loadingContainer}>
            <div style={styles.spinner}></div>
            <p>Loading contract...</p>
          </div>
        ) : (
          <>
            <div style={styles.toolbar}>
              <div style={styles.toolbarLeft}>
                <button
                  onClick={() => setEditMode(!editMode)}
                  style={{
                    ...styles.toolbarButton,
                    backgroundColor: editMode ? '#f59e0b' : '#008080'
                  }}
                >
                  {editMode ? (
                    <>
                      <Eye size={18} style={{ marginRight: '6px' }} />
                      View Mode
                    </>
                  ) : (
                    <>
                      <Edit2 size={18} style={{ marginRight: '6px' }} />
                      Edit Mode
                    </>
                  )}
                </button>

                {editMode && (
                  <button onClick={handleAddSection} style={styles.toolbarButton}>
                    <Plus size={18} style={{ marginRight: '6px' }} />
                    Add Section
                  </button>
                )}
              </div>

              <div style={styles.toolbarRight}>
                <button onClick={handlePrintContract} style={styles.toolbarButton}>
                  <Printer size={18} style={{ marginRight: '6px' }} />
                  Print
                </button>
              </div>
            </div>

            <div style={styles.modalBody}>
              <div style={styles.sectionsContainer}>
                {sections.map((section, index) => (
                  <div key={section.id} style={styles.sectionCard}>
                    <div style={styles.sectionHeader}>
                      <div style={styles.sectionHeaderLeft}>
                        {editMode ? (
                          <input
                            type="text"
                            value={section.title}
                            onChange={(e) => handleUpdateSection(section.id, 'title', e.target.value)}
                            style={styles.sectionTitleInput}
                          />
                        ) : (
                          <h3 style={styles.sectionTitle}>{section.title}</h3>
                        )}
                      </div>

                      {editMode && (
                        <div style={styles.sectionActions}>
                          <button
                            onClick={() => handleMoveSection(section.id, 'up')}
                            disabled={index === 0}
                            style={{
                              ...styles.iconButton,
                              opacity: index === 0 ? 0.3 : 1
                            }}
                            title="Move Up"
                          >
                            <ChevronUp size={18} />
                          </button>

                          <button
                            onClick={() => handleMoveSection(section.id, 'down')}
                            disabled={index === sections.length - 1}
                            style={{
                              ...styles.iconButton,
                              opacity: index === sections.length - 1 ? 0.3 : 1
                            }}
                            title="Move Down"
                          >
                            <ChevronDown size={18} />
                          </button>

                          {!section.is_required && (
                            <button
                              onClick={() => handleDeleteSection(section.id)}
                              style={styles.deleteIconButton}
                              title="Delete Section"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={styles.sectionContent}>
                      {editMode ? (
                        <textarea
                          value={section.content}
                          onChange={(e) => handleUpdateSection(section.id, 'content', e.target.value)}
                          style={styles.sectionTextarea}
                          rows={6}
                        />
                      ) : (
                        <div style={styles.sectionText}>
                          {section.content}
                        </div>
                      )}
                    </div>

                    {section.is_required && (
                      <div style={styles.requiredBadge}>
                        Required Section
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button onClick={onClose} style={styles.cancelButton}>
                Cancel
              </button>

              {editMode && (
                <button
                  onClick={handleSaveContract}
                  disabled={saving}
                  style={{
                    ...styles.saveButton,
                    opacity: saving ? 0.6 : 1
                  }}
                >
                  {saving ? (
                    <>
                      <div style={styles.smallSpinner}></div>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={18} style={{ marginRight: '6px' }} />
                      Save Contract
                    </>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
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
    maxWidth: '1000px',
    width: '100%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '24px',
    borderBottom: '2px solid #e5e7eb',
    backgroundColor: '#f8f9fa'
  },
  modalTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0,
    display: 'flex',
    alignItems: 'center'
  },
  modalSubtitle: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '6px 0 0 0'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center'
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    padding: '15px 24px',
    fontSize: '14px'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    gap: '16px'
  },
  spinner: {
    width: '40px',
    height: '40px',
    borderWidth: '4px',
    borderStyle: 'solid',
    borderColor: '#e5e7eb',
    borderTopColor: '#008080',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  smallSpinner: {
    width: '16px',
    height: '16px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: '#fff',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginRight: '8px'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    backgroundColor: '#f8f9fa',
    borderBottom: '1px solid #e5e7eb'
  },
  toolbarLeft: {
    display: 'flex',
    gap: '12px'
  },
  toolbarRight: {
    display: 'flex',
    gap: '12px'
  },
  toolbarButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  modalBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px'
  },
  sectionsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  sectionCard: {
    backgroundColor: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
    position: 'relative'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  sectionHeaderLeft: {
    flex: 1
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  sectionTitleInput: {
    fontSize: '18px',
    fontWeight: 'bold',
    padding: '8px',
    border: '2px solid #008080',
    borderRadius: '4px',
    width: '100%',
    fontFamily: 'inherit'
  },
  sectionActions: {
    display: 'flex',
    gap: '8px'
  },
  iconButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#374151'
  },
  deleteIconButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#dc2626'
  },
  sectionContent: {
    marginTop: '12px'
  },
  sectionText: {
    fontSize: '14px',
    lineHeight: '1.8',
    color: '#374151',
    whiteSpace: 'pre-wrap',
    fontFamily: '"Times New Roman", Times, serif'
  },
  sectionTextarea: {
    width: '100%',
    padding: '12px',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    lineHeight: '1.8',
    resize: 'vertical',
    fontFamily: '"Times New Roman", Times, serif',
    boxSizing: 'border-box'
  },
  requiredBadge: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    padding: '4px 8px',
    backgroundColor: '#fef3c7',
    color: '#d97706',
    fontSize: '11px',
    fontWeight: 'bold',
    borderRadius: '4px',
    textTransform: 'uppercase'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '20px 24px',
    borderTop: '2px solid #e5e7eb',
    backgroundColor: '#f8f9fa'
  },
  cancelButton: {
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 24px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default ContractEditorModal;
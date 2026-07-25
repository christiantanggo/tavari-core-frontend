// components/HR/TerminationTemplatesModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Save, Plus, Trash2, Edit2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';

const TerminationTemplatesModal = ({ 
  isOpen, 
  onClose, 
  businessId, 
  authUser 
}) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [formData, setFormData] = useState({
    template_name: '',
    description: '',
    termination_type: 'all',
    template_content: ''
  });

  useEffect(() => {
    if (isOpen && businessId) {
      loadTemplates();
    }
  }, [isOpen, businessId]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('hr_termination_templates')
        .select('*')
        .eq('business_id', businessId)
        .order('template_name', { ascending: true });

      if (error) {
        if (error.code === '42P01' || error.message.includes('does not exist')) {
          console.warn('hr_termination_templates table does not exist yet');
          setTemplates([]);
          return;
        }
        throw error;
      }

      setTemplates(data || []);
    } catch (error) {
      console.error('Error loading templates:', error);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = (templateType = 'standard') => {
    setEditingTemplate(null);
    setFormData({
      template_name: '',
      description: '',
      termination_type: templateType === 'probationary' ? 'without_cause' : 'all',
      template_content: getDefaultTemplate(templateType)
    });
    setShowEditor(true);
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      template_name: template.template_name,
      description: template.description || '',
      termination_type: template.termination_type || 'all',
      template_content: template.template_content
    });
    setShowEditor(true);
  };

  const handleDelete = async (templateId) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      const { error } = await supabase
        .from('hr_termination_templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;

      toast.success('Template deleted successfully');
      loadTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    }
  };

  const handleSave = async () => {
    if (!formData.template_name.trim()) {
      toast.error('Template name is required');
      return;
    }

    if (!formData.template_content.trim()) {
      toast.error('Template content is required');
      return;
    }

    setSaving(true);
    try {
      if (editingTemplate) {
        // Update existing
        const { error } = await supabase
          .from('hr_termination_templates')
          .update({
            template_name: formData.template_name,
            description: formData.description,
            termination_type: formData.termination_type,
            template_content: formData.template_content,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingTemplate.id);

        if (error) throw error;
        toast.success('Template updated successfully');
      } else {
        // Create new
        const { error } = await supabase
          .from('hr_termination_templates')
          .insert({
            business_id: businessId,
            template_name: formData.template_name,
            description: formData.description,
            termination_type: formData.termination_type,
            template_content: formData.template_content,
            is_active: true,
            created_by: authUser?.id
          });

        if (error) throw error;
        toast.success('Template created successfully');
      }

      setShowEditor(false);
      loadTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const getDefaultTemplate = (type = 'standard') => {
    if (type === 'probationary') {
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: "Times New Roman", serif;
      line-height: 1.6;
      color: #000;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
    }
    .header {
      text-align: center;
      font-weight: bold;
      font-size: 14px;
      text-transform: uppercase;
      margin-bottom: 30px;
      letter-spacing: 0.5px;
    }
    .company-info {
      margin-bottom: 20px;
    }
    .date {
      margin-bottom: 20px;
    }
    .recipient-info {
      margin-bottom: 20px;
    }
    .salutation {
      margin-bottom: 15px;
    }
    .subject {
      font-weight: bold;
      margin-bottom: 15px;
    }
    .body-content {
      margin-bottom: 20px;
    }
    .section-heading {
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    ul {
      margin: 10px 0;
      padding-left: 20px;
    }
    li {
      margin: 5px 0;
    }
    .closing {
      margin-top: 30px;
    }
    .signature {
      margin-top: 40px;
    }
  </style>
</head>
<body>
  <div class="header">TERMINATION NOTICE – PROBATIONARY PERIOD (NO NOTICE REQUIRED)</div>
  
  <div class="company-info">
    <strong>{{BusinessName}}</strong><br>
    {{BusinessAddress}}
  </div>
  
  <div class="date">
    <strong>Date:</strong> {{TerminationDate}}
  </div>
  
  <div class="recipient-info">
    <strong>To:</strong> {{EmployeeFullName}}<br>
    <strong>Address:</strong> {{EmployeeAddress}}<br>
    <strong>Email:</strong> {{EmployeeEmail}}
  </div>
  
  <div class="salutation">
    Dear {{EmployeeFirstName}},
  </div>
  
  <div class="subject">
    Subject: Termination of Employment – Probationary Period
  </div>
  
  <div class="body-content">
    <p>This letter is to inform you that your employment with {{THE BUSINESS}} is terminated effective immediately.</p>
    
    <p>Your employment was still within the probationary period, during which both Ontario's Employment Standards Act, 2000 ("ESA") and your employment agreement permit termination without notice or pay in lieu of notice, except for wages and entitlements earned up to your final day of work.</p>
    
    <div class="section-heading">Final Compensation and Statutory Entitlements</div>
    
    <p>In accordance with the ESA, you will receive:</p>
    <ul>
      <li><strong>Final Wages:</strong> Payment for all hours worked up to and including your final shift.</li>
      <li><strong>Vacation Pay:</strong> As vacation pay is paid with each pay period, no additional vacation pay is owing.</li>
      <li><strong>Record of Employment:</strong> Your ROE will be issued electronically through Service Canada.</li>
    </ul>
    
    <p>No further notice or compensation is required because the termination occurred during the probationary period.</p>
    
    <p>Please return any company property in your possession by your last day, including keys, uniforms, or other materials belonging to {{THE BUSINESS}}.</p>
    
    <p>If you have any questions about your final pay or ROE, please contact {{COMPANY EMAIL}}.</p>
  </div>
  
  <div class="closing">
    Sincerely,
  </div>
  
  <div class="signature">
    <br><br>
    _________________________<br>
    {{ManagerName}}<br>
    {{ManagerTitle}}<br>
    {{BusinessName}}
  </div>
</body>
</html>`;
    }
    
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
    }
    h2 {
      color: #111827;
      border-bottom: 2px solid #14B8A6;
      padding-bottom: 10px;
    }
    h3 {
      color: #374151;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <h2>Termination Notice</h2>
  <p><strong>Date:</strong> {{TerminationDate}}</p>
  <p><strong>To:</strong> {{EmployeeFullName}}</p>
  <p><strong>Address:</strong> {{EmployeeAddress}}</p>
  <p><strong>Position:</strong> {{EmployeePosition}}</p>
  <p><strong>Start Date:</strong> {{StartDate}}</p>
  
  <h3>Termination Details</h3>
  <p>This letter serves as formal notice of termination of your employment, effective {{TerminationDate}}.</p>
  
  <!-- Add your custom content here -->
  <!-- Available variables: {{EmployeeFirstName}}, {{EmployeeLastName}}, {{EmployeeFullName}}, {{EmployeePosition}}, {{EmployeeAddress}}, {{EmployeeEmail}}, {{StartDate}}, {{TerminationDate}}, {{TerminationDateShort}}, {{Cause}}, {{NoticePeriodWeeks}}, {{TerminationPay}}, {{SeverancePay}}, {{VacationPayOwed}}, {{TotalEntitlement}}, {{YearsOfService}}, {{Notes}}, {{BusinessName}}, {{BusinessAddress}}, {{BusinessEmail}} -->
</body>
</html>`;
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}
    onClick={onClose}
    >
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: showEditor ? '1200px' : '800px',
        width: '90%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
      }}
      onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
          paddingBottom: '16px'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#111827',
            margin: 0
          }}>
            Termination Letter Templates
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6b7280',
              padding: '0',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {!showEditor ? (
          <>
            {/* Template List */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleCreateNew('standard')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#14B8A6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Plus size={16} />
                Create New Template
              </button>
              <button
                onClick={() => handleCreateNew('probationary')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Plus size={16} />
                Create Probationary Period Template
              </button>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  border: '3px solid #14B8A6',
                  borderTop: '3px solid transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto'
                }}></div>
                <p style={{ marginTop: '12px', color: '#6b7280' }}>Loading templates...</p>
              </div>
            ) : templates.length === 0 ? (
              <div style={{
                padding: '40px',
                textAlign: 'center',
                backgroundColor: '#f9fafb',
                borderRadius: '8px'
              }}>
                <p style={{ color: '#6b7280', marginBottom: '20px' }}>
                  No templates created yet. Create your first template to get started.
                </p>
                <button
                  onClick={handleCreateNew}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#14B8A6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Create First Template
                </button>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gap: '12px'
              }}>
                {templates.map(template => (
                  <div
                    key={template.id}
                    style={{
                      padding: '16px',
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: '8px',
                      backgroundColor: '#f9fafb'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'start',
                      marginBottom: '8px'
                    }}>
                      <div>
                        <h3 style={{
                          fontSize: '18px',
                          fontWeight: '600',
                          color: '#111827',
                          margin: '0 0 4px 0'
                        }}>
                          {template.template_name}
                        </h3>
                        {template.description && (
                          <p style={{
                            fontSize: '14px',
                            color: '#6b7280',
                            margin: '0 0 8px 0'
                          }}>
                            {template.description}
                          </p>
                        )}
                        <div style={{
                          display: 'flex',
                          gap: '12px',
                          fontSize: '13px',
                          color: '#9ca3af'
                        }}>
                          <span>Type: {template.termination_type === 'all' ? 'All Types' : template.termination_type}</span>
                          <span>Created: {new Date(template.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleEdit(template)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#e0f2fe',
                            color: '#0369a1',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Edit2 size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(template.id)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#fef2f2',
                            color: '#991b1b',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Template Editor */}
            <div style={{ marginBottom: '20px' }}>
              <button
                onClick={() => {
                  setShowEditor(false);
                  setEditingTemplate(null);
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#e5e7eb',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  marginBottom: '16px'
                }}
              >
                ← Back to Templates
              </button>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '24px'
            }}>
              {/* Form */}
              <div>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#374151',
                    marginBottom: '6px'
                  }}>
                    Template Name *
                  </label>
                  <input
                    type="text"
                    value={formData.template_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, template_name: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: `2px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: '8px',
                      fontSize: '16px',
                      outline: 'none'
                    }}
                    placeholder="e.g., Standard Termination Letter"
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#374151',
                    marginBottom: '6px'
                  }}>
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: `2px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: '8px',
                      fontSize: '16px',
                      outline: 'none'
                    }}
                    placeholder="Brief description of this template"
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#374151',
                    marginBottom: '6px'
                  }}>
                    Termination Type
                  </label>
                  <select
                    value={formData.termination_type}
                    onChange={(e) => setFormData(prev => ({ ...prev, termination_type: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: `2px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: '8px',
                      fontSize: '16px',
                      outline: 'none'
                    }}
                  >
                    <option value="all">All Types</option>
                    <option value="with_cause">With Cause</option>
                    <option value="without_cause">Without Cause</option>
                    <option value="layoff">Layoff</option>
                  </select>
                </div>

                <div style={{
                  backgroundColor: '#f0fdfa',
                  padding: '16px',
                  borderRadius: '8px',
                  marginBottom: '20px',
                  fontSize: '13px',
                  color: '#0f766e'
                }}>
                  <strong>Available Template Variables:</strong>
                  <div style={{ marginTop: '8px', lineHeight: '1.6' }}>
                    <strong>Employee:</strong> {'{{'}EmployeeFirstName{'}}'}, {'{{'}EmployeeLastName{'}}'}, {'{{'}EmployeeFullName{'}}'},<br/>
                    {'{{'}EmployeePosition{'}}'}, {'{{'}EmployeeAddress{'}}'}, {'{{'}EmployeeEmail{'}}'}<br/>
                    <strong>Dates:</strong> {'{{'}StartDate{'}}'}, {'{{'}TerminationDate{'}}'}, {'{{'}TerminationDateShort{'}}'}<br/>
                    <strong>Termination:</strong> {'{{'}Cause{'}}'}, {'{{'}NoticePeriodWeeks{'}}'}, {'{{'}TerminationPay{'}}'},<br/>
                    {'{{'}SeverancePay{'}}'}, {'{{'}VacationPayOwed{'}}'}, {'{{'}TotalEntitlement{'}}'},<br/>
                    {'{{'}YearsOfService{'}}'}, {'{{'}Notes{'}}'}<br/>
                    <strong>Business:</strong> {'{{'}BusinessName{'}}'}, {'{{'}BusinessAddress{'}}'}, {'{{'}BusinessEmail{'}}'}<br/>
                    <strong>Legacy:</strong> {'{{'}THE BUSINESS{'}}'}, {'{{'}COMPANY EMAIL{'}}'}
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end'
                }}>
                  <button
                    onClick={() => {
                      setShowEditor(false);
                      setEditingTemplate(null);
                    }}
                    disabled={saving}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#e5e7eb',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      opacity: saving ? 0.6 : 1
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: saving ? '#9ca3af' : '#14B8A6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Save size={16} />
                    {saving ? 'Saving...' : 'Save Template'}
                  </button>
                </div>
              </div>

              {/* Content Editor */}
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Template Content (HTML) *
                </label>
                <textarea
                  value={formData.template_content}
                  onChange={(e) => setFormData(prev => ({ ...prev, template_content: e.target.value }))}
                  rows={25}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: `2px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                  placeholder="Enter HTML template content..."
                />
              </div>
            </div>
          </>
        )}

        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
};

export default TerminationTemplatesModal;


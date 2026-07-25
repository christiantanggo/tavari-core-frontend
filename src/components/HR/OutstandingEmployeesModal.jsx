// components/HR/OutstandingEmployeesModal.jsx
import React, { useState } from 'react';
import { X, Mail, User } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';
import { Checkbox } from '@safecomply/ui';

const OutstandingEmployeesModal = ({ 
  isOpen, 
  onClose, 
  policyGroup, 
  businessId,
  businessData,
  onEmailSent 
}) => {
  const [sending, setSending] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState(new Set());
  const [activeTab, setActiveTab] = useState('outstanding');

  if (!isOpen || !policyGroup) return null;

  const isTerminatedAssignment = (assignment) => {
    const status = (assignment.employee_profiles?.employment_status || '').trim().toLowerCase();
    return status.includes('terminated');
  };

  const buildEmployeeList = (acknowledged) => {
    const employeeMap = new Map();
    policyGroup.assignments
    .filter(assignment => !isTerminatedAssignment(assignment) && assignment.acknowledged === acknowledged)
    .forEach(assignment => {
      const emp = assignment.employee_profiles;
      if (emp && emp.id && !employeeMap.has(emp.id)) {
        employeeMap.set(emp.id, {
          ...emp,
          acknowledged_date: assignment.acknowledged_date,
          assigned_date: assignment.assigned_date,
          due_date: assignment.due_date
        });
      }
    });
    return Array.from(employeeMap.values());
  };

  // Deduplicate by employee ID to handle cases where an employee has multiple assignments.
  const outstandingEmployees = buildEmployeeList(false);
  const acknowledgedEmployees = buildEmployeeList(true);

  const toggleEmployee = (employeeId) => {
    const newSelected = new Set(selectedEmployees);
    if (newSelected.has(employeeId)) {
      newSelected.delete(employeeId);
    } else {
      newSelected.add(employeeId);
    }
    setSelectedEmployees(newSelected);
  };

  const selectAll = () => {
    const allIds = new Set(outstandingEmployees.map(emp => emp.id));
    setSelectedEmployees(allIds);
  };

  const deselectAll = () => {
    setSelectedEmployees(new Set());
  };

  const handleSendEmail = async (employee) => {
    if (!employee.email) {
      toast.error(`${employee.first_name} ${employee.last_name} does not have an email address`);
      return;
    }

    setSending(true);
    try {
      // Find the policy assignment for this employee
      const assignment = policyGroup.assignments.find(
        a => a.employee_id === employee.id && !a.acknowledged
      );

      if (!assignment) {
        toast.error('Assignment not found');
        return;
      }

      // Get the full policy data
      const { data: policy, error: policyError } = await supabase
        .from('hr_policies')
        .select('*')
        .eq('id', policyGroup.policy_id)
        .single();

      if (policyError || !policy) {
        throw new Error('Policy not found');
      }

      if (!policy.policy_html) {
        throw new Error('Policy HTML not available');
      }

      toast.loading('Generating PDF...', { id: 'pdf-generation' });

      // Generate PDF using the same method as pay statements
      const LETTER_WIDTH_PX = 816;
      const fullWidthCss = [
        '#policy-pdf-root{width:' + LETTER_WIDTH_PX + 'px !important;min-width:' + LETTER_WIDTH_PX + 'px !important;max-width:none !important;box-sizing:border-box !important}',
        '#policy-pdf-root body,#policy-pdf-root .page-container{width:100% !important;min-width:' + LETTER_WIDTH_PX + 'px !important;max-width:none !important;box-sizing:border-box !important}',
        '#policy-pdf-root .page-container{padding:0.4in 1.1in 0.5in 0.35in !important}',
        '#policy-pdf-root *{box-sizing:border-box !important}',
        '#policy-pdf-root .content,#policy-pdf-root .header,#policy-pdf-root .category-section{max-width:none !important;width:100% !important}',
        '#policy-pdf-root .header-title-row{display:flex !important;align-items:baseline !important;gap:12px !important}#policy-pdf-root .header .policy-title{flex:1 !important;min-width:0 !important}#policy-pdf-root .policy-meta-footer{margin-top:48px !important;padding-top:24px !important;border-top:1px solid #e5e7eb !important;display:flex !important;flex-wrap:wrap !important;gap:24px 32px !important}',
        '#policy-pdf-root .right-border{text-orientation:sideways !important}'
      ].join('');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML =
        '<style>' + fullWidthCss + '</style>' +
        '<div id="policy-pdf-root">' + policy.policy_html + '</div>';
      tempDiv.style.cssText = `
        position: absolute; left: 0; top: 0;
        width: ${LETTER_WIDTH_PX}px; min-height: 11in;
        background: #fff; visibility: visible; z-index: -1000;
        font-family: Arial, sans-serif;
      `;
      document.body.appendChild(tempDiv);

      const root = tempDiv.querySelector('#policy-pdf-root');
      const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
      const effectiveStr = formatDate(policy.effective_date);
      const revisedStr = formatDate(policy.revised_date);
      const updatedStr = formatDate(policy.updated_at);
      const versionStr = String(policy.policy_version ?? '1.0');
      const setMetaByLabel = (container, labelText, value) => {
        if (!container || value === undefined || value === null) return;
        container.querySelectorAll('.meta-item').forEach((item) => {
          const label = item.querySelector('.meta-label');
          if (label && label.textContent.trim().toLowerCase().startsWith(labelText.toLowerCase())) {
            const valSpan = item.querySelector('span:last-child');
            if (valSpan) valSpan.textContent = value;
          }
        });
      };
      const updateMetaContainers = (c) => {
        if (!c) return;
        setMetaByLabel(c, 'Effective Date', effectiveStr);
        setMetaByLabel(c, 'Revised Date', revisedStr);
        setMetaByLabel(c, 'Last Updated', updatedStr);
        setMetaByLabel(c, 'Version', versionStr);
      };
      if (root) {
        updateMetaContainers(root.querySelector('.policy-meta-footer'));
        updateMetaContainers(root.querySelector('.header .policy-meta'));
        const rightBorder = root.querySelector('.right-border');
        if (rightBorder) rightBorder.textContent = '';
        const titleEl = root.querySelector('.policy-title');
        if (titleEl) titleEl.textContent = 'Policy: ' + (policy.policy_name || '').trim();
        const labelEl = root.querySelector('.policy-label');
        if (labelEl) labelEl.remove();
      }

      tempDiv.offsetHeight;
      const contentHeight = tempDiv.scrollHeight;
      const contentWidth = tempDiv.scrollWidth;
      await new Promise(resolve => setTimeout(resolve, 500));

      let pdfBlob;
      try {
        const opt = {
          margin: [0.25, 0.25, 0.25, 0.25],
          filename: `${policy.policy_name.replace(/[^a-z0-9]/gi, '_')}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            letterRendering: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            width: contentWidth,
            height: contentHeight,
            windowWidth: contentWidth,
            windowHeight: contentHeight,
            scrollX: 0,
            scrollY: 0
          },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'pre', 'img'] }
        };
        pdfBlob = await html2pdf().set(opt).from(tempDiv).outputPdf('blob');
        
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        
        if (!pdfBlob || pdfBlob.size === 0) {
          throw new Error('PDF blob is empty or invalid');
        }
        
        if (pdfBlob.size < 1000) {
          throw new Error('PDF appears to be corrupted (file too small)');
        }
        
        toast.dismiss('pdf-generation');
      } catch (pdfError) {
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        console.error('[PDF-EMAIL] Error generating PDF:', pdfError);
        toast.error('Failed to generate PDF. Please try again.', { id: 'pdf-generation' });
        throw pdfError;
      }

      // Convert PDF to base64
      const pdfBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      // Prepare email
      const businessName = businessData?.business_name || businessData?.name || 'Company';
      const emailSubject = `Policy Document - ${policy.policy_name}`;
      const emailBody = `Dear ${employee.first_name},

Please find attached the policy document: ${policy.policy_name}.

Please review this policy document carefully. ${policy.requires_acknowledgment ? 'You will be required to acknowledge receipt of this policy.' : ''}

If you have any questions, please contact your HR department.

Best regards,
${businessName} - HR`;

      const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${emailSubject}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f5f5f5;
            }
            .email-wrapper {
              background: white;
              border-radius: 8px;
              padding: 30px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .email-message {
              margin-bottom: 30px;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>
          <div class="email-wrapper">
            <div class="email-message">${emailBody.replace(/\n/g, '<br>')}</div>
          </div>
        </body>
        </html>
      `;

      const emailPayload = {
        businessId: businessId,
        campaignId: `policy-${policy.id}-${employee.id}-${Date.now()}`,
        contactId: `policy-${employee.email}`,
        emailType: 'transactional',
        to: employee.email,
        fromEmail: 'noreply@tavarios.ca',
        fromName: `${businessName} - HR`,
        subject: emailSubject,
        html: emailHTML,
        text: emailBody,
        attachments: [
          {
            filename: `${policy.policy_name.replace(/[^a-z0-9]/gi, '_')}.pdf`,
            content: pdfBase64,
            contentType: 'application/pdf'
          }
        ]
      };

      // Send email via AWS SES using Supabase Edge Function
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(emailPayload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || `Send failed (${response.status})`);
      }

      const data = await response.json().catch(() => null);

      if (!data?.ok) {
        throw new Error(data?.error || 'Send failed');
      }

      toast.success(`Policy sent to ${employee.first_name} ${employee.last_name}`);
      
      if (onEmailSent) {
        onEmailSent();
      }
    } catch (error) {
      console.error('Error sending policy email:', error);
      toast.error('Failed to send email: ' + (error.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  const handleSendToSelected = async () => {
    if (selectedEmployees.size === 0) {
      toast.error('Please select at least one employee');
      return;
    }

    const employeesToEmail = outstandingEmployees.filter(emp => 
      selectedEmployees.has(emp.id) && emp.email
    );

    if (employeesToEmail.length === 0) {
      toast.error('No selected employees have email addresses');
      return;
    }

    setSending(true);
    try {
      // Send emails one by one
      for (const employee of employeesToEmail) {
        await handleSendEmail(employee);
        // Small delay between emails
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      toast.success(`Policy sent to ${employeesToEmail.length} employee${employeesToEmail.length !== 1 ? 's' : ''}`);
      setSelectedEmployees(new Set());
      
      if (onEmailSent) {
        onEmailSent();
      }
    } catch (error) {
      console.error('Error sending bulk emails:', error);
    } finally {
      setSending(false);
    }
  };

  const formatAcknowledgedDate = (dateString) => {
    if (!dateString) return 'Date not recorded';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Date not recorded';
    return date.toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const styles = {
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
      zIndex: 1000
    },
    modal: {
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      padding: '24px',
      width: '90%',
      maxWidth: '700px',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '24px',
      paddingBottom: '16px',
      borderBottom: '1px solid #e5e7eb'
    },
    title: {
      fontSize: '20px',
      fontWeight: '600',
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: '#111827'
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center',
      color: '#6b7280'
    },
    policyInfo: {
      padding: '12px',
      backgroundColor: '#f9fafb',
      borderRadius: '6px',
      marginBottom: '20px'
    },
    policyName: {
      fontSize: '16px',
      fontWeight: '600',
      color: '#111827',
      marginBottom: '4px'
    },
    policyDetails: {
      fontSize: '14px',
      color: '#6b7280'
    },
    statsRow: {
      display: 'flex',
      gap: '16px',
      marginBottom: '20px',
      padding: '12px',
      backgroundColor: '#fef2f2',
      borderRadius: '6px'
    },
    tabRow: {
      display: 'flex',
      gap: '8px',
      marginBottom: '16px',
      padding: '4px',
      backgroundColor: '#f3f4f6',
      borderRadius: '999px',
      width: 'fit-content',
      maxWidth: '100%',
      flexWrap: 'wrap'
    },
    tabButton: {
      border: 'none',
      borderRadius: '999px',
      padding: '8px 14px',
      backgroundColor: 'transparent',
      color: '#6b7280',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600'
    },
    tabButtonActive: {
      backgroundColor: '#ffffff',
      color: '#14B8A6',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    },
    statItem: {
      flex: 1,
      textAlign: 'center'
    },
    statValue: {
      fontSize: '24px',
      fontWeight: '600',
      color: '#dc2626',
      marginBottom: '4px'
    },
    statLabel: {
      fontSize: '13px',
      color: '#6b7280'
    },
    employeesList: {
      maxHeight: '400px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      marginBottom: '20px'
    },
    employeeItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px',
      backgroundColor: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '6px'
    },
    employeeInfo: {
      flex: 1
    },
    employeeName: {
      fontSize: '14px',
      fontWeight: '500',
      color: '#111827',
      marginBottom: '2px'
    },
    employeeDetails: {
      fontSize: '13px',
      color: '#6b7280'
    },
    acknowledgedDate: {
      fontSize: '13px',
      color: '#16a34a',
      marginTop: '2px',
      fontWeight: '500'
    },
    emailButton: {
      padding: '6px 12px',
      fontSize: '13px',
      backgroundColor: '#14B8A6',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontWeight: '500'
    },
    footer: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '24px',
      paddingTop: '20px',
      borderTop: '1px solid #e5e7eb'
    },
    selectAllButtons: {
      display: 'flex',
      gap: '8px',
      marginBottom: '16px'
    },
    selectAllButton: {
      padding: '6px 12px',
      fontSize: '13px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      backgroundColor: 'white',
      cursor: 'pointer',
      fontWeight: '500'
    },
    sendSelectedButton: {
      padding: '10px 20px',
      border: 'none',
      borderRadius: '6px',
      backgroundColor: '#14B8A6',
      color: '#ffffff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    },
    cancelButton: {
      padding: '10px 20px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      color: '#374151'
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <User size={20} />
            Policy Acknowledgements
          </h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.policyInfo}>
          <div style={styles.policyName}>
            {policyGroup.policy_name}
          </div>
          <div style={styles.policyDetails}>
            Version {policyGroup.policy_version} • {policyGroup.policy_type || 'No type'}
          </div>
        </div>

        <div style={styles.statsRow}>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{policyGroup.missing_signatures}</div>
            <div style={styles.statLabel}>Missing Signatures</div>
          </div>
          <div style={styles.statItem}>
            <div style={{ ...styles.statValue, color: '#16a34a' }}>{policyGroup.acknowledged_count}</div>
            <div style={styles.statLabel}>Acknowledged</div>
          </div>
          <div style={styles.statItem}>
            <div style={{ ...styles.statValue, color: '#111827' }}>{policyGroup.total_assignments}</div>
            <div style={styles.statLabel}>Total Assigned</div>
          </div>
        </div>

        <div style={styles.tabRow}>
          <button
            type="button"
            onClick={() => setActiveTab('outstanding')}
            style={{
              ...styles.tabButton,
              ...(activeTab === 'outstanding' ? styles.tabButtonActive : {})
            }}
          >
            Outstanding ({outstandingEmployees.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('acknowledged');
              setSelectedEmployees(new Set());
            }}
            style={{
              ...styles.tabButton,
              ...(activeTab === 'acknowledged' ? styles.tabButtonActive : {})
            }}
          >
            Acknowledged ({acknowledgedEmployees.length})
          </button>
        </div>

        {activeTab === 'outstanding' && (
          <div style={styles.selectAllButtons}>
            <button
              type="button"
              onClick={selectAll}
              style={styles.selectAllButton}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={deselectAll}
              style={styles.selectAllButton}
            >
              Deselect All
            </button>
            <span style={{ fontSize: '13px', color: '#6b7280', marginLeft: 'auto', alignSelf: 'center' }}>
              {selectedEmployees.size} selected
            </span>
          </div>
        )}

        <div style={styles.employeesList}>
          {activeTab === 'outstanding' && outstandingEmployees.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              All employees have acknowledged this policy
            </div>
          ) : activeTab === 'outstanding' ? (
            outstandingEmployees.map((employee, index) => (
              <div key={`${employee.id}-${index}`} style={styles.employeeItem}>
                <Checkbox
                  checked={selectedEmployees.has(employee.id)}
                  onChange={() => toggleEmployee(employee.id)}
                  id={`employee-checkbox-${employee.id}-${index}`}
                />
                <div style={styles.employeeInfo}>
                  <div style={styles.employeeName}>
                    {employee.first_name} {employee.last_name}
                    {employee.employee_number && ` (#${employee.employee_number})`}
                  </div>
                  <div style={styles.employeeDetails}>
                    {employee.email || 'No email address'}
                  </div>
                </div>
                <button
                  onClick={() => handleSendEmail(employee)}
                  disabled={sending || !employee.email}
                  style={{
                    ...styles.emailButton,
                    opacity: (sending || !employee.email) ? 0.6 : 1,
                    cursor: (sending || !employee.email) ? 'not-allowed' : 'pointer'
                  }}
                >
                  <Mail size={14} />
                  Email
                </button>
              </div>
            ))
          ) : acknowledgedEmployees.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              No active employees have acknowledged this policy yet
            </div>
          ) : (
            acknowledgedEmployees.map((employee, index) => (
              <div key={`${employee.id}-${index}`} style={styles.employeeItem}>
                <div style={styles.employeeInfo}>
                  <div style={styles.employeeName}>
                    {employee.first_name} {employee.last_name}
                    {employee.employee_number && ` (#${employee.employee_number})`}
                  </div>
                  <div style={styles.employeeDetails}>
                    {employee.email || 'No email address'}
                  </div>
                  <div style={styles.acknowledgedDate}>
                    Acknowledged {formatAcknowledgedDate(employee.acknowledged_date)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelButton}>
            Close
          </button>
          {activeTab === 'outstanding' && selectedEmployees.size > 0 && (
            <button
              onClick={handleSendToSelected}
              disabled={sending}
              style={{
                ...styles.sendSelectedButton,
                opacity: sending ? 0.6 : 1,
                cursor: sending ? 'not-allowed' : 'pointer'
              }}
            >
              <Mail size={18} />
              {sending ? 'Sending...' : `Send to ${selectedEmployees.size} Selected`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OutstandingEmployeesModal;


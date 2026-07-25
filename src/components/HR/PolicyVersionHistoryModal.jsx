// components/HR/PolicyVersionHistoryModal.jsx
import React, { useState, useEffect } from 'react';
import { X, History, Download, Eye } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';

const PolicyVersionHistoryModal = ({ isOpen, onClose, policy, businessId }) => {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(null);

  useEffect(() => {
    if (isOpen && policy) {
      loadVersions();
    }
  }, [isOpen, policy]);

  const loadVersions = async () => {
    if (!policy) return;

    setLoading(true);
    try {
      // Get all versions - start with current policy and find parent or children
      const parentId = policy.parent_policy_id || policy.id;
      
      const { data, error } = await supabase
        .from('hr_policies')
        .select('*')
        .or(`id.eq.${parentId},parent_policy_id.eq.${parentId},parent_policy_id.eq.${policy.id}`)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setVersions(data || []);
    } catch (error) {
      console.error('Error loading versions:', error);
      toast.error('Failed to load version history');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadVersion = async (version) => {
    try {
      if (!version.policy_html) {
        toast.error('Policy HTML not available for this version');
        return;
      }

      toast.loading('Generating PDF...', { id: 'pdf-generation' });

      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.top = '-9999px';
      tempDiv.style.width = '8.5in';
      tempDiv.style.backgroundColor = 'white';
      tempDiv.innerHTML = version.policy_html;
      document.body.appendChild(tempDiv);

      await new Promise(resolve => setTimeout(resolve, 100));

      const pdfBlob = await html2pdf().set({
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `${version.policy_name.replace(/[^a-z0-9]/gi, '_')}_v${version.policy_version}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          letterRendering: true,
          allowTaint: true,
          height: tempDiv.scrollHeight,
          width: tempDiv.scrollWidth,
          windowWidth: tempDiv.scrollWidth,
          windowHeight: tempDiv.scrollHeight
        },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      }).from(tempDiv).outputPdf('blob');

      document.body.removeChild(tempDiv);
      toast.dismiss('pdf-generation');

      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${version.policy_name.replace(/[^a-z0-9]/gi, '_')}_v${version.policy_version}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  if (!isOpen) return null;

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
      zIndex: 1000,
      padding: '20px'
    },
    modal: {
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      width: '100%',
      maxWidth: '800px',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 24px',
      borderBottom: '1px solid #e5e7eb'
    },
    title: {
      fontSize: '20px',
      fontWeight: 'bold',
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center'
    },
    content: {
      padding: '24px',
      overflowY: 'auto',
      flex: 1
    },
    versionItem: {
      padding: '16px',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      marginBottom: '12px',
      backgroundColor: '#f9fafb'
    },
    versionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px'
    },
    versionInfo: {
      display: 'flex',
      gap: '16px',
      alignItems: 'center'
    },
    versionBadge: {
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: '13px',
      fontWeight: '600'
    },
    versionActions: {
      display: 'flex',
      gap: '8px'
    },
    button: {
      padding: '6px 12px',
      fontSize: '14px',
      borderRadius: '6px',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontWeight: '500'
    },
    viewButton: {
      backgroundColor: '#3b82f6',
      color: 'white'
    },
    downloadButton: {
      backgroundColor: '#14B8A6',
      color: 'white'
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <History size={20} />
            Version History: {policy?.policy_name}
          </h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '16px', color: '#6b7280' }}>Loading versions...</div>
            </div>
          ) : versions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div style={{ fontSize: '16px', color: '#6b7280' }}>No version history found</div>
            </div>
          ) : (
            versions.map((version) => (
              <div key={version.id} style={styles.versionItem}>
                <div style={styles.versionHeader}>
                  <div style={styles.versionInfo}>
                    <span style={{ fontWeight: '600', fontSize: '16px' }}>
                      Version {version.policy_version}
                    </span>
                    <span
                      style={{
                        ...styles.versionBadge,
                        backgroundColor: version.is_current_version
                          ? '#dcfce7'
                          : version.status === 'archived'
                          ? '#fee2e2'
                          : '#fef3c7',
                        color: version.is_current_version
                          ? '#16a34a'
                          : version.status === 'archived'
                          ? '#dc2626'
                          : '#d97706'
                      }}
                    >
                      {version.is_current_version
                        ? 'Current'
                        : version.status === 'archived'
                        ? 'Archived'
                        : version.status}
                    </span>
                    {version.effective_date && (
                      <span style={{ fontSize: '14px', color: '#6b7280' }}>
                        Effective: {new Date(version.effective_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div style={styles.versionActions}>
                    <button
                      onClick={() => setSelectedVersion(version)}
                      style={{ ...styles.button, ...styles.viewButton }}
                    >
                      <Eye size={16} />
                      View
                    </button>
                    <button
                      onClick={() => handleDownloadVersion(version)}
                      style={{ ...styles.button, ...styles.downloadButton }}
                    >
                      <Download size={16} />
                      Download
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px' }}>
                  Created: {new Date(version.created_at).toLocaleString()}
                  {version.archived_at && (
                    <span> • Archived: {new Date(version.archived_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PolicyVersionHistoryModal;




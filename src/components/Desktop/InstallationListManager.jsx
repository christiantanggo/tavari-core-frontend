// src/components/Desktop/InstallationListManager.jsx
// Component to view and manage all desktop installations for a business
import React, { useState, useEffect } from 'react';
import { FiMonitor, FiTrash2, FiRefreshCw, FiAlertCircle, FiCheckCircle, FiClock } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { desktopInstallationService } from '../../services/DesktopInstallationService';
import toast from 'react-hot-toast';

const InstallationListManager = () => {
  // Try to get business ID from multiple sources
  const { business } = useBusiness();
  const auth = usePOSAuth({ requireBusiness: false, componentName: 'InstallationListManager' });
  
  // Get business ID from auth first, fallback to business context
  const businessId = auth.selectedBusinessId || business?.id;
  
  const [installations, setInstallations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [daysInactive, setDaysInactive] = useState(30);

  useEffect(() => {
    if (businessId) {
      loadInstallations();
    } else {
      console.warn('[InstallationListManager] No business ID available');
      setLoading(false);
    }
  }, [businessId]);

  const loadInstallations = async () => {
    if (!businessId) {
      console.warn('[InstallationListManager] Cannot load installations - no business ID');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('music_installations')
        .select('id, device_name, device_fingerprint, status, last_seen, installed_at, app_version, windows_version')
        .eq('business_id', businessId)
        .order('last_seen', { ascending: false, nullsFirst: false });

      if (error) throw error;

      setInstallations(data || []);
    } catch (error) {
      console.error('Error loading installations:', error);
      toast.error('Failed to load installations');
    } finally {
      setLoading(false);
    }
  };

  const markAsInactive = async (installationId) => {
    if (!window.confirm('Mark this device as inactive? It will be hidden from the device dropdown.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('music_installations')
        .update({ status: 'inactive' })
        .eq('id', installationId);

      if (error) throw error;

      toast.success('Device marked as inactive');
      loadInstallations();
    } catch (error) {
      console.error('Error marking as inactive:', error);
      toast.error('Failed to mark device as inactive');
    }
  };

  const deleteInstallation = async (installationId) => {
    if (!window.confirm('Are you sure you want to permanently delete this installation record? This cannot be undone.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('music_installations')
        .delete()
        .eq('id', installationId);

      if (error) throw error;

      toast.success('Installation deleted');
      loadInstallations();
    } catch (error) {
      console.error('Error deleting installation:', error);
      toast.error('Failed to delete installation');
    }
  };

  const cleanupInactive = async () => {
    if (!window.confirm(`Mark all devices inactive that haven't been seen in ${daysInactive} days?`)) {
      return;
    }

    setCleaningUp(true);
    try {
      if (!businessId) {
        toast.error('No business ID available');
        return;
      }
      const result = await desktopInstallationService.markInactiveInstallations(businessId, daysInactive);
      
      if (result.error) {
        toast.error(`Cleanup failed: ${result.error}`);
      } else {
        toast.success(`Marked ${result.marked} device(s) as inactive`);
        loadInstallations();
      }
    } catch (error) {
      console.error('Error cleaning up installations:', error);
      toast.error('Failed to cleanup installations');
    } finally {
      setCleaningUp(false);
    }
  };

  const formatLastSeen = (lastSeen) => {
    if (!lastSeen) return 'Never';
    
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return diffMins <= 1 ? 'Just now' : `${diffMins} minutes ago`;
      }
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    }
  };

  const getStatusColor = (status, lastSeen) => {
    if (status === 'inactive') return '#6c757d';
    
    if (!lastSeen) return '#ffc107';
    
    const date = new Date(lastSeen);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    
    if (diffDays > 30) return '#dc3545'; // Red - inactive
    if (diffDays > 7) return '#ffc107'; // Yellow - warning
    return '#28a745'; // Green - active
  };

  const styles = {
    container: {
      backgroundColor: '#fff',
      borderRadius: '8px',
      padding: '24px',
      marginBottom: '24px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px'
    },
    title: {
      fontSize: '20px',
      fontWeight: 'bold',
      color: '#333',
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    },
    cleanupSection: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      marginBottom: '20px',
      padding: '16px',
      backgroundColor: '#f8f9fa',
      borderRadius: '6px'
    },
    input: {
      padding: '6px 12px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      fontSize: '14px',
      width: '80px'
    },
    button: {
      padding: '8px 16px',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    cleanupButton: {
      backgroundColor: '#ffc107',
      color: '#000'
    },
    refreshButton: {
      backgroundColor: '#6c757d',
      color: '#fff'
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse'
    },
    th: {
      textAlign: 'left',
      padding: '12px',
      borderBottom: '2px solid #dee2e6',
      fontWeight: '600',
      color: '#495057',
      fontSize: '14px'
    },
    td: {
      padding: '12px',
      borderBottom: '1px solid #dee2e6',
      fontSize: '14px'
    },
    statusBadge: {
      display: 'inline-block',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '13px',
      fontWeight: '500'
    },
    actionButton: {
      padding: '4px 8px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '13px',
      marginLeft: '8px'
    },
    inactiveButton: {
      backgroundColor: '#ffc107',
      color: '#000'
    },
    deleteButton: {
      backgroundColor: '#dc3545',
      color: '#fff'
    },
    emptyState: {
      textAlign: 'center',
      padding: '40px',
      color: '#6c757d'
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>Loading installations...</div>
      </div>
    );
  }

  if (!businessId) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <FiAlertCircle size={24} style={{ marginBottom: '10px', color: '#ffc107' }} />
          <p>No business selected. Please select a business to view installations.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          <FiMonitor size={20} />
          Desktop Installations ({installations.length})
        </h3>
        <button
          style={{ ...styles.button, ...styles.refreshButton }}
          onClick={loadInstallations}
        >
          <FiRefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div style={styles.cleanupSection}>
        <label>
          Mark inactive if not seen in:
          <input
            type="number"
            min="1"
            max="365"
            value={daysInactive}
            onChange={(e) => setDaysInactive(parseInt(e.target.value) || 30)}
            style={styles.input}
          />
          days
        </label>
        <button
          style={{ ...styles.button, ...styles.cleanupButton }}
          onClick={cleanupInactive}
          disabled={cleaningUp}
        >
          <FiTrash2 size={16} />
          {cleaningUp ? 'Cleaning up...' : 'Cleanup Inactive Devices'}
        </button>
      </div>

      {installations.length === 0 ? (
        <div style={styles.emptyState}>
          <FiMonitor size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
          <p>No desktop installations found</p>
        </div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Device Name</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Last Seen</th>
              <th style={styles.th}>Installed</th>
              <th style={styles.th}>Version</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {installations.map((inst) => {
              const statusColor = getStatusColor(inst.status, inst.last_seen);
              const isActive = inst.status === 'active';
              
              return (
                <tr key={inst.id}>
                  <td style={styles.td}>
                    <strong>{inst.device_name || `Device ${inst.id.substring(0, 8)}`}</strong>
                  </td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.statusBadge,
                        backgroundColor: statusColor,
                        color: statusColor === '#ffc107' ? '#000' : '#fff'
                      }}
                    >
                      {isActive ? (
                        <><FiCheckCircle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Active</>
                      ) : (
                        <><FiAlertCircle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Inactive</>
                      )}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FiClock size={14} style={{ opacity: 0.6 }} />
                      {formatLastSeen(inst.last_seen)}
                    </div>
                  </td>
                  <td style={styles.td}>
                    {inst.installed_at ? new Date(inst.installed_at).toLocaleDateString() : 'Unknown'}
                  </td>
                  <td style={styles.td}>{inst.app_version || 'N/A'}</td>
                  <td style={styles.td}>
                    {isActive && (
                      <button
                        style={{ ...styles.actionButton, ...styles.inactiveButton }}
                        onClick={() => markAsInactive(inst.id)}
                        title="Mark as inactive"
                      >
                        <FiAlertCircle size={14} />
                      </button>
                    )}
                    <button
                      style={{ ...styles.actionButton, ...styles.deleteButton }}
                      onClick={() => deleteInstallation(inst.id)}
                      title="Delete permanently"
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default InstallationListManager;


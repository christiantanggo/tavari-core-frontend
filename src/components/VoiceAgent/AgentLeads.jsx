// components/VoiceAgent/AgentLeads.jsx
// Leads captured from voice agent calls
import React, { useState, useEffect } from 'react';
import { Users, Phone, Mail, Calendar, Clock } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const AgentLeads = ({ businessId, voiceAgentService }) => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadLeads();
  }, [businessId, filter]);

  const loadLeads = async () => {
    try {
      setLoading(true);
      const leadsData = await voiceAgentService.getLeads(null, {
        status: filter !== 'all' ? filter : undefined,
        limit: 100,
      });
      setLeads(leadsData);
    } catch (error) {
      console.error('Error loading leads:', error);
      toast.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  const updateLeadStatus = async (leadId, newStatus) => {
    try {
      // This would call a service method to update lead status
      // For now, just reload
      await loadLeads();
      toast.success('Lead status updated');
    } catch (error) {
      console.error('Error updating lead:', error);
      toast.error('Failed to update lead');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading leads...</div>
      </div>
    );
  }

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`,
    },
    filters: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xl,
      flexWrap: 'wrap',
    },
    filterButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    filterButtonActive: {
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      borderColor: TavariStyles.colors.primary || '#008080',
    },
    leadCard: {
      padding: TavariStyles.spacing.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
    },
    leadHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.md,
    },
    leadName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: '4px',
    },
    leadInfo: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
    },
    statusBadge: {
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: '13px',
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    statusNew: {
      backgroundColor: '#dbeafe',
      color: '#1e40af',
    },
    statusContacted: {
      backgroundColor: '#fef3c7',
      color: '#92400e',
    },
    statusBooked: {
      backgroundColor: '#d1fae5',
      color: '#065f46',
    },
    statusLost: {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.filters}>
        <button
          onClick={() => setFilter('all')}
          style={{
            ...styles.filterButton,
            ...(filter === 'all' ? styles.filterButtonActive : {}),
          }}
        >
          All Leads
        </button>
        <button
          onClick={() => setFilter('new')}
          style={{
            ...styles.filterButton,
            ...(filter === 'new' ? styles.filterButtonActive : {}),
          }}
        >
          New
        </button>
        <button
          onClick={() => setFilter('contacted')}
          style={{
            ...styles.filterButton,
            ...(filter === 'contacted' ? styles.filterButtonActive : {}),
          }}
        >
          Contacted
        </button>
        <button
          onClick={() => setFilter('booked')}
          style={{
            ...styles.filterButton,
            ...(filter === 'booked' ? styles.filterButtonActive : {}),
          }}
        >
          Booked
        </button>
      </div>

      {leads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray600 }}>
          <Users size={48} style={{ marginBottom: '16px', opacity: 0.5, margin: '0 auto 16px' }} />
          <div>No leads found</div>
        </div>
      ) : (
        leads.map(lead => (
          <div key={lead.id} style={styles.leadCard}>
            <div style={styles.leadHeader}>
              <div>
                <div style={styles.leadName}>{lead.name || 'Unknown'}</div>
                <div style={styles.leadInfo}>
                  {lead.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Phone size={14} />
                      {lead.phone}
                    </div>
                  )}
                  {lead.email && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Mail size={14} />
                      {lead.email}
                    </div>
                  )}
                  {lead.preferred_date && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={14} />
                      {new Date(lead.preferred_date).toLocaleDateString()}
                      {lead.preferred_time && ` at ${lead.preferred_time}`}
                    </div>
                  )}
                  {lead.event_type && (
                    <div style={{ textTransform: 'capitalize' }}>
                      Event: {lead.event_type}
                    </div>
                  )}
                  {lead.guest_count && (
                    <div>
                      Guests: {lead.guest_count}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <div style={{
                  ...styles.statusBadge,
                  ...(styles[`status${lead.status?.charAt(0).toUpperCase() + lead.status?.slice(1)}`] || styles.statusNew),
                }}>
                  {lead.status || 'new'}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: TavariStyles.colors.gray500,
                  marginTop: '4px',
                }}>
                  {new Date(lead.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
            {lead.notes && (
              <div style={{
                marginTop: TavariStyles.spacing.md,
                padding: TavariStyles.spacing.md,
                backgroundColor: TavariStyles.colors.gray50,
                borderRadius: TavariStyles.borderRadius?.sm || '6px',
                fontSize: TavariStyles.typography.fontSize.sm,
                color: TavariStyles.colors.gray700,
              }}>
                {lead.notes}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default AgentLeads;



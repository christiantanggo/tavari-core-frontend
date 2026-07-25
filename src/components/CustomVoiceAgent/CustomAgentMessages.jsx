// components/CustomVoiceAgent/CustomAgentMessages.jsx
// Callback messages captured from custom voice agent calls
import React, { useState, useEffect } from 'react';
import { MessageSquare, Phone, Clock, CheckCircle, XCircle } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const CustomAgentMessages = ({ businessId, customVoiceAgentService }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (businessId) {
      loadMessages();
    }
  }, [businessId, filter]);

  const loadMessages = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('custom_voice_agent_messages')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error loading messages:', error);
      toast.error('Failed to load callback messages');
    } finally {
      setLoading(false);
    }
  };

  const updateMessageStatus = async (messageId, newStatus) => {
    try {
      const { error } = await supabase
        .from('custom_voice_agent_messages')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', messageId);

      if (error) throw error;
      
      toast.success('Message status updated');
      await loadMessages();
    } catch (error) {
      console.error('Error updating message status:', error);
      toast.error('Failed to update message status');
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading messages...</div>
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
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: TavariStyles.colors.gray300,
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
    messageCard: {
      padding: TavariStyles.spacing.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
    },
    messageHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.md,
    },
    messageName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: '4px',
    },
    messageInfo: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
    },
    messageBody: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.sm || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      whiteSpace: 'pre-wrap',
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
    statusResolved: {
      backgroundColor: '#d1fae5',
      color: '#065f46',
    },
    actionButtons: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md,
    },
    actionButton: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: TavariStyles.colors.gray300,
      borderRadius: TavariStyles.borderRadius?.sm || '6px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.xs,
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    },
    phoneLink: {
      color: TavariStyles.colors.primary || '#008080',
      textDecoration: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
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
          All Messages
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
          onClick={() => setFilter('resolved')}
          style={{
            ...styles.filterButton,
            ...(filter === 'resolved' ? styles.filterButtonActive : {}),
          }}
        >
          Resolved
        </button>
      </div>

      {messages.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray600 }}>
          <MessageSquare size={48} style={{ marginBottom: '16px', opacity: 0.5, margin: '0 auto 16px' }} />
          <div>No callback messages found</div>
          <div style={{ fontSize: '13px', marginTop: '8px', color: TavariStyles.colors.gray500 }}>
            Messages appear here when the AI takes callback information from callers
          </div>
        </div>
      ) : (
        messages.map(message => (
          <div key={message.id} style={styles.messageCard}>
            <div style={styles.messageHeader}>
              <div>
                <div style={styles.messageName}>{message.customer_name || 'Unknown Caller'}</div>
                <div style={styles.messageInfo}>
                  {message.customer_phone && (
                    <a 
                      href={`tel:${message.customer_phone}`}
                      style={styles.phoneLink}
                    >
                      <Phone size={14} />
                      {message.customer_phone}
                    </a>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={14} />
                    {new Date(message.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
              <div>
                <div style={{
                  ...styles.statusBadge,
                  ...(styles[`status${message.status?.charAt(0).toUpperCase() + message.status?.slice(1)}`] || styles.statusNew),
                }}>
                  {message.status || 'new'}
                </div>
              </div>
            </div>
            
            {message.message && (
              <div style={styles.messageBody}>
                {message.message}
              </div>
            )}

            <div style={styles.actionButtons}>
              {message.status === 'new' && (
                <>
                  <button
                    style={styles.actionButton}
                    onClick={() => updateMessageStatus(message.id, 'contacted')}
                  >
                    <CheckCircle size={14} />
                    Mark as Contacted
                  </button>
                  <button
                    style={styles.actionButton}
                    onClick={() => updateMessageStatus(message.id, 'resolved')}
                  >
                    <XCircle size={14} />
                    Mark as Resolved
                  </button>
                </>
              )}
              {message.status === 'contacted' && (
                <button
                  style={styles.actionButton}
                  onClick={() => updateMessageStatus(message.id, 'resolved')}
                >
                  <XCircle size={14} />
                  Mark as Resolved
                </button>
              )}
              {message.customer_phone && (
                <a
                  href={`tel:${message.customer_phone}`}
                  style={{
                    ...styles.actionButton,
                    backgroundColor: TavariStyles.colors.primary || '#008080',
                    color: TavariStyles.colors.white,
                    borderColor: TavariStyles.colors.primary || '#008080',
                    textDecoration: 'none',
                  }}
                >
                  <Phone size={14} />
                  Call Back
                </a>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default CustomAgentMessages;


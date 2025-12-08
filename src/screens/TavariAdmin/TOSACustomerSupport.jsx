// screens/TavariAdmin/TOSACustomerSupport.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiHeadphones, FiMessageSquare, FiClock, FiUser, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { useTOSATavariAuth } from '../../hooks/useTOSATavariAuth';
import { usePermissions } from '../../hooks/usePermissions';

// Foundation Components
import { TavariStyles } from '../../utils/TavariStyles';
import TOSAHeaderBar from '../../components/TavariAdminComp/TOSAHeaderBar';
import TOSASidebarNav from '../../components/TavariAdminComp/TOSASidebarNav';

const TOSACustomerSupport = () => {
  const navigate = useNavigate();

  // Security context for sensitive customer support operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'TOSACustomerSupport',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // TOSA Authentication
  const auth = useTOSATavariAuth({
    requiredPermissions: ['customer_support'],
    componentName: 'TOSACustomerSupport'
  });

  // Permission system (for additional granular checks)
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks for TOSA operations
  const canViewTickets = auth.hasPermission?.('customer_support') || false;
  const canEditTickets = auth.hasPermission?.('customer_support') || false;
  const canResolveTickets = auth.hasPermission?.('customer_support') || false;
  const canViewCustomerData = auth.hasPermission?.('customer_data_access') || false;

  const [tickets, setTickets] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');

  // TOSA is now open - no auth check needed

  // Log initial access
  useEffect(() => {
    if (auth.isAuthenticated && auth.authUser && canViewTickets) {
      logInitialAccess();
    }
  }, [auth.isAuthenticated, auth.authUser, canViewTickets]);

  const logInitialAccess = async () => {
    try {
      await logSecurityEvent('tosa_support_accessed', {
        action: 'tosa_support_screen_loaded',
        tosa_user_id: auth.authUser?.id,
        tosa_user_email: auth.authUser?.email,
        timestamp: new Date().toISOString()
      }, 'high');

      await recordAction('tosa_support_accessed', 'support_dashboard', true);

      // Use TOSA auth logging if available
      if (auth.logUserAction) {
        await auth.logUserAction('support_viewed', { 
          screen: 'customer_support',
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      // Silent fail on logging - don't block user experience
    }
  };

  // Load tickets data
  useEffect(() => {
    if (auth.isAuthenticated && canViewTickets) {
      loadTicketsData();
    }
  }, [auth.isAuthenticated, canViewTickets]);

  const loadTicketsData = async () => {
    if (!canViewTickets) {
      toast.error('You do not have permission to view support tickets');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_tosa_tickets');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('tosa_tickets_data_access', {
        action: 'load_tickets_data',
        tosa_user_id: auth.authUser?.id
      }, 'high');

      // Load support-related events from security_audit_logs
      // Filter for support, ticket, help, or error events
      const { data: supportEvents, error: supportError } = await supabase
        .from('security_audit_logs')
        .select(`
          id,
          event_type,
          severity,
          created_at,
          details,
          business_id,
          businesses (name)
        `)
        .or('event_type.ilike.%support%,event_type.ilike.%ticket%,event_type.ilike.%help%,event_type.ilike.%error%')
        .order('created_at', { ascending: false })
        .limit(50);

      if (supportError) {
        throw supportError;
      }

      // Transform security events into ticket format
      const transformedTickets = (supportEvents || []).map((event, index) => {
        const createdDate = new Date(event.created_at);
        const now = new Date();
        const hoursAgo = Math.floor((now - createdDate) / (1000 * 60 * 60));
        const daysAgo = Math.floor(hoursAgo / 24);
        
        let timeAgo = '';
        if (hoursAgo < 1) timeAgo = 'Just now';
        else if (hoursAgo < 24) timeAgo = `${hoursAgo} hour${hoursAgo > 1 ? 's' : ''} ago`;
        else timeAgo = `${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`;

        // Determine status based on severity and recency
        let status = 'open';
        if (event.severity === 'low' || daysAgo > 7) status = 'resolved';
        else if (event.severity === 'medium' || hoursAgo > 24) status = 'pending';

        // Determine priority from severity
        const priorityMap = { critical: 'high', high: 'high', medium: 'medium', low: 'low' };
        const priority = priorityMap[event.severity] || 'medium';

        // Extract subject from event_type or details
        const subject = event.details?.subject || 
                       event.details?.message || 
                       event.event_type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) ||
                       'Support Request';

        return {
          id: event.id,
          business: event.businesses?.name || 'Unknown Business',
          subject: subject,
          status: status,
          priority: priority,
          created: timeAgo,
          created_at: event.created_at,
          assignee: null,
          business_id: event.business_id,
          event_type: event.event_type,
          severity: event.severity,
          details: event.details
        };
      });

      setTickets(transformedTickets);

      await recordAction('tosa_tickets_loaded', 'support_dashboard', true);
      await logSecurityEvent('tosa_tickets_loaded', {
        action: 'load_tickets_success',
        ticket_count: transformedTickets.length,
        tosa_user_id: auth.authUser?.id
      }, 'high');

    } catch (err) {
      await logSecurityEvent('tosa_tickets_load_error', {
        action: 'load_tickets_failed',
        error_message: err.message,
        tosa_user_id: auth.authUser?.id
      }, 'critical');
      
      setError('Failed to load support tickets');
      toast.error('Failed to load support tickets');
    } finally {
      setLoading(false);
    }
  };

  const handleTicketClick = async (ticket) => {
    await logSecurityEvent('tosa_ticket_clicked', {
      action: 'ticket_detail_viewed',
      ticket_id: ticket.id,
      ticket_subject: ticket.subject,
      business: ticket.business,
      tosa_user_id: auth.authUser?.id
    }, 'medium');

    await recordAction('tosa_ticket_clicked', ticket.id, true);

    // TODO: Navigate to ticket detail view or show modal
    toast.info(`Ticket #${ticket.id} details coming soon`);
  };

  const handleStatusChange = async (ticketId, newStatus) => {
    if (!canEditTickets) {
      toast.error('You do not have permission to edit tickets');
      return;
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('update_ticket_status');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('tosa_ticket_status_change', {
        action: 'update_ticket_status',
        ticket_id: ticketId,
        new_status: newStatus,
        tosa_user_id: auth.authUser?.id
      }, 'high');

      // TODO: Update ticket in database
      setTickets(tickets.map(t => 
        t.id === ticketId ? { ...t, status: newStatus } : t
      ));

      await recordAction('tosa_ticket_updated', ticketId, true);
      
      toast.success('Ticket status updated');
    } catch (err) {
      await logSecurityEvent('tosa_ticket_update_error', {
        action: 'update_ticket_failed',
        ticket_id: ticketId,
        error_message: err.message,
        tosa_user_id: auth.authUser?.id
      }, 'critical');
      
      toast.error('Failed to update ticket status');
    }
  };

  const getFilteredTickets = () => {
    return tickets.filter(ticket => {
      const statusMatch = filterStatus === 'all' || ticket.status === filterStatus;
      const priorityMatch = filterPriority === 'all' || ticket.priority === filterPriority;
      return statusMatch && priorityMatch;
    });
  };

  const getStatusColor = (status) => {
    const colors = {
      open: TavariStyles.colors.danger,
      pending: TavariStyles.colors.warning,
      resolved: TavariStyles.colors.success,
      closed: TavariStyles.colors.gray500
    };
    return colors[status] || TavariStyles.colors.gray500;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      high: TavariStyles.colors.danger,
      medium: TavariStyles.colors.warning,
      low: TavariStyles.colors.info
    };
    return colors[priority] || TavariStyles.colors.gray500;
  };

  const getStatusIcon = (status) => {
    const icons = {
      open: <FiAlertCircle />,
      pending: <FiClock />,
      resolved: <FiCheckCircle />,
      closed: <FiCheckCircle />
    };
    return icons[status] || <FiMessageSquare />;
  };

  const styles = {
    container: {
      display: 'flex',
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      fontFamily: TavariStyles.typography.fontFamily
    },
    content: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      marginLeft: '250px'
    },
    main: {
      flex: 1,
      padding: TavariStyles.spacing.xl,
      paddingTop: '120px'
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    filters: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.xl,
      flexWrap: 'wrap'
    },
    select: {
      ...TavariStyles.components.form.select,
      minWidth: '150px'
    },
    ticketsGrid: {
      display: 'grid',
      gap: TavariStyles.spacing.lg
    },
    ticketCard: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      cursor: 'pointer',
      transition: TavariStyles.transitions.normal,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    ticketHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.md
    },
    ticketSubject: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    ticketBusiness: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    statusBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      backgroundColor: TavariStyles.colors.gray100
    },
    ticketMeta: {
      display: 'flex',
      gap: TavariStyles.spacing.lg,
      marginTop: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    metaItem: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    loading: {
      ...TavariStyles.components.loading.container
    },
    error: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.lg
    },
    accessDenied: {
      padding: '40px',
      textAlign: 'center',
      color: TavariStyles.colors.danger
    },
    stats: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl
    },
    statCard: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius.md,
      boxShadow: TavariStyles.shadows.sm,
      textAlign: 'center'
    },
    statNumber: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    }
  };

  if (auth.authLoading) {
    return (
      <SecurityWrapper componentName="TOSACustomerSupport" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.loading}>
          <div style={TavariStyles.components.loading.spinner}></div>
          <div>Loading TOSA Customer Support...</div>
          <style>{TavariStyles.keyframes.spin}</style>
        </div>
      </SecurityWrapper>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <SecurityWrapper componentName="TOSACustomerSupport" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.accessDenied}>
          <h2>Access Denied</h2>
          <p>Tavari employees only.</p>
        </div>
      </SecurityWrapper>
    );
  }

  if (!canViewTickets) {
    return (
      <SecurityWrapper componentName="TOSACustomerSupport" sensitiveComponent={true} securityLevel="critical">
        <div style={styles.container}>
          <TOSASidebarNav />
          <div style={styles.content}>
            <TOSAHeaderBar />
            <main style={styles.main}>
              <div style={styles.accessDenied}>
                <h2>Access Denied</h2>
                <p>You do not have permission to view customer support tickets.</p>
              </div>
            </main>
          </div>
        </div>
      </SecurityWrapper>
    );
  }

  const filteredTickets = getFilteredTickets();
  const openTickets = tickets.filter(t => t.status === 'open').length;
  const pendingTickets = tickets.filter(t => t.status === 'pending').length;
  const resolvedTickets = tickets.filter(t => t.status === 'resolved').length;

  return (
    <SecurityWrapper componentName="TOSACustomerSupport" sensitiveComponent={true} securityLevel="critical">
      <div style={styles.container}>
        <TOSASidebarNav />
        
        <div style={styles.content}>
          <TOSAHeaderBar />
          
          <main style={styles.main}>
            <div style={styles.header}>
              <h1 style={styles.title}>Customer Support Tickets</h1>
              <p style={styles.subtitle}>
                Manage and respond to customer support requests across all Tavari businesses
              </p>
            </div>

            {/* Ticket Statistics */}
            <div style={styles.stats}>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{openTickets}</div>
                <div style={styles.statLabel}>Open Tickets</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{pendingTickets}</div>
                <div style={styles.statLabel}>Pending</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{resolvedTickets}</div>
                <div style={styles.statLabel}>Resolved</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{tickets.length}</div>
                <div style={styles.statLabel}>Total Tickets</div>
              </div>
            </div>

            {error && (
              <div style={styles.error}>
                {error}
              </div>
            )}

            {/* Filters */}
            <div style={styles.filters}>
              <select
                style={styles.select}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>

              <select
                style={styles.select}
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
              >
                <option value="all">All Priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            {loading ? (
              <div style={styles.loading}>
                <div style={TavariStyles.components.loading.spinner}></div>
                <div>Loading tickets...</div>
                <style>{TavariStyles.keyframes.spin}</style>
              </div>
            ) : (
              <div style={styles.ticketsGrid}>
                {filteredTickets.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray500 }}>
                    No tickets found matching your filters.
                  </div>
                ) : (
                  filteredTickets.map(ticket => (
                    <div
                      key={ticket.id}
                      style={styles.ticketCard}
                      onClick={() => handleTicketClick(ticket)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = TavariStyles.shadows.lg;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = TavariStyles.shadows.md;
                      }}
                    >
                      <div style={styles.ticketHeader}>
                        <div>
                          <h3 style={styles.ticketSubject}>{ticket.subject}</h3>
                          <p style={styles.ticketBusiness}>
                            <FiUser size={14} style={{ display: 'inline', marginRight: '4px' }} />
                            {ticket.business}
                          </p>
                        </div>
                        <div style={{
                          ...styles.statusBadge,
                          color: getStatusColor(ticket.status),
                          borderLeft: `3px solid ${getStatusColor(ticket.status)}`
                        }}>
                          {getStatusIcon(ticket.status)}
                          {ticket.status}
                        </div>
                      </div>

                      <div style={styles.ticketMeta}>
                        <div style={styles.metaItem}>
                          <FiAlertCircle />
                          <span style={{ color: getPriorityColor(ticket.priority) }}>
                            {ticket.priority.toUpperCase()}
                          </span>
                        </div>
                        <div style={styles.metaItem}>
                          <FiClock />
                          <span>{ticket.created}</span>
                        </div>
                        {ticket.assignee && (
                          <div style={styles.metaItem}>
                            <FiHeadphones />
                            <span>{ticket.assignee}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default TOSACustomerSupport;
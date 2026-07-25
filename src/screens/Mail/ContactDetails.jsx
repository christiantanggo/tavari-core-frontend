// screens/Mail/ContactDetails.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import EmailPauseBanner, { blockEmailSendIfPaused } from '../../components/EmailPauseBanner';
import { 
  FiArrowLeft, FiEdit3, FiSave, FiX, FiMail, FiPhone, FiUser, 
  FiTag, FiCalendar, FiUserCheck, FiUserX, FiTrash2, FiRefreshCw, 
  FiSend, FiAlertCircle
} from 'react-icons/fi';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import MailModuleHeader from '../../components/Mail/MailModuleHeader';
import { MailModuleTabs } from '../../components/Mail/MailModuleNavigation';

// Permission System Imports
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';
import { logConsentAction, syncResubscribeState } from '../../helpers/Mail/subscriptionSync';

const ContactDetails = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  
  // Security context for contact data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ContactDetails',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  // Authentication using standardized hook
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'ContactDetails'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState({});
  const [errors, setErrors] = useState({});
  const [engagementHistory, setEngagementHistory] = useState([]);

  const businessId =
    selectedBusinessId ||
    businessData?.id ||
    localStorage.getItem('currentBusinessId') ||
    localStorage.getItem('businessId');

  // Permission checks
  const canViewContacts = hasPermission('mail.contacts.view') || hasElevatedPrivileges();
  const canEditContacts = hasPermission('mail.contacts.edit') || hasElevatedPrivileges();
  const canDeleteContacts = hasPermission('mail.contacts.delete') || hasElevatedPrivileges();
  const canSendEmails = hasPermission('mail.campaigns.send') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !authLoading && !canViewContacts) {
      toast.error('You do not have permission to view contact details');
      navigate('/dashboard/mail/contacts');
    }
  }, [permissionsLoading, authLoading, canViewContacts]);

  useEffect(() => {
    if (businessId && id && !authLoading && !permissionsLoading && canViewContacts) {
      loadContact();
      loadEngagementHistory();
    }
  }, [businessId, id, authLoading, permissionsLoading, canViewContacts]);

  const loadContact = async () => {
    // Permission check
    if (!canViewContacts) {
      toast.error('You do not have permission to view contacts');
      return;
    }

    // Rate limiting
    if (!checkRateLimit('load_contact', 20, 60000)) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    try {
      setLoading(true);

      await logSecurityEvent('contact_details_access', {
        action: 'load_contact_details',
        contact_id: id,
        business_id: businessId,
        user_id: authUser?.id
      }, 'low');

      const { data, error } = await supabase
        .from('mail_contacts')
        .select('*')
        .eq('id', id)
        .eq('business_id', businessId)
        .single();

      if (error) throw error;

      setContact(data);
      setEditData({
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.email || '',
        phone: data.phone || '',
        tags: (data.tags || []).join(', '),
        subscribed: data.subscribed
      });

      await recordAction('contact_loaded', true, id);
    } catch (error) {
      console.error('Error loading contact:', error);
      if (error.code === 'PGRST116') {
        // Contact not found
        navigate('/dashboard/mail/contacts');
      }
      await recordAction('contact_loaded', false, id);
    } finally {
      setLoading(false);
    }
  };

  const loadEngagementHistory = async () => {
    try {
      if (!businessId || !id) {
        setEngagementHistory([]);
        return;
      }

      const [sendsResult, consentResult] = await Promise.all([
        supabase
          .from('mail_campaign_sends')
          .select(`
            id,
            status,
            sent_at,
            delivered_at,
            opened_at,
            clicked_at,
            unsubscribed_at,
            error_message,
            created_at,
            mail_campaigns(name)
          `)
          .eq('contact_id', id)
          .order('created_at', { ascending: false })
          .limit(25),
        supabase
          .from('mail_consent_log')
          .select('id, action, consent_source, consent_method, timestamp')
          .eq('contact_id', id)
          .eq('business_id', businessId)
          .order('timestamp', { ascending: false })
          .limit(25)
      ]);

      if (sendsResult.error) throw sendsResult.error;
      if (consentResult.error) throw consentResult.error;

      const sendEvents = (sendsResult.data || []).flatMap((entry) => {
        const campaignName = entry.mail_campaigns?.name || 'Campaign';
        const events = [];

        if (entry.sent_at || entry.created_at) {
          events.push({
            id: `${entry.id}-sent`,
            type: 'campaign_sent',
            campaign_name: campaignName,
            date: entry.sent_at || entry.created_at,
            status: entry.status
          });
        }

        if (entry.opened_at) {
          events.push({
            id: `${entry.id}-opened`,
            type: 'campaign_opened',
            campaign_name: campaignName,
            date: entry.opened_at,
            status: 'opened'
          });
        }

        if (entry.clicked_at) {
          events.push({
            id: `${entry.id}-clicked`,
            type: 'campaign_clicked',
            campaign_name: campaignName,
            date: entry.clicked_at,
            status: 'clicked'
          });
        }

        if (entry.unsubscribed_at) {
          events.push({
            id: `${entry.id}-unsubscribed`,
            type: 'subscription_change',
            action: 'unsubscribe',
            source: 'campaign_link',
            method: 'self_service',
            date: entry.unsubscribed_at,
            status: 'unsubscribed'
          });
        }

        if (entry.status === 'failed' && entry.error_message) {
          events.push({
            id: `${entry.id}-failed`,
            type: 'campaign_failed',
            campaign_name: campaignName,
            date: entry.created_at || entry.sent_at,
            status: entry.error_message
          });
        }

        return events;
      });

      const consentEvents = (consentResult.data || []).map((entry) => ({
        id: `consent-${entry.id}`,
        type: 'subscription_change',
        action: entry.action,
        source: entry.consent_source || 'unknown',
        method: entry.consent_method || 'unknown',
        date: entry.timestamp,
        status: entry.action
      }));

      const combinedHistory = [...sendEvents, ...consentEvents]
        .filter((entry) => entry.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 30);

      setEngagementHistory(combinedHistory);
    } catch (error) {
      console.error('Error loading engagement history:', error);
      setEngagementHistory([]);
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!editData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (!editData.first_name) {
      newErrors.first_name = 'First name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    // Permission check
    if (!canEditContacts) {
      toast.error('You do not have permission to edit contacts');
      return;
    }

    if (!validateForm()) return;

    // Rate limiting
    if (!checkRateLimit('update_contact', 10, 60000)) {
      toast.error('Too many update requests. Please wait a moment.');
      return;
    }

    setSaving(true);
    try {
      await logSecurityEvent('contact_update', {
        action: 'update_contact',
        contact_id: id,
        business_id: businessId,
        user_id: authUser?.id
      }, 'medium');

      // Clean phone number
      const cleanPhone = editData.phone ? editData.phone.replace(/\D/g, '') : '';
      const formattedPhone = cleanPhone.length >= 10 ? 
        (cleanPhone.length === 10 ? 
          `(${cleanPhone.slice(0,3)}) ${cleanPhone.slice(3,6)}-${cleanPhone.slice(6)}` :
          `+1 (${cleanPhone.slice(1,4)}) ${cleanPhone.slice(4,7)}-${cleanPhone.slice(7,11)}`
        ) : editData.phone;

      // Parse tags
      const tags = editData.tags ? 
        editData.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : 
        [];

      const updates = {
        first_name: editData.first_name.trim(),
        last_name: editData.last_name.trim(),
        email: editData.email.toLowerCase().trim(),
        phone: formattedPhone,
        tags,
        subscribed: editData.subscribed,
        updated_at: new Date().toISOString()
      };

      // Handle subscription status change
      if (editData.subscribed !== contact.subscribed) {
        if (editData.subscribed) {
          updates.unsubscribed_at = null;
        } else {
          updates.unsubscribed_at = new Date().toISOString();
        }
      }

      const { error } = await supabase
        .from('mail_contacts')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      if (editData.subscribed !== contact.subscribed) {
        if (editData.subscribed) {
          await syncResubscribeState({
            businessId,
            contactId: id,
            emailAddress: updates.email,
            source: 'contact_details_edit'
          });
        } else {
          await logConsentAction({
            businessId,
            contactId: id,
            emailAddress: updates.email,
            action: 'unsubscribe',
            source: 'contact_details_edit'
          });
        }
      }

      // Log audit event
      await supabase.from('audit_logs').insert({
        business_id: businessId,
        action: 'update_contact',
        details: { 
          contact_id: id,
          changes: Object.keys(updates).filter(key => updates[key] !== contact[key])
        },
        created_at: new Date().toISOString()
      });

      // Reload contact data
      await loadContact();
      setEditing(false);
      setErrors({});
      toast.success('Contact updated successfully');
      await recordAction('contact_updated', true, id);
    } catch (error) {
      console.error('Error updating contact:', error);
      setErrors({ submit: 'Failed to update contact. Please try again.' });
      toast.error('Failed to update contact');
      await recordAction('contact_updated', false, id);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    // Permission check
    if (!canDeleteContacts) {
      toast.error('You do not have permission to delete contacts');
      return;
    }

    const confirmMessage = `Delete contact "${contact.first_name} ${contact.last_name}" permanently?`;
    if (!window.confirm(confirmMessage)) return;

    // Rate limiting
    if (!checkRateLimit('delete_contact', 5, 60000)) {
      toast.error('Too many delete requests. Please wait a moment.');
      return;
    }

    try {
      await logSecurityEvent('contact_delete', {
        action: 'delete_contact',
        contact_id: id,
        contact_email: contact.email,
        contact_name: `${contact.first_name} ${contact.last_name}`,
        business_id: businessId,
        user_id: authUser?.id
      }, 'high');

      const { error } = await supabase
        .from('mail_contacts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Log audit event
      await supabase.from('audit_logs').insert({
        business_id: businessId,
        action: 'delete_contact',
        details: { 
          contact_id: id,
          email: contact.email,
          name: `${contact.first_name} ${contact.last_name}`
        },
        created_at: new Date().toISOString()
      });

      toast.success('Contact deleted successfully');
      await recordAction('contact_deleted', true, id);
      navigate('/dashboard/mail/contacts');
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast.error('Failed to delete contact. Please try again.');
      await recordAction('contact_deleted', false, id);
    }
  };

  const handleSubscriptionToggle = async () => {
    // Permission check
    if (!canEditContacts) {
      toast.error('You do not have permission to modify contact subscriptions');
      return;
    }

    // Rate limiting
    if (!checkRateLimit('toggle_subscription', 10, 60000)) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    try {
      const newSubscribed = !contact.subscribed;

      await logSecurityEvent('contact_subscription_toggle', {
        action: newSubscribed ? 'resubscribe_contact' : 'unsubscribe_contact',
        contact_id: id,
        contact_email: contact.email,
        business_id: businessId,
        user_id: authUser?.id
      }, 'medium');

      const updates = {
        subscribed: newSubscribed,
        updated_at: new Date().toISOString()
      };

      if (newSubscribed) {
        updates.unsubscribed_at = null;
      } else {
        updates.unsubscribed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('mail_contacts')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      if (newSubscribed) {
        await syncResubscribeState({
          businessId,
          contactId: id,
          emailAddress: contact.email,
          source: 'contact_details_toggle'
        });
      } else {
        await logConsentAction({
          businessId,
          contactId: id,
          emailAddress: contact.email,
          action: 'unsubscribe',
          source: 'contact_details_toggle'
        });
      }

      // Log audit event
      await supabase.from('audit_logs').insert({
        business_id: businessId,
        action: newSubscribed ? 'resubscribe_contact' : 'unsubscribe_contact',
        details: { 
          contact_id: id,
          email: contact.email,
          method: 'manual'
        },
        created_at: new Date().toISOString()
      });

      await loadContact();
      toast.success(newSubscribed ? 'Contact resubscribed' : 'Contact unsubscribed');
      await recordAction('subscription_toggled', true, id);
    } catch (error) {
      console.error('Error updating subscription:', error);
      toast.error('Failed to update subscription status. Please try again.');
      await recordAction('subscription_toggled', false, id);
    }
  };

  const handleSendDirectEmail = async () => {
    // Permission check
    if (!canSendEmails) {
      toast.error('You do not have permission to send emails');
      return;
    }

    if (blockEmailSendIfPaused('Direct email sending')) return;
    
    await logSecurityEvent('direct_email_attempt', {
      action: 'attempt_direct_email',
      contact_id: id,
      contact_email: contact.email,
      business_id: businessId,
      user_id: authUser?.id
    }, 'medium');

    const subject = encodeURIComponent(`Hello ${contact.first_name || contact.last_name || ''}`.trim() || 'Hello');
    const mailtoUrl = `mailto:${encodeURIComponent(contact.email)}?subject=${subject}`;

    window.location.href = mailtoUrl;
    toast.success('Opened an email draft addressed to this contact.');
    await recordAction('direct_email_opened', true, id);
  };

  const handleAddToCampaign = async () => {
    // Permission check
    if (!canSendEmails) {
      toast.error('You do not have permission to add contacts to campaigns');
      return;
    }

    if (blockEmailSendIfPaused('Adding to campaign')) return;
    
    await logSecurityEvent('add_to_campaign_navigation', {
      action: 'navigate_add_to_campaign',
      contact_id: id,
      contact_email: contact.email,
      business_id: businessId,
      user_id: authUser?.id
    }, 'low');

    // Navigate to campaigns or show campaign selection modal
    navigate('/dashboard/mail/campaigns', { 
      state: { 
        preselectedContact: contact.id,
        action: 'add_contact' 
      } 
    });
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getEngagementIcon = (type) => {
    switch (type) {
      case 'campaign_sent':
        return <FiMail style={{ color: 'teal' }} />;
      case 'campaign_opened':
      case 'campaign_clicked':
        return <FiSend style={{ color: '#4caf50' }} />;
      case 'campaign_failed':
        return <FiAlertCircle style={{ color: '#f44336' }} />;
      case 'subscription_change':
        return <FiRefreshCw style={{ color: '#666' }} />;
      default:
        return <FiCalendar style={{ color: '#666' }} />;
    }
  };

  const getEngagementDescription = (item) => {
    switch (item.type) {
      case 'campaign_sent':
        return `Campaign sent: ${item.campaign_name}`;
      case 'campaign_opened':
        return `Opened campaign: ${item.campaign_name}`;
      case 'campaign_clicked':
        return `Clicked campaign: ${item.campaign_name}`;
      case 'campaign_failed':
        return `Send failed: ${item.campaign_name}`;
      case 'subscription_change':
        return `${item.action === 'subscribe' || item.action === 'resubscribe' ? 'Subscribed' : 'Unsubscribed'} via ${item.source}${item.method ? ` (${item.method})` : ''}`;
      default:
        return item.description || 'Activity';
    }
  };

  if (authLoading || permissionsLoading || loading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailModuleTabs />
          <div style={styles.loading}>Loading contact...</div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailModuleTabs />
          <div style={styles.errorState}>
            <FiAlertCircle style={styles.errorIcon} />
            <h2>Authentication Error</h2>
            <p>{authError}</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!contact) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailModuleTabs />
          <div style={styles.notFound}>Contact not found</div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          <EmailPauseBanner />
          <MailModuleHeader />
          <MailModuleTabs />
          
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <button 
                style={styles.backButton}
                onClick={() => navigate('/dashboard/mail/contacts')}
              >
                <FiArrowLeft style={styles.buttonIcon} />
                Back to Contacts
              </button>
              <h1 style={styles.title}>
                {contact.first_name} {contact.last_name}
              </h1>
              <div style={styles.statusBadge}>
                {contact.subscribed ? (
                  <>
                    <FiUserCheck style={styles.statusIcon} />
                    <span>Subscribed</span>
                  </>
                ) : (
                  <>
                    <FiUserX style={styles.statusIcon} />
                    <span>Unsubscribed</span>
                  </>
                )}
              </div>
            </div>
            
            <div style={styles.headerActions}>
              <PermissionGate permission="mail.campaigns.send">
                {contact.subscribed && (
                  <>
                    <button 
                      style={styles.emailButton}
                      onClick={handleSendDirectEmail}
                    >
                      <FiSend style={styles.buttonIcon} />
                      Open Email Draft
                    </button>
                    <button 
                      style={styles.campaignButton}
                      onClick={handleAddToCampaign}
                    >
                      <FiMail style={styles.buttonIcon} />
                      Add to Campaign
                    </button>
                  </>
                )}
              </PermissionGate>
              
              <PermissionGate permission="mail.contacts.edit">
                <button 
                  style={styles.subscriptionButton}
                  onClick={handleSubscriptionToggle}
                >
                  {contact.subscribed ? <FiUserX /> : <FiUserCheck />}
                  {contact.subscribed ? 'Unsubscribe' : 'Resubscribe'}
                </button>
              </PermissionGate>

              <PermissionGate permission="mail.contacts.edit">
                {!editing ? (
                  <button 
                    style={styles.editButton}
                    onClick={() => setEditing(true)}
                  >
                    <FiEdit3 style={styles.buttonIcon} />
                    Edit Contact
                  </button>
                ) : (
                  <div style={styles.editActions}>
                    <button 
                      style={styles.cancelButton}
                      onClick={() => {
                        setEditing(false);
                        setErrors({});
                        // Reset edit data
                        setEditData({
                          first_name: contact.first_name || '',
                          last_name: contact.last_name || '',
                          email: contact.email || '',
                          phone: contact.phone || '',
                          tags: (contact.tags || []).join(', '),
                          subscribed: contact.subscribed
                        });
                      }}
                      disabled={saving}
                    >
                      <FiX style={styles.buttonIcon} />
                      Cancel
                    </button>
                    <button 
                      style={styles.saveButton}
                      onClick={handleSave}
                      disabled={saving}
                    >
                      <FiSave style={styles.buttonIcon} />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </PermissionGate>
            </div>
          </div>

          {/* Contact Information */}
          <div style={styles.content}>
            <div style={styles.mainSection}>
              <div style={styles.contactCard}>
                <h2 style={styles.sectionTitle}>Contact Information</h2>
                
                {editing ? (
                  <PermissionGate 
                    permission="mail.contacts.edit"
                    fallback={
                      <div style={styles.permissionDenied}>
                        <FiAlertCircle style={styles.permissionIcon} />
                        <p>You do not have permission to edit contacts</p>
                      </div>
                    }
                  >
                    <div style={styles.editForm}>
                      <div style={styles.formRow}>
                        <div style={styles.formGroup}>
                          <label style={styles.label}>
                            <FiUser style={styles.labelIcon} />
                            First Name *
                          </label>
                          <input
                            type="text"
                            style={{
                              ...styles.input,
                              ...(errors.first_name ? styles.inputError : {})
                            }}
                            value={editData.first_name}
                            onChange={(e) => setEditData(prev => ({ ...prev, first_name: e.target.value }))}
                          />
                          {errors.first_name && <span style={styles.errorText}>{errors.first_name}</span>}
                        </div>

                        <div style={styles.formGroup}>
                          <label style={styles.label}>
                            <FiUser style={styles.labelIcon} />
                            Last Name
                          </label>
                          <input
                            type="text"
                            style={styles.input}
                            value={editData.last_name}
                            onChange={(e) => setEditData(prev => ({ ...prev, last_name: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>
                          <FiMail style={styles.labelIcon} />
                          Email Address *
                        </label>
                        <input
                          type="email"
                          style={{
                            ...styles.input,
                            ...(errors.email ? styles.inputError : {})
                          }}
                          value={editData.email}
                          onChange={(e) => setEditData(prev => ({ ...prev, email: e.target.value }))}
                        />
                        {errors.email && <span style={styles.errorText}>{errors.email}</span>}
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>
                          <FiPhone style={styles.labelIcon} />
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          style={styles.input}
                          value={editData.phone}
                          onChange={(e) => setEditData(prev => ({ ...prev, phone: e.target.value }))}
                        />
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>
                          <FiTag style={styles.labelIcon} />
                          Tags (comma-separated)
                        </label>
                        <input
                          type="text"
                          style={styles.input}
                          value={editData.tags}
                          onChange={(e) => setEditData(prev => ({ ...prev, tags: e.target.value }))}
                          placeholder="customer, birthday-party, vip"
                        />
                      </div>

                      <div style={styles.formGroup}>
                        <div style={styles.checkboxLabel}>
                          <TavariCheckbox
                            checked={editData.subscribed}
                            onChange={(checked) => setEditData(prev => ({ ...prev, subscribed: checked }))}
                            id="contact-details-subscribed"
                            label="Subscribed to emails"
                            style={styles.checkbox}
                          />
                        </div>
                      </div>

                      {errors.submit && (
                        <div style={styles.errorMessage}>
                          {errors.submit}
                        </div>
                      )}
                    </div>
                  </PermissionGate>
                ) : (
                  <div style={styles.contactInfo}>
                    <div style={styles.infoRow}>
                      <FiMail style={styles.infoIcon} />
                      <span style={styles.infoLabel}>Email:</span>
                      <span style={styles.infoValue}>{contact.email}</span>
                    </div>

                    {contact.phone && (
                      <div style={styles.infoRow}>
                        <FiPhone style={styles.infoIcon} />
                        <span style={styles.infoLabel}>Phone:</span>
                        <span style={styles.infoValue}>{contact.phone}</span>
                      </div>
                    )}

                    <div style={styles.infoRow}>
                      <FiTag style={styles.infoIcon} />
                      <span style={styles.infoLabel}>Tags:</span>
                      <div style={styles.tags}>
                        {(contact.tags || []).length > 0 ? 
                          contact.tags.map(tag => (
                            <span key={tag} style={styles.tag}>{tag}</span>
                          )) : 
                          <span style={styles.noTags}>No tags</span>
                        }
                      </div>
                    </div>

                    <div style={styles.infoRow}>
                      <FiCalendar style={styles.infoIcon} />
                      <span style={styles.infoLabel}>Added:</span>
                      <span style={styles.infoValue}>{formatDate(contact.created_at)}</span>
                    </div>

                    <div style={styles.infoRow}>
                      <FiRefreshCw style={styles.infoIcon} />
                      <span style={styles.infoLabel}>Last Updated:</span>
                      <span style={styles.infoValue}>{formatDate(contact.updated_at)}</span>
                    </div>

                    <div style={styles.infoRow}>
                      <FiUser style={styles.infoIcon} />
                      <span style={styles.infoLabel}>Source:</span>
                      <span style={styles.infoValue}>{contact.source}</span>
                    </div>

                    {contact.unsubscribed_at && (
                      <div style={styles.infoRow}>
                        <FiUserX style={styles.infoIcon} />
                        <span style={styles.infoLabel}>Unsubscribed:</span>
                        <span style={styles.infoValue}>{formatDate(contact.unsubscribed_at)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Engagement History */}
              <div style={styles.historyCard}>
                <h2 style={styles.sectionTitle}>Engagement History</h2>
                {engagementHistory.length > 0 ? (
                  <div style={styles.historyList}>
                    {engagementHistory.map(item => (
                      <div key={item.id} style={styles.historyItem}>
                        <div style={styles.historyIcon}>
                          {getEngagementIcon(item.type)}
                        </div>
                        <div style={styles.historyContent}>
                          <div style={styles.historyDescription}>
                            {getEngagementDescription(item)}
                          </div>
                          <div style={styles.historyDate}>
                            {formatDate(item.date)}
                          </div>
                        </div>
                        {item.status && (
                          <div style={styles.historyStatus}>
                            {item.status}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={styles.noHistory}>
                    <p>No engagement history yet.</p>
                    <p style={styles.noHistorySubtext}>
                      Engagement history will appear here when this contact receives campaigns or makes subscription changes.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            <PermissionGate 
              permission="mail.contacts.delete"
              fallback={
                <div style={styles.dangerZone}>
                  <h3 style={styles.dangerTitle}>Delete Contact</h3>
                  <div style={styles.permissionDenied}>
                    <FiAlertCircle style={styles.permissionIcon} />
                    <p>You do not have permission to delete contacts</p>
                  </div>
                </div>
              }
            >
              <div style={styles.dangerZone}>
                <h3 style={styles.dangerTitle}>Danger Zone</h3>
                <div style={styles.dangerActions}>
                  <button 
                    style={styles.deleteButton}
                    onClick={handleDelete}
                  >
                    <FiTrash2 style={styles.buttonIcon} />
                    Delete Contact
                  </button>
                </div>
                <p style={styles.dangerText}>
                  This action cannot be undone. The contact will be permanently removed from your database.
                </p>
              </div>
            </PermissionGate>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '40px',
    maxWidth: '1000px',
    margin: '0 auto',
    backgroundColor: '#f8f8f8',
    minHeight: '100vh',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '18px',
    color: '#666',
  },
  notFound: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '18px',
    color: '#666',
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: '48px',
    color: '#f44336',
    marginBottom: '20px',
  },
  permissionDenied: {
    backgroundColor: '#fff3cd',
    border: '2px solid #f39c12',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
    color: '#856404',
  },
  permissionIcon: {
    fontSize: '32px',
    marginBottom: '12px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
    flexWrap: 'wrap',
    gap: '20px',
  },
  headerLeft: {
    flex: 1,
  },
  backButton: {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'teal',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '10px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '10px',
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: 'bold',
    backgroundColor: '#e8f5e8',
    color: '#2e7d32',
  },
  statusIcon: {
    fontSize: '16px',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  emailButton: {
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  campaignButton: {
    backgroundColor: '#2196f3',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  subscriptionButton: {
    backgroundColor: 'white',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  editButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  editActions: {
    display: 'flex',
    gap: '8px',
  },
  cancelButton: {
    backgroundColor: 'white',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '8px',
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  saveButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  buttonIcon: {
    fontSize: '14px',
  },
  content: {
    display: 'grid',
    gap: '30px',
  },
  mainSection: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '30px',
  },
  contactCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    padding: '20px',
  },
  historyCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    padding: '20px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
  },
  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '15px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  labelIcon: {
    fontSize: '16px',
    color: 'teal',
  },
  input: {
    padding: '12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    boxSizing: 'border-box',
  },
  inputError: {
    borderColor: '#f44336',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#333',
    cursor: 'pointer',
  },
  checkbox: {
    width: '16px',
    height: '16px',
  },
  errorText: {
    fontSize: '12px',
    color: '#f44336',
    marginTop: '5px',
  },
  errorMessage: {
    backgroundColor: '#ffebee',
    color: '#c62828',
    padding: '12px',
    borderRadius: '6px',
    fontSize: '14px',
  },
  contactInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  infoIcon: {
    fontSize: '16px',
    color: 'teal',
    width: '20px',
  },
  infoLabel: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
    minWidth: '100px',
  },
  infoValue: {
    fontSize: '14px',
    color: '#333',
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  tag: {
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  noTags: {
    fontSize: '14px',
    color: '#999',
    fontStyle: 'italic',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  historyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    padding: '15px',
    backgroundColor: '#f8f8f8',
    borderRadius: '8px',
  },
  historyIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
  },
  historyContent: {
    flex: 1,
  },
  historyDescription: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '4px',
  },
  historyDate: {
    fontSize: '12px',
    color: '#666',
  },
  historyStatus: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#4caf50',
    textTransform: 'uppercase',
  },
  noHistory: {
    textAlign: 'center',
    padding: '40px 20px',
    color: '#666',
  },
  noHistorySubtext: {
    fontSize: '14px',
    marginTop: '10px',
    color: '#999',
  },
  dangerZone: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #f44336',
    padding: '20px',
  },
  dangerTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#f44336',
    marginBottom: '15px',
  },
  dangerActions: {
    marginBottom: '10px',
  },
  deleteButton: {
    backgroundColor: '#f44336',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dangerText: {
    fontSize: '14px',
    color: '#666',
    margin: 0,
  },
  '@media (max-width: 768px)': {
    mainSection: {
      gridTemplateColumns: '1fr',
    },
    formRow: {
      gridTemplateColumns: '1fr',
    },
    headerActions: {
      width: '100%',
      justifyContent: 'flex-start',
    },
  },
};

export default ContactDetails;
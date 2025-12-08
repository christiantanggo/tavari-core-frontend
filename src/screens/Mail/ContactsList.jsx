// screens/Mail/ContactsList.jsx - Enhanced with engagement tracking, preferences, CASL compliance, and segmentation
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import EmailPauseBanner, { blockEmailSendIfPaused } from '../../components/EmailPauseBanner';
import AddContactModal from '../../components/Mail/AddContactModal';
import CSVImportModal from '../../components/Mail/CSVImportModal';
import EditContactModal from '../../components/Mail/EditContactModal';
import { styles } from './ContactsList.styles';
import { 
  FiUsers, FiPlus, FiUpload, FiSearch, FiFilter, FiEdit3, FiTrash2, 
  FiUserCheck, FiUserX, FiMail, FiPhone, FiDownload, FiGitMerge, 
  FiRefreshCw, FiAlertTriangle, FiCheck, FiX, FiCopy, FiTag,
  FiTrendingUp, FiEye, FiMousePointer, FiClock, FiShield, FiHeart,
  FiHome, FiStar, FiSettings, FiMapPin, FiGlobe, FiCalendar, FiInfo
} from 'react-icons/fi';

const ContactsList = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const [contacts, setContacts] = useState([]);
  const [allContacts, setAllContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [engagementFilter, setEngagementFilter] = useState('all'); // New engagement filter
  const [segmentFilter, setSegmentFilter] = useState('all'); // New segment filter
  const [sortField, setSortField] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10000);
  const [totalContacts, setTotalContacts] = useState(0);
  const [stats, setStats] = useState({ 
    total: 0, 
    subscribed: 0, 
    unsubscribed: 0,
    highEngagement: 0,
    withoutConsent: 0,
    householdMembers: 0
  });
  const [duplicates, setDuplicates] = useState([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [csvImportModal, setCsvImportModal] = useState(false);
  const [addContactModal, setAddContactModal] = useState(false);
  const [editContactModal, setEditContactModal] = useState(false);
  const [editingContactId, setEditingContactId] = useState(null);
  const [mergeModal, setMergeModal] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState([]);
  const [segments, setSegments] = useState([]); // Available segments
  const [showEngagementDetails, setShowEngagementDetails] = useState(false);

  const businessId = business?.id;

  const loadContactSummary = useCallback(async () => {
    if (!businessId) return;

    try {
      setSummaryLoading(true);

      const totalResult = await supabase
        .from('mail_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId);

      if (totalResult.error) throw totalResult.error;

      const subscribedResult = await supabase
        .from('mail_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('subscribed', true);

      if (subscribedResult.error) throw subscribedResult.error;

      const totalCount = totalResult.count || 0;
      const subscribedCount = subscribedResult.count || 0;

      setStats(prev => ({
        ...prev,
        total: totalCount,
        subscribed: subscribedCount,
        unsubscribed: totalCount - subscribedCount
      }));

      setTotalContacts(totalCount);
    } catch (error) {
      console.error('Error loading contact summary:', error);
    } finally {
      setSummaryLoading(false);
    }
  }, [businessId]);

  // Load all contacts with enhanced data
  const loadAllContacts = useCallback(async () => {
    if (!businessId) {
      console.log('No business selected yet');
      return;
    }
    
    try {
      setLoading(true);
      console.log('Loading enhanced contacts for business:', businessId);
      
      const batchSize = 1000;
      let offset = 0;
      let more = true;
      const aggregated = [];

      while (more) {
        const { data, error } = await supabase
          .from('mail_contacts')
          .select(`
            *,
            household:mail_households(id, household_name, primary_contact_id),
            segments:mail_contact_segment_memberships(
              segment:mail_contact_segments(id, name, color)
            )
          `)
          .eq('business_id', businessId)
          .order(sortField, { ascending: sortOrder === 'asc' })
          .range(offset, offset + batchSize - 1);

        if (error) throw error;

        aggregated.push(...(data || []));

        if (!data || data.length < batchSize) {
          more = false;
        } else {
          offset += batchSize;
        }
      }

      const processedContacts = aggregated.map(contact => ({
        ...contact,
        engagement_level: getEngagementLevel(contact.engagement_score || 0),
        last_activity: getLastActivity(contact),
        household_role: contact.household ? contact.relationship_role : null,
        segment_names: contact.segments?.map(s => s.segment?.name).filter(Boolean) || [],
        segment_colors: contact.segments?.map(s => s.segment?.color).filter(Boolean) || [],
        consent_status: getConsentStatus(contact),
        communication_health: getCommunicationHealth(contact)
      }));

      const uniqueContactsMap = new Map();
      processedContacts.forEach(contact => {
        if (!uniqueContactsMap.has(contact.id)) {
          uniqueContactsMap.set(contact.id, contact);
        }
      });
      const uniqueContacts = Array.from(uniqueContactsMap.values());

      const totalCount = uniqueContacts.length;
      const subscribedCount = uniqueContacts.filter(c => c.subscribed).length;
      const highEngagementCount = uniqueContacts.filter(c => c.engagement_level === 'high').length;
      const withoutConsentCount = uniqueContacts.filter(c => getConsentStatus(c) === 'missing').length;
      const householdCount = uniqueContacts.filter(c => c.household_id).length;

      const duplicateGroups = (() => {
        const groups = [];
        const emailMap = new Map();
        const namePhoneMap = new Map();

        uniqueContacts.forEach(contact => {
          if (contact.email) {
            const emailKey = contact.email.toLowerCase();
            if (emailMap.has(emailKey)) {
              emailMap.get(emailKey).push(contact);
            } else {
              emailMap.set(emailKey, [contact]);
            }
          }

          if (contact.first_name && contact.last_name && contact.phone) {
            const key = `${contact.first_name.toLowerCase()}_${contact.last_name.toLowerCase()}_${contact.phone.replace(/\D/g, '')}`;
            if (namePhoneMap.has(key)) {
              namePhoneMap.get(key).push(contact);
            } else {
              namePhoneMap.set(key, [contact]);
            }
          }
        });

        emailMap.forEach(value => {
          if (value.length > 1) {
            groups.push({ type: 'email', contacts: value });
          }
        });

        namePhoneMap.forEach(value => {
          if (value.length > 1) {
            groups.push({ type: 'name_phone', contacts: value });
          }
        });

        return groups;
      })();

      setAllContacts(uniqueContacts);
      setTotalContacts(totalCount);
      setStats({
        total: totalCount,
        subscribed: subscribedCount,
        unsubscribed: totalCount - subscribedCount,
        highEngagement: highEngagementCount,
        withoutConsent: withoutConsentCount,
        householdMembers: householdCount
      });
      setDuplicates(duplicateGroups);
      setContactsLoaded(true);
    } catch (error) {
      console.error('Error loading contacts:', error);
      setContactsLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [businessId, sortField, sortOrder]);

  // Load available segments
  const loadSegments = useCallback(async () => {
    if (!businessId) return;
    
    try {
      const { data, error } = await supabase
        .from('mail_contact_segments')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSegments(data || []);
    } catch (error) {
      console.error('Error loading segments:', error);
    }
  }, [businessId]);

  // Helper functions for calculated fields
  const getEngagementLevel = (score) => {
    if (score >= 50) return 'high';
    if (score >= 20) return 'medium';
    if (score >= 5) return 'low';
    return 'none';
  };

  const getLastActivity = (contact) => {
    const dates = [
      contact.last_opened_at,
      contact.last_clicked_at,
      contact.last_campaign_sent_at
    ].filter(Boolean);
    
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates.map(d => new Date(d))));
  };

  const getConsentStatus = (contact) => {
    if (!contact.consent_method || !contact.consent_timestamp) return 'missing';
    if (contact.consent_method === 'express') return 'express';
    return 'implied';
  };

  const getCommunicationHealth = (contact) => {
    const issues = [];
    if (!contact.consent_method) issues.push('No consent recorded');
    if (!contact.email_frequency) issues.push('No frequency preference');
    if (!contact.language_preference) issues.push('No language preference');
    return issues;
  };

  // Enhanced filtering with new criteria
  const { filteredContacts, paginatedContacts } = useMemo(() => {
    let filtered = [...allContacts];

    // Apply subscription filter
    if (filter === 'subscribed') {
      filtered = filtered.filter(c => c.subscribed);
    } else if (filter === 'unsubscribed') {
      filtered = filtered.filter(c => !c.subscribed);
    }

    // Apply source filter
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(c => c.source === sourceFilter);
    }

    // Apply engagement filter
    if (engagementFilter !== 'all') {
      filtered = filtered.filter(c => c.engagement_level === engagementFilter);
    }

    // Apply segment filter
    if (segmentFilter !== 'all') {
      filtered = filtered.filter(c => c.segment_names.includes(segmentFilter));
    }

    // Apply search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(contact =>
        contact.email.toLowerCase().includes(search) ||
        contact.first_name?.toLowerCase().includes(search) ||
        contact.last_name?.toLowerCase().includes(search) ||
        contact.phone?.includes(search) ||
        contact.segment_names.some(name => name.toLowerCase().includes(search))
      );
    }

    // Calculate pagination
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginated = filtered.slice(startIndex, endIndex);

    return { 
      filteredContacts: filtered, 
      paginatedContacts: paginated 
    };
  }, [allContacts, filter, sourceFilter, engagementFilter, segmentFilter, searchTerm, currentPage, pageSize]);

  // Update contacts state when filtered results change
  useEffect(() => {
    if (contactsLoaded) {
      setContacts(paginatedContacts);
      setTotalContacts(filteredContacts.length);
    }
  }, [filteredContacts, paginatedContacts, contactsLoaded]);

  useEffect(() => {
    if (!contactsLoaded) return;

    const total = allContacts.length;
    const subscribed = allContacts.filter(c => c.subscribed).length;
    const highEngagement = allContacts.filter(c => c.engagement_level === 'high').length;
    const withoutConsent = allContacts.filter(c => !c.consent_method || !c.consent_timestamp).length;
    const householdMembers = allContacts.filter(c => c.household_id).length;

    setStats({
      total,
      subscribed,
      unsubscribed: total - subscribed,
      highEngagement,
      withoutConsent,
      householdMembers
    });
  }, [allContacts, contactsLoaded]);

  // Load data when business changes
  useEffect(() => {
    if (businessId) {
      loadContactSummary();
      loadSegments();
    }
  }, [businessId, loadContactSummary, loadSegments]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filter, sourceFilter, engagementFilter, segmentFilter]);

  // Enhanced duplicate detection
  const findDuplicates = useCallback((contactsSource = allContacts) => {
    if (!contactsLoaded) {
      setDuplicates([]);
      return;
    }

    const source = contactsSource || allContacts;
    if (!source || source.length === 0) {
      setDuplicates([]);
      return;
    }

    const duplicateGroups = [];
    const emailMap = new Map();
    const namePhoneMap = new Map();

    source.forEach(contact => {
      if (contact.email) {
        const emailKey = contact.email.toLowerCase();
        if (emailMap.has(emailKey)) {
          emailMap.get(emailKey).push(contact);
        } else {
          emailMap.set(emailKey, [contact]);
        }
      }

      if (contact.first_name && contact.last_name && contact.phone) {
        const key = `${contact.first_name.toLowerCase()}_${contact.last_name.toLowerCase()}_${contact.phone.replace(/\D/g, '')}`;
        if (namePhoneMap.has(key)) {
          namePhoneMap.get(key).push(contact);
        } else {
          namePhoneMap.set(key, [contact]);
        }
      }
    });

    emailMap.forEach(group => {
      if (group.length > 1) {
        duplicateGroups.push({ type: 'email', contacts: group });
      }
    });

    namePhoneMap.forEach(group => {
      if (group.length > 1) {
        duplicateGroups.push({ type: 'name_phone', contacts: group });
      }
    });

    setDuplicates(duplicateGroups);
    return duplicateGroups;
  }, [allContacts, contactsLoaded]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleSelectContact = (contactId) => {
    setSelectedContacts(prev => 
      prev.includes(contactId) 
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const handleSelectAll = () => {
    if (selectedContacts.length === contacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(contacts.map(c => c.id));
    }
  };

  // Enhanced bulk operations with new features and pause protection
  const handleBulkOperation = async (operation) => {
    if (selectedContacts.length === 0) return;

    // Block email-related operations when paused
    if (operation === 'send_campaign' || operation === 'send_newsletter') {
      if (blockEmailSendIfPaused('Bulk email sending')) return;
    }

    let confirmMessage = '';
    switch (operation) {
      case 'delete':
        confirmMessage = `Delete ${selectedContacts.length} contacts permanently?`;
        break;
      case 'unsubscribe':
        confirmMessage = `Unsubscribe ${selectedContacts.length} contacts?`;
        break;
      case 'resubscribe':
        confirmMessage = `Resubscribe ${selectedContacts.length} contacts?`;
        break;
      case 'update_preferences':
        // Handle preference updates
        handleBulkPreferenceUpdate();
        return;
      case 'add_to_segment':
        // Handle segment assignment
        handleBulkSegmentAdd();
        return;
      case 'export':
        await handleExportSelected();
        return;
      default:
        return;
    }

    if (!window.confirm(confirmMessage)) return;

    try {
      if (operation === 'delete') {
        const { error } = await supabase
          .from('mail_contacts')
          .delete()
          .in('id', selectedContacts);
        
        if (error) throw error;
        
        // Log audit action
        await supabase.rpc('log_mail_action', {
          p_action: 'bulk_delete_contacts',
          p_business_id: businessId,
          p_user_id: business?.created_by,
          p_details: { count: selectedContacts.length }
        });
      } else {
        const subscribed = operation === 'resubscribe';
        const { error } = await supabase
          .from('mail_contacts')
          .update({ 
            subscribed,
            unsubscribed_at: subscribed ? null : new Date().toISOString()
          })
          .in('id', selectedContacts);
        
        if (error) throw error;

        // Log consent actions for each contact
        for (const contactId of selectedContacts) {
          const contact = allContacts.find(c => c.id === contactId);
          if (contact) {
            await supabase.rpc('log_consent_action', {
              p_business_id: businessId,
              p_contact_id: contactId,
              p_email_address: contact.email,
              p_action: subscribed ? 'resubscribe' : 'unsubscribe',
              p_consent_source: 'bulk_action'
            });
          }
        }
      }

      setSelectedContacts([]);
      await loadAllContacts();
    } catch (error) {
      console.error(`Error performing bulk ${operation}:`, error);
      alert(`Failed to ${operation} contacts. Please try again.`);
    }
  };

  const handleBulkPreferenceUpdate = () => {
    // Implementation for bulk preference updates
    alert('Bulk preference update coming soon!');
  };

  const handleBulkSegmentAdd = () => {
    // Implementation for bulk segment assignment
    alert('Bulk segment assignment coming soon!');
  };

  const handleExportSelected = async () => {
    if (!contactsLoaded) {
      alert('Load the contact list before exporting.');
      return;
    }
    try {
      console.log('Starting enhanced export...');
      
      const contactsToExport = selectedContacts.length > 0 
        ? allContacts.filter(c => selectedContacts.includes(c.id))
        : filteredContacts;
      
      if (contactsToExport.length === 0) {
        alert('No contacts to export.');
        return;
      }

      // Enhanced CSV headers with new fields
      const csvRows = [
        [
          'Email', 'First Name', 'Last Name', 'Phone', 'Subscribed', 'Source', 
          'Created At', 'Tags', 'Engagement Score', 'Total Opens', 'Total Clicks',
          'Email Frequency', 'Language', 'Timezone', 'Consent Method', 'Consent Source',
          'Consent Date', 'Household Role', 'Segments', 'Last Activity'
        ]
      ];

      contactsToExport.forEach(contact => {
        csvRows.push([
          contact.email || '',
          contact.first_name || '',
          contact.last_name || '',
          contact.phone || '',
          contact.subscribed ? 'Yes' : 'No',
          contact.source || '',
          contact.created_at ? new Date(contact.created_at).toLocaleDateString() : '',
          (contact.tags || []).join(';'),
          contact.engagement_score || 0,
          contact.total_opens || 0,
          contact.total_clicks || 0,
          contact.email_frequency || '',
          contact.language_preference || '',
          contact.timezone || '',
          contact.consent_method || '',
          contact.consent_source || '',
          contact.consent_timestamp ? new Date(contact.consent_timestamp).toLocaleDateString() : '',
          contact.relationship_role || '',
          contact.segment_names.join(';'),
          contact.last_activity ? new Date(contact.last_activity).toLocaleDateString() : ''
        ]);
      });

      // Create and download file
      const csvContent = csvRows.map(row => 
        row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
      ).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `contacts_enhanced_export_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        alert(`Successfully exported ${contactsToExport.length} contacts with enhanced data.`);
        
        // Log audit event
        await supabase.rpc('log_mail_action', {
          p_action: 'export_contacts_enhanced',
          p_business_id: businessId,
          p_user_id: business?.created_by,
          p_details: { count: contactsToExport.length, fields: 'enhanced' }
        });

        setSelectedContacts([]);
      }
    } catch (error) {
      console.error('Error exporting contacts:', error);
      alert(`Failed to export contacts: ${error.message}`);
    }
  };

  const handleMergeContacts = async (keepId, mergeIds) => {
    if (!contactsLoaded) {
      alert('Load the contact list before merging contacts.');
      return;
    }
    try {
      // Use the enhanced merge logic with new fields
      const { data: keepContact, error: keepError } = await supabase
        .from('mail_contacts')
        .select('*')
        .eq('id', keepId)
        .single();

      if (keepError) throw keepError;

      const { data: mergeContacts, error: mergeError } = await supabase
        .from('mail_contacts')
        .select('*')
        .in('id', mergeIds);

      if (mergeError) throw mergeError;

      // Enhanced merge data with new fields
      const mergedData = {
        first_name: keepContact.first_name || mergeContacts.find(c => c.first_name)?.first_name,
        last_name: keepContact.last_name || mergeContacts.find(c => c.last_name)?.last_name,
        phone: keepContact.phone || mergeContacts.find(c => c.phone)?.phone,
        tags: [...new Set([...(keepContact.tags || []), ...mergeContacts.flatMap(c => c.tags || [])])],
        subscribed: keepContact.subscribed || mergeContacts.some(c => c.subscribed),
        engagement_score: Math.max(keepContact.engagement_score || 0, ...mergeContacts.map(c => c.engagement_score || 0)),
        total_opens: (keepContact.total_opens || 0) + mergeContacts.reduce((sum, c) => sum + (c.total_opens || 0), 0),
        total_clicks: (keepContact.total_clicks || 0) + mergeContacts.reduce((sum, c) => sum + (c.total_clicks || 0), 0),
        email_frequency: keepContact.email_frequency || mergeContacts.find(c => c.email_frequency)?.email_frequency,
        language_preference: keepContact.language_preference || mergeContacts.find(c => c.language_preference)?.language_preference,
        consent_method: keepContact.consent_method || mergeContacts.find(c => c.consent_method)?.consent_method
      };

      const { error: updateError } = await supabase
        .from('mail_contacts')
        .update(mergedData)
        .eq('id', keepId);

      if (updateError) throw updateError;

      const { error: deleteError } = await supabase
        .from('mail_contacts')
        .delete()
        .in('id', mergeIds);

      if (deleteError) throw deleteError;

      // Log audit action
      await supabase.rpc('log_mail_action', {
        p_action: 'merge_contacts_enhanced',
        p_business_id: businessId,
        p_user_id: business?.created_by,
        p_details: { kept_id: keepId, merged_ids: mergeIds, merged_count: mergeIds.length }
      });

      await loadAllContacts();
      findDuplicates();
    } catch (error) {
      console.error('Error merging contacts:', error);
      alert('Failed to merge contacts. Please try again.');
    }
  };

  const handleDataCleanup = async () => {
    if (!contactsLoaded) {
      alert('Load the contact list before running data cleanup.');
      return;
    }
    if (!window.confirm('This will clean up invalid email addresses, standardize data formats, and update engagement scores. Continue?')) return;

    try {
      let cleanedCount = 0;
      
      for (const contact of allContacts) {
        let updates = {};
        let needsUpdate = false;

        // Existing cleanup logic
        if (contact.email && !isValidEmail(contact.email)) {
          updates.subscribed = false;
          needsUpdate = true;
        }

        if (contact.first_name) {
          const cleaned = contact.first_name.trim().toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
          if (cleaned !== contact.first_name) {
            updates.first_name = cleaned;
            needsUpdate = true;
          }
        }

        if (contact.last_name) {
          const cleaned = contact.last_name.trim().toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
          if (cleaned !== contact.last_name) {
            updates.last_name = cleaned;
            needsUpdate = true;
          }
        }

        // Enhanced phone cleanup
        if (contact.phone) {
          const cleaned = contact.phone.replace(/\D/g, '');
          if (cleaned.length >= 10) {
            const formatted = cleaned.length === 10 ? 
              `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}` :
              `+1 (${cleaned.slice(1,4)}) ${cleaned.slice(4,7)}-${cleaned.slice(7,11)}`;
            if (formatted !== contact.phone) {
              updates.phone = formatted;
              needsUpdate = true;
            }
          }
        }

        // New cleanup: Set default preferences if missing
        if (!contact.email_frequency) {
          updates.email_frequency = 'weekly';
          needsUpdate = true;
        }

        if (!contact.language_preference) {
          updates.language_preference = 'en';
          needsUpdate = true;
        }

        if (!contact.timezone) {
          updates.timezone = 'America/Toronto';
          needsUpdate = true;
        }

        if (needsUpdate) {
          await supabase
            .from('mail_contacts')
            .update(updates)
            .eq('id', contact.id);
          cleanedCount++;
        }
      }

      alert(`Enhanced data cleanup complete. ${cleanedCount} contacts updated with improved data quality and default preferences.`);
      await loadAllContacts();
    } catch (error) {
      console.error('Error cleaning up data:', error);
      alert('Data cleanup failed. Please try again.');
    }
  };

  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getSourceLabel = (source) => {
    const labels = {
      manual: 'Manual Entry',
      csv: 'CSV Import',
      pos: 'POS System',
      booking: 'Booking System',
      waiver: 'Waiver System',
      loyalty: 'Loyalty Program',
      website_form: 'Website Form',
      business_card: 'Business Card'
    };
    return labels[source] || source;
  };

  const getEngagementIcon = (level) => {
    switch (level) {
      case 'high': return <FiTrendingUp style={{ color: '#4caf50' }} />;
      case 'medium': return <FiTrendingUp style={{ color: '#ff9800' }} />;
      case 'low': return <FiTrendingUp style={{ color: '#f44336' }} />;
      default: return <FiClock style={{ color: '#ccc' }} />;
    }
  };

  const getConsentIcon = (status) => {
    switch (status) {
      case 'express': return <FiShield style={{ color: '#4caf50' }} />;
      case 'implied': return <FiAlertTriangle style={{ color: '#ff9800' }} />;
      default: return <FiX style={{ color: '#f44336' }} />;
    }
  };

  const totalPages = Math.ceil(totalContacts / pageSize);

  // Check if mobile viewport
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div style={styles.container}>
      {/* Email Pause Banner */}
      <EmailPauseBanner />

      {loading && (
        <div style={styles.loadingOverlay}>
          <div style={styles.loadingOverlayCard}>
            <FiRefreshCw style={{ ...styles.loadingOverlayIcon, animation: 'spin 1s linear infinite' }} />
            <div style={styles.loadingOverlayText}>Loading enhanced contact data...</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Enhanced Contact Management</h1>
          <p style={styles.subtitle}>
            {totalContacts.toLocaleString()} total contacts with engagement tracking and CASL compliance
          </p>
        </div>
        <div style={styles.headerActions}>
          <button 
            style={contactsLoaded ? styles.secondaryButton : styles.primaryButton}
            onClick={loadAllContacts}
            disabled={loading}
          >
            {contactsLoaded ? (
              <FiRefreshCw style={styles.buttonIcon} />
            ) : (
              <FiUsers style={styles.buttonIcon} />
            )}
            {loading ? (contactsLoaded ? 'Refreshing...' : 'Loading...') : (contactsLoaded ? 'Refresh Contacts' : 'Load Contact List')}
          </button>
          <button 
            style={styles.secondaryButton}
            onClick={() => setCsvImportModal(true)}
          >
            <FiUpload style={styles.buttonIcon} />
            Import CSV
          </button>
          <button 
            style={styles.secondaryButton}
            onClick={handleExportSelected}
            disabled={!contactsLoaded || loading}
          >
            <FiDownload style={styles.buttonIcon} />
            Export Enhanced
          </button>
          <button 
            style={styles.primaryButton}
            onClick={() => setAddContactModal(true)}
          >
            <FiPlus style={styles.buttonIcon} />
            Add Contact
          </button>
        </div>
      </div>

      {/* Enhanced Stats Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <FiUsers style={styles.statIcon} />
          <div>
            <div style={styles.statNumber}>{summaryLoading ? '—' : stats.total.toLocaleString()}</div>
            <div style={styles.statLabel}>Total Contacts</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiUserCheck style={styles.statIcon} />
          <div>
            <div style={styles.statNumber}>{summaryLoading ? '—' : stats.subscribed.toLocaleString()}</div>
            <div style={styles.statLabel}>Subscribed</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiTrendingUp style={styles.statIcon} />
          <div>
            <div style={styles.statNumber}>{contactsLoaded ? stats.highEngagement.toLocaleString() : '—'}</div>
            <div style={styles.statLabel}>High Engagement</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiShield style={styles.statIcon} />
          <div>
            <div style={styles.statNumber}>{contactsLoaded ? stats.withoutConsent.toLocaleString() : '—'}</div>
            <div style={styles.statLabel}>Missing Consent</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiHome style={styles.statIcon} />
          <div>
            <div style={styles.statNumber}>{contactsLoaded ? stats.householdMembers.toLocaleString() : '—'}</div>
            <div style={styles.statLabel}>Household Members</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <FiAlertTriangle style={styles.statIcon} />
          <div>
            <div style={styles.statNumber}>{contactsLoaded ? duplicates.length : '—'}</div>
            <div style={styles.statLabel}>Duplicate Groups</div>
          </div>
        </div>
      </div>

      {!contactsLoaded && (
        <div style={styles.loadNotice}>
          <FiInfo style={styles.loadNoticeIcon} />
          <div>
            <strong>The full contact list is not loaded.</strong>
            <div>Use the “Load Contact List” button above to fetch detailed contact records before running exports, cleanup, or duplicate checks.</div>
          </div>
        </div>
      )}

      {/* Enhanced Tools Bar */}
      <div style={styles.toolsBar}>
        <button 
          style={{
            ...styles.toolButton,
            opacity: (!contactsLoaded || loading) ? 0.5 : 1,
            cursor: (!contactsLoaded || loading) ? 'not-allowed' : 'pointer'
          }}
          onClick={handleDataCleanup}
          disabled={!contactsLoaded || loading}
        >
          <FiRefreshCw style={styles.buttonIcon} />
          Enhanced Cleanup
        </button>
        <button 
          style={{
            ...styles.toolButton,
            opacity: (!contactsLoaded || loading) ? 0.5 : 1,
            cursor: (!contactsLoaded || loading) ? 'not-allowed' : 'pointer'
          }}
          onClick={() => setShowDuplicates(!showDuplicates)}
          disabled={!contactsLoaded || loading}
        >
          <FiGitMerge style={styles.buttonIcon} />
          {showDuplicates ? 'Hide' : 'Show'} Duplicates
        </button>
        <button 
          style={{
            ...styles.toolButton,
            opacity: (!contactsLoaded || loading) ? 0.5 : 1,
            cursor: (!contactsLoaded || loading) ? 'not-allowed' : 'pointer'
          }}
          onClick={() => findDuplicates()}
          disabled={!contactsLoaded || loading}
        >
          <FiSearch style={styles.buttonIcon} />
          Find Duplicates
        </button>
        <button 
          style={styles.toolButton}
          onClick={() => setShowEngagementDetails(!showEngagementDetails)}
        >
          <FiEye style={styles.buttonIcon} />
          {showEngagementDetails ? 'Hide' : 'Show'} Engagement
        </button>
      </div>

      {/* Enhanced Search and Filter Bar */}
      <div style={styles.filterBar}>
        <div style={styles.searchContainer}>
          <FiSearch style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search contacts, segments, or engagement..."
            style={styles.searchInput}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div style={styles.filterContainer}>
          <select 
            style={styles.filterSelect}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
          
          <select 
            style={styles.filterSelect}
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All Sources</option>
            <option value="manual">Manual Entry</option>
            <option value="csv">CSV Import</option>
            <option value="pos">POS System</option>
            <option value="booking">Booking</option>
            <option value="waiver">Waiver</option>
            <option value="website_form">Website Form</option>
          </select>

          <select 
            style={styles.filterSelect}
            value={engagementFilter}
            onChange={(e) => setEngagementFilter(e.target.value)}
          >
            <option value="all">All Engagement</option>
            <option value="high">High Engagement</option>
            <option value="medium">Medium Engagement</option>
            <option value="low">Low Engagement</option>
            <option value="none">No Engagement</option>
          </select>

          <select 
            style={styles.filterSelect}
            value={segmentFilter}
            onChange={(e) => setSegmentFilter(e.target.value)}
          >
            <option value="all">All Segments</option>
            {segments.map(segment => (
              <option key={segment.id} value={segment.name}>
                {segment.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Enhanced Bulk Actions */}
      {selectedContacts.length > 0 && (
        <div style={styles.bulkActions}>
          <div style={styles.bulkText}>
            {selectedContacts.length} contact{selectedContacts.length !== 1 ? 's' : ''} selected
          </div>
          <div style={styles.bulkButtons}>
            <button 
              style={styles.bulkButton}
              onClick={() => handleBulkOperation('export')}
            >
              <FiDownload style={styles.buttonIcon} />
              Export Enhanced
            </button>
            <button 
              style={styles.bulkButton}
              onClick={() => handleBulkOperation('add_to_segment')}
            >
              <FiTag style={styles.buttonIcon} />
              Add to Segment
            </button>
            <button 
              style={styles.bulkButton}
              onClick={() => handleBulkOperation('update_preferences')}
            >
              <FiSettings style={styles.buttonIcon} />
              Update Preferences
            </button>
            <button 
              style={styles.bulkButton}
              onClick={() => handleBulkOperation('unsubscribe')}
            >
              <FiUserX style={styles.buttonIcon} />
              Unsubscribe
            </button>
            <button 
              style={{...styles.bulkButton, ...styles.deleteButton}}
              onClick={() => handleBulkOperation('delete')}
            >
              <FiTrash2 style={styles.buttonIcon} />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Duplicates Panel - Same as before */}
      {showDuplicates && duplicates.length > 0 && (
        <div style={styles.duplicatesPanel}>
          <h3 style={styles.duplicatesTitle}>Duplicate Contacts ({duplicates.length} groups)</h3>
          {duplicates.map((group, groupIndex) => (
            <div key={groupIndex} style={styles.duplicateGroup}>
              <div style={styles.duplicateHeader}>
                <span style={styles.duplicateType}>
                  {group.type === 'email' ? 'Same Email' : 'Same Name & Phone'}
                </span>
                <button 
                  style={styles.mergeButton}
                  onClick={() => {
                    setMergeCandidates(group.contacts);
                    setMergeModal(true);
                  }}
                >
                  <FiGitMerge style={styles.buttonIcon} />
                  Merge
                </button>
              </div>
              <div style={styles.duplicateContacts}>
                {group.contacts.map(contact => (
                  <div key={contact.id} style={styles.duplicateContact}>
                    <span style={styles.contactName}>
                      {contact.first_name} {contact.last_name}
                    </span>
                    <span style={styles.contactEmail}>{contact.email}</span>
                    <span style={styles.contactDate}>
                      {formatDate(contact.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Enhanced Contacts Table */}
      {contacts.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}><FiUsers /></div>
          <h3 style={styles.emptyTitle}>No contacts found</h3>
          <p style={styles.emptyText}>
            {searchTerm || filter !== 'all' ? 'Try adjusting your search or filters.' : 'Start by adding your first contact with enhanced tracking.'}
          </p>
          {!searchTerm && filter === 'all' && (
            <button 
              style={styles.emptyButton}
              onClick={() => setAddContactModal(true)}
            >
              <FiPlus style={styles.buttonIcon} />
              Add Your First Enhanced Contact
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile Card Layout */}
          {isMobile ? (
            <div style={styles.mobileContainer}>
              {contacts.map(contact => (
                <div key={contact.id} style={styles.mobileCard}>
                  {/* Mobile Card Header */}
                  <div style={styles.mobileCardHeader}>
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(contact.id)}
                      onChange={() => handleSelectContact(contact.id)}
                      style={styles.mobileCheckbox}
                    />
                    <div style={styles.mobileContactInfo}>
                      <div style={styles.mobileContactName}>
                        {contact.first_name} {contact.last_name}
                        {contact.household_role && (
                          <FiHome style={styles.householdIcon} title={`Household: ${contact.household_role}`} />
                        )}
                      </div>
                      <div style={styles.mobileContactEmail}>
                        <FiMail style={styles.contactIcon} />
                        {contact.email}
                      </div>
                    </div>
                    <div style={{
                      ...styles.statusBadge,
                      ...(contact.subscribed ? styles.subscribedBadge : styles.unsubscribedBadge)
                    }}>
                      {contact.subscribed ? <FiUserCheck /> : <FiUserX />}
                    </div>
                  </div>

                  {/* Mobile Card Body */}
                  <div style={styles.mobileCardBody}>
                    {/* Contact Details Row */}
                    <div style={styles.mobileRow}>
                      {contact.phone && (
                        <div style={styles.mobileField}>
                          <FiPhone style={styles.mobileIcon} />
                          <span>{contact.phone}</span>
                        </div>
                      )}
                      <div style={styles.mobileField}>
                        <span style={styles.mobileLabel}>Source:</span>
                        <span>{getSourceLabel(contact.source)}</span>
                      </div>
                    </div>

                    {/* Engagement Row */}
                    <div style={styles.mobileRow}>
                      <div style={styles.mobileField}>
                        {getEngagementIcon(contact.engagement_level)}
                        <span style={styles.mobileLabel}>Score:</span>
                        <span style={styles.mobileValue}>{contact.engagement_score || 0}</span>
                      </div>
                      {showEngagementDetails && (
                        <>
                          <div style={styles.mobileField}>
                            <FiEye style={styles.mobileIcon} />
                            <span>{contact.total_opens || 0} opens</span>
                          </div>
                          <div style={styles.mobileField}>
                            <FiMousePointer style={styles.mobileIcon} />
                            <span>{contact.total_clicks || 0} clicks</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Preferences Row */}
                    <div style={styles.mobileRow}>
                      <div style={styles.mobileField}>
                        <FiClock style={styles.mobileIcon} />
                        <span>{contact.email_frequency || 'weekly'}</span>
                      </div>
                      <div style={styles.mobileField}>
                        <FiGlobe style={styles.mobileIcon} />
                        <span>{contact.language_preference || 'en'}</span>
                      </div>
                      <div style={styles.mobileField}>
                        {getConsentIcon(contact.consent_status)}
                        <span>{contact.consent_method || 'missing'}</span>
                      </div>
                    </div>

                    {/* Segments Row */}
                    {contact.segment_names.length > 0 && (
                      <div style={styles.mobileRow}>
                        <div style={styles.mobileSegments}>
                          {contact.segment_names.slice(0, 3).map((name, index) => (
                            <span 
                              key={name} 
                              style={{
                                ...styles.mobileSegmentTag,
                                backgroundColor: contact.segment_colors[index] || '#e3f2fd'
                              }}
                            >
                              {name}
                            </span>
                          ))}
                          {contact.segment_names.length > 3 && (
                            <span style={styles.mobileMoreSegments}>
                              +{contact.segment_names.length - 3}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Actions Row */}
                    <div style={styles.mobileActions}>
                      <button 
                        style={styles.mobileActionButton}
                        onClick={() => {
                          setEditingContactId(contact.id);
                          setEditContactModal(true);
                        }}
                      >
                        <FiEdit3 />
                        Edit
                      </button>
                      <button 
                        style={styles.mobileActionButton}
                      >
                        <FiEye />
                        View
                      </button>
                      <button 
                        style={{...styles.mobileActionButton, ...styles.mobileDeleteAction}}
                        onClick={() => {
                          if (window.confirm(`Delete contact "${contact.first_name} ${contact.last_name}"?`)) {
                            setSelectedContacts([contact.id]);
                            handleBulkOperation('delete');
                          }
                        }}
                      >
                        <FiTrash2 />
                        Delete
                      </button>
                    </div>

                    {/* Date Added */}
                    <div style={styles.mobileDate}>
                      Added: {formatDate(contact.created_at)}
                      {contact.last_activity && (
                        <span style={styles.mobileLastActivity}>
                          • Last activity: {formatDate(contact.last_activity)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop Table Layout */
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeader}>
                    <th style={styles.checkboxColumn}>
                      <input
                        type="checkbox"
                        checked={selectedContacts.length === contacts.length && contacts.length > 0}
                        onChange={handleSelectAll}
                      />
                    </th>
                    <th style={styles.tableHeaderCell} onClick={() => handleSort('email')}>
                      Contact {sortField === 'email' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={styles.tableHeaderCell} onClick={() => handleSort('subscribed')}>
                      Status {sortField === 'subscribed' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={styles.tableHeaderCell} onClick={() => handleSort('engagement_score')}>
                      Engagement {sortField === 'engagement_score' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={styles.tableHeaderCell} onClick={() => handleSort('email_frequency')}>
                      Preferences {sortField === 'email_frequency' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={styles.tableHeaderCell} onClick={() => handleSort('consent_method')}>
                      CASL {sortField === 'consent_method' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={styles.tableHeaderCell} onClick={() => handleSort('source')}>
                      Source {sortField === 'source' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={styles.tableHeaderCell}>Segments</th>
                    <th style={styles.tableHeaderCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(contact => (
                    <tr key={contact.id} style={styles.tableRow}>
                      <td style={styles.checkboxColumn}>
                        <input
                          type="checkbox"
                          checked={selectedContacts.includes(contact.id)}
                          onChange={() => handleSelectContact(contact.id)}
                        />
                      </td>
                      
                      {/* Enhanced Contact Info */}
                      <td style={styles.contactColumn}>
                        <div style={styles.contactInfo}>
                          <div style={styles.contactName}>
                            {contact.first_name} {contact.last_name}
                            {contact.household_role && (
                              <FiHome style={styles.householdIcon} title={`Household: ${contact.household_role}`} />
                            )}
                          </div>
                          <div style={styles.contactDetails}>
                            <span style={styles.contactEmail}>
                              <FiMail style={styles.contactIcon} />
                              {contact.email}
                            </span>
                            {contact.phone && (
                              <span style={styles.contactPhone}>
                                <FiPhone style={styles.contactIcon} />
                                {contact.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={styles.statusColumn}>
                        <div style={{
                          ...styles.statusBadge,
                          ...(contact.subscribed ? styles.subscribedBadge : styles.unsubscribedBadge)
                        }}>
                          {contact.subscribed ? <FiUserCheck /> : <FiUserX />}
                          <span>{contact.subscribed ? 'Subscribed' : 'Unsubscribed'}</span>
                        </div>
                      </td>

                      {/* Enhanced Engagement */}
                      <td style={styles.engagementColumn}>
                        <div style={styles.engagementInfo}>
                          <div style={styles.engagementHeader}>
                            {getEngagementIcon(contact.engagement_level)}
                            <span style={styles.engagementScore}>{contact.engagement_score || 0}</span>
                          </div>
                          {showEngagementDetails && (
                            <div style={styles.engagementDetails}>
                              <span style={styles.engagementDetail}>
                                <FiEye style={styles.engagementIcon} />
                                {contact.total_opens || 0} opens
                              </span>
                              <span style={styles.engagementDetail}>
                                <FiMousePointer style={styles.engagementIcon} />
                                {contact.total_clicks || 0} clicks
                              </span>
                              {contact.last_activity && (
                                <span style={styles.lastActivity}>
                                  Last: {formatDate(contact.last_activity)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Communication Preferences */}
                      <td style={styles.preferencesColumn}>
                        <div style={styles.preferences}>
                          <span style={styles.frequency}>
                            <FiClock style={styles.prefIcon} />
                            {contact.email_frequency || 'weekly'}
                          </span>
                          <span style={styles.language}>
                            <FiGlobe style={styles.prefIcon} />
                            {contact.language_preference || 'en'}
                          </span>
                          {contact.timezone && contact.timezone !== 'America/Toronto' && (
                            <span style={styles.timezone}>
                              <FiMapPin style={styles.prefIcon} />
                              {contact.timezone}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* CASL Compliance */}
                      <td style={styles.caslColumn}>
                        <div style={styles.caslInfo}>
                          {getConsentIcon(contact.consent_status)}
                          <div style={styles.caslDetails}>
                            <span style={styles.consentMethod}>
                              {contact.consent_method || 'missing'}
                            </span>
                            <span style={styles.consentSource}>
                              {contact.consent_source || 'unknown'}
                            </span>
                            {contact.consent_timestamp && (
                              <span style={styles.consentDate}>
                                <FiCalendar style={styles.prefIcon} />
                                {formatDate(contact.consent_timestamp)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Source */}
                      <td style={styles.sourceColumn}>
                        <span style={styles.sourceText}>
                          {getSourceLabel(contact.source)}
                        </span>
                        <span style={styles.addedDate}>
                          {formatDate(contact.created_at)}
                        </span>
                      </td>

                      {/* Enhanced Segments */}
                      <td style={styles.segmentsColumn}>
                        <div style={styles.segments}>
                          {contact.segment_names.slice(0, 2).map((name, index) => (
                            <span 
                              key={name} 
                              style={{
                                ...styles.segmentTag,
                                backgroundColor: contact.segment_colors[index] || '#e3f2fd'
                              }}
                            >
                              {name}
                            </span>
                          ))}
                          {contact.segment_names.length > 2 && (
                            <span style={styles.moreSegments}>
                              +{contact.segment_names.length - 2}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={styles.actionsColumn}>
                        <button 
                          style={styles.actionButton}
                          onClick={() => {
                            setEditingContactId(contact.id);
                            setEditContactModal(true);
                          }}
                          title="Edit Contact"
                        >
                          <FiEdit3 />
                        </button>
                        <button 
                          style={styles.actionButton}
                          title="View Details"
                        >
                          <FiEye />
                        </button>
                        <button 
                          style={{...styles.actionButton, ...styles.deleteAction}}
                          onClick={() => {
                            if (window.confirm(`Delete contact "${contact.first_name} ${contact.last_name}"?`)) {
                              setSelectedContacts([contact.id]);
                              handleBulkOperation('delete');
                            }
                          }}
                          title="Delete Contact"
                        >
                          <FiTrash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination - Same as before */}
          <div style={styles.pagination}>
            <div style={styles.paginationInfo}>
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalContacts)} of {totalContacts} contacts
            </div>
            <div style={styles.paginationControls}>
              <button 
                style={styles.paginationButton}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                Previous
              </button>
              <span style={styles.pageInfo}>Page {currentPage} of {totalPages}</span>
              <button 
                style={styles.paginationButton}
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
            <div style={styles.pageSizeSelector}>
              <select 
                value={pageSize} 
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={styles.pageSizeSelect}
              >
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
            </div>
          </div>
        </>
      )}

      {/* Modals - Same as before but will use enhanced data */}
      <EditContactModal 
        isOpen={editContactModal}
        onClose={() => {
          setEditContactModal(false);
          setEditingContactId(null);
        }}
        onContactUpdated={() => {
          loadAllContacts();
        }}
        onContactDeleted={() => {
          loadAllContacts();
        }}
        contactId={editingContactId}
        businessId={businessId}
      />

      <AddContactModal 
        isOpen={addContactModal}
        onClose={() => setAddContactModal(false)}
        onContactAdded={() => {
          loadAllContacts();
        }}
        businessId={businessId}
      />

      <CSVImportModal 
        isOpen={csvImportModal}
        onClose={() => setCsvImportModal(false)}
        onImportComplete={(count) => {
          loadAllContacts();
          alert(`Successfully imported ${count} contacts with enhanced tracking!`);
        }}
        businessId={businessId}
      />

      {/* Enhanced Merge Modal */}
      {mergeModal && (
        <MergeModal
          isOpen={mergeModal}
          onClose={() => {
            setMergeModal(false);
            setMergeCandidates([]);
          }}
          candidates={mergeCandidates}
          onMergeComplete={() => {
            loadAllContacts();
            findDuplicates();
            setMergeModal(false);
            setMergeCandidates([]);
          }}
          onMerge={handleMergeContacts}
        />
      )}
    </div>
  );
};

// Enhanced MergeModal component
const MergeModal = ({ isOpen, onClose, candidates, onMerge }) => {
  const [selectedKeep, setSelectedKeep] = useState('');

  if (!isOpen || !candidates || candidates.length === 0) return null;

  const handleMerge = () => {
    if (!selectedKeep) {
      alert('Please select which contact to keep.');
      return;
    }

    const mergeIds = candidates.filter(c => c.id !== selectedKeep).map(c => c.id);
    onMerge(selectedKeep, mergeIds);
  };

  return (
    <div style={mergeStyles.overlay}>
      <div style={mergeStyles.modal}>
        <div style={mergeStyles.header}>
          <h2 style={mergeStyles.title}>Merge Duplicate Contacts</h2>
          <button style={mergeStyles.closeButton} onClick={onClose}>
            <FiX />
          </button>
        </div>
        <div style={mergeStyles.content}>
          <p style={mergeStyles.mergeText}>
            Select which contact to keep. The other contact(s) will be deleted and their data merged with enhanced engagement tracking.
          </p>
          <div style={mergeStyles.candidatesList}>
            {candidates.map(contact => (
              <label key={contact.id} style={mergeStyles.candidateLabel}>
                <input
                  type="radio"
                  name="keepContact"
                  value={contact.id}
                  checked={selectedKeep === contact.id}
                  onChange={(e) => setSelectedKeep(e.target.value)}
                  style={mergeStyles.radio}
                />
                <div style={mergeStyles.candidateInfo}>
                  <div style={mergeStyles.candidateName}>
                    {contact.first_name} {contact.last_name}
                    {contact.engagement_score > 0 && (
                      <span style={mergeStyles.engagementBadge}>
                        Score: {contact.engagement_score}
                      </span>
                    )}
                  </div>
                  <div style={mergeStyles.candidateEmail}>{contact.email}</div>
                  <div style={mergeStyles.candidateDetails}>
                    <span>Added: {new Date(contact.created_at).toLocaleDateString()}</span>
                    {contact.consent_method && (
                      <span>Consent: {contact.consent_method}</span>
                    )}
                    {contact.total_opens > 0 && (
                      <span>Opens: {contact.total_opens}</span>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div style={mergeStyles.mergeActions}>
            <button style={mergeStyles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button 
              style={mergeStyles.mergeButton} 
              onClick={handleMerge}
              disabled={!selectedKeep}
            >
              <FiGitMerge style={{ fontSize: '14px' }} />
              Merge Enhanced Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Enhanced merge modal styles
const mergeStyles = {
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
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #f0f0f0',
  },
  title: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#666',
    padding: '5px',
  },
  content: {
    padding: '20px',
  },
  mergeText: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
  },
  candidatesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '20px',
  },
  candidateLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '15px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  radio: {
    margin: '4px 0 0 0',
  },
  candidateInfo: {
    flex: 1,
  },
  candidateName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  engagementBadge: {
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  candidateEmail: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '8px',
  },
  candidateDetails: {
    fontSize: '12px',
    color: '#999',
    display: 'flex',
    gap: '15px',
    flexWrap: 'wrap',
  },
  mergeActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  },
  cancelButton: {
    backgroundColor: 'white',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '6px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  mergeButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    padding: '12px 18px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
};

export default ContactsList;
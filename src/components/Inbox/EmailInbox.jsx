// components/Inbox/EmailInbox.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';
import {
  FiMail,
  FiInbox,
  FiArchive,
  FiTrash2,
  FiRefreshCw,
  FiSearch,
  FiChevronRight,
  FiChevronDown,
  FiEye,
  FiSend,
  FiPlus,
  FiCornerUpLeft,
  FiCornerUpRight,
  FiX
} from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

const looksQuotedPrintable = (value) => /=(?:\r?\n|[A-Fa-f0-9]{2})/.test(value || '');

const decodeQuotedPrintable = (value) => {
  if (!value || !looksQuotedPrintable(value)) return value || '';

  const bytes = [];
  const withoutSoftBreaks = value.replace(/=\r?\n/g, '');

  for (let i = 0; i < withoutSoftBreaks.length; i += 1) {
    const char = withoutSoftBreaks[i];
    const hex = withoutSoftBreaks.slice(i + 1, i + 3);

    if (char === '=' && /^[A-Fa-f0-9]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
      continue;
    }

    bytes.push(withoutSoftBreaks.charCodeAt(i) & 0xff);
  }

  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return withoutSoftBreaks.replace(/=([A-Fa-f0-9]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
};

const stripHiddenEmailHtml = (html) => {
  if (!html) return '';
  return html.replace(
    /<([a-z][\w:-]*)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|mso-hide\s*:\s*all)[^>]*>[\s\S]*?<\/\1>/gi,
    ''
  );
};

const getRenderableHtmlRegion = (html) => {
  if (!html) return '';
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];

  return html
    .replace(/<head\b[\s\S]*?(?:<\/head>|$)/gi, '')
    .replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, '')
    .replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '');
};

const getVisibleHtmlText = (html) => {
  return stripHiddenEmailHtml(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
};

const getEmailBodyContent = (email) => {
  const bodyHtml = typeof email?.body_html === 'string' ? decodeQuotedPrintable(email.body_html).trim() : '';
  const bodyText = typeof email?.body_text === 'string' ? decodeQuotedPrintable(email.body_text).trim() : '';
  const renderableHtmlRegion = getRenderableHtmlRegion(bodyHtml);
  const htmlWithoutHiddenPreview = stripHiddenEmailHtml(renderableHtmlRegion);
  const htmlHasVisibleContent =
    Boolean(getVisibleHtmlText(renderableHtmlRegion)) ||
    /<(img|table|p|div|span|br|a|ul|ol|li|h[1-6])\b/i.test(htmlWithoutHiddenPreview);

  if (bodyHtml && htmlHasVisibleContent) {
    return { type: 'html', content: bodyHtml };
  }

  if (bodyText) {
    return { type: 'text', content: bodyText };
  }

  return { type: 'empty', content: '' };
};

const cleanEmailPreviewText = (email) => {
  const body = getEmailBodyContent(email).content || '';
  const decodedBody = decodeQuotedPrintable(body);
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(decodedBody);
  const previewSource = looksLikeHtml
    ? getVisibleHtmlText(getRenderableHtmlRegion(decodedBody)) || getVisibleHtmlText(decodedBody)
    : decodedBody;

  return previewSource
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (/^(from|to|cc|bcc|subject|date|message-id|mime-version|content-type|content-transfer-encoding):/i.test(line)) return false;
      if (/^--[A-Za-z0-9=_-]{8,}/.test(line)) return false;
      if (/^={2,}$/.test(line)) return false;
      if (/^<\/?[a-z][^>]*>?$/i.test(line)) return false;
      if (/^(html|head|body|meta|style|class|doctype)\b/i.test(line)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const htmlToPlainText = (html) => {
  if (!html) return '';
  const normalizedHtml = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<(p|div|li|tr|h[1-6]|blockquote)\b[^>]*>/gi, '\n');

  if (typeof document === 'undefined') {
    return normalizedHtml.replace(/<[^>]+>/g, ' ');
  }

  const container = document.createElement('div');
  container.innerHTML = normalizedHtml;
  const text = container.textContent || '';
  container.remove();
  return text;
};

const getEmailPlainText = (email) => {
  const body = getEmailBodyContent(email).content || '';
  const decodedBody = decodeQuotedPrintable(body);
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(decodedBody);
  const text = looksLikeHtml
    ? htmlToPlainText(getRenderableHtmlRegion(decodedBody) || decodedBody)
    : decodedBody;

  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return true;
      if (/^(from|to|cc|bcc|subject|date|message-id|mime-version|content-type|content-transfer-encoding):/i.test(line)) return false;
      if (/^--[A-Za-z0-9=_-]{8,}/.test(line)) return false;
      if (/^={2,}$/.test(line)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
};

const buildEmailHtmlDocument = (html) => {
  const baseStyles = `
    <style>
      html, body { margin: 0; padding: 0; background: #fff; color: #111827; font-family: Arial, sans-serif; }
      body { padding: 16px; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
    </style>
  `;

  if (/^\s*<!doctype/i.test(html) || /^\s*<html/i.test(html)) {
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${baseStyles}</head>`);
    }
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${baseStyles}</head>`);
  }

  return `<!doctype html><html><head>${baseStyles}</head><body>${html}</body></html>`;
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const textToHtml = (value) => `<div style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(value)}</div>`;

const replaceSignatureTokens = (value, variables) => String(value || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => {
  return variables[key] || '';
});

const signatureAppliesToMode = (signatureMode, composeMode) => {
  if (!signatureMode || signatureMode === 'all') return true;
  if (signatureMode === 'manual') return false;
  if (signatureMode === 'new_only') return composeMode === 'new';
  if (signatureMode === 'replies_only') return composeMode === 'reply' || composeMode === 'replyAll';
  if (signatureMode === 'forwards_only') return composeMode === 'forward';
  return false;
};

const getBusinessSignatureAddress = (business) => {
  if (business?.business_address) return business.business_address;
  return [
    business?.address_line1 || business?.address || business?.street_address,
    business?.address_line2,
    business?.business_city || business?.city,
    business?.business_state || business?.province || business?.state,
    business?.business_postal || business?.postal_code || business?.zip
  ].filter(Boolean).join(', ');
};

const getBusinessSignaturePhone = (business) => (
  business?.business_phone ||
  business?.phone ||
  business?.phone_number ||
  ''
);

const normalizeAddressList = (value) => {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
};

const uniqueAddresses = (addresses) => Array.from(new Set(
  addresses
    .map(address => String(address || '').trim().toLowerCase())
    .filter(Boolean)
));

const addSubjectPrefix = (subject, prefix) => {
  const cleanSubject = subject || '(No Subject)';
  return cleanSubject.toLowerCase().startsWith(prefix.toLowerCase())
    ? cleanSubject
    : `${prefix} ${cleanSubject}`;
};

const SYSTEM_NOREPLY_MAILBOX_ID = '__system_noreply_tavarios';
const SYSTEM_NOREPLY_ADDRESS = 'noreply@tavarios.ca';

const EmailInbox = ({ businessId: propBusinessId, selectedMailboxId = null, newMessageRequest = 0 }) => {
  const { selectedBusinessId, authUser, activePOSUser } = usePOSAuth();
  const businessId = propBusinessId || selectedBusinessId;
  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const { recordAction } = useSecurityContext({
    componentName: 'EmailInbox',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState([]);
  const [lastSelectedEmailId, setLastSelectedEmailId] = useState(null);
  const [mailboxes, setMailboxes] = useState([]);
  const [mailSignatures, setMailSignatures] = useState([]);
  const [signatureProfile, setSignatureProfile] = useState(null);
  const [businessProfile, setBusinessProfile] = useState(null);
  const [selectedMailbox, setSelectedMailbox] = useState(selectedMailboxId);
  const [hoveredEmailId, setHoveredEmailId] = useState(null);
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [filter, setFilter] = useState('all'); // all, unread, read, archived, spam
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [messageColumnWidth, setMessageColumnWidth] = useState(360);
  const [resizingColumn, setResizingColumn] = useState(null);
  const [customFolders, setCustomFolders] = useState([]);
  const [selectedCustomFolderId, setSelectedCustomFolderId] = useState(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [mailboxesCollapsed, setMailboxesCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [composeData, setComposeData] = useState({
    mode: 'new',
    mailboxId: '',
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    sourceReceivedEmailId: null,
    threadId: null,
    inReplyTo: null,
    references: null
  });

  const canView = hasPermission('inbox.emails.view') || hasElevatedPrivileges();
  const canUpdate = hasPermission('inbox.emails.update') || hasElevatedPrivileges();
  const canDelete = hasPermission('inbox.emails.delete') || hasElevatedPrivileges();
  const selectedMailboxFolderScope = useMemo(() => {
    if (!selectedMailbox) return null;
    if (selectedMailbox === SYSTEM_NOREPLY_MAILBOX_ID) {
      return { systemMailboxAddress: SYSTEM_NOREPLY_ADDRESS };
    }
    return { mailboxId: selectedMailbox };
  }, [selectedMailbox]);

  // Load mailboxes
  const loadMailboxes = useCallback(async () => {
    if (!businessId) return;
    try {
      const { data, error } = await supabase
        .from('mailboxes')
        .select('id, email_address, display_name, assigned_to_user_id, shared_with_user_ids, domain:mail_domains(id, domain, verified, ses_verification_status)')
        .eq('business_id', businessId)
        .eq('status', 'active')
        .order('email_address');

      if (error) throw error;
      const canSeeAllMailboxes = hasElevatedPrivileges();
      const visibleMailboxes = canSeeAllMailboxes
        ? data || []
        : (data || []).filter(mailbox => {
          const sharedWith = mailbox.shared_with_user_ids || [];
          return (
            mailbox.assigned_to_user_id === authUser?.id ||
            sharedWith.includes(authUser?.id)
          );
        });
      setMailboxes(visibleMailboxes);
      // Default to "All Mailboxes" so emails to accounting inbox (business_id@tavarios.ca, mailbox_id null) are visible
    } catch (error) {
      console.error('Error loading mailboxes:', error);
      toast.error('Failed to load mailboxes');
    }
  }, [authUser?.id, businessId, hasElevatedPrivileges]);

  const loadCustomFolders = useCallback(async () => {
    if (!businessId || !selectedMailboxFolderScope) {
      setCustomFolders([]);
      return;
    }
    try {
      let query = supabase
        .from('mailbox_folders')
        .select('id, name, sort_order, mailbox_id, system_mailbox_address')
        .eq('business_id', businessId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (selectedMailboxFolderScope.mailboxId) {
        query = query.eq('mailbox_id', selectedMailboxFolderScope.mailboxId);
      } else {
        query = query.ilike('system_mailbox_address', selectedMailboxFolderScope.systemMailboxAddress);
      }

      const { data, error } = await query;

      if (error) throw error;
      setCustomFolders(data || []);
    } catch (error) {
      console.error('Error loading custom folders:', error);
      toast.error('Failed to load custom folders');
    }
  }, [businessId, selectedMailboxFolderScope]);

  const loadSignatureData = useCallback(async () => {
    if (!businessId) return;
    try {
      const [signaturesResult, userResult, businessResult] = await Promise.all([
        supabase
          .from('mailbox_signatures')
          .select('*')
          .eq('business_id', businessId),
        authUser?.id
          ? supabase
            .from('users')
            .select('id, first_name, last_name, email, position')
            .eq('id', authUser.id)
            .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .maybeSingle()
      ]);

      if (signaturesResult.error) throw signaturesResult.error;
      if (userResult.error) throw userResult.error;
      if (businessResult.error) throw businessResult.error;

      const signatures = signaturesResult.data || [];
      const profile = userResult.data || null;
      const business = businessResult.data || null;

      setMailSignatures(signatures);
      setSignatureProfile(profile);
      setBusinessProfile(business);

      return { signatures, profile, business };
    } catch (error) {
      console.error('Error loading signature data:', error);
      return null;
    }
  }, [authUser?.id, businessId]);

  // Load emails
  const loadEmails = useCallback(async () => {
    if (!businessId) return;
    try {
      setLoading(true);
      const canSeeAllMailboxes = hasElevatedPrivileges();
      const visibleMailboxIds = mailboxes.map(mailbox => mailbox.id).filter(Boolean);
      if (!canSeeAllMailboxes && !selectedMailbox && visibleMailboxIds.length === 0) {
        setEmails([]);
        return;
      }

      let query = activeFolder === 'sent'
        ? supabase
          .from('mailbox_sent_emails')
          .select('*, mailbox:mailboxes(id, email_address, display_name)')
          .eq('business_id', businessId)
        : supabase
          .from('received_emails')
          .select('*, mailbox:mailboxes(id, email_address, display_name)')
          .eq('business_id', businessId);

      // Filter by mailbox if selected. Older domain-fallback rows may have an
      // incorrect mailbox_id, so inbound views also require the actual recipient.
      if (selectedMailbox) {
        if (selectedMailbox === SYSTEM_NOREPLY_MAILBOX_ID) {
          query = activeFolder === 'sent'
            ? query.ilike('from_email', SYSTEM_NOREPLY_ADDRESS)
            : query.contains('to_addresses', [SYSTEM_NOREPLY_ADDRESS]);
        } else if (activeFolder === 'sent') {
          query = query.eq('mailbox_id', selectedMailbox);
        } else {
          const mailbox = mailboxes.find(mb => mb.id === selectedMailbox);
          if (mailbox?.email_address) {
            query = query
              .eq('mailbox_id', selectedMailbox)
              .contains('to_addresses', [mailbox.email_address.toLowerCase()]);
          } else {
            query = query.eq('mailbox_id', selectedMailbox);
          }
        }
      } else if (!canSeeAllMailboxes) {
        query = query.in('mailbox_id', visibleMailboxIds);
      }

      // Apply status filter
      if (activeFolder === 'custom') {
        query = query
          .eq('mailbox_folder_id', selectedCustomFolderId)
          .neq('status', 'deleted');
      } else if (activeFolder === 'sent') {
        query = query.eq('status', 'sent');
      } else if (filter === 'unread') {
        query = query.eq('status', 'unread').is('mailbox_folder_id', null);
      } else if (filter === 'read') {
        query = query.eq('status', 'read').is('mailbox_folder_id', null);
      } else if (filter === 'archived') {
        query = query.eq('status', 'archived').is('mailbox_folder_id', null);
      } else if (filter === 'spam') {
        query = query.eq('status', 'spam').is('mailbox_folder_id', null);
      } else if (filter === 'all') {
        // Keep the primary Inbox focused; archived/spam have their own folders.
        query = query
          .neq('status', 'deleted')
          .neq('status', 'archived')
          .neq('status', 'spam')
          .is('mailbox_folder_id', null);
      }

      // Apply search
      if (searchTerm) {
        query = activeFolder === 'sent'
          ? query.or(`subject.ilike.%${searchTerm}%,from_email.ilike.%${searchTerm}%`)
          : query.or(`subject.ilike.%${searchTerm}%,from_address.ilike.%${searchTerm}%,from_name.ilike.%${searchTerm}%`);
      }

      // Order and paginate
      query = query
        .order(activeFolder === 'sent' ? 'sent_at' : 'received_at', { ascending: false })
        .range((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage - 1);

      const { data, error } = await query;

      if (error) throw error;
      setEmails((data || []).map(email => ({ ...email, __folder: activeFolder })));
    } catch (error) {
      console.error('Error loading emails:', error);
      toast.error('Failed to load emails: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [businessId, selectedMailbox, activeFolder, filter, selectedCustomFolderId, searchTerm, currentPage, itemsPerPage, mailboxes, hasElevatedPrivileges]);

  // Mark email as read/unread
  const toggleReadStatus = useCallback(async (emailId, currentStatus) => {
    if (!canUpdate) {
      toast.error('You do not have permission to update emails');
      return;
    }

    try {
      const newStatus = currentStatus === 'read' ? 'unread' : 'read';
      const { error } = await supabase
        .from('received_emails')
        .update({ status: newStatus })
        .eq('id', emailId);

      if (error) throw error;
      
      setEmails(prev => prev.map(email => 
        email.id === emailId ? { ...email, status: newStatus } : email
      ));
      
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(prev => ({ ...prev, status: newStatus }));
      }

      toast.success(`Email marked as ${newStatus}`);
    } catch (error) {
      console.error('Error updating email status:', error);
      toast.error('Failed to update email status');
    }
  }, [canUpdate, selectedEmail]);

  // Delete email
  const deleteEmail = useCallback(async (emailId) => {
    if (!canDelete) {
      toast.error('You do not have permission to delete emails');
      return;
    }

    if (!confirm('Are you sure you want to delete this email?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('received_emails')
        .update({ status: 'deleted' })
        .eq('id', emailId);

      if (error) throw error;

      setEmails(prev => prev.filter(email => email.id !== emailId));
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(null);
      }

      toast.success('Email deleted');
    } catch (error) {
      console.error('Error deleting email:', error);
      toast.error('Failed to delete email');
    }
  }, [canDelete, selectedEmail]);

  // Archive email
  const archiveEmail = useCallback(async (emailId) => {
    if (!canUpdate) {
      toast.error('You do not have permission to archive emails');
      return;
    }

    try {
      const { error } = await supabase
        .from('received_emails')
        .update({ status: 'archived' })
        .eq('id', emailId);

      if (error) throw error;

      setEmails(prev => prev.map(email => 
        email.id === emailId ? { ...email, status: 'archived' } : email
      ));

      if (selectedEmail?.id === emailId) {
        setSelectedEmail(prev => ({ ...prev, status: 'archived' }));
      }

      toast.success('Email archived');
    } catch (error) {
      console.error('Error archiving email:', error);
      toast.error('Failed to archive email');
    }
  }, [canUpdate, selectedEmail]);

  const createCustomFolder = useCallback(async (event) => {
    event.preventDefault();
    const folderName = newFolderName.trim();
    if (!folderName) return;
    if (!canUpdate) {
      toast.error('You do not have permission to create folders');
      return;
    }
    if (!selectedMailboxFolderScope) {
      toast.error('Select a mailbox before creating a folder.');
      return;
    }

    try {
      const folderScopeFields = selectedMailboxFolderScope.mailboxId
        ? { mailbox_id: selectedMailboxFolderScope.mailboxId, system_mailbox_address: null }
        : { mailbox_id: null, system_mailbox_address: selectedMailboxFolderScope.systemMailboxAddress };

      const { data, error } = await supabase
        .from('mailbox_folders')
        .insert({
          business_id: businessId,
          ...folderScopeFields,
          name: folderName,
          sort_order: customFolders.length
        })
        .select('id, name, sort_order, mailbox_id, system_mailbox_address')
        .single();

      if (error) throw error;
      setCustomFolders(prev => [...prev, data].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)));
      setNewFolderName('');
      setCreatingFolder(false);
      toast.success('Folder created');
    } catch (error) {
      console.error('Error creating custom folder:', error);
      toast.error(error?.code === '23505' ? 'A folder with that name already exists' : 'Failed to create folder');
    }
  }, [businessId, canUpdate, customFolders.length, newFolderName, selectedMailboxFolderScope]);

  const moveEmailToFolder = useCallback(async (folderId) => {
    if (!selectedEmail || activeFolder === 'sent') return;
    if (!canUpdate) {
      toast.error('You do not have permission to move emails');
      return;
    }

    const nextFolderId = folderId || null;
    try {
      const { error } = await supabase
        .from('received_emails')
        .update({ mailbox_folder_id: nextFolderId })
        .eq('id', selectedEmail.id);

      if (error) throw error;

      setSelectedEmail(prev => prev ? { ...prev, mailbox_folder_id: nextFolderId } : prev);
      setEmails(prev => activeFolder !== 'sent'
        ? prev.filter(email => email.id !== selectedEmail.id)
        : prev.map(email => (
          email.id === selectedEmail.id ? { ...email, mailbox_folder_id: nextFolderId } : email
        )));
      toast.success(nextFolderId ? 'Email moved to folder' : 'Email moved to Inbox');
    } catch (error) {
      console.error('Error moving email:', error);
      toast.error('Failed to move email');
    }
  }, [activeFolder, canUpdate, selectedEmail]);

  const toggleEmailSelection = useCallback((emailId, options = {}) => {
    if (options.shiftKey && lastSelectedEmailId) {
      const startIndex = emails.findIndex(email => email.id === lastSelectedEmailId);
      const endIndex = emails.findIndex(email => email.id === emailId);

      if (startIndex !== -1 && endIndex !== -1) {
        const [fromIndex, toIndex] = startIndex < endIndex
          ? [startIndex, endIndex]
          : [endIndex, startIndex];
        const rangeIds = emails.slice(fromIndex, toIndex + 1).map(email => email.id);
        setSelectedEmailIds(prev => [...new Set([...prev, ...rangeIds])]);
        setLastSelectedEmailId(emailId);
        return;
      }
    }

    setSelectedEmailIds(prev => (
      prev.includes(emailId)
        ? prev.filter(id => id !== emailId)
        : [...prev, emailId]
    ));
    setLastSelectedEmailId(emailId);
  }, [emails, lastSelectedEmailId]);

  const bulkDeleteEmails = useCallback(async () => {
    if (!canDelete || selectedEmailIds.length === 0 || activeFolder === 'sent') return;
    if (!confirm(`Delete ${selectedEmailIds.length} selected email(s)?`)) return;

    try {
      const { error } = await supabase
        .from('received_emails')
        .update({ status: 'deleted' })
        .in('id', selectedEmailIds);

      if (error) throw error;

      setEmails(prev => prev.filter(email => !selectedEmailIds.includes(email.id)));
      if (selectedEmailIds.includes(selectedEmail?.id)) {
        setSelectedEmail(null);
      }
      setSelectedEmailIds([]);
      setLastSelectedEmailId(null);
      toast.success('Selected emails deleted');
    } catch (error) {
      console.error('Error deleting selected emails:', error);
      toast.error('Failed to delete selected emails');
    }
  }, [activeFolder, canDelete, selectedEmail, selectedEmailIds]);

  const moveEmailsToFolder = useCallback(async (emailIds, folderId) => {
    const ids = Array.isArray(emailIds) ? emailIds.filter(Boolean) : [];
    if (!canUpdate || ids.length === 0 || activeFolder === 'sent') return;

    const nextFolderId = folderId || null;
    try {
      const { error } = await supabase
        .from('received_emails')
        .update({ mailbox_folder_id: nextFolderId })
        .in('id', ids);

      if (error) throw error;

      setEmails(prev => activeFolder !== 'sent'
        ? prev.filter(email => !ids.includes(email.id))
        : prev.map(email => (
          ids.includes(email.id) ? { ...email, mailbox_folder_id: nextFolderId } : email
        )));
      if (selectedEmail && ids.includes(selectedEmail.id)) {
        setSelectedEmail(prev => prev ? { ...prev, mailbox_folder_id: nextFolderId } : prev);
      }
      setSelectedEmailIds([]);
      setLastSelectedEmailId(null);
      toast.success(nextFolderId ? 'Emails moved to folder' : 'Emails moved to Inbox');
    } catch (error) {
      console.error('Error moving selected emails:', error);
      toast.error('Failed to move selected emails');
    }
  }, [activeFolder, canUpdate, selectedEmail]);

  // Fetch email body from S3
  const fetchEmailBody = useCallback(async (emailId) => {
    try {
      toast.loading('Fetching email body from S3...');
      
      // Call Supabase Edge Function to fetch email body
      const { data, error } = await supabase.functions.invoke('receive-email', {
        body: { 
          action: 'fetch-body',
          email_id: emailId 
        }
      });

      if (error) throw error;

      // Update the email in state
      if (data && data.body_text !== undefined) {
        setEmails(prev => prev.map(email => 
          email.id === emailId 
            ? { ...email, body_text: data.body_text, body_html: data.body_html }
            : email
        ));

        if (selectedEmail?.id === emailId) {
          setSelectedEmail(prev => ({ 
            ...prev, 
            body_text: data.body_text, 
            body_html: data.body_html 
          }));
        }

        toast.dismiss();
        toast.success('Email body fetched successfully');
      } else {
        toast.dismiss();
        toast.error('Email body not available in S3');
      }
    } catch (error) {
      console.error('Error fetching email body:', error);
      toast.dismiss();
      toast.error('Failed to fetch email body: ' + error.message);
    }
  }, [selectedEmail]);

  const getDefaultMailbox = useCallback(() => {
    return mailboxes.find(mailbox => mailbox.id === selectedMailbox) || mailboxes[0] || null;
  }, [mailboxes, selectedMailbox]);

  const getSignatureForMode = useCallback((mode, signatures = mailSignatures, mailboxContext = null) => {
    const applicable = signatures.filter(signature => signatureAppliesToMode(signature.apply_mode, mode));
    const candidateUserIds = [
      activePOSUser?.id,
      authUser?.id,
      mailboxContext?.assigned_to_user_id,
      ...(mailboxContext?.shared_with_user_ids || [])
    ].filter(Boolean);
    const assigned = applicable.find(signature => {
      const assignedUserIds = signature.assigned_user_ids || [];
      return candidateUserIds.some(userId => assignedUserIds.includes(userId));
    });
    return assigned || applicable.find(signature => signature.is_default) || null;
  }, [activePOSUser?.id, authUser?.id, mailSignatures]);

  const getSignatureVariables = useCallback((profileOverride = signatureProfile, businessOverride = businessProfile) => {
    const profile = profileOverride || {};
    const business = businessOverride || {};

    return {
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      full_name: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      position_title: profile.position || '',
      business_name: business.name || '',
      business_phone: getBusinessSignaturePhone(business),
      business_address: getBusinessSignatureAddress(business)
    };
  }, [businessProfile, signatureProfile]);

  const composeSignaturePreview = useMemo(() => {
    const mailbox = mailboxes.find(mb => mb.id === composeData.mailboxId) || null;
    const signature = getSignatureForMode(composeData.mode, mailSignatures, mailbox);
    if (!signature) return null;

    const signatureHtml = replaceSignatureTokens(
      signature.html_content || textToHtml(signature.text_content || ''),
      getSignatureVariables()
    ).trim();
    const signatureText = replaceSignatureTokens(
      signature.text_content || htmlToPlainText(signature.html_content),
      getSignatureVariables()
    ).trim();

    return {
      name: signature.name,
      html: signatureHtml,
      text: signatureText
    };
  }, [composeData.mailboxId, composeData.mode, getSignatureForMode, getSignatureVariables, mailSignatures, mailboxes]);

  const openCompose = useCallback((mode = 'new', email = null) => {
    const defaultMailbox = getDefaultMailbox();
    if (!defaultMailbox) {
      toast.error('Create an active mailbox before sending email.');
      return;
    }

    const originalBody = getEmailPlainText(email);
    const originalFrom = email?.from_address || '';
    const originalTo = normalizeAddressList(email?.to_addresses);
    const originalCc = normalizeAddressList(email?.cc_addresses);
    const currentMailboxAddresses = mailboxes.map(mailbox => mailbox.email_address.toLowerCase());
    const quoteHeader = email
      ? `\n\nOn ${email.received_at ? new Date(email.received_at).toLocaleString() : 'an earlier date'}, ${email.from_name || email.from_address || 'the sender'} wrote:\n${originalBody
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n')}`
      : '';

    let nextData = {
      mode,
      mailboxId: defaultMailbox.id,
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      body: '',
      sourceReceivedEmailId: null,
      threadId: null,
      inReplyTo: null,
      references: null
    };

    if (email && mode === 'reply') {
      nextData = {
        ...nextData,
        to: originalFrom,
        subject: addSubjectPrefix(email.subject, 'Re:'),
        body: quoteHeader,
        sourceReceivedEmailId: email.id,
        threadId: email.thread_id || email.message_id || email.id,
        inReplyTo: email.message_id || null,
        references: email.email_references || email.message_id || null
      };
    } else if (email && mode === 'replyAll') {
      const recipients = uniqueAddresses([originalFrom, ...originalTo])
        .filter(address => !currentMailboxAddresses.includes(address));
      const ccRecipients = uniqueAddresses(originalCc)
        .filter(address => !currentMailboxAddresses.includes(address));
      nextData = {
        ...nextData,
        to: recipients.join(', '),
        cc: ccRecipients.join(', '),
        subject: addSubjectPrefix(email.subject, 'Re:'),
        body: quoteHeader,
        sourceReceivedEmailId: email.id,
        threadId: email.thread_id || email.message_id || email.id,
        inReplyTo: email.message_id || null,
        references: email.email_references || email.message_id || null
      };
    } else if (email && mode === 'forward') {
      nextData = {
        ...nextData,
        subject: addSubjectPrefix(email.subject, 'Fwd:'),
        body: `\n\n---------- Forwarded message ---------\nFrom: ${email.from_name || email.from_address || 'Unknown'} <${email.from_address || ''}>\nDate: ${email.received_at ? new Date(email.received_at).toLocaleString() : ''}\nSubject: ${email.subject || '(No Subject)'}\nTo: ${originalTo.join(', ')}\n\n${originalBody}`,
        sourceReceivedEmailId: email.id,
        threadId: email.thread_id || email.message_id || email.id
      };
    }

    setComposeData(nextData);
    setComposeOpen(true);
  }, [getDefaultMailbox, mailboxes]);

  const sendMailboxEmail = useCallback(async (event) => {
    event.preventDefault();
    const mailbox = mailboxes.find(mb => mb.id === composeData.mailboxId);
    if (!mailbox) {
      toast.error('Select a mailbox to send from.');
      return;
    }

    if (!composeData.to.trim() || !composeData.subject.trim() || !composeData.body.trim()) {
      toast.error('To, subject, and message body are required.');
      return;
    }

    try {
      setSending(true);
      const latestSignatureData = await loadSignatureData();
      const signature = getSignatureForMode(
        composeData.mode,
        latestSignatureData?.signatures || mailSignatures,
        mailbox
      );
      const signatureVariables = getSignatureVariables(
        latestSignatureData?.profile || signatureProfile,
        latestSignatureData?.business || businessProfile
      );
      const signatureHtml = signature
        ? replaceSignatureTokens(signature.html_content, signatureVariables).trim()
        : '';
      const signatureText = signature
        ? replaceSignatureTokens(signature.text_content || htmlToPlainText(signature.html_content), signatureVariables).trim()
        : '';
      const bodyText = signatureText
        ? `${composeData.body}\n\n${signatureText}`
        : composeData.body;
      const bodyHtml = signatureHtml
        ? `${textToHtml(composeData.body)}<br />${signatureHtml}`
        : textToHtml(composeData.body);
      const { data, error } = await supabase.functions.invoke('mail-send', {
        body: {
          businessId,
          emailType: 'transactional',
          mailboxId: mailbox.id,
          fromEmail: mailbox.email_address,
          fromName: mailbox.display_name || mailbox.email_address,
          to: composeData.to,
          cc: composeData.cc,
          bcc: composeData.bcc,
          subject: composeData.subject,
          text: bodyText,
          html: bodyHtml,
          sourceReceivedEmailId: composeData.sourceReceivedEmailId,
          threadId: composeData.threadId,
          inReplyTo: composeData.inReplyTo,
          references: composeData.references
        }
      });

      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error || 'Email failed to send');

      toast.success('Email sent');
      setComposeOpen(false);
      await recordAction('mailbox_email_sent', true, mailbox.id);
      if (activeFolder === 'sent') {
        loadEmails();
      }
    } catch (error) {
      console.error('Error sending mailbox email:', error);
      toast.error('Failed to send email: ' + (error.message || 'Unknown error'));
      await recordAction('mailbox_email_sent', false, composeData.mailboxId);
    } finally {
      setSending(false);
    }
  }, [activeFolder, businessId, businessProfile, composeData, getSignatureForMode, getSignatureVariables, loadEmails, loadSignatureData, mailSignatures, mailboxes, recordAction, signatureProfile]);

  useEffect(() => {
    if (newMessageRequest > 0) {
      openCompose('new');
    }
  }, [newMessageRequest, openCompose]);

  useEffect(() => {
    loadMailboxes();
  }, [loadMailboxes]);

  useEffect(() => {
    loadCustomFolders();
  }, [loadCustomFolders]);

  useEffect(() => {
    loadSignatureData();
  }, [loadSignatureData]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  useEffect(() => {
    if (!resizingColumn) return undefined;

    const handleMouseMove = (event) => {
      if (resizingColumn === 'sidebar') {
        setSidebarWidth(currentWidth => Math.min(Math.max(currentWidth + event.movementX, 190), 420));
        return;
      }

      setMessageColumnWidth(currentWidth => Math.min(Math.max(currentWidth + event.movementX, 280), 640));
    };

    const handleMouseUp = () => setResizingColumn(null);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  useEffect(() => {
    if (selectedEmailIds.length === 0 || activeFolder === 'sent') return undefined;

    const handleKeyDown = (event) => {
      const targetTag = event.target?.tagName?.toLowerCase();
      const isTypingTarget =
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        targetTag === 'select' ||
        event.target?.isContentEditable;

      if (isTypingTarget) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        bulkDeleteEmails();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFolder, bulkDeleteEmails, selectedEmailIds.length]);

  useEffect(() => {
    setSelectedEmail(null);
    setSelectedEmailIds([]);
    setLastSelectedEmailId(null);
    setCurrentPage(1);
  }, [activeFolder]);

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const selectedEmailBody = useMemo(
    () => getEmailBodyContent(selectedEmail),
    [selectedEmail]
  );

  const emailActionButtonStyle = {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
    ...TavariStyles.components.button.sizes.sm,
    width: '112px',
    height: '34px',
    padding: '0 10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  const selectedMailboxRecord = selectedMailbox === SYSTEM_NOREPLY_MAILBOX_ID
    ? { id: SYSTEM_NOREPLY_MAILBOX_ID, email_address: SYSTEM_NOREPLY_ADDRESS, display_name: 'No Reply' }
    : mailboxes.find(mailbox => mailbox.id === selectedMailbox);
  const folders = [
    { id: 'inbox', label: 'Inbox', icon: FiInbox },
    { id: 'unread', label: 'Unread', icon: FiMail },
    { id: 'sent', label: 'Sent', icon: FiSend },
    { id: 'archived', label: 'Archive', icon: FiArchive },
    { id: 'spam', label: 'Spam', icon: FiTrash2 }
  ];
  const activeFolderId = activeFolder === 'custom'
    ? `custom:${selectedCustomFolderId}`
    : activeFolder === 'sent'
      ? 'sent'
      : filter === 'all'
        ? 'inbox'
        : filter;
  const activeFolderLabel = activeFolder === 'custom'
    ? customFolders.find(folder => folder.id === selectedCustomFolderId)?.name || 'Folder'
    : folders.find(folder => folder.id === activeFolderId)?.label || 'Inbox';

  const selectMailbox = (mailboxId) => {
    setSelectedMailbox(mailboxId);
    setActiveFolder('inbox');
    setFilter('all');
    setSelectedCustomFolderId(null);
    setCreatingFolder(false);
    setNewFolderName('');
    setSelectedEmail(null);
    setSelectedEmailIds([]);
    setLastSelectedEmailId(null);
    setCurrentPage(1);
  };

  const selectFolder = (folderId) => {
    if (folderId === 'sent') {
      setActiveFolder('sent');
      setFilter('all');
      setSelectedCustomFolderId(null);
    } else if (folderId.startsWith('custom:')) {
      setActiveFolder('custom');
      setFilter('all');
      setSelectedCustomFolderId(folderId.replace('custom:', ''));
    } else {
      setActiveFolder('inbox');
      setFilter(folderId === 'inbox' ? 'all' : folderId);
      setSelectedCustomFolderId(null);
    }
    setSelectedEmail(null);
    setSelectedEmailIds([]);
    setLastSelectedEmailId(null);
    setCurrentPage(1);
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 220px)',
      minHeight: '680px',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      overflow: 'hidden',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    header: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: TavariStyles.colors.white
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md
    },
    headerTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    headerSubtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginTop: '2px'
    },
    controls: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center'
    },
    searchBox: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.white,
      width: '100%',
      boxSizing: 'border-box'
    },
    searchInput: {
      border: 'none',
      outline: 'none',
      flex: 1,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    content: {
      display: 'flex',
      flex: 1,
      overflow: 'hidden'
    },
    sidebar: {
      width: `${sidebarWidth}px`,
      minWidth: '190px',
      borderRight: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column'
    },
    columnResizer: {
      width: '8px',
      flex: '0 0 8px',
      cursor: 'col-resize',
      backgroundColor: resizingColumn ? TavariStyles.colors.primaryLight : TavariStyles.colors.gray50,
      borderRight: `1px solid ${TavariStyles.colors.gray200}`,
      transition: 'background-color 0.15s'
    },
    sidebarSection: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    sidebarSectionHeader: {
      width: '100%',
      border: 'none',
      background: 'transparent',
      padding: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      cursor: 'pointer',
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.sm
    },
    sidebarTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray700,
      margin: `0 0 ${TavariStyles.spacing.sm} 0`
    },
    sidebarHint: {
      margin: `0 0 ${TavariStyles.spacing.sm} 0`,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      lineHeight: 1.4
    },
    sidebarTitleRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm
    },
    iconButton: {
      border: 'none',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm,
      width: '28px',
      height: '28px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: TavariStyles.colors.gray700
    },
    folderCreateForm: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.sm
    },
    folderCreateInput: {
      flex: 1,
      minWidth: 0,
      padding: TavariStyles.spacing.xs,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    navButton: {
      width: '100%',
      border: 'none',
      backgroundColor: 'transparent',
      borderRadius: TavariStyles.borderRadius.md,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      cursor: 'pointer',
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.sm,
      textAlign: 'left',
      marginBottom: TavariStyles.spacing.xs
    },
    navButtonActive: {
      backgroundColor: TavariStyles.colors.primaryLight,
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    navButtonLabel: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    messageColumn: {
      width: `${messageColumnWidth}px`,
      minWidth: '280px',
      borderRight: `1px solid ${TavariStyles.colors.gray200}`,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: TavariStyles.colors.white
    },
    messageColumnHeader: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    messageColumnTitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    emailList: {
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      flex: 1
    },
    emailItem: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
      cursor: 'pointer',
      transition: 'background-color 0.2s',
      backgroundColor: TavariStyles.colors.white,
      position: 'relative'
    },
    emailItemSelected: {
      backgroundColor: TavariStyles.colors.primaryLight,
      borderLeft: `3px solid ${TavariStyles.colors.primary}`
    },
    emailItemBulkSelected: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderLeft: `3px solid ${TavariStyles.colors.primary}`,
      boxShadow: `inset 0 0 0 1px ${TavariStyles.colors.primary}`
    },
    emailItemBulkSelectedText: {
      color: TavariStyles.colors.white
    },
    emailItemBulkSelectedMutedText: {
      color: 'rgba(255,255,255,0.82)'
    },
    emailItemUnread: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      backgroundColor: TavariStyles.colors.gray50
    },
    emailItemHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.xs
    },
    emailItemMain: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.sm
    },
    emailItemContent: {
      minWidth: 0,
      flex: 1
    },
    bulkToolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: TavariStyles.spacing.sm,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.primaryLight,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray800
    },
    bulkSelect: {
      height: '32px',
      minWidth: '150px',
      padding: '0 8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.white
    },
    bulkButton: {
      height: '32px',
      border: 'none',
      borderRadius: TavariStyles.borderRadius.md,
      padding: '0 10px',
      cursor: 'pointer',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700
    },
    emailFrom: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray900,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    emailDate: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500
    },
    emailRowActions: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      marginLeft: TavariStyles.spacing.sm
    },
    emailRowDeleteButton: {
      width: '28px',
      height: '28px',
      border: 'none',
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: '#fee2e2',
      color: '#b91c1c',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    emailSubject: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    emailPreview: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    emailView: {
      flex: 1,
      padding: TavariStyles.spacing.lg,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column'
    },
    emailViewHeader: {
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md
    },
    emailViewTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    emailViewMeta: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    emailViewActions: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center',
      marginTop: TavariStyles.spacing.md
    },
    moveSelect: {
      height: '34px',
      padding: '0 10px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white
    },
    emailViewBody: {
      flex: 1,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      marginTop: TavariStyles.spacing.md
    },
    emailHtmlFrame: {
      width: '100%',
      minHeight: '520px',
      border: 'none',
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: TavariStyles.colors.white
    },
    emptyState: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray500
    },
    mailboxSelect: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.lg
    },
    composeModal: {
      width: 'min(720px, 96vw)',
      maxHeight: '92vh',
      overflowY: 'auto',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.xl,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    composeHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    composeForm: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.lg
    },
    composeField: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    composeLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    composeInput: {
      padding: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    composeTextarea: {
      minHeight: '260px',
      padding: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontFamily: 'inherit',
      resize: 'vertical'
    },
    composeSignaturePreview: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xs
    },
    composeSignaturePreviewTitle: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm
    },
    composeSignaturePreviewBody: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray800,
      lineHeight: 1.5,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm,
      padding: TavariStyles.spacing.sm
    },
    composeActions: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.sm,
      paddingTop: TavariStyles.spacing.sm
    }
  };

  if (!canView) {
    return (
      <div style={styles.emptyState}>
        <FiMail size={48} style={{ marginBottom: TavariStyles.spacing.md }} />
        <p>You do not have permission to view emails</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <FiInbox size={24} />
          <div>
            <h2 style={styles.headerTitle}>Mailbox</h2>
            <div style={styles.headerSubtitle}>
              {selectedMailboxRecord
                ? selectedMailboxRecord.email_address
                : 'All Mailboxes'}
            </div>
          </div>
        </div>
        <div style={styles.controls}>
          <button
            onClick={loadEmails}
            style={{
              ...TavariStyles.components.button.base,
              ...TavariStyles.components.button.variants.secondary,
              ...TavariStyles.components.button.sizes.md,
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`
            }}
          >
            <FiRefreshCw size={18} />
          </button>
        </div>
      </div>

      <div style={styles.content}>
        <aside style={styles.sidebar}>
          <div style={styles.sidebarSection}>
            <button
              type="button"
              onClick={() => setMailboxesCollapsed(prev => !prev)}
              style={styles.sidebarSectionHeader}
            >
              <span>Mailboxes</span>
              {mailboxesCollapsed ? <FiChevronRight size={16} /> : <FiChevronDown size={16} />}
            </button>
            {!mailboxesCollapsed && (
              <>
                <button
                  type="button"
                  onClick={() => selectMailbox('')}
                  style={{
                    ...styles.navButton,
                    ...(!selectedMailbox ? styles.navButtonActive : {})
                  }}
                >
                  <FiMail size={16} />
                  <span style={styles.navButtonLabel}>All Mailboxes</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectMailbox(SYSTEM_NOREPLY_MAILBOX_ID)}
                  style={{
                    ...styles.navButton,
                    ...(selectedMailbox === SYSTEM_NOREPLY_MAILBOX_ID ? styles.navButtonActive : {})
                  }}
                  title={SYSTEM_NOREPLY_ADDRESS}
                >
                  <FiMail size={16} />
                  <span style={styles.navButtonLabel}>{SYSTEM_NOREPLY_ADDRESS}</span>
                </button>
                {mailboxes.map(mailbox => (
                  <button
                    key={mailbox.id}
                    type="button"
                    onClick={() => selectMailbox(mailbox.id)}
                    style={{
                      ...styles.navButton,
                      ...(selectedMailbox === mailbox.id ? styles.navButtonActive : {})
                    }}
                    title={mailbox.email_address}
                  >
                    <FiMail size={16} />
                    <span style={styles.navButtonLabel}>
                      {mailbox.display_name || mailbox.email_address}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div style={styles.sidebarSection}>
            <div style={styles.sidebarTitleRow}>
              <p style={{ ...styles.sidebarTitle, margin: 0 }}>Folders</p>
              <button
                type="button"
                onClick={() => setCreatingFolder(prev => !prev)}
                disabled={!selectedMailbox}
                style={{
                  ...styles.iconButton,
                  opacity: selectedMailbox ? 1 : 0.45,
                  cursor: selectedMailbox ? 'pointer' : 'not-allowed'
                }}
                title={selectedMailbox ? 'Add folder' : 'Select a mailbox to add folders'}
              >
                {creatingFolder ? <FiX size={15} /> : <FiPlus size={15} />}
              </button>
            </div>
            {!selectedMailbox && (
              <p style={styles.sidebarHint}>Select a mailbox to view or create custom folders.</p>
            )}
            {creatingFolder && (
              <form style={styles.folderCreateForm} onSubmit={createCustomFolder}>
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  style={styles.folderCreateInput}
                  autoFocus
                />
                <button
                  type="submit"
                  style={styles.iconButton}
                  title="Create folder"
                >
                  <FiPlus size={15} />
                </button>
              </form>
            )}
            {folders.map(folder => {
              const Icon = folder.icon;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => selectFolder(folder.id)}
                  onDragOver={(event) => {
                    if (folder.id === 'inbox') event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (folder.id !== 'inbox') return;
                    event.preventDefault();
                    const ids = JSON.parse(event.dataTransfer.getData('application/json') || '[]');
                    moveEmailsToFolder(ids, null);
                  }}
                  style={{
                    ...styles.navButton,
                    ...(activeFolderId === folder.id ? styles.navButtonActive : {})
                  }}
                >
                  <Icon size={16} />
                  <span style={styles.navButtonLabel}>{folder.label}</span>
                </button>
              );
            })}
            {customFolders.map(folder => (
              <button
                key={folder.id}
                type="button"
                onClick={() => selectFolder(`custom:${folder.id}`)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const ids = JSON.parse(event.dataTransfer.getData('application/json') || '[]');
                  moveEmailsToFolder(ids, folder.id);
                }}
                style={{
                  ...styles.navButton,
                  ...(activeFolderId === `custom:${folder.id}` ? styles.navButtonActive : {})
                }}
              >
                <FiArchive size={16} />
                <span style={styles.navButtonLabel}>{folder.name}</span>
              </button>
            ))}
          </div>
        </aside>
        <div
          role="separator"
          aria-label="Resize mailbox column"
          aria-orientation="vertical"
          onMouseDown={() => setResizingColumn('sidebar')}
          style={styles.columnResizer}
        />

        <section style={styles.messageColumn}>
          <div style={styles.messageColumnHeader}>
            <div style={styles.messageColumnTitle}>
              {activeFolderLabel}
            </div>
            <span style={styles.emailDate}>{emails.length} shown</span>
          </div>
          {activeFolder !== 'sent' && selectedEmailIds.length > 0 && (
            <div style={styles.bulkToolbar}>
              <strong>{selectedEmailIds.length} selected</strong>
              <select
                value=""
                onChange={(event) => {
                  moveEmailsToFolder(selectedEmailIds, event.target.value === '__inbox' ? null : event.target.value);
                  event.target.value = '';
                }}
                style={styles.bulkSelect}
              >
                <option value="">Move to...</option>
                <option value="__inbox">Inbox</option>
                {customFolders.map(folder => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              {canDelete && (
                <button type="button" onClick={bulkDeleteEmails} style={{ ...styles.bulkButton, color: '#b91c1c' }}>
                  <FiTrash2 size={14} style={{ marginRight: 6 }} />
                  Delete
                </button>
              )}
              <button type="button" onClick={() => {
                setSelectedEmailIds([]);
                setLastSelectedEmailId(null);
              }} style={styles.bulkButton}>
                Clear
              </button>
            </div>
          )}
          <div style={styles.searchBox}>
            <FiSearch size={18} color={TavariStyles.colors.gray400} />
            <input
              type="text"
              placeholder="Search emails..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              style={styles.searchInput}
            />
          </div>
          {loading && emails.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={TavariStyles.components.loading.spinner}></div>
              <p>Loading emails...</p>
            </div>
          ) : emails.length === 0 ? (
            <div style={styles.emptyState}>
              <FiMail size={40} style={{ marginBottom: TavariStyles.spacing.md }} />
              <p>No {activeFolder === 'sent' ? 'sent emails' : 'emails'} found</p>
            </div>
          ) : (
            <div style={styles.emailList}>
              {emails.map(email => (
                <div
                  key={email.id}
                  draggable={activeFolder !== 'sent'}
                  onDragStart={(event) => {
                    const ids = selectedEmailIds.includes(email.id) ? selectedEmailIds : [email.id];
                    if (!selectedEmailIds.includes(email.id)) {
                      setSelectedEmailIds(ids);
                    }
                    event.dataTransfer.setData('application/json', JSON.stringify(ids));
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onMouseEnter={() => setHoveredEmailId(email.id)}
                  onMouseLeave={() => setHoveredEmailId(null)}
                  onClick={(event) => {
                    if (event.shiftKey && activeFolder !== 'sent') {
                      toggleEmailSelection(email.id, { shiftKey: true });
                      return;
                    }
                    setSelectedEmail(email);
                    if (activeFolder !== 'sent') {
                      setLastSelectedEmailId(email.id);
                    }
                    if (activeFolder !== 'sent' && email.status === 'unread') {
                      toggleReadStatus(email.id, email.status);
                    }
                  }}
                  style={{
                    ...styles.emailItem,
                    ...(selectedEmail?.id === email.id ? styles.emailItemSelected : {}),
                    ...(email.status === 'unread' ? styles.emailItemUnread : {}),
                    ...(selectedEmailIds.includes(email.id) ? styles.emailItemBulkSelected : {})
                  }}
                >
                  <div style={styles.emailItemMain}>
                    {activeFolder !== 'sent' && (
                      <TavariCheckbox
                        checked={selectedEmailIds.includes(email.id)}
                        onChange={(checked, event) => toggleEmailSelection(email.id, { shiftKey: event?.shiftKey })}
                        appearance="native"
                        size="sm"
                        style={{ marginTop: '2px' }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    )}
                    <div style={styles.emailItemContent}>
                      <div style={styles.emailItemHeader}>
                        <div style={{
                          ...styles.emailFrom,
                          ...(selectedEmailIds.includes(email.id) ? styles.emailItemBulkSelectedText : {})
                        }}>
                          {activeFolder === 'sent'
                            ? `To: ${normalizeAddressList(email.to_addresses).join(', ')}`
                            : (email.from_name || email.from_address)}
                        </div>
                        <div style={styles.emailRowActions}>
                          <div style={{
                            ...styles.emailDate,
                            ...(selectedEmailIds.includes(email.id) ? styles.emailItemBulkSelectedMutedText : {})
                          }}>
                            {formatDate(activeFolder === 'sent' ? email.sent_at : email.received_at)}
                          </div>
                          {activeFolder !== 'sent' && canDelete && hoveredEmailId === email.id && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteEmail(email.id);
                              }}
                              style={styles.emailRowDeleteButton}
                              title="Delete email"
                            >
                              <FiTrash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{
                        ...styles.emailSubject,
                        ...(selectedEmailIds.includes(email.id) ? styles.emailItemBulkSelectedText : {})
                      }}>
                        {email.subject || '(No Subject)'}
                      </div>
                      {cleanEmailPreviewText(email) && (
                        <div style={{
                          ...styles.emailPreview,
                          ...(selectedEmailIds.includes(email.id) ? styles.emailItemBulkSelectedMutedText : {})
                        }}>
                          {cleanEmailPreviewText(email).substring(0, 100)}...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <div
          role="separator"
          aria-label="Resize message list column"
          aria-orientation="vertical"
          onMouseDown={() => setResizingColumn('messages')}
          style={styles.columnResizer}
        />

        <section style={styles.emailView}>
          {selectedEmail ? (
            <>
              <div style={styles.emailViewHeader}>
                <div style={styles.emailViewTitle}>
                  {selectedEmail.subject || '(No Subject)'}
                </div>
                <div style={styles.emailViewMeta}>
                  <div>
                    <strong>From:</strong>{' '}
                    {activeFolder === 'sent'
                      ? `${selectedEmail.from_name || selectedEmail.from_email} <${selectedEmail.from_email}>`
                      : `${selectedEmail.from_name || selectedEmail.from_address} <${selectedEmail.from_address}>`}
                  </div>
                  <div><strong>To:</strong> {normalizeAddressList(selectedEmail.to_addresses).join(', ') || 'N/A'}</div>
                  {normalizeAddressList(selectedEmail.cc_addresses).length > 0 && (
                    <div><strong>CC:</strong> {normalizeAddressList(selectedEmail.cc_addresses).join(', ')}</div>
                  )}
                  <div><strong>Date:</strong> {new Date(activeFolder === 'sent' ? selectedEmail.sent_at : selectedEmail.received_at).toLocaleString()}</div>
                </div>
                <div style={styles.emailViewActions}>
                  {activeFolder !== 'sent' && (
                    <>
                      <button
                        onClick={() => openCompose('reply', selectedEmail)}
                        style={emailActionButtonStyle}
                      >
                        <FiCornerUpLeft size={16} style={{ marginRight: TavariStyles.spacing.xs }} />
                        <span>Reply</span>
                      </button>
                      <button
                        onClick={() => openCompose('replyAll', selectedEmail)}
                        style={emailActionButtonStyle}
                      >
                        <FiCornerUpLeft size={16} style={{ marginRight: TavariStyles.spacing.xs }} />
                        <span>Reply All</span>
                      </button>
                      <button
                        onClick={() => openCompose('forward', selectedEmail)}
                        style={emailActionButtonStyle}
                      >
                        <FiCornerUpRight size={16} style={{ marginRight: TavariStyles.spacing.xs }} />
                        <span>Forward</span>
                      </button>
                      <button
                        onClick={() => toggleReadStatus(selectedEmail.id, selectedEmail.status)}
                        style={emailActionButtonStyle}
                      >
                        <span>{selectedEmail.status === 'read' ? 'Mark Unread' : 'Mark Read'}</span>
                      </button>
                      <button
                        onClick={() => archiveEmail(selectedEmail.id)}
                        style={emailActionButtonStyle}
                      >
                        <FiArchive size={16} style={{ marginRight: TavariStyles.spacing.xs }} />
                        <span>Archive</span>
                      </button>
                      <button
                        onClick={() => deleteEmail(selectedEmail.id)}
                        style={{
                          ...emailActionButtonStyle,
                          ...TavariStyles.components.button.variants.danger,
                        }}
                      >
                        <FiTrash2 size={16} style={{ marginRight: TavariStyles.spacing.xs }} />
                        <span>Delete</span>
                      </button>
                    </>
                  )}
                  {activeFolder !== 'sent' && customFolders.length > 0 && (
                    <select
                      value={selectedEmail.mailbox_folder_id || ''}
                      onChange={(e) => moveEmailToFolder(e.target.value)}
                      style={styles.moveSelect}
                    >
                      <option value="">Move to Inbox</option>
                      {customFolders.map(folder => (
                        <option key={folder.id} value={folder.id}>
                          Move to {folder.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <div style={styles.emailViewBody}>
                {selectedEmailBody.type === 'html' ? (
                  <iframe
                    title={`Email body: ${selectedEmail.subject || 'No Subject'}`}
                    srcDoc={buildEmailHtmlDocument(selectedEmailBody.content)}
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    style={styles.emailHtmlFrame}
                  />
                ) : selectedEmailBody.type === 'text' ? (
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                    {selectedEmailBody.content}
                  </pre>
                ) : (
                  <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl }}>
                    <p style={{ color: TavariStyles.colors.gray500, fontStyle: 'italic', marginBottom: TavariStyles.spacing.md }}>
                      Email body not available. The email content will be fetched from S3 storage.
                    </p>
                    {selectedEmail.raw_email_text && selectedEmail.raw_email_text.startsWith('s3://') && (
                      <button
                        onClick={() => fetchEmailBody(selectedEmail.id)}
                        style={{
                          ...TavariStyles.components.button.base,
                          ...TavariStyles.components.button.variants.primary,
                          ...TavariStyles.components.button.sizes.md
                        }}
                      >
                        <FiRefreshCw size={16} style={{ marginRight: TavariStyles.spacing.xs }} />
                        Fetch Email Body from S3
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>
              <FiEye size={48} style={{ marginBottom: TavariStyles.spacing.md }} />
              <p>Select an email to view</p>
            </div>
          )}
        </section>
      </div>
      {composeOpen && (
        <div style={styles.modalOverlay} onClick={() => !sending && setComposeOpen(false)}>
          <div style={styles.composeModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.composeHeader}>
              <h3 style={{ margin: 0 }}>
                {composeData.mode === 'new'
                  ? 'New Message'
                  : composeData.mode === 'forward'
                    ? 'Forward Email'
                    : composeData.mode === 'replyAll'
                      ? 'Reply All'
                      : 'Reply'}
              </h3>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                disabled={sending}
                style={{
                  ...TavariStyles.components.button.base,
                  ...TavariStyles.components.button.variants.secondary,
                  ...TavariStyles.components.button.sizes.sm
                }}
              >
                <FiX size={16} />
              </button>
            </div>
            <form style={styles.composeForm} onSubmit={sendMailboxEmail}>
              <div style={styles.composeField}>
                <label style={styles.composeLabel}>From</label>
                <select
                  value={composeData.mailboxId}
                  onChange={(e) => setComposeData(prev => ({ ...prev, mailboxId: e.target.value }))}
                  style={styles.composeInput}
                  disabled={sending}
                  required
                >
                  {mailboxes.map(mailbox => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {mailbox.display_name ? `${mailbox.display_name} <${mailbox.email_address}>` : mailbox.email_address}
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.composeField}>
                <label style={styles.composeLabel}>To</label>
                <input
                  value={composeData.to}
                  onChange={(e) => setComposeData(prev => ({ ...prev, to: e.target.value }))}
                  style={styles.composeInput}
                  placeholder="recipient@example.com"
                  disabled={sending}
                  required
                />
              </div>
              <div style={styles.composeField}>
                <label style={styles.composeLabel}>CC</label>
                <input
                  value={composeData.cc}
                  onChange={(e) => setComposeData(prev => ({ ...prev, cc: e.target.value }))}
                  style={styles.composeInput}
                  placeholder="optional@example.com"
                  disabled={sending}
                />
              </div>
              <div style={styles.composeField}>
                <label style={styles.composeLabel}>BCC</label>
                <input
                  value={composeData.bcc}
                  onChange={(e) => setComposeData(prev => ({ ...prev, bcc: e.target.value }))}
                  style={styles.composeInput}
                  placeholder="optional@example.com"
                  disabled={sending}
                />
              </div>
              <div style={styles.composeField}>
                <label style={styles.composeLabel}>Subject</label>
                <input
                  value={composeData.subject}
                  onChange={(e) => setComposeData(prev => ({ ...prev, subject: e.target.value }))}
                  style={styles.composeInput}
                  disabled={sending}
                  required
                />
              </div>
              <div style={styles.composeField}>
                <label style={styles.composeLabel}>Message</label>
                <textarea
                  value={composeData.body}
                  onChange={(e) => setComposeData(prev => ({ ...prev, body: e.target.value }))}
                  style={styles.composeTextarea}
                  disabled={sending}
                  required
                />
                {composeSignaturePreview && (
                  <div style={styles.composeSignaturePreview}>
                    <div style={styles.composeSignaturePreviewTitle}>
                      Signature will be added: {composeSignaturePreview.name}
                    </div>
                    <div
                      style={styles.composeSignaturePreviewBody}
                      dangerouslySetInnerHTML={{ __html: composeSignaturePreview.html || escapeHtml(composeSignaturePreview.text) }}
                    />
                  </div>
                )}
              </div>
              <div style={styles.composeActions}>
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  disabled={sending}
                  style={{
                    ...TavariStyles.components.button.base,
                    ...TavariStyles.components.button.variants.secondary,
                    ...TavariStyles.components.button.sizes.md
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  style={{
                    ...TavariStyles.components.button.base,
                    ...TavariStyles.components.button.variants.primary,
                    ...TavariStyles.components.button.sizes.md,
                    opacity: sending ? 0.7 : 1
                  }}
                >
                  <FiSend size={16} style={{ marginRight: TavariStyles.spacing.xs }} />
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailInbox;


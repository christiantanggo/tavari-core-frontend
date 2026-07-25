// screens/Portal/PortalPolicies.jsx - Employee Portal Policies Section
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { FileText, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../../utils/getPublicUserId';
import html2pdf from 'html2pdf.js';
import { applyPolicySignatureVariantToHtml, flattenPolicyDocumentForPdfEmbed } from '../../utils/policyHtmlSignatures';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';

const PortalPolicies = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [policyAssignments, setPolicyAssignments] = useState([]);
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [showPolicyViewer, setShowPolicyViewer] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');

  useEffect(() => {
    console.log('[PortalPolicies] Component mounted, loading policies...');
    loadPolicies();
    window.addEventListener('employee-profile-selection-changed', loadPolicies);
    return () => window.removeEventListener('employee-profile-selection-changed', loadPolicies);
  }, []);

  const loadPolicies = async () => {
    try {
      console.log('[PortalPolicies] Starting loadPolicies...');
      setLoading(true);
      
      // Get current user
      console.log('[PortalPolicies] Getting current user...');
      const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
      
      if (userError) {
        console.error('[PortalPolicies] Error getting user:', userError);
        throw userError;
      }
      
      if (!currentUser) {
        console.warn('[PortalPolicies] No current user found, redirecting to login');
        navigate('/portal/login');
        return;
      }

      console.log('[PortalPolicies] Current user:', {
        id: currentUser.id,
        email: currentUser.email
      });
      // Get public.users.id (business_users references public.users.id, not auth.users.id)
      const publicUserId = await getPublicUserId(currentUser.email);
      if (!publicUserId) {
        console.error('[PortalPolicies] Could not find user in public.users');
        toast.error('User profile not found');
        return;
      }
      const employeeIds = [...new Set([currentUser.id, publicUserId].filter(Boolean))];

      // Get business ID
      console.log('[PortalPolicies] Getting business ID for user:', publicUserId);
      const { data: businessUsers, error: businessError } = await supabase
        .from('business_users')
        .select('business_id')
        .eq('user_id', publicUserId)
        .limit(20);

      if (businessError) {
        console.error('[PortalPolicies] Error getting business users:', businessError);
        throw businessError;
      }

      console.log('[PortalPolicies] Business users result:', businessUsers);

      if (!businessUsers || businessUsers.length === 0) {
        console.error('[PortalPolicies] No business association found for user');
        toast.error('You are not associated with any business');
        return;
      }

      const selectedBusinessId = getEmployeePortalSelectedBusinessId();
      const businessId = businessUsers.find((row) => row.business_id === selectedBusinessId)?.business_id || businessUsers[0].business_id;
      console.log('[PortalPolicies] Business ID:', businessId);

      // Load policy assignments for this employee
      console.log('[PortalPolicies] Loading policy assignments for employee IDs:', employeeIds);
      console.log('[PortalPolicies] Business ID for filtering:', businessId);
      
      // First, get all assignments for this employee
      const { data: assignments, error } = await supabase
        .from('hr_policy_assignments')
        .select(`
          *,
          hr_policies!inner (
            id,
            policy_name,
            policy_number,
            policy_version,
            policy_type,
            policy_html,
            policy_content,
            requires_acknowledgment,
            effective_date,
            revised_date,
            updated_at,
            business_id
          )
        `)
        .in('employee_id', employeeIds)
        .eq('hr_policies.business_id', businessId)
        .order('assigned_at', { ascending: false });

      console.log('[PortalPolicies] Query executed, checking results...');

      if (error) {
        console.error('[PortalPolicies] Error loading assignments:', error);
        throw error;
      }

      console.log('[PortalPolicies] Raw assignments data:', assignments);
      console.log('[PortalPolicies] Number of assignments:', assignments?.length || 0);

      // Transform the data
      const transformed = (assignments || []).map((assignment, index) => {
        console.log(`[PortalPolicies] Processing assignment ${index}:`, {
          assignment_id: assignment.id,
          policy_id: assignment.policy_id,
          policy_data: assignment.hr_policies,
          policy_data_type: typeof assignment.hr_policies,
          is_array: Array.isArray(assignment.hr_policies),
          is_object: assignment.hr_policies && typeof assignment.hr_policies === 'object',
          has_policy_html: !!assignment.hr_policies?.policy_html,
          has_policy_content: !!assignment.hr_policies?.policy_content,
          policy_html_type: typeof assignment.hr_policies?.policy_html,
          policy_html_length: assignment.hr_policies?.policy_html?.length || 0,
          policy_html_preview: assignment.hr_policies?.policy_html?.substring(0, 100) || 'NO HTML',
          full_assignment_keys: Object.keys(assignment),
          full_assignment: JSON.stringify(assignment, null, 2).substring(0, 500)
        });

        // Handle case where hr_policies might be an array (from inner join) or object
        const policyData = Array.isArray(assignment.hr_policies) 
          ? assignment.hr_policies[0] 
          : assignment.hr_policies;

        console.log(`[PortalPolicies] Extracted policy data ${index}:`, {
          policy_name: policyData?.policy_name,
          policy_id: policyData?.id,
          has_policy_html: !!policyData?.policy_html,
          policy_html_type: typeof policyData?.policy_html,
          policy_html_length: policyData?.policy_html?.length || 0,
          policy_html_preview: policyData?.policy_html?.substring(0, 200) || 'NO HTML',
          policy_data_keys: policyData ? Object.keys(policyData) : 'NO POLICY DATA'
        });

        const transformedItem = {
          id: assignment.id,
          policy_id: assignment.policy_id,
          policy_name: policyData?.policy_name || 'Unknown Policy',
          policy_number: policyData?.policy_number,
          policy_version: policyData?.policy_version || '1.0',
          policy_type: policyData?.policy_type,
          policy_html: policyData?.policy_html,
          policy_content: policyData?.policy_content,
          effective_date: policyData?.effective_date,
          revised_date: policyData?.revised_date,
          updated_at: policyData?.updated_at,
          assigned_date: assignment.assigned_at,
          due_date: assignment.due_date,
          acknowledged: assignment.acknowledged,
          acknowledged_date: assignment.acknowledged_at,
          requires_acknowledgment: policyData?.requires_acknowledgment || false
        };

        console.log(`[PortalPolicies] Transformed assignment ${index}:`, {
          ...transformedItem,
          policy_html_preview: transformedItem.policy_html?.substring(0, 200) || 'NO HTML',
          policy_html_length: transformedItem.policy_html?.length || 0
        });
        return transformedItem;
      });

      console.log('[PortalPolicies] Final transformed assignments:', transformed);
      console.log('[PortalPolicies] Setting policy assignments state...');
      setPolicyAssignments(transformed);
      console.log('[PortalPolicies] State updated successfully');
    } catch (error) {
      console.error('[PortalPolicies] Error loading policies:', error);
      console.error('[PortalPolicies] Error details:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      toast.error('Failed to load policies');
    } finally {
      console.log('[PortalPolicies] Setting loading to false');
      setLoading(false);
    }
  };

  const handleViewPolicy = async (policy) => {
    console.log('[PortalPolicies] handleViewPolicy called with:', {
      assignment_id: policy.id,
      policy_id: policy.policy_id,
      policy_name: policy.policy_name,
      has_policy_html: !!policy.policy_html,
      has_policy_content: !!policy.policy_content,
      policy_html_length: policy.policy_html?.length || 0,
      policy_html_preview: policy.policy_html?.substring(0, 200) || 'NO HTML',
      full_policy: policy
    });
    
    // If policy HTML is missing, try to fetch it directly
    if (!policy.policy_html && !policy.policy_content && policy.policy_id) {
      console.log('[PortalPolicies] Policy HTML missing, fetching policy directly...');
      try {
        const { data: policyData, error: fetchError } = await supabase
          .from('hr_policies')
          .select('policy_html, policy_content, policy_name, policy_number, policy_version')
          .eq('id', policy.policy_id)
          .single();

        if (fetchError) {
          console.error('[PortalPolicies] Error fetching policy:', fetchError);
          toast.error('Failed to load policy content');
          return;
        }

        console.log('[PortalPolicies] Fetched policy data:', {
          policy_name: policyData.policy_name,
          has_policy_html: !!policyData.policy_html,
          has_policy_content: !!policyData.policy_content,
          policy_html_length: policyData.policy_html?.length || 0
        });

        // Update policy with fetched data
        policy.policy_html = policyData.policy_html;
        policy.policy_content = policyData.policy_content;
        policy.policy_name = policyData.policy_name || policy.policy_name;
        policy.policy_number = policyData.policy_number || policy.policy_number;
        policy.policy_version = policyData.policy_version || policy.policy_version;
      } catch (err) {
        console.error('[PortalPolicies] Error in fetch fallback:', err);
      }
    }
    
    if (!policy.policy_html && !policy.policy_content) {
      console.warn('[PortalPolicies] Policy still has no HTML or content after fetch!', policy);
      toast.error('Policy content is not available');
      return;
    }
    
    console.log('[PortalPolicies] Setting selected policy and opening viewer:', {
      policy_id: policy.policy_id,
      has_html: !!policy.policy_html,
      html_length: policy.policy_html?.length || 0
    });
    
    setSelectedPolicy(policy);
    setShowPolicyViewer(true);
    console.log('[PortalPolicies] Policy viewer opened');
  };

  const handleAcknowledgePolicy = async (policy) => {
    if (!policy.requires_acknowledgment) {
      toast.error('This policy does not require acknowledgment');
      return;
    }

    const confirmed = window.confirm(
      `By acknowledging this policy, you confirm that you have read, understood, and agree to comply with: ${policy.policy_name}\n\nDo you wish to proceed?`
    );

    if (!confirmed) return;

    setAcknowledging(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('acknowledge-employee-policy', {
        body: { assignment_id: policy.id }
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      if (!data?.assignment?.id) {
        throw new Error('No matching policy assignment was updated');
      }

      setPolicyAssignments((current) =>
        current.map((assignment) =>
          assignment.id === policy.id
            ? {
                ...assignment,
                acknowledged: true,
                acknowledged_date: data.assignment.acknowledged_at
              }
            : assignment
        )
      );
      toast.success('Policy acknowledged successfully');
      await loadPolicies();
      window.dispatchEvent(new Event('employee-account-badge-refresh'));
      setShowPolicyViewer(false);
      setSelectedPolicy(null);
    } catch (error) {
      console.error('Error acknowledging policy:', error);
      toast.error('Failed to acknowledge policy: ' + (error.message || 'Unknown error'));
    } finally {
      setAcknowledging(false);
    }
  };

  const handleDownloadPDF = async (policy) => {
    try {
      toast.loading('Generating PDF...', { id: 'pdf-generation' });

      // Refetch policy so version and dates are current
      const { data: freshPolicy, error: fetchErr } = await supabase
        .from('hr_policies')
        .select('id, policy_name, policy_html, policy_version, effective_date, revised_date, updated_at')
        .eq('id', policy.policy_id)
        .single();
      if (fetchErr || !freshPolicy?.policy_html) {
        toast.dismiss('pdf-generation');
        toast.error(freshPolicy?.policy_html ? 'Failed to load latest policy details' : 'Policy PDF not available');
        return;
      }
      const policyForPdf = { ...policy, ...freshPolicy, id: freshPolicy.id };
      const policyHtmlMerged = applyPolicySignatureVariantToHtml(policyForPdf.policy_html, 'acknowledgment');
      const { bodyHtml, headStyleText } = flattenPolicyDocumentForPdfEmbed(policyHtmlMerged);

      const LETTER_WIDTH_PX = 816;
      const fullWidthCss = [
        '#policy-pdf-root{width:' + LETTER_WIDTH_PX + 'px !important;min-width:' + LETTER_WIDTH_PX + 'px !important;max-width:none !important;box-sizing:border-box !important}',
        '#policy-pdf-root body,#policy-pdf-root .page-container{width:100% !important;min-width:' + LETTER_WIDTH_PX + 'px !important;max-width:none !important;box-sizing:border-box !important;overflow:visible !important;max-height:none !important;height:auto !important}',
        '#policy-pdf-root .page-container{padding:0.4in 1.1in 0.5in 0.35in !important}',
        '#policy-pdf-root{overflow:visible !important}',
        '#policy-pdf-root *{box-sizing:border-box !important}',
        '#policy-pdf-root .content,#policy-pdf-root .header,#policy-pdf-root .category-section{max-width:none !important;width:100% !important}',
        '#policy-pdf-root .header-title-row{display:flex !important;align-items:baseline !important;gap:12px !important}#policy-pdf-root .header .policy-title{flex:1 !important;min-width:0 !important}#policy-pdf-root .policy-meta-footer{margin-top:48px !important;padding-top:24px !important;border-top:1px solid #e5e7eb !important;display:flex !important;flex-wrap:wrap !important;gap:24px 32px !important}',
        '#policy-pdf-root .right-border{text-orientation:sideways !important}',
        '#policy-pdf-root table[data-tavari-sig-table="1"]{display:table!important;visibility:visible!important;opacity:1!important;border-collapse:collapse!important}',
        '#policy-pdf-root table[data-tavari-sig-table="1"] tr:nth-child(1) td,#policy-pdf-root table[data-tavari-sig-table="1"] tr:nth-child(4) td{min-height:14px!important;height:auto!important;line-height:1.2!important;font-size: 11px!important;border-bottom:3px solid #000000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}',
        '#policy-pdf-root table[data-tavari-sig-table="1"] td{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}'
      ].join('');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML =
        '<style>' + fullWidthCss + (headStyleText ? '\n' + headStyleText : '') + '</style>' +
        '<div id="policy-pdf-root">' + bodyHtml + '</div>';
      tempDiv.style.cssText = `
        position: absolute; left: 0; top: 0;
        width: ${LETTER_WIDTH_PX}px; min-height: 11in;
        background: #fff; visibility: visible; z-index: -1000;
        font-family: Arial, sans-serif;
      `;
      document.body.appendChild(tempDiv);

      const root = tempDiv.querySelector('#policy-pdf-root');
      const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
      const effectiveStr = formatDate(policyForPdf.effective_date);
      const revisedStr = formatDate(policyForPdf.revised_date);
      const updatedStr = formatDate(policyForPdf.updated_at);
      const versionStr = String(policyForPdf.policy_version ?? '1.0');
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
        if (titleEl) titleEl.textContent = 'Policy: ' + (policyForPdf.policy_name || '').trim();
        const labelEl = root.querySelector('.policy-label');
        if (labelEl) labelEl.remove();
      }

      tempDiv.style.overflow = 'visible';
      if (root) root.style.overflow = 'visible';
      tempDiv.offsetHeight;
      await new Promise(resolve => setTimeout(resolve, 500));
      tempDiv.offsetHeight;
      const minLetterHeightPx = Math.round(11 * 96);
      const contentWidth = Math.max(tempDiv.scrollWidth, root?.scrollWidth || 0, LETTER_WIDTH_PX);
      const contentHeight = Math.max(tempDiv.scrollHeight, root?.scrollHeight || 0, minLetterHeightPx);

      try {
        const opt = {
          margin: [0.25, 0.25, 0.25, 0.25],
          filename: `${policyForPdf.policy_name.replace(/[^a-z0-9]/gi, '_')}.pdf`,
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
        await html2pdf().set(opt).from(tempDiv).save();
        
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        
        toast.dismiss('pdf-generation');
        toast.success('PDF downloaded successfully');
      } catch (pdfError) {
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        console.error('[PDF-DOWNLOAD] Error generating PDF:', pdfError);
        toast.error('Failed to generate PDF. Please try again.', { id: 'pdf-generation' });
      }
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error('Failed to download PDF');
    }
  };

  const isPolicyOverdue = (policy) => {
    return !policy.acknowledged && policy.due_date && new Date(policy.due_date) < new Date();
  };

  const isPolicyDueSoon = (policy) => {
    return !policy.acknowledged && policy.due_date && 
           new Date(policy.due_date) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) &&
           new Date(policy.due_date) >= new Date();
  };

  const getDaysUntilDue = (dueDate) => {
    if (!dueDate) return null;
    const days = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    return days;
  };

  const pendingPolicies = policyAssignments.filter((policy) => policy.requires_acknowledgment && !policy.acknowledged);
  const acknowledgedPolicies = policyAssignments.filter((policy) => policy.acknowledged);
  const displayedPolicies = activeTab === 'pending' ? pendingPolicies : acknowledgedPolicies;

  const styles = {
    container: {
      maxWidth: '1200px',
      width: '100%',
      minWidth: 0,
      margin: '0 auto',
      padding: TavariStyles.spacing.xl,
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    tabRow: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray100,
      borderRadius: '999px',
      padding: '4px',
      width: 'fit-content',
      maxWidth: '100%',
      boxSizing: 'border-box',
      flexWrap: 'wrap'
    },
    tabButton: {
      border: 'none',
      borderRadius: '999px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: 'transparent',
      color: TavariStyles.colors.gray600,
      cursor: 'pointer',
      fontWeight: TavariStyles.typography.fontWeight.medium,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    tabButtonActive: {
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    policiesGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(350px, 100%), 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      minWidth: 0
    },
    policyCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      transition: 'all 0.2s',
      cursor: 'pointer',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    policyCardOverdue: {
      backgroundColor: '#fef2f2',
      borderColor: '#fecaca'
    },
    policyCardDueSoon: {
      backgroundColor: '#fffbeb',
      borderColor: '#fed7aa'
    },
    policyHeader: {
      marginBottom: TavariStyles.spacing.md
    },
    policyName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    policyMeta: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm
    },
    statusBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      marginTop: TavariStyles.spacing.sm
    },
    statusAcknowledged: {
      backgroundColor: '#dcfce7',
      color: '#16a34a'
    },
    statusPending: {
      backgroundColor: '#f3f4f6',
      color: '#6b7280'
    },
    statusOverdue: {
      backgroundColor: '#fee2e2',
      color: '#dc2626'
    },
    statusDueSoon: {
      backgroundColor: '#fef3c7',
      color: '#d97706'
    },
    policyActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap',
      marginTop: TavariStyles.spacing.md,
      paddingTop: TavariStyles.spacing.md,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    button: {
      flex: 1,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px'
    },
    buttonPrimary: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    buttonSecondary: {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700
    },
    buttonSuccess: {
      backgroundColor: '#14B8A6',
      color: TavariStyles.colors.white
    },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.md,
      boxSizing: 'border-box',
      overflow: 'hidden'
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '900px',
      maxHeight: 'calc(100vh - 24px)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0,0,0,0.1)',
      overflow: 'hidden',
      minWidth: 0
    },
    modalHeader: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.md,
      flexShrink: 0
    },
    modalTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      margin: 0,
      minWidth: 0,
      overflowWrap: 'anywhere'
    },
    modalCloseButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      color: TavariStyles.colors.gray600
    },
    modalContent: {
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: TavariStyles.spacing.md,
      minWidth: 0,
      WebkitOverflowScrolling: 'touch'
    },
    policyViewer: {
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      overflowX: 'hidden',
      overflowWrap: 'anywhere',
      boxSizing: 'border-box'
    },
    modalFooter: {
      padding: TavariStyles.spacing.md,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
      flexShrink: 0,
      flexWrap: 'wrap'
    },
    acknowledgeButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      backgroundColor: '#14B8A6',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['2xl'],
      color: TavariStyles.colors.gray600
    }
  };

  const getResponsivePolicyHtml = (html) => `
    <style>
      .employee-policy-viewer,
      .employee-policy-viewer * {
        box-sizing: border-box !important;
      }
      .employee-policy-viewer {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        overflow-x: hidden !important;
        color: #111827;
      }
      .employee-policy-viewer body,
      .employee-policy-viewer .page-container,
      .employee-policy-viewer .content,
      .employee-policy-viewer .header,
      .employee-policy-viewer .category-section,
      .employee-policy-viewer section,
      .employee-policy-viewer article,
      .employee-policy-viewer main {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
      }
      .employee-policy-viewer .page-container {
        padding: 16px !important;
      }
      .employee-policy-viewer .header,
      .employee-policy-viewer .header-title-row,
      .employee-policy-viewer .policy-meta,
      .employee-policy-viewer .policy-meta-footer {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 8px !important;
      }
      .employee-policy-viewer .header {
        position: static !important;
        top: auto !important;
        z-index: auto !important;
        padding: 0 0 16px 0 !important;
        margin: 0 0 16px 0 !important;
      }
      .employee-policy-viewer .policy-title,
      .employee-policy-viewer h1,
      .employee-policy-viewer h2,
      .employee-policy-viewer h3 {
        max-width: 100% !important;
        min-width: 0 !important;
        line-height: 1.25 !important;
        overflow-wrap: anywhere !important;
        white-space: normal !important;
      }
      .employee-policy-viewer p,
      .employee-policy-viewer li,
      .employee-policy-viewer div,
      .employee-policy-viewer span {
        max-width: 100% !important;
        overflow-wrap: anywhere !important;
        white-space: normal !important;
      }
      .employee-policy-viewer img,
      .employee-policy-viewer svg,
      .employee-policy-viewer canvas,
      .employee-policy-viewer table {
        max-width: 100% !important;
      }
      .employee-policy-viewer table {
        width: 100% !important;
        table-layout: fixed !important;
        border-collapse: collapse !important;
      }
      .employee-policy-viewer td,
      .employee-policy-viewer th {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }
      .employee-policy-viewer .right-border,
      .employee-policy-viewer .side-border,
      .employee-policy-viewer .policy-label,
      .employee-policy-viewer [class*="right-border"],
      .employee-policy-viewer [class*="side-border"] {
        display: none !important;
      }
      .employee-policy-viewer [style*="position: absolute"],
      .employee-policy-viewer [style*="position:absolute"] {
        position: static !important;
        transform: none !important;
      }
      .employee-policy-viewer [style*="width: 8.5in"],
      .employee-policy-viewer [style*="width:8.5in"],
      .employee-policy-viewer [style*="816px"],
      .employee-policy-viewer [style*="min-width"] {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
      }
      @media (max-width: 640px) {
        .employee-policy-viewer .page-container {
          padding: 8px !important;
        }
        .employee-policy-viewer {
          font-size: 14px !important;
        }
      }
    </style>
    <div class="employee-policy-viewer">${html}</div>
  `;

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '18px', color: TavariStyles.colors.gray600 }}>Loading policies...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Policies</h1>
        <p style={styles.subtitle}>
          Review and acknowledge company policies
        </p>
      </div>

      {policyAssignments.length === 0 ? (
        <div style={styles.emptyState}>
          <FileText size={48} style={{ color: TavariStyles.colors.gray400, marginBottom: '16px' }} />
          <p style={{ fontSize: '18px', marginBottom: '8px' }}>No policies assigned</p>
          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray500 }}>
            You don't have any policies assigned to you at this time.
          </p>
        </div>
      ) : (
        <>
          <div style={styles.tabRow}>
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              style={{
                ...styles.tabButton,
                ...(activeTab === 'pending' ? styles.tabButtonActive : {})
              }}
            >
              Needs Acknowledgment ({pendingPolicies.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('acknowledged')}
              style={{
                ...styles.tabButton,
                ...(activeTab === 'acknowledged' ? styles.tabButtonActive : {})
              }}
            >
              Acknowledged ({acknowledgedPolicies.length})
            </button>
          </div>

          {displayedPolicies.length === 0 ? (
            <div style={styles.emptyState}>
              <FileText size={42} style={{ color: TavariStyles.colors.gray400, marginBottom: '16px' }} />
              <p style={{ fontSize: '18px', marginBottom: '8px' }}>
                {activeTab === 'pending' ? 'No policies need acknowledgment' : 'No acknowledged policies yet'}
              </p>
              <p style={{ fontSize: '14px', color: TavariStyles.colors.gray500 }}>
                {activeTab === 'pending'
                  ? 'Any policies requiring your acknowledgment will appear here.'
                  : 'Policies you acknowledge will move into this tab.'}
              </p>
            </div>
          ) : (
        <div style={styles.policiesGrid}>
          {displayedPolicies.map((policy, index) => {
            console.log(`[PortalPolicies] Rendering policy card ${index}:`, {
              id: policy.id,
              policy_id: policy.policy_id,
              policy_name: policy.policy_name,
              policy_number: policy.policy_number,
              has_policy_html: !!policy.policy_html,
              has_policy_content: !!policy.policy_content,
              policy_html_length: policy.policy_html?.length || 0,
              policy_content_length: policy.policy_content?.length || 0,
              policy_html_preview: policy.policy_html?.substring(0, 100) || 'NO HTML',
              full_policy_object: policy
            });

            const overdue = isPolicyOverdue(policy);
            const dueSoon = isPolicyDueSoon(policy);
            
            return (
              <div
                key={policy.id}
                style={{
                  ...styles.policyCard,
                  ...(overdue ? styles.policyCardOverdue : {}),
                  ...(dueSoon && !overdue ? styles.policyCardDueSoon : {})
                }}
                onClick={() => {
                  console.log(`[PortalPolicies] Policy card ${index} clicked:`, policy);
                  handleViewPolicy(policy);
                }}
              >
                <div style={styles.policyHeader}>
                  <h3 style={styles.policyName}>
                    {policy.policy_number ? `${policy.policy_number} - ` : ''}{policy.policy_name || 'Unnamed Policy'}
                  </h3>
                  <div style={styles.policyMeta}>
                    Version {policy.policy_version || '1.0'} • {policy.policy_type || 'No type'}
                  </div>
                  <div style={{
                    ...styles.statusBadge,
                    ...(policy.acknowledged ? styles.statusAcknowledged :
                        overdue ? styles.statusOverdue :
                        dueSoon ? styles.statusDueSoon :
                        styles.statusPending)
                  }}>
                    {policy.acknowledged ? (
                      <>
                        <CheckCircle size={14} />
                        Acknowledged
                      </>
                    ) : overdue ? (
                      <>
                        <AlertCircle size={14} />
                        Overdue
                      </>
                    ) : dueSoon ? (
                      <>
                        <Clock size={14} />
                        Due Soon ({getDaysUntilDue(policy.due_date)} days)
                      </>
                    ) : (
                      <>
                        <Clock size={14} />
                        Pending
                      </>
                    )}
                  </div>
                </div>

                <div style={styles.policyActions}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewPolicy(policy);
                    }}
                    style={{...styles.button, ...styles.buttonPrimary}}
                  >
                    <FileText size={16} />
                    View
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadPDF(policy);
                    }}
                    style={{...styles.button, ...styles.buttonSecondary}}
                  >
                    Download PDF
                  </button>
                  {policy.requires_acknowledgment && !policy.acknowledged && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAcknowledgePolicy(policy);
                      }}
                      disabled={acknowledging}
                      style={{...styles.button, ...styles.buttonSuccess, opacity: acknowledging ? 0.6 : 1}}
                    >
                      <CheckCircle size={16} />
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
          )}
        </>
      )}

      {/* Policy Viewer Modal */}
      {showPolicyViewer && selectedPolicy && (
        <div style={styles.modalOverlay} onClick={() => setShowPolicyViewer(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                {selectedPolicy.policy_number ? `${selectedPolicy.policy_number} - ` : ''}{selectedPolicy.policy_name}
              </h2>
              <button
                onClick={() => {
                  setShowPolicyViewer(false);
                  setSelectedPolicy(null);
                }}
                style={styles.modalCloseButton}
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div style={styles.modalContent}>
              {(() => {
                console.log('[PortalPolicies] Rendering modal content for policy:', {
                  policy_id: selectedPolicy.id,
                  policy_name: selectedPolicy.policy_name,
                  has_policy_html: !!selectedPolicy.policy_html,
                  has_policy_content: !!selectedPolicy.policy_content,
                  policy_html_type: typeof selectedPolicy.policy_html,
                  policy_html_length: selectedPolicy.policy_html?.length || 0,
                  policy_html_preview: selectedPolicy.policy_html?.substring(0, 500) || 'NO HTML'
                });

                if (selectedPolicy.policy_html) {
                  console.log('[PortalPolicies] Rendering policy HTML');
                  return (
                    <div
                      style={styles.policyViewer}
                      dangerouslySetInnerHTML={{ __html: getResponsivePolicyHtml(selectedPolicy.policy_html) }}
                    />
                  );
                } else if (selectedPolicy.policy_content) {
                  console.log('[PortalPolicies] Rendering policy content (text)');
                  return (
                    <div style={{ ...styles.policyViewer, whiteSpace: 'pre-wrap', padding: '8px' }}>
                      {selectedPolicy.policy_content}
                    </div>
                  );
                } else {
                  console.warn('[PortalPolicies] No policy HTML or content available!', selectedPolicy);
                  return (
                    <div style={{ padding: '24px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                      <p>Policy content not available</p>
                      <p style={{ fontSize: '13px', marginTop: '8px', color: TavariStyles.colors.gray500 }}>
                        Policy ID: {selectedPolicy.policy_id}
                      </p>
                    </div>
                  );
                }
              })()}
            </div>

            {selectedPolicy.requires_acknowledgment && !selectedPolicy.acknowledged && (
              <div style={styles.modalFooter}>
                <button
                  onClick={() => handleAcknowledgePolicy(selectedPolicy)}
                  disabled={acknowledging}
                  style={{
                    ...styles.acknowledgeButton,
                    opacity: acknowledging ? 0.6 : 1,
                    cursor: acknowledging ? 'not-allowed' : 'pointer'
                  }}
                >
                  <CheckCircle size={18} />
                  {acknowledging ? 'Acknowledging...' : 'Acknowledge Policy'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalPolicies;


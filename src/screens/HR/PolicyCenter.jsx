// screens/HR/PolicyCenter.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import { FileText, CheckCircle, Eye, Search, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import PolicyCreationModal from '../../components/HR/PolicyCreationModal';
import PolicyEmailModal from '../../components/HR/PolicyEmailModal';
import PolicyVersionHistoryModal from '../../components/HR/PolicyVersionHistoryModal';
import PolicyTypeManager from '../../components/HR/PolicyTypeManager';
import PolicyCategoryManager from '../../components/HR/PolicyCategoryManager';
import PolicyAssignmentModal from '../../components/HR/PolicyAssignmentModal';
import OutstandingEmployeesModal from '../../components/HR/OutstandingEmployeesModal';
import {
  applyPolicySignatureVariantToHtml,
  flattenPolicyDocumentForPdfEmbed,
  enforceCeoOwnerSignatureInLivePdfRoot
} from '../../utils/policyHtmlSignatures';
import {
  normalizePolicyCategoriesFromDb,
  buildPolicyPlainTextContent,
  generatePolicyHtmlDocument
} from '../../utils/policyDocumentGenerator';

const PolicyCenter = () => {
  const navigate = useNavigate();

  // Security context
  const {
    recordAction,
    logSecurityEvent,
    checkRateLimit
  } = useSecurityContext({
    componentName: 'PolicyCenter',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  // Authentication
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
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'PolicyCenter'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Component state
  const [activeTab, setActiveTab] = useState('library'); // 'library' or 'tracker'
  const [policies, setPolicies] = useState([]);
  const [allPolicies, setAllPolicies] = useState([]); // Store all policies including archived
  const [policyAcknowledgments, setPolicyAcknowledgments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('alphabetical'); // 'alphabetical', 'policy_number', 'date'
  const [expandedPolicies, setExpandedPolicies] = useState(new Set()); // Track which policies show archived versions
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showVersionHistoryModal, setShowVersionHistoryModal] = useState(false);
  const [showPolicyTypeManager, setShowPolicyTypeManager] = useState(false);
  const [showPolicyCategoryManager, setShowPolicyCategoryManager] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [showOutstandingEmployeesModal, setShowOutstandingEmployeesModal] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [isNewVersion, setIsNewVersion] = useState(false);
  const [policyTypes, setPolicyTypes] = useState([]);
  const [policyCategories, setPolicyCategories] = useState([]);
  const [showPdfVariantModal, setShowPdfVariantModal] = useState(false);
  const [policyForPdf, setPolicyForPdf] = useState(null);

  // Permission checks
  const canViewPolicies = hasAnyPermission([
    'hr.policies.view',
    'hr.policies.view_all'
  ]) || hasElevatedPrivileges();

  const canCreatePolicies = hasPermission('hr.policies.create') || hasElevatedPrivileges();
  const canAssignPolicies = hasPermission('hr.policies.assign') || hasElevatedPrivileges();
  const canEditPolicies = hasPermission('hr.policies.edit') || hasElevatedPrivileges();
  const canSendReminders = hasPermission('hr.policies.send_reminders') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewPolicies) {
      toast.error('You do not have permission to access the Policy Center');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewPolicies]);

  useEffect(() => {
    if (selectedBusinessId && authUser && !authLoading && !permissionsLoading && canViewPolicies) {
      checkUserAndBusiness();
    }
  }, [selectedBusinessId, authUser, authLoading, permissionsLoading, canViewPolicies]);

  const checkUserAndBusiness = async () => {
    try {
      await logSecurityEvent('policy_center_access', {
        action: 'access_policy_center',
        business_id: selectedBusinessId
      }, 'low');

      // Load employees and policy data
      await loadEmployees(selectedBusinessId);
      await loadPolicies(selectedBusinessId);
      await loadPolicyAcknowledgments(selectedBusinessId);
      await loadPolicyTypes(selectedBusinessId);
      await loadPolicyCategories(selectedBusinessId);

      recordAction('view_policy_center', selectedBusinessId);
      
    } catch (error) {
      console.error('Error loading policy center:', error);
      setError('An unexpected error occurred. Please try again.');
      toast.error('Failed to load policy center');

      await logSecurityEvent('policy_center_load_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async (businessId) => {
    try {
      const { data: businessUsers, error: businessError } = await supabase
        .from('business_users')
        .select(`
          user_id,
          role,
          users!inner(
            id,
            full_name,
            email,
            phone,
            employee_number,
            first_name,
            last_name,
            hire_date,
            employment_status,
            department,
            position
          )
        `)
        .eq('business_id', businessId);

      if (businessError) {
        console.error('Error loading employees:', businessError);
        return;
      }

      const employeeList = businessUsers?.map(bu => ({
        ...bu.users,
        business_role: bu.role
      })) || [];

      // Filter out terminated employees - they should not receive policy assignments
      const activeEmployees = employeeList.filter(emp => {
        const status = (emp.employment_status || '').toLowerCase();
        return status !== 'terminated';
      });

      setEmployees(activeEmployees);
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const loadPolicyTypes = async (businessId) => {
    try {
      // Ensure default types exist
      const { error: initError } = await supabase.rpc('initialize_default_policy_types', {
        business_uuid: businessId
      });

      if (initError) {
        console.error('Error initializing default types:', initError);
      }

      // Load all active policy types
      const { data, error } = await supabase
        .from('hr_policy_types')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('type_number', { ascending: true });

      if (error) throw error;
      setPolicyTypes(data || []);
    } catch (error) {
      console.error('Error loading policy types:', error);
      toast.error('Failed to load policy types');
    }
  };

  const loadPolicyCategories = async (businessId) => {
    try {
      // Load all active policy categories
      const { data, error } = await supabase
        .from('hr_policy_categories')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .order('category_name', { ascending: true });

      if (error) throw error;
      setPolicyCategories(data || []);
    } catch (error) {
      console.error('Error loading policy categories:', error);
      toast.error('Failed to load policy categories');
    }
  };

  const loadPolicies = async (businessId) => {
    try {
      // Load all policies including archived versions
      const { data, error } = await supabase
        .from('hr_policies')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setAllPolicies(data || []);
      
      // Default: Show only current/active versions (NOT archived)
      // Exclude ALL archived policies from the main list - they'll show in expandable sections
      const currentVersions = (data || []).filter(policy => {
        const statusLower = (policy.status || '').toLowerCase();
        
        // STRICT RULE 1: Exclude ALL archived policies from main list
        if (statusLower === 'archived') {
          return false;
        }
        
        // STRICT RULE 2: Exclude old versions (not current and have a parent)
        // These are previous versions that should only show in archived sections
        if (policy.is_current_version === false && policy.parent_policy_id !== null) {
          return false;
        }
        
        // Show policies that are marked as current version
        if (policy.is_current_version === true) {
          return true;
        }
        
        // Show original policies (no parent) - these are standalone or first versions
        // They're already filtered to not be archived by rule 1
        if (policy.parent_policy_id === null) {
          return true;
        }
        
        // Default: don't show
        return false;
      });
      
      setPolicies(currentVersions);
    } catch (error) {
      console.error('Error loading policies:', error);
      toast.error('Failed to load policies');
    }
  };
  
  // Get archived versions for a specific policy
  const getArchivedVersions = (policyId) => {
    // Find all archived versions related to this policy
    // This includes:
    // 1. Archived versions that have this policy as parent
    // 2. Archived versions that share the same parent_policy_id
    // 3. The policy itself if it's archived (for original policies that were archived)
    const policy = allPolicies.find(p => p.id === policyId);
    const parentId = policy?.parent_policy_id || policyId;
    
    return allPolicies.filter(p => {
      // Include if it's archived
      if (p.status !== 'archived') return false;
      
      // Include if it has the same parent as the current policy
      if (p.parent_policy_id === parentId) return true;
      
      // Include if it's the parent itself and is archived
      if (p.id === parentId && p.status === 'archived') return true;
      
      // Include if it's a child of the current policy
      if (p.parent_policy_id === policyId) return true;
      
      return false;
    }).sort((a, b) => {
      // Sort by version number descending (newest first)
      const versionA = parseFloat(a.policy_version) || 0;
      const versionB = parseFloat(b.policy_version) || 0;
      return versionB - versionA;
    });
  };
  
  // Toggle expanded state for showing archived versions
  const toggleExpanded = (policyId) => {
    const newExpanded = new Set(expandedPolicies);
    if (newExpanded.has(policyId)) {
      newExpanded.delete(policyId);
    } else {
      newExpanded.add(policyId);
    }
    setExpandedPolicies(newExpanded);
  };
  
  // Filter and sort policies based on search and sort options
  const getFilteredAndSortedPolicies = () => {
    let filtered = [...policies];
    
    // Apply search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(policy => 
        policy.policy_name?.toLowerCase().includes(searchLower) ||
        policy.policy_number?.toLowerCase().includes(searchLower) ||
        policy.policy_type?.toLowerCase().includes(searchLower)
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'alphabetical':
          return (a.policy_name || '').localeCompare(b.policy_name || '');
        case 'policy_number':
          // Sort by policy number (e.g., "1.01", "2.03")
          const numA = a.policy_number || '';
          const numB = b.policy_number || '';
          return numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
        case 'date':
          return new Date(b.created_at) - new Date(a.created_at);
        default:
          return 0;
      }
    });
    
    return filtered;
  };

  const handleReactivatePolicy = async (policy) => {
    if (!canEditPolicies) {
      toast.error('You do not have permission to reactivate policies');
      return;
    }

    try {
      await logSecurityEvent('policy_reactivated', {
        action: 'reactivate_policy',
        policy_id: policy.id,
        policy_name: policy.policy_name,
        business_id: selectedBusinessId
      }, 'medium');

      recordAction('reactivate_policy', { policy_id: policy.id });

      const { error } = await supabase
        .from('hr_policies')
        .update({
          status: 'active',
          updated_by: authUser?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', policy.id);

      if (error) throw error;

      toast.success('Policy reactivated successfully');
      await loadPolicies(selectedBusinessId);
    } catch (error) {
      console.error('Error reactivating policy:', error);
      toast.error('Failed to reactivate policy: ' + (error.message || 'Unknown error'));
    }
  };

  const loadPolicyAcknowledgments = async (businessId) => {
    try {
      const { data, error } = await supabase
        .from('hr_policy_assignments')
        .select(`
          *,
          hr_policies (
            id,
            policy_name,
            policy_version,
            policy_type,
            requires_acknowledgment
          ),
          employee_profiles:users!hr_policy_assignments_employee_id_fkey (
            id,
            first_name,
            last_name,
            email,
            employee_number,
            employment_status
          )
        `)
        .eq('hr_policies.business_id', businessId)
        .order('assigned_at', { ascending: false });

      if (error) throw error;

      // Transform the data to match the expected format
      const transformed = (data || []).map(assignment => ({
        id: assignment.id,
        employee_id: assignment.employee_id,
        policy_id: assignment.policy_id,
        policy_name: assignment.hr_policies?.policy_name || 'Unknown Policy',
        policy_version: assignment.hr_policies?.policy_version || '1.0',
        policy_type: assignment.hr_policies?.policy_type,
        assigned_date: assignment.assigned_at,
        due_date: assignment.due_date,
        acknowledged: assignment.acknowledged,
        acknowledged_date: assignment.acknowledged_at,
        employee_profiles: assignment.employee_profiles || {
          first_name: assignment.employee_email?.split('@')[0] || 'Unknown',
          last_name: '',
          employee_number: null,
          employment_status: null
        },
        assigned_by_user: {
          first_name: 'HR',
          last_name: 'Manager'
        }
      }));

      setPolicyAcknowledgments(transformed);
    } catch (error) {
      console.error('Error loading policy acknowledgments:', error);
    }
  };

  const handleCreatePolicy = () => {
    if (!canCreatePolicies) {
      toast.error('You do not have permission to create policies');
      return;
    }

    recordAction('open_create_policy', selectedBusinessId);
    setEditingPolicy(null);
    setShowCreateModal(true);
  };

  const handleEditPolicy = (policy) => {
    if (!canEditPolicies) {
      toast.error('You do not have permission to edit policies');
      return;
    }

    recordAction('open_edit_policy', { policy_id: policy.id });
    setEditingPolicy(policy);
    setIsNewVersion(false);
    setShowCreateModal(true);
  };

  const handleCreateNewVersion = (policy) => {
    if (!canEditPolicies) {
      toast.error('You do not have permission to create new versions');
      return;
    }

    recordAction('open_create_new_version', { policy_id: policy.id });
    setEditingPolicy(policy);
    setIsNewVersion(true);
    setShowCreateModal(true);
  };

  const handleViewVersionHistory = (policy) => {
    recordAction('open_version_history', { policy_id: policy.id });
    setSelectedPolicy(policy);
    setShowVersionHistoryModal(true);
  };

  const handleDeletePolicy = async (policy) => {
    if (!canEditPolicies) {
      toast.error('You do not have permission to delete policies');
      return;
    }

    // Only allow deletion of draft/test policies
    const isTestPolicy = policy.status === 'draft' || 
                         policy.policy_name.toLowerCase().includes('test') ||
                         policy.policy_name.toLowerCase().includes('temp');

    if (!isTestPolicy) {
      toast.error('Only test/draft policies can be deleted. Please archive active policies instead.');
      return;
    }

    // Confirm deletion
    const confirmed = window.confirm(
      `Are you sure you want to delete "${policy.policy_name}"?\n\n` +
      `This action cannot be undone. All versions and assignments will be permanently deleted.`
    );

    if (!confirmed) return;

    try {
      await logSecurityEvent('policy_deleted', {
        action: 'delete_policy',
        policy_id: policy.id,
        policy_name: policy.policy_name,
        business_id: selectedBusinessId
      }, 'high');

      recordAction('delete_policy', { policy_id: policy.id });

      // First, delete all policy assignments
      const { error: assignmentsError } = await supabase
        .from('hr_policy_assignments')
        .delete()
        .eq('policy_id', policy.id);

      if (assignmentsError) {
        console.error('Error deleting policy assignments:', assignmentsError);
        // Continue with policy deletion even if assignments fail
      }

      // Delete all versions of this policy (including archived versions)
      // First, find all related versions
      const { data: allVersions, error: versionsError } = await supabase
        .from('hr_policies')
        .select('id')
        .or(`id.eq.${policy.id},parent_policy_id.eq.${policy.id}`);

      if (!versionsError && allVersions) {
        const versionIds = allVersions.map(v => v.id);
        
        // Delete all assignments for all versions
        const { error: allAssignmentsError } = await supabase
          .from('hr_policy_assignments')
          .delete()
          .in('policy_id', versionIds);

        if (allAssignmentsError) {
          console.error('Error deleting all policy assignments:', allAssignmentsError);
        }

        // Delete all versions
        const { error: deleteError } = await supabase
          .from('hr_policies')
          .delete()
          .in('id', versionIds);

        if (deleteError) throw deleteError;
      } else {
        // Fallback: just delete the single policy
        const { error: deleteError } = await supabase
          .from('hr_policies')
          .delete()
          .eq('id', policy.id);

        if (deleteError) throw deleteError;
      }

      toast.success('Policy deleted successfully');
      await loadPolicies(selectedBusinessId);
      await loadPolicyAcknowledgments(selectedBusinessId);
    } catch (error) {
      console.error('Error deleting policy:', error);
      toast.error('Failed to delete policy: ' + (error.message || 'Unknown error'));
    }
  };

  const handleArchivePolicy = async (policy) => {
    if (!canEditPolicies) {
      toast.error('You do not have permission to archive policies');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to archive "${policy.policy_name}"?\n\n` +
      `This will mark the policy as archived and inactive. You can still view it in the version history.`
    );

    if (!confirmed) return;

    try {
      await logSecurityEvent('policy_archived', {
        action: 'archive_policy',
        policy_id: policy.id,
        policy_name: policy.policy_name,
        business_id: selectedBusinessId
      }, 'medium');

      recordAction('archive_policy', { policy_id: policy.id });

      const { error } = await supabase
        .from('hr_policies')
        .update({
          status: 'archived',
          is_current_version: false,
          archived_at: new Date().toISOString(),
          archived_by: authUser?.id || null,
          updated_by: authUser?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', policy.id);

      if (error) throw error;

      toast.success('Policy archived successfully');
      await loadPolicies(selectedBusinessId);
    } catch (error) {
      console.error('Error archiving policy:', error);
      toast.error('Failed to archive policy: ' + (error.message || 'Unknown error'));
    }
  };

  const handleDeactivatePolicy = async (policy) => {
    if (!canEditPolicies) {
      toast.error('You do not have permission to deactivate policies');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to deactivate "${policy.policy_name}"?\n\n` +
      `This will set the policy status to inactive. It will no longer be available for new assignments.`
    );

    if (!confirmed) return;

    try {
      await logSecurityEvent('policy_deactivated', {
        action: 'deactivate_policy',
        policy_id: policy.id,
        policy_name: policy.policy_name,
        business_id: selectedBusinessId
      }, 'medium');

      recordAction('deactivate_policy', { policy_id: policy.id });

      const { error } = await supabase
        .from('hr_policies')
        .update({
          status: 'inactive',
          updated_by: authUser?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', policy.id);

      if (error) throw error;

      toast.success('Policy deactivated successfully');
      await loadPolicies(selectedBusinessId);
    } catch (error) {
      console.error('Error deactivating policy:', error);
      toast.error('Failed to deactivate policy: ' + (error.message || 'Unknown error'));
    }
  };

  const handlePolicySaved = (savedPolicy) => {
    recordAction('policy_saved', { policy_id: savedPolicy.id });
    loadPolicies(selectedBusinessId);
    setShowCreateModal(false);
    setEditingPolicy(null);
  };

  const handleRebuildPolicyLayout = async (policy) => {
    if (!selectedBusinessId || !policy?.id) return;
    const confirmMsg =
      'Rebuild stored policy document?\n\n' +
      'This does NOT reuse your old policy HTML. It runs the same generator as brand-new policies: it builds a fresh document from your saved category data + current branding, then writes that to the database.\n\n' +
      'Text that only lived in the old HTML (never in categories) will be lost.';
    if (!window.confirm(confirmMsg)) return;

    toast.loading('Rebuilding policy document…', { id: 'policy-rebuild' });
    try {
      const { data: row, error: rowErr } = await supabase
        .from('hr_policies')
        .select(
          'id, policy_name, policy_version, policy_number, effective_date, revised_date, policy_categories'
        )
        .eq('id', policy.id)
        .single();

      if (rowErr || !row) {
        throw rowErr || new Error('Policy not found');
      }

      const selectedCategories = normalizePolicyCategoriesFromDb(row.policy_categories);
      if (!selectedCategories.length) {
        toast.error(
          'This policy has no usable category data in the database (policy_categories is empty or unrecognizable). Open Edit and attach categories.',
          { id: 'policy-rebuild' }
        );
        return;
      }

      const { data: allCategoryRows, error: catFetchErr } = await supabase
        .from('hr_policy_categories')
        .select('*')
        .eq('business_id', selectedBusinessId);

      if (catFetchErr) throw catFetchErr;
      const categoriesForRebuild = allCategoryRows || [];

      const missingLibrary = selectedCategories.filter(
        (c) => !categoriesForRebuild.some((cat) => String(cat.id) === String(c.categoryId))
      );
      if (missingLibrary.length > 0) {
        toast.error(
          'One or more category IDs on this policy no longer exist in the database. Open Edit and re-select categories.',
          { id: 'policy-rebuild' }
        );
        return;
      }

      const businessName = businessData?.business_name || businessData?.name || 'Company';
      const { data: brandingData } = await supabase
        .from('app_branding')
        .select('primary_color, logo_url')
        .eq('business_id', selectedBusinessId)
        .maybeSingle();

      const effectiveDate = row.effective_date ? row.effective_date.split('T')[0] : '';
      const revisedDate = row.revised_date ? row.revised_date.split('T')[0] : '';

      const policyHtml = generatePolicyHtmlDocument({
        policyName: row.policy_name || 'Policy',
        businessName,
        brandingData,
        digitalSignature: null,
        policyNumber: row.policy_number || null,
        versionNumber: row.policy_version || '1.0',
        effectiveDate,
        revisedDate,
        selectedCategories,
        policyCategories: categoriesForRebuild
      });

      const policyContent = buildPolicyPlainTextContent(selectedCategories, categoriesForRebuild);

      const { error } = await supabase
        .from('hr_policies')
        .update({
          policy_html: policyHtml,
          policy_content: policyContent,
          updated_by: authUser?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id);

      if (error) throw error;

      recordAction('policy_html_rebuilt', { policy_id: row.id });
      toast.success('Saved new HTML from the policy generator (not old stored HTML). Try Fast PDF.', {
        id: 'policy-rebuild'
      });
      await loadPolicies(selectedBusinessId);
    } catch (e) {
      console.error('Rebuild policy layout:', e);
      toast.error(e?.message || 'Failed to rebuild policy document', { id: 'policy-rebuild' });
    }
  };

  const handleDownloadPDF = async (policy, options = {}) => {
    try {
      const signatureVariant = options.signatureVariant || 'acknowledgment';
      recordAction('download_policy_pdf', { policy_id: policy.id, signature_variant: signatureVariant });

      toast.loading('Generating PDF...', { id: 'pdf-generation' });

      // Refetch policy + category library. Old rows often have broken policy_html (legacy styles/markup);
      // when policy_categories still resolves, generate the same HTML as new policies so PDF is not poisoned by stored HTML.
      const [policyRes, categoriesRes, brandingRes] = await Promise.all([
        supabase
          .from('hr_policies')
          .select(
            'id, policy_name, policy_html, policy_version, policy_number, effective_date, revised_date, updated_at, policy_categories'
          )
          .eq('id', policy.id)
          .single(),
        supabase.from('hr_policy_categories').select('*').eq('business_id', selectedBusinessId),
        supabase
          .from('app_branding')
          .select('primary_color, logo_url')
          .eq('business_id', selectedBusinessId)
          .maybeSingle()
      ]);

      const { data: freshPolicy, error: fetchErr } = policyRes;
      if (fetchErr || !freshPolicy) {
        toast.dismiss('pdf-generation');
        toast.error('Failed to load latest policy details');
        return;
      }

      policy = { ...policy, ...freshPolicy };

      let allCategoryRows = categoriesRes.data || [];
      if (categoriesRes.error) {
        console.warn('[PolicyPDF] hr_policy_categories fetch failed:', categoriesRes.error);
        if (policyCategories?.length) {
          allCategoryRows = policyCategories;
        }
      }

      const brandingData = brandingRes.data || null;
      const selectedCategories = normalizePolicyCategoriesFromDb(freshPolicy.policy_categories);
      const missingCategoryIds =
        selectedCategories.length > 0
          ? selectedCategories
              .map((c) => c.categoryId)
              .filter((id) => !allCategoryRows.some((row) => String(row.id) === String(id)))
          : [];
      const categoriesResolve =
        selectedCategories.length > 0 &&
        missingCategoryIds.length === 0;

      const debugPdf =
        typeof localStorage !== 'undefined' && localStorage.getItem('TAVARI_DEBUG_POLICY_PDF') === '1';
      if (debugPdf) {
        console.info('[TAVARI Policy PDF]', {
          policyId: freshPolicy.id,
          policyName: freshPolicy.policy_name,
          signatureVariant,
          policyCategoriesRawType: freshPolicy.policy_categories == null ? 'null/undefined' : typeof freshPolicy.policy_categories,
          selectedCategoriesCount: selectedCategories.length,
          missingCategoryIds,
          categoriesResolve,
          htmlSourceWillBe: categoriesResolve ? 'generated' : 'stored_policy_html',
          storedPolicyHtmlChars: (freshPolicy.policy_html || '').length,
          libraryRowsLoaded: allCategoryRows.length,
          categoriesQueryError: categoriesRes.error?.message || null
        });
      }

      let htmlBase = (freshPolicy.policy_html || '').trim();
      if (categoriesResolve) {
        const businessName = businessData?.business_name || businessData?.name || 'Company';
        const effectiveDate = freshPolicy.effective_date ? freshPolicy.effective_date.split('T')[0] : '';
        const revisedDate = freshPolicy.revised_date ? freshPolicy.revised_date.split('T')[0] : '';
        htmlBase = generatePolicyHtmlDocument({
          policyName: freshPolicy.policy_name || 'Policy',
          businessName,
          brandingData,
          digitalSignature: null,
          policyNumber: freshPolicy.policy_number || null,
          versionNumber: freshPolicy.policy_version || '1.0',
          effectiveDate,
          revisedDate,
          selectedCategories,
          policyCategories: allCategoryRows
        });
      }

      if (!htmlBase) {
        toast.dismiss('pdf-generation');
        toast.error(
          selectedCategories.length && !categoriesResolve
            ? 'Policy categories reference missing library rows. Open Edit to fix categories, or use Rebuild layout after fixing.'
            : 'Policy HTML not available for PDF generation'
        );
        return;
      }

      const htmlForPdf = applyPolicySignatureVariantToHtml(htmlBase, signatureVariant);
      const { bodyHtml, headStyleText } = flattenPolicyDocumentForPdfEmbed(htmlForPdf);

      // Match contract system: full-width container + same html2pdf options as ContractViewScreen
      const LETTER_WIDTH_PX = 816; // 8.5in at 96 DPI
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
        '#policy-pdf-root table[data-tavari-sig-table="1"] tr:nth-child(1) td,#policy-pdf-root table[data-tavari-sig-table="1"] tr:nth-child(4) td{min-height:16px!important;height:auto!important;line-height:1.2!important;font-size: 12px!important;color:#111111!important;border-bottom:3px solid #000000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}',
        '#policy-pdf-root table[data-tavari-sig-table="1"] td{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}',
        '#policy-pdf-root [data-tavari-ceo-signature="1"]{display:block!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:50!important;overflow:visible!important}'
      ].join('');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML =
        '<style>' + fullWidthCss + (headStyleText ? '\n' + headStyleText : '') + '</style>' +
        '<div id="policy-pdf-root">' + bodyHtml + '</div>';
      tempDiv.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: ${LETTER_WIDTH_PX}px;
        min-height: 11in;
        background: #fff;
        visibility: visible;
        z-index: -1000;
        font-family: Arial, sans-serif;
      `;
      document.body.appendChild(tempDiv);

      // Ensure PDF shows current version and dates (match by label so order doesn't matter)
      const root = tempDiv.querySelector('#policy-pdf-root');
      const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
      const effectiveStr = formatDate(policy.effective_date);
      const revisedStr = formatDate(policy.revised_date);
      const updatedStr = formatDate(policy.updated_at);
      const versionStr = String(policy.policy_version ?? '1.0');
      const setMetaByLabel = (container, labelText, value) => {
        if (!container || !value) return;
        const items = container.querySelectorAll('.meta-item');
        items.forEach((item) => {
          const label = item.querySelector('.meta-label');
          if (label && label.textContent.trim().toLowerCase().startsWith(labelText.toLowerCase())) {
            const valSpan = item.querySelector('span:last-child');
            if (valSpan) valSpan.textContent = value;
          }
        });
      };
      const updateMetaContainers = (container) => {
        if (!container) return;
        setMetaByLabel(container, 'Effective Date', effectiveStr);
        setMetaByLabel(container, 'Revised Date', revisedStr);
        setMetaByLabel(container, 'Last Updated', updatedStr);
        setMetaByLabel(container, 'Version', versionStr);
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
        if (signatureVariant === 'ceo_owner') {
          enforceCeoOwnerSignatureInLivePdfRoot(root);
          root.style.overflow = 'visible';
          if (debugPdf) {
            const sigTables = root.querySelectorAll('table[data-tavari-sig-table="1"]').length;
            const ceoBlocks = root.querySelectorAll('[data-tavari-ceo-signature="1"]').length;
            console.info('[TAVARI Policy PDF] after enforceCeoOwnerSignatureInLivePdfRoot', {
              sigTables,
              ceoBlocks
            });
          }
        }
      }

      tempDiv.style.overflow = 'visible';
      tempDiv.offsetHeight;
      await new Promise(resolve => setTimeout(resolve, 500));
      tempDiv.offsetHeight;
      // html2pdf clones this node into a fixed-width overlay; explicit canvas bounds are required
      // or html2canvas often captures an empty/wrong region (blank PDF).
      const minLetterHeightPx = Math.round(11 * 96);
      const contentWidth = Math.max(tempDiv.scrollWidth, root?.scrollWidth || 0, LETTER_WIDTH_PX);
      const contentHeight = Math.max(tempDiv.scrollHeight, root?.scrollHeight || 0, minLetterHeightPx);

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
        await html2pdf().set(opt).from(tempDiv).save();
        
        // Clean up
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        
        toast.dismiss('pdf-generation');
        toast.success('PDF downloaded successfully');
      } catch (pdfError) {
        // Clean up temporary element if it still exists
        if (document.body.contains(tempDiv)) {
          document.body.removeChild(tempDiv);
        }
        console.error('[PDF-DOWNLOAD] Error generating PDF:', pdfError);
        toast.error('Failed to generate PDF. Please try again.', { id: 'pdf-generation' });
        throw pdfError;
      }

    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF: ' + (error.message || 'Unknown error'));
    }
  };

  const handleDownloadTxt = async (policy) => {
    try {
      recordAction('download_policy_txt', { policy_id: policy.id });
      let text = policy.policy_content;
      if (text == null || text === '') {
        const { data, error } = await supabase
          .from('hr_policies')
          .select('policy_content, policy_html')
          .eq('id', policy.id)
          .single();
        if (error) throw error;
        text = data?.policy_content;
        if (text == null || text === '') {
          const html = data?.policy_html;
          if (html) {
            const div = document.createElement('div');
            div.innerHTML = html;
            text = div.innerText || div.textContent || '';
          }
        }
      }
      if (!text || !String(text).trim()) {
        toast.error('No text content available for this policy');
        return;
      }
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(policy.policy_name || 'policy').replace(/[^a-z0-9]/gi, '_')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('TXT downloaded');
    } catch (error) {
      console.error('Error downloading TXT:', error);
      toast.error('Failed to download TXT: ' + (error?.message || 'Unknown error'));
    }
  };

  const handleEmailPolicy = (policy) => {
    recordAction('open_email_policy', { policy_id: policy.id });
    setSelectedPolicy(policy);
    setShowEmailModal(true);
  };

  const handleEmailSent = () => {
    setShowEmailModal(false);
    setSelectedPolicy(null);
    loadPolicyAcknowledgments(selectedBusinessId);
  };

  const handleAssignPolicy = (policy = null) => {
    if (!canAssignPolicies) {
      toast.error('You do not have permission to assign policies');
      return;
    }

    if (policy) {
      setSelectedPolicy(policy);
    }
    setShowAssignmentModal(true);
    recordAction('open_assign_policy', { policy_id: policy?.id, business_id: selectedBusinessId });
  };

  const handleAssignmentComplete = async () => {
    // Reload policy acknowledgments after assignment
    if (selectedBusinessId) {
      await loadPolicyAcknowledgments(selectedBusinessId);
    }
  };

  const handleViewPolicy = (policy) => {
    recordAction('view_policy_details', { policy_id: policy.id, policy_name: policy.policy_name });
    toast.success('View policy feature coming soon');
  };

  const handleViewOutstandingEmployees = (policyGroup) => {
    setSelectedPolicy(policyGroup);
    setShowOutstandingEmployeesModal(true);
    recordAction('view_outstanding_employees', { 
      policy_id: policyGroup.policy_id, 
      missing_signatures: policyGroup.missing_signatures 
    });
  };

  const handleEditAssignment = async (policy) => {
    if (!canEditPolicies) {
      toast.error('You do not have permission to edit policy assignments');
      return;
    }

    await logSecurityEvent('policy_assignment_edit', {
      action: 'edit_policy_assignment',
      policy_id: policy.id,
      policy_name: policy.policy_name,
      business_id: selectedBusinessId
    }, 'low');

    recordAction('edit_policy_assignment', { policy_id: policy.id });
    toast.success('Edit assignment feature coming soon');
  };

  const handleSendReminder = async (policy) => {
    if (!canSendReminders) {
      toast.error('You do not have permission to send policy reminders');
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('send_policy_reminder', 10, 60);
    if (!canProceed) {
      toast.error('Too many reminder requests. Please wait a moment.');
      return;
    }

    await logSecurityEvent('policy_reminder_sent', {
      action: 'send_policy_reminder',
      policy_id: policy.id,
      policy_name: policy.policy_name,
      employee_id: policy.employee_id,
      business_id: selectedBusinessId,
      sent_by: authUser?.id
    }, 'low');

    recordAction('policy_reminder_sent', { 
      policy_id: policy.id, 
      employee_id: policy.employee_id 
    });

    toast.success('Reminder sent successfully');
  };

  const handleReassignPolicy = async (policy) => {
    if (!canAssignPolicies) {
      toast.error('You do not have permission to reassign policies');
      return;
    }

    await logSecurityEvent('policy_reassignment', {
      action: 'reassign_policy',
      policy_id: policy.id,
      policy_name: policy.policy_name,
      business_id: selectedBusinessId
    }, 'low');

    recordAction('reassign_policy', { policy_id: policy.id });
    toast.success('Reassign policy feature coming soon');
  };

  const isTerminatedPolicyAssignment = (assignment) => {
    const status = (assignment.employee_profiles?.employment_status || '').trim().toLowerCase();
    return status.includes('terminated');
  };

  const activePolicyAcknowledgments = policyAcknowledgments.filter(
    (assignment) => !isTerminatedPolicyAssignment(assignment)
  );

  // Group active employee assignments by policy to count missing signatures.
  // Terminated employees are excluded so tracking stops once employment ends.
  const policyGroups = activePolicyAcknowledgments.reduce((acc, assignment) => {
    const policyId = assignment.policy_id;
    if (!acc[policyId]) {
      acc[policyId] = {
        policy_id: policyId,
        policy_name: assignment.policy_name,
        policy_version: assignment.policy_version,
        policy_type: assignment.policy_type,
        total_assignments: 0,
        acknowledged_count: 0,
        missing_signatures: 0,
        assignments: []
      };
    }
    acc[policyId].total_assignments++;
    if (assignment.acknowledged) {
      acc[policyId].acknowledged_count++;
    } else {
      acc[policyId].missing_signatures++;
    }
    acc[policyId].assignments.push(assignment);
    return acc;
  }, {});

  // Convert to array and sort by missing signatures (most missing first)
  const policiesByMissingSignatures = Object.values(policyGroups)
    .sort((a, b) => b.missing_signatures - a.missing_signatures);

  const filteredPolicies = activePolicyAcknowledgments.filter(assignment => {
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'acknowledged' && assignment.acknowledged) ||
      (statusFilter === 'pending' && !assignment.acknowledged) ||
      (statusFilter === 'overdue' && isPolicyOverdue(assignment)) ||
      (statusFilter === 'due_soon' && isPolicyDueSoon(assignment));
    
    const matchesEmployee = employeeFilter === 'all' || assignment.employee_id === employeeFilter;
    return matchesStatus && matchesEmployee;
  });

  const getStatusBadgeStyle = (policy) => {
    const baseStyle = {
      padding: '4px 8px',
      borderRadius: '12px',
      fontSize: '16px',
      fontWeight: '500',
      display: 'inline-block'
    };

    if (policy.acknowledged) {
      return { ...baseStyle, backgroundColor: '#dcfce7', color: '#16a34a' };
    }
    if (isPolicyOverdue(policy)) {
      return { ...baseStyle, backgroundColor: '#fee2e2', color: '#dc2626' };
    }
    if (isPolicyDueSoon(policy)) {
      return { ...baseStyle, backgroundColor: '#fef3c7', color: '#d97706' };
    }
    return { ...baseStyle, backgroundColor: '#f3f4f6', color: '#374151' };
  };

  const getStatusText = (policy) => {
    if (policy.acknowledged) {
      return 'Acknowledged';
    }
    if (isPolicyOverdue(policy)) {
      return 'Overdue';
    }
    if (isPolicyDueSoon(policy)) {
      return 'Due Soon';
    }
    return 'Pending';
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

  const overduePolicies = activePolicyAcknowledgments.filter(isPolicyOverdue);
  const policiesDueSoon = activePolicyAcknowledgments.filter(isPolicyDueSoon);

  const handleBackToDashboard = () => {
    navigate('/dashboard/hr/dashboard');
  };

  // Loading and error states
  if (permissionsLoading || authLoading || loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '0px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '3px solid #14B8A6',
            borderTop: '3px solid transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 8px auto'
          }}></div>
          <p style={{ 
            margin: 0, 
            color: '#6b7280',
            fontSize: '24px',
            fontWeight: '500'
          }}>
            Loading Policy Center...
          </p>
        </div>
      </div>
    );
  }

  if (!canViewPolicies) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '0px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ 
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h2 style={{ 
            fontSize: '16px', 
            fontWeight: '600', 
            color: '#111827', 
            margin: '0 0 8px 0'
          }}>
            Access Denied
          </h2>
          <p style={{ 
            color: '#6b7280', 
            marginBottom: '20px',
            fontSize: '16px',
            lineHeight: '1.5',
            margin: '0 0 20px 0'
          }}>
            You do not have permission to access the Policy Center.
          </p>
          <button 
            onClick={handleBackToDashboard}
            style={{
              padding: '12px 24px',
              backgroundColor: '#14B8A6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '24px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              outline: 'none'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
          >
            Return to HR Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (authError || error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '0px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ 
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h2 style={{ 
            fontSize: '16px', 
            fontWeight: '600', 
            color: '#111827', 
            margin: '0 0 8px 0'
          }}>
            Access Denied
          </h2>
          <p style={{ 
            color: '#6b7280', 
            marginBottom: '20px',
            fontSize: '16px',
            lineHeight: '1.5',
            margin: '0 0 20px 0'
          }}>
            {authError || error}
          </p>
          <button 
            onClick={handleBackToDashboard}
            style={{
              padding: '12px 24px',
              backgroundColor: '#14B8A6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '32px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              outline: 'none'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
          >
            Return to HR Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="PolicyCenter"
    >
      <SecurityWrapper>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          paddingTop: '0px',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingBottom: '20px'
        }}>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>

          {/* Header */}
          <div style={{ marginBottom: '30px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px'
            }}>
              <div>
                <h1 style={{ 
                  fontSize: '16px', 
                  fontWeight: 'bold', 
                  color: '#111827',
                  margin: '0 0 8px 0'
                }}>
                  Policy Center
                </h1>
                <p style={{ 
                  color: '#6b7280', 
                  fontSize: '16px',
                  margin: 0
                }}>
                  {businessData?.business_name || businessData?.name || 'Business'} • {activeTab === 'library' ? `${policies.length} polic${policies.length !== 1 ? 'ies' : 'y'}` : `${filteredPolicies.length} assignment${filteredPolicies.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              
              {activeTab === 'library' && (
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <PermissionGate 
                    permissions={['hr.policies.create']} 
                    requireElevated
                    fallback={
                      <button 
                        disabled
                        style={{
                          padding: '12px 24px',
                          backgroundColor: '#9CA3AF',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '16px',
                          fontWeight: '600',
                          cursor: 'not-allowed',
                          opacity: 0.6,
                          outline: 'none'
                        }}
                        title="You do not have permission to create policies"
                      >
                        Create Policy
                      </button>
                    }
                  >
                    <button 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCreatePolicy();
                      }}
                      style={{
                        padding: '12px 24px',
                        backgroundColor: '#14B8A6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s ease',
                        outline: 'none'
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                      onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                    >
                      Create Policy
                    </button>
                  </PermissionGate>
                  <PermissionGate 
                    permissions={['hr.policies.create']} 
                    requireElevated
                  >
                    <button 
                      onClick={() => {
                        recordAction('open_policy_type_manager', selectedBusinessId);
                        setShowPolicyTypeManager(true);
                      }}
                      style={{
                        padding: '12px 24px',
                        backgroundColor: '#6366f1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s ease',
                        outline: 'none'
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = '#4f46e5'}
                      onMouseOut={(e) => e.target.style.backgroundColor = '#6366f1'}
                    >
                      Manage Policy Types
                    </button>
                    <button 
                      onClick={() => {
                        recordAction('open_policy_category_manager', selectedBusinessId);
                        setShowPolicyCategoryManager(true);
                      }}
                      style={{
                        padding: '12px 24px',
                        backgroundColor: '#8b5cf6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s ease',
                        outline: 'none'
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = '#7c3aed'}
                      onMouseOut={(e) => e.target.style.backgroundColor = '#8b5cf6'}
                    >
                      Manage Categories
                    </button>
                  </PermissionGate>
                </div>
              )}
            </div>
          </div>

          {/* Tab Navigation */}
          <div style={styles.tabContainer}>
            <div style={styles.tabList}>
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'library' ? styles.tabActive : {})
                }}
                onClick={() => {
                  setActiveTab('library');
                  recordAction('switch_policy_tab', { tab: 'library' });
                }}
              >
                <FileText size={18} />
                Policy Library
              </button>
              
              <button
                style={{
                  ...styles.tab,
                  ...(activeTab === 'tracker' ? styles.tabActive : {})
                }}
                onClick={() => {
                  setActiveTab('tracker');
                  recordAction('switch_policy_tab', { tab: 'tracker' });
                }}
              >
                <CheckCircle size={18} />
                Policy Tracker
              </button>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'library' && (
            <PolicyLibraryTab
              policies={getFilteredAndSortedPolicies()}
              allPolicies={allPolicies}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              sortBy={sortBy}
              setSortBy={setSortBy}
              expandedPolicies={expandedPolicies}
              toggleExpanded={toggleExpanded}
              getArchivedVersions={getArchivedVersions}
              canCreatePolicies={canCreatePolicies}
              canEditPolicies={canEditPolicies}
              onCreatePolicy={handleCreatePolicy}
              onEditPolicy={handleEditPolicy}
              onCreateNewVersion={handleCreateNewVersion}
              onViewVersionHistory={handleViewVersionHistory}
              onDeletePolicy={handleDeletePolicy}
              onArchivePolicy={handleArchivePolicy}
              onDeactivatePolicy={handleDeactivatePolicy}
              onReactivatePolicy={handleReactivatePolicy}
              onDownloadPDF={handleDownloadPDF}
              onFastPdfClick={(p) => { setPolicyForPdf(p); setShowPdfVariantModal(true); }}
              onDownloadTxt={handleDownloadTxt}
              onEmailPolicy={handleEmailPolicy}
              onAssignPolicy={handleAssignPolicy}
              canAssignPolicies={canAssignPolicies}
              onRebuildPolicyLayout={handleRebuildPolicyLayout}
            />
          )}

          {activeTab === 'tracker' && (
            <PolicyTrackerTab
              policyAcknowledgments={policyAcknowledgments}
              filteredPolicies={filteredPolicies}
              employees={employees}
              statusFilter={statusFilter}
              employeeFilter={employeeFilter}
              setStatusFilter={setStatusFilter}
              setEmployeeFilter={setEmployeeFilter}
              canAssignPolicies={canAssignPolicies}
              canEditPolicies={canEditPolicies}
              canSendReminders={canSendReminders}
              onAssignPolicy={handleAssignPolicy}
              onEditAssignment={handleEditAssignment}
              onSendReminder={handleSendReminder}
              onReassignPolicy={handleReassignPolicy}
              onViewPolicy={handleViewPolicy}
              onDownloadPDF={handleDownloadPDF}
              onEmailPolicy={handleEmailPolicy}
              isPolicyOverdue={isPolicyOverdue}
              isPolicyDueSoon={isPolicyDueSoon}
              getStatusBadgeStyle={getStatusBadgeStyle}
              getStatusText={getStatusText}
              getDaysUntilDue={getDaysUntilDue}
              overduePolicies={overduePolicies}
              policiesDueSoon={policiesDueSoon}
              policiesByMissingSignatures={policiesByMissingSignatures}
              onViewOutstandingEmployees={handleViewOutstandingEmployees}
            />
          )}

        </div>

        {/* Modals */}
        <PolicyCreationModal
          isOpen={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setEditingPolicy(null);
            setIsNewVersion(false);
          }}
          onSave={handlePolicySaved}
          policy={editingPolicy}
          businessId={selectedBusinessId}
          authUser={authUser}
          isNewVersion={isNewVersion}
          policyTypes={policyTypes}
          policyCategories={policyCategories}
          onCategoriesUpdated={() => loadPolicyCategories(selectedBusinessId)}
        />

        <PolicyTypeManager
          isOpen={showPolicyTypeManager}
          onClose={() => setShowPolicyTypeManager(false)}
          businessId={selectedBusinessId}
          onTypesUpdated={() => {
            loadPolicyTypes(selectedBusinessId);
          }}
        />

        <PolicyCategoryManager
          isOpen={showPolicyCategoryManager}
          onClose={() => setShowPolicyCategoryManager(false)}
          businessId={selectedBusinessId}
          onCategoriesUpdated={() => {
            loadPolicyCategories(selectedBusinessId);
          }}
        />

        <PolicyEmailModal
          isOpen={showEmailModal}
          onClose={() => {
            setShowEmailModal(false);
            setSelectedPolicy(null);
          }}
          policy={selectedPolicy}
          businessId={selectedBusinessId}
          businessData={businessData}
          employees={employees}
        />

        <PolicyVersionHistoryModal
          isOpen={showVersionHistoryModal}
          onClose={() => {
            setShowVersionHistoryModal(false);
            setSelectedPolicy(null);
          }}
          policy={selectedPolicy}
          businessId={selectedBusinessId}
        />

        <PolicyAssignmentModal
          isOpen={showAssignmentModal}
          onClose={() => {
            setShowAssignmentModal(false);
            setSelectedPolicy(null);
          }}
          policy={selectedPolicy}
          businessId={selectedBusinessId}
          employees={employees}
          onAssignmentComplete={handleAssignmentComplete}
        />

        <OutstandingEmployeesModal
          isOpen={showOutstandingEmployeesModal}
          onClose={() => {
            setShowOutstandingEmployeesModal(false);
            setSelectedPolicy(null);
          }}
          policyGroup={selectedPolicy}
          businessId={selectedBusinessId}
          businessData={businessData}
          onEmailSent={handleAssignmentComplete}
        />

        {/* PDF variant modal: choose Employee Acknowledgment vs CEO/Owner */}
        {showPdfVariantModal && policyForPdf && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000
            }}
            onClick={() => { setShowPdfVariantModal(false); setPolicyForPdf(null); }}
          >
            <div
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                padding: 24,
                maxWidth: 420,
                width: '90%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600 }}>Choose PDF version</h3>
              <p style={{ margin: '0 0 20px 0', fontSize: 14, color: '#6b7280' }}>
                Same policy content; only the signature section at the bottom changes.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    const p = policyForPdf;
                    setShowPdfVariantModal(false);
                    setPolicyForPdf(null);
                    handleDownloadPDF(p, { signatureVariant: 'acknowledgment' });
                  }}
                  style={{
                    padding: '12px 16px',
                    fontSize: 14,
                    fontWeight: 500,
                    backgroundColor: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  Employee Acknowledgment
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const p = policyForPdf;
                    setShowPdfVariantModal(false);
                    setPolicyForPdf(null);
                    handleDownloadPDF(p, { signatureVariant: 'ceo_owner' });
                  }}
                  style={{
                    padding: '12px 16px',
                    fontSize: 14,
                    fontWeight: 500,
                    backgroundColor: '#14B8A6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  CEO / Owner signature
                </button>
                <button
                  type="button"
                  onClick={() => { setShowPdfVariantModal(false); setPolicyForPdf(null); }}
                  style={{
                    padding: '12px 16px',
                    fontSize: 14,
                    backgroundColor: 'transparent',
                    color: '#6b7280',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

// POLICY LIBRARY TAB COMPONENT
const PolicyLibraryTab = ({
  policies,
  allPolicies,
  searchTerm,
  setSearchTerm,
  sortBy,
  setSortBy,
  expandedPolicies,
  toggleExpanded,
  getArchivedVersions,
  canCreatePolicies,
  canEditPolicies,
  canAssignPolicies,
  onCreatePolicy,
  onEditPolicy,
  onCreateNewVersion,
  onViewVersionHistory,
  onDeletePolicy,
  onArchivePolicy,
  onDeactivatePolicy,
  onReactivatePolicy,
  onDownloadPDF,
  onFastPdfClick,
  onDownloadTxt,
  onEmailPolicy,
  onAssignPolicy,
  onRebuildPolicyLayout
}) => {
  return (
    <div style={styles.tabContent}>
      {/* Search and Sort Controls */}
      <div style={styles.searchControlsCard}>
        <div style={styles.searchRow}>
          <div style={styles.searchInputContainer}>
            <Search size={18} style={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search by policy name, number, or type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={styles.searchInput}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={styles.clearSearchButton}
              >
                ×
              </button>
            )}
          </div>
          <div style={styles.sortContainer}>
            <label style={styles.sortLabel}>Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={styles.sortSelect}
            >
              <option value="alphabetical">Alphabetical</option>
              <option value="policy_number">Policy Number</option>
              <option value="date">Date Created</option>
            </select>
          </div>
        </div>
      </div>

      <div style={styles.libraryCard}>
        <h2 style={styles.libraryTitle}>
          Policies ({policies.length})
        </h2>

        {policies.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>
              No policies created yet.
            </p>
            {canCreatePolicies && (
              <button
                onClick={onCreatePolicy}
                style={styles.createButton}
              >
                Create First Policy
              </button>
            )}
          </div>
        ) : (
          <div style={styles.policiesList}>
            {policies.map(policy => {
              const archivedVersions = getArchivedVersions(policy.id);
              const hasArchivedVersions = archivedVersions.length > 0;
              const isExpanded = expandedPolicies.has(policy.id);
              
              return (
                <div key={policy.id} style={styles.policyCard}>
                  <div style={styles.policyHeader}>
                    <div style={styles.policyInfo}>
                      <div style={styles.policyTitleRow}>
                        <h3 style={styles.policyName}>
                          {policy.policy_number ? `${policy.policy_number} - ` : ''}{policy.policy_name || 'Unnamed Policy'}
                        </h3>
                      </div>
                      <div style={styles.policyMeta}>
                        <span style={styles.policyVersion}>
                          Version {policy.policy_version}
                        </span>
                        {policy.policy_type && (
                          <span style={styles.policyType}>
                            {policy.policy_type}
                          </span>
                        )}
                        <span style={{
                          ...styles.statusBadge,
                          backgroundColor: policy.status === 'active' ? '#d1fae5' : 
                                         policy.status === 'draft' ? '#fef3c7' :
                                         policy.status === 'archived' ? '#f3f4f6' : '#fee2e2',
                          color: policy.status === 'active' ? '#059669' : 
                                 policy.status === 'draft' ? '#f59e0b' :
                                 policy.status === 'archived' ? '#6b7280' : '#dc2626'
                        }}>
                          {policy.status}
                        </span>
                        {hasArchivedVersions && (
                          <button
                            onClick={() => toggleExpanded(policy.id)}
                            style={styles.viewHistoryButton}
                            title={`${archivedVersions.length} archived version${archivedVersions.length !== 1 ? 's' : ''}`}
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp size={14} />
                                Hide {archivedVersions.length} archived version{archivedVersions.length !== 1 ? 's' : ''}
                              </>
                            ) : (
                              <>
                                <ChevronDown size={14} />
                                View {archivedVersions.length} archived version{archivedVersions.length !== 1 ? 's' : ''}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={styles.policyActions}>
                      <button onClick={() => (onFastPdfClick || onDownloadPDF)(policy)} style={styles.actionButton}>Fast PDF</button>
                      <button onClick={() => onDownloadTxt(policy)} style={{...styles.actionButton, backgroundColor: '#64748b'}}>Download .txt</button>
                      <button onClick={() => onEmailPolicy(policy)} style={{...styles.actionButton, backgroundColor: '#14B8A6'}}>Email</button>
                      {canAssignPolicies && (
                        <button onClick={() => onAssignPolicy(policy)} style={{...styles.actionButton, backgroundColor: '#8b5cf6'}}>Assignments</button>
                      )}
                      {canEditPolicies && (
                        <>
                          <button
                            type="button"
                            onClick={() => onRebuildPolicyLayout?.(policy)}
                            title="Regenerate stored HTML from saved categories and branding (fixes broken PDF layout)"
                            style={{ ...styles.actionButton, backgroundColor: '#0d9488', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <RefreshCw size={14} aria-hidden={true} />
                            Rebuild layout
                          </button>
                          <button onClick={() => onEditPolicy(policy)} style={{...styles.actionButton, backgroundColor: '#6366f1'}}>Edit</button>
                          {hasArchivedVersions && (
                            <button onClick={() => onViewVersionHistory(policy)} style={{...styles.actionButton, backgroundColor: '#8b5cf6'}}>History</button>
                          )}
                          {(policy.status === 'draft' || policy.policy_name.toLowerCase().includes('test') || policy.policy_name.toLowerCase().includes('temp')) && (
                            <button onClick={() => onDeletePolicy(policy)} style={{...styles.actionButton, backgroundColor: '#ef4444'}}>Delete</button>
                          )}
                          {policy.status === 'active' && (
                            <>
                              <button onClick={() => onArchivePolicy(policy)} style={{...styles.actionButton, backgroundColor: '#6b7280'}}>Archive</button>
                              <button onClick={() => onDeactivatePolicy(policy)} style={{...styles.actionButton, backgroundColor: '#f59e0b'}}>Deactivate</button>
                            </>
                          )}
                          {(policy.status === 'inactive' || policy.status === 'archived') && (
                            <button onClick={() => onReactivatePolicy(policy)} style={{...styles.actionButton, backgroundColor: '#059669'}}>Reactivate</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Archived Versions Section */}
                  {isExpanded && hasArchivedVersions && (
                    <div style={styles.archivedVersionsSection}>
                      <div style={styles.archivedVersionsHeader}>
                        <h4 style={styles.archivedVersionsTitle}>
                          Archived Versions ({archivedVersions.length})
                        </h4>
                      </div>
                      <div style={styles.archivedVersionsList}>
                        {archivedVersions.map(archived => (
                          <div key={archived.id} style={styles.archivedVersionCard}>
                            <div style={styles.archivedVersionInfo}>
                              <div style={styles.archivedVersionTitleRow}>
                                <span style={styles.archivedVersionNumber}>
                                  Version {archived.policy_version}
                                </span>
                                <span style={styles.archivedDate}>
                                  Archived {new Date(archived.archived_at || archived.updated_at).toLocaleDateString()}
                                </span>
                              </div>
                              {archived.policy_number && (
                                <span style={styles.archivedPolicyNumber}>
                                  {archived.policy_number}
                                </span>
                              )}
                            </div>
                            <div style={styles.archivedVersionActions}>
                              <button
                                onClick={() => (onFastPdfClick || onDownloadPDF)(archived)}
                                style={{...styles.archivedActionButton, backgroundColor: '#3b82f6'}}
                              >
                                PDF
                              </button>
                              <button
                                onClick={() => onViewVersionHistory(archived)}
                                style={{...styles.archivedActionButton, backgroundColor: '#8b5cf6'}}
                              >
                                View
                              </button>
                              {canEditPolicies && (
                                <button
                                  onClick={() => onReactivatePolicy(archived)}
                                  style={{...styles.archivedActionButton, backgroundColor: '#059669'}}
                                >
                                  Reactivate
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// POLICY TRACKER TAB COMPONENT
const PolicyTrackerTab = ({
  policyAcknowledgments,
  filteredPolicies,
  policiesByMissingSignatures,
  employees,
  statusFilter,
  employeeFilter,
  setStatusFilter,
  setEmployeeFilter,
  canAssignPolicies,
  canEditPolicies,
  canSendReminders,
  onAssignPolicy,
  onViewOutstandingEmployees,
  isPolicyOverdue,
  isPolicyDueSoon,
  getStatusBadgeStyle,
  getStatusText,
  getDaysUntilDue,
  overduePolicies,
  policiesDueSoon
}) => {
  return (
    <div style={styles.tabContent}>
      {/* Alert Cards */}
      {(overduePolicies.length > 0 || policiesDueSoon.length > 0) && (
        <div style={styles.alertsGrid}>
          {overduePolicies.length > 0 && (
            <div style={styles.alertCardOverdue}>
              <div style={styles.alertContent}>
                <h3 style={styles.alertTitle}>
                  {overduePolicies.length} Overdue Policy Acknowledgment{overduePolicies.length !== 1 ? 's' : ''}
                </h3>
                <div style={styles.alertList}>
                  {overduePolicies.slice(0, 3).map(policy => (
                    <div key={policy.id} style={styles.alertItem}>
                      • {policy.employee_profiles?.first_name} {policy.employee_profiles?.last_name} - {policy.policy_name} ({Math.abs(getDaysUntilDue(policy.due_date))} days overdue)
                    </div>
                  ))}
                  {overduePolicies.length > 3 && (
                    <div>And {overduePolicies.length - 3} more...</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {policiesDueSoon.length > 0 && (
            <div style={styles.alertCardDueSoon}>
              <div style={styles.alertContent}>
                <h3 style={styles.alertTitle}>
                  {policiesDueSoon.length} Policy Acknowledgment{policiesDueSoon.length !== 1 ? 's' : ''} Due Soon
                </h3>
                <div style={styles.alertList}>
                  {policiesDueSoon.slice(0, 3).map(policy => (
                    <div key={policy.id} style={styles.alertItem}>
                      • {policy.employee_profiles?.first_name} {policy.employee_profiles?.last_name} - {policy.policy_name} (due in {getDaysUntilDue(policy.due_date)} days)
                    </div>
                  ))}
                  {policiesDueSoon.length > 3 && (
                    <div>And {policiesDueSoon.length - 3} more...</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={styles.filtersCard}>
        <div style={styles.filtersGrid}>
          <div>
            <label style={styles.filterLabel}>Employee</label>
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Employees</option>
              {employees.map(employee => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name || `${employee.first_name} ${employee.last_name}`} (#{employee.employee_number})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={styles.filterLabel}>Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending Acknowledgment</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due Soon</option>
            </select>
          </div>
          <div style={styles.assignButtonContainer}>
            <PermissionGate permissions={['hr.policies.assign']} requireElevated
              fallback={
                <button disabled style={styles.assignButtonDisabled}>
                  Assign Policy
                </button>
              }
            >
              <button onClick={onAssignPolicy} style={styles.assignButton}>
                Assign Policy
              </button>
            </PermissionGate>
          </div>
        </div>
      </div>

      {/* Policy acknowledgement tracker */}
      <div style={styles.assignmentsCard}>
        <h2 style={styles.assignmentsTitle}>
          Policy Acknowledgement Tracker ({policiesByMissingSignatures.length})
        </h2>

        {!policiesByMissingSignatures || policiesByMissingSignatures.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>
              No active employee policy assignments to track.
            </p>
            {canAssignPolicies && (
              <button onClick={onAssignPolicy} style={styles.createButton}>
                Assign First Policy
              </button>
            )}
          </div>
        ) : (
          <div style={styles.assignmentsList}>
            {policiesByMissingSignatures
              .map(policyGroup => (
              <div 
                key={policyGroup.policy_id} 
                style={{
                  ...styles.assignmentCard,
                  backgroundColor: policyGroup.missing_signatures > 0 ? '#fef2f2' : '#f0fdf4',
                  borderColor: policyGroup.missing_signatures > 0 ? '#fecaca' : '#bbf7d0',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onClick={() => onViewOutstandingEmployees(policyGroup)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = policyGroup.missing_signatures > 0 ? '#fee2e2' : '#dcfce7';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = policyGroup.missing_signatures > 0 ? '#fef2f2' : '#f0fdf4';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={styles.assignmentHeader}>
                  <div style={styles.assignmentInfo}>
                    <div style={styles.assignmentTitleRow}>
                      <h3 style={styles.assignmentPolicyName}>
                        {policyGroup.policy_name}
                      </h3>
                      <span style={styles.assignmentVersion}>
                        v{policyGroup.policy_version}
                      </span>
                      {policyGroup.missing_signatures > 0 ? (
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '14px',
                          fontWeight: '600',
                          backgroundColor: '#fee2e2',
                          color: '#dc2626'
                        }}>
                          {policyGroup.missing_signatures} Missing Signature{policyGroup.missing_signatures !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '14px',
                          fontWeight: '600',
                          backgroundColor: '#dcfce7',
                          color: '#16a34a'
                        }}>
                          All Acknowledged
                        </span>
                      )}
                    </div>
                    <p style={styles.assignmentEmployee}>
                      {policyGroup.acknowledged_count} of {policyGroup.total_assignments} employees have acknowledged
                    </p>
                  </div>
                </div>

                <div style={styles.assignmentDetails}>
                  <div>
                    <p style={styles.detailLabel}>Missing Signatures</p>
                    <p style={{
                      ...styles.detailValue,
                      color: '#dc2626',
                      fontWeight: '600',
                      fontSize: '48px'
                    }}>
                      {policyGroup.missing_signatures}
                    </p>
                  </div>
                  <div>
                    <p style={styles.detailLabel}>Acknowledged</p>
                    <p style={{
                      ...styles.detailValue,
                      color: '#16a34a',
                      fontWeight: '500'
                    }}>
                      {policyGroup.acknowledged_count}
                    </p>
                  </div>
                  <div>
                    <p style={styles.detailLabel}>Total Assigned</p>
                    <p style={styles.detailValue}>
                      {policyGroup.total_assignments}
                    </p>
                  </div>
                </div>

                <div style={{
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid #e5e7eb',
                  fontSize: '18px',
                  color: '#6b7280',
                  fontStyle: 'italic',
                  textAlign: 'center'
                }}>
                  Click to view outstanding and acknowledged active employees
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  tabContainer: {
    marginBottom: '30px',
    backgroundColor: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden'
  },
  tabList: {
    display: 'flex',
    borderBottom: '1px solid #e5e7eb'
  },
  tab: {
    flex: 1,
    padding: '16px',
    backgroundColor: '#f8f9fa',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s',
    borderRight: '1px solid #e5e7eb'
  },
  tabActive: {
    backgroundColor: '#008080',
    color: 'white'
  },
  tabContent: {
    flex: 1,
    overflowY: 'auto'
  },
  searchControlsCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    marginBottom: '20px'
  },
  searchRow: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  searchInputContainer: {
    flex: 1,
    minWidth: '300px',
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    color: '#6b7280',
    pointerEvents: 'none'
  },
  searchInput: {
    width: '100%',
    padding: '10px 40px 10px 40px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '18px',
    outline: 'none',
    transition: 'border-color 0.2s'
  },
  clearSearchButton: {
    position: 'absolute',
    right: '8px',
    background: 'none',
    border: 'none',
    fontSize: '14px',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    lineHeight: 1,
    transition: 'color 0.2s'
  },
  sortContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  sortLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    whiteSpace: 'nowrap'
  },
  sortSelect: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    backgroundColor: 'white',
    outline: 'none',
    cursor: 'pointer'
  },
  libraryCard: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    marginBottom: '30px'
  },
  libraryTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 20px 0'
  },
  policiesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  policyCard: {
    padding: '20px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#f9fafb'
  },
  policyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px'
  },
  policyInfo: {
    flex: 1
  },
  policyTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px'
  },
  policyNumber: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  policyName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#111827',
    margin: 0
  },
  policyMeta: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  policyVersion: {
    fontSize: '14px',
    color: '#6b7280'
  },
  policyType: {
    fontSize: '12px',
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  statusBadge: {
    fontSize: '14px',
    fontWeight: '600',
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'capitalize'
  },
  policyActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(100px, 1fr))',
    gap: '8px'
  },
  actionButton: {
    padding: '8px 12px',
    minWidth: '100px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px',
    color: '#6b7280'
  },
  emptyText: {
    margin: '0 0 16px 0',
    fontSize: '14px'
  },
  createButton: {
    padding: '12px 24px',
    backgroundColor: '#14B8A6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  alertsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '16px',
    marginBottom: '30px'
  },
  alertCardOverdue: {
    backgroundColor: '#fef2f2',
    borderLeft: '4px solid #ef4444',
    padding: '16px',
    borderRadius: '8px'
  },
  alertCardDueSoon: {
    backgroundColor: '#fffbeb',
    borderLeft: '4px solid #f59e0b',
    padding: '16px',
    borderRadius: '8px'
  },
  alertContent: {
    marginLeft: '12px'
  },
  alertTitle: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#991b1b',
    margin: '0 0 8px 0'
  },
  alertList: {
    fontSize: '14px',
    color: '#b91c1c'
  },
  alertItem: {
    marginBottom: '4px'
  },
  filtersCard: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    marginBottom: '30px'
  },
  filtersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px'
  },
  filterLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '8px'
  },
  filterSelect: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none'
  },
  assignButtonContainer: {
    display: 'flex',
    alignItems: 'flex-end'
  },
  assignButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%'
  },
  assignButtonDisabled: {
    padding: '10px 20px',
    backgroundColor: '#9CA3AF',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'not-allowed',
    opacity: 0.6,
    width: '100%'
  },
  assignmentsCard: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    marginBottom: '30px'
  },
  assignmentsTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 20px 0'
  },
  assignmentsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  assignmentCard: {
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    transition: 'all 0.2s ease'
  },
  assignmentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px'
  },
  assignmentInfo: {
    flex: 1
  },
  assignmentTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
    flexWrap: 'wrap'
  },
  assignmentPolicyName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#111827',
    margin: 0
  },
  assignmentVersion: {
    fontSize: '11px',
    color: '#6b7280'
  },
  assignmentEmployee: {
    fontSize: '11px',
    color: '#6b7280',
    margin: '0 0 4px 0'
  },
  assignmentAssignedBy: {
    fontSize: '11px',
    color: '#9ca3af',
    margin: 0
  },
  assignmentDetails: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '16px',
    marginBottom: '16px'
  },
  detailLabel: {
    fontSize: '11px',
    fontWeight: '500',
    color: '#374151',
    margin: '0 0 4px 0'
  },
  detailValue: {
    fontSize: '11px',
    color: '#6b7280',
    margin: 0
  },
  daysRemaining: {
    fontSize: '10px',
    marginTop: '2px'
  },
  renewalNotice: {
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#eff6ff',
    borderRadius: '6px',
    borderLeft: '4px solid #3b82f6'
  },
  renewalText: {
    fontSize: '11px',
    color: '#1e40af',
    margin: 0
  },
  notesBox: {
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#f9fafb',
    borderRadius: '6px'
  },
  notesLabel: {
    fontSize: '11px',
    fontWeight: '500',
    color: '#374151',
    margin: '0 0 4px 0'
  },
  notesText: {
    fontSize: '11px',
    color: '#6b7280',
    margin: 0
  },
  assignmentActions: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap'
  },
  viewButton: {
    padding: '8px 12px',
    fontSize: '11px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  editButton: {
    padding: '8px 12px',
    fontSize: '11px',
    backgroundColor: '#14B8A6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  reminderButton: {
    padding: '8px 12px',
    fontSize: '11px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  reassignButton: {
    padding: '8px 12px',
    fontSize: '11px',
    backgroundColor: '#16a34a',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  viewHistoryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    fontSize: '10px',
    fontWeight: '500',
    color: '#6366f1',
    backgroundColor: '#e0e7ff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  archivedVersionsSection: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px solid #e5e7eb'
  },
  archivedVersionsHeader: {
    marginBottom: '12px'
  },
  archivedVersionsTitle: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#6b7280',
    margin: 0
  },
  archivedVersionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  archivedVersionCard: {
    padding: '12px',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  archivedVersionInfo: {
    flex: 1
  },
  archivedVersionTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '4px'
  },
  archivedVersionNumber: {
    fontSize: '10px',
    fontWeight: '600',
    color: '#374151'
  },
  archivedDate: {
    fontSize: '10px',
    color: '#6b7280'
  },
  archivedPolicyNumber: {
    fontSize: '9px',
    color: '#9ca3af',
    backgroundColor: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '3px'
  },
  archivedVersionActions: {
    display: 'flex',
    gap: '6px'
  },
  archivedActionButton: {
    padding: '6px 12px',
    fontSize: '10px',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: '500'
  }
};

export default PolicyCenter;
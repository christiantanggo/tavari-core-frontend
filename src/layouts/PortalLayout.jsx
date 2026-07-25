// PortalLayout.jsx - Employee Portal Layout (No Header/Sidebar)
import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { sessionPersistence } from '../services/SessionPersistence';
import { TavariStyles } from '../utils/TavariStyles';
import { LogOut, FileText, User, Menu, X, FileSignature, Lock, Award, Home, Calendar, DollarSign, CircleUserRound, BookOpen, Clock, CalendarCheck, CalendarDays, Repeat2, Bell, FileWarning, AlertTriangle, MessageSquareText } from 'lucide-react';
import toast from 'react-hot-toast';
import TerminationCountdown from '../components/Portal/TerminationCountdown';
import PasswordChangeModal from '../components/Portal/PasswordChangeModal';
import PersonalInfoModalContent from '../components/Portal/PersonalInfoModalContent';
import { getPublicUserId } from '../utils/getPublicUserId';
import { employeeAppPath } from '../utils/employeeAppRouting';
import {
  SCHEDULING_PORTAL_NAV_NAMES,
  fetchSchedulingModuleEnabled,
  isSchedulingEmployeePortalRoute,
} from '../utils/employeePortalSchedulingModule';
import {
  ensureEmployeePortalSelectedProfile,
  getEmployeePortalSelectedBusinessId,
  getEmployeePortalSelectedProfile,
  loadEmployeePortalBusinessProfiles,
  setEmployeePortalProfiles,
  setEmployeePortalSelectedProfile,
} from '../utils/employeeProfileSelection';
import { membershipUserIdOrFilter } from '../utils/employeePortalMembership';
import {
  isPrivilegedMembershipRole,
  isTerminatedEmployment,
  resolveEmploymentFields,
} from '../utils/businessEmploymentStatus';

const PortalLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);
  const [terminationDate, setTerminationDate] = useState(null);
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [showPersonalInfoModal, setShowPersonalInfoModal] = useState(false);
  const [userDataForModals, setUserDataForModals] = useState(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 900 : false);
  const [accountBadgeCount, setAccountBadgeCount] = useState(0);
  const [notificationBadgeCount, setNotificationBadgeCount] = useState(0);
  const [forcedAcknowledgementCount, setForcedAcknowledgementCount] = useState(0);
  const [businessProfiles, setBusinessProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [schedulingModuleEnabled, setSchedulingModuleEnabled] = useState(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 900);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    checkAuth();
    
    // Listen for auth changes — do not treat transient null sessions as logout
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (!session?.user) {
          navigate(employeeAppPath('/portal/login'), { replace: true });
        } else {
          setUser(session.user);
        }
        return;
      }

      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.user) {
          setUser(currentSession.user);
          return;
        }

        if (sessionPersistence.isPersistenceEnabled()) {
          const restored = await sessionPersistence.restoreSession();
          if (restored.restored && restored.session?.user) {
            setUser(restored.session.user);
            return;
          }
        }

        navigate(employeeAppPath('/portal/login'), { replace: true });
        return;
      }

      if (session?.user) {
        setUser(session.user);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    const refreshBadge = () => loadAccountBadgeCount();
    refreshBadge();
    window.addEventListener('employee-account-badge-refresh', refreshBadge);
    window.addEventListener('focus', refreshBadge);
    return () => {
      window.removeEventListener('employee-account-badge-refresh', refreshBadge);
      window.removeEventListener('focus', refreshBadge);
    };
  }, []);

  useEffect(() => {
    const refreshProfile = () => setSelectedProfile(getEmployeePortalSelectedProfile());
    window.addEventListener('employee-profile-selection-changed', refreshProfile);
    return () => window.removeEventListener('employee-profile-selection-changed', refreshProfile);
  }, []);

  useEffect(() => {
    const businessId = selectedProfile?.business_id;
    if (!businessId) {
      setSchedulingModuleEnabled(null);
      return undefined;
    }
    let cancelled = false;
    setSchedulingModuleEnabled(null);
    fetchSchedulingModuleEnabled(supabase, businessId).then((enabled) => {
      if (!cancelled) setSchedulingModuleEnabled(enabled);
    });
    const refresh = (event) => {
      const bid = event?.detail?.businessId;
      if (bid && String(bid) === String(businessId)) {
        fetchSchedulingModuleEnabled(supabase, businessId).then((enabled) => {
          if (!cancelled) setSchedulingModuleEnabled(enabled);
        });
      }
    };
    window.addEventListener('module-activated', refresh);
    window.addEventListener('module-deactivated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('module-activated', refresh);
      window.removeEventListener('module-deactivated', refresh);
    };
  }, [selectedProfile?.business_id]);

  useEffect(() => {
    if (schedulingModuleEnabled !== false) return;
    if (!isSchedulingEmployeePortalRoute(location.pathname)) return;
    navigate(employeeAppPath('/portal'), { replace: true });
  }, [schedulingModuleEnabled, location.pathname, navigate]);

  useEffect(() => {
    const refreshBadge = () => loadNotificationBadgeCount();
    refreshBadge();
    window.addEventListener('employee-notification-badge-refresh', refreshBadge);
    window.addEventListener('employee-profile-selection-changed', refreshBadge);
    window.addEventListener('focus', refreshBadge);
    return () => {
      window.removeEventListener('employee-notification-badge-refresh', refreshBadge);
      window.removeEventListener('employee-profile-selection-changed', refreshBadge);
      window.removeEventListener('focus', refreshBadge);
    };
  }, []);

  const loadAccountBadgeCount = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        setAccountBadgeCount(0);
        return;
      }

      const publicUserId = await getPublicUserId(currentUser.email);
      const employeeIds = [...new Set([currentUser.id, publicUserId].filter(Boolean))];

      const { count: pendingPolicyCount, error } = await supabase
        .from('hr_policy_assignments')
        .select('id, hr_policies!inner(requires_acknowledgment)', { count: 'exact', head: true })
        .in('employee_id', employeeIds)
        .eq('acknowledged', false)
        .eq('hr_policies.requires_acknowledgment', true);

      if (error) {
        console.warn('[PortalLayout] Could not load account badge count:', error);
        setAccountBadgeCount(0);
        return;
      }

      let newPayStatementCount = 0;
      let pendingTrainingDocuments = 0;
      let pendingForcedAcknowledgements = 0;
      let pendingStaffUpdates = 0;
      if (publicUserId) {
        const { data: businessUsers } = await supabase
          .from('business_users')
          .select('business_id')
          .eq('user_id', publicUserId)
          .limit(20);

        const selectedBusinessId = getEmployeePortalSelectedBusinessId();
        const businessId = selectedBusinessId || businessUsers?.[0]?.business_id;
        if (businessId) {
          const { data: businessRuns } = await supabase
            .from('hrpayroll_runs')
            .select('id')
            .eq('business_id', businessId)
            .order('pay_date', { ascending: false });

          const runIds = (businessRuns || []).map((run) => run.id);
          if (runIds.length > 0) {
            const { data: payEntries } = await supabase
              .from('hrpayroll_entries')
              .select('id')
              .eq('user_id', publicUserId)
              .in('payroll_run_id', runIds);

            const payStatementIds = (payEntries || []).map((entry) => entry.id);
            const seenKey = `employee_seen_pay_statements_${publicUserId}`;
            const seenIds = JSON.parse(localStorage.getItem(seenKey) || '[]');
            const seenSet = new Set(seenIds);
            newPayStatementCount = payStatementIds.filter((id) => !seenSet.has(id)).length;
          }

          const { count: trainingCount } = await supabase
            .from('hr_training_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('employee_id', publicUserId)
            .in('status', ['assigned', 'in_progress', 'completed']);

          pendingTrainingDocuments = trainingCount || 0;

          const { count: acknowledgementCount } = await supabase
            .from('hr_employee_acknowledgements')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('employee_id', publicUserId)
            .is('acknowledged_at', null)
            .is('cancelled_at', null);

          pendingForcedAcknowledgements = acknowledgementCount || 0;

          const { count: staffUpdateCount } = await supabase
            .from('hr_employee_updates')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('employee_id', publicUserId)
            .eq('requires_acknowledgement', true)
            .is('acknowledged_at', null)
            .is('cancelled_at', null);

          pendingStaffUpdates = staffUpdateCount || 0;
        }
      }

      setForcedAcknowledgementCount(pendingForcedAcknowledgements);
      setAccountBadgeCount((pendingPolicyCount || 0) + newPayStatementCount + pendingTrainingDocuments + pendingForcedAcknowledgements + pendingStaffUpdates);
    } catch (error) {
      console.warn('[PortalLayout] Account badge count failed:', error);
      setForcedAcknowledgementCount(0);
      setAccountBadgeCount(0);
    }
  };

  const loadNotificationBadgeCount = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        setNotificationBadgeCount(0);
        return;
      }

      const selectedBusinessId = getEmployeePortalSelectedBusinessId();
      const { data, error } = await supabase.functions.invoke('employee-notifications-action', {
        body: { action: 'list', ...(selectedBusinessId ? { business_id: selectedBusinessId } : {}) },
      });

      if (error || data?.error) {
        setNotificationBadgeCount(0);
        return;
      }

      setNotificationBadgeCount(data.unreadCount || 0);
    } catch (error) {
      console.warn('[PortalLayout] Notification badge count failed:', error);
      setNotificationBadgeCount(0);
    }
  };

  const checkAuth = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        navigate(employeeAppPath('/portal/login'), { replace: true });
        return;
      }

      // Get public.users.id (business_users references public.users.id, not auth.users.id)
      const publicUserId = await getPublicUserId(session.user.email);

      if (!publicUserId) {
        console.error('[PortalLayout] Could not find user in public.users');
        navigate(employeeAppPath('/portal/login'), { replace: true });
        return;
      }

      // Verify user is an employee (use public.users.id)
      // Retry a few times in case business_users entry is still being created
      let businessUsers = null;
      let retries = 3;
      while (retries > 0 && (!businessUsers || businessUsers.length === 0)) {
        const { data: buData, error: buError } = await supabase
          .from('business_users')
          .select('user_id, business_id, role, employment_status, termination_date')
          .eq('user_id', publicUserId)
          .limit(10);
        
        if (buError) {
          console.error('[PortalLayout] Error checking business_users:', buError);
        } else {
          businessUsers = buData;
        }
        
        if (!businessUsers || businessUsers.length === 0) {
          retries--;
          if (retries > 0) {
            console.log(`[PortalLayout] business_users not found, retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          }
        } else {
          break; // Found it, exit loop
        }
      }

      if (!businessUsers || businessUsers.length === 0) {
        console.error('[PortalLayout] No business_users entry found after retries. User ID:', session.user.id);
        // Check user_roles as fallback (split auth id vs public.users.id)
        const { data: userRoles } = await supabase
          .from('user_roles')
          .select('user_id, business_id')
          .or(membershipUserIdOrFilter(session.user.id, publicUserId))
          .eq('active', true)
          .limit(1);
        
        if (userRoles && userRoles.length > 0) {
          console.log('[PortalLayout] Found user_roles entry, user should have access');
          // User has user_roles but not business_users - this is okay, continue
        } else {
          await supabase.auth.signOut();
          navigate(employeeAppPath('/portal/login'), { replace: true });
          toast.error('Access denied. This portal is for employees only.');
          return;
        }
      }

      const profiles = await loadEmployeePortalBusinessProfiles(supabase, publicUserId);
      setBusinessProfiles(profiles);
      setEmployeePortalProfiles(profiles);
      setSelectedProfile(ensureEmployeePortalSelectedProfile(profiles));

      // Check user's role to determine if they need to complete employee profile
      // Admin/owner accounts don't need to complete employee profile setup
      let userRole = 'employee'; // Default to employee
      if (businessUsers && businessUsers.length > 0) {
        userRole = businessUsers[0].role || 'employee';
      } else {
        const { data: userRoles } = await supabase
          .from('user_roles')
          .select('role')
          .or(membershipUserIdOrFilter(session.user.id, publicUserId))
          .eq('active', true)
          .limit(1)
          .maybeSingle();
        if (userRoles) {
          userRole = userRoles.role || 'employee';
        }
      }
      
      const isAdminOrOwner = userRole === 'admin' || userRole === 'owner' || userRole === 'manager';

      // Check if user is terminated, has password/PIN set, and has personal info complete
      // Select ALL fields needed for modals (including personal info fields)
      // Use publicUserId (not session.user.id) because users table uses public.users.id
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', publicUserId)
        .single();

      // Ensure email is set (use session email if userData email is missing)
      if (userData && !userData.email && session.user.email) {
        userData.email = session.user.email;
      }

      setUserDataForModals(userData);

      // OTP login replaces employee password entry; still require PIN setup for protected employee actions.
      if (!userData?.pin) {
        setShowPasswordChangeModal(true);
        setLoading(false);
        return; // Don't continue - modal will handle password change
      }

      // Check if user came from personal info form link (token in sessionStorage)
      const personalInfoToken = sessionStorage.getItem('personal_info_token');
      const personalInfoRedirect = sessionStorage.getItem('personal_info_redirect');
      const tokenUserEmail = sessionStorage.getItem('personal_info_user_email');
      
      // If token exists and matches current user, force-show personal info modal
      // This handles both new employees and legacy employees who need to update
      if (personalInfoToken && personalInfoRedirect) {
        // Verify token matches current user
        if (!tokenUserEmail || tokenUserEmail === session.user.email) {
          // Verify token matches user's personal_info_token
          const { data: tokenUser } = await supabase
            .from('users')
            .select('personal_info_token')
            .eq('id', publicUserId)
            .maybeSingle();
          
          // Also check contracts for backwards compatibility
          let tokenMatches = tokenUser?.personal_info_token === personalInfoToken;
          if (!tokenMatches) {
            const { data: contractToken } = await supabase
              .from('hr_contracts')
              .select('personal_info_token')
              .or(`employee_email.eq.${session.user.email},employee_id.eq.${publicUserId}`)
              .eq('personal_info_token', personalInfoToken)
              .maybeSingle();
            tokenMatches = !!contractToken;
          }
          
          if (tokenMatches) {
            // Token is valid - show personal info modal (even if info is complete, for updates)
            setShowPersonalInfoModal(true);
            setLoading(false);
            // Clear the token from sessionStorage after using it
            sessionStorage.removeItem('personal_info_token');
            sessionStorage.removeItem('personal_info_redirect');
            sessionStorage.removeItem('personal_info_user_email');
            return; // Don't continue - modal will handle personal info
          } else {
            // Token doesn't match - clear it and continue with normal flow
            sessionStorage.removeItem('personal_info_token');
            sessionStorage.removeItem('personal_info_redirect');
            sessionStorage.removeItem('personal_info_user_email');
          }
        } else {
          // Token is for different user - clear it
          sessionStorage.removeItem('personal_info_token');
          sessionStorage.removeItem('personal_info_redirect');
          sessionStorage.removeItem('personal_info_user_email');
        }
      }

      // Only require personal info completion for employees (not admin/owner/manager)
      if (!isAdminOrOwner) {
        // Check if personal information is complete
        // Required fields: SIN (from encrypted table), birth date, address, emergency contact
        // Check if SIN exists in encrypted employee_sin_numbers table
        const { data: sinRecord } = await supabase
          .from('employee_sin_numbers')
          .select('id')
          .eq('employee_id', publicUserId)
          .maybeSingle();
        
        const hasSIN = !!sinRecord;
        const hasBirthDate = !!userData?.birth_date;
        const hasAddress = !!userData?.address_line1;
        const hasEmergencyContact = !!(userData?.emergency_contact_name && userData?.emergency_contact_phone);
        
        const personalInfoComplete = hasSIN && hasBirthDate && hasAddress && hasEmergencyContact;
        
        if (!personalInfoComplete) {
          setShowPersonalInfoModal(true);
          setLoading(false);
          return; // Don't continue - modal will handle personal info
        }
      }

      const portalBusinessId =
        getEmployeePortalSelectedBusinessId() ||
        businessUsers?.[0]?.business_id ||
        null;
      const portalMembership =
        businessUsers?.find((row) => row.business_id === portalBusinessId) ||
        businessUsers?.[0] ||
        null;
      const portalEmployment = resolveEmploymentFields({
        membership: portalMembership,
        user: userData,
      });

      if (
        !isPrivilegedMembershipRole(portalMembership?.role) &&
        isTerminatedEmployment(portalEmployment)
      ) {
        if (portalEmployment.termination_date) {
          setIsTerminated(true);
          setTerminationDate(portalEmployment.termination_date);

          const termDate = new Date(portalEmployment.termination_date);
          const endDate = new Date(termDate);
          endDate.setDate(endDate.getDate() + 30);

          if (new Date() > endDate) {
            await supabase.auth.signOut();
            navigate(employeeAppPath('/portal/login'), { replace: true });
            toast.error('Your portal access has expired. Please contact HR for assistance.');
            return;
          }
        } else {
          await supabase.auth.signOut();
          navigate(employeeAppPath('/portal/login'), { replace: true });
          toast.error('Your portal access has expired. Please contact HR for assistance.');
          return;
        }
      } else {
        setIsTerminated(false);
        setTerminationDate(null);
      }

      setUser(session.user);
    } catch (error) {
      console.error('Auth check error:', error);
      navigate(employeeAppPath('/portal/login'), { replace: true });
    } finally {
      setLoading(false);
    }
  };

  // Certificate expiry check moved to PortalDashboard.jsx
  // Certificate expiry banner is now displayed on the dashboard page


  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      toast.success('You have been logged out');
      navigate(employeeAppPath('/portal/login'), { replace: true });
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('Error logging out');
    }
  };

  // Password Change Modal Handler
  const handlePasswordChangeComplete = () => {
    setShowPasswordChangeModal(false);
    // Reload user data and check for personal info
    checkAuth();
  };

  const navigation = useMemo(() => {
    const items = [
      { name: 'Home', path: employeeAppPath('/portal'), icon: Home },
      { name: 'Schedule', path: employeeAppPath('/portal/schedule'), icon: Calendar },
      { name: 'Clock', path: employeeAppPath('/portal/clock'), icon: Clock },
      { name: 'Availability', path: employeeAppPath('/portal/availability'), icon: CalendarCheck },
      { name: 'Time Off', path: employeeAppPath('/portal/time-off'), icon: CalendarDays },
      { name: 'Shift Coverage', path: employeeAppPath('/portal/shift-coverage'), icon: Repeat2 },
      { name: 'Notifications', path: employeeAppPath('/portal/notifications'), icon: Bell },
      { name: 'Account', path: employeeAppPath('/portal/account'), icon: CircleUserRound },
      { name: 'Pay', path: employeeAppPath('/portal/pay-statements'), icon: DollarSign },
      { name: 'Contract', path: employeeAppPath('/portal/contract'), icon: FileSignature },
      { name: 'Certificates', path: employeeAppPath('/portal/certificates'), icon: Award },
      { name: 'Training', path: employeeAppPath('/portal/training'), icon: BookOpen },
      { name: 'Policies', path: employeeAppPath('/portal/policies'), icon: FileText },
      { name: 'Acknowledgements', path: employeeAppPath('/portal/acknowledgements'), icon: FileWarning },
      { name: 'Incidents', path: employeeAppPath('/portal/incidents'), icon: AlertTriangle },
      { name: 'Updates', path: employeeAppPath('/portal/staff-updates'), icon: MessageSquareText },
      { name: 'Profile', path: employeeAppPath('/portal/profile'), icon: User },
      { name: 'Password & PIN', path: employeeAppPath('/portal/password-pin'), icon: Lock }
    ];
    if (schedulingModuleEnabled === true) return items;
    return items.filter((item) => !SCHEDULING_PORTAL_NAV_NAMES.includes(item.name));
  }, [schedulingModuleEnabled]);
  const bottomNavigation = navigation.filter((item) => ['Home', 'Schedule', 'Clock', 'Notifications', 'Account'].includes(item.name));
  const accountSectionPaths = [
    employeeAppPath('/portal/account'),
    employeeAppPath('/portal/pay-statements'),
    employeeAppPath('/portal/contract'),
    employeeAppPath('/portal/certificates'),
    employeeAppPath('/portal/training'),
    employeeAppPath('/portal/policies'),
    employeeAppPath('/portal/acknowledgements'),
    employeeAppPath('/portal/staff-updates'),
    employeeAppPath('/portal/profile'),
    employeeAppPath('/portal/password-pin'),
  ];
  const isBottomNavActive = (item) => {
    if (item.name === 'Account') {
      return accountSectionPaths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
    }
    return location.pathname === item.path;
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles.colors.gray50
      }}>
        <div style={{
          fontSize: TavariStyles.typography.fontSize.lg,
          color: TavariStyles.colors.gray600
        }}>Loading...</div>
      </div>
    );
  }

  const styles = {
    container: {
      minHeight: '100vh',
      width: '100%',
      maxWidth: '100vw',
      backgroundColor: TavariStyles.colors.gray50,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    sidebar: {
      width: '250px',
      backgroundColor: TavariStyles.colors.white,
      borderRight: `1px solid ${TavariStyles.colors.gray200}`,
      display: isMobile ? 'none' : 'flex',
      flexDirection: 'column',
      position: 'fixed',
      left: 0,
      top: 0,
      bottom: 0,
      zIndex: 100,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    sidebarHeader: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    logo: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      margin: 0
    },
    logoSubtext: {
      marginTop: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    sidebarNav: {
      flex: 1,
      padding: TavariStyles.spacing.md,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs,
      overflowY: 'auto'
    },
    navItem: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      textDecoration: 'none',
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      transition: 'all 0.2s',
      cursor: 'pointer',
      border: 'none',
      background: 'transparent',
      width: '100%',
      textAlign: 'left'
    },
    navItemActive: {
      backgroundColor: TavariStyles.colors.primary + '15',
      color: TavariStyles.colors.primary
    },
    sidebarFooter: {
      padding: TavariStyles.spacing.md,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    userInfo: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm
    },
    logoutButton: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: 'transparent',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.sm,
      cursor: 'pointer',
      transition: 'all 0.2s',
      width: '100%',
      justifyContent: 'center'
    },
    mainContent: {
      flex: 1,
      marginLeft: isMobile ? 0 : '250px',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      minWidth: 0,
      width: isMobile ? '100%' : 'auto',
      maxWidth: '100vw',
      paddingBottom: isMobile ? '86px' : 0,
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    header: {
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      padding: isMobile ? `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}` : `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      position: 'sticky',
      top: 0,
      zIndex: 90,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      width: '100%',
      maxWidth: '100vw',
      boxSizing: 'border-box',
      overflowX: 'hidden'
    },
    mobileBrand: {
      display: isMobile ? 'block' : 'none',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      flexShrink: 0
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      minWidth: 0,
      justifyContent: 'flex-end',
      flex: 1
    },
    userEmail: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      minWidth: 0,
      maxWidth: isMobile ? '44vw' : 'none',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    businessSelect: {
      maxWidth: isMobile ? '42vw' : '240px',
      minWidth: isMobile ? '120px' : '180px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '999px',
      padding: '8px 10px',
      color: TavariStyles.colors.gray800,
      backgroundColor: TavariStyles.colors.white,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    mobileMenuButton: {
      display: isMobile ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing.sm,
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray700
    },
    mobileMenu: {
      display: mobileMenuOpen ? 'flex' : 'none',
      flexDirection: 'column',
      position: 'fixed',
      top: '60px',
      left: 0,
      right: 0,
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      padding: TavariStyles.spacing.md,
      gap: TavariStyles.spacing.xs,
      zIndex: 99,
      boxShadow: TavariStyles.shadows?.md || '0 4px 6px rgba(0,0,0,0.1)',
      boxSizing: 'border-box',
      maxWidth: '100vw',
      overflowX: 'hidden'
    },
    content: {
      flex: 1,
      padding: isMobile ? TavariStyles.spacing.md : TavariStyles.spacing.xl,
      maxWidth: isMobile ? '100%' : '1200px',
      width: '100%',
      margin: '0 auto',
      minWidth: 0,
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    bottomNav: {
      display: isMobile ? 'grid' : 'none',
      gridTemplateColumns: `repeat(${bottomNavigation.length}, minmax(0, 1fr))`,
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1000,
      backgroundColor: TavariStyles.colors.white,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: '0 -8px 24px rgba(15, 23, 42, 0.08)',
      padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
      boxSizing: 'border-box',
      maxWidth: '100vw',
      overflowX: 'hidden'
    },
    bottomNavItem: {
      border: 'none',
      background: 'transparent',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      padding: '8px 4px',
      borderRadius: '12px',
      color: TavariStyles.colors.gray600,
      fontSize: '14px',
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      minWidth: 0,
      position: 'relative'
    },
    bottomNavItemActive: {
      color: TavariStyles.colors.primary,
      backgroundColor: TavariStyles.colors.primary + '12'
    },
    iconWithBadge: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    accountBadge: {
      position: 'absolute',
      top: '-8px',
      right: '-10px',
      minWidth: '18px',
      height: '18px',
      padding: '0 5px',
      borderRadius: '999px',
      backgroundColor: '#dc2626',
      color: TavariStyles.colors.white,
      border: `2px solid ${TavariStyles.colors.white}`,
      fontSize: '13px',
      lineHeight: '14px',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box'
    },
    forcedAckBanner: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      borderRadius: '14px',
      border: '1px solid #fecaca',
      backgroundColor: '#fef2f2',
      color: '#991b1b',
      boxSizing: 'border-box'
    },
    forcedAckButton: {
      border: 'none',
      borderRadius: '999px',
      padding: '9px 12px',
      backgroundColor: '#dc2626',
      color: TavariStyles.colors.white,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  };

  const renderNavIcon = (Icon, item) => (
    <span style={styles.iconWithBadge}>
      <Icon size={20} />
      {item.name === 'Account' && accountBadgeCount > 0 && (
        <span style={styles.accountBadge}>{accountBadgeCount > 99 ? '99+' : accountBadgeCount}</span>
      )}
      {item.name === 'Notifications' && notificationBadgeCount > 0 && (
        <span style={styles.accountBadge}>{notificationBadgeCount > 99 ? '99+' : notificationBadgeCount}</span>
      )}
    </span>
  );

  const handleBusinessProfileChange = (businessId) => {
    const nextProfile = businessProfiles.find((profile) => profile.business_id === businessId);
    if (!nextProfile) return;
    setEmployeePortalSelectedProfile(nextProfile);
    setSelectedProfile(nextProfile);
    setMobileMenuOpen(false);
    window.dispatchEvent(new Event('employee-account-badge-refresh'));
    window.dispatchEvent(new Event('employee-notification-badge-refresh'));
  };

  return (
    <div style={styles.container}>
      {/* Sidebar Navigation */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <h1 style={styles.logo}>Tavari Employee</h1>
          <div style={styles.logoSubtext}>Your work app</div>
        </div>
        
        <nav style={styles.sidebarNav}>
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  setMobileMenuOpen(false);
                }}
                style={{
                  ...styles.navItem,
                  ...(isActive ? styles.navItemActive : {}),
                  backgroundColor: isActive ? TavariStyles.colors.primary + '15' : 'transparent'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = TavariStyles.colors.gray100;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <Icon size={20} />
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>

        <div style={styles.sidebarFooter}>
          {user && (
            <div style={styles.userInfo}>{user.email}</div>
          )}
          {businessProfiles.length > 1 && (
            <select
              value={selectedProfile?.business_id || ''}
              onChange={(event) => handleBusinessProfileChange(event.target.value)}
              style={{ ...styles.businessSelect, width: '100%', maxWidth: '100%', marginBottom: TavariStyles.spacing.sm }}
              aria-label="Switch employee business"
            >
              {businessProfiles.map((profile) => (
                <option key={profile.business_id} value={profile.business_id}>
                  {profile.business_name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleLogout}
            style={styles.logoutButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = TavariStyles.colors.gray100;
              e.currentTarget.style.borderColor = TavariStyles.colors.gray400;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = TavariStyles.colors.gray300;
            }}
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div style={styles.mainContent}>
        <header style={styles.header}>
          <div style={styles.mobileBrand}>Tavari Employee</div>
          <div style={styles.headerRight}>
            {user && (
              <span style={styles.userEmail}>{user.email}</span>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={styles.mobileMenuButton}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </header>

        {mobileMenuOpen && (
          <div style={styles.mobileMenu}>
            {businessProfiles.length > 1 && (
              <select
                value={selectedProfile?.business_id || ''}
                onChange={(event) => handleBusinessProfileChange(event.target.value)}
                style={{ ...styles.businessSelect, maxWidth: '100%', width: '100%', borderRadius: TavariStyles.borderRadius?.md || '8px' }}
                aria-label="Switch employee business"
              >
                {businessProfiles.map((profile) => (
                  <option key={profile.business_id} value={profile.business_id}>
                    {profile.business_name}
                  </option>
                ))}
              </select>
            )}
            {navigation.filter((item) => ['Home', 'Schedule', 'Account'].includes(item.name)).map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => {
                    navigate(item.path);
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    ...styles.navItem,
                    ...(isActive ? styles.navItemActive : {}),
                    width: '100%'
                  }}
                >
                {renderNavIcon(Icon, item)}
                  <span>{item.name}</span>
                </button>
              );
            })}
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                handleLogout();
              }}
              style={{
                ...styles.navItem,
                width: '100%',
                justifyContent: 'center',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                marginTop: TavariStyles.spacing.sm
              }}
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </div>
        )}

        <main style={styles.content}>
          {isTerminated && terminationDate && (
            <TerminationCountdown terminationDate={terminationDate} />
          )}
          {forcedAcknowledgementCount > 0 && !location.pathname.includes('/acknowledgements') && (
            <div style={styles.forcedAckBanner}>
              <div>
                <strong>{forcedAcknowledgementCount} required acknowledgement{forcedAcknowledgementCount === 1 ? '' : 's'} pending</strong>
                <div style={{ fontSize: '16px', marginTop: '4px' }}>
                  Please review and acknowledge these HR items.
                </div>
              </div>
              <button
                type="button"
                style={styles.forcedAckButton}
                onClick={() => navigate(employeeAppPath('/portal/acknowledgements'))}
              >
                Review Now
              </button>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <nav style={styles.bottomNav} aria-label="Employee app navigation">
        {bottomNavigation.map((item) => {
          const Icon = item.icon;
          const isActive = isBottomNavActive(item);
          return (
            <button
              type="button"
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                ...styles.bottomNavItem,
                ...(isActive ? styles.bottomNavItemActive : {})
              }}
            >
              {renderNavIcon(Icon, item)}
              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      {/* Password Change Modal - Shows first if password not set */}
      {showPasswordChangeModal && (
        <PasswordChangeModal onComplete={handlePasswordChangeComplete} />
      )}

      {/* Personal Info Modal - Shows after password change if info incomplete */}
      {showPersonalInfoModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          zIndex: 10000,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: TavariStyles.spacing.lg
        }}
        onClick={(e) => {
          // Prevent closing by clicking outside - information must be completed
          e.stopPropagation();
        }}
        >
          <div style={{
            backgroundColor: TavariStyles.colors.white,
            borderRadius: TavariStyles.borderRadius?.xl || '12px',
            width: '100%',
            maxWidth: '800px',
            maxHeight: '90vh',
            overflow: 'auto',
            position: 'relative',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <PersonalInfoModalContent 
              userData={userDataForModals} 
              onComplete={async () => {
                // Close the modal immediately
                setShowPersonalInfoModal(false);
                
                // Reload user data to reflect the saved changes
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (session) {
                    const publicUserId = await getPublicUserId(session.user.email);
                    if (publicUserId) {
                      const { data: updatedUserData } = await supabase
                        .from('users')
                        .select('*')
                        .eq('id', publicUserId)
                        .single();
                      
                      if (updatedUserData) {
                        setUserDataForModals(updatedUserData);
                      }
                    }
                  }
                } catch (error) {
                  console.error('Error reloading user data after personal info save:', error);
                }
                
                // Don't call checkAuth() here as it will re-check personal info and potentially re-show the modal
                // The modal is already closed and user data is refreshed
              }}
            />
          </div>
        </div>
      )}

    </div>
  );
};

export default PortalLayout;




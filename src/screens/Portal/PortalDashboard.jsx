// PortalDashboard.jsx - Employee Portal Dashboard
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { FileText, Calendar, AlertCircle, Bell, Clock, CalendarDays, Repeat2, BookOpen, MessageSquareText } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../../utils/getPublicUserId';
import CertificateExpiryBanner from '../../components/Portal/CertificateExpiryBanner';
import PortalManagerDashboard from '../../components/Portal/PortalManagerDashboard';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import { ensureEmployeePortalSelectedProfile, getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';
import { fetchSchedulingModuleEnabled } from '../../utils/employeePortalSchedulingModule';

const PortalDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalStatements: 0,
    thisMonthEarnings: 0,
    thisYearEarnings: 0,
    recentStatementDate: null,
    businessTimezone: 'America/Toronto'
  });
  const [expiringCertificates, setExpiringCertificates] = useState([]); // Changed to array for multiple certificates
  const [publicUserId, setPublicUserId] = useState(null);
  const [businessId, setBusinessId] = useState(null);
  const [isOwnerOrManager, setIsOwnerOrManager] = useState(false);
  const [whatsNew, setWhatsNew] = useState([]);
  const [homeView, setHomeView] = useState('personal');

  useEffect(() => {
    loadDashboardData();
    window.addEventListener('employee-profile-selection-changed', loadDashboardData);
    return () => window.removeEventListener('employee-profile-selection-changed', loadDashboardData);
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Get current user
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate('/portal/login');
        return;
      }

      setUser(currentUser);

      // Get public.users.id (business_users references public.users.id, not auth.users.id)
      const publicUserId = await getPublicUserId(currentUser.email);
      if (!publicUserId) {
        toast.error('User profile not found');
        return;
      }

      // Get user profile
      const { data: userProfile } = await supabase
        .from('users')
        .select('first_name, last_name, email')
        .eq('id', publicUserId)
        .single();

      if (userProfile) {
        setUser({ ...currentUser, ...userProfile });
      }

      // Get business ID and business data (for timezone) — same ordering / ensure* as schedule & layout
      const { data: businessUsers } = await supabase
        .from('business_users')
        .select('business_id, role, businesses:business_id (id, name, timezone)')
        .eq('user_id', publicUserId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!businessUsers || businessUsers.length === 0) {
        toast.error('You are not associated with any business');
        return;
      }

      const profileList = businessUsers.map((row) => ({
        employee_id: publicUserId,
        business_id: row.business_id,
        business_name: row.businesses?.name || 'Business',
        role: row.role || 'employee',
      }));
      const resolved = ensureEmployeePortalSelectedProfile(profileList);
      const targetBusinessId = resolved?.business_id ?? getEmployeePortalSelectedBusinessId();
      const selectedBusiness = businessUsers.find(
        (row) => String(row.business_id) === String(targetBusinessId)
      ) || businessUsers[0];
      const businessId = selectedBusiness.business_id;
      const businessData = selectedBusiness.businesses;
      const businessTimezone = businessData?.timezone || 'America/Toronto';
      const schedulingEnabled = await fetchSchedulingModuleEnabled(supabase, businessId);
      
      // Check if user is owner or manager
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', publicUserId)
        .eq('business_id', businessId)
        .eq('active', true)
        .limit(1);
      
      const userRole = userRoles && userRoles.length > 0 ? userRoles[0].role : null;
      const buRole = selectedBusiness.role || 'employee';
      const isOwnerOrManagerRole =
        userRole === 'owner' ||
        userRole === 'manager' ||
        userRole === 'admin' ||
        buRole === 'owner' ||
        buRole === 'manager' ||
        buRole === 'admin';
      setIsOwnerOrManager(isOwnerOrManagerRole);
      
      // Store for certificate check
      setPublicUserId(publicUserId);
      setBusinessId(businessId);

      // Get payroll statistics
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisYearStart = new Date(now.getFullYear(), 0, 1);

      // IMPORTANT: Some entries have business_id = null, but the payroll_run has the business_id
      // We need to filter by the run's business_id OR the entry's business_id
      // First, get all payroll runs for this business (including all statuses, not just finalized)
      const { data: businessRuns, error: runsError } = await supabase
        .from('hrpayroll_runs')
        .select('id')
        .eq('business_id', businessId)
        .order('pay_date', { ascending: false });
      
      if (runsError) {
        console.error('Error loading business runs:', runsError);
        return;
      }
      
      const runIds = (businessRuns || []).map(run => run.id);
      
      // Safety check: if no runs found, return empty stats
      if (!runIds || runIds.length === 0) {
        console.warn('No payroll runs found for this business');
        setStats({
          totalStatements: 0,
          thisMonthEarnings: 0,
          thisYearEarnings: 0,
          recentStatementDate: null,
          businessTimezone: businessTimezone
        });
        await loadWhatsNew({
          publicUserId,
          businessId,
          businessTimezone,
          authUserId: currentUser.id,
          schedulingEnabled,
        });
        setLoading(false);
        return;
      }

      // Get all payroll entries for this employee
      // Use publicUserId (public.users.id) instead of currentUser.id (auth.users.id)
      // Filter by payroll_run_id in the business's runs (handles entries with business_id = null)
      const { data: allEntries, error: entriesError } = await supabase
        .from('hrpayroll_entries')
        .select(`
          id,
          net_pay,
          gross_pay,
          created_at,
          hrpayroll_runs:hrpayroll_entries_payroll_run_id_fkey (
            pay_date,
            pay_period_end,
            pay_period_start
          )
        `)
        .eq('user_id', publicUserId)
        .in('payroll_run_id', runIds)
        .order('hrpayroll_runs(pay_period_end)', { ascending: false, nullsFirst: false });

      if (entriesError) {
        console.error('Error loading payroll entries:', entriesError);
        return;
      }

      if (allEntries && allEntries.length > 0) {
        // Calculate statistics using pay_period_end (not pay_date) for accurate period tracking
        const thisMonthEntries = allEntries.filter(entry => {
          const payPeriodEnd = entry.hrpayroll_runs?.pay_period_end;
          if (!payPeriodEnd) return false;
          // Add time to avoid timezone shift issues
          const periodEndDate = new Date(payPeriodEnd + 'T12:00:00');
          return periodEndDate >= thisMonthStart;
        });

        const thisYearEntries = allEntries.filter(entry => {
          const payPeriodEnd = entry.hrpayroll_runs?.pay_period_end;
          if (!payPeriodEnd) return false;
          // Add time to avoid timezone shift issues
          const periodEndDate = new Date(payPeriodEnd + 'T12:00:00');
          return periodEndDate >= thisYearStart;
        });

        const thisMonthTotal = thisMonthEntries.reduce((sum, entry) => sum + parseFloat(entry.net_pay || 0), 0);
        const thisYearTotal = thisYearEntries.reduce((sum, entry) => sum + parseFloat(entry.net_pay || 0), 0);

        // Use pay_period_end for most recent statement (not pay_date)
        const mostRecent = allEntries[0];
        const recentPayPeriodEnd = mostRecent.hrpayroll_runs?.pay_period_end;

        setStats({
          totalStatements: allEntries.length,
          thisMonthEarnings: thisMonthTotal,
          thisYearEarnings: thisYearTotal,
          recentStatementDate: recentPayPeriodEnd,
          businessTimezone: businessTimezone // Store timezone for formatting
        });
      }

      await loadWhatsNew({
        publicUserId,
        businessId,
        businessTimezone,
        payrollEntries: allEntries || [],
        authUserId: currentUser.id,
        schedulingEnabled,
      });

    } catch (error) {
      console.error('Error loading dashboard data:', error);
      toast.error('Error loading dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const loadWhatsNew = async ({
    publicUserId,
    businessId,
    businessTimezone,
    payrollEntries = [],
    authUserId,
    schedulingEnabled = false,
  }) => {
    try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0];
      const nextThirtyDate = new Date(today);
      nextThirtyDate.setDate(today.getDate() + 30);
      const nextThirtyString = nextThirtyDate.toISOString().split('T')[0];
      const items = [];

      payrollEntries.slice(0, 3).forEach((entry) => {
        const run = entry.hrpayroll_runs || {};
        const date = run.pay_date || run.pay_period_end || entry.created_at;
        items.push({
          id: `pay-${entry.id}`,
          type: 'Pay',
          title: 'New pay statement available',
          description: run.pay_period_end ? `Pay period ending ${formatDate(run.pay_period_end, businessTimezone)}` : 'A new pay statement is ready to view.',
          date,
          icon: FileText,
          path: employeeAppPath(`/portal/pay-statements/${entry.id}`),
        });
      });

      if (schedulingEnabled) {
        const scheduleEmployeeIds = [...new Set([publicUserId, authUserId].filter(Boolean))];
        const { data: upcomingShifts } = await supabase
          .from('scheduling_shifts')
          .select('id, shift_date, start_time, end_time, position, status, created_at, updated_at, is_published')
          .eq('business_id', businessId)
          .in('employee_id', scheduleEmployeeIds)
          .gte('shift_date', todayString)
          .lte('shift_date', nextThirtyString)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(5);

        (upcomingShifts || [])
          .filter((shift) => shift.is_published !== false)
          .slice(0, 3)
          .forEach((shift) => {
            items.push({
              id: `shift-${shift.id}`,
              type: 'Schedule',
              title: 'Upcoming shift posted',
              description: `${formatDate(shift.shift_date, businessTimezone)}${shift.start_time ? ` at ${formatTime(shift.start_time)}` : ''}${shift.position ? ` • ${shift.position}` : ''}`,
              date: shift.created_at || shift.updated_at || shift.shift_date,
              icon: Calendar,
              path: employeeAppPath('/portal/schedule'),
            });
          });
      }

      const { data: pendingPolicies } = await supabase
        .from('hr_policy_assignments')
        .select(`
          id,
          assigned_at,
          due_date,
          acknowledged,
          hr_policies!inner (
            policy_name,
            requires_acknowledgment
          )
        `)
        .eq('employee_id', publicUserId)
        .eq('acknowledged', false)
        .eq('hr_policies.requires_acknowledgment', true)
        .order('assigned_at', { ascending: false })
        .limit(3);

      (pendingPolicies || []).forEach((assignment) => {
        items.push({
          id: `policy-${assignment.id}`,
          type: 'Policy',
          title: 'Policy needs acknowledgment',
          description: assignment.hr_policies?.policy_name || 'A policy is waiting for your acknowledgment.',
          date: assignment.assigned_at || assignment.due_date,
          icon: AlertCircle,
          path: employeeAppPath('/portal/policies'),
        });
      });

      if (schedulingEnabled) {
        const { data: timeOffData, error: timeOffError } = await supabase.functions.invoke('employee-time-off-action', {
          body: { action: 'list' }
        });

        if (!timeOffError && !timeOffData?.error) {
          (timeOffData?.requests || []).slice(0, 5).forEach((request) => {
            const status = request.status || 'pending';
            const isDecision = status === 'approved' || status === 'denied';
            items.push({
              id: `time-off-${request.id}`,
              type: 'Time Off',
              title: isDecision ? `Time off ${formatStatus(status)}` : 'Time off request submitted',
              description: `${formatRequestType(request.request_type)} • ${formatTimeOffRange(request)}`,
              date: request.updated_at || request.created_at || request.start_date,
              icon: CalendarDays,
              path: employeeAppPath('/portal/time-off'),
            });
          });
        }

        const { data: coverageData, error: coverageError } = await supabase.functions.invoke('employee-shift-coverage-action', {
          body: { action: 'list' }
        });

        if (!coverageError && !coverageData?.error) {
          (coverageData?.requests || []).slice(0, 5).forEach((request) => {
            const status = request.status || 'pending';
            const isDecision = status === 'approved' || status === 'denied';
            items.push({
              id: `shift-coverage-${request.id}`,
              type: 'Shift Coverage',
              title: isDecision ? `Shift coverage ${formatStatus(status)}` : 'Shift coverage request submitted',
              description: `${formatCoverageRequestType(request.request_type)} • ${formatCoverageShift(request)}`,
              date: request.updated_at || request.created_at,
              icon: Repeat2,
              path: employeeAppPath('/portal/shift-coverage'),
            });
          });
        }
      }

      const { data: trainingData, error: trainingError } = await supabase.functions.invoke('employee-training-action', {
        body: { action: 'list' }
      });

      if (!trainingError && !trainingData?.error) {
        (trainingData?.assignments || []).slice(0, 5).forEach((assignment) => {
          const item = assignment.hr_training_items || {};
          const status = assignment.status || 'assigned';
          const completed = status === 'completed' || status === 'acknowledged';
          items.push({
            id: `training-${assignment.id}`,
            type: 'Training',
            title: completed ? `Training ${formatStatus(status)}` : 'Training assigned',
            description: `${item.title || 'Assigned training'}${assignment.due_date ? ` • Due ${formatDate(assignment.due_date, businessTimezone)}` : ''}`,
            date: assignment.updated_at || assignment.assigned_at || assignment.due_date,
            icon: BookOpen,
            path: employeeAppPath('/portal/training'),
          });
        });
      }

      const { data: staffUpdateData, error: staffUpdateError } = await supabase.functions.invoke('employee-updates-action', {
        body: { action: 'list' }
      });

      if (!staffUpdateError && !staffUpdateData?.error) {
        (staffUpdateData?.updates || []).slice(0, 5).forEach((update) => {
          const needsAck = update.requires_acknowledgement && !update.acknowledged_at;
          items.push({
            id: `staff-update-${update.id}`,
            type: 'Staff Update',
            title: needsAck ? 'Staff update needs acknowledgement' : formatStatus(update.update_type || 'Staff update'),
            description: update.title || 'A staff update is available.',
            date: update.acknowledged_at || update.updated_at || update.created_at || update.due_date,
            icon: MessageSquareText,
            path: employeeAppPath('/portal/staff-updates'),
          });
        });
      }

      const newest = items
        .filter((item) => item.date)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5);

      setWhatsNew(newest);
    } catch (error) {
      console.warn('[PortalDashboard] Could not load what is new feed:', error);
      setWhatsNew([]);
    }
  };

  // Check for expiring certificates after data loads
  useEffect(() => {
    if (publicUserId && businessId && !loading) {
      checkExpiringCertificates(publicUserId, businessId, isOwnerOrManager);
    }
  }, [publicUserId, businessId, loading, isOwnerOrManager]);

  const checkExpiringCertificates = async (userId, businessId, isManagerView) => {
    try {
      console.log('[PortalDashboard] Checking expiring certificates - Manager view:', isManagerView, 'user:', userId, 'business:', businessId);
      
      // Get today's date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let allExpiringCerts = [];
      
      if (isManagerView) {
        // Manager/Owner view: Get ALL employees' expiring certificates
        console.log('[PortalDashboard] Manager view: Loading all employees\' certificates');
        
        // Get all shift premiums that require certificates for this business
        const { data: shiftPremiums, error: shiftPremiumsError } = await supabase
          .from('hr_shift_premiums')
          .select('id, name, required_certificate_id')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .eq('requires_certificate', true)
          .not('required_certificate_id', 'is', null);

        if (shiftPremiumsError) {
          console.error('[PortalDashboard] Error loading shift premiums:', shiftPremiumsError);
          return;
        }

        if (!shiftPremiums || shiftPremiums.length === 0) {
          console.log('[PortalDashboard] No shift premiums require certificates');
          return;
        }

        const certificateIds = shiftPremiums.map(sp => sp.required_certificate_id);
        
        // Get ALL employee certificates for this business that match required certificates
        const { data: allEmployeeCerts, error: certsError } = await supabase
          .from('employee_certificates')
          .select(`
            id,
            employee_id,
            certificate_id,
            expiry_date,
            status,
            hr_certificates!inner(
              id,
              name
            ),
            users:employee_id (
              id,
              first_name,
              last_name,
              email
            )
          `)
          .eq('business_id', businessId)
          .eq('status', 'active')
          .in('certificate_id', certificateIds)
          .not('expiry_date', 'is', null);

        if (certsError) {
          console.error('[PortalDashboard] Error loading all employee certificates:', certsError);
          return;
        }

        console.log('[PortalDashboard] All employee certificates found:', allEmployeeCerts);

        // Filter for expiring certificates and build list
        for (const cert of allEmployeeCerts || []) {
          if (!cert.expiry_date) continue;
          
          const expiryDate = new Date(cert.expiry_date);
          expiryDate.setHours(0, 0, 0, 0);
          
          const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
          const isExpired = daysUntilExpiry < 0;
          const daysExpired = Math.abs(daysUntilExpiry);
          
          // Check if certificate is expiring within 30 days, or expired within last 5 days
          const shouldShow = (!isExpired && daysUntilExpiry <= 30) || (isExpired && daysExpired <= 5);
          
          if (!shouldShow) continue;
          
          // Find the premium name for this certificate
          const shiftPremium = shiftPremiums.find(sp => sp.required_certificate_id === cert.certificate_id);
          
          allExpiringCerts.push({
            id: cert.id,
            employee_id: cert.employee_id,
            employee_name: cert.users ? `${cert.users.first_name || ''} ${cert.users.last_name || ''}`.trim() || cert.users.email : 'Unknown Employee',
            certificate_id: cert.certificate_id,
            certificate_name: cert.hr_certificates?.name || 'Unknown Certificate',
            premium_name: shiftPremium?.name || 'Unknown Premium',
            expiry_date: cert.expiry_date,
            days_until_expiry: daysUntilExpiry,
            is_expired: isExpired,
            days_expired: daysExpired
          });
        }
        
        console.log('[PortalDashboard] Found', allExpiringCerts.length, 'expiring certificates for all employees');
        setExpiringCertificates(allExpiringCerts);
        
      } else {
        // Employee view: Get only this employee's certificates
        console.log('[PortalDashboard] Employee view: Loading own certificates');
        
        // Get employee's assigned premiums
        const { data: employeePremiums, error: premiumsError } = await supabase
          .from('hrpayroll_employee_premiums')
          .select('premium_name, is_active')
          .eq('business_id', businessId)
          .eq('user_id', userId)
          .eq('is_active', true);

        if (premiumsError) {
          console.error('[PortalDashboard] Error loading employee premiums:', premiumsError);
          return;
        }

        if (!employeePremiums || employeePremiums.length === 0) {
          console.log('[PortalDashboard] No premiums assigned, skipping certificate check');
          return;
        }

        // Get shift premiums that require certificates
        const premiumNames = employeePremiums.map(ep => ep.premium_name);
        
        const { data: shiftPremiums, error: shiftPremiumsError } = await supabase
          .from('hr_shift_premiums')
          .select('id, name, required_certificate_id')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .eq('requires_certificate', true)
          .not('required_certificate_id', 'is', null)
          .in('name', premiumNames);

        if (shiftPremiumsError) {
          console.error('[PortalDashboard] Error loading shift premiums:', shiftPremiumsError);
          return;
        }

        if (!shiftPremiums || shiftPremiums.length === 0) {
          console.log('[PortalDashboard] No shift premiums require certificates');
          return;
        }

        // Get employee certificates for these required certificates
        const certificateIds = shiftPremiums.map(sp => sp.required_certificate_id);
        
        const { data: employeeCerts, error: certsError } = await supabase
          .from('employee_certificates')
          .select(`
            id,
            certificate_id,
            expiry_date,
            status,
            hr_certificates!inner(
              id,
              name
            )
          `)
          .eq('business_id', businessId)
          .eq('employee_id', userId)
          .eq('status', 'active')
          .in('certificate_id', certificateIds)
          .not('expiry_date', 'is', null);

        if (certsError) {
          console.error('[PortalDashboard] Error loading employee certificates:', certsError);
          return;
        }

        // Check localStorage for dismissed certificates
        const dismissedKey = 'dismissed_certificates';
        const dismissedData = localStorage.getItem(dismissedKey);
        const dismissed = dismissedData ? JSON.parse(dismissedData) : {};
        
        // Check each certificate for expiry
        for (const cert of employeeCerts || []) {
          if (!cert.expiry_date) continue;
          
          const expiryDate = new Date(cert.expiry_date);
          expiryDate.setHours(0, 0, 0, 0);
          
          const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
          const isExpired = daysUntilExpiry < 0;
          const daysExpired = Math.abs(daysUntilExpiry);
          
          // Check if certificate is expiring within 30 days, or expired within last 5 days
          const shouldShow = (!isExpired && daysUntilExpiry <= 30) || (isExpired && daysExpired <= 5);
          
          if (!shouldShow) continue;
          
          // Check if this certificate has been permanently dismissed
          const certKey = `cert_${cert.id}`;
          if (dismissed[certKey] === 'permanent') {
            continue;
          }
          
          // Check if banner was shown today (once per day)
          const lastShownKey = `last_shown_${cert.id}`;
          const lastShown = localStorage.getItem(lastShownKey);
          const todayStr = today.toISOString().split('T')[0];
          
          if (lastShown === todayStr) {
            continue;
          }
          
          // Find the premium name for this certificate
          const shiftPremium = shiftPremiums.find(sp => sp.required_certificate_id === cert.certificate_id);
          
          allExpiringCerts.push({
            id: cert.id,
            employee_id: userId,
            employee_name: 'Your', // For employee view
            certificate_id: cert.certificate_id,
            certificate_name: cert.hr_certificates?.name || 'Unknown Certificate',
            premium_name: shiftPremium?.name || 'Unknown Premium',
            expiry_date: cert.expiry_date,
            days_until_expiry: daysUntilExpiry,
            is_expired: isExpired,
            days_expired: daysExpired
          });
          
          // Mark as shown today
          localStorage.setItem(lastShownKey, todayStr);
        }
        
        console.log('[PortalDashboard] Found', allExpiringCerts.length, 'expiring certificates for employee');
        setExpiringCertificates(allExpiringCerts);
      }
    } catch (error) {
      console.error('[PortalDashboard] Error checking expiring certificates:', error);
    }
  };

  const handleBannerClose = (certId) => {
    // Remove this certificate from the list
    setExpiringCertificates(prev => prev.filter(cert => cert.id !== certId));
  };

  const handleBannerRenew = (certId) => {
    // For employee view: permanently dismiss this certificate
    if (!isOwnerOrManager) {
      const dismissedKey = 'dismissed_certificates';
      const dismissedData = localStorage.getItem(dismissedKey);
      const dismissed = dismissedData ? JSON.parse(dismissedData) : {};
      dismissed[`cert_${certId}`] = 'permanent';
      localStorage.setItem(dismissedKey, JSON.stringify(dismissed));
    }
    
    // Remove from list
    setExpiringCertificates(prev => prev.filter(cert => cert.id !== certId));
  };

  const styles = {
    container: {
      maxWidth: '1200px',
      width: '100%',
      minWidth: 0,
      margin: '0 auto',
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    welcome: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    welcomeTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    welcomeText: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    whatsNew: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      minWidth: 0,
      boxSizing: 'border-box'
    },
    whatsNewHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg
    },
    whatsNewTitleRow: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      minWidth: 0
    },
    viewAllButton: {
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '999px',
      padding: '8px 12px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    },
    whatsNewList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    newsItem: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.gray50,
      cursor: 'pointer',
      textAlign: 'left',
      width: '100%',
      boxSizing: 'border-box',
      minWidth: 0
    },
    newsIcon: {
      width: '38px',
      height: '38px',
      borderRadius: '12px',
      backgroundColor: TavariStyles.colors.primary + '15',
      color: TavariStyles.colors.primary,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    },
    newsTitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0
    },
    newsDescription: {
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.xs,
      lineHeight: 1.45
    },
    newsMeta: {
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    },
    emptyNews: {
      padding: TavariStyles.spacing.xl,
      border: `1px dashed ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      color: TavariStyles.colors.gray600,
      textAlign: 'center',
      backgroundColor: TavariStyles.colors.gray50
    },
    homeTabs: {
      display: 'flex',
      gap: '8px',
      marginBottom: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray100,
      padding: '6px',
      borderRadius: '14px',
    },
    homeTabButton: {
      flex: 1,
      border: 'none',
      borderRadius: '10px',
      padding: '10px 14px',
      backgroundColor: 'transparent',
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
    },
    homeTabButtonActive: {
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    },
    statIcon: {
      color: TavariStyles.colors.primary,
      flexShrink: 0
    },
    quickActionsTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.lg
    },
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return '';
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  };

  const formatNewsDate = (dateString, timezone = 'America/Toronto') => {
    if (!dateString) return '';
    const date = new Date(dateString.includes('T') ? dateString : `${dateString}T12:00:00`);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      timeZone: timezone
    });
  };

  const formatStatus = (status = '') => String(status).replace(/_/g, ' ');

  const formatRequestType = (type = '') => {
    const labels = {
      vacation: 'Vacation',
      sick: 'Sick',
      personal: 'Personal',
      bereavement: 'Bereavement',
      jury_duty: 'Jury Duty',
      other: 'Other',
    };
    return labels[type] || formatStatus(type || 'Time off');
  };

  const formatTimeOffRange = (request) => {
    if (!request?.start_date) return 'No date';
    const start = formatDate(request.start_date, stats.businessTimezone);
    const end = request.end_date && request.end_date !== request.start_date
      ? formatDate(request.end_date, stats.businessTimezone)
      : null;
    return end ? `${start} - ${end}` : start;
  };

  const formatCoverageRequestType = (type = '') => {
    const labels = {
      coverage: 'Coverage',
      swap: 'Shift Swap',
    };
    return labels[type] || formatStatus(type || 'Shift coverage');
  };

  const formatCoverageShift = (request) => {
    const shift = request?.scheduling_shifts;
    if (!shift?.shift_date) return 'Shift details pending';
    return `${formatDate(shift.shift_date, stats.businessTimezone)}${shift.start_time ? ` at ${formatTime(shift.start_time)}` : ''}${shift.position ? ` • ${shift.position}` : ''}`;
  };

  const formatDate = (dateString, timezone = 'America/Toronto') => {
    if (!dateString) return 'N/A';
    
    // Add time to avoid timezone shift issues (same approach as Pay Statements)
    const dateWithTime = dateString.includes('T') ? dateString : dateString + 'T12:00:00';
    const dateObj = new Date(dateWithTime);
    
    // Validate date
    if (isNaN(dateObj.getTime())) {
      console.error('formatDate: Invalid date:', dateString);
      return 'Invalid Date';
    }
    
    return dateObj.toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone
    });
  };

  if (loading) {
    return (
      <div style={styles.loading}>Loading dashboard...</div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Certificate Expiry Banners - Shows above welcome message */}
      {expiringCertificates.length > 0 && (
        <div style={{ marginBottom: TavariStyles.spacing.xl, display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.md }}>
          {expiringCertificates.map((cert) => (
            <CertificateExpiryBanner
              key={cert.id}
              certificate={cert}
              onClose={() => handleBannerClose(cert.id)}
              onRenew={() => handleBannerRenew(cert.id)}
            />
          ))}
        </div>
      )}
      
      {isOwnerOrManager && (
        <div style={styles.homeTabs}>
          <button
            type="button"
            style={{ ...styles.homeTabButton, ...(homeView === 'personal' ? styles.homeTabButtonActive : {}) }}
            onClick={() => setHomeView('personal')}
          >
            Personal
          </button>
          <button
            type="button"
            style={{ ...styles.homeTabButton, ...(homeView === 'manager' ? styles.homeTabButtonActive : {}) }}
            onClick={() => setHomeView('manager')}
          >
            Manager
          </button>
        </div>
      )}

      {homeView === 'manager' && isOwnerOrManager ? (
        <PortalManagerDashboard businessId={businessId} businessTimezone={stats.businessTimezone} />
      ) : (
        <>
      <div style={styles.welcome}>
        <h1 style={styles.welcomeTitle}>
          Welcome{user?.first_name ? `, ${user.first_name}` : ''}!
        </h1>
        <p style={styles.welcomeText}>
          Here is what changed recently and what needs your attention.
        </p>
      </div>

      <div style={styles.whatsNew}>
        <div style={styles.whatsNewHeader}>
          <div style={styles.whatsNewTitleRow}>
            <Bell size={24} style={styles.statIcon} />
            <div>
              <h2 style={{ ...styles.quickActionsTitle, marginBottom: 0 }}>What&apos;s New</h2>
              <div style={{ color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
                The 5 newest updates from your employee app.
              </div>
            </div>
          </div>
          <button type="button" style={styles.viewAllButton} onClick={() => navigate(employeeAppPath('/portal/notifications'))}>
            View All
          </button>
        </div>

        {whatsNew.length === 0 ? (
          <div style={styles.emptyNews}>
            Nothing new right now. Updates like posted shifts, pay statements, policies, training, and time-off decisions will appear here.
          </div>
        ) : (
          <div style={styles.whatsNewList}>
            {whatsNew.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => navigate(item.path)}
                  style={styles.newsItem}
                >
                  <span style={styles.newsIcon}>
                    <Icon size={20} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <h3 style={styles.newsTitle}>{item.title}</h3>
                    <div style={styles.newsDescription}>{item.description}</div>
                    <div style={styles.newsMeta}>
                      <Clock size={12} />
                      <span>{item.type} • {formatNewsDate(item.date, stats.businessTimezone)}</span>
                    </div>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
        </>
      )}

    </div>
  );
};

export default PortalDashboard;




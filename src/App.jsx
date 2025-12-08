// src/App.jsx - With centralized auth cleanup on all auth state changes
import { useEffect, useState, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { useMusicService } from './hooks/useMusicService';
import { globalMusicService } from './services/GlobalMusicService';
import { useBusiness } from './contexts/BusinessContext';
import { sessionPersistence } from './services/SessionPersistence';
import { clearAllAuthData } from './utils/authCleanup';

// Import all screens
import Home from './screens/Home';
import Login from './screens/Login';
import Register from './screens/Register';
import Dashboard from './screens/Dashboard';
import Unlock from './screens/Unlock';
import ChangePin from './screens/ChangePin';
import AuditLogViewer from './screens/AuditLogViewer';
import AddUser from './screens/AddUser';
import Locked from './screens/Locked';
import ForgotPassword from "./screens/ForgotPassword";
import DashboardLayout from './layouts/DashboardLayout';
import EmployeeScreen from './screens/EmployeeScreen';
import EmployeeEditor from './screens/EmployeeEditor';
import SettingsScreen from './screens/SettingsScreen';
import NewBusiness from './screens/NewBusiness';
import TavariModules from './screens/TavariModules';

// Centralized Reports screen
import ReportsScreen from './screens/Reports/ReportsScreen';
import ReportAutomationSettings from './screens/Reports/ReportAutomationSettings';

// POS screens imports
import POSRegister from './screens/POS/POSRegister';
import POSInventory from './screens/POS/POSInventory';
import POSCategories from './screens/POS/POSCategories';
import POSModifiers from './screens/POS/POSModifiers';
import POSDiscounts from './screens/POS/POSDiscounts';
import POSReceipts from './screens/POS/POSReceipts';
import POSSettings from './screens/POS/POSSettings';
import POSStationsScreen from './screens/POS/POSStationsScreen';
import POSCustomersScreen from './screens/POS/POSCustomersScreen';
import POSKitchenDisplay from './screens/POS/POSKitchenDisplay';
import POSDailyDepositScreen from './screens/POS/POSDailyDepositScreen';
import SaleReviewScreen from './screens/POS/SaleReviewScreen';
import PaymentScreen from './screens/POS/PaymentScreen';
import ReceiptScreen from './screens/POS/ReceiptScreen';
import POSLoyaltyScreen from './screens/POS/POSLoyaltyScreen';
import RefundsScreen from './screens/POS/RefundsScreen';
import TabScreen from './screens/POS/TabScreen';
import LoyaltySettings from './screens/POS/LoyaltySettings';
import SavedCartsScreen from './screens/POS/SavedCartsScreen';

// Tavari Dining screens imports
import TavariDiningDashboard from './screens/TavariDiningDashboard';
import TableMapScreen from './screens/Dining/TableMapScreen';
import FloorPlanEditor from './screens/Dining/FloorPlanEditor';
import ReservationsScreen from './screens/Dining/ReservationsScreen';
import DiningOrderScreen from './screens/Dining/DiningOrderScreen';

// Liquor Management screens import
import LiquorInventorySystem from './screens/LiquorManagement/LiquorInventorySystem';

// Tavari Music screens imports
import MusicDashboard from './screens/Music/MusicDashboard';
import MusicUpload from './screens/Music/MusicUpload';
import MusicLibrary from './screens/Music/MusicLibrary';
import MusicAdManager from './screens/Music/MusicAdManager';
import PlaylistManager from './screens/Music/PlaylistManager';
import MusicSchedules from './screens/Music/MusicSchedules';
import MusicSystemMonitor from './screens/Music/MusicSystemMonitor';
import MusicDesktopDownload from './screens/Music/MusicDesktopDownload';
import MusicKioskScreen from './screens/Music/MusicKioskScreen';

// Music V2 screens imports
import MusicV2Settings from './screens/MusicV2/MusicV2Settings';
import MusicV2Dashboard from './screens/MusicV2/MusicV2Dashboard';


// Tavari Music Splash Page
import TavariMusicSplash from './screens/TavariMusicSplash';

// New Ad System screens imports
import AdDashboard from './screens/Music/Ads/AdDashboard';
import AdSettings from './screens/Music/Ads/AdSettings';
import RevenueReports from './screens/Music/Ads/RevenueReports';
import PayoutHistory from './screens/Music/Ads/PayoutHistory';

// Tavari Mail screens imports
import MailDashboard from './screens/Mail/MailDashboard';
import MailSettings from './screens/Mail/MailSettings';
import TavariInboxDashboard from './screens/TavariInbox/TavariInboxDashboard';
import BillingManager from './screens/Mail/BillingManager';
import ContactsDashboard from './screens/Mail/ContactsDashboard';
import CampaignList from './screens/Mail/CampaignList';
import ContactsList from './screens/Mail/ContactsList';
import CampaignBuilder from './screens/Mail/CampaignBuilder';
import ContactDetails from './screens/Mail/ContactDetails';
import SendLogsScreen from './screens/Mail/SendLogsScreen';
import PerformanceMonitoringScreen from './screens/Mail/PerformanceMonitoringScreen';
import CampaignDetails from './screens/Mail/CampaignDetails';
import CampaignSender from './screens/Mail/CampaignSender';
import UnsubscribePage from './screens/Mail/UnsubscribePage';

// HR screens imports
import HRDashboard from './screens/HR/HRDashboard';
import EmployeeProfiles from './screens/HR/EmployeeProfiles';
import ContractManagement from './screens/HR/ContractManagement';
import OnboardingCenter from './screens/HR/OnboardingCenter';
import OrientationCalendar from './screens/HR/OrientationCalendar';
import AttendanceTrackingScreen from './screens/HR/AttendanceTrackingScreen';

// Scheduling screens imports
import SchedulingScreen from './screens/Scheduling/SchedulingScreen';
import TimeClockKioskScreen from './screens/Scheduling/TimeClockKioskScreen';
import WriteupManagement from './screens/HR/WriteupManagement';
import PolicyCenter from './screens/HR/PolicyCenter';
import HRSettings from './screens/HR/HRSettings';
import MilestoneScreen from './screens/HR/MilestoneScreen';
import DocumentExpiryTracker from './screens/HR/DocumentExpiryTracker';

// HR Payroll Dashboard import
import HRPayrollDashboard from './screens/HR/HRPayrollScreens/HRPayrollDashboard';

// Recipe Builder Screen import
import RecipeBuilderScreen from './screens/RecipeBuilderScreen';

// AppBuilder screens imports
import AppBuilderDashboard from './screens/AppBuilder/EmployeeAppBuilderDashboard';
import AppBuilderBrandingScreen from './screens/AppBuilder/AppBuilderBrandingScreen';
import AppBuilderModuleManagementScreen from './screens/AppBuilder/AppBuilderModuleManagementScreen';
import AppBuilderBuildScreen from './screens/AppBuilder/AppBuilderBuildScreen';
import AppBuilderDeploymentScreen from './screens/AppBuilder/AppBuilderDeploymentScreen';
import AppBuilderAnalyticsScreen from './screens/AppBuilder/AppBuilderAnalyticsScreen';

// Waivers screens imports
import WaiversDashboard from './screens/Waivers/WaiversDashboard';
import WaiverSignScreen from './screens/Waivers/WaiverSignScreen';
import ContractSignScreen from './screens/HR/ContractSignScreen';
import WaiverSearchScreen from './screens/Waivers/WaiverSearchScreen';
import WaiverDetailScreen from './screens/Waivers/WaiverDetailScreen';
import WaiverListScreen from './screens/Waivers/WaiverListScreen';
import WaiverTemplateManagementScreen from './screens/Waivers/WaiverTemplateManagementScreen';
import WaiverUploadScreen from './screens/Waivers/WaiverUploadScreen';
import WaiverSettingsScreen from './screens/Waivers/WaiverSettingsScreen';

// Digital Signage screens imports
import DigitalSignageDashboard from './screens/DigitalSignage/DigitalSignageDashboard';
import ScreensListScreen from './screens/DigitalSignage/ScreensListScreen';
import ContentLibraryScreen from './screens/DigitalSignage/ContentLibraryScreen';
import ScheduleManagementScreen from './screens/DigitalSignage/ScheduleManagementScreen';
import AnalyticsDashboard from './screens/DigitalSignage/AnalyticsDashboard';
import ZoneManagementScreen from './screens/DigitalSignage/ZoneManagementScreen';
import AdManagementScreen from './screens/DigitalSignage/AdManagementScreen';
import ScreenDetailView from './screens/DigitalSignage/ScreenDetailView';
import MenuBoardDesignScreen from './screens/DigitalSignage/MenuBoardDesignScreen';
import PartyHostManagementScreen from './screens/DigitalSignage/PartyHostManagementScreen';
import ModuleSplashPage from './screens/ModuleSplashPage';

// TOSA (Tavari OS Admin) Employee Portal imports
import TOSAEmployeePortal from './screens/TavariAdmin/TOSAEmployeePortal';
import TOSAEmployeeDashboard from './screens/TavariAdmin/TOSAEmployeeDashboard';
import TOSABusinessEditor from './screens/TavariAdmin/TOSABusinessEditor';
import TOSASecurityMonitoring from './screens/TavariAdmin/TOSASecurityMonitoring';
import TOSACustomerSupport from './screens/TavariAdmin/TOSACustomerSupport';
import TOSASystemHealth from './screens/TavariAdmin/TOSASystemHealth';
import TOSABusinessInsights from './screens/TavariAdmin/TOSABusinessInsights';
import TOSAModuleManagement from './screens/TavariAdmin/TOSAModuleManagement';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const previousUserId = useRef(null);
  const inactivityTimer = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const { business } = useBusiness();

  // Helper: are we in the dedicated music kiosk?
  const isMusicKioskRoute = () => {
    try {
      // Works for both HashRouter and BrowserRouter
      const hash = window.location?.hash || '';
      const pathname = location?.pathname || '';
      return (
        hash.includes('/kiosk/music') ||
        pathname === '/kiosk/music'
      );
    } catch {
      return false;
    }
  };

  // Helper: NEVER navigate away from kiosk in kiosk mode
  const safeNavigate = (to, options) => {
    if (isMusicKioskRoute()) {
      console.log('[Music Kiosk] Suppressed navigate to', to);
      return;
    }
    navigate(to, options);
  };

  // Initialize Global Music Service
  useMusicService();


  // Detect if running in Electron
  useEffect(() => {
    setIsDesktopApp(!!window.electronAPI);
    
    if (window.electronAPI) {
      console.log('Desktop app detected - enhanced features enabled');
    }
  }, []);

  // 🔧 CRITICAL: Clear business cache when auth state changes or user switches
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        // Check if we're in the middle of creating an employee (temporary session switch)
        const isCreatingEmployee = sessionStorage.getItem('_creating_employee') === 'true';
        
        if (isCreatingEmployee) {
          console.log('🔄 Ignoring auth state change during employee creation');
          // Clear the flag after a short delay to allow session restoration
          setTimeout(() => {
            sessionStorage.removeItem('_creating_employee');
          }, 2000);
          return; // Don't clear auth data during employee creation
        }
        
        // Clear any cached business IDs from previous user
        const cachedUserId = localStorage.getItem('lastAuthUserId');
        if (cachedUserId && cachedUserId !== session.user.id) {
          console.log('🔄 Different user signed in, clearing all auth data');
          clearAllAuthData('user_switched_on_signin');
        }
        localStorage.setItem('lastAuthUserId', session.user.id);
      } else if (event === 'SIGNED_OUT') {
        // Check if we're in the middle of creating an employee (temporary session switch)
        const isCreatingEmployee = sessionStorage.getItem('_creating_employee') === 'true';
        
        if (isCreatingEmployee) {
          console.log('🔄 Ignoring SIGNED_OUT event during employee creation');
          return; // Don't clear auth data during employee creation
        }
        
        // 🔧 CRITICAL: Clear all auth data on sign out
        console.log('🔄 User signed out, clearing all auth data');
        clearAllAuthData('signed_out');
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // 5-minute inactivity timer for PIN lock (only affects inactivity, not session expiry)
  const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    // Only set up inactivity timer if user is logged in
    if (!session) return;

    // 🔒 Do NOT lock in music kiosk mode
    if (isMusicKioskRoute()) {
      console.log('[Music Kiosk] Skipping inactivity lock');
      return;
    }

    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(async () => {
        console.log('⏰ Inactivity timeout – requiring PIN re-entry');

        const currentUser = await supabase.auth.getUser();
        if (currentUser?.data?.user?.id) {
          const { error: auditError } = await supabase.from('audit_logs').insert({
            user_id: currentUser.data.user.id,
            event_type: 'timeout_logout',
            details: {
              reason: 'inactivity_pin_lock',
              time: new Date().toISOString(),
              stay_logged_in: sessionPersistence.isPersistenceEnabled()
            },
          });

          if (auditError) {
            console.warn('⚠️ Failed to log inactivity timeout:', auditError.message);
          }
        }

        // Remember the route we were on before redirecting to unlock screen
        const currentPath = `${location.pathname}${location.search}${location.hash}`;
        if (location.pathname !== '/unlock') {
          sessionStorage.setItem('unlockReturnPath', currentPath);
        }

        // Navigate to PIN unlock screen (session remains active)
        safeNavigate('/unlock');
      }, INACTIVITY_LIMIT);
    };

    const events = ['mousemove', 'keydown', 'click', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, resetTimer));
    resetTimer(); // Start initial timer

    return () => {
      events.forEach((event) => window.removeEventListener(event, resetTimer));
      clearTimeout(inactivityTimer.current);
    };
  }, [navigate, session, location]);

  // ✅ BULLETPROOF SESSION RESTORATION WITH AUTH CLEANUP
  useEffect(() => {
    const initializeSession = async () => {
        // For Electron desktop app: Try to restore from saved session file first
        // This works for BOTH kiosk and regular routes - session is needed for business ID
        if (window.electronAPI) {
          try {
            const savedSession = await window.electronAPI.loadSession();
            if (savedSession) {
              console.log('🔐 Found saved session in desktop app, restoring...');
              
              // CRITICAL: Set business ID to localStorage if available
              if (savedSession.business_id) {
                localStorage.setItem('selectedBusinessId', savedSession.business_id);
                localStorage.setItem('currentBusinessId', savedSession.business_id);
                console.log('✅ Business ID set from Electron session:', savedSession.business_id);
              }
              
              const { data: { session }, error } = await supabase.auth.setSession({
                access_token: savedSession.access_token,
                refresh_token: savedSession.refresh_token
              });
              
              if (!error && session) {
                console.log('✅ Desktop app session restored successfully');
                setSession(session);
                // CRITICAL: Always set loading to false for kiosk route so UI can render
                setLoading(false);
                return;
              } else {
                // Silently handle session restore failures - expected if no valid session exists
                if (error?.message?.includes('Auth session missing') || error?.message?.includes('session_not_found')) {
                  console.log('ℹ️ No saved session found (will show login if needed)');
                } else {
                  console.warn('⚠️ Failed to restore desktop session:', error?.message || error);
                }
                // Even if session restore fails, set loading to false for kiosk
                if (isMusicKioskRoute()) {
                  setLoading(false);
                  return;
                }
              }
            } else {
              console.log('⚠️ No saved session found in Electron app');
              // No session found - still set loading to false for kiosk so login screen can show
              if (isMusicKioskRoute()) {
                setLoading(false);
                return;
              }
            }
          } catch (err) {
            console.warn('⚠️ Error loading desktop session:', err);
            // On error, still set loading to false for kiosk
            if (isMusicKioskRoute()) {
              setLoading(false);
              return;
            }
          }
        }
      
      // Try to restore persistent session if enabled (for both kiosk and regular routes)
      const restoreResult = await sessionPersistence.restoreSession();
      
      if (restoreResult.restored) {
        setSession(restoreResult.session);
        // For kiosk route, ensure session is set but skip redirects
        if (isMusicKioskRoute()) {
          console.log('🎵 Music Kiosk route - session restored from persistence');
          setLoading(false);
          return;
        }
        setLoading(false);
        return;
      }
      
      // Check for active Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      
      // For kiosk route, ensure session is set but skip redirects
      if (isMusicKioskRoute()) {
        console.log('🎵 Music Kiosk route - ensuring session is set for business ID fetch');
        if (session) {
          setSession(session); // ✅ Ensure Supabase client has session in memory
          console.log('✅ Session set for kiosk - business ID fetch can proceed');
        } else {
          console.log('⚠️ No session found for kiosk - will need manual business selection');
        }
        // CRITICAL: Always set loading to false for kiosk route so UI can render
        setLoading(false);
        return;
      }
      
      setSession(session);
      setLoading(false);
    };

    initializeSession();

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      // 🔒 CRITICAL: Skip all auth redirects for kiosk routes
      if (isMusicKioskRoute()) {
        // Just update session state, no redirects
        setSession(session);
        return;
      }
      
      setSession(session);

      if (session) {

        const stayLoggedIn = sessionPersistence.isPersistenceEnabled();
        if (stayLoggedIn) {
          sessionPersistence.startAutoRefresh();
        }
      } else {
        if (event === 'INITIAL_SESSION') {
          return;
        }

        const stayLoggedIn = sessionPersistence.isPersistenceEnabled();

        if (!session && stayLoggedIn && event !== 'SIGNED_OUT' && event !== 'USER_DELETED') {
          // Session lost but stay logged in is enabled - try to restore
          console.log('🔄 Session lost but stayLoggedIn enabled - attempting restore');
          
          const restoreResult = await sessionPersistence.restoreSession();
          
          if (restoreResult.restored && restoreResult.session) {
            console.log('✅ Session restored successfully');
            setSession(restoreResult.session);
            // Don't navigate - let the user continue where they are
            return;
          } else {
            console.log('❌ Restore failed - showing unlock');
            safeNavigate('/unlock');
            return;
          }
        }

        if (event === 'SIGNED_OUT') {
          // 🔧 CRITICAL: Clear all auth data on signed out event
          clearAllAuthData('auth_state_signed_out');
          
          if (stayLoggedIn) {
            console.log('🔒 Session ended but stay logged in enabled - showing unlock screen');
            safeNavigate('/unlock');
          } else {
            console.log('👋 User logged out - cleaning up');
            globalMusicService.destroy();
            sessionPersistence.disablePersistence();
            safeNavigate('/login');
          }
        } else if (event === 'TOKEN_REFRESHED' && !session) {
          if (stayLoggedIn) {
            console.log('🔄 Token refresh failed - attempting restore');
            
            const restoreResult = await sessionPersistence.restoreSession();
            
            if (!restoreResult.restored) {
              console.log('❌ Restore failed - showing unlock');
              safeNavigate('/unlock');
            }
          } else {
            console.log('❌ Token refresh failed - logging out');
            clearAllAuthData('token_refresh_failed');
            globalMusicService.destroy();
            sessionPersistence.disablePersistence();
            safeNavigate('/login');
          }
        } else if (event === 'USER_DELETED') {
          // 🔧 CRITICAL: Clear all auth data when user deleted
          console.log('🗑️ User account deleted - cleaning up');
          clearAllAuthData('user_deleted');
          globalMusicService.destroy();
          sessionPersistence.disablePersistence();
          safeNavigate('/login');
        }
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [navigate, location]);
  
  // Initialize music service with business context once available
  useEffect(() => {
    if (!session) return;
    if (!business?.id) return;

    globalMusicService.initialize(business.id);
  }, [session, business?.id]);

  // Clean up any legacy 3AM session data on app load
  useEffect(() => {
    const hasLegacyExpiry = localStorage.getItem('expiresAt');
    if (hasLegacyExpiry) {
      localStorage.removeItem('expiresAt');
    }
  }, []);

  // For kiosk route, never show loading screen - let kiosk screen handle its own loading
  if (loading && !isMusicKioskRoute()) {
    return (
      <div style={loadingStyles.container}>
        <div style={loadingStyles.spinner}></div>
        <div style={loadingStyles.text}>Loading Tavari System...</div>
        {isDesktopApp && (
          <div style={loadingStyles.desktopNote}>Desktop Mode</div>
        )}
      </div>
    );
  }

  // REMOVED: Navigation fix causing infinite loop
  // HashRouter handles hash routing automatically - no need to force navigation

  return (
      <Routes>
        {/* PUBLIC ROUTES (No authentication required) */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/unsubscribe" element={<UnsubscribePage />} />
        <Route path="/tavarimusic" element={<TavariMusicSplash />} />
        {/* Music Kiosk - Public route for Electron (dedicated music player, no auth required) */}
        {/* MUST be outside /dashboard to avoid protected route collision */}
        <Route path="/kiosk/music" element={<MusicKioskScreen />} />
        <Route path="/modules" element={<TavariModules />} />
        
        {/* PUBLIC WAIVER ROUTES */}
        <Route path="/waivers/sign/:signatureToken" element={<WaiverSignScreen />} />
        
        {/* PUBLIC CONTRACT SIGNING ROUTES */}
        <Route path="/contract/sign/:token" element={<ContractSignScreen />} />
        
        {/* TOSA EMPLOYEE PORTAL ROUTES (Hidden from main site) */}
        <Route path="/employeeportal" element={<TOSAEmployeePortal />} />
        
        {/* TOSA PROTECTED ROUTES - Separate from business dashboard */}
        <Route path="/tosa/*" element={<TOSAEmployeeRoutes />} />
        
        {/* PROTECTED DASHBOARD ROUTES */}
        <Route
          path="/dashboard"
          element={
            session ? <DashboardLayout /> : 
            (sessionPersistence.isPersistenceEnabled() ? <Navigate to="/unlock" /> : <Navigate to="/login" />)
          }
        >
          {/* Main Dashboard */}
          <Route path="home" element={<Dashboard />} />
          
          {/* Module Splash Page */}
          <Route path="modules/:moduleKey" element={<ModuleSplashPage />} />
          
          {/* User Management */}
          <Route path="change-pin" element={<ChangePin />} />
          <Route path="audit-logs" element={<AuditLogViewer />} />
          <Route path="add-user" element={<AddUser />} />
          <Route path="employees" element={<EmployeeScreen />} />
          <Route path="employee/:id" element={<EmployeeEditor />} />
          <Route path="settings" element={<SettingsScreen />} />

          {/* CENTRALIZED REPORTS & ANALYTICS */}
          <Route path="reports" element={<ReportsScreen />} />
          <Route path="reports/automation" element={<ReportAutomationSettings />} />

          {/* TAVARI DINING ROUTES */}
          <Route path="dining/dashboard" element={<TavariDiningDashboard />} />
          <Route path="dining/table-map" element={<TableMapScreen />} />
          <Route path="dining/floor-editor" element={<FloorPlanEditor />} />
          <Route path="dining/reservations" element={<ReservationsScreen />} />
          <Route path="dining/table-order" element={<DiningOrderScreen />} />

          {/* POS System Routes */}
          <Route path="pos/register" element={<POSRegister />} />
          <Route path="pos/inventory" element={<POSInventory />} />
          <Route path="pos/categories" element={<POSCategories />} />
          <Route path="pos/modifiers" element={<POSModifiers />} />
          <Route path="pos/discounts" element={<POSDiscounts />} />
          <Route path="pos/customers" element={<POSCustomersScreen />} />
          <Route path="pos/receipts" element={<POSReceipts />} />
          <Route path="pos/settings" element={<POSSettings />} />
          <Route path="pos/stations" element={<POSStationsScreen />} />
          <Route path="pos/kitchen-display" element={<POSKitchenDisplay />} />
          <Route path="pos/daily-deposit" element={<POSDailyDepositScreen />} />
          <Route path="pos/sale-review" element={<SaleReviewScreen />} />
          <Route path="pos/payment" element={<PaymentScreen />} />
          <Route path="pos/receipt" element={<ReceiptScreen />} />
          <Route path="pos/loyalty" element={<POSLoyaltyScreen />} />
          <Route path="pos/refunds" element={<RefundsScreen />} />
          <Route path="pos/tabs" element={<TabScreen />} />
          <Route path="pos/loyalty-settings" element={<LoyaltySettings />} />
          <Route path="pos/saved-carts" element={<SavedCartsScreen />} />

          {/* Liquor Management System Routes */}
          <Route path="liquor/inventory" element={<LiquorInventorySystem />} />
          <Route path="liquor/products" element={<LiquorInventorySystem />} />
          <Route path="liquor/variances" element={<LiquorInventorySystem />} />
          <Route path="liquor/reports" element={<LiquorInventorySystem />} />

          {/* Music System Routes */}
          <Route path="music/dashboard" element={<MusicDashboard />} />
          <Route path="music/upload" element={<MusicUpload />} />
          <Route path="music/library" element={<MusicLibrary />} />
          <Route path="music/ads" element={<MusicAdManager />} />
          <Route path="music/playlists" element={<PlaylistManager />} />
          <Route path="music/schedules" element={<MusicSchedules />} />
		  <Route path="music/system-monitor" element={<MusicSystemMonitor />} />
          <Route path="music/desktop-download" element={<MusicDesktopDownload />} />
          
          {/* Music V2 System Routes */}
          <Route path="music/v2/dashboard" element={<MusicV2Dashboard />} />
          <Route path="music/v2/settings" element={<MusicV2Settings />} />
          
          {/* New Ad System Routes */}
          <Route path="music/ads/dashboard" element={<AdDashboard />} />
          <Route path="music/ads/settings" element={<AdSettings />} />
          <Route path="music/ads/revenue" element={<RevenueReports />} />
          <Route path="music/ads/payouts" element={<PayoutHistory />} />

          {/* Tavari Mail System Routes */}
          <Route path="mail/dashboard" element={<MailDashboard />} />
          <Route path="mail/campaigns" element={<CampaignList />} />
          <Route path="mail/contacts" element={<ContactsList />} />
          <Route path="mail/contacts/edit/:id" element={<ContactDetails />} />
          <Route path="mail/builder" element={<CampaignBuilder />} />
          <Route path="mail/builder/:campaignId" element={<CampaignBuilder />} />
          <Route path="mail/templates" element={<CampaignList />} />
          <Route path="mail/compliance" element={<ContactsDashboard />} />
          <Route path="mail/billing" element={<BillingManager />} />
          <Route path="mail/settings" element={<MailSettings />} />
          <Route path="mail/sender/:campaignId" element={<CampaignSender />} />
          <Route path="mail/campaigns/:campaignId" element={<CampaignDetails />} />
          <Route path="mail/logs" element={<SendLogsScreen />} />
          <Route path="mail/performance" element={<PerformanceMonitoringScreen />} />
          
          {/* Tavari Inbox Routes */}
          <Route path="inbox" element={<TavariInboxDashboard />} />

          {/* HR System Routes */}
          <Route path="hr/dashboard" element={<HRDashboard />} />
          <Route path="hr/payroll" element={<HRPayrollDashboard />} />
          <Route path="hr/employees" element={<EmployeeProfiles />} />
          <Route path="hr/contracts" element={<ContractManagement />} />
          <Route path="hr/onboarding" element={<OnboardingCenter />} />
          <Route path="hr/milestones" element={<MilestoneScreen />} />
          <Route path="hr/orientation" element={<OrientationCalendar />} />
          <Route path="hr/orientation/attendance/:sessionId" element={<AttendanceTrackingScreen />} />
          <Route path="hr/writeups" element={<WriteupManagement />} />
          <Route path="hr/policies" element={<PolicyCenter />} />
          <Route path="hr/settings" element={<HRSettings />} />
          <Route path="hr/document-expiry" element={<DocumentExpiryTracker />} />

          {/* Scheduling System Routes */}
          <Route path="scheduling" element={<SchedulingScreen />} />
          <Route path="time-clock-kiosk" element={<TimeClockKioskScreen />} />

          {/* Recipe Builder Routes */}
          <Route path="recipe-builder" element={<RecipeBuilderScreen />} />

          {/* AppBuilder Routes */}
          <Route path="appbuilder" element={<AppBuilderDashboard />} />
          <Route path="appbuilder/branding" element={<AppBuilderBrandingScreen />} />
          <Route path="appbuilder/modules" element={<AppBuilderModuleManagementScreen />} />
          <Route path="appbuilder/builds" element={<AppBuilderBuildScreen />} />
          <Route path="appbuilder/deployments" element={<AppBuilderDeploymentScreen />} />
          <Route path="appbuilder/analytics" element={<AppBuilderAnalyticsScreen />} />

          {/* Waivers Routes */}
          <Route path="waivers" element={<WaiversDashboard />} />
          <Route path="waivers/search" element={<WaiverSearchScreen />} />
          <Route path="waivers/list" element={<WaiverListScreen />} />
          <Route path="waivers/templates" element={<WaiverTemplateManagementScreen />} />
          <Route path="waivers/upload" element={<WaiverUploadScreen />} />
          <Route path="waivers/settings" element={<WaiverSettingsScreen />} />
          <Route path="waivers/:waiverId" element={<WaiverDetailScreen />} />

          {/* Digital Signage Routes */}
          <Route path="digital-signage" element={<DigitalSignageDashboard />} />
          <Route path="digital-signage/screens" element={<ScreensListScreen />} />
          <Route path="digital-signage/screens/:id" element={<ScreenDetailView />} />
          <Route path="digital-signage/content" element={<ContentLibraryScreen />} />
          <Route path="digital-signage/schedules" element={<ScheduleManagementScreen />} />
          <Route path="digital-signage/zones" element={<ZoneManagementScreen />} />
          <Route path="digital-signage/ads" element={<AdManagementScreen />} />
          <Route path="digital-signage/menu-boards" element={<MenuBoardDesignScreen />} />
          <Route path="digital-signage/party-hosts" element={<PartyHostManagementScreen />} />
          <Route path="digital-signage/analytics" element={<AnalyticsDashboard />} />
        </Route>

        {/* AUTHENTICATION & UTILITY ROUTES */}
          <Route 
          path="/unlock" 
          element={
            session ? <Unlock session={session} /> : 
            (sessionPersistence.isPersistenceEnabled() ? <Unlock session={null} /> : <Navigate to="/login" />)
          }
        />
        <Route path="/locked" element={<Locked />} />
        <Route path="/dashboard/new-business" element={<NewBusiness />} />
        
        {/* Fallback Route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
}

/**
 * TOSA Employee Routes Component
 * Handles all Tavari OS Admin employee portal routing
 */
function TOSAEmployeeRoutes() {
  return (
    <Routes>
      {/* TOSA Dashboard and Main Screens */}
      <Route path="dashboard" element={<TOSAEmployeeDashboard />} />
      <Route path="business-editor" element={<TOSABusinessEditor />} />
      <Route path="business-editor/:businessId" element={<TOSABusinessEditor />} />
      <Route path="security-monitoring" element={<TOSASecurityMonitoring />} />
      <Route path="customer-support" element={<TOSACustomerSupport />} />
      <Route path="system-health" element={<TOSASystemHealth />} />
      <Route path="business-insights" element={<TOSABusinessInsights />} />
      <Route path="module-management" element={<TOSAModuleManagement />} />
      
      {/* Default TOSA route redirects to dashboard */}
      <Route path="" element={<Navigate to="/tosa/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/tosa/dashboard" replace />} />
    </Routes>
  );
}

// Loading screen styles
const loadingStyles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e9ecef',
    borderTop: '4px solid #20c997',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '20px',
  },
  text: {
    fontSize: '18px',
    color: '#333',
    fontWeight: '500',
    marginBottom: '10px',
  },
  desktopNote: {
    fontSize: '14px',
    color: '#20c997',
    fontWeight: 'bold',
    padding: '4px 12px',
    backgroundColor: '#e8f8f5',
    borderRadius: '12px',
  },
};

// Add spinner animation CSS if not already present
if (!document.querySelector('#app-loading-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'app-loading-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default App;
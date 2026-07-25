// src/App.jsx - With centralized auth cleanup on all auth state changes
import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { useMusicService } from './hooks/useMusicService';
import { globalMusicService } from './services/GlobalMusicService';
import { useBusiness } from './contexts/BusinessContext';
import { sessionPersistence } from './services/SessionPersistence';
import { clearAllAuthData } from './utils/authCleanup';
import { isEmployeeAppHost, isEmployeePortalPath, isPunchClockAppHost } from './utils/employeeAppRouting';
import {
  clearWaiverBrowserKioskLock,
  refreshWaiverBrowserKioskLock,
  getWaiverBrowserKioskRedirectPath,
} from './utils/waiverBrowserKioskLock';
import { Toaster } from 'react-hot-toast';
import {
  setCustomerDisplayPosLocked,
  getCustomerDisplayBusinessId,
  resetCustomerDisplayMirrorToAds
} from './services/customerDisplayLocalState';
import { flushCustomerDisplayMirrorPush } from './services/customerDisplayMirrorSync';
import SessionManager from './components/SessionManager';

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
import DashboardRouteGuard from './components/Auth/DashboardRouteGuard';
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
import POSBundles from './screens/POS/POSBundles';
import POSCategories from './screens/POS/POSCategories';
import POSModifiers from './screens/POS/POSModifiers';
import POSDiscounts from './screens/POS/POSDiscounts';
import POSReceipts from './screens/POS/POSReceipts';
import BookingsReceipts from './screens/Bookings/BookingsReceipts';
import POSSettings from './screens/POS/POSSettings';
import POSStationsScreen from './screens/POS/POSStationsScreen';
import POSCustomersScreen from './screens/POS/POSCustomersScreen';
import POSKitchenDisplay from './screens/POS/POSKitchenDisplay';
import POSDailyDepositScreen from './screens/POS/POSDailyDepositScreen';
import SaleReviewScreen from './screens/POS/SaleReviewScreen';
import PaymentScreen from './screens/POS/PaymentScreen';
import HelcimRealtimeDebugScreen from './screens/POS/HelcimRealtimeDebugScreen';
import ReceiptScreen from './screens/POS/ReceiptScreen';
import POSLoyaltyScreen from './screens/POS/POSLoyaltyScreen';
import RefundsScreen from './screens/POS/RefundsScreen';
import TabScreen from './screens/POS/TabScreen';
import LoyaltySettings from './screens/POS/LoyaltySettings';
import SavedCartsScreen from './screens/POS/SavedCartsScreen';
import POSReportsScreen from './screens/POS/POSReportsScreen';
import DailySalesLedger from './screens/POS/DailySalesLedger';
import CustomerDisplayFullscreen from './components/POS/CustomerDisplayFullscreen';
import CompCustomerDisplayAds from './components/POS/CustomerDisplayAds';
import CustomerDisplaySetupScreen from './screens/POS/CustomerDisplaySetupScreen';
import CustomerDisplayPairScreen from './screens/POS/CustomerDisplayPairScreen';

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

// Tavari Voice Splash Page
import TavariVoiceSplash from './screens/TavariVoiceSplash';

// Voice-Only Layout (no sidebar)
import VoiceOnlyLayout from './layouts/VoiceOnlyLayout';

// Vending Machine screens imports
import VendingMachineScreen from './screens/VendingMachine/VendingMachineScreen';
import SelfServePayKioskScreen from './screens/Kiosk/SelfServePayKioskScreen';
import VendingDashboard from './screens/Vending/VendingDashboard';
import VendingKioskDownloadScreen from './screens/Vending/VendingKioskDownloadScreen';
import PowerBankDashboard from './screens/PowerBank/PowerBankDashboard';
import DividendIncomeDashboard from './screens/DividendIncome/DividendIncomeDashboard';

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
import MailComplianceDashboard from './screens/Mail/MailComplianceDashboard';
import CampaignList from './screens/Mail/CampaignList';
import ContactsList from './screens/Mail/ContactsList';
import CampaignBuilder from './screens/Mail/CampaignBuilder';
import ContactDetails from './screens/Mail/ContactDetails';
import SendLogsScreen from './screens/Mail/SendLogsScreen';
import PerformanceMonitoringScreen from './screens/Mail/PerformanceMonitoringScreen';
import CampaignDetails from './screens/Mail/CampaignDetails';
import CampaignSender from './screens/Mail/CampaignSender';
import UnsubscribePage from './screens/Mail/UnsubscribePage';
import MailAutomations from './screens/Mail/MailAutomations';

// HR screens imports
import HRDashboard from './screens/HR/HRDashboard';
import HREmployeeManagementHub from './screens/HR/HREmployeeManagementHub';
import HRTrainingHub from './screens/HR/HRTrainingHub';
import HRCommunicationsHub from './screens/HR/HRCommunicationsHub';
import HRSettingsRouteRedirect from './screens/HR/HRSettingsRouteRedirect';
import AttendanceTrackingScreen from './screens/HR/AttendanceTrackingScreen';

// Scheduling screens imports
import SchedulingScreen from './screens/Scheduling/SchedulingScreen';
import TimeClockKioskScreen from './screens/Scheduling/TimeClockKioskScreen';
import AbsenceReasonScreen from './screens/Scheduling/AbsenceReasonScreen';

// HR Payroll Dashboard import
import HRPayrollDashboard from './screens/HR/HRPayrollScreens/HRPayrollDashboard';

// Social Media Dashboard import
import SocialMediaDashboard from './screens/SocialMedia/SocialMediaDashboard';
import TikTokCreatePost from './screens/SocialMedia/TikTokCreatePost';
import TikTokAuthCallback from './screens/SocialMedia/TikTokAuthCallback';
import TermsOfService from './screens/SocialMedia/TermsOfService';
import PrivacyPolicy from './screens/SocialMedia/PrivacyPolicy';

// Voice Agent Dashboard import
import VoiceAgentDashboard from './screens/VoiceAgent/VoiceAgentDashboard';
// Custom Voice Agent Dashboard import
import CustomVoiceAgentDashboard from './screens/CustomVoiceAgent/CustomVoiceAgentDashboard';

// Recipe Builder Screen import
import RecipeBuilderScreen from './screens/RecipeBuilderScreen';

// AppBuilder screens imports
import AppBuilderDashboard from './screens/AppBuilder/EmployeeAppBuilderDashboard';
import AppBuilderBrandingScreen from './screens/AppBuilder/AppBuilderBrandingScreen';
import AppBuilderModuleManagementScreen from './screens/AppBuilder/AppBuilderModuleManagementScreen';
import AppBuilderBuildScreen from './screens/AppBuilder/AppBuilderBuildScreen';
import AppBuilderDeploymentScreen from './screens/AppBuilder/AppBuilderDeploymentScreen';
import AppBuilderAnalyticsScreen from './screens/AppBuilder/AppBuilderAnalyticsScreen';
import AppBuilderSettingsScreen from './screens/AppBuilder/AppBuilderSettingsScreen';

// Accounting screens imports
import AccountingDashboard from './screens/Accounting/AccountingDashboard';
import AccountingQueue from './screens/Accounting/AccountingQueue';
import AccountingSettings from './screens/Accounting/AccountingSettings';
import AccountingReports from './screens/Accounting/AccountingReports';
import AccountingVendors from './screens/Accounting/AccountingVendors';
import AccountingCategories from './screens/Accounting/AccountingCategories';
import AccountingBankImport from './screens/Accounting/AccountingBankImport';
import FileStorageDashboard from './screens/FileStorage/FileStorageDashboard';
import TasksDashboard from './screens/Tasks/TasksDashboard';
import FormsDashboard from './screens/Forms/FormsDashboard';
import FormsFillScreen from './screens/Forms/FormsFillScreen';

// Bookings screens imports
import BookingsModuleLayout from './layouts/BookingsModuleLayout';
import BookingsDashboard from './screens/Bookings/BookingsDashboard';
import BookingCreateScreen from './screens/Bookings/BookingCreateScreen';
import BookingCalendarScreen from './screens/Bookings/BookingCalendarScreen';
import BookingDetailScreen from './screens/Bookings/BookingDetailScreen';
import PartiesDashboard from './screens/Bookings/PartiesDashboard';
import PartyGuestListDetailScreen from './screens/Bookings/PartyGuestListDetailScreen';
import PartyGuestListSettingsScreen from './screens/Bookings/PartyGuestListSettingsScreen';
import CustomerPortalPartyGuestListPage from './screens/Bookings/CustomerPortalPartyGuestListPage';
import BookingListScreen from './screens/Bookings/BookingListScreen';
import BookingCheckInScreen from './screens/Bookings/BookingCheckInScreen';
import CustomerPortalPage from './screens/Bookings/CustomerPortalPage';
import CustomerPortalActivityPage from './screens/Bookings/CustomerPortalActivityPage';
import BookingConfirmedPage from './screens/Bookings/BookingConfirmedPage';
import CustomerManageBookingPage from './screens/Bookings/CustomerManageBookingPage';
import CustomerManageBookingLookupPage from './screens/Bookings/CustomerManageBookingLookupPage';
import BookingTermsAcknowledgmentPage from './screens/Bookings/BookingTermsAcknowledgmentPage';
import CustomerPortalLayout from './screens/Bookings/CustomerPortalLayout';
import CustomerPortalDashboard from './screens/Bookings/CustomerPortalDashboard';
import CustomerPortalBookingsPage from './screens/Bookings/CustomerPortalBookingsPage';
import CustomerPortalWaiversPage from './screens/Bookings/CustomerPortalWaiversPage';
import CustomerPortalAccountPage from './screens/Bookings/CustomerPortalAccountPage';
import CustomerPortalPartiesPage from './screens/Bookings/CustomerPortalPartiesPage';
import CustomerPortalNotificationsPage from './screens/Bookings/CustomerPortalNotificationsPage';
import CamperRegistrationFormScreen from './screens/Bookings/CamperRegistrationFormScreen';
import CamperRegistrationCompletePage from './screens/Bookings/CamperRegistrationCompletePage';
import CustomerPortalCampRegistrationPage from './screens/Bookings/CustomerPortalCampRegistrationPage';

// Waivers screens imports
import WaiversDashboard from './screens/Waivers/WaiversDashboard';
import WaiverSignScreen from './screens/Waivers/WaiverSignScreen';
import PublicWaiverFlow from './screens/Waivers/PublicWaiverFlow';
import BookingWaiverFlow from './screens/Waivers/BookingWaiverFlow';
import WaiverKioskScreen from './screens/Waivers/WaiverKioskScreen';
import WaiverReportsScreen from './screens/Waivers/WaiverReportsScreen';
import WaiverKioskDownloadScreen from './screens/Waivers/WaiverKioskDownloadScreen';
import ContractSignScreen from './screens/HR/ContractSignScreen';
import AuthorizedRepSignScreen from './screens/HR/AuthorizedRepSignScreen';
import ContractViewScreen from './screens/HR/ContractViewScreen';
import PersonalInfoFormScreen from './screens/HR/PersonalInfoFormScreen';
import WaiverSearchScreen from './screens/Waivers/WaiverSearchScreen';
import WaiverDetailScreen from './screens/Waivers/WaiverDetailScreen';
import WaiverListScreen from './screens/Waivers/WaiverListScreen';
import WaiverTemplateManagementScreen from './screens/Waivers/WaiverTemplateManagementScreen';
import WaiverUploadScreen from './screens/Waivers/WaiverUploadScreen';
import WaiverSettingsScreen from './screens/Waivers/WaiverSettingsScreen';
import PaperWaiversViewScreen from './screens/Waivers/PaperWaiversViewScreen';
import WaiversModuleLayout from './screens/Waivers/WaiversModuleLayout';

// Digital Signage screens imports
import DigitalSignageDashboard from './screens/DigitalSignage/DigitalSignageDashboard';
import SignagePlayerScreen from './screens/DigitalSignage/SignagePlayerScreen';
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

import ReputationModuleLayout from './screens/Reputation/ReputationModuleLayout';
import ReputationDashboard from './screens/Reputation/ReputationDashboard';
import ReputationSettings from './screens/Reputation/ReputationSettings';
import ReputationCollectPage from './screens/Reputation/ReputationCollectPage';
import ReputationLegalPrivacy from './screens/Reputation/ReputationLegalPrivacy';
import ReputationLegalTerms from './screens/Reputation/ReputationLegalTerms';

import CoparentPrivacyPolicy from './screens/PullTogether/CoparentPrivacyPolicy';
import CoparentTermsOfService from './screens/PullTogether/CoparentTermsOfService';
import PetCarePrivacyPolicy from './screens/PullTogether/PetCarePrivacyPolicy';
import PetCareTermsOfService from './screens/PullTogether/PetCareTermsOfService';

import RemindersModuleLayout from './screens/Reminders/RemindersModuleLayout';
import RemindersList from './screens/Reminders/RemindersList';
import ActiveReminders from './screens/Reminders/ActiveReminders';
import CompletedReminders from './screens/Reminders/CompletedReminders';
import ReminderFormScreen from './screens/Reminders/ReminderFormScreen';
import ReminderHistory from './screens/Reminders/ReminderHistory';
import RemindersSettingsScreen from './screens/Reminders/RemindersSettingsScreen';
import ReminderActionPage from './screens/Reminders/ReminderActionPage';
import ShiftPremiumApprovalActionPage from './screens/HR/ShiftPremiumApprovalActionPage';

import InvoicesModuleLayout from './screens/Invoices/InvoicesModuleLayout';
import InvoicesDashboard from './screens/Invoices/InvoicesDashboard';
import InvoiceFormScreen from './screens/Invoices/InvoiceFormScreen';
import InvoiceDetailScreen from './screens/Invoices/InvoiceDetailScreen';
import RecurringInvoicesScreen from './screens/Invoices/RecurringInvoicesScreen';
import RecurringInvoiceFormScreen from './screens/Invoices/RecurringInvoiceFormScreen';
import InvoiceSettingsScreen from './screens/Invoices/InvoiceSettingsScreen';
import InvoiceHistoryScreen from './screens/Invoices/InvoiceHistoryScreen';
import PublicInvoicePayPage from './screens/Invoices/PublicInvoicePayPage';
import PublicInvoiceEtransferConfirmPage from './screens/Invoices/PublicInvoiceEtransferConfirmPage';

import FundingModuleLayout from './screens/Funding/FundingModuleLayout';
import GiftCardsModuleLayout from './screens/GiftCards/GiftCardsModuleLayout';
import GiftCardsDashboard from './screens/GiftCards/GiftCardsDashboard';
import GiftCardsListScreen from './screens/GiftCards/GiftCardsListScreen';
import GiftCardsIssueScreen from './screens/GiftCards/GiftCardsIssueScreen';
import GiftCardsProductsScreen from './screens/GiftCards/GiftCardsProductsScreen';
import GiftCardsPromotionsScreen from './screens/GiftCards/GiftCardsPromotionsScreen';
import GiftCardsDesignsScreen from './screens/GiftCards/GiftCardsDesignsScreen';
import GiftCardsSettingsScreen from './screens/GiftCards/GiftCardsSettingsScreen';
import GiftCardsReportsScreen from './screens/GiftCards/GiftCardsReportsScreen';
import DealsModuleLayout from './screens/Deals/DealsModuleLayout';
import DealsDashboard from './screens/Deals/DealsDashboard';
import DealsManageScreen from './screens/Deals/DealsManageScreen';
import DealsPrintScreen from './screens/Deals/DealsPrintScreen';
import DealsSettingsScreen from './screens/Deals/DealsSettingsScreen';
import FundingDashboard from './screens/Funding/FundingDashboard';
import FundingPlansScreen from './screens/Funding/FundingPlansScreen';
import FundingPlanDetailScreen from './screens/Funding/FundingPlanDetailScreen';
import FundingApplicationsScreen from './screens/Funding/FundingApplicationsScreen';
import FundingApplicationDetailScreen from './screens/Funding/FundingApplicationDetailScreen';
import FundingOpportunitiesScreen from './screens/Funding/FundingOpportunitiesScreen';
import FundingSettingsScreen from './screens/Funding/FundingSettingsScreen';
import FundingGuestAccessPage from './screens/Funding/FundingGuestAccessPage';

import TavariApisModuleLayout from './screens/TavariApis/TavariApisModuleLayout';
import TavariApisOverview from './screens/TavariApis/TavariApisOverview';
import TavariApisEndpoints from './screens/TavariApis/TavariApisEndpoints';
import TavariApisConsumers from './screens/TavariApis/TavariApisConsumers';
import TavariApisSettings from './screens/TavariApis/TavariApisSettings';

// TOSA (Tavari OS Admin) Employee Portal imports
import TOSAEmployeePortal from './screens/TavariAdmin/TOSAEmployeePortal';
import TOSAEmployeeDashboard from './screens/TavariAdmin/TOSAEmployeeDashboard';
import TOSABusinessEditor from './screens/TavariAdmin/TOSABusinessEditor';
import TOSASecurityMonitoring from './screens/TavariAdmin/TOSASecurityMonitoring';
import TOSACustomerSupport from './screens/TavariAdmin/TOSACustomerSupport';
import TOSASystemHealth from './screens/TavariAdmin/TOSASystemHealth';
import TOSABusinessInsights from './screens/TavariAdmin/TOSABusinessInsights';
import TOSAModuleManagement from './screens/TavariAdmin/TOSAModuleManagement';

// Employee Portal imports
import PortalLayout from './layouts/PortalLayout';
import PortalDashboard from './screens/Portal/PortalDashboard';
import PortalPayStatements from './screens/Portal/PortalPayStatements';
import PortalPayStatementDetail from './screens/Portal/PortalPayStatementDetail';
import PortalPolicies from './screens/Portal/PortalPolicies';
import PortalProfile from './screens/Portal/PortalProfile';
import PortalContract from './screens/Portal/PortalContract';
import PortalCertificates from './screens/Portal/PortalCertificates';
import PortalPasswordPin from './screens/Portal/PortalPasswordPin';
import PortalLogin from './screens/Portal/PortalLogin';
import PortalPasswordSetup from './screens/Portal/PortalPasswordSetup';
import PortalPasswordReset from './screens/Portal/PortalPasswordReset';
import PortalSetupWizard from './screens/Portal/PortalSetupWizard';
import PortalSchedule from './screens/Portal/PortalScheduleSelfService';
import PortalAccount from './screens/Portal/PortalAccount';
import PortalExpenseReceipts from './screens/Portal/PortalExpenseReceipts';
import PortalTraining from './screens/Portal/PortalTraining';
import PortalClock from './screens/Portal/PortalClock';
import PortalAvailability from './screens/Portal/PortalAvailability';
import PortalTimeOff from './screens/Portal/PortalTimeOff';
import PortalShiftCoverage from './screens/Portal/PortalShiftCoverage';
import PortalNotifications from './screens/Portal/PortalNotifications';
import PortalAcknowledgements from './screens/Portal/PortalAcknowledgements';
import PortalIncidents from './screens/Portal/PortalIncidents';
import PortalStaffUpdates from './screens/Portal/PortalStaffUpdates';

/** Heavy bookings settings screen — load only when that route/tab is opened. */
const BookingSettingsScreen = lazy(() => import('./screens/Bookings/BookingSettingsScreen'));

/** Scheduling time-clock kiosk modals use z-index 10000; default react-hot-toast container is 9999, which hides errors behind overlays. */
const APP_TOASTER_CONTAINER_STYLE = { zIndex: 10050 };

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimer = useRef(null);
  const locationRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const { business } = useBusiness();

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Helper: are we in the dedicated music kiosk?
  // Check if current route is a public route that should skip auth redirects
  const isCustomerPortalRoute = () => location.pathname.startsWith('/customer-portal/');

  /** POS customer-facing display (browser or Electron); must skip auth loading / redirects like kiosks */
  const isCustomerDisplayRoute = () => {
    const path = location.pathname || '';
    return (
      path.startsWith('/customer-display') ||
      path === '/dashboard/pos/customer-display'
    );
  };

  /** Digital signage player (TV/tablet/Fire stick); anon — no employee login */
  const isSignagePlayerRoute = () => {
    const path = location.pathname || '';
    return path.startsWith('/signage/');
  };

  const isPublicRoute = () => {
    const path = location.pathname;
    return (
      isEmployeePortalPath(path) ||
      path.startsWith('/customer-display') || // pairing + fullscreen display (no employee login)
      path.startsWith('/contract/') || // Contract signing and personal info forms
      path.startsWith('/waiver') || // /waiver/*, /waiver-from-booking/*, /waivers/* (public customer flows)
      path.startsWith('/customer-portal/') || // Customer-facing booking portal (no employee auth)
      path === '/' ||
      path === '/login' ||
      path === '/register' ||
      path === '/forgot-password' ||
      path.startsWith('/kiosk/') || // Kiosk routes
      path.startsWith('/signage/') || // Digital signage player (no auth)
      path.startsWith('/tavarimusic') ||
      path.startsWith('/tavari-voice') ||
      path.startsWith('/modules') ||
      path.startsWith('/terms-of-service') ||
      path.startsWith('/privacy-policy') ||
      path.startsWith('/auth/tiktok/callback') ||
      path.startsWith('/unsubscribe') ||
      path.startsWith('/reputation/') ||
      path.startsWith('/coparent-app/') ||
      path.startsWith('/petcare-app/') ||
      path.startsWith('/pay/invoice/') ||
      path.startsWith('/forms/fill/') ||
      path === '/vending/download' ||
      path.startsWith('/v/')
    );
  };

  const renderEmployeeAppRoutes = () => (
    <>
      <Toaster position="top-right" containerStyle={APP_TOASTER_CONTAINER_STYLE} />
      <Routes>
        <Route path="/" element={<PortalLayout />}>
          <Route index element={<PortalDashboard />} />
          <Route path="schedule" element={<PortalSchedule />} />
          <Route path="clock" element={<PortalClock />} />
          <Route path="availability" element={<PortalAvailability />} />
          <Route path="time-off" element={<PortalTimeOff />} />
          <Route path="shift-coverage" element={<PortalShiftCoverage />} />
          <Route path="notifications" element={<PortalNotifications />} />
          <Route path="account" element={<PortalAccount />} />
          <Route path="expense-receipts" element={<PortalExpenseReceipts />} />
          <Route path="pay-statements" element={<PortalPayStatements />} />
          <Route path="pay-statements/:id" element={<PortalPayStatementDetail />} />
          <Route path="contract" element={<PortalContract />} />
          <Route path="certificates" element={<PortalCertificates />} />
          <Route path="training" element={<PortalTraining />} />
          <Route path="policies" element={<PortalPolicies />} />
          <Route path="acknowledgements" element={<PortalAcknowledgements />} />
          <Route path="incidents" element={<PortalIncidents />} />
          <Route path="staff-updates" element={<PortalStaffUpdates />} />
          <Route path="profile" element={<PortalProfile />} />
          <Route path="password-pin" element={<PortalPasswordPin />} />
        </Route>
        <Route path="/login" element={<PortalLogin />} />
        <Route path="/setup" element={<PortalPasswordSetup />} />
        <Route path="/profile-setup" element={<PortalSetupWizard />} />
        <Route path="/reset-password" element={<PortalPasswordReset />} />

        <Route path="/portal" element={<PortalLayout />}>
          <Route index element={<PortalDashboard />} />
          <Route path="schedule" element={<PortalSchedule />} />
          <Route path="clock" element={<PortalClock />} />
          <Route path="availability" element={<PortalAvailability />} />
          <Route path="time-off" element={<PortalTimeOff />} />
          <Route path="shift-coverage" element={<PortalShiftCoverage />} />
          <Route path="notifications" element={<PortalNotifications />} />
          <Route path="account" element={<PortalAccount />} />
          <Route path="expense-receipts" element={<PortalExpenseReceipts />} />
          <Route path="pay-statements" element={<PortalPayStatements />} />
          <Route path="pay-statements/:id" element={<PortalPayStatementDetail />} />
          <Route path="contract" element={<PortalContract />} />
          <Route path="certificates" element={<PortalCertificates />} />
          <Route path="training" element={<PortalTraining />} />
          <Route path="policies" element={<PortalPolicies />} />
          <Route path="acknowledgements" element={<PortalAcknowledgements />} />
          <Route path="incidents" element={<PortalIncidents />} />
          <Route path="staff-updates" element={<PortalStaffUpdates />} />
          <Route path="profile" element={<PortalProfile />} />
          <Route path="password-pin" element={<PortalPasswordPin />} />
        </Route>
        <Route path="/portal/login" element={<PortalLogin />} />
        <Route path="/portal/setup" element={<PortalPasswordSetup />} />
        <Route path="/portal/profile-setup" element={<PortalSetupWizard />} />
        <Route path="/portal/reset-password" element={<PortalPasswordReset />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );

  const renderPunchClockRoutes = () => (
    <>
      <Toaster position="top-right" containerStyle={APP_TOASTER_CONTAINER_STYLE} />
      <Routes>
        <Route path="/" element={<TimeClockKioskScreen />} />
        <Route path="/:businessId" element={<TimeClockKioskScreen />} />
        <Route path="/time-clock-kiosk" element={<TimeClockKioskScreen />} />
        <Route path="/time-clock-kiosk/:businessId" element={<TimeClockKioskScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );

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

  const isWaiverKioskRoute = () => {
    try {
      // Works for both HashRouter and BrowserRouter
      const hash = window.location?.hash || '';
      const pathname = location?.pathname || '';
      return (
        hash.includes('/kiosk/waiver') ||
        pathname === '/kiosk/waiver'
      );
    } catch {
      return false;
    }
  };

  const isVendingKioskRoute = () => {
    try {
      const hash = window.location?.hash || '';
      const pathname = location?.pathname || '';
      return (
        hash.includes('/kiosk/vending') ||
        pathname === '/kiosk/vending' ||
        pathname.startsWith('/v/') ||
        hash.includes('/v/')
      );
    } catch {
      return false;
    }
  };

  const isPunchClockRoute = () => {
    try {
      const hash = window.location?.hash || '';
      const pathname = location?.pathname || '';
      return (
        isPunchClockAppHost() ||
        hash.includes('/dashboard/time-clock-kiosk') ||
        hash.includes('/time-clock-kiosk') ||
        pathname.startsWith('/dashboard/time-clock-kiosk') ||
        pathname.startsWith('/time-clock-kiosk')
      );
    } catch {
      return false;
    }
  };

  /** In-dashboard signing kiosk only (new tab from Kiosk download). Not kiosk/download or other waivers pages. */
  const isDashboardWaiverSigningKioskRoute = () => {
    try {
      const pathname = location?.pathname || '';
      const hash = window.location?.hash || '';
      if (pathname === '/dashboard/waivers/kiosk') return true;
      const h = hash.replace(/^#/, '').split('?')[0];
      return h === '/dashboard/waivers/kiosk';
    } catch {
      return false;
    }
  };

  /** Public waiver URL when opened from browser kiosk (same tab after WaiverKioskScreen redirect). */
  const isPublicWaiverBrowserKioskRoute = () => {
    try {
      const pathname = location?.pathname || '';
      if (!pathname.startsWith('/waiver/')) return false;
      const params = new URLSearchParams(location.search || '');
      return params.get('signingStation') === 'browser_kiosk';
    } catch {
      return false;
    }
  };

  // Helper: NEVER navigate away from kiosk in kiosk mode
  const safeNavigate = (to, options) => {
    if (isMusicKioskRoute() || isWaiverKioskRoute() || isVendingKioskRoute() || isPunchClockRoute() || isCustomerDisplayRoute() || isSignagePlayerRoute()) {
      console.log('[Kiosk] Suppressed navigate to', to);
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

  /** App session lock (useSessionLock): hide cart on paired customer display while locked */
  useEffect(() => {
    const pushMirror = () => {
      const bid = getCustomerDisplayBusinessId();
      if (bid) flushCustomerDisplayMirrorPush(bid);
    };
    const onSessionLocked = () => {
      setCustomerDisplayPosLocked(true);
      pushMirror();
    };
    const onSessionUnlocked = () => {
      setCustomerDisplayPosLocked(false);
      pushMirror();
    };
    window.addEventListener('tavari:session-locked', onSessionLocked);
    window.addEventListener('tavari:session-unlocked', onSessionUnlocked);
    return () => {
      window.removeEventListener('tavari:session-locked', onSessionLocked);
      window.removeEventListener('tavari:session-unlocked', onSessionUnlocked);
    };
  }, []);

  const posRoutePrefix = '/dashboard/pos';
  const wasOnPosRouteRef = useRef(false);

  /** Leaving POS: clear mirror snapshot so the customer screen does not keep stale sale/payment UI */
  useEffect(() => {
    const path = location.pathname || '';
    const onPos = path === posRoutePrefix || path.startsWith(`${posRoutePrefix}/`);
    if (wasOnPosRouteRef.current && !onPos) {
      const bid = getCustomerDisplayBusinessId();
      if (bid) resetCustomerDisplayMirrorToAds(bid);
    }
    wasOnPosRouteRef.current = onPos;
  }, [location.pathname]);

  /** While on POS: heartbeat keeps mirror updated_at fresh so the display does not fall back to ads mid-checkout */
  useEffect(() => {
    const path = location.pathname || '';
    const onPos = path === posRoutePrefix || path.startsWith(`${posRoutePrefix}/`);
    if (!onPos) return undefined;
    const beat = () => {
      const bid = getCustomerDisplayBusinessId();
      if (bid) flushCustomerDisplayMirrorPush(bid);
    };
    beat();
    const id = setInterval(beat, 30000);
    return () => clearInterval(id);
  }, [location.pathname]);

  /** Manual “ping” from setup screen or devtools: window.dispatchEvent(new CustomEvent('tavari:customer-display-force-sync')) */
  useEffect(() => {
    const onForceSync = () => {
      const bid = getCustomerDisplayBusinessId();
      if (bid) flushCustomerDisplayMirrorPush(bid);
    };
    window.addEventListener('tavari:customer-display-force-sync', onForceSync);
    return () => window.removeEventListener('tavari:customer-display-force-sync', onForceSync);
  }, []);

  // 🔧 CRITICAL: Clear business cache when auth state changes or user switches
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (isMusicKioskRoute() || isEmployeePortalPath(location.pathname)) {
        return;
      }

      if (event === 'SIGNED_IN' && session?.user) {
        // Clear any cached business IDs from previous user
        const cachedUserId = localStorage.getItem('lastAuthUserId');
        if (cachedUserId && cachedUserId !== session.user.id) {
          console.log('🔄 Different user signed in, clearing all auth data');
          clearAllAuthData('user_switched_on_signin');
        }
        localStorage.setItem('lastAuthUserId', session.user.id);
      } else if (event === 'SIGNED_OUT') {
        // Transient SIGNED_OUT during a shift must NOT wipe the day session — handled below.
        if (!sessionPersistence.isPersistenceEnabled()) {
          console.log('🔄 User signed out, clearing auth data');
          clearAllAuthData('signed_out');
        }
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

    // 🔒 Do NOT lock on customer signing surfaces only (dedicated /kiosk/waiver, in-dashboard signing kiosk tab, or /waiver/...?signingStation=browser_kiosk)
    if (
      isMusicKioskRoute() ||
      isWaiverKioskRoute() ||
      isPunchClockRoute() ||
      isCustomerPortalRoute() ||
      isCustomerDisplayRoute() ||
      isSignagePlayerRoute() ||
      isEmployeePortalPath(location.pathname) ||
      isDashboardWaiverSigningKioskRoute() ||
      isPublicWaiverBrowserKioskRoute()
    ) {
      return;
    }

    // Unified 5-minute idle lock across the app (including POS register and dining order)
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

        const loc = locationRef.current;
        const currentPath = `${loc?.pathname || ''}${loc?.search || ''}${loc?.hash || ''}`;
        if (loc?.pathname !== '/unlock') {
          sessionStorage.setItem('unlockReturnPath', currentPath);
        }

        localStorage.removeItem('pinFailedAttempts');
        localStorage.removeItem('pinUnlockCooldownUntil');

        setCustomerDisplayPosLocked(true);
        window.dispatchEvent(new Event('tavari:session-locked'));
        const bid = getCustomerDisplayBusinessId();
        if (bid) flushCustomerDisplayMirrorPush(bid);

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
  }, [session, location.pathname]);

  // ✅ BULLETPROOF SESSION RESTORATION WITH AUTH CLEANUP
  useEffect(() => {
    let cancelled = false;

    const initializeSession = async () => {
      try {
        // Employee portal uses its own auth shell — skip staff shift session / PIN lock plumbing
        if (isEmployeePortalPath(location.pathname)) {
          const { data: { session: portalSession } } = await supabase.auth.getSession();
          setSession(portalSession);
          setLoading(false);
          return;
        }
        // Customer portal is outside employee auth – skip session init entirely
        if (isCustomerPortalRoute()) {
          setLoading(false);
          return;
        }
        // Customer display (pairing + mirror UI) — anon Supabase only; never block on employee session
        if (isCustomerDisplayRoute()) {
          setLoading(false);
          return;
        }
        if (isSignagePlayerRoute()) {
          setLoading(false);
          return;
        }
        if (isVendingKioskRoute()) {
          setLoading(false);
          return;
        }
        // Music kiosk: business ID only (no staff login), same model as waiver kiosk.
        if (isMusicKioskRoute()) {
          if (window.electronAPI) {
            try {
              const savedSession = await window.electronAPI.loadSession();
              const existingPinnedBusinessId =
                localStorage.getItem('tavariPinnedBusinessId') ||
                localStorage.getItem('selectedBusinessId') ||
                localStorage.getItem('currentBusinessId');
              const savedBusinessId =
                savedSession?.pinned_business_id || savedSession?.business_id;
              const businessIdToUse = existingPinnedBusinessId || savedBusinessId;
              if (businessIdToUse) {
                localStorage.setItem('tavariPinnedBusinessId', businessIdToUse);
                localStorage.setItem('selectedBusinessId', businessIdToUse);
                localStorage.setItem('currentBusinessId', businessIdToUse);
              }
            } catch {
              /* kiosk can still run from localStorage business id */
            }
          }
          setLoading(false);
          return;
        }
        // For Electron desktop app: Try to restore from saved session file first
        if (window.electronAPI) {
          try {
            const savedSession = await window.electronAPI.loadSession();
            if (savedSession) {
              console.log('🔐 Found saved session in desktop app, restoring...');
              
              const savedBusinessId = savedSession.pinned_business_id || savedSession.business_id;
              if (savedBusinessId) {
                localStorage.setItem('tavariPinnedBusinessId', savedBusinessId);
                localStorage.setItem('selectedBusinessId', savedBusinessId);
                localStorage.setItem('currentBusinessId', savedBusinessId);
                console.log('✅ Business ID set from Electron session:', savedBusinessId);
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
                if (error?.message?.includes('Auth session missing') || error?.message?.includes('session_not_found')) {
                  console.log('ℹ️ No saved session found (will show login if needed)');
                } else {
                  console.warn('⚠️ Failed to restore desktop session:', error?.message || error);
                }
                if (isWaiverKioskRoute()) {
                  setLoading(false);
                  return;
                }
              }
            } else {
              console.log('⚠️ No saved session found in Electron app');
              if (isWaiverKioskRoute()) {
                setLoading(false);
                return;
              }
            }
          } catch (err) {
            console.warn('⚠️ Error loading desktop session:', err);
            if (isWaiverKioskRoute()) {
              setLoading(false);
              return;
            }
          }
        }
      
      // Try to restore persistent session if enabled
      const restoreResult = await sessionPersistence.restoreSession();
      
      if (restoreResult.restored) {
        setSession(restoreResult.session);
        // For kiosk route, ensure session is set but skip redirects
        if (isMusicKioskRoute() || isWaiverKioskRoute() || isVendingKioskRoute()) {
          console.log('[Kiosk] route - session restored from persistence');
          setLoading(false);
          return;
        }
        setLoading(false);
        return;
      }
      
      // Check for active Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      
      // For kiosk route, ensure session is set but skip redirects
      if (isMusicKioskRoute() || isWaiverKioskRoute()) {
        console.log('[Kiosk] route - ensuring session is set for business ID fetch');
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
      if (session && sessionPersistence.isPersistenceEnabled()) {
        sessionPersistence.startAutoRefresh();
      }
      setLoading(false);
      } catch (error) {
        console.error('Session initialization failed:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initializeSession();

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      // 🔒 CRITICAL: Skip all auth redirects for public routes (kiosk, contract signing, personal info form, etc.)
      if (isMusicKioskRoute() || isWaiverKioskRoute() || isVendingKioskRoute() || isPublicRoute()) {
        setSession(session);
        // Keep tavari-session.json fresh so nightly Electron restarts still auto-login
        if (
          window.electronAPI?.saveSession &&
          session &&
          event === 'TOKEN_REFRESHED'
        ) {
          try {
            const businessId =
              localStorage.getItem('tavariPinnedBusinessId') ||
              localStorage.getItem('selectedBusinessId') ||
              localStorage.getItem('currentBusinessId');
            if (businessId) {
              await window.electronAPI.saveSession({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_at: session.expires_at,
                user: session.user,
                business_id: businessId,
                pinned_business_id: businessId
              });
              console.log('💾 Electron kiosk session file updated after token refresh');
            }
          } catch (err) {
            console.warn('⚠️ Failed to persist refreshed session to Electron:', err);
          }
        }
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
          if (stayLoggedIn) {
            console.log('🔒 Transient sign-out with stayLoggedIn — PIN unlock, preserving day session');
            sessionPersistence.restoreSession().then((restoreResult) => {
              if (restoreResult.restored && restoreResult.session) {
                setSession(restoreResult.session);
              }
            });
            if (!locationRef.current?.pathname?.startsWith('/unlock')) {
              safeNavigate('/unlock');
            }
          } else {
            console.log('👋 User logged out - cleaning up');
            clearAllAuthData('auth_state_signed_out');
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
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [navigate]);

  // Refresh tokens when the tab wakes up (background tabs delay timers during busy shifts)
  useEffect(() => {
    if (!session || !sessionPersistence.isPersistenceEnabled()) return undefined;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sessionPersistence.ensureFreshToken();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [session]);

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

  // On-site iPad/browser kiosks: after ?signingStation=browser_kiosk, keep the tab under /waiver/:businessId only.
  useEffect(() => {
    const path = location.pathname;
    if (path === '/kiosk/waiver' || isDashboardWaiverSigningKioskRoute()) {
      clearWaiverBrowserKioskLock();
      return;
    }
    refreshWaiverBrowserKioskLock(path, location.search || '');
    const target = getWaiverBrowserKioskRedirectPath(path);
    if (target) {
      navigate(target, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  if (isEmployeeAppHost()) {
    return renderEmployeeAppRoutes();
  }

  if (isPunchClockAppHost()) {
    return renderPunchClockRoutes();
  }

  // For kiosk, customer portal, and customer display, never show loading screen – outside employee auth
  if (
    loading &&
    !isMusicKioskRoute() &&
    !isWaiverKioskRoute() &&
    !isVendingKioskRoute() &&
    !isPunchClockRoute() &&
    !isCustomerPortalRoute() &&
    !isCustomerDisplayRoute() &&
    !isSignagePlayerRoute()
  ) {
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
    <SessionManager>
      <>
        <Toaster
          position={isVendingKioskRoute() ? 'bottom-center' : 'top-right'}
          containerStyle={APP_TOASTER_CONTAINER_STYLE}
          toastOptions={isVendingKioskRoute() ? { duration: 3500 } : undefined}
        />
        <Routes>
          {/* PUBLIC ROUTES (No authentication required) */}
          <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/unsubscribe" element={<UnsubscribePage />} />
        {/* Reputation — public collection + default legal pages */}
        <Route path="/reputation/i/:token" element={<ReputationCollectPage />} />
        {/* Same page: stable public link for emails / QR (any visitor, any time; one URL for all recipients) */}
        <Route path="/reputation/review/:businessId" element={<ReputationCollectPage />} />
        <Route path="/reputation/b/:businessId" element={<ReputationCollectPage />} />
        <Route path="/reputation/qr/:businessId" element={<ReputationCollectPage />} />
        <Route path="/reputation/legal/privacy" element={<ReputationLegalPrivacy />} />
        <Route path="/reputation/legal/terms" element={<ReputationLegalTerms />} />
        {/* Pull Together: Co-Parent — public legal & marketing pages */}
        <Route path="/coparent-app/privacy" element={<CoparentPrivacyPolicy />} />
        <Route path="/coparent-app/terms" element={<CoparentTermsOfService />} />
        <Route path="/petcare-app/privacy" element={<PetCarePrivacyPolicy />} />
        <Route path="/petcare-app/terms" element={<PetCareTermsOfService />} />
        <Route path="/reminder/action" element={<ReminderActionPage />} />
        <Route path="/funding/guest/:token" element={<FundingGuestAccessPage />} />
        <Route path="/shift-premium/approval" element={<ShiftPremiumApprovalActionPage />} />
        <Route path="/tavarimusic" element={<TavariMusicSplash />} />
        <Route path="/tavari-voice" element={<TavariVoiceSplash />} />
        {/* Social Media Legal Pages - Required for TikTok API */}
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        {/* TikTok OAuth Callback - Public route for OAuth redirect */}
        <Route path="/auth/tiktok/callback" element={<TikTokAuthCallback />} />
        {/* Music Kiosk - Public route for Electron (dedicated music player, no auth required) */}
        {/* MUST be outside /dashboard to avoid protected route collision */}
        <Route path="/kiosk/music" element={<MusicKioskScreen />} />
        {/* Vending Machine Kiosk - Public route for vending machine WebView (no auth required) */}
        <Route path="/kiosk/vending" element={<VendingMachineScreen />} />
        <Route path="/v/:shortCode" element={<VendingMachineScreen />} />
        <Route path="/vending/download" element={<VendingKioskDownloadScreen />} />
        <Route path="/kiosk/self-serve-pay/:businessId" element={<SelfServePayKioskScreen />} />
        <Route path="/modules" element={<TavariModules />} />
        
        {/* PUBLIC WAIVER ROUTES */}
        <Route path="/waivers/sign/:signatureToken" element={<WaiverSignScreen />} />
        <Route path="/waiver/:businessId/:templateKey" element={<PublicWaiverFlow />} />
        <Route path="/waiver/:businessId" element={<PublicWaiverFlow />} />
        {/* Booking portal waiver flow: same steps/DB, entered with state (no phone/OTP) */}
        <Route path="/waiver-from-booking/:businessId/:templateKey?" element={<BookingWaiverFlow />} />
        <Route path="/kiosk/waiver" element={<WaiverKioskScreen />} />
        <Route path="/forms/fill/:formId" element={<FormsFillScreen />} />
        {/* Time clock — public tablet PIN (same app as www; use /time-clock-kiosk/<businessId> until punch-clock.* DNS exists) */}
        <Route path="/time-clock-kiosk/:businessId" element={<TimeClockKioskScreen />} />
        <Route path="/time-clock-kiosk" element={<TimeClockKioskScreen />} />

        {/* CUSTOMER BOOKING PORTAL (public) */}
        <Route path="/customer-portal/:businessId/portal" element={<CustomerPortalPage />} />
        <Route path="/pay/invoice/etransfer-confirm/:confirmToken" element={<PublicInvoiceEtransferConfirmPage />} />
        <Route path="/pay/invoice/:payToken" element={<PublicInvoicePayPage />} />
        <Route path="/customer-portal/:businessId/portal/booking-confirmed/:bookingId" element={<BookingConfirmedPage />} />
        <Route path="/customer-portal/:businessId/portal/manage-booking" element={<CustomerManageBookingLookupPage />} />
        <Route path="/customer-portal/:businessId/portal/manage-booking/:token" element={<CustomerManageBookingPage />} />
        <Route path="/customer-portal/:businessId/portal/booking-terms/:token" element={<BookingTermsAcknowledgmentPage />} />
        <Route path="/customer-portal/:businessId/portal/:activitySlug" element={<CustomerPortalActivityPage />} />
        <Route path="/customer-portal/:businessId/party-guest-list" element={<CustomerPortalPartyGuestListPage />} />
        <Route path="/customer-portal/:businessId/camp-registration/complete" element={<CamperRegistrationCompletePage />} />
        <Route path="/customer-portal/:businessId/camp-registration" element={<CustomerPortalCampRegistrationPage />} />
        <Route path="/customer-portal/:businessId/camper-registration/:participantId" element={<CamperRegistrationFormScreen />} />
        <Route path="/customer-portal/:businessId/account" element={<CustomerPortalLayout />}>
          <Route index element={<CustomerPortalDashboard />} />
          <Route path="bookings" element={<CustomerPortalBookingsPage />} />
          <Route path="waivers" element={<CustomerPortalWaiversPage />} />
          <Route path="account" element={<CustomerPortalAccountPage />} />
          <Route path="parties" element={<CustomerPortalPartiesPage />} />
          <Route path="notifications" element={<CustomerPortalNotificationsPage />} />
        </Route>
        
        {/* PUBLIC CONTRACT SIGNING ROUTES */}
        <Route path="/contract/sign/:token" element={<ContractSignScreen />} />
        <Route path="/contract/sign/authorized/:token" element={<AuthorizedRepSignScreen />} />
        <Route path="/contract/view/:token" element={<ContractViewScreen />} />
        <Route path="/contract/personal-info/:token" element={<PersonalInfoFormScreen />} />
        
        {/* PUBLIC CUSTOMER DISPLAY ROUTE (for dual-screen setup) */}
        <Route path="/customer-display" element={<CustomerDisplayFullscreen />} />
        <Route path="/customer-display-pair" element={<CustomerDisplayPairScreen />} />

        {/* PUBLIC DIGITAL SIGNAGE PLAYER (TVs, tablets, Fire sticks) */}
        <Route path="/signage/player" element={<SignagePlayerScreen />} />
        
        {/* TOSA EMPLOYEE PORTAL ROUTES (Hidden from main site) */}
        <Route path="/employeeportal" element={<TOSAEmployeePortal />} />
        
        {/* EMPLOYEE PORTAL ROUTES */}
        <Route path="/portal" element={<PortalLayout />}>
          <Route index element={<PortalDashboard />} />
          <Route path="schedule" element={<PortalSchedule />} />
          <Route path="clock" element={<PortalClock />} />
          <Route path="availability" element={<PortalAvailability />} />
          <Route path="time-off" element={<PortalTimeOff />} />
          <Route path="shift-coverage" element={<PortalShiftCoverage />} />
          <Route path="notifications" element={<PortalNotifications />} />
          <Route path="account" element={<PortalAccount />} />
          <Route path="expense-receipts" element={<PortalExpenseReceipts />} />
          <Route path="pay-statements" element={<PortalPayStatements />} />
          <Route path="pay-statements/:id" element={<PortalPayStatementDetail />} />
          <Route path="contract" element={<PortalContract />} />
          <Route path="certificates" element={<PortalCertificates />} />
          <Route path="training" element={<PortalTraining />} />
          <Route path="policies" element={<PortalPolicies />} />
          <Route path="acknowledgements" element={<PortalAcknowledgements />} />
          <Route path="incidents" element={<PortalIncidents />} />
          <Route path="staff-updates" element={<PortalStaffUpdates />} />
          <Route path="profile" element={<PortalProfile />} />
          <Route path="password-pin" element={<PortalPasswordPin />} />
        </Route>
        <Route path="/portal/login" element={<PortalLogin />} />
        <Route path="/portal/setup" element={<PortalPasswordSetup />} />
        <Route path="/portal/profile-setup" element={<PortalSetupWizard />} />
        <Route path="/portal/reset-password" element={<PortalPasswordReset />} />
        
        {/* TOSA PROTECTED ROUTES - Separate from business dashboard */}
        <Route path="/tosa/*" element={<TOSAEmployeeRoutes />} />
        
        {/* PROTECTED DASHBOARD ROUTES */}
        <Route
          path="/dashboard"
          element={
            <DashboardRouteGuard session={session} authLoading={loading} />
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
          <Route path="pos/bundles" element={<POSBundles />} />
          <Route path="pos/categories" element={<POSCategories />} />
          <Route path="pos/modifiers" element={<POSModifiers />} />
          <Route path="pos/discounts" element={<POSDiscounts />} />
          <Route path="pos/customers" element={<POSCustomersScreen />} />
          <Route path="pos/receipts" element={<POSReceipts />} />
          <Route path="pos/bookings-receipts" element={<BookingsReceipts />} />
          <Route path="pos/settings" element={<POSSettings />} />
          <Route path="pos/stations" element={<POSStationsScreen />} />
          <Route path="pos/kitchen-display" element={<POSKitchenDisplay />} />
          <Route path="pos/daily-deposit" element={<POSDailyDepositScreen />} />
          <Route path="pos/sale-review" element={<SaleReviewScreen />} />
          <Route path="pos/payment" element={<PaymentScreen />} />
          <Route path="pos/helcim-debug" element={<HelcimRealtimeDebugScreen />} />
          <Route path="pos/receipt" element={<ReceiptScreen />} />
          <Route path="pos/loyalty" element={<POSLoyaltyScreen />} />
          <Route path="pos/refunds" element={<RefundsScreen />} />
          <Route path="pos/tabs" element={<TabScreen />} />
          <Route path="pos/loyalty-settings" element={<LoyaltySettings />} />
          <Route path="pos/saved-carts" element={<SavedCartsScreen />} />
          <Route path="pos/reports" element={<POSReportsScreen />} />
          <Route path="pos/daily-sales" element={<DailySalesLedger />} />
          <Route path="pos/customer-display-setup" element={<CustomerDisplaySetupScreen />} />
          <Route path="pos/customer-display" element={<CustomerDisplayFullscreen />} />
          <Route path="pos/display-ads" element={<CompCustomerDisplayAds />} />

          {/* Liquor Management System Routes */}
          <Route path="liquor/inventory" element={<LiquorInventorySystem />} />
          <Route path="liquor/products" element={<LiquorInventorySystem />} />
          <Route path="liquor/variances" element={<LiquorInventorySystem />} />
          <Route path="liquor/reports" element={<LiquorInventorySystem />} />

          {/* Tavari Vending — standalone module (configure devices & mappings; not under POS) */}
          <Route path="vending" element={<VendingDashboard />} />

          {/* ChargeNow / shared power bank (proxied API) */}
          <Route path="power-bank" element={<PowerBankDashboard />} />

          {/* Private Dividend Income (Christian Fournier business only) */}
          <Route path="dividend-income" element={<DividendIncomeDashboard />} />

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
          <Route path="mail" element={<Navigate to="/dashboard/mail/dashboard" replace />} />
          <Route path="mail/dashboard" element={<MailDashboard />} />
          <Route path="mail/campaigns" element={<CampaignList />} />
          <Route path="mail/automations" element={<MailAutomations />} />
          <Route path="mail/campaigns/:campaignId/preview" element={<CampaignDetails />} />
          <Route path="mail/campaigns/:campaignId/results" element={<CampaignDetails />} />
          <Route path="mail/preview/:campaignId" element={<CampaignDetails />} />
          <Route path="mail/results/:campaignId" element={<CampaignDetails />} />
          <Route path="mail/contacts" element={<ContactsList />} />
          <Route path="mail/contacts/segments" element={<ContactsList />} />
          <Route path="mail/segments" element={<Navigate to="/dashboard/mail/contacts/segments" replace />} />
          <Route path="mail/contacts/edit/:id" element={<ContactDetails />} />
          <Route path="mail/builder" element={<CampaignBuilder />} />
          <Route path="mail/builder/:campaignId" element={<CampaignBuilder />} />
          <Route path="mail/templates" element={<CampaignList />} />
          <Route path="mail/analytics" element={<Navigate to="/dashboard/reports?tab=mail" replace />} />
          <Route path="mail/contacts/analytics" element={<Navigate to="/dashboard/reports?tab=mail" replace />} />
          <Route path="mail/compliance" element={<MailComplianceDashboard />} />
          <Route path="mail/billing" element={<BillingManager />} />
          <Route path="mail/settings" element={<MailSettings />} />
          <Route path="mail/sender/:campaignId" element={<CampaignSender />} />
          <Route path="mail/campaigns/:campaignId" element={<CampaignDetails />} />
          <Route path="mail/logs" element={<SendLogsScreen />} />
          <Route path="mail/performance" element={<PerformanceMonitoringScreen />} />
          
          {/* Tavari Inbox Routes */}
          <Route path="inbox" element={<TavariInboxDashboard />} />

          {/* Tavari Accounting Routes – single hub with tabs (HR-style) */}
          <Route path="accounting/reports/hst" element={<AccountingDashboard />} />
          <Route path="accounting/reports/cra" element={<AccountingDashboard />} />
          <Route path="accounting/reports/balance-sheet" element={<AccountingDashboard />} />
          <Route path="accounting/reports/gst34" element={<AccountingDashboard />} />
          <Route path="accounting/reports/general-ledger" element={<AccountingDashboard />} />
          <Route path="accounting/reports/trial-balance" element={<AccountingDashboard />} />
          <Route path="accounting/reports/ap-aging" element={<AccountingDashboard />} />
          <Route path="accounting/reports/ar-aging" element={<AccountingDashboard />} />
          <Route path="accounting/reports/ap-workspace" element={<AccountingDashboard />} />
          <Route path="accounting/reports/ar-workspace" element={<AccountingDashboard />} />
          <Route path="accounting/reports/filing-reconciliation" element={<AccountingDashboard />} />
          <Route path="accounting/reports/year-end-package" element={<AccountingDashboard />} />
          <Route path="accounting/activity" element={<AccountingDashboard />} />
          <Route path="accounting/queue" element={<AccountingDashboard />} />
          <Route path="accounting/expenses" element={<AccountingDashboard />} />
          <Route path="accounting/settings" element={<AccountingDashboard />} />
          <Route path="accounting/reports" element={<AccountingDashboard />} />
          <Route path="accounting/setup/vendors" element={<AccountingDashboard />} />
          <Route path="accounting/setup/categories" element={<AccountingDashboard />} />
          <Route path="accounting/setup/opening-balances" element={<AccountingDashboard />} />
          <Route path="accounting/setup" element={<Navigate to="/dashboard/accounting/setup/vendors" replace />} />
          <Route path="accounting/vendors" element={<Navigate to="/dashboard/accounting/setup/vendors" replace />} />
          <Route path="accounting/categories" element={<Navigate to="/dashboard/accounting/setup/categories" replace />} />
          <Route path="accounting/filing-reconciliation" element={<Navigate to="/dashboard/accounting/reports/filing-reconciliation" replace />} />
          <Route path="accounting/chart-of-accounts" element={<AccountingDashboard />} />
          <Route path="accounting/assets" element={<AccountingDashboard />} />
          <Route path="accounting/bank-transactions/upload" element={<AccountingDashboard />} />
          <Route path="accounting/bank-transactions/pending" element={<AccountingDashboard />} />
          <Route path="accounting/bank-transactions/posted" element={<AccountingDashboard />} />
          <Route path="accounting/bank-transactions/excluded" element={<AccountingDashboard />} />
          <Route path="accounting/bank-transactions/deposits" element={<AccountingDashboard />} />
          <Route path="accounting/bank-transactions" element={<AccountingDashboard />} />
          <Route path="accounting/bank-import" element={<AccountingDashboard />} />
          <Route path="accounting/bank-reconciliation" element={<AccountingDashboard />} />
          <Route path="accounting/journal" element={<AccountingDashboard />} />
          <Route path="accounting/year-end" element={<AccountingDashboard />} />
          <Route path="accounting" element={<AccountingDashboard />} />
          <Route path="file-storage/files" element={<FileStorageDashboard />} />
          <Route path="file-storage/pending" element={<FileStorageDashboard />} />
          <Route path="file-storage/paper-forms" element={<FileStorageDashboard />} />
          <Route path="file-storage/categories" element={<FileStorageDashboard />} />
          <Route path="file-storage/upload" element={<FileStorageDashboard />} />
          <Route path="file-storage/settings" element={<FileStorageDashboard />} />
          <Route path="file-storage" element={<FileStorageDashboard />} />

          {/* Tavari Task Manager */}
          <Route path="tasks" element={<TasksDashboard />} />

          {/* Tavari Forms (operational checklists — separate from waivers) */}
          <Route path="forms" element={<FormsDashboard />} />

          {/* HR System Routes */}
          <Route path="hr/dashboard" element={<HRDashboard />} />
          <Route path="hr/employee-management" element={<HREmployeeManagementHub />} />
          <Route path="hr/training" element={<HRTrainingHub />} />
          <Route path="hr/communications" element={<HRCommunicationsHub />} />
          <Route path="hr/payroll" element={<HRPayrollDashboard />} />
          <Route path="hr/employees" element={<Navigate to="/dashboard/hr/employee-management?tab=employees" replace />} />
          <Route path="hr/contracts" element={<Navigate to="/dashboard/hr/employee-management?tab=contracts" replace />} />
          <Route path="hr/onboarding" element={<Navigate to="/dashboard/hr/training?tab=onboarding" replace />} />
          <Route path="hr/milestones" element={<Navigate to="/dashboard/hr/training?tab=milestones" replace />} />
          <Route path="hr/orientation" element={<Navigate to="/dashboard/hr/training?tab=orientation" replace />} />
          <Route path="hr/orientation/attendance/:sessionId" element={<AttendanceTrackingScreen />} />
          <Route path="hr/writeups" element={<Navigate to="/dashboard/hr/employee-management?tab=writeups" replace />} />
          <Route path="hr/policies" element={<Navigate to="/dashboard/hr/training?tab=policies" replace />} />
          <Route path="hr/settings" element={<HRSettingsRouteRedirect />} />
          <Route path="hr/document-expiry" element={<Navigate to="/dashboard/hr/employee-management?tab=certificates" replace />} />

          {/* Social Media System Routes */}
          <Route path="social-media" element={<SocialMediaDashboard />} />
          <Route path="social-media/tiktok/create-post" element={<TikTokCreatePost />} />
          <Route path="social-media/tiktok/auth/callback" element={<TikTokAuthCallback />} />

          {/* Voice Agent Routes */}
          <Route path="voice-agent" element={<VoiceAgentDashboard />} />
          
          {/* Custom Voice Agent Routes */}
          <Route path="custom-voice-agent" element={<CustomVoiceAgentDashboard />} />

          {/* Scheduling System Routes */}
          <Route path="scheduling" element={<SchedulingScreen />} />
          <Route path="scheduling/absence/:shiftId" element={<AbsenceReasonScreen />} />
          <Route path="time-clock-kiosk/:businessId" element={<TimeClockKioskScreen />} />
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
          <Route path="appbuilder/settings" element={<AppBuilderSettingsScreen />} />

          {/* Bookings Routes */}
          <Route path="bookings" element={<BookingsModuleLayout />}>
            <Route index element={<BookingsDashboard />} />
            <Route path="parties" element={<PartiesDashboard />} />
            <Route path="party-guest-lists/:guestListId" element={<PartyGuestListDetailScreen />} />
            <Route path="party-guest-lists" element={<Navigate to="/dashboard/bookings/parties" replace />} />
            <Route path="party-check-in" element={<Navigate to="/dashboard/bookings/parties?tab=check-in" replace />} />
            <Route path="party-guest-list-settings" element={<PartyGuestListSettingsScreen />} />
            <Route path="create" element={<BookingCreateScreen />} />
            <Route path="calendar" element={<BookingCalendarScreen />} />
            <Route path="list" element={<BookingListScreen />} />
            <Route path="check-in" element={<BookingCheckInScreen />} />
            <Route
              path="settings"
              element={(
                <Suspense fallback={<div style={{ padding: 24, color: '#6b7280' }}>Loading settings…</div>}>
                  <BookingSettingsScreen />
                </Suspense>
              )}
            />
            <Route path=":id" element={<BookingDetailScreen />} />
          </Route>

          {/* Waivers Routes — shared tab bar on all module pages */}
          <Route path="waivers" element={<WaiversModuleLayout />}>
            <Route index element={<WaiversDashboard />} />
            <Route path="search" element={<WaiverSearchScreen />} />
            <Route path="list" element={<WaiverListScreen />} />
            <Route path="templates" element={<WaiverTemplateManagementScreen />} />
            <Route path="upload" element={<WaiverUploadScreen />} />
            <Route path="paper-view" element={<PaperWaiversViewScreen />} />
            <Route path="settings" element={<WaiverSettingsScreen />} />
            <Route path="kiosk/download" element={<WaiverKioskDownloadScreen />} />
            <Route path="reports" element={<WaiverReportsScreen />} />
            <Route path="kiosk" element={<WaiverKioskScreen />} />
            <Route path=":waiverId" element={<WaiverDetailScreen />} />
          </Route>

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

          {/* Reputation management */}
          <Route path="reputation" element={<ReputationModuleLayout />}>
            <Route index element={<ReputationDashboard />} />
            <Route path="settings" element={<ReputationSettings />} />
          </Route>

          <Route path="reminders" element={<RemindersModuleLayout />}>
            <Route index element={<ActiveReminders />} />
            <Route path="manage" element={<RemindersList />} />
            <Route path="new" element={<ReminderFormScreen />} />
            <Route path="active" element={<ActiveReminders />} />
            <Route path="completed" element={<CompletedReminders />} />
            <Route path="history" element={<ReminderHistory />} />
            <Route path="settings" element={<RemindersSettingsScreen />} />
            <Route path=":id" element={<ReminderFormScreen />} />
          </Route>

          <Route path="invoices" element={<InvoicesModuleLayout />}>
            <Route index element={<InvoicesDashboard filter="all" />} />
            <Route path="drafts" element={<InvoicesDashboard filter="draft" />} />
            <Route path="unpaid" element={<InvoicesDashboard filter="unpaid" />} />
            <Route path="paid" element={<InvoicesDashboard filter="paid" />} />
            <Route path="summary" element={<InvoicesDashboard filter="summary" />} />
            <Route path="settings" element={<InvoiceSettingsScreen />} />
            <Route path="history" element={<InvoiceHistoryScreen />} />
            <Route path="recurring" element={<RecurringInvoicesScreen />} />
            <Route path="recurring/new" element={<RecurringInvoiceFormScreen />} />
            <Route path="recurring/:id" element={<RecurringInvoiceFormScreen />} />
            <Route path="new" element={<InvoiceFormScreen />} />
            <Route path=":id/edit" element={<InvoiceFormScreen />} />
            <Route path=":id" element={<InvoiceDetailScreen />} />
          </Route>

          <Route path="funding" element={<FundingModuleLayout />}>
            <Route index element={<FundingDashboard />} />
            <Route path="plans" element={<FundingPlansScreen />} />
            <Route path="plans/new" element={<FundingPlansScreen />} />
            <Route path="plan/:id" element={<FundingPlanDetailScreen />} />
            <Route path="applications" element={<FundingApplicationsScreen />} />
            <Route path="applications/new" element={<FundingApplicationsScreen />} />
            <Route path="application/:id" element={<FundingApplicationDetailScreen />} />
            <Route path="opportunities" element={<FundingOpportunitiesScreen />} />
            <Route path="settings" element={<FundingSettingsScreen />} />
          </Route>

          <Route path="gift-cards" element={<GiftCardsModuleLayout />}>
            <Route index element={<GiftCardsDashboard />} />
            <Route path="cards" element={<GiftCardsListScreen />} />
            <Route path="issue" element={<GiftCardsIssueScreen />} />
            <Route path="products" element={<GiftCardsProductsScreen />} />
            <Route path="promotions" element={<GiftCardsPromotionsScreen />} />
            <Route path="designs" element={<GiftCardsDesignsScreen />} />
            <Route path="reports" element={<GiftCardsReportsScreen />} />
            <Route path="settings" element={<GiftCardsSettingsScreen />} />
          </Route>

          <Route path="deals" element={<DealsModuleLayout />}>
            <Route index element={<DealsDashboard />} />
            <Route path="manage" element={<DealsManageScreen />} />
            <Route path="print" element={<DealsPrintScreen />} />
            <Route path="settings" element={<DealsSettingsScreen />} />
          </Route>

          <Route path="tavari-apis" element={<TavariApisModuleLayout />}>
            <Route index element={<TavariApisOverview />} />
            <Route path="endpoints" element={<TavariApisEndpoints />} />
            <Route path="consumers" element={<TavariApisConsumers />} />
            <Route path="settings" element={<TavariApisSettings />} />
          </Route>
        </Route>

        {/* PROTECTED VOICE-ONLY DASHBOARD ROUTES (No Sidebar) */}
        <Route
          path="/tavari-voice/dashboard"
          element={
            session ? <VoiceOnlyLayout /> : 
            (sessionPersistence.isPersistenceEnabled() ? <Navigate to="/unlock" /> : <Navigate to="/login?source=tavari-voice" />)
          }
        >
          {/* Voice Agent Dashboard - Main interface */}
          <Route index element={<VoiceAgentDashboard />} />
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
      </>
    </SessionManager>
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
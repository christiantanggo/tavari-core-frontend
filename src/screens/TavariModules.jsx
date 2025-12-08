// src/screens/TavariModules.jsx - WITH SECURITY TRACKING
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SecurityWrapper, useSecurityContext } from '../Security';
import { TavariStyles } from '../utils/TavariStyles';

const TavariModules = () => {
  const navigate = useNavigate();

  // Security context for page analytics
  const {
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'TavariModules',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Track page view on mount
  useEffect(() => {
    const trackPageView = async () => {
      await recordAction('modules_page_view', null, false);
      await logSecurityEvent('modules_page_accessed', {
        timestamp: new Date().toISOString(),
        user_agent: navigator.userAgent,
        screen_width: window.innerWidth,
        referrer: document.referrer || 'direct'
      }, 'low');
    };

    trackPageView();
  }, []);

  const handleBackToHome = async () => {
    await recordAction('modules_back_to_home', null, false);
    await logSecurityEvent('modules_navigation', {
      action: 'back_to_home',
      timestamp: new Date().toISOString()
    }, 'low');
    
    navigate('/');
  };

  const moduleCategories = [
    {
      title: "Core Platform",
      items: [
        "Customer Management (CRM): Unified profiles, households, history",
        "Identity & Access: SSO, RBAC, multi-tenant orgs/locations",
        "Config & Catalogs: Items, taxes, fees, pricing rules, bundles",
        "Notifications Hub: System alerts, in-app, email/SMS/push routing",
        "Developer APIs & Webhooks: Public APIs, SDKs, events, audit logs",
        "Data & Analytics: Dashboards, reports, exports, forecasting"
      ]
    },
    {
      title: "Payments & Finance",
      items: [
        "Tavari Pay (PayFac): Card-present/online, settlement, payouts",
        "Terminals & Tap-to-Pay: Readers, kiosks, QR pay, wallet/NFC",
        "Invoicing & Subscriptions: Recurring, ACH, dunning, receipts",
        "Reconciliation & Fees: Deposits, ledgering, chargebacks, disputes",
        "Gift Cards & Stored Value: Issue, redeem, breakage, liability"
      ]
    },
    {
      title: "Point of Sale (POS) Suite",
      items: [
        "Tavari POS: Counter, table, mobile, drive-thru",
        "Kitchen Display (KDS): Make lines, routing, timers",
        "Menu & Modifiers: Combos, dayparts, promos, upsells",
        "Inventory & Recipes: COGS, yields, depletion, alerts",
        "Pricing & Tax Engine (CA-ready): Thresholds, exemptions, auto-rules",
        "QR Order & Pay: Scan, order, seat, pickup/runner"
      ]
    },
    {
      title: "Bookings, Parties & Waivers",
      items: [
        "Bookings/Scheduling: Lanes, courts, rooms, packages",
        "Party Builder & Deposits: Add-ons, upsells, payment links",
        "Digital Waivers: Smart renewal, per-activity rules, kiosk flow",
        "Capacity/Check-In: Roster, headcount, tap-to-enter, wristbands/labels"
      ]
    },
    {
      title: "Loyalty, Offers & Customer Growth",
      items: [
        "Play Points & Wallet: Earn/burn rules, tiers, family sharing",
        "Offers/Coupons: Targeting, geofenced, POS/app redemption",
        "Reviews & Referrals: NPS prompts, incentives, tracking",
        "Marketing Journeys: Triggers across email/SMS/push (see Mail)"
      ]
    },
    {
      title: "Tavari Mail (Comms & Marketing)",
      items: [
        "Campaigns & Automations: Email/SMS sequences, templates",
        "Lists & Consent (CASL/PIPEDA): Segments, tags, double-opt-in",
        "Deliverability & Analytics: Bounces, clicks, revenue attribution"
      ]
    },
    {
      title: "Arcade & Attractions",
      items: [
        "Reader/Device Manager: Game prices, payouts, heartbeats, OTA",
        "Arcade Wallet & NFC Tap: Phone-as-card, live balance/points",
        "Redemption & Prize Counter: Inventory, tickets, bundles, audits",
        "Remote Play (Claw MVP): App control, payments, fairness, logs"
      ]
    },
    {
      title: "Digital Signage & Music",
      items: [
        "Tavari Signage: Screens, zones, schedules, dynamic ads",
        "Tavari Music/Radio: Playlists, ad-injection, local promos, rights"
      ]
    },
    {
      title: "Operations & Workforce",
      items: [
        "HR & Scheduling: Roles, shifts, availabilities, time-off",
        "Time Clock & Payroll/Lieu: Punches, premiums, exports",
        "Task Manager & SOPs: Checklists, escalations, LMS/training",
        "Incident & Maintenance: Tickets, work orders, compliance logs"
      ]
    },
    {
      title: "Procurement, Costing & Accounting",
      items: [
        "Suppliers & Purchasing: Catalogs, POs, receiving, shortages",
        "Item Cost Review System: Web price scraping, best-supplier picks",
        "Menu Engineering: Target margins, price suggestions, alerts",
        "Accounting Bridge: QBO/Xero sync, taxes, categories, payouts feed"
      ]
    },
    {
      title: "Kiosks & Self-Service",
      items: [
        "Guest Kiosk: Waivers, bookings, reprints, account updates",
        "Self-Order/Pay: Upsells, age gates, ID checks, cashless flows",
        "Staff Tools: Waiver re-open codes, amendment workflows"
      ]
    },
    {
      title: "Web, App & Communications",
      items: [
        "White-Label App Builder: Create custom iOS/Android apps with your branding, configure modules, manage builds and deployments",
        "Website/App Builder: CMS, SEO, online ordering, bookings",
        "Support Center & Chat: Help articles, bots, ticket handoff",
        "VoIP & SMS: Numbers, call routing, click-to-text, broadcasts"
      ]
    },
    {
      title: "Hardware & IoT Integrations",
      items: [
        "Kiosks/Lockers/Charging Towers: Vend, rent, pay, telemetry",
        "Access Control: Doors, turnstiles, zones, anti-passback",
        "Edge Gateway & MQTT: Local caching, offline queuing, device ops",
        "Cameras & Sensors: People counting, queue times, safety triggers"
      ]
    },
    {
      title: "Compliance & Safety",
      items: [
        "PCI/P2PE: Card data controls, scope reduction",
        "PIPEDA/CASL: Data residency, consent, retention policies",
        "Audit & RLS: Fine-grained access, immutable logs, exports",
        "Food & Tax Rules: Jurisdictional engines, evidence trails"
      ]
    }
  ];

  const styles = {
    container: {
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #008080 0%, #006666 100%)',
      color: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      fontFamily: TavariStyles.typography.fontFamily
    },

    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['4xl']
    },

    backButton: {
      position: 'absolute',
      top: TavariStyles.spacing.xl,
      left: TavariStyles.spacing.xl,
      ...TavariStyles.components.button.base,
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      color: TavariStyles.colors.white,
      border: `2px solid rgba(255, 255, 255, 0.3)`,
      backdropFilter: 'blur(10px)',
      fontSize: TavariStyles.typography.fontSize.sm,
      transition: 'all 0.3s ease'
    },

    title: {
      fontSize: 'clamp(2.5rem, 6vw, 4rem)',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      margin: 0,
      textShadow: '0 4px 20px rgba(0,0,0,0.3)',
      letterSpacing: '1px'
    },

    subtitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.normal,
      margin: `${TavariStyles.spacing.lg} 0 0 0`,
      opacity: 0.9
    },

    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
      gap: TavariStyles.spacing.xl,
      maxWidth: '1400px',
      margin: '0 auto'
    },

    moduleCard: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: TavariStyles.borderRadius.xl,
      padding: TavariStyles.spacing.xl,
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
      transition: TavariStyles.transitions.normal,
      cursor: 'default'
    },

    moduleTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      margin: `0 0 ${TavariStyles.spacing.lg} 0`,
      color: '#20b2aa',
      borderBottom: '2px solid rgba(32, 178, 170, 0.3)',
      paddingBottom: TavariStyles.spacing.sm
    },

    moduleList: {
      listStyle: 'none',
      padding: 0,
      margin: 0
    },

    moduleItem: {
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: TavariStyles.typography.lineHeight.relaxed,
      marginBottom: TavariStyles.spacing.sm,
      paddingLeft: TavariStyles.spacing.md,
      position: 'relative',
      opacity: 0.95
    },

    footer: {
      textAlign: 'center',
      marginTop: TavariStyles.spacing['5xl'],
      padding: TavariStyles.spacing.xl,
      borderTop: '1px solid rgba(255, 255, 255, 0.2)',
      fontSize: TavariStyles.typography.fontSize.base,
      opacity: 0.8
    }
  };

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <button 
          style={styles.backButton}
          onClick={handleBackToHome}
          onMouseOver={(e) => {
            e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
            e.target.style.transform = 'translateX(-2px)';
          }}
          onMouseOut={(e) => {
            e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
            e.target.style.transform = 'translateX(0)';
          }}
        >
          ← Back to Home
        </button>

        <header style={styles.header}>
          <h1 style={styles.title}>Tavari Modules</h1>
          <p style={styles.subtitle}>Complete Business Management Platform</p>
        </header>

        <div style={styles.grid}>
          {moduleCategories.map((category, index) => (
            <div 
              key={category.title} 
              style={styles.moduleCard}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.15)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)';
              }}
            >
              <h2 style={styles.moduleTitle}>{category.title}</h2>
              <ul style={styles.moduleList}>
                {category.items.map((item, itemIndex) => (
                  <li key={itemIndex} style={styles.moduleItem}>
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <footer style={styles.footer}>
          <p>Tavari - Your Business's Command Centre</p>
          <p style={{ fontSize: TavariStyles.typography.fontSize.sm, marginTop: TavariStyles.spacing.md }}>
            Comprehensive solution for entertainment venues, restaurants, and retail businesses
          </p>
        </footer>

        <style jsx global>{`
          @media (max-width: 768px) {
            .module-grid {
              grid-template-columns: 1fr !important;
              gap: ${TavariStyles.spacing.lg} !important;
              padding: 0 ${TavariStyles.spacing.md} !important;
            }
            
            .module-card {
              padding: ${TavariStyles.spacing.lg} !important;
            }
            
            .back-button {
              position: relative !important;
              top: auto !important;
              left: auto !important;
              margin-bottom: ${TavariStyles.spacing.lg} !important;
            }
          }
        `}</style>
      </div>
    </SecurityWrapper>
  );
};

export default TavariModules;
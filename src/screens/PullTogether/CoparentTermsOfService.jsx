import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import CoparentPageLayout, { COLORS, SUPPORT_EMAIL } from '../../components/PullTogether/CoparentPageLayout';

const EFFECTIVE_DATE = 'June 20, 2026';
const LEGAL_ENTITY = 'Pull Together';
const MAILING_ADDRESS = '539 First Street, London, ON, N5V 1Z5';
const GOVERNING_LAW = 'the Province of Ontario, Canada';
const DISPUTE_VENUE = 'London, Ontario';

const linkStyle = {
  color: COLORS.indigo,
  fontWeight: 600,
  textDecoration: 'none',
};

const h2Style = {
  fontSize: 23,
  fontWeight: 700,
  color: COLORS.heading,
  marginTop: 24,
  marginBottom: 12,
};

const bodyStyle = {
  fontSize: 15,
  lineHeight: 1.6,
  color: COLORS.body,
  margin: '0 0 16px',
};

const listStyle = {
  ...bodyStyle,
  margin: '0 0 16px',
  paddingLeft: 24,
};

const listItemStyle = {
  marginBottom: 8,
};

export default function CoparentTermsOfService() {
  useEffect(() => {
    document.title = 'Terms of Service — Pull Together: Co-Parent';
  }, []);

  return (
    <CoparentPageLayout>
      <p
        style={{
          margin: '0 0 8px',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: COLORS.indigo,
        }}
      >
        Legal
      </p>
      <h1
        style={{
          margin: '0 0 8px',
          fontSize: 33,
          fontWeight: 800,
          color: COLORS.heading,
          lineHeight: 1.2,
        }}
      >
        Terms of Service
      </h1>
      <p style={{ ...bodyStyle, marginBottom: 4 }}>
        Effective date: {EFFECTIVE_DATE}
      </p>
      <p style={{ ...bodyStyle, marginBottom: 24 }}>
        Last updated: {EFFECTIVE_DATE}
      </p>

      <p style={bodyStyle}>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Pull Together: Co-Parent (the
        &ldquo;App&rdquo;) and related websites and services (collectively, the &ldquo;Service&rdquo;), operated as
        part of the Pull Together product family (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
      </p>
      <p style={bodyStyle}>
        By creating an account, joining a household, or using the Service, you agree to these Terms and to our{' '}
        <Link to="/coparent-app/privacy" style={linkStyle}>
          Privacy Policy
        </Link>
        . If you do not agree, do not use the Service.
      </p>

      <h2 style={h2Style}>1. Who may use the Service</h2>
      <p style={bodyStyle}>
        The Service is for adults (18 or older, or the age of majority where you live). You must be able to form a
        binding contract.
      </p>
      <p style={bodyStyle}>
        The Service is not directed to children under 13. Parents and guardians may enter information about their
        children to coordinate with a co-parent or partner, but children should not create their own accounts.
      </p>
      <p style={bodyStyle}>
        You represent that the information you provide is accurate and that you will keep your account information up
        to date.
      </p>

      <h2 style={h2Style}>2. What the Service is (and is not)</h2>
      <p style={bodyStyle}>
        Pull Together: Co-Parent is a coordination tool for separated or together parents to manage shared household
        information, such as:
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Calendars, custody schedules, and handoffs</li>
        <li style={listItemStyle}>Children&apos;s profiles and related notes</li>
        <li style={listItemStyle}>Shared expenses and reimbursement requests</li>
        <li style={listItemStyle}>Grocery lists</li>
        <li style={listItemStyle}>Messages between household members</li>
        <li style={listItemStyle}>Child requests (&ldquo;wants&rdquo;)</li>
        <li style={listItemStyle}>Document storage and data export (Premium features)</li>
      </ul>
      <p style={bodyStyle}>
        The Service is not legal advice. It is not a substitute for a court order, parenting plan, custody agreement,
        or advice from a qualified attorney. Custody schedules and calendar entries in the app do not create or modify
        legal rights unless reflected in a valid court order or agreement. You are responsible for compliance with
        applicable laws and court orders.
      </p>
      <p style={bodyStyle}>
        The Service is not an emergency service. Do not use it for urgent safety situations. Contact emergency services
        (e.g. 911) when needed.
      </p>

      <h2 style={h2Style}>3. Accounts and security</h2>
      <p style={bodyStyle}>You are responsible for:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Keeping your login credentials confidential</li>
        <li style={listItemStyle}>All activity under your account</li>
        <li style={listItemStyle}>
          Notifying us promptly at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
            {SUPPORT_EMAIL}
          </a>{' '}
          if you suspect unauthorized access
        </li>
      </ul>
      <p style={bodyStyle}>
        We may suspend or terminate accounts that violate these Terms or pose a security risk.
      </p>

      <h2 style={h2Style}>4. Households and shared data</h2>
      <p style={bodyStyle}>
        The Service is built around households — shared spaces that typically include two parents or partners.
      </p>
      <p style={bodyStyle}>When you create or join a household, you understand and agree that:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          Other members of that household can see information you add to shared features, according to what your
          household has enabled (calendar, expenses, messages, grocery, children&apos;s profiles, etc.).
        </li>
        <li style={listItemStyle}>
          You should only invite people you trust and who are appropriate participants in your co-parenting or family
          coordination.
        </li>
        <li style={listItemStyle}>
          You are responsible for what you upload or share, including photos, documents, messages, and children&apos;s
          information.
        </li>
        <li style={listItemStyle}>
          Removing yourself from a household or deleting your account does not automatically delete all household
          records; shared data may remain for other members (see Section 12).
        </li>
      </ul>
      <p style={bodyStyle}>
        Household admins or members may enable or disable certain features for the household. Feature availability may
        differ between Free and Premium plans.
      </p>

      <h2 style={h2Style}>5. Your content and conduct</h2>
      <p style={bodyStyle}>
        Your content means information, text, photos, files, and other material you submit to the Service.
      </p>
      <p style={bodyStyle}>
        You retain ownership of your content. By submitting content to a shared household, you grant us and other
        members of that household the rights necessary to store, display, and share that content through the Service as
        you intend (for example, showing a grocery item to your co-parent).
      </p>
      <p style={bodyStyle}>You agree not to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Use the Service for unlawful, harassing, abusive, or fraudulent purposes</li>
        <li style={listItemStyle}>Upload malware or attempt to disrupt the Service</li>
        <li style={listItemStyle}>Access another user&apos;s account or household without authorization</li>
        <li style={listItemStyle}>Impersonate others or misrepresent your relationship to a child or co-parent</li>
        <li style={listItemStyle}>Upload content you do not have the right to share</li>
        <li style={listItemStyle}>Use the Service to stalk, threaten, or harm others</li>
        <li style={listItemStyle}>Scrape, reverse engineer, or overload our systems except as allowed by law</li>
      </ul>
      <p style={bodyStyle}>
        We may remove content or restrict access if we reasonably believe it violates these Terms or harms others or the
        Service. We are not obligated to monitor all content but may do so.
      </p>

      <h2 style={h2Style}>6. Children&apos;s information</h2>
      <p style={bodyStyle}>
        If you enter information about a child (name, medical notes, schedules, photos, etc.), you represent that you
        have the authority to do so (for example, as a parent or legal guardian) and that sharing it with your household
        members is appropriate.
      </p>
      <p style={bodyStyle}>
        Please avoid entering sensitive information unless necessary for coordination. We describe how we handle this
        data in our{' '}
        <Link to="/coparent-app/privacy" style={linkStyle}>
          Privacy Policy
        </Link>
        .
      </p>

      <h2 style={h2Style}>7. Plans, subscriptions, and billing</h2>
      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Free plan</p>
      <p style={bodyStyle}>The Free plan includes limited features, such as:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>One child profile</li>
        <li style={listItemStyle}>Limited calendar and expense history (currently 30 days)</li>
        <li style={listItemStyle}>Manual calendar events</li>
        <li style={listItemStyle}>Access to messaging, grocery lists, and child requests (subject to change)</li>
      </ul>
      <p style={bodyStyle}>We may change Free plan limits with reasonable notice where required.</p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Premium plan</p>
      <p style={bodyStyle}>
        Premium unlocks additional features for your entire household, including both parents, such as:
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Unlimited child profiles</li>
        <li style={listItemStyle}>Full history</li>
        <li style={listItemStyle}>Recurring custody schedule templates</li>
        <li style={listItemStyle}>PDF and CSV export</li>
      </ul>
      <p style={bodyStyle}>
        Pricing (current): $5.99/month or $49.99/year. A 7-day free trial may be offered on mobile platforms where
        available.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>How billing works</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          Subscriptions are purchased through the Apple App Store (iOS) or Google Play (Android) via our subscription
          partner RevenueCat.
        </li>
        <li style={listItemStyle}>
          One active Premium subscription covers one household — not each parent separately.
        </li>
        <li style={listItemStyle}>
          Web users generally subscribe on a mobile device; Premium then applies to the household on web and mobile.
        </li>
        <li style={listItemStyle}>
          Payment is charged to your Apple or Google account. Renewal is automatic unless you cancel before the renewal
          date through your App Store or Google Play subscription settings.
        </li>
        <li style={listItemStyle}>
          Refunds are handled by Apple or Google under their policies; we do not control store refund decisions.
        </li>
        <li style={listItemStyle}>
          If a subscription lapses, Premium features may be disabled until Premium is active again; your data is not
          immediately deleted solely because Premium ended.
        </li>
        <li style={listItemStyle}>Prices and features may change; applicable store terms apply to purchases.</li>
      </ul>

      <h2 style={h2Style}>8. Third-party services and payment apps</h2>
      <p style={bodyStyle}>
        The Service may link to or open third-party payment apps (Venmo, PayPal, Cash App) using usernames you or your
        co-parent provide. We do not process payments between users. Any payment between parents happens outside the
        app, under those third parties&apos; terms.
      </p>
      <p style={bodyStyle}>
        We use service providers (such as Supabase for hosting and authentication) as described in our{' '}
        <Link to="/coparent-app/privacy" style={linkStyle}>
          Privacy Policy
        </Link>
        .
      </p>

      <h2 style={h2Style}>9. Intellectual property</h2>
      <p style={bodyStyle}>
        The Service, including software, design, logos, and branding, is owned by us or our licensors and protected by
        intellectual property laws. We grant you a limited, non-exclusive, non-transferable license to use the Service
        for personal, non-commercial household coordination in accordance with these Terms.
      </p>
      <p style={bodyStyle}>
        You may not copy, modify, distribute, sell, or lease any part of the Service except as allowed by law or with
        our written permission.
      </p>
      <p style={bodyStyle}>
        &ldquo;Pull Together&rdquo; and related marks are our trademarks. Do not use them without permission.
      </p>

      <h2 style={h2Style}>10. Disclaimers</h2>
      <p style={bodyStyle}>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE.&rdquo; TO THE FULLEST EXTENT PERMITTED BY
        LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT.
      </p>
      <p style={bodyStyle}>
        We do not warrant that the Service will be uninterrupted, error-free, secure, or that data will never be lost.
        You use the Service at your own risk. You are responsible for maintaining backups of important information where
        appropriate (Premium export may assist).
      </p>

      <h2 style={h2Style}>11. Limitation of liability</h2>
      <p style={bodyStyle}>TO THE FULLEST EXTENT PERMITTED BY LAW:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          WE AND OUR AFFILIATES, OFFICERS, EMPLOYEES, AND SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE
          LOSSES, ARISING FROM YOUR USE OF THE SERVICE.
        </li>
        <li style={listItemStyle}>
          OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) $100 USD OR (B)
          THE AMOUNT YOU PAID US FOR PREMIUM IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM.
        </li>
      </ul>
      <p style={bodyStyle}>
        Some jurisdictions do not allow certain limitations; in those cases, our liability is limited to the maximum
        extent permitted by law.
      </p>
      <p style={bodyStyle}>
        Nothing in these Terms limits liability that cannot be limited by law (for example, fraud or intentional
        misconduct).
      </p>

      <h2 style={h2Style}>12. Termination and account deletion</h2>
      <p style={bodyStyle}>
        You may stop using the Service at any time. You may delete your account through the app (where available) or by
        contacting{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      <p style={bodyStyle}>
        We may suspend or terminate your access if you violate these Terms or if we must do so for legal, security, or
        operational reasons.
      </p>
      <p style={bodyStyle}>Upon termination:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Your access to the Service ends.</li>
        <li style={listItemStyle}>Deleting your account removes your profile and membership tied to your account.</li>
        <li style={listItemStyle}>Shared household content may remain visible to other household members.</li>
        <li style={listItemStyle}>
          Provisions that by nature should survive (disclaimers, limitation of liability, dispute terms) will survive.
        </li>
      </ul>

      <h2 style={h2Style}>13. Indemnification</h2>
      <p style={bodyStyle}>
        You agree to defend, indemnify, and hold harmless us and our affiliates, officers, employees, and agents from
        claims, damages, losses, and expenses (including reasonable attorneys&apos; fees) arising from:
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Your use of the Service</li>
        <li style={listItemStyle}>Your content</li>
        <li style={listItemStyle}>Your violation of these Terms</li>
        <li style={listItemStyle}>Your violation of any law or third-party rights</li>
      </ul>

      <h2 style={h2Style}>14. Disputes and governing law</h2>
      <p style={bodyStyle}>
        These Terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict-of-law rules.
      </p>
      <p style={bodyStyle}>
        Any dispute arising from these Terms or the Service will be resolved in the courts located in {DISPUTE_VENUE},
        unless applicable law requires otherwise or you have mandatory consumer rights in your country.
      </p>
      <p style={bodyStyle}>
        For EU/UK consumers: Nothing in these Terms affects your statutory rights.
      </p>

      <h2 style={h2Style}>15. Changes to these Terms</h2>
      <p style={bodyStyle}>
        We may update these Terms from time to time. We will post the updated version on this page and update the
        &ldquo;Last updated&rdquo; date. If changes are material, we may provide additional notice (for example, in the
        app or by email). Continued use after changes take effect means you accept the updated Terms.
      </p>

      <h2 style={h2Style}>16. General</h2>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          <strong style={{ color: COLORS.heading }}>Entire agreement:</strong> These Terms and the Privacy Policy are
          the entire agreement between you and us regarding the Service.
        </li>
        <li style={listItemStyle}>
          <strong style={{ color: COLORS.heading }}>Severability:</strong> If any provision is unenforceable, the rest
          remains in effect.
        </li>
        <li style={listItemStyle}>
          <strong style={{ color: COLORS.heading }}>No waiver:</strong> Failure to enforce a provision is not a waiver.
        </li>
        <li style={listItemStyle}>
          <strong style={{ color: COLORS.heading }}>Assignment:</strong> You may not assign these Terms without our
          consent. We may assign them in connection with a merger or sale.
        </li>
        <li style={listItemStyle}>
          <strong style={{ color: COLORS.heading }}>Contact:</strong> Questions about these Terms:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
            {SUPPORT_EMAIL}
          </a>
        </li>
      </ul>

      <h2 style={h2Style}>17. Contact</h2>
      <ul style={{ ...listStyle, listStyle: 'none', paddingLeft: 0 }}>
        <li style={listItemStyle}>
          Email:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
            {SUPPORT_EMAIL}
          </a>
        </li>
        <li style={listItemStyle}>App name: Pull Together: Co-Parent</li>
        <li style={listItemStyle}>Operator: {LEGAL_ENTITY}</li>
        <li style={listItemStyle}>Address: {MAILING_ADDRESS}</li>
      </ul>
    </CoparentPageLayout>
  );
}

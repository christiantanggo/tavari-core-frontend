import React, { useEffect } from 'react';
import CoparentPageLayout, { COLORS, SUPPORT_EMAIL } from '../../components/PullTogether/CoparentPageLayout';

const EFFECTIVE_DATE = 'June 20, 2026';
const LEGAL_ENTITY = 'Pull Together';
const MAILING_ADDRESS = '539 First Street, London, ON, N5V 1Z5';

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

export default function CoparentPrivacyPolicy() {
  useEffect(() => {
    document.title = 'Privacy Policy — Pull Together: Co-Parent';
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
        Privacy Policy
      </h1>
      <p style={{ ...bodyStyle, marginBottom: 4 }}>
        Effective date: {EFFECTIVE_DATE}
      </p>
      <p style={{ ...bodyStyle, marginBottom: 24 }}>
        Last updated: {EFFECTIVE_DATE}
      </p>

      <p style={bodyStyle}>
        Pull Together: Co-Parent (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is a co-parenting and family
        coordination app operated as part of the Pull Together product family. This Privacy Policy explains how we
        collect, use, share, and protect information when you use the Pull Together: Co-Parent mobile apps (iOS and
        Android), website, and related services (collectively, the &ldquo;Service&rdquo;).
      </p>
      <p style={bodyStyle}>
        By creating an account or using the Service, you agree to this Privacy Policy. If you do not agree, please do
        not use the Service.
      </p>

      <h2 style={h2Style}>1. Who this policy applies to</h2>
      <p style={bodyStyle}>This policy applies to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Parents and guardians who create an account or join a household</li>
        <li style={listItemStyle}>Other adults invited into a shared household</li>
        <li style={listItemStyle}>Visitors who browse our website or marketing pages</li>
      </ul>
      <p style={bodyStyle}>
        The Service is intended for adults. It is not directed to children under 13, and we do not knowingly collect
        personal information from children under 13. Parents may enter information about their children (for example,
        schedules or health notes) to coordinate with a co-parent. That information is controlled by the household
        members who enter it.
      </p>

      <h2 style={h2Style}>2. Information we collect</h2>
      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>A. Account information</p>
      <p style={bodyStyle}>When you sign up, we collect:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Email address</li>
        <li style={listItemStyle}>
          Password (stored securely by our authentication provider; we do not store plain-text passwords)
        </li>
        <li style={listItemStyle}>Display name</li>
        <li style={listItemStyle}>Optional phone number</li>
      </ul>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>B. Household and profile information</p>
      <p style={bodyStyle}>When you create or join a household, we collect:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Household name and settings</li>
        <li style={listItemStyle}>Your role in the household</li>
        <li style={listItemStyle}>
          Optional payment app usernames you choose to share (Venmo, PayPal, Cash App) so your co-parent can pay shared
          expenses
        </li>
        <li style={listItemStyle}>
          Feature preferences enabled for your household (calendar, expenses, grocery, messaging, etc.)
        </li>
      </ul>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>C. Information you add to the Service</p>
      <p style={bodyStyle}>Depending on which features you use, you may store:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          Children&apos;s profiles — names, dates, sizes, food preferences, medical or care notes, and similar details
          you choose to enter
        </li>
        <li style={listItemStyle}>Calendar and custody — events, handoffs, custody schedules, and custom event types</li>
        <li style={listItemStyle}>
          Expenses — amounts, descriptions, who paid, settlement requests, and optional receipt images
        </li>
        <li style={listItemStyle}>Messages — text messages between household members</li>
        <li style={listItemStyle}>Grocery lists — item names, quantities, stores, and optional item photos</li>
        <li style={listItemStyle}>Child requests (&ldquo;wants&rdquo;) — requests and optional supporting documents</li>
        <li style={listItemStyle}>Family photos — images you upload for your household slideshow</li>
        <li style={listItemStyle}>Document vault — files you upload for secure household storage</li>
        <li style={listItemStyle}>Notifications — in-app notification history</li>
      </ul>
      <p style={bodyStyle}>
        You choose what to enter. Please do not upload information you are not comfortable sharing with other members of
        your household.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>D. Subscription and payment information</p>
      <p style={bodyStyle}>
        Premium subscriptions are processed by Apple (iOS) or Google (Android) through our subscription partner
        RevenueCat.
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>We do not receive your full credit card number.</li>
        <li style={listItemStyle}>
          We receive subscription status information (for example, whether Premium is active for your household) so we
          can unlock features for your household.
        </li>
        <li style={listItemStyle}>
          Payment app usernames (Venmo, PayPal, Cash App) are stored in your profile if you add them; we do not process
          payments between parents inside the app.
        </li>
      </ul>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>E. Device and technical information</p>
      <p style={bodyStyle}>We may collect:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Device type, operating system, and app version</li>
        <li style={listItemStyle}>Push notification tokens (so we can send alerts you have agreed to receive)</li>
        <li style={listItemStyle}>Basic log and diagnostic data needed to operate, secure, and improve the Service</li>
      </ul>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>F. Communications with us</p>
      <p style={bodyStyle}>
        If you contact us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
          {SUPPORT_EMAIL}
        </a>
        , we collect the information you provide (such as your email and message content) so we can respond.
      </p>

      <h2 style={h2Style}>3. How we use information</h2>
      <p style={bodyStyle}>We use information to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Create and manage your account</li>
        <li style={listItemStyle}>Let you create or join a household and share data with other household members</li>
        <li style={listItemStyle}>
          Provide features you enable (calendar, expenses, messaging, grocery, exports, etc.)
        </li>
        <li style={listItemStyle}>
          Send push notifications and in-app alerts about household activity (for example, new messages or expense
          requests)
        </li>
        <li style={listItemStyle}>Process and verify Premium subscription status for your household</li>
        <li style={listItemStyle}>Export household data when you request it (Premium feature)</li>
        <li style={listItemStyle}>Maintain security, prevent abuse, and troubleshoot problems</li>
        <li style={listItemStyle}>Improve the Service</li>
        <li style={listItemStyle}>Comply with law and enforce our Terms of Service</li>
      </ul>
      <p style={bodyStyle}>
        We do not sell your personal information. We do not use your household data for third-party advertising.
      </p>

      <h2 style={h2Style}>4. How information is shared</h2>
      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Within your household</p>
      <p style={bodyStyle}>
        When you join a household, information you add to shared features is visible to other members of that household,
        according to the features enabled. This is core to how the Service works. Only invite people you trust.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Service providers</p>
      <p style={bodyStyle}>We use trusted providers to run the Service, including:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Supabase — authentication, database, and file storage</li>
        <li style={listItemStyle}>RevenueCat — subscription management on mobile</li>
        <li style={listItemStyle}>Apple App Store / Google Play — in-app purchases and subscription billing</li>
        <li style={listItemStyle}>Expo / push notification services — delivery of mobile push notifications</li>
      </ul>
      <p style={bodyStyle}>
        These providers process data on our behalf under contractual obligations to protect it and use it only to
        provide services to us.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Legal requirements</p>
      <p style={bodyStyle}>
        We may disclose information if required by law, court order, or government request, or if we believe disclosure
        is necessary to protect rights, safety, security, or the integrity of the Service.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Business transfers</p>
      <p style={bodyStyle}>
        If we are involved in a merger, acquisition, or sale of assets, your information may be transferred as part of
        that transaction. We will notify you if required by law.
      </p>

      <h2 style={h2Style}>5. Data storage and security</h2>
      <p style={bodyStyle}>
        We store data on secure cloud infrastructure (currently via Supabase). We use industry-standard measures such
        as encryption in transit (HTTPS/TLS), access controls, and authenticated access to household data.
      </p>
      <p style={bodyStyle}>
        No method of transmission or storage is 100% secure. You are responsible for keeping your login credentials
        confidential and for choosing appropriate household members to invite.
      </p>

      <h2 style={h2Style}>6. Data retention</h2>
      <p style={bodyStyle}>
        We retain your information while your account is active and as needed to provide the Service.
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          If you delete your account, we remove your profile and household membership associated with your account.
        </li>
        <li style={listItemStyle}>
          Shared household records (calendar events, expenses, messages, children&apos;s profiles, uploaded files, etc.)
          may remain available to other household members because those records belong to the household.
        </li>
        <li style={listItemStyle}>
          We may retain certain information as required by law, to resolve disputes, or for legitimate business purposes
          (for example, billing records).
        </li>
        <li style={listItemStyle}>
          Some picked-up grocery items are automatically removed after a limited retention period.
        </li>
        <li style={listItemStyle}>Backup copies may persist for a limited time before being deleted.</li>
      </ul>

      <h2 style={h2Style}>7. Your choices and rights</h2>
      <p style={bodyStyle}>Depending on where you live, you may have rights to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Access the personal information we hold about you</li>
        <li style={listItemStyle}>Correct inaccurate information (you can update much of this in Settings)</li>
        <li style={listItemStyle}>Request deletion of your account</li>
        <li style={listItemStyle}>Object to or restrict certain processing</li>
        <li style={listItemStyle}>
          Receive a copy of your data (Premium users may also export household data from the app)
        </li>
      </ul>
      <p style={bodyStyle}>
        To make a request, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
          {SUPPORT_EMAIL}
        </a>
        . We may need to verify your identity before responding.
      </p>
      <p style={bodyStyle}>
        <strong style={{ color: COLORS.heading }}>Push notifications:</strong> You can disable notifications in your
        device settings at any time.
      </p>
      <p style={bodyStyle}>
        <strong style={{ color: COLORS.heading }}>Marketing emails:</strong> If we send promotional emails in the
        future, you will be able to unsubscribe using the link in those emails.
      </p>

      <h2 style={h2Style}>8. International users</h2>
      <p style={bodyStyle}>
        The Service is operated from the United States. If you access the Service from outside the United States, your
        information may be transferred to, stored, and processed in the United States or other countries where our
        service providers operate. Those countries may have different data protection laws than your country.
      </p>

      <h2 style={h2Style}>9. California privacy rights (CCPA/CPRA)</h2>
      <p style={bodyStyle}>
        If you are a California resident, you may have additional rights, including the right to know what personal
        information we collect, request deletion, and not be discriminated against for exercising your rights. We do not
        sell personal information. To exercise your rights, contact{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>

      <h2 style={h2Style}>10. Changes to this policy</h2>
      <p style={bodyStyle}>
        We may update this Privacy Policy from time to time. We will post the updated version on this page and change
        the &ldquo;Last updated&rdquo; date. If changes are material, we may provide additional notice (for example, in
        the app or by email). Continued use of the Service after changes means you accept the updated policy.
      </p>

      <h2 style={h2Style}>11. Contact us</h2>
      <p style={bodyStyle}>
        If you have questions about this Privacy Policy or our data practices:
      </p>
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

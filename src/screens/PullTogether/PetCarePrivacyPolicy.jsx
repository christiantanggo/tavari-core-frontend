import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PetCarePageLayout, { COLORS, SUPPORT_EMAIL } from '../../components/PullTogether/PetCarePageLayout';

const EFFECTIVE_DATE = 'June 23, 2026';
const LEGAL_ENTITY = 'Tanggo Companies Inc.';
const MAILING_ADDRESS = '539 First Street, London, ON, N5V 1Z5';

const linkStyle = { color: COLORS.indigo, fontWeight: 600, textDecoration: 'none' };
const h2Style = { fontSize: 23, fontWeight: 700, color: COLORS.heading, marginTop: 24, marginBottom: 12 };
const bodyStyle = { fontSize: 15, lineHeight: 1.6, color: COLORS.body, margin: '0 0 16px' };
const listStyle = { ...bodyStyle, paddingLeft: 24 };
const listItemStyle = { marginBottom: 8 };

export default function PetCarePrivacyPolicy() {
  useEffect(() => {
    document.title = 'Privacy Policy — Pull Together: Pet Care';
  }, []);

  return (
    <PetCarePageLayout>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: COLORS.indigo }}>
        Legal
      </p>
      <h1 style={{ margin: '0 0 8px', fontSize: 33, fontWeight: 800, color: COLORS.heading, lineHeight: 1.2 }}>
        Privacy Policy
      </h1>
      <p style={{ ...bodyStyle, marginBottom: 4 }}>Effective date: {EFFECTIVE_DATE}</p>
      <p style={{ ...bodyStyle, marginBottom: 24 }}>Last updated: {EFFECTIVE_DATE}</p>

      <p style={bodyStyle}>
        Pull Together: Pet Care (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is a pet care organization app
        operated as part of the Pull Together product family. This Privacy Policy explains how we collect, use, share, and
        protect information when you use the Pull Together: Pet Care mobile apps (iOS and Android), website, and related
        services (collectively, the &ldquo;Service&rdquo;).
      </p>
      <p style={bodyStyle}>
        By creating an account or using the Service, you agree to this Privacy Policy. If you do not agree, please do not
        use the Service.
      </p>

      <h2 style={h2Style}>1. Who this policy applies to</h2>
      <p style={bodyStyle}>This policy applies to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Pet owners who create an account or add pets to the Service</li>
        <li style={listItemStyle}>Care Team members (helpers) invited to assist with specific pets</li>
        <li style={listItemStyle}>Visitors who browse our website or marketing pages</li>
      </ul>
      <p style={bodyStyle}>
        The Service is intended for adults. It is not directed to children under 13, and we do not knowingly collect
        personal information from children under 13.
      </p>

      <h2 style={h2Style}>2. Shared login, separate Pet Care data</h2>
      <p style={bodyStyle}>
        Pull Together uses a shared account system across apps in the product family. Your email and password are managed
        through our authentication provider (Supabase). When you sign in to Pet Care, we use the same Pull Together login
        as other Pull Together apps you may use.
      </p>
      <p style={bodyStyle}>
        Pet Care data is stored separately from other Pull Together apps (for example, Co-Parent). Pet profiles, care
        records, photos, and Care Team assignments live in Pet Care&ndash;specific database tables and are not shared with
        Co-Parent or other apps unless you separately use those products with the same account.
      </p>

      <h2 style={h2Style}>3. Information we collect</h2>
      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>A. Account information</p>
      <p style={bodyStyle}>When you sign up or sign in, we collect:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Email address</li>
        <li style={listItemStyle}>
          Password (stored securely by our authentication provider; we do not store plain-text passwords)
        </li>
        <li style={listItemStyle}>Display name</li>
        <li style={listItemStyle}>Optional phone number</li>
      </ul>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>B. Pet and care information</p>
      <p style={bodyStyle}>When you use the Service, you may store:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          Pet profiles — name, species, breed, date of birth, weight, notes, and similar details you choose to enter
        </li>
        <li style={listItemStyle}>Medications — names, dosages, schedules, and related notes</li>
        <li style={listItemStyle}>Vaccines — vaccine names, dates, and reminder settings</li>
        <li style={listItemStyle}>Vet visits — visit dates, clinic names, notes, and follow-up reminders</li>
        <li style={listItemStyle}>Reminders — care tasks and alerts you configure for your pets</li>
        <li style={listItemStyle}>Pet photos — images you upload for your pets (stored in Supabase Storage)</li>
      </ul>
      <p style={bodyStyle}>
        You choose what to enter. Please do not upload information you are not comfortable sharing with Care Team members
        assigned to that pet.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>C. Care Team information</p>
      <p style={bodyStyle}>If you invite helpers to your Care Team, we collect:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Invitations you send (email addresses of helpers)</li>
        <li style={listItemStyle}>Each helper&apos;s role and which pets they are assigned to</li>
        <li style={listItemStyle}>
          Activity visible to owners within the app (for example, when a helper completes a care task)
        </li>
      </ul>
      <p style={bodyStyle}>
        Care Team members can see information only for pets assigned to them — not your entire account or unassigned pets.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>D. Subscription and payment information</p>
      <p style={bodyStyle}>
        Premium subscriptions for Pet Care are processed by Apple (iOS) or Google (Android) through our subscription
        partner RevenueCat.
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>We do not receive your full credit card number.</li>
        <li style={listItemStyle}>
          We receive subscription status information (for example, whether Premium is active for your account) so we can
          unlock Premium features for you.
        </li>
        <li style={listItemStyle}>
          Pet Care Premium is per user and per app — it is not shared with Pull Together: Co-Parent or other Pull Together
          apps.
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

      <h2 style={h2Style}>4. How we use information</h2>
      <p style={bodyStyle}>We use information to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Create and manage your account</li>
        <li style={listItemStyle}>Let you add pets, track care, and set reminders</li>
        <li style={listItemStyle}>Let you invite Care Team members and share assigned pet data with them</li>
        <li style={listItemStyle}>Send push notifications and in-app alerts about care reminders and activity</li>
        <li style={listItemStyle}>Process and verify Premium subscription status for your account</li>
        <li style={listItemStyle}>Maintain security, prevent abuse, and troubleshoot problems</li>
        <li style={listItemStyle}>Improve the Service</li>
        <li style={listItemStyle}>Comply with law and enforce our Terms of Service</li>
      </ul>
      <p style={bodyStyle}>
        We do not sell your personal information. We do not use your pet care data for third-party advertising.
      </p>

      <h2 style={h2Style}>5. How information is shared</h2>
      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Within your Care Team</p>
      <p style={bodyStyle}>
        When you assign a Care Team member to a pet, that member can see that pet&apos;s profile and related care
        information according to their assignment. Only invite people you trust.
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
        These providers process data on our behalf under contractual obligations to protect it and use it only to provide
        services to us.
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

      <h2 style={h2Style}>6. Data storage and security</h2>
      <p style={bodyStyle}>
        We store data on secure cloud infrastructure (currently via Supabase). We use industry-standard measures such as
        encryption in transit (HTTPS/TLS), access controls, and authenticated access to your Pet Care data.
      </p>
      <p style={bodyStyle}>
        No method of transmission or storage is 100% secure. You are responsible for keeping your login credentials
        confidential and for choosing appropriate Care Team members to invite.
      </p>

      <h2 style={h2Style}>7. Data retention and deletion</h2>
      <p style={bodyStyle}>
        We retain your information while your account is active and as needed to provide the Service.
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          You may delete individual pets or Pet Care data through the app where available.
        </li>
        <li style={listItemStyle}>
          You may request deletion of your Pet Care data or your account by contacting{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
            {SUPPORT_EMAIL}
          </a>
          .
        </li>
        <li style={listItemStyle}>
          Deleting your Pull Together account may remove your access to Pet Care and associated data, subject to retention
          required by law or legitimate business purposes.
        </li>
        <li style={listItemStyle}>Backup copies may persist for a limited time before being deleted.</li>
      </ul>

      <h2 style={h2Style}>8. Your choices and rights</h2>
      <p style={bodyStyle}>Depending on where you live, you may have rights to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Access the personal information we hold about you</li>
        <li style={listItemStyle}>Correct inaccurate information (you can update much of this in the app)</li>
        <li style={listItemStyle}>Request deletion of your account or Pet Care data</li>
        <li style={listItemStyle}>Object to or restrict certain processing</li>
        <li style={listItemStyle}>Receive a copy of your data where applicable</li>
      </ul>
      <p style={bodyStyle}>
        To make a request, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
          {SUPPORT_EMAIL}
        </a>
        . We may need to verify your identity before responding.
      </p>
      <p style={bodyStyle}>
        <strong style={{ color: COLORS.heading }}>Push notifications:</strong> You can disable notifications in your device
        settings at any time.
      </p>

      <h2 style={h2Style}>9. International users</h2>
      <p style={bodyStyle}>
        The Service is operated from Canada. If you access the Service from outside Canada, your information may be
        transferred to, stored, and processed in Canada, the United States, or other countries where our service
        providers operate. Those countries may have different data protection laws than your country.
      </p>

      <h2 style={h2Style}>10. Not veterinary advice</h2>
      <p style={bodyStyle}>
        Information you store in the Service (including medication schedules, vaccine records, and vet visit notes) is for
        your personal organization only. The Service does not provide veterinary advice, diagnoses, or treatment
        recommendations. Always consult a licensed veterinarian for medical decisions about your pets.
      </p>

      <h2 style={h2Style}>11. Changes to this policy</h2>
      <p style={bodyStyle}>
        We may update this Privacy Policy from time to time. We will post the updated version on this page and change the
        &ldquo;Last updated&rdquo; date. If changes are material, we may provide additional notice (for example, in the
        app or by email). Continued use of the Service after changes means you accept the updated policy.
      </p>

      <h2 style={h2Style}>12. Contact us</h2>
      <p style={bodyStyle}>If you have questions about this Privacy Policy or our data practices:</p>
      <ul style={{ ...listStyle, listStyle: 'none', paddingLeft: 0 }}>
        <li style={listItemStyle}>
          Email:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
            {SUPPORT_EMAIL}
          </a>
        </li>
        <li style={listItemStyle}>App name: Pull Together: Pet Care</li>
        <li style={listItemStyle}>Bundle ID: com.tavari.pulltogether.pets</li>
        <li style={listItemStyle}>Operator: {LEGAL_ENTITY}</li>
        <li style={listItemStyle}>Address: {MAILING_ADDRESS}</li>
      </ul>
    </PetCarePageLayout>
  );
}

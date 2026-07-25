import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PetCarePageLayout, { COLORS, SUPPORT_EMAIL } from '../../components/PullTogether/PetCarePageLayout';

const EFFECTIVE_DATE = 'June 23, 2026';
const LEGAL_ENTITY = 'Tanggo Companies Inc.';
const MAILING_ADDRESS = '539 First Street, London, ON, N5V 1Z5';
const GOVERNING_LAW = 'the Province of Ontario, Canada';
const DISPUTE_VENUE = 'London, Ontario';

const linkStyle = { color: COLORS.indigo, fontWeight: 600, textDecoration: 'none' };
const h2Style = { fontSize: 23, fontWeight: 700, color: COLORS.heading, marginTop: 24, marginBottom: 12 };
const bodyStyle = { fontSize: 15, lineHeight: 1.6, color: COLORS.body, margin: '0 0 16px' };
const listStyle = { ...bodyStyle, paddingLeft: 24 };
const listItemStyle = { marginBottom: 8 };

export default function PetCareTermsOfService() {
  useEffect(() => {
    document.title = 'Terms of Service — Pull Together: Pet Care';
  }, []);

  return (
    <PetCarePageLayout>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: COLORS.indigo }}>
        Legal
      </p>
      <h1 style={{ margin: '0 0 8px', fontSize: 33, fontWeight: 800, color: COLORS.heading, lineHeight: 1.2 }}>
        Terms of Service
      </h1>
      <p style={{ ...bodyStyle, marginBottom: 4 }}>Effective date: {EFFECTIVE_DATE}</p>
      <p style={{ ...bodyStyle, marginBottom: 24 }}>Last updated: {EFFECTIVE_DATE}</p>

      <p style={bodyStyle}>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Pull Together: Pet Care (the
        &ldquo;App&rdquo;) and related websites and services (collectively, the &ldquo;Service&rdquo;), operated as part
        of the Pull Together product family (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
      </p>
      <p style={bodyStyle}>
        By creating an account, adding pets, or using the Service, you agree to these Terms and to our{' '}
        <Link to="/petcare-app/privacy" style={linkStyle}>
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
        You represent that the information you provide is accurate and that you will keep your account information up to
        date.
      </p>

      <h2 style={h2Style}>2. What the Service is (and is not)</h2>
      <p style={bodyStyle}>
        Pull Together: Pet Care is an organization tool for pet owners and trusted helpers to track and coordinate pet
        care, such as:
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Pet profiles and notes</li>
        <li style={listItemStyle}>Medications, vaccines, and vet visits</li>
        <li style={listItemStyle}>Care reminders and task tracking</li>
        <li style={listItemStyle}>Pet photos</li>
        <li style={listItemStyle}>Care Team collaboration for assigned pets</li>
      </ul>
      <p style={bodyStyle}>
        The Service is not veterinary advice. It is not a substitute for examination, diagnosis, or treatment by a
        licensed veterinarian. Medication schedules, vaccine records, and notes in the app are for your personal
        organization only and do not create a veterinary relationship. Always consult a qualified veterinarian for
        medical decisions about your pets.
      </p>
      <p style={bodyStyle}>
        The Service is not an emergency service. Do not use it for urgent pet health emergencies. Contact your
        veterinarian or an emergency clinic immediately when needed.
      </p>

      <h2 style={h2Style}>3. Shared login, separate Pet Care data</h2>
      <p style={bodyStyle}>
        Pull Together uses a shared account across apps in the product family. Your login credentials work across Pull
        Together apps you use. Pet Care data (pets, care records, photos, Care Team assignments) is stored separately
        from other Pull Together apps such as Co-Parent and is not automatically shared between apps.
      </p>

      <h2 style={h2Style}>4. Owners and Care Team</h2>
      <p style={bodyStyle}>
        Pet owners create pet profiles and may invite Care Team members (helpers) to assist with specific pets.
      </p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          <strong style={{ color: COLORS.heading }}>Owners</strong> control pet profiles, care records, invitations, and
          assignments.
        </li>
        <li style={listItemStyle}>
          <strong style={{ color: COLORS.heading }}>Care Team members</strong> can view and interact with information
          only for pets assigned to them — not unassigned pets or the owner&apos;s full account.
        </li>
        <li style={listItemStyle}>
          Care Team helpers may use the Service for free when invited by an owner, subject to feature limits that apply
          to their role and plan.
        </li>
        <li style={listItemStyle}>
          You are responsible for inviting only people you trust and who are appropriate to help with your pets.
        </li>
      </ul>

      <h2 style={h2Style}>5. Accounts and security</h2>
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

      <h2 style={h2Style}>6. Your content and conduct</h2>
      <p style={bodyStyle}>
        Your content means information, text, photos, and other material you submit to the Service.
      </p>
      <p style={bodyStyle}>
        You retain ownership of your content. By submitting content, you grant us the rights necessary to store, display,
        and share that content through the Service as you intend (for example, showing a pet&apos;s medication schedule
        to an assigned Care Team member).
      </p>
      <p style={bodyStyle}>You agree not to:</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>Use the Service for unlawful, harassing, abusive, or fraudulent purposes</li>
        <li style={listItemStyle}>Upload malware or attempt to disrupt the Service</li>
        <li style={listItemStyle}>Access another user&apos;s account or pet data without authorization</li>
        <li style={listItemStyle}>Upload content you do not have the right to share</li>
        <li style={listItemStyle}>Use the Service to harm animals or others</li>
        <li style={listItemStyle}>Scrape, reverse engineer, or overload our systems except as allowed by law</li>
      </ul>
      <p style={bodyStyle}>
        We may remove content or restrict access if we reasonably believe it violates these Terms or harms others or the
        Service.
      </p>

      <h2 style={h2Style}>7. Plans, subscriptions, and billing</h2>
      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Free plan</p>
      <p style={bodyStyle}>
        The Free plan includes limited features (such as a limited number of pets and Care Team members). We may change
        Free plan limits with reasonable notice where required.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>Premium plan</p>
      <p style={bodyStyle}>
        Premium unlocks additional features for your account, such as more pets, more Care Team members, and advanced
        organization features. Pricing and trial offers are shown in the app and may vary by platform.
      </p>

      <p style={{ ...bodyStyle, fontWeight: 600, color: COLORS.heading }}>How billing works</p>
      <ul style={listStyle}>
        <li style={listItemStyle}>
          Subscriptions are purchased through the Apple App Store (iOS) or Google Play (Android) via RevenueCat.
        </li>
        <li style={listItemStyle}>
          Pet Care Premium applies to your Pet Care account only — it is not shared with Pull Together: Co-Parent or
          other Pull Together apps.
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
      </ul>

      <h2 style={h2Style}>8. Notifications</h2>
      <p style={bodyStyle}>
        We may send push notifications and in-app alerts about care reminders and activity. Delivery is not guaranteed
        and may depend on your device settings, network connectivity, and platform services. Do not rely on the Service
        as the sole method for time-critical pet care.
      </p>

      <h2 style={h2Style}>9. Third-party services</h2>
      <p style={bodyStyle}>
        We use service providers (such as Supabase for hosting and authentication, and RevenueCat for subscriptions) as
        described in our{' '}
        <Link to="/petcare-app/privacy" style={linkStyle}>
          Privacy Policy
        </Link>
        .
      </p>

      <h2 style={h2Style}>10. Intellectual property</h2>
      <p style={bodyStyle}>
        The Service, including software, design, logos, and branding, is owned by us or our licensors and protected by
        intellectual property laws. We grant you a limited, non-exclusive, non-transferable license to use the Service
        for personal, non-commercial pet care organization in accordance with these Terms.
      </p>
      <p style={bodyStyle}>
        &ldquo;Pull Together&rdquo; and related marks are our trademarks. Do not use them without permission.
      </p>

      <h2 style={h2Style}>11. Disclaimers</h2>
      <p style={bodyStyle}>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE.&rdquo; TO THE FULLEST EXTENT PERMITTED BY
        LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT.
      </p>
      <p style={bodyStyle}>
        We do not warrant that the Service will be uninterrupted, error-free, secure, or that data will never be lost.
        You use the Service at your own risk.
      </p>

      <h2 style={h2Style}>12. Limitation of liability</h2>
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

      <h2 style={h2Style}>13. Indemnification</h2>
      <p style={bodyStyle}>
        You agree to defend, indemnify, and hold harmless us and our affiliates, officers, employees, and agents from
        claims, damages, losses, and expenses (including reasonable attorneys&apos; fees) arising from your use of the
        Service, your content, your violation of these Terms, or your violation of any law or third-party rights.
      </p>

      <h2 style={h2Style}>14. Termination and account deletion</h2>
      <p style={bodyStyle}>
        You may stop using the Service at any time. You may delete Pet Care data or your account through the app (where
        available) or by contacting{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      <p style={bodyStyle}>
        We may suspend or terminate your access if you violate these Terms or if we must do so for legal, security, or
        operational reasons.
      </p>

      <h2 style={h2Style}>15. Disputes and governing law</h2>
      <p style={bodyStyle}>
        These Terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict-of-law rules.
      </p>
      <p style={bodyStyle}>
        Any dispute arising from these Terms or the Service will be resolved in the courts located in {DISPUTE_VENUE},
        unless applicable law requires otherwise or you have mandatory consumer rights in your country.
      </p>

      <h2 style={h2Style}>16. Changes to these Terms</h2>
      <p style={bodyStyle}>
        We may update these Terms from time to time. We will post the updated version on this page and update the
        &ldquo;Last updated&rdquo; date. If changes are material, we may provide additional notice (for example, in the
        app or by email). Continued use after changes take effect means you accept the updated Terms.
      </p>

      <h2 style={h2Style}>17. Contact</h2>
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

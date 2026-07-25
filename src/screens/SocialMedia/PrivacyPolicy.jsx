// src/screens/SocialMedia/PrivacyPolicy.jsx
// Privacy Policy page for Tavari Social Media Manager
import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

const PrivacyPolicy = () => {
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#ffffff',
      padding: '40px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      lineHeight: 1.6,
      color: '#333333'
    }}>
      <div style={{
        maxWidth: '900px',
        margin: '0 auto'
      }}>
        {/* Header */}
        <div style={{
          marginBottom: '40px',
          paddingBottom: '20px',
          borderBottom: '2px solid #e5e7eb'
        }}>
          <h1 style={{
            fontSize: '36px',
            fontWeight: 'bold',
            color: TavariStyles.colors.primary || '#008080',
            marginBottom: '10px'
          }}>
            Privacy Policy
          </h1>
          <p style={{
            fontSize: '14px',
            color: '#6b7280',
            margin: 0
          }}>
            Last Updated: {currentDate}
          </p>
        </div>

        {/* Content */}
        <div style={{
          fontSize: '16px',
          color: '#374151'
        }}>
          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              1. Introduction
            </h2>
            <p>
              Tavari ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Social Media Manager service ("Service"). Please read this policy carefully to understand our practices regarding your data.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              2. Information We Collect
            </h2>
            
            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#374151',
              marginTop: '24px',
              marginBottom: '12px'
            }}>
              2.1 Account Information
            </h3>
            <p>
              When you register for an account, we collect:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Name, email address, and contact information</li>
              <li style={{ marginBottom: '8px' }}>Business name and details</li>
              <li style={{ marginBottom: '8px' }}>Payment and billing information</li>
              <li style={{ marginBottom: '8px' }}>Account preferences and settings</li>
            </ul>

            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#374151',
              marginTop: '24px',
              marginBottom: '12px'
            }}>
              2.2 Social Media Account Data
            </h3>
            <p>
              When you connect social media accounts (TikTok, Instagram, Facebook, Twitter, etc.), we collect:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Account identifiers and profile information</li>
              <li style={{ marginBottom: '8px' }}>Access tokens and authentication credentials (stored securely)</li>
              <li style={{ marginBottom: '8px' }}>Content you create, schedule, or publish through the Service</li>
              <li style={{ marginBottom: '8px' }}>Analytics and engagement data from your social media accounts</li>
            </ul>

            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#374151',
              marginTop: '24px',
              marginBottom: '12px'
            }}>
              2.3 Usage Data
            </h3>
            <p>
              We automatically collect information about how you use the Service:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Device information (IP address, browser type, operating system)</li>
              <li style={{ marginBottom: '8px' }}>Usage patterns and feature interactions</li>
              <li style={{ marginBottom: '8px' }}>Log files and error reports</li>
              <li style={{ marginBottom: '8px' }}>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              3. How We Use Your Information
            </h2>
            <p>We use the information we collect to:</p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Provide, maintain, and improve the Service</li>
              <li style={{ marginBottom: '8px' }}>Process transactions and manage your account</li>
              <li style={{ marginBottom: '8px' }}>Connect to and manage your social media accounts</li>
              <li style={{ marginBottom: '8px' }}>Schedule and publish content on your behalf</li>
              <li style={{ marginBottom: '8px' }}>Generate analytics and performance reports</li>
              <li style={{ marginBottom: '8px' }}>Send you service-related communications</li>
              <li style={{ marginBottom: '8px' }}>Respond to your inquiries and provide customer support</li>
              <li style={{ marginBottom: '8px' }}>Detect, prevent, and address technical issues and security threats</li>
              <li style={{ marginBottom: '8px' }}>Comply with legal obligations and enforce our terms</li>
            </ul>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              4. Information Sharing and Disclosure
            </h2>
            <p>We do not sell your personal information. We may share your information in the following circumstances:</p>
            
            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#374151',
              marginTop: '24px',
              marginBottom: '12px'
            }}>
              4.1 Social Media Platforms
            </h3>
            <p>
              We share content and data with the social media platforms you connect (TikTok, Instagram, Facebook, Twitter, etc.) as necessary to provide the Service. This sharing is governed by each platform's privacy policy.
            </p>

            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#374151',
              marginTop: '24px',
              marginBottom: '12px'
            }}>
              4.2 Service Providers
            </h3>
            <p>
              We may share information with third-party service providers who perform services on our behalf, such as hosting, payment processing, analytics, and customer support. These providers are contractually obligated to protect your information.
            </p>

            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#374151',
              marginTop: '24px',
              marginBottom: '12px'
            }}>
              4.3 Legal Requirements
            </h3>
            <p>
              We may disclose information if required by law, court order, or government regulation, or to protect our rights, property, or safety, or that of our users or others.
            </p>

            <h3 style={{
              fontSize: '20px',
              fontWeight: '600',
              color: '#374151',
              marginTop: '24px',
              marginBottom: '12px'
            }}>
              4.4 Business Transfers
            </h3>
            <p>
              In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              5. Data Security
            </h2>
            <p>
              We implement appropriate technical and organizational measures to protect your information against unauthorized access, alteration, disclosure, or destruction. These measures include:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Encryption of data in transit and at rest</li>
              <li style={{ marginBottom: '8px' }}>Secure authentication and access controls</li>
              <li style={{ marginBottom: '8px' }}>Regular security assessments and updates</li>
              <li style={{ marginBottom: '8px' }}>Secure storage of access tokens and credentials</li>
              <li style={{ marginBottom: '8px' }}>Employee training on data protection</li>
            </ul>
            <p style={{ marginTop: '16px' }}>
              However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to protect your information, we cannot guarantee absolute security.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              6. Your Rights and Choices
            </h2>
            <p>You have the following rights regarding your personal information:</p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}><strong>Access:</strong> Request access to your personal information</li>
              <li style={{ marginBottom: '8px' }}><strong>Correction:</strong> Request correction of inaccurate information</li>
              <li style={{ marginBottom: '8px' }}><strong>Deletion:</strong> Request deletion of your information</li>
              <li style={{ marginBottom: '8px' }}><strong>Portability:</strong> Request transfer of your data</li>
              <li style={{ marginBottom: '8px' }}><strong>Opt-Out:</strong> Unsubscribe from marketing communications</li>
              <li style={{ marginBottom: '8px' }}><strong>Account Deletion:</strong> Delete your account and associated data</li>
              <li style={{ marginBottom: '8px' }}><strong>Disconnect Accounts:</strong> Disconnect social media accounts at any time</li>
            </ul>
            <p style={{ marginTop: '16px' }}>
              To exercise these rights, please contact us using the information provided in Section 10.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              7. Cookies and Tracking Technologies
            </h2>
            <p>
              We use cookies and similar tracking technologies to collect and store information about your use of the Service. Cookies help us:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Remember your preferences and settings</li>
              <li style={{ marginBottom: '8px' }}>Analyze usage patterns and improve the Service</li>
              <li style={{ marginBottom: '8px' }}>Provide personalized content and features</li>
              <li style={{ marginBottom: '8px' }}>Maintain security and prevent fraud</li>
            </ul>
            <p style={{ marginTop: '16px' }}>
              You can control cookies through your browser settings. However, disabling cookies may limit your ability to use certain features of the Service.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              8. Third-Party Links and Services
            </h2>
            <p>
              The Service may contain links to third-party websites or integrate with third-party services. We are not responsible for the privacy practices of these third parties. We encourage you to review the privacy policies of any third-party services you access through our Service.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              9. Children's Privacy
            </h2>
            <p>
              The Service is not intended for individuals under the age of 13 (or the applicable age of consent in your jurisdiction). We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              10. International Data Transfers
            </h2>
            <p>
              Your information may be transferred to and processed in countries other than your country of residence. These countries may have different data protection laws. By using the Service, you consent to the transfer of your information to these countries.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              11. Data Retention
            </h2>
            <p>
              We retain your information for as long as necessary to provide the Service, comply with legal obligations, resolve disputes, and enforce our agreements. When you delete your account, we will delete or anonymize your information in accordance with our data retention policies, except where we are required to retain it by law.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              12. Changes to This Privacy Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the "Last Updated" date. We may also notify you via email or through the Service. Your continued use of the Service after such changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section style={{ marginBottom: '40px' }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '16px',
              marginTop: '32px'
            }}>
              13. Contact Us
            </h2>
            <p>
              If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
            </p>
            <p style={{ marginTop: '12px', paddingLeft: '20px' }}>
              <strong>Email:</strong> info@tanggo.ca<br />
              <strong>Website:</strong> www.tavari.com<br />
              <strong>Address:</strong> 539 First Street, London, ON, N5V 1Z5
            </p>
          </section>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: '60px',
          paddingTop: '30px',
          borderTop: '2px solid #e5e7eb',
          textAlign: 'center',
          color: '#6b7280',
          fontSize: '14px'
        }}>
          <p>© {new Date().getFullYear()} Tavari. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;


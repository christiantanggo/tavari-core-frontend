// src/screens/SocialMedia/TermsOfService.jsx
// Terms of Service page for Tavari Social Media Manager
import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

const TermsOfService = () => {
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
            Terms of Service
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
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing and using Tavari Social Media Manager ("Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.
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
              2. Description of Service
            </h2>
            <p>
              Tavari Social Media Manager is a comprehensive social media management platform that allows businesses to manage, schedule, and analyze content across multiple social media platforms including but not limited to TikTok, Instagram, Facebook, and Twitter. The Service provides tools for content creation, scheduling, analytics, and account management.
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
              3. User Accounts and Registration
            </h2>
            <p>
              To use certain features of the Service, you must register for an account. You agree to:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Provide accurate, current, and complete information during registration</li>
              <li style={{ marginBottom: '8px' }}>Maintain and update your account information to keep it accurate</li>
              <li style={{ marginBottom: '8px' }}>Maintain the security of your password and identification</li>
              <li style={{ marginBottom: '8px' }}>Accept all responsibility for activities that occur under your account</li>
              <li style={{ marginBottom: '8px' }}>Notify us immediately of any unauthorized use of your account</li>
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
              4. Social Media Platform Integration
            </h2>
            <p>
              By connecting your social media accounts to the Service, you:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Grant us permission to access and manage your social media accounts as authorized by you</li>
              <li style={{ marginBottom: '8px' }}>Agree to comply with the terms of service of each connected platform (TikTok, Instagram, Facebook, Twitter, etc.)</li>
              <li style={{ marginBottom: '8px' }}>Understand that we act as an intermediary and are not responsible for the policies or actions of third-party platforms</li>
              <li style={{ marginBottom: '8px' }}>Acknowledge that platform APIs and features may change, and we cannot guarantee uninterrupted service</li>
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
              5. Content and Intellectual Property
            </h2>
            <p>
              You retain all rights to content you create, upload, or publish through the Service. By using the Service, you:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Grant us a limited license to use, store, and transmit your content solely for the purpose of providing the Service</li>
              <li style={{ marginBottom: '8px' }}>Represent that you own or have the right to use all content you submit</li>
              <li style={{ marginBottom: '8px' }}>Agree not to post content that violates any laws, infringes on rights of others, or contains harmful or offensive material</li>
              <li style={{ marginBottom: '8px' }}>Understand that we reserve the right to remove content that violates these terms</li>
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
              6. Prohibited Uses
            </h2>
            <p>You agree not to use the Service to:</p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Violate any applicable laws or regulations</li>
              <li style={{ marginBottom: '8px' }}>Infringe upon intellectual property rights</li>
              <li style={{ marginBottom: '8px' }}>Transmit spam, malware, or malicious code</li>
              <li style={{ marginBottom: '8px' }}>Impersonate others or provide false information</li>
              <li style={{ marginBottom: '8px' }}>Interfere with or disrupt the Service or servers</li>
              <li style={{ marginBottom: '8px' }}>Attempt to gain unauthorized access to any part of the Service</li>
              <li style={{ marginBottom: '8px' }}>Use automated systems to access the Service without permission</li>
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
              7. Service Availability and Modifications
            </h2>
            <p>
              We strive to provide reliable service but do not guarantee uninterrupted or error-free operation. We reserve the right to:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>Modify, suspend, or discontinue any part of the Service at any time</li>
              <li style={{ marginBottom: '8px' }}>Perform maintenance that may temporarily interrupt service</li>
              <li style={{ marginBottom: '8px' }}>Update features and functionality</li>
              <li style={{ marginBottom: '8px' }}>Limit access to certain features based on subscription level</li>
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
              8. Payment and Billing
            </h2>
            <p>
              If you subscribe to a paid plan:
            </p>
            <ul style={{ paddingLeft: '24px', marginTop: '12px' }}>
              <li style={{ marginBottom: '8px' }}>You agree to pay all fees associated with your subscription</li>
              <li style={{ marginBottom: '8px' }}>Fees are billed in advance on a recurring basis</li>
              <li style={{ marginBottom: '8px' }}>All fees are non-refundable unless required by law</li>
              <li style={{ marginBottom: '8px' }}>We reserve the right to change pricing with 30 days notice</li>
              <li style={{ marginBottom: '8px' }}>Failure to pay may result in suspension or termination of service</li>
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
              9. Limitation of Liability
            </h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, TAVARI AND ITS AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES RESULTING FROM YOUR USE OF THE SERVICE.
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
              10. Indemnification
            </h2>
            <p>
              You agree to indemnify, defend, and hold harmless Tavari, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from your use of the Service, violation of these terms, or infringement of any rights of another.
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
              11. Termination
            </h2>
            <p>
              We may terminate or suspend your account and access to the Service immediately, without prior notice, for any breach of these Terms. Upon termination, your right to use the Service will cease immediately. You may terminate your account at any time by contacting us or using account settings.
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
              12. Changes to Terms
            </h2>
            <p>
              We reserve the right to modify these Terms at any time. We will notify users of material changes via email or through the Service. Your continued use of the Service after such modifications constitutes acceptance of the updated Terms.
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
              13. Governing Law
            </h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which Tavari operates, without regard to its conflict of law provisions.
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
              14. Contact Information
            </h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at:
            </p>
            <p style={{ marginTop: '12px', paddingLeft: '20px' }}>
              <strong>Email:</strong> info@tanggo.ca<br />
              <strong>Address:</strong> 539 First Street, London, ON, N5V 1Z5<br />
              <strong>Website:</strong> www.tavari.com
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

export default TermsOfService;


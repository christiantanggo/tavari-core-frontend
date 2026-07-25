// src/components/Settings/TavariPayTab.jsx
import React from 'react';

const TavariPayTab = ({ 
  businessData,
  tavarPayLoading,
  tavarPayError,
  merchantDetails,
  isFinixConfigured,
  handleStartOnboarding,
  handleGenerateNewLink,
  handleCheckStatus,
  getStatusBadge,
  styles 
}) => {
  if (!businessData) return null;

  const hasStarted = businessData.finix_onboarding_form_id;
  const isApproved = businessData.finix_onboarding_status === 'APPROVED' || merchantDetails?.onboardingState === 'APPROVED';
  const linkExpired = businessData.finix_onboarding_expires_at && new Date(businessData.finix_onboarding_expires_at) < new Date();

  return (
    <div style={styles.section}>
      <div style={styles.tavariPayHeader}>
        <div>
          <h3 style={styles.sectionTitle}>Tavari Pay - Payment Processing</h3>
          <p style={styles.subtitle}>
            Enable payment processing powered by Finix to accept credit cards, debit cards, and ACH payments.
          </p>
        </div>
        {hasStarted && (
          <div>
            {getStatusBadge(businessData.finix_onboarding_status || 'NOT_STARTED')}
          </div>
        )}
      </div>

      {tavarPayError && (
        <div style={styles.errorBanner}>
          {tavarPayError}
        </div>
      )}

      {!isFinixConfigured() && (
        <div style={styles.warningBanner}>
          ⚠️ Finix API is not configured. Please add your API credentials to the .env file.
        </div>
      )}

      {!hasStarted ? (
        // Not started yet
        <div style={styles.onboardingCard}>
          <h4 style={{ marginTop: 0 }}>Get Started with Tavari Pay</h4>
          <p>To start accepting payments, you'll need to complete merchant onboarding with our payment processor.</p>
          
          <div style={styles.featureList}>
            <div style={styles.featureItem}>✓ Accept credit and debit cards</div>
            <div style={styles.featureItem}>✓ Process ACH bank transfers</div>
            <div style={styles.featureItem}>✓ Manage subscriptions and recurring billing</div>
            <div style={styles.featureItem}>✓ PCI-compliant payment processing</div>
            <div style={styles.featureItem}>✓ Next-day settlement to your bank account</div>
          </div>

          <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '20px' }}>
            The onboarding process takes about 5-10 minutes and requires basic business information.
          </p>

          <button
            onClick={handleStartOnboarding}
            disabled={tavarPayLoading || !isFinixConfigured()}
            style={styles.primaryButton}
          >
            {tavarPayLoading ? 'Loading...' : 'Start Onboarding Process'}
          </button>
        </div>
      ) : isApproved ? (
        // Approved - show merchant details
        <div style={styles.approvedCard}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontSize: '48px' }}>✓</div>
            <h4 style={{ color: '#059669', margin: '10px 0' }}>Tavari Pay is Active!</h4>
            <p style={{ color: '#6b7280' }}>Your business is approved and ready to accept payments</p>
          </div>

          {merchantDetails && (
            <div style={styles.detailsGrid}>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Merchant ID</div>
                <div style={styles.detailValue}>{merchantDetails.merchantId}</div>
              </div>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Processing Status</div>
                <div style={styles.detailValue}>
                  {merchantDetails.processingEnabled ? '✓ Enabled' : '✗ Disabled'}
                </div>
              </div>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Settlement Status</div>
                <div style={styles.detailValue}>
                  {merchantDetails.settlementEnabled ? '✓ Enabled' : '✗ Disabled'}
                </div>
              </div>
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Processor</div>
                <div style={styles.detailValue}>{merchantDetails.processor}</div>
              </div>
            </div>
          )}

          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <button
              onClick={handleCheckStatus}
              disabled={tavarPayLoading}
              style={styles.secondaryButton}
            >
              {tavarPayLoading ? 'Checking...' : 'Refresh Status'}
            </button>
          </div>
        </div>
      ) : (
        // In progress
        <div style={styles.onboardingCard}>
          <h4 style={{ marginTop: 0 }}>Onboarding Status</h4>
          
          <div style={{ marginBottom: '20px' }}>
            <div style={styles.detailItem}>
              <div style={styles.detailLabel}>Current Status</div>
              <div>{getStatusBadge(businessData.finix_onboarding_status)}</div>
            </div>

            {businessData.finix_onboarding_form_id && (
              <div style={styles.detailItem}>
                <div style={styles.detailLabel}>Form ID</div>
                <div style={styles.detailValue}>{businessData.finix_onboarding_form_id}</div>
              </div>
            )}
          </div>

          {businessData.finix_onboarding_status === 'INCOMPLETE' || businessData.finix_onboarding_status === 'IN_PROGRESS' ? (
            <div>
              <p>You can continue your onboarding where you left off:</p>
              {linkExpired ? (
                <button
                  onClick={handleGenerateNewLink}
                  disabled={tavarPayLoading}
                  style={styles.primaryButton}
                >
                  {tavarPayLoading ? 'Generating...' : 'Generate New Onboarding Link'}
                </button>
              ) : (
                <button
                  onClick={() => window.location.href = businessData.finix_onboarding_link_url}
                  disabled={!businessData.finix_onboarding_link_url}
                  style={styles.primaryButton}
                >
                  Continue Onboarding
                </button>
              )}
            </div>
          ) : businessData.finix_onboarding_status === 'UPDATE_REQUESTED' ? (
            <div>
              <div style={styles.warningBanner}>
                ⚠️ Additional information is required. Please complete the onboarding form.
              </div>
              {linkExpired ? (
                <button
                  onClick={handleGenerateNewLink}
                  disabled={tavarPayLoading}
                  style={styles.primaryButton}
                >
                  {tavarPayLoading ? 'Generating...' : 'Generate New Link'}
                </button>
              ) : (
                <button
                  onClick={() => window.location.href = businessData.finix_onboarding_link_url}
                  disabled={!businessData.finix_onboarding_link_url}
                  style={styles.primaryButton}
                >
                  Update Information
                </button>
              )}
            </div>
          ) : businessData.finix_onboarding_status === 'COMPLETED' ? (
            <div>
              <p>Your onboarding is complete and under review. This usually takes just a few minutes.</p>
              <button
                onClick={handleCheckStatus}
                disabled={tavarPayLoading}
                style={styles.secondaryButton}
              >
                {tavarPayLoading ? 'Checking...' : 'Check Approval Status'}
              </button>
            </div>
          ) : businessData.finix_onboarding_status === 'REJECTED' ? (
            <div>
              <div style={styles.errorBanner}>
                Your application was not approved. Please contact support for more information.
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default TavariPayTab;
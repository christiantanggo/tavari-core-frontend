import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Public privacy notice for the Reputation module (feedback / review funnel).
 * Not a substitute for counsel-reviewed policy; businesses may replace with their own URL in settings.
 */
export default function ReputationLegalPrivacy() {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: TavariStyles.spacing['2xl'],
        fontFamily: TavariStyles.typography.fontFamily,
        color: TavariStyles.colors.gray800,
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ marginTop: 0, fontSize: TavariStyles.typography.fontSize['3xl'], color: TavariStyles.colors.gray900 }}>
        Privacy — reputation feedback
      </h1>
      <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
        Last updated: April 2026 · Tavari
      </p>
      <p>
        When you submit a star rating or optional comment through this page, your responses are processed by{' '}
        <strong>Tavari</strong> on behalf of the business you visited. Information may include the rating, any text you
        provide, and technical data needed to operate the service (such as a session reference for anonymous links).
      </p>
      <p>
        If your rating meets the threshold the business configured, you may be offered a link to leave a public review
        on Google or another platform. That platform&apos;s privacy policy applies there.
      </p>
      <p>
        For questions about how a specific venue handles personal information, contact them directly. For Tavari product
        questions, contact your venue or Tavari support.
      </p>
      <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500 }}>
        This page is a general notice only and does not constitute legal advice. Businesses may supply their own privacy
        policy URL in Tavari settings.
      </p>
    </div>
  );
}

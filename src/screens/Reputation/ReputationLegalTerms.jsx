import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Public terms notice for the Reputation module (feedback / review funnel).
 */
export default function ReputationLegalTerms() {
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
        Terms — reputation feedback
      </h1>
      <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
        Last updated: April 2026 · Tavari
      </p>
      <p>
        By submitting feedback through this Tavari reputation flow, you agree that your rating and comments may be
        shared with the business you visited and used to improve their service. Do not include sensitive personal data
        unless you are comfortable with the business receiving it.
      </p>
      <p>
        Public reviews on third-party sites (for example Google) are governed by those platforms&apos; terms and
        policies.
      </p>
      <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500 }}>
        This summary is for clarity only and is not a substitute for venue-specific terms or legal advice. Businesses
        may display their own terms URL in Tavari settings.
      </p>
    </div>
  );
}

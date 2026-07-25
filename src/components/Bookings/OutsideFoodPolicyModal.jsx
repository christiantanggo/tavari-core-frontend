import React from 'react';
import { FiAlertCircle } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Shown before customers choose an included food package during portal checkout.
 */
export default function OutsideFoodPolicyModal({ open, onAccept }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        zIndex: 210,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="outside-food-policy-title"
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          maxWidth: 520,
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FiAlertCircle size={20} />
          </div>
          <div>
            <h2
              id="outside-food-policy-title"
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: TavariStyles.colors.gray900,
              }}
            >
              No Outside Food or Drink Policy
            </h2>
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
              Please read before choosing your included food package
            </div>
          </div>
        </div>

        <div
          style={{
            padding: '20px 24px',
            fontSize: 14,
            color: TavariStyles.colors.gray700,
            lineHeight: 1.6,
          }}
        >
          <p style={{ margin: '0 0 12px' }}>
            No outside food or drink is permitted within the facility. The{' '}
            <strong>only exception</strong> is a cake or cupcakes, and only when you have a booked
            party room — outside cake or cupcakes are not permitted elsewhere in the facility.
          </p>
          <p style={{ margin: '0 0 12px' }}>
            Any cake or cupcakes brought for a party must come with the{' '}
            <strong>store receipt</strong> so we can provide it to the Middlesex-London Health Unit
            for tracking if someone becomes ill.
          </p>
          <p style={{ margin: 0 }}>
            This means <strong>no other food whatsoever</strong> may be brought in — including cake
            pops, donuts, candy, snacks, beverages, etc. from outside the facility.
          </p>        </div>

        <div
          style={{
            padding: '16px 24px 24px',
            borderTop: `1px solid ${TavariStyles.colors.gray200}`,
          }}
        >
          <button
            type="button"
            onClick={onAccept}
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: TavariStyles.colors.primary,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            I accept the &ldquo;No Outside Food or Drink Policy&rdquo;
          </button>
        </div>
      </div>
    </div>
  );
}

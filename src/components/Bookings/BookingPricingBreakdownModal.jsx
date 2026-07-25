import React, { useMemo } from 'react';
import { FiX } from 'react-icons/fi';
import { buildBookingPrintChargeLines } from '../../helpers/Bookings/bookingPrint';
import {
  formatBookingMoney,
  getEffectiveBookingPricingSummary,
  sumCompletedDepositPayments,
} from '../../utils/bookingPricing';
import { TavariStyles } from '../../utils/TavariStyles';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 20000,
  backgroundColor: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const cardStyle = {
  background: TavariStyles.colors.white,
  borderRadius: 12,
  maxWidth: 480,
  width: '100%',
  maxHeight: '90vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
};

const summaryRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 14,
  lineHeight: 1.45,
};

function SummaryRow({ label, value, amount = null, bold = false, highlight = null }) {
  const numericAmount = Number.isFinite(amount) ? amount : null;
  const color = highlight === 'due' && numericAmount != null && numericAmount > 0
    ? '#b45309'
    : highlight === 'paid'
      ? '#166534'
      : TavariStyles.colors.gray900;

  return (
    <div style={{
      ...summaryRowStyle,
      fontWeight: bold ? 700 : 400,
      color: bold ? TavariStyles.colors.gray900 : TavariStyles.colors.gray700,
      paddingTop: bold ? 4 : 0,
    }}
    >
      <span style={bold ? { fontWeight: 700 } : undefined}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: bold || highlight ? color : TavariStyles.colors.gray900 }}>
        {value}
      </span>
    </div>
  );
}

export default function BookingPricingBreakdownModal({
  open,
  booking = null,
  pricing: pricingProp = null,
  requiredDepositAmount = 0,
  onClose,
}) {
  const pricing = useMemo(() => {
    if (pricingProp) return pricingProp;
    if (!booking) return null;
    return getEffectiveBookingPricingSummary(booking);
  }, [booking, pricingProp]);

  const lineItems = useMemo(() => {
    if (!booking || !pricing) return [];
    return buildBookingPrintChargeLines(booking, pricing);
  }, [booking, pricing]);

  const depositPaid = useMemo(
    () => (booking ? sumCompletedDepositPayments(booking) : 0),
    [booking],
  );

  if (!open || !booking || !pricing) return null;

  const balanceDue = pricing.totalDue ?? 0;
  const showRequiredDeposit = requiredDepositAmount > 0;
  const showDepositPaid = depositPaid > 0 || showRequiredDeposit;

  return (
    <div style={overlayStyle} role="presentation" onClick={() => onClose?.()}>
      <div
        style={cardStyle}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-pricing-breakdown-title"
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
        }}
        >
          <div>
            <h3 id="booking-pricing-breakdown-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Price breakdown
            </h3>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              Itemized charges for this booking
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: TavariStyles.colors.gray500,
              padding: 4,
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'grid', gap: 16 }}>
          <div>
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: TavariStyles.colors.gray500,
              marginBottom: 8,
            }}
            >
              Line items
            </div>
            {lineItems.length > 0 ? (
              <div style={{
                border: `1px solid ${TavariStyles.colors.gray200}`,
                borderRadius: 8,
                overflow: 'hidden',
              }}
              >
                {lineItems.map((line, index) => (
                  <div
                    key={`${line.label}-${index}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 12px',
                      fontSize: 14,
                      lineHeight: 1.45,
                      borderTop: index > 0 ? `1px solid ${TavariStyles.colors.gray100}` : 'none',
                      backgroundColor: index % 2 === 0 ? '#fff' : '#f9fafb',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: TavariStyles.colors.gray900 }}>{line.label}</div>
                      {line.detail ? (
                        <div style={{ fontSize: 13, color: TavariStyles.colors.gray500, marginTop: 2 }}>
                          {line.detail}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ fontWeight: 600, color: TavariStyles.colors.gray900, flexShrink: 0 }}>
                      {formatBookingMoney(line.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: '12px 14px',
                borderRadius: 8,
                backgroundColor: '#f9fafb',
                border: `1px solid ${TavariStyles.colors.gray200}`,
                fontSize: 13,
                color: TavariStyles.colors.gray600,
              }}
              >
                No itemized charges recorded. Totals below reflect the booking summary.
              </div>
            )}
          </div>

          <div style={{
            padding: '14px 16px',
            borderRadius: 8,
            backgroundColor: '#f9fafb',
            border: `1px solid ${TavariStyles.colors.gray200}`,
            display: 'grid',
            gap: 8,
          }}
          >
            <SummaryRow label="Subtotal" value={formatBookingMoney(pricing.subtotal)} amount={pricing.subtotal} />
            <SummaryRow label="Taxes" value={formatBookingMoney(pricing.taxAmount)} amount={pricing.taxAmount} />
            <div style={{ borderTop: '1px solid #e5e7eb', margin: '4px 0', paddingTop: 8 }}>
              <SummaryRow label="Total" value={formatBookingMoney(pricing.totalPrice)} amount={pricing.totalPrice} bold />
            </div>
            {showRequiredDeposit ? (
              <SummaryRow
                label="Required deposit"
                value={formatBookingMoney(requiredDepositAmount)}
                amount={requiredDepositAmount}
              />
            ) : null}
            {showDepositPaid ? (
              <SummaryRow
                label="Deposit paid"
                value={formatBookingMoney(depositPaid)}
                amount={depositPaid}
                highlight="paid"
              />
            ) : null}
            <SummaryRow
              label="Total paid"
              value={formatBookingMoney(pricing.totalPaid)}
              amount={pricing.totalPaid}
              highlight="paid"
            />
            <div style={{ borderTop: '1px solid #e5e7eb', margin: '4px 0', paddingTop: 8 }}>
              <SummaryRow
                label="Balance due"
                value={formatBookingMoney(balanceDue)}
                amount={balanceDue}
                bold
                highlight="due"
              />
            </div>
          </div>
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
        >
          <button
            type="button"
            onClick={() => onClose?.()}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: `1px solid ${TavariStyles.colors.gray300}`,
              background: TavariStyles.colors.white,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

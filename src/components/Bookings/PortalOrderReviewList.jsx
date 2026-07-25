import React from 'react';
import { FiEdit2, FiTrash2 } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Clean order summary for checkout / booking review — names and prices only,
 * with optional edit and remove actions.
 */
export default function PortalOrderReviewList({
  lines = [],
  title = 'Your order',
  onRemove,
  onEdit,
  readOnly = false,
}) {
  if (!lines.length) return null;

  const showActions = !readOnly && (onRemove || onEdit);

  const formatLinePrice = (row) => {
    if (row.included_quantity > 0 && row.total_price === 0) return 'Included';
    if (row.included_quantity > 0 && row.paid_quantity > 0) {
      return `$${row.total_price.toFixed(2)} (${row.included_quantity} included)`;
    }
    return `$${row.total_price.toFixed(2)}`;
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 8,
          color: TavariStyles.colors.gray900,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.map((row) => (
          <div
            key={row.option_id}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              backgroundColor: 'white',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {row.group_name ? (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: TavariStyles.colors.gray500,
                      marginBottom: 2,
                    }}
                  >
                    {row.group_name}
                  </div>
                ) : null}
                <div style={{ fontSize: 13, color: TavariStyles.colors.gray900, fontWeight: 500 }}>
                  {row.label}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color:
                      row.total_price === 0 && row.included_quantity > 0
                        ? TavariStyles.colors.gray500
                        : TavariStyles.colors.gray900,
                  }}
                >
                  {formatLinePrice(row)}
                </span>
                {showActions ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {onEdit && row.can_edit !== false ? (
                      <button
                        type="button"
                        onClick={() => onEdit(row.group_id, row.option_id)}
                        title="Edit"
                        aria-label={`Edit ${row.name}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 28,
                          height: 28,
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          borderRadius: 6,
                          background: 'white',
                          cursor: 'pointer',
                          color: TavariStyles.colors.gray700,
                        }}
                      >
                        <FiEdit2 size={14} />
                      </button>
                    ) : null}
                    {onRemove && row.can_remove ? (
                      <button
                        type="button"
                        onClick={() => onRemove(row.option_id)}
                        title="Remove"
                        aria-label={`Remove ${row.name}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 28,
                          height: 28,
                          border: '1px solid #fecaca',
                          borderRadius: 6,
                          background: '#fef2f2',
                          cursor: 'pointer',
                          color: '#b91c1c',
                        }}
                      >
                        <FiTrash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {row.bundle_component_details?.length > 0 ? (
              <div
                style={{
                  marginTop: 6,
                  paddingLeft: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {row.bundle_component_details.map((line) => (
                  <div
                    key={`${row.option_id}-detail-${line}`}
                    style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
            {row.bundle_includes?.length > 0 ? (
              <div
                style={{
                  marginTop: 6,
                  paddingLeft: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {row.bundle_includes.map((line) => (
                  <div
                    key={`${row.option_id}-${line}`}
                    style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

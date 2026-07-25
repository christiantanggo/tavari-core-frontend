import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { computeLineSubtotal } from '../../utils/invoiceCalculations';
import InvoiceInventoryPicker from './InvoiceInventoryPicker';

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

function parseQuantity(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

export default function InvoiceLineItemsEditor({
  businessId,
  lines,
  onChange,
  readOnly = false,
  taxSummary = null,
}) {
  const updateLine = (index, patch) => {
    const next = lines.map((line, i) => {
      if (i !== index) return line;
      const merged = { ...line, ...patch };
      if (patch.quantity !== undefined) {
        merged.quantity = parseQuantity(patch.quantity, line.quantity || 1);
      }
      merged.total_price = computeLineSubtotal(merged);
      return merged;
    });
    onChange(next);
  };

  const adjustQuantity = (index, delta) => {
    const line = lines[index];
    const current = parseQuantity(line.quantity, 1);
    const nextQty = Math.max(1, Math.round((current + delta) * 1000) / 1000);
    updateLine(index, { quantity: nextQty });
  };

  const removeLine = (index) => {
    onChange(lines.filter((_, i) => i !== index));
  };

  const addCustomLine = () => {
    onChange([
      ...lines,
      {
        clientId: `custom-${Date.now()}`,
        line_type: 'custom',
        name: '',
        quantity: 1,
        unit_price: 0,
        total_price: 0,
        tax_exempt: false,
      },
    ]);
  };

  const addInventoryItems = (items) => {
    const next = [...lines];
    items.forEach((item) => {
      const existingIndex = next.findIndex(
        (line) => line.inventory_id === item.id && line.line_type !== 'custom'
      );
      if (existingIndex >= 0) {
        const existing = next[existingIndex];
        const qty = parseQuantity(existing.quantity, 1) + 1;
        next[existingIndex] = {
          ...existing,
          quantity: qty,
          total_price: computeLineSubtotal({ ...existing, quantity: qty }),
        };
      } else {
        next.push({
          clientId: `inv-${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          line_type: item.is_bundle ? 'bundle' : 'inventory',
          inventory_id: item.id,
          category_id: item.category_id,
          name: item.name,
          quantity: 1,
          unit_price: Number(item.price) || 0,
          total_price: Number(item.price) || 0,
          tax_exempt: false,
        });
      }
    });
    onChange(next);
  };

  return (
    <div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <button type="button" onClick={addCustomLine} style={actionBtnStyle}>
            <Plus size={16} /> Custom line
          </button>
          <InvoiceInventoryPicker
            businessId={businessId}
            onAddItems={addInventoryItems}
          />
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f9fafb' }}>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}>Unit $</th>
              <th style={thStyle}>Tax exempt</th>
              <th style={thStyle}>Line total</th>
              {!readOnly && <th style={thStyle} />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 5 : 6} style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
                  No line items yet. Add inventory or a custom line.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => (
                <tr key={line.clientId || line.id || index}>
                  <td style={tdStyle}>
                    {readOnly ? (
                      <>
                        <div style={{ fontWeight: 600 }}>{line.name}</div>
                        {line.participant_name && (
                          <div style={{ fontSize: '13px', color: '#6b7280' }}>{line.participant_name}</div>
                        )}
                      </>
                    ) : (
                      <input
                        style={inputStyle}
                        value={line.name}
                        onChange={(e) => updateLine(index, { name: e.target.value })}
                      />
                    )}
                  </td>
                  <td style={tdStyle}>
                    {readOnly ? (
                      line.quantity
                    ) : (
                      <div style={qtyControlStyle}>
                        <button
                          type="button"
                          onClick={() => adjustQuantity(index, -1)}
                          disabled={parseQuantity(line.quantity, 1) <= 1}
                          style={{
                            ...qtyBtnStyle,
                            opacity: parseQuantity(line.quantity, 1) <= 1 ? 0.4 : 1,
                          }}
                          aria-label="Decrease quantity"
                        >
                          <Minus size={14} />
                        </button>
                        <input
                          style={qtyInputStyle}
                          type="number"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => adjustQuantity(index, 1)}
                          style={qtyBtnStyle}
                          aria-label="Increase quantity"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {readOnly ? (
                      `$${Number(line.unit_price || 0).toFixed(2)}`
                    ) : (
                      <input
                        style={{
                          ...inputStyle,
                          width: '96px',
                        }}
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unit_price}
                        onChange={(e) => updateLine(index, { unit_price: e.target.value })}
                      />
                    )}
                  </td>
                  <td style={tdStyle}>
                    <TavariCheckbox
                      checked={!!line.tax_exempt}
                      disabled={readOnly}
                      onChange={(checked) => updateLine(index, { tax_exempt: checked })}
                      label=""
                    />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    ${Number(line.total_price ?? computeLineSubtotal(line)).toFixed(2)}
                  </td>
                  {!readOnly && (
                    <td style={tdStyle}>
                      <button type="button" onClick={() => removeLine(index)} style={iconBtnStyle}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {taxSummary && (
        <div style={{
          marginTop: '16px',
          maxWidth: '280px',
          marginLeft: 'auto',
          fontSize: '14px',
        }}>
          <div style={totalRowStyle}>
            <span>Subtotal</span>
            <span>${Number(taxSummary.subtotal || 0).toFixed(2)}</span>
          </div>
          {Object.entries(taxSummary.aggregatedTaxes || {}).map(([name, amount]) => (
            <div key={name} style={totalRowStyle}>
              <span>{name}</span>
              <span>${Number(amount).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ ...totalRowStyle, fontWeight: 700, borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
            <span>Total</span>
            <span>${Number(taxSummary.total || 0).toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const actionBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  backgroundColor: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '14px',
};

const thStyle = { textAlign: 'left', padding: '10px 8px', fontSize: '13px', color: '#6b7280' };
const tdStyle = { padding: '8px', verticalAlign: 'middle' };
const iconBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#dc2626',
  padding: '4px',
};
const totalRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0',
};

const qtyControlStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

const qtyBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  backgroundColor: '#fff',
  cursor: 'pointer',
  color: '#374151',
};

const qtyInputStyle = {
  width: '56px',
  padding: '6px 4px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '14px',
  textAlign: 'center',
  boxSizing: 'border-box',
};

import React, { useMemo } from 'react';
import TavariCheckbox from '../UI/TavariCheckbox';
import FormEscalationPanel from '../Forms/FormEscalationPanel';
import { getIncorrectAnswerMessage, getOutOfRangeMessage, YES_NO_OPTIONS } from '../../utils/formsFieldValidation';

const fieldWrap = { marginBottom: 28, paddingBottom: 4 };
const labelStyle = { display: 'block', fontWeight: 700, marginBottom: 6, color: '#374151' };
const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  border: '1px solid #d1d5db',
  borderRadius: 10,
  fontSize: 16,
  boxSizing: 'border-box'
};
const hintStyle = { margin: '4px 0 0', fontSize: 13, color: '#6b7280' };
const errorStyle = { margin: '4px 0 0', fontSize: 13, color: '#b91c1c' };
const warningStyle = { margin: '6px 0 0', fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' };

/**
 * Operational form renderer (Forms module). NOT for waivers.
 */
const OperationalFormRenderer = ({
  fields = [],
  values = {},
  errors = {},
  onChange,
  disabled = false,
  reviewFieldKeys = [],
  escalations = {},
  onEscalationChange,
  businessId = '',
  uploadSessionId = ''
}) => {
  const reviewKeys = useMemo(() => new Set(reviewFieldKeys), [reviewFieldKeys]);

  return (
    <div>
      {fields.map((field) => {
        const key = field.field_key;
        const rules = field.validation_rules || {};
        const unit = rules.unit || field.field_options?.unit || '';
        const err = errors[key];
        const needsEscalation = reviewKeys.has(key);

        let fieldNode = null;

        if (field.field_type === 'checkbox') {
          fieldNode = (
            <div key={field.id || key} style={fieldWrap}>
              <TavariCheckbox
                label={field.field_label}
                checked={!!values[key]}
                onChange={(checked) => onChange(key, checked)}
                disabled={disabled}
              />
              {err && <p style={errorStyle}>{err}</p>}
            </div>
          );
        } else if (field.field_type === 'yes_no') {
          const current = values[key] || '';
          const answerWarning = getIncorrectAnswerMessage(field.field_label, current, rules);
          fieldNode = (
            <div key={field.id || key} style={fieldWrap}>
              <label>
                <span style={labelStyle}>
                  {field.field_label}
                  {field.is_required ? ' *' : ''}
                </span>
                <select
                  style={inputStyle}
                  value={current}
                  disabled={disabled}
                  onChange={(e) => onChange(key, e.target.value)}
                >
                  <option value="">Select…</option>
                  {YES_NO_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {answerWarning && <p style={warningStyle}>{answerWarning}</p>}
              {err && <p style={errorStyle}>{err}</p>}
            </div>
          );
        } else if (field.field_type === 'textarea') {
          fieldNode = (
            <label key={field.id || key} style={fieldWrap}>
              <span style={labelStyle}>
                {field.field_label}
                {field.is_required ? ' *' : ''}
              </span>
              <textarea
                style={{ ...inputStyle, minHeight: 90 }}
                value={values[key] || ''}
                disabled={disabled}
                onChange={(e) => onChange(key, e.target.value)}
              />
              {err && <p style={errorStyle}>{err}</p>}
            </label>
          );
        } else if (field.field_type === 'select') {
          const options = field.field_options?.options || [];
          fieldNode = (
            <label key={field.id || key} style={fieldWrap}>
              <span style={labelStyle}>
                {field.field_label}
                {field.is_required ? ' *' : ''}
              </span>
              <select
                style={inputStyle}
                value={values[key] || ''}
                disabled={disabled}
                onChange={(e) => onChange(key, e.target.value)}
              >
                <option value="">Select…</option>
                {options.map((opt) => (
                  <option key={opt.value || opt} value={opt.value || opt}>
                    {opt.label || opt}
                  </option>
                ))}
              </select>
              {err && <p style={errorStyle}>{err}</p>}
            </label>
          );
        } else if (field.field_type === 'number') {
          const rangeWarning = getOutOfRangeMessage(field.field_label, values[key], rules);
          fieldNode = (
            <label key={field.id || key} style={fieldWrap}>
              <span style={labelStyle}>
                {field.field_label}
                {unit ? ` (${unit})` : ''}
                {field.is_required ? ' *' : ''}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                style={inputStyle}
                value={values[key] ?? ''}
                disabled={disabled}
                onChange={(e) => onChange(key, e.target.value)}
              />
              {(rules.min != null || rules.max != null) && (
                <p style={hintStyle}>
                  Acceptable range:
                  {rules.min != null ? ` ${rules.min}` : ''}
                  {rules.min != null && rules.max != null ? ' –' : ''}
                  {rules.max != null ? ` ${rules.max}` : ''}
                  {unit ? ` ${unit}` : ''}
                </p>
              )}
              {rangeWarning && <p style={warningStyle}>{rangeWarning}</p>}
              {err && <p style={errorStyle}>{err}</p>}
            </label>
          );
        } else {
          fieldNode = (
            <label key={field.id || key} style={fieldWrap}>
              <span style={labelStyle}>
                {field.field_label}
                {field.is_required ? ' *' : ''}
              </span>
              <input
                type="text"
                style={inputStyle}
                value={values[key] || ''}
                disabled={disabled}
                onChange={(e) => onChange(key, e.target.value)}
              />
              {err && <p style={errorStyle}>{err}</p>}
            </label>
          );
        }

        return (
          <React.Fragment key={field.id || key}>
            {fieldNode}
            {needsEscalation && onEscalationChange && (
              <div style={{ marginTop: -16, marginBottom: 28 }}>
                <FormEscalationPanel
                  fieldLabel={field.field_label}
                  value={escalations[key]}
                  onChange={(next) => onEscalationChange(key, next)}
                  businessId={businessId}
                  uploadSessionId={uploadSessionId}
                  disabled={disabled}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default OperationalFormRenderer;

/** Client-side review checks for Tavari Forms fields. */

export const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'na', label: 'N/A' }
];

export const formatYesNoValue = (value) => {
  const match = YES_NO_OPTIONS.find((option) => option.value === String(value || '').toLowerCase());
  return match?.label || value || '—';
};

export const isNumberOutOfRange = (value, rules = {}) => {
  if (value === '' || value == null) return false;
  const num = Number(value);
  if (Number.isNaN(num)) return false;
  const min = rules.min != null && rules.min !== '' ? Number(rules.min) : null;
  const max = rules.max != null && rules.max !== '' ? Number(rules.max) : null;
  if (min != null && !Number.isNaN(min) && num < min) return true;
  if (max != null && !Number.isNaN(max) && num > max) return true;
  return false;
};

export const isYesNoIncorrect = (value, rules = {}) => {
  const expected = rules.correct_answer;
  if (!expected || value == null || value === '') return false;
  return String(value).toLowerCase() !== String(expected).toLowerCase();
};

export const getOutOfRangeMessage = (fieldLabel, value, rules = {}) => {
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  const min = rules.min != null && rules.min !== '' ? Number(rules.min) : null;
  const max = rules.max != null && rules.max !== '' ? Number(rules.max) : null;
  const unit = rules.unit ? ` ${rules.unit}` : '';

  if (min != null && !Number.isNaN(min) && num < min) {
    return `${fieldLabel} is below the acceptable minimum (${min}${unit}). Your reading will still be saved and flagged for review.`;
  }
  if (max != null && !Number.isNaN(max) && num > max) {
    return `${fieldLabel} is above the acceptable maximum (${max}${unit}). Your reading will still be saved and flagged for review.`;
  }
  return null;
};

export const getIncorrectAnswerMessage = (fieldLabel, value, rules = {}) => {
  if (!isYesNoIncorrect(value, rules)) return null;
  return `${fieldLabel}: expected ${formatYesNoValue(rules.correct_answer)} but got ${formatYesNoValue(value)}. Your answer will still be saved and flagged for review.`;
};

export const getOutOfRangeFields = (fields = [], values = {}) =>
  fields
    .map((field) => {
      const rules = field.validation_rules || {};
      const value = values[field.field_key];

      if (field.field_type === 'number' && isNumberOutOfRange(value, rules)) {
        return {
          key: field.field_key,
          label: field.field_label,
          message: getOutOfRangeMessage(field.field_label, value, rules)
        };
      }

      if (field.field_type === 'yes_no' && isYesNoIncorrect(value, rules)) {
        return {
          key: field.field_key,
          label: field.field_label,
          message: getIncorrectAnswerMessage(field.field_label, value, rules)
        };
      }

      return null;
    })
    .filter(Boolean);

// Step 69: Create waiverFormBuilder.js
// Dynamic form builder for waiver fields
import React from 'react';

/**
 * Render waiver field based on field configuration
 */
export const renderWaiverField = (field, value, onChange, errors = {}) => {
  const fieldId = `waiver-field-${field.id}`;
  const error = errors[field.field_key];

  switch (field.field_type) {
    case 'text':
      return (
        <div key={field.id} className="waiver-field">
          <label htmlFor={fieldId}>
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          <input
            type="text"
            id={fieldId}
            value={value || ''}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            required={field.is_required}
            className={error ? 'error' : ''}
          />
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    case 'textarea':
      return (
        <div key={field.id} className="waiver-field">
          <label htmlFor={fieldId}>
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          <textarea
            id={fieldId}
            value={value || ''}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            required={field.is_required}
            className={error ? 'error' : ''}
          />
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    case 'date':
      // Fix timezone issue - ensure date is displayed in local timezone
      const formatDateForInput = (dateValue) => {
        if (!dateValue) return '';
        // If it's already in YYYY-MM-DD format, return as is
        if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
          return dateValue;
        }
        // Otherwise, parse and format in local timezone
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return '';
        // Get local date components to avoid timezone issues
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      return (
        <div key={field.id} className="waiver-field">
          <label htmlFor={fieldId}>
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          <input
            type="date"
            id={fieldId}
            value={formatDateForInput(value)}
            onChange={(e) => {
              // Store date as YYYY-MM-DD string to avoid timezone issues
              onChange(field.field_key, e.target.value);
            }}
            required={field.is_required}
            className={error ? 'error' : ''}
          />
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    case 'phone':
      return (
        <div key={field.id} className="waiver-field">
          <label htmlFor={fieldId}>
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          <input
            type="tel"
            id={fieldId}
            value={value || ''}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            required={field.is_required}
            className={error ? 'error' : ''}
          />
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    case 'email':
      return (
        <div key={field.id} className="waiver-field">
          <label htmlFor={fieldId}>
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          <input
            type="email"
            id={fieldId}
            value={value || ''}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            required={field.is_required}
            className={error ? 'error' : ''}
          />
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    case 'checkbox':
      return (
        <div key={field.id} className="waiver-field">
          <label>
            <input
              type="checkbox"
              checked={value === 'true' || value === true}
              onChange={(e) => onChange(field.field_key, e.target.checked.toString())}
              required={field.is_required}
              className={error ? 'error' : ''}
            />
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    case 'radio':
      const options = field.field_options?.options || [];
      return (
        <div key={field.id} className="waiver-field">
          <label>
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          {options.map((option, index) => (
            <label key={index}>
              <input
                type="radio"
                name={field.field_key}
                value={option.value}
                checked={value === option.value}
                onChange={(e) => onChange(field.field_key, e.target.value)}
                required={field.is_required}
              />
              {option.label}
            </label>
          ))}
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    case 'select':
      const selectOptions = field.field_options?.options || [];
      return (
        <div key={field.id} className="waiver-field">
          <label htmlFor={fieldId}>
            {field.field_label}
            {field.is_required && <span className="required">*</span>}
          </label>
          <select
            id={fieldId}
            value={value || ''}
            onChange={(e) => onChange(field.field_key, e.target.value)}
            required={field.is_required}
            className={error ? 'error' : ''}
          >
            <option value="">Select...</option>
            {selectOptions.map((option, index) => (
              <option key={index} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {error && <span className="error-message">{error}</span>}
        </div>
      );

    default:
      return null;
  }
};

/**
 * Validate waiver form
 */
export const validateWaiverForm = async (fields, formData, validateFieldResponse) => {
  const errors = {};

  for (const field of fields) {
    const value = formData[field.field_key];

    // Check required fields
    if (field.is_required && (!value || value.trim() === '')) {
      errors[field.field_key] = `${field.field_label} is required`;
      continue;
    }

    // Validate field response if validator provided
    if (validateFieldResponse && value) {
      const isValid = await validateFieldResponse(field.id, value);
      if (!isValid) {
        errors[field.field_key] = `Invalid ${field.field_label}`;
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
};

/**
 * Get field value from form data
 */
export const getFieldValue = (formData, fieldKey) => {
  return formData[fieldKey] || '';
};

/**
 * Set field value in form data
 */
export const setFieldValue = (formData, fieldKey, value) => {
  return {
    ...formData,
    [fieldKey]: value
  };
};


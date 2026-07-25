// Step 63: Create waiverConstants.js
// Constants for Waivers module

export const WAIVER_STATUSES = {
  VALID: 'valid',
  EXPIRED: 'expired',
  INVALID: 'invalid',
  PENDING: 'pending',
  SIGNED: 'signed'
};

export const PARTICIPANT_TYPES = {
  PRIMARY: 'primary',
  GUARDIAN: 'guardian',
  ADDITIONAL_ADULT: 'additional_adult',
  MINOR: 'minor'
};

export const CONSENT_TYPES = {
  MARKETING: 'marketing',
  PHOTOGRAPHY: 'photography',
  MEDICAL: 'medical',
  OTHER: 'other'
};

export const FIELD_TYPES = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  DATE: 'date',
  PHONE: 'phone',
  EMAIL: 'email',
  CHECKBOX: 'checkbox',
  RADIO: 'radio',
  SELECT: 'select'
};

export const SIGNATURE_TYPES = {
  DIGITAL: 'digital',
  GUARDIAN: 'guardian',
  PAPER: 'paper'
};

export const UPLOAD_TYPES = {
  PAPER_WAIVER: 'paper_waiver',
  PHOTO: 'photo',
  SCAN: 'scan'
};

export const WAIVER_ACTIONS = {
  CREATED: 'waiver.created',
  SIGNED: 'waiver.signed',
  EXPIRED: 'waiver.expired',
  VIEWED: 'waiver.viewed',
  DOWNLOADED: 'waiver.downloaded',
  UPLOADED: 'waiver.uploaded'
};

export const DELIVERY_METHODS = {
  EMAIL: 'email',
  SMS: 'sms',
  APP: 'app',
  DOWNLOAD: 'download'
};





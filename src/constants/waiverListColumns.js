/**
 * Column sets for waiver list / search / overview queries.
 * Excludes signature blobs (signature_data, signature_image_url, guardian_*, etc.)
 * so dashboard refresh and search stay fast under load.
 */

export const WAIVER_SIGNATURE_LIST_COLUMNS = [
  'id',
  'business_id',
  'customer_id',
  'template_id',
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'date_of_birth',
  'signed_at',
  'created_at',
  'updated_at',
  'expires_at',
  'is_valid',
  'client_submission_id',
  'archived_at'
].join(', ');

export const WAIVER_SIGNATURE_LIST_TEMPLATE_EMBED = `waiver_templates:template_id (
  id,
  template_name,
  waiver_title,
  minor_age_threshold,
  expiry_days
)`;

/** PostgREST select for overview / getWaivers (no signature blobs). */
export const WAIVER_SIGNATURE_LIST_SELECT = `${WAIVER_SIGNATURE_LIST_COLUMNS}, ${WAIVER_SIGNATURE_LIST_TEMPLATE_EMBED}`;

export const WAIVER_PARTICIPANT_LIST_COLUMNS = [
  'id',
  'waiver_id',
  'participant_type',
  'first_name',
  'last_name',
  'date_of_birth',
  'email',
  'phone_number',
  'updated_at',
  'notes',
  'account_card_style',
  'restrict_check_in'
].join(', ');

/** Legacy imports: omit signature_strokes and large PDF meta JSON from list loads. */
export const LEGACY_WAIVER_LIST_COLUMNS = [
  'id',
  'business_id',
  'customer_id',
  'source_system',
  'legacy_row_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'date_of_birth',
  'notes',
  'info',
  'num_minors',
  'legacy_minors',
  'legacy_waiver_template_id',
  'signed_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'imported_at',
  'external_document_id',
  'imported_pdf_storage_path',
  'imported_pdf_uploaded_at',
  'imported_pdf_sha256',
  'archived_at'
].join(', ');

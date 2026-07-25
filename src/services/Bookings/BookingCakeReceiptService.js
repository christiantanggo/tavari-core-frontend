import { supabase } from '../../supabaseClient';

const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|scr|vbs|msi|dll|com)(\.|$)/i;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
const MAX_BYTES = 10 * 1024 * 1024;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('booking-cake-receipt', { body });
  if (error) throw new Error(error.message || 'Request failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

class BookingCakeReceiptService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  assertFile(file) {
    if (!file?.name) throw new Error('Invalid file');
    if (BLOCKED_EXTENSIONS.test(file.name)) throw new Error('This file type is not allowed');
    const mime = (file.type || '').toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      throw new Error('Upload a JPG, PNG, WEBP, HEIC, or PDF receipt');
    }
    if (file.size > MAX_BYTES) throw new Error('File must be 10 MB or smaller');
  }

  async listForStaff(bookingId) {
    if (!this.businessId) throw new Error('Business ID is required');
    const data = await invoke({
      action: 'list',
      businessId: this.businessId,
      bookingId,
    });
    return data.receipts || [];
  }

  async uploadForStaff(bookingId, file, notes = '') {
    if (!this.businessId) throw new Error('Business ID is required');
    this.assertFile(file);
    const fileBase64 = await readFileAsBase64(file);
    const data = await invoke({
      action: 'upload',
      businessId: this.businessId,
      bookingId,
      fileName: file.name,
      mimeType: file.type,
      fileBase64,
      notes: notes?.trim() || null,
    });
    return data.receipt;
  }

  async deleteForStaff(bookingId, receiptId) {
    if (!this.businessId) throw new Error('Business ID is required');
    await invoke({
      action: 'delete',
      businessId: this.businessId,
      bookingId,
      receiptId,
    });
  }

  async listForCustomer(token) {
    const data = await invoke({ action: 'list', token });
    return data.receipts || [];
  }

  async uploadForCustomer(token, file, notes = '') {
    this.assertFile(file);
    const fileBase64 = await readFileAsBase64(file);
    const data = await invoke({
      action: 'upload',
      token,
      fileName: file.name,
      mimeType: file.type,
      fileBase64,
      notes: notes?.trim() || null,
    });
    return data.receipt;
  }

  async deleteForCustomer(token, receiptId) {
    await invoke({ action: 'delete', token, receiptId });
  }
}

const bookingCakeReceiptService = new BookingCakeReceiptService();
export default bookingCakeReceiptService;

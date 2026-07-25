import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiExternalLink, FiTrash2, FiUpload } from 'react-icons/fi';
import toast from 'react-hot-toast';
import bookingCakeReceiptService from '../../services/Bookings/BookingCakeReceiptService';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateTimeForBusiness } from '../../utils/businessDateFormat';

const cardStyle = {
  backgroundColor: 'white',
  padding: '24px',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
};

const fieldLabelStyle = {
  fontSize: '13px',
  color: TavariStyles.colors.gray600,
  marginBottom: '6px',
  fontWeight: '600',
};

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceLabel(source) {
  return source === 'customer' ? 'Customer upload' : 'Staff upload';
}

export default function CakeReceiptPanel({
  mode = 'staff',
  businessId,
  bookingId,
  token,
  businessTimezone,
  disabled = false,
  compact = false,
}) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [notes, setNotes] = useState('');
  const fileInputRef = useRef(null);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    try {
      let rows = [];
      if (mode === 'customer') {
        if (!token) return;
        rows = await bookingCakeReceiptService.listForCustomer(token);
      } else {
        if (!businessId || !bookingId) return;
        bookingCakeReceiptService.setBusinessId(businessId);
        rows = await bookingCakeReceiptService.listForStaff(bookingId);
      }
      setReceipts(rows || []);
    } catch (err) {
      console.error('Error loading cake receipts:', err);
      toast.error(err.message || 'Could not load cake receipts');
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, [mode, businessId, bookingId, token]);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled) return;

    setUploading(true);
    try {
      if (mode === 'customer') {
        await bookingCakeReceiptService.uploadForCustomer(token, file, notes);
      } else {
        bookingCakeReceiptService.setBusinessId(businessId);
        await bookingCakeReceiptService.uploadForStaff(bookingId, file, notes);
      }
      setNotes('');
      toast.success('Receipt uploaded');
      await loadReceipts();
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (receiptId) => {
    if (disabled) return;
    const confirmed = window.confirm('Remove this cake receipt?');
    if (!confirmed) return;

    setDeletingId(receiptId);
    try {
      if (mode === 'customer') {
        await bookingCakeReceiptService.deleteForCustomer(token, receiptId);
      } else {
        bookingCakeReceiptService.setBusinessId(businessId);
        await bookingCakeReceiptService.deleteForStaff(bookingId, receiptId);
      }
      toast.success('Receipt removed');
      await loadReceipts();
    } catch (err) {
      toast.error(err.message || 'Could not remove receipt');
    } finally {
      setDeletingId(null);
    }
  };

  const wrapperStyle = compact
    ? { marginBottom: 0, width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' }
    : { ...cardStyle, width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden' };

  return (
    <div style={wrapperStyle}>
      {!compact && (
        <>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: TavariStyles.colors.gray900 }}>
            Cake receipts
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
            Upload the cake store receipt so staff can verify your outside cake before the party.
            JPG, PNG, WEBP, HEIC, or PDF up to 10 MB.
          </p>
        </>
      )}

      {compact && (
        <p style={{ margin: '0 0 12px', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
          Upload your cake store receipt (JPG, PNG, WEBP, HEIC, or PDF, max 10 MB).
        </p>
      )}

      <div style={{ marginBottom: 16, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <div style={fieldLabelStyle}>Optional note</div>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Ordered from Costco, pickup May 18"
          disabled={disabled || uploading}
          style={{
            width: '100%',
            maxWidth: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20, width: '100%', maxWidth: '100%' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          disabled={disabled || uploading}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: TavariStyles.colors.primary,
            color: '#fff',
            fontWeight: 600,
            cursor: disabled || uploading ? 'not-allowed' : 'pointer',
            opacity: disabled || uploading ? 0.6 : 1,
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          <FiUpload size={16} />
          {uploading ? 'Uploading…' : 'Upload receipt'}
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 14, color: TavariStyles.colors.gray500 }}>Loading receipts…</div>
      ) : receipts.length === 0 ? (
        <div style={{ fontSize: 14, color: TavariStyles.colors.gray500 }}>No cake receipts uploaded yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: '100%' }}>
          {receipts.map((receipt) => (
            <div
              key={receipt.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid #e5e7eb',
                background: '#f9fafb',
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                  {receipt.file_name}
                </div>
                <div style={{ fontSize: 13, color: TavariStyles.colors.gray500, marginTop: 4, overflowWrap: 'anywhere' }}>
                  {sourceLabel(receipt.uploaded_source)}
                  {' · '}
                  {formatDateTimeForBusiness(receipt.created_at, businessTimezone)}
                  {receipt.file_size ? ` · ${formatFileSize(receipt.file_size)}` : ''}
                </div>
                {receipt.notes ? (
                  <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 6, overflowWrap: 'anywhere' }}>
                    {receipt.notes}
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {receipt.signed_url ? (
                  <a
                    href={receipt.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: '#fff',
                      border: '1px solid #d1d5db',
                      color: TavariStyles.colors.primary,
                      fontWeight: 600,
                      fontSize: 13,
                      textDecoration: 'none',
                    }}
                  >
                    <FiExternalLink size={14} />
                    View
                  </a>
                ) : null}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleDelete(receipt.id)}
                    disabled={deletingId === receipt.id}
                    title="Remove receipt"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      border: '1px solid #fecaca',
                      background: '#fff',
                      color: '#dc2626',
                      cursor: deletingId === receipt.id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <FiTrash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

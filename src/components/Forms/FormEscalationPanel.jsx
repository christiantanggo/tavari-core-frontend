import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  MAINTENANCE_REQUEST_OPTIONS,
  URGENCY_OPTIONS,
  createEmptyEscalation,
  uploadFormsEscalationMedia
} from '../../utils/formsEscalation';

const panelStyle = {
  marginTop: 12,
  padding: 14,
  borderRadius: 12,
  border: '1px solid #fecaca',
  background: '#fff7ed'
};
const titleStyle = { margin: '0 0 10px', fontWeight: 700, color: '#9a3412', fontSize: 14 };
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 };
const labelStyle = { fontWeight: 600, color: '#374151', fontSize: 13 };
const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 10,
  fontSize: 14,
  boxSizing: 'border-box'
};
const hintStyle = { margin: 0, color: '#6b7280', fontSize: 13, lineHeight: 1.5 };
const mediaRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' };
const mediaLinkStyle = { color: '#0f766e', fontSize: 13, wordBreak: 'break-all' };
const removeBtnStyle = {
  border: 'none',
  background: 'transparent',
  color: '#b91c1c',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700
};

const FormEscalationPanel = ({
  fieldLabel,
  value,
  onChange,
  businessId,
  uploadSessionId,
  disabled = false
}) => {
  const details = value || createEmptyEscalation();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const update = (patch) => onChange({ ...details, ...patch });

  const handleUpload = async (file, kind) => {
    if (!file) return;
    const setUploading = kind === 'photo' ? setUploadingPhoto : setUploadingVideo;
    setUploading(true);
    try {
      const url = await uploadFormsEscalationMedia({
        businessId,
        uploadSessionId,
        file,
        kind
      });
      if (kind === 'photo') {
        update({ photo_urls: [...(details.photo_urls || []), url] });
      } else {
        update({ video_urls: [...(details.video_urls || []), url] });
      }
      toast.success(kind === 'photo' ? 'Photo uploaded' : 'Video uploaded');
    } catch (err) {
      toast.error(err.message || `Could not upload ${kind}`);
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = (kind, index) => {
    if (kind === 'photo') {
      update({ photo_urls: (details.photo_urls || []).filter((_, i) => i !== index) });
      return;
    }
    update({ video_urls: (details.video_urls || []).filter((_, i) => i !== index) });
  };

  return (
    <div style={panelStyle}>
      <p style={titleStyle}>Follow-up required for {fieldLabel}</p>

      <label style={fieldStyle}>
        <span style={labelStyle}>Location</span>
        <input
          type="text"
          style={inputStyle}
          value={details.location}
          disabled={disabled}
          placeholder="Where did this happen?"
          onChange={(e) => update({ location: e.target.value })}
        />
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>Urgency</span>
        <select
          style={inputStyle}
          value={details.urgency}
          disabled={disabled}
          onChange={(e) => update({ urgency: e.target.value })}
        >
          <option value="">Select urgency…</option>
          {URGENCY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>Submit maintenance request?</span>
        <select
          style={inputStyle}
          value={details.submit_maintenance_request}
          disabled={disabled}
          onChange={(e) => update({ submit_maintenance_request: e.target.value })}
        >
          <option value="">Select…</option>
          {MAINTENANCE_REQUEST_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>Action taken</span>
        <textarea
          style={{ ...inputStyle, minHeight: 72 }}
          value={details.action_taken}
          disabled={disabled}
          placeholder="What did you do right now?"
          onChange={(e) => update({ action_taken: e.target.value })}
        />
      </label>

      <div style={fieldStyle}>
        <span style={labelStyle}>Photo (optional)</span>
        <div style={mediaRowStyle}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={disabled || uploadingPhoto}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) handleUpload(file, 'photo');
            }}
          />
          {uploadingPhoto && <span style={hintStyle}>Uploading photo…</span>}
        </div>
        {(details.photo_urls || []).map((url, index) => (
          <div key={url} style={mediaRowStyle}>
            <a href={url} target="_blank" rel="noreferrer" style={mediaLinkStyle}>Photo {index + 1}</a>
            {!disabled && (
              <button type="button" style={removeBtnStyle} onClick={() => removeMedia('photo', index)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>Video (optional)</span>
        <div style={mediaRowStyle}>
          <input
            type="file"
            accept="video/*"
            capture="environment"
            disabled={disabled || uploadingVideo}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) handleUpload(file, 'video');
            }}
          />
          {uploadingVideo && <span style={hintStyle}>Uploading video…</span>}
        </div>
        {(details.video_urls || []).map((url, index) => (
          <div key={url} style={mediaRowStyle}>
            <a href={url} target="_blank" rel="noreferrer" style={mediaLinkStyle}>Video {index + 1}</a>
            {!disabled && (
              <button type="button" style={removeBtnStyle} onClick={() => removeMedia('video', index)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <p style={hintStyle}>These details are sent to the designated reviewer with the alert email.</p>
    </div>
  );
};

export default FormEscalationPanel;

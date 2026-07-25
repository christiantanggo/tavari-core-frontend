import React from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { TavariStyles } from '../utils/TavariStyles';
import { copyTextToClipboard } from '../utils/aiStaffLinks';

const primary = TavariStyles?.colors?.primary || '#008080';
const gray200 = TavariStyles?.colors?.gray200 || '#e5e7eb';
const gray600 = TavariStyles?.colors?.gray600 || '#4b5563';

const cardStyle = {
  marginTop: 10,
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${gray200}`,
  backgroundColor: '#fff',
};

const labelStyle = {
  fontWeight: 600,
  fontSize: 13,
  color: '#1f2937',
  marginBottom: 4,
};

const urlStyle = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  fontSize: 11,
  color: gray600,
  wordBreak: 'break-all',
  backgroundColor: '#f9fafb',
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${gray200}`,
  marginBottom: 6,
};

const hintStyle = {
  fontSize: 11,
  color: gray600,
  lineHeight: 1.4,
  marginBottom: 8,
};

const btnRow = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const btnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  backgroundColor: primary,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  textDecoration: 'none',
};

export default function AiChatLinkCard({ link }) {
  if (!link) return null;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(link.url);
    if (ok) toast.success('Copied to clipboard');
    else toast.error('Could not copy');
  };

  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{link.label}</div>
      {link.description ? <p style={hintStyle}>{link.description}</p> : null}
      <div style={urlStyle}>{link.url}</div>
      <div style={btnRow}>
        <button type="button" style={btnStyle} onClick={handleCopy}>
          <Copy size={14} />
          Copy URL
        </button>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...btnStyle, backgroundColor: '#0f766e' }}
        >
          <ExternalLink size={14} />
          Open
        </a>
      </div>
    </div>
  );
}

import React from 'react';
import { TavariStyles } from '../utils/TavariStyles';

const primary = TavariStyles?.colors?.primary || '#008080';

/** Split assistant text into plain segments and markdown-style [label](path) links. */
const LINK_RE = /\[([^\]]+)\]\((\/dashboard[^)\s]*)\)/g;
const BARE_PATH_RE = /(\/dashboard\/[^\s)\],!?]+(?:\?[^\s)\],!?]+)?)/g;
function parseSegments(text) {
  if (!text || typeof text !== 'string') return [{ type: 'text', value: text || '' }];

  const segments = [];
  let lastIndex = 0;
  let match;

  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'link', label: match[1], path: match[2] });
    lastIndex = LINK_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', value: text });
  }

  return segments;
}

function splitBarePaths(text) {
  const parts = [];
  let lastIndex = 0;
  let match;
  BARE_PATH_RE.lastIndex = 0;
  while ((match = BARE_PATH_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'link', label: 'Go there', path: match[1] });
    lastIndex = BARE_PATH_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts.length ? parts : [{ type: 'text', value: text }];
}

const linkStyle = {
  display: 'inline-block',
  marginTop: 6,
  padding: '6px 12px',
  backgroundColor: primary,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
};

export default function AiChatMessageContent({ content, onNavigate, isUser }) {
  if (isUser) return content;

  const go = (path, label) => {
    if (typeof onNavigate === 'function') onNavigate(path, label, content);
  };
  const segments = parseSegments(content);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'link') {
          return (
            <button
              key={`link-${i}`}
              type="button"
              style={linkStyle}
              onClick={(e) => {
                e.stopPropagation();
                go(seg.path, seg.label);
              }}
            >
              {seg.label}
            </button>
          );
        }

        const subParts = splitBarePaths(seg.value);
        return (
          <span key={`text-${i}`}>
            {subParts.map((part, j) => {
              if (part.type === 'link') {
                return (
                  <button
                    key={`bare-${i}-${j}`}
                    type="button"
                    style={{ ...linkStyle, marginLeft: j > 0 ? 4 : 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      go(part.path, 'Take me there');
                    }}
                  >
                    Take me there
                  </button>
                );
              }
              return <span key={`t-${i}-${j}`}>{part.value}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}

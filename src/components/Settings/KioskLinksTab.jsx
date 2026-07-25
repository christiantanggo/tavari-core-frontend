// Kiosk & employee app URLs for legacy hardware / pinned browsers (System Settings)
import React, { useMemo } from 'react';
import toast from 'react-hot-toast';
import { Copy, ExternalLink } from 'lucide-react';
import { EMPLOYEE_APP_HOST } from '../../utils/employeeAppRouting';

const linkBox = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '12px',
  backgroundColor: '#fff',
};

const rowTop = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  marginBottom: '8px',
};

const labelStyle = {
  fontWeight: 600,
  color: '#1f2937',
  fontSize: '15px',
};

const urlStyle = {
  fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
  fontSize: '13px',
  color: '#374151',
  wordBreak: 'break-all',
  backgroundColor: '#f3f4f6',
  padding: '10px 12px',
  borderRadius: '6px',
  border: '1px solid #e5e7eb',
  flex: '1',
  minWidth: '200px',
};

const btnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  fontSize: '13px',
  fontWeight: 600,
  color: '#fff',
  backgroundColor: '#008080',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};

const hintStyle = {
  fontSize: '13px',
  color: '#6b7280',
  marginTop: '4px',
  lineHeight: 1.4,
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Could not copy');
  }
}

const KioskLinksTab = ({ styles: parentStyles }) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const links = useMemo(() => {
    const employeeProdLogin = `https://${EMPLOYEE_APP_HOST}/login`;
    const employeeSameOrigin = origin ? `${origin}/portal/login` : '';

    return [
      {
        id: 'signage',
        label: 'Digital signage player',
        description:
          'Fullscreen TV/tablet player. Pair once with a screen key — it is saved in the URL and browser storage so content resumes after reboot or nightly restart.',
        url: `${origin}/signage/player`,
      },
      {
        id: 'music',
        label: 'Music kiosk',
        description: 'Fullscreen music player / kiosk mode. Keep this path for music hardware only.',
        url: `${origin}/kiosk/music`,
      },
      {
        id: 'waiver',
        label: 'Waiver kiosk (React)',
        description:
          'Modern waiver kiosk for tablets and browsers. Idle content comes from Digital Signage → Schedules → Waiver Kiosks.',
        url: `${origin}/kiosk/waiver`,
      },
      {
        id: 'waiver-legacy-tablet',
        label: 'Legacy waiver tablet (ES5)',
        description:
          'Standalone page for very old browsers (no React). Replace <business-id> with your business UUID. Same idle playlist as Waiver Kiosks schedule.',
        url: `${origin}/waiver-browser-kiosk/?business=<business-id>`,
      },
      {
        id: 'punch-clock',
        label: 'Punch clock (modern / iPad 7+)',
        description:
          'Full React time clock with live camera. Bookmark this on the iPad 7th gen kiosk. Replace <business-id> if needed.',
        url: 'https://legacy-punchclock.tavarios.ca/',
        secondaryLabel: 'Same-origin path',
        secondaryUrl: `${origin}/time-clock-kiosk/<business-id>`,
      },
      {
        id: 'punch-clock-es5',
        label: 'Punch clock (legacy ES5 fallback)',
        description:
          'Old static page for very old tablets only. Prefer the modern punch clock link above on iPad 7+.',
        url: `${origin}/legacy-punchclock/`,
      },
      {
        id: 'tasks',
        label: 'Task manager',
        description: 'Internal tasks dashboard (may require sign-in on the main app).',
        url: `${origin}/dashboard/tasks`,
      },
      {
        id: 'employee',
        label: 'Employee web app (production)',
        description: 'Dedicated employee portal host. Use this for staff on phones or shared PCs in production.',
        url: employeeProdLogin,
        secondaryLabel: 'Same build, this origin (dev / testing)',
        secondaryUrl: employeeSameOrigin,
      },
    ];
  }, [origin]);

  return (
    <div style={parentStyles?.section || { maxWidth: '800px' }}>
      <h3 style={parentStyles?.sectionTitle || { margin: '0 0 8px' }}>Kiosk links</h3>
      <p style={hintStyle}>
        Use these full URLs for bookmarks, home-screen icons, and legacy devices. Replace{' '}
        <code style={{ background: '#f3f4f6', padding: '2px 4px', borderRadius: 4 }}>{origin || '(your app origin)'}</code>{' '}
        with your live domain in production (e.g. <code style={{ background: '#f3f4f6', padding: '2px 4px' }}>https://www.tavarios.ca</code>).
      </p>

      {links.map((row) => (
        <div key={row.id} style={linkBox}>
          <div style={rowTop}>
            <span style={labelStyle}>{row.label}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                style={btnStyle}
                onClick={() => copyText(row.url)}
                aria-label={`Copy ${row.label} URL`}
              >
                <Copy size={16} />
                Copy URL
              </button>
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  ...btnStyle,
                  backgroundColor: '#0f766e',
                  textDecoration: 'none',
                }}
              >
                <ExternalLink size={16} />
                Open
              </a>
            </div>
          </div>
          <div style={urlStyle}>{row.url}</div>
          <p style={hintStyle}>{row.description}</p>

          {row.secondaryUrl ? (
            <>
              <p style={{ ...hintStyle, marginTop: 12, fontWeight: 600, color: '#4b5563' }}>
                {row.secondaryLabel}
              </p>
              <div style={rowTop}>
                <div style={urlStyle}>{row.secondaryUrl}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    style={btnStyle}
                    onClick={() => copyText(row.secondaryUrl)}
                  >
                    <Copy size={16} />
                    Copy
                  </button>
                  <a
                    href={row.secondaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      ...btnStyle,
                      backgroundColor: '#0f766e',
                      textDecoration: 'none',
                    }}
                  >
                    <ExternalLink size={16} />
                    Open
                  </a>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
};

export default KioskLinksTab;

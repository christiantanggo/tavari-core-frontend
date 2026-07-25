import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const LOADING_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;min-height:100vh;padding:32px 16px;">
    <tr><td align="center" valign="middle">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 100%);padding:32px 28px;text-align:center;color:#ffffff;">
            <div style="font-size: 11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;opacity:0.92;">Tavari HR</div>
            <h1 style="margin:12px 0 0;font-size: 23px;font-weight:800;">Processing…</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px;text-align:center;color:#6b7280;font-size: 15px;line-height:1.6;">
            Please wait while we record your response.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

/**
 * Public landing page for shift premium approval email links (Approve / Reject).
 */
export default function ShiftPremiumApprovalActionPage() {
  const [params] = useSearchParams();
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = params.get('token') || '';
    const action = params.get('action') || '';
    if (!token) {
      setHtml('<p style="font-family:Arial,sans-serif;padding:40px;text-align:center;color:#b91c1c;">Invalid approval link.</p>');
      setLoading(false);
      return;
    }

    const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
    const url = `${base}/functions/v1/shift-premium-approval-action?token=${encodeURIComponent(token)}&action=${encodeURIComponent(action)}`;

    fetch(url, { method: 'GET', headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
      .then((res) => res.text())
      .then((text) => {
        setHtml(text);
        setLoading(false);
      })
      .catch(() => {
        setHtml(
          '<p style="font-family:Arial,sans-serif;padding:40px;text-align:center;color:#b91c1c;">Could not process this approval link. Please try again later.</p>'
        );
        setLoading(false);
      });
  }, [params]);

  if (loading) {
    return <div dangerouslySetInnerHTML={{ __html: LOADING_HTML }} />;
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

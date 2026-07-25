import React, { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import {
  fetchTavariApiBusinessEmail,
  fetchTavariApiBusinessName,
  fetchTavariApiBusinessPhone,
  fetchTavariApiBusinessAddress,
  fetchTavariApiBusinessLogo,
  fetchTavariApiBusinessFavicon,
  fetchTavariApiBusinessHours,
  fetchTavariApiBusinessProducts,
  fetchTavariApiCampRegistrationPortal,
  fetchTavariApiPartyGuestListPortal,
  fetchTavariApiPartyPackages,
  fetchTavariApiBookingCatalog,
  fetchTavariApiBookingAvailability,
  fetchTavariApiCampSessions,
  fetchTavariApiWebsitePublicProfile,
  getTavariApiFunctionUrl,
  TAVARI_API_BUSINESS_EMAIL,
  TAVARI_API_BUSINESS_NAME,
  TAVARI_API_BUSINESS_PHONE,
  TAVARI_API_BUSINESS_ADDRESS,
  TAVARI_API_BUSINESS_LOGO,
  TAVARI_API_BUSINESS_FAVICON,
  TAVARI_API_BUSINESS_HOURS,
  TAVARI_API_BUSINESS_PRODUCTS,
  TAVARI_API_CAMP_REGISTRATION,
  TAVARI_API_PARTY_PACKAGES,
  TAVARI_API_BOOKING_CATALOG,
  TAVARI_API_BOOKING_AVAILABILITY,
  TAVARI_API_CAMP_SESSIONS,
  TAVARI_API_PARTY_GUEST_LIST,
  TAVARI_API_WEBSITE_PUBLIC_PROFILE,
  TAVARI_API_ENDPOINTS,
} from '../../services/TavariApis/tavariApisCatalog';
import { tavariApisPageStyles as styles } from './tavariApisStyles';

const LIVE_TEST_FETCHERS = {
  [TAVARI_API_WEBSITE_PUBLIC_PROFILE]: fetchTavariApiWebsitePublicProfile,
  [TAVARI_API_BUSINESS_NAME]: fetchTavariApiBusinessName,
  [TAVARI_API_BUSINESS_EMAIL]: fetchTavariApiBusinessEmail,
  [TAVARI_API_BUSINESS_PHONE]: fetchTavariApiBusinessPhone,
  [TAVARI_API_BUSINESS_ADDRESS]: fetchTavariApiBusinessAddress,
  [TAVARI_API_BUSINESS_LOGO]: fetchTavariApiBusinessLogo,
  [TAVARI_API_BUSINESS_FAVICON]: fetchTavariApiBusinessFavicon,
  [TAVARI_API_BUSINESS_HOURS]: fetchTavariApiBusinessHours,
  [TAVARI_API_BUSINESS_PRODUCTS]: fetchTavariApiBusinessProducts,
  [TAVARI_API_CAMP_REGISTRATION]: fetchTavariApiCampRegistrationPortal,
  [TAVARI_API_PARTY_PACKAGES]: fetchTavariApiPartyPackages,
  [TAVARI_API_BOOKING_CATALOG]: fetchTavariApiBookingCatalog,
  [TAVARI_API_BOOKING_AVAILABILITY]: fetchTavariApiBookingAvailability,
  [TAVARI_API_CAMP_SESSIONS]: fetchTavariApiCampSessions,
  [TAVARI_API_PARTY_GUEST_LIST]: fetchTavariApiPartyGuestListPortal,
};

function statusBadge(status) {
  if (status === 'live') {
    return <span style={styles.badge}>Live</span>;
  }
  return <span style={{ ...styles.badge, ...styles.badgeMuted }}>Not deployed</span>;
}

export default function TavariApisEndpoints() {
  const { selectedBusinessId } = useBusinessContext();
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const handleTestEndpoint = useCallback(async (endpointId) => {
    const fetcher = LIVE_TEST_FETCHERS[endpointId];
    if (!fetcher) return;

    if (!selectedBusinessId) {
      toast.error('Select a business first.');
      return;
    }

    try {
      setTestingId(endpointId);
      setTestResult(null);
      const payload = await fetcher(selectedBusinessId);
      setTestResult(payload);
      toast.success('API responded successfully.');
    } catch (err) {
      console.error('[TavariApisEndpoints] test failed:', err);
      toast.error(err.message || 'API test failed');
      setTestResult({ ok: false, error: err.message || 'Request failed' });
    } finally {
      setTestingId(null);
    }
  }, [selectedBusinessId]);

  return (
    <div style={styles.page}>
      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>Public endpoints</h2>
        <p style={styles.panelText}>
          These Edge Functions live in the Tavari project only. External sites pass your business ID — no
          Tavari login required for read-only data. Tavari APIs must be enabled for the business.
        </p>
      </section>

      <section style={styles.list}>
        {TAVARI_API_ENDPOINTS.map((endpoint) => {
          const isLiveEndpoint = endpoint.status === 'live';
          const canTest = Boolean(LIVE_TEST_FETCHERS[endpoint.id]);
          const fullUrl = isLiveEndpoint
            ? `${getTavariApiFunctionUrl(endpoint.id)}${endpoint.queryExample || ''}`.replace(
                '{businessId}',
                selectedBusinessId || '{businessId}',
              )
            : endpoint.path;

          return (
            <article key={endpoint.id} style={styles.card}>
              <div>
                <div style={styles.kicker}>{endpoint.method}</div>
                <h3 style={styles.cardTitle}>{endpoint.summary}</h3>
                {endpoint.description && <p style={styles.panelText}>{endpoint.description}</p>}
                <div style={styles.code}>{fullUrl}</div>
                <p style={styles.panelText}>
                  Fields: {endpoint.fields.join(', ')}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                {statusBadge(endpoint.status)}
                {canTest && (
                  <button
                    type="button"
                    onClick={() => handleTestEndpoint(endpoint.id)}
                    disabled={testingId === endpoint.id || !selectedBusinessId}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#008080',
                      color: '#fff',
                      fontWeight: 700,
                      cursor: testingId === endpoint.id ? 'wait' : 'pointer',
                      opacity: !selectedBusinessId ? 0.6 : 1,
                    }}
                  >
                    {testingId === endpoint.id ? 'Testing…' : 'Test API'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {testResult && (
        <section style={styles.panel}>
          <h3 style={{ ...styles.panelTitle, fontSize: 16 }}>Latest test response</h3>
          <pre style={{ ...styles.code, marginTop: 12, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(testResult, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

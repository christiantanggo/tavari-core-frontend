import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import CustomerPortalShell from '../../components/Bookings/CustomerPortalShell';
import { loadCustomerPortalSession, saveCustomerPortalSession } from '../../utils/customerPortalSession';

const CustomerPortalLayout = () => {
  const { businessId, section } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [portalData, setPortalData] = useState(null);

  useEffect(() => {
    if (!businessId) return;

    const loadPortal = async () => {
      setLoading(true);
      setError(null);
      try {
        const session = loadCustomerPortalSession(businessId);
        if (!session?.id || !(session.phone || session.customer_phone)) {
          navigate(`/customer-portal/${businessId}/portal`, { replace: true });
          return;
        }

        const { data, error: fnError } = await supabase.functions.invoke('customer-portal-data', {
          body: {
            action: 'load',
            businessId,
            customerId: session.id,
            phone: session.phone || session.customer_phone,
          },
        });

        if (fnError || data?.error) {
          throw new Error(data?.error || fnError?.message || 'Failed to load customer portal');
        }

        setPortalData(data);
        if (data?.customer) {
          saveCustomerPortalSession(businessId, data.customer);
        }
      } catch (loadError) {
        setError(loadError?.message || 'Failed to load customer portal');
      } finally {
        setLoading(false);
      }
    };

    loadPortal();
  }, [businessId, navigate]);

  const counts = useMemo(() => {
    if (!portalData) return {};

    return {
      bookings: (portalData.bookings?.upcoming?.length || 0) + (portalData.bookings?.past?.length || 0),
      waivers: portalData.waivers?.length || 0,
      account: (portalData.account?.attachedPeople?.length || 0) + 1,
      parties: (portalData.parties?.upcoming?.length || 0) + (portalData.parties?.past?.length || 0),
      notifications: portalData.notifications?.length || 0,
    };
  }, [portalData]);

  if (loading) {
    return <div style={{ padding: 32 }}>Loading customer portal...</div>;
  }

  if (error || !portalData?.customer) {
    return (
      <div style={{ padding: 32 }}>
        {error || 'Could not load your customer portal.'}
      </div>
    );
  }

  return (
    <CustomerPortalShell
      businessId={businessId}
      customer={portalData.customer}
      counts={counts}
      activeSection={section}
      title="Your customer portal"
      subtitle="Manage bookings, waivers, account details, parties, and notifications without using the employee dashboard."
    >
      <Outlet context={{ portalData, setPortalData }} />
    </CustomerPortalShell>
  );
};

export default CustomerPortalLayout;

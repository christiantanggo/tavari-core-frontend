import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { sessionPersistence } from '../../services/SessionPersistence';
import DashboardLayout from '../../layouts/DashboardLayout';
import { AIChatProvider } from '../../contexts/AIChatContext';
import { BookingDetailModalProvider } from '../../contexts/BookingDetailModalContext';
import {
  getTaskKioskDashboardContext,
  primeTaskKioskDashboardFromUrl,
} from '../../helpers/taskManagerKioskSession';

function DashboardShell() {
  return (
    <AIChatProvider>
      <BookingDetailModalProvider>
        <DashboardLayout />
      </BookingDetailModalProvider>
    </AIChatProvider>
  );
}

/**
 * Dashboard shell: normal Supabase session, or task-kiosk module link with PIN session + tkDash token.
 */
export default function DashboardRouteGuard({ session, authLoading }) {
  const location = useLocation();

  useEffect(() => {
    primeTaskKioskDashboardFromUrl();
  }, [location.search]);

  if (authLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
        Loading…
      </div>
    );
  }

  if (session) {
    return <DashboardShell />;
  }

  const taskCtx = getTaskKioskDashboardContext(location.search);
  if (taskCtx?.dashboardToken) {
    return <DashboardShell />;
  }

  return sessionPersistence.isPersistenceEnabled()
    ? <Navigate to="/unlock" replace />
    : <Navigate to="/login" replace />;
}

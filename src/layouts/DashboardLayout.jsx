// src/layouts/DashboardLayout.jsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import HeaderBar from '../components/HeaderBar';
import SidebarNav from '../components/SidebarNav';
import TaskReturnBar from '../components/Tasks/TaskReturnBar';
import AIChatPanel from '../components/AIChatPanel';
import { useAIChat } from '../contexts/AIChatContext';
import toast from 'react-hot-toast';
import './DashboardLayout.css';
import { getPublicUserId } from '../utils/getPublicUserId';
import {
  fetchBusinessMembership,
  isPrivilegedMembershipRole,
  isTerminatedAtBusiness,
  resolveEmploymentFields,
} from '../utils/businessEmploymentStatus';

const MOBILE_NAV_MQ = '(max-width: 768px)';

const POS_CUSTOMER_DISPLAY_PATH = '/dashboard/pos/customer-display';

const DashboardContent = ({ navigate }) => {
  const location = useLocation();
  const { toggleOpen } = useAIChat();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainScrollRef = useRef(null);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  /** Reset main viewport scroll when switching dashboard routes (e.g. sidebar navigation). */
  useEffect(() => {
    if (location.pathname === POS_CUSTOMER_DISPLAY_PATH) return;
    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const el = mainScrollRef.current;
      if (el) el.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [location.pathname]);

  /** Second-monitor preview from POS: must be true fullscreen, no header/sidebar scroll chrome */
  if (location.pathname === POS_CUSTOMER_DISPLAY_PATH) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          backgroundColor: '#1a1a1a',
          zIndex: 0,
        }}
      >
        <Outlet />
      </div>
    );
  }

  const toggleMobileNav = useCallback(() => {
    setMobileNavOpen((o) => !o);
  }, []);

  const handleSidebarNavigate = useCallback(
    (path) => {
      navigate(path);
      closeMobileNav();
    },
    [navigate, closeMobileNav]
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_NAV_MQ);
    const onChange = () => {
      if (!mq.matches) closeMobileNav();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [closeMobileNav]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeMobileNav();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen, closeMobileNav]);

  return (
    <>
      <HeaderBar
        onLogoClick={() => navigate('/dashboard/home')}
        onChatClick={toggleOpen}
        mobileNavOpen={mobileNavOpen}
        onMobileNavToggle={toggleMobileNav}
        onCloseNavDrawer={closeMobileNav}
      />
      <div className="dashboard-layout-row">
        <div className={`dashboard-sidebar-panel${mobileNavOpen ? ' is-open' : ''}`}>
          <SidebarNav onNavigate={handleSidebarNavigate} />
        </div>
        {mobileNavOpen && (
          <button
            type="button"
            className="nav-drawer-backdrop"
            aria-label="Close navigation menu"
            onClick={closeMobileNav}
          />
        )}
        <div className="dashboard-main" ref={mainScrollRef}>
          <TaskReturnBar />
          <Outlet />
        </div>
      </div>
      <AIChatPanel />
    </>
  );
};

const DashboardLayout = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkTerminationStatus = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setChecking(false);
          return;
        }

        const businessId =
          localStorage.getItem('tavariPinnedBusinessId') ||
          localStorage.getItem('selectedBusinessId') ||
          localStorage.getItem('currentBusinessId');

        if (!businessId) {
          setChecking(false);
          return;
        }

        const publicUserId = (await getPublicUserId(session.user.email)) || session.user.id;
        const membership = await fetchBusinessMembership(supabase, publicUserId, businessId);

        if (!membership) {
          setChecking(false);
          return;
        }

        if (isPrivilegedMembershipRole(membership.role)) {
          setChecking(false);
          return;
        }

        const { data: userData, error } = await supabase
          .from('users')
          .select('employment_status, termination_date')
          .eq('id', publicUserId)
          .single();

        if (error) {
          console.error('Error checking termination status:', error);
          setChecking(false);
          return;
        }

        const employment = resolveEmploymentFields({ membership, user: userData });

        if (isTerminatedAtBusiness({ membership, user: userData, role: membership.role })) {
          if (employment.termination_date) {
            const terminationDate = new Date(employment.termination_date);
            const accessEndDate = new Date(terminationDate);
            accessEndDate.setFullYear(accessEndDate.getFullYear() + 7);

            if (new Date() > accessEndDate) {
              await supabase.auth.signOut();
              navigate('/login', { replace: true });
              toast.error('Your portal access has expired. Please contact HR for assistance.');
              return;
            }
          }

          toast.error('Terminated employees can only access the employee portal.');
          navigate('/portal', { replace: true });
          return;
        }

        setChecking(false);
      } catch (error) {
        console.error('Error in termination check:', error);
        setChecking(false);
      }
    };

    checkTerminationStatus();
  }, [navigate]);

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9fafb'
      }}>
        <div style={{
          fontSize: '13px',
          color: '#6b7280'
        }}>Loading...</div>
      </div>
    );
  }

  return <DashboardContent navigate={navigate} />;
};

export default DashboardLayout;

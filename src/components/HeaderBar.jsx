// components/HeaderBar.jsx - FIXED WITH CENTRALIZED AUTH CLEANUP
import React, { useState, useEffect, useRef } from 'react';
import { FiBell, FiSettings, FiUser, FiMenu, FiLogOut, FiDollarSign } from 'react-icons/fi';
import './HeaderBar.css';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useUserProfile } from '../hooks/useUserProfile';
import { useBusiness } from '../contexts/BusinessContext';
import { sessionPersistence } from '../services/SessionPersistence';
import { clearAllAuthData, validateCachedBusinessId, setBusinessId } from '../utils/authCleanup';

const HeaderBar = ({ onLogoClick }) => {
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showMobileAccountDropdown, setShowMobileAccountDropdown] = useState(false);
  const navigate = useNavigate();
  const { profile } = useUserProfile();
  const { business, setBusiness } = useBusiness();
  const dropdownRef = useRef(null);

  const selectedBiz = business?.id || '';
  const setSelectedBiz = setBusiness;

  const [businesses, setBusinesses] = useState([]);
  const [lastUserId, setLastUserId] = useState(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowAccountDropdown(false);
      }
    };

    if (showAccountDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAccountDropdown]);

  useEffect(() => {
    const fetchBusinesses = async () => {
      if (!profile?.id) return;

      // CRITICAL: Clear cached business if user changed
      if (lastUserId && lastUserId !== profile.id) {
        clearAllAuthData('user_switched');
        setSelectedBiz(''); // Clear context
      }
      setLastUserId(profile.id);

      // Query business_users table instead of user_roles
      const { data, error } = await supabase
        .from('business_users')
        .select(`
          business_id,
          role,
          businesses (
            id,
            name
          )
        `)
        .eq('user_id', profile.id);

      if (error) {
        console.error('Error fetching businesses:', error);
        return;
      }

      if (data) {
        // Extract businesses from the joined data
        const bizList = data
          .map((d) => d.businesses)
          .filter(biz => biz && biz.id && biz.name);
        
        setBusinesses(bizList);

        // Validate cached business ID against user's actual businesses
        const validBusinessIds = bizList.map(b => b.id);
        

        // Only set selected business if none is set yet in context
        if (!selectedBiz) {
          // Check if cached ID is valid for this user using utility
          if (validateCachedBusinessId(validBusinessIds)) {
            const cachedBusinessId = localStorage.getItem('currentBusinessId');
            setSelectedBiz(cachedBusinessId);
          } else {
            // Cached ID is invalid or doesn't exist - use first business
            const cachedBusinessId = localStorage.getItem('currentBusinessId');
            if (cachedBusinessId) {
              console.warn('⚠️ Cached business ID is NOT in user\'s business list, clearing:', cachedBusinessId);
              clearAllAuthData('invalid_cached_business');
            }
            
            if (bizList.length > 0) {
              const defaultBizId = bizList[0].id;
              setSelectedBiz(defaultBizId);
              setBusinessId(defaultBizId); // Use utility for safe setting
            }
          }
        } else {
          // Business is already set in context - verify it's still valid
          if (!validBusinessIds.includes(selectedBiz)) {
            console.warn('⚠️ Current business in context is NOT valid for this user:', selectedBiz);
            const defaultBizId = bizList[0]?.id;
            if (defaultBizId) {
              setSelectedBiz(defaultBizId);
              setBusinessId(defaultBizId); // Use utility for safe setting
            }
          }
        }
      }
    };

    fetchBusinesses();
  }, [profile?.id, selectedBiz, setSelectedBiz]);

  // Sync localStorage when business changes in context
  useEffect(() => {
    if (selectedBiz) {
      setBusinessId(selectedBiz); // Use utility for safe setting
    }
  }, [selectedBiz]);

  const handleLogout = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const fallbackId = session?.user?.id;
      const userId = profile?.id || fallbackId;

      // Log audit event before clearing data
      if (userId) {
        await supabase.from('audit_logs').insert({
          user_id: userId,
          event_type: 'logout',
          details: JSON.stringify({
            reason: 'user clicked logout from header',
          }),
        });
      }

      // 🔧 CRITICAL: Use centralized cleanup function
      clearAllAuthData('user_logout');
      
      // Stop session persistence
      sessionPersistence.disablePersistence();

      // Sign out from Supabase
      await supabase.auth.signOut();
      
      // Navigate to login
      navigate('/login');
    } catch (error) {
      console.error('❌ Error during logout:', error);
      // Even if there's an error, still try to clean up and navigate
      clearAllAuthData('logout_error');
      sessionPersistence.disablePersistence();
      navigate('/login');
    }
  };

  const handleBusinessChange = (e) => {
    if (e.target.value === 'new') {
      navigate('/dashboard/new-business');
    } else {
      const newBizId = e.target.value;
      setSelectedBiz(newBizId);
      // localStorage sync is handled in useEffect now
      window.location.reload(); // Force refresh to reload business-specific content
    }
  };

  return (
    <div className="header">
      <div className="logo" onClick={onLogoClick}>
        <img src="/logo.png" alt="Tavari Logo" className="logoImage" />
      </div>

      <div className="spacer" />

      <div className="desktopIcons">
        <select
          className="selector"
          value={selectedBiz}
          onChange={handleBusinessChange}
        >
          {businesses.map((biz) => (
            <option key={biz.id} value={biz.id}>
              {biz.name}
            </option>
          ))}
          <option value="new">+ Open New Business</option>
        </select>
        <FiBell className="icon" />
        <FiSettings className="icon" onClick={() => navigate('/dashboard/settings')} />
        
        {/* Account Icon with Dropdown */}
        <div className="account-wrapper" ref={dropdownRef}>
          <div 
            className="icon account-icon" 
            onClick={() => setShowAccountDropdown(!showAccountDropdown)}
          >
            <FiUser />
          </div>
          {showAccountDropdown && (
            <div className="account-dropdown">
              <div className="dropdown-header">
                <div className="dropdown-user-name">{profile?.full_name || profile?.email || 'User'}</div>
                <div className="dropdown-user-email">{profile?.email}</div>
              </div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-item" onClick={() => { navigate('/dashboard/employee/pay-statements'); setShowAccountDropdown(false); }}>
                <FiDollarSign className="dropdown-icon" />
                <span>My Pay Statements</span>
              </div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-item logout" onClick={handleLogout}>
                <FiLogOut className="dropdown-icon" />
                <span>Log Out</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="hamburger" onClick={() => setShowMobileMenu(!showMobileMenu)}>
        <FiMenu size={24} />
      </div>

      {showMobileMenu && (
        <div className="mobileMenu">
          <div className="mobileMenuItem">
            <select 
              className="selector" 
              style={{ width: '100%' }} 
              value={selectedBiz} 
              onChange={handleBusinessChange}
            >
              {businesses.map((biz) => (
                <option key={biz.id} value={biz.id}>
                  {biz.name}
                </option>
              ))}
              <option value="new">+ Open New Business</option>
            </select>
          </div>
          <div className="mobileMenuItem">
            <FiBell className="icon" />
            <span className="label">Notifications</span>
          </div>
          <div className="mobileMenuItem" onClick={() => navigate('/dashboard/settings')}>
            <FiSettings className="icon" />
            <span className="label">Settings</span>
          </div>
          <div
            className="mobileMenuItem"
            onClick={() => setShowMobileAccountDropdown(!showMobileAccountDropdown)}
          >
            <FiUser className="icon" />
            <span className="label">Account</span>
          </div>
          {showMobileAccountDropdown && (
            <>
              <div className="mobileMenuItem indent" onClick={() => { navigate('/dashboard/employee/pay-statements'); setShowMobileAccountDropdown(false); setShowMobileMenu(false); }}>
                <FiDollarSign className="mobile-dropdown-icon" />
                <span className="label">My Pay Statements</span>
              </div>
              <div className="mobileMenuItem indent" onClick={handleLogout}>
                <FiLogOut className="mobile-dropdown-icon" />
                <span className="label">Log Out</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default HeaderBar;
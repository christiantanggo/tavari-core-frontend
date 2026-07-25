// LoginRedirect - Wrapper to preserve return URL when redirecting to login
import { Navigate, useLocation } from 'react-router-dom';
import { sessionPersistence } from '../../services/SessionPersistence';

const LoginRedirect = () => {
  const location = useLocation();
  const currentPath = `${location.pathname}${location.search}`;
  
  // Store return URL in sessionStorage if not already on login/unlock
  if (currentPath && !currentPath.includes('/login') && !currentPath.includes('/unlock')) {
    sessionStorage.setItem('returnUrl', currentPath);
  }
  
  if (sessionPersistence.isPersistenceEnabled()) {
    return <Navigate to="/unlock" />;
  }
  
  return <Navigate to="/login" />;
};

export default LoginRedirect;






import { clearAllAuthData, clearAuthDataForExplicitLogout } from '../authCleanup';

describe('authCleanup', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('preserves day session data during PIN lock cleanup', () => {
    localStorage.setItem('stayLoggedIn', 'true');
    localStorage.setItem('tavari_persistent_session', '{"refresh_token":"x"}');
    localStorage.setItem('currentBusinessId', 'biz-1');
    localStorage.setItem('sessionStartTime', '123');
    sessionStorage.setItem('unlockReturnPath', '/dashboard/pos/register');

    clearAllAuthData('pin_lock', { preserveDaySession: true });

    expect(localStorage.getItem('stayLoggedIn')).toBe('true');
    expect(localStorage.getItem('tavari_persistent_session')).toContain('refresh_token');
    expect(localStorage.getItem('currentBusinessId')).toBe('biz-1');
    expect(sessionStorage.getItem('unlockReturnPath')).toBe('/dashboard/pos/register');
    expect(localStorage.getItem('posActiveUser')).toBeNull();
  });

  it('clears day session on explicit logout', () => {
    localStorage.setItem('stayLoggedIn', 'true');
    localStorage.setItem('currentBusinessId', 'biz-1');

    clearAuthDataForExplicitLogout('user_logout');

    expect(localStorage.getItem('stayLoggedIn')).toBeNull();
    expect(localStorage.getItem('currentBusinessId')).toBeNull();
  });
});

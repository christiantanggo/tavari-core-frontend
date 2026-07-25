import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const navigateMock = jest.fn();

jest.unstable_mockModule('react', () => {
  return {
    useEffect: (callback) => callback()
  };
});

jest.unstable_mockModule('react-router-dom', () => {
  return {
    useNavigate: () => navigateMock
  };
});

const { default: useAccessProtection } = await import('../../hooks/useAccessProtection.js');

describe('useAccessProtection', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  test('does nothing if user is active and within dates', () => {
    const profile = {
      status: 'active',
      start_date: '2023-01-01',
      end_date: '2030-01-01'
    };

    useAccessProtection(profile);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('redirects if user is inactive', () => {
    const profile = {
      status: 'terminated',
      start_date: '2023-01-01',
      end_date: '2030-01-01'
    };

    useAccessProtection(profile);
    expect(navigateMock).toHaveBeenCalledWith('/locked');
  });

  test('redirects if access is outside start/end range', () => {
    const profile = {
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2026-01-30'
    };

    useAccessProtection(profile);
    expect(navigateMock).toHaveBeenCalledWith('/locked');
  });
});

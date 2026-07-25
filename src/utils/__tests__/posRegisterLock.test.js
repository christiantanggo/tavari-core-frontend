import {
  buildRegisterNavigationState,
  consumePendingRegisterLock,
  persistRegisterLockAfterSale,
  shouldLockRegisterAfterSale,
} from '../posRegisterLock';

describe('posRegisterLock', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('locks after sale when lock_after_sale is enabled', () => {
    expect(shouldLockRegisterAfterSale({ lock_after_sale: true })).toBe(true);
    expect(buildRegisterNavigationState({ lock_after_sale: true })).toEqual({
      shouldLock: true,
    });
  });

  it('locks after sale when pin_required is enabled', () => {
    expect(shouldLockRegisterAfterSale({ pin_required: true })).toBe(true);
  });

  it('persists and consumes pending register lock', () => {
    persistRegisterLockAfterSale({ lock_after_sale: true });
    expect(consumePendingRegisterLock()).toBe(true);
    expect(consumePendingRegisterLock()).toBe(false);
  });
});

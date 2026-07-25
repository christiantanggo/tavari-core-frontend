import {
  formatCountdown,
  isSuspectedDuplicateDecline,
  suggestDuplicateSplit
} from '../helcimDeclineHelpers';

describe('helcimDeclineHelpers', () => {
  it('detects Helcim suspected-duplicate decline text', () => {
    expect(
      isSuspectedDuplicateDecline(
        'Transaction Declined: DECLINED - Suspected duplicate transaction in the last 5 minutes.'
      )
    ).toBe(true);
    expect(isSuspectedDuplicateDecline('Insufficient funds')).toBe(false);
  });

  it('formats countdown as m:ss', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(1000)).toBe('0:01');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(5 * 60 * 1000)).toBe('5:00');
  });

  it('suggests an uneven split that still sums to the blocked total', () => {
    const split = suggestDuplicateSplit(400);
    expect(split).not.toBeNull();
    expect(split.firstCents + split.secondCents).toBe(400);
    expect(split.firstCents).not.toBe(split.secondCents);
    expect(split.firstCents).not.toBe(400);
    expect(split.secondCents).not.toBe(400);
  });

  it('rejects totals that cannot be split into two positive charges', () => {
    expect(suggestDuplicateSplit(0)).toBeNull();
    expect(suggestDuplicateSplit(1)).toBeNull();
    expect(suggestDuplicateSplit(3)).toBeNull();
  });

  it('keeps both halves different from each other for a typical $4 sale', () => {
    const split = suggestDuplicateSplit(400);
    expect(split.firstCents).toBe(240);
    expect(split.secondCents).toBe(160);
  });
});


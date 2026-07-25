import {
  calculateExtensionPrice,
  defaultExtensionPricingSettings,
  EXTENSION_PRICING_UNITS,
  parseExtensionPricingSettings,
  serializeExtensionPricingSettings,
  validateExtensionPricingSettings,
} from '../bookingExtensionPricing';

describe('bookingExtensionPricing', () => {
  it('parses and serializes time_extension settings from ticket_settings', () => {
    const parsed = parseExtensionPricingSettings({
      time_extension: {
        enabled: true,
        unit: 'per_30_minutes',
        price: 45,
        round_up_to_unit: true,
      },
    });

    expect(parsed.enabled).toBe(true);
    expect(parsed.unit).toBe(EXTENSION_PRICING_UNITS.PER_30_MINUTES);
    expect(parsed.price).toBe('45');
    expect(parsed.roundUpToUnit).toBe(true);

    expect(serializeExtensionPricingSettings(parsed)).toEqual({
      enabled: true,
      unit: EXTENSION_PRICING_UNITS.PER_30_MINUTES,
      price: 45,
      round_up_to_unit: true,
    });
  });

  it('calculates per-unit pricing with round-up', () => {
    const settings = {
      ...defaultExtensionPricingSettings(),
      unit: EXTENSION_PRICING_UNITS.PER_30_MINUTES,
      price: '50',
      roundUpToUnit: true,
    };

    expect(calculateExtensionPrice(30, settings)).toBe(50);
    expect(calculateExtensionPrice(31, settings)).toBe(100);
    expect(calculateExtensionPrice(0, settings)).toBe(0);
  });

  it('calculates flat pricing regardless of minutes', () => {
    const settings = {
      ...defaultExtensionPricingSettings(),
      unit: EXTENSION_PRICING_UNITS.FLAT,
      price: '75',
    };

    expect(calculateExtensionPrice(15, settings)).toBe(75);
    expect(calculateExtensionPrice(90, settings)).toBe(75);
  });

  it('validates enabled pricing requires a numeric price', () => {
    expect(validateExtensionPricingSettings(defaultExtensionPricingSettings()).ok).toBe(false);
    expect(validateExtensionPricingSettings({
      ...defaultExtensionPricingSettings(),
      price: '25',
    }).ok).toBe(true);
    expect(validateExtensionPricingSettings({
      enabled: false,
      price: '',
    }).ok).toBe(true);
  });
});

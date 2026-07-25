import { parseActivityTicketSettings } from './bookingTicketAssignment';

export const EXTENSION_PRICING_UNITS = {
  PER_MINUTE: 'per_minute',
  PER_15_MINUTES: 'per_15_minutes',
  PER_30_MINUTES: 'per_30_minutes',
  PER_HOUR: 'per_hour',
  FLAT: 'flat',
};

const UNIT_MINUTES = {
  [EXTENSION_PRICING_UNITS.PER_MINUTE]: 1,
  [EXTENSION_PRICING_UNITS.PER_15_MINUTES]: 15,
  [EXTENSION_PRICING_UNITS.PER_30_MINUTES]: 30,
  [EXTENSION_PRICING_UNITS.PER_HOUR]: 60,
  [EXTENSION_PRICING_UNITS.FLAT]: null,
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const defaultExtensionPricingSettings = () => ({
  enabled: true,
  unit: EXTENSION_PRICING_UNITS.PER_30_MINUTES,
  price: '',
  roundUpToUnit: true,
});

export const parseExtensionPricingSettings = (ticketSettingsRaw) => {
  const parsed = parseActivityTicketSettings(ticketSettingsRaw);
  const raw = parsed?.time_extension && typeof parsed.time_extension === 'object'
    ? parsed.time_extension
    : {};

  const unit = Object.values(EXTENSION_PRICING_UNITS).includes(raw.unit)
    ? raw.unit
    : EXTENSION_PRICING_UNITS.PER_30_MINUTES;

  return {
    enabled: raw.enabled !== false,
    unit,
    price: raw.price != null && raw.price !== '' ? String(raw.price) : '',
    roundUpToUnit: raw.round_up_to_unit !== false,
  };
};

export const serializeExtensionPricingSettings = (settings = {}) => {
  const unit = Object.values(EXTENSION_PRICING_UNITS).includes(settings.unit)
    ? settings.unit
    : EXTENSION_PRICING_UNITS.PER_30_MINUTES;
  const price = roundMoney(settings.price);

  return {
    enabled: settings.enabled !== false,
    unit,
    price: Number.isFinite(price) && price >= 0 ? price : null,
    round_up_to_unit: settings.roundUpToUnit !== false,
  };
};

export const validateExtensionPricingSettings = (settings = {}) => {
  if (settings.enabled === false) {
    return { ok: true };
  }

  if (settings.price === '' || settings.price == null) {
    return { ok: false, message: 'Enter an extended time price for this activity (use 0 for no charge).' };
  }

  const price = roundMoney(settings.price);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, message: 'Enter a valid extended time price (zero or greater).' };
  }

  return { ok: true };
};

export const formatExtensionPricingUnitLabel = (unit) => {
  switch (unit) {
    case EXTENSION_PRICING_UNITS.PER_MINUTE:
      return 'Per minute';
    case EXTENSION_PRICING_UNITS.PER_15_MINUTES:
      return 'Per 15 minutes';
    case EXTENSION_PRICING_UNITS.PER_30_MINUTES:
      return 'Per 30 minutes';
    case EXTENSION_PRICING_UNITS.PER_HOUR:
      return 'Per hour';
    case EXTENSION_PRICING_UNITS.FLAT:
      return 'Flat rate per extension';
    default:
      return 'Per 30 minutes';
  }
};

export const formatExtensionPricingSummary = (settingsInput = {}, addedMinutes = 0) => {
  const settings = settingsInput?.unit
    ? settingsInput
    : parseExtensionPricingSettings(settingsInput);

  if (settings.enabled === false) {
    return 'Extended time pricing is disabled for this activity.';
  }

  const price = roundMoney(settings.price);
  if (!Number.isFinite(price)) {
    return 'No extended time price configured.';
  }

  const unitLabel = formatExtensionPricingUnitLabel(settings.unit).toLowerCase();
  if (settings.unit === EXTENSION_PRICING_UNITS.FLAT) {
    return `$${price.toFixed(2)} flat per extension`;
  }

  const calculated = calculateExtensionPrice(addedMinutes, settings);
  const base = `$${price.toFixed(2)} ${unitLabel}`;
  if (addedMinutes > 0) {
    return `${base} · ${addedMinutes} min = $${calculated.toFixed(2)}`;
  }
  return base;
};

/** Calculate charge for an extension in dollars. Returns 0 when disabled or unset. */
export const calculateExtensionPrice = (addedMinutes, settingsInput = {}) => {
  const settings = settingsInput?.unit
    ? settingsInput
    : parseExtensionPricingSettings(settingsInput);

  if (settings.enabled === false) {
    return 0;
  }

  const price = roundMoney(settings.price);
  if (!Number.isFinite(price)) {
    return 0;
  }

  if (settings.unit === EXTENSION_PRICING_UNITS.FLAT) {
    return price;
  }

  const minutes = Math.max(0, Number.parseInt(addedMinutes, 10) || 0);
  if (minutes <= 0) {
    return 0;
  }

  const unitMinutes = UNIT_MINUTES[settings.unit] || 30;
  const units = settings.roundUpToUnit !== false
    ? Math.ceil(minutes / unitMinutes)
    : minutes / unitMinutes;

  return roundMoney(units * price);
};

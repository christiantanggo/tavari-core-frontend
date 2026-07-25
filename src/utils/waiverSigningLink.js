import WaiverSettingsService from '../services/Waivers/WaiverSettingsService';
import waiverTemplateService from '../services/Waivers/WaiverTemplateService';
import { resolveDefaultWaiverTemplate } from './waiverTemplateSelection';

export function buildPublicWaiverSigningPath(businessId, templateKey) {
  if (!businessId) return '/';
  const key = String(templateKey || '').trim();
  return key ? `/waiver/${businessId}/${encodeURIComponent(key)}` : `/waiver/${businessId}`;
}

export function buildWaiverFromBookingPath(businessId, templateKey) {
  if (!businessId) return '/';
  const key = String(templateKey || '').trim();
  return key
    ? `/waiver-from-booking/${businessId}/${encodeURIComponent(key)}`
    : `/waiver-from-booking/${businessId}`;
}

export function buildWaiverSigningUrl(origin, businessId, templateKey, kind = 'waiver_signing') {
  const base = String(origin || '').replace(/\/$/, '');
  const path =
    kind === 'waiver_from_booking'
      ? buildWaiverFromBookingPath(businessId, templateKey)
      : buildPublicWaiverSigningPath(businessId, templateKey);
  return base ? `${base}${path}` : path;
}

/**
 * Resolve active waiver template(s) for public signing links (default station template first).
 */
export async function resolveWaiverSigningTargets(businessId) {
  if (!businessId) {
    return { targets: [], error: 'Business ID is required' };
  }

  WaiverSettingsService.setBusinessId(businessId);
  waiverTemplateService.setBusinessId(businessId);

  const settings = await WaiverSettingsService.getGlobalSettings();
  const templates = await waiverTemplateService.getTemplates({ isActive: true });
  const resolved = resolveDefaultWaiverTemplate(templates, settings);

  if (resolved.stationMode === 'multi' && resolved.stationTemplateOptions.length > 1) {
    return {
      targets: resolved.stationTemplateOptions.map((opt) => ({
        templateKey: opt.templateKey,
        label:
          opt.displayName ||
          opt.template?.waiver_title ||
          opt.template?.template_name ||
          opt.templateKey,
      })),
    };
  }

  if (resolved.resolvedTemplate?.template_key) {
    const t = resolved.resolvedTemplate;
    return {
      targets: [
        {
          templateKey: t.template_key,
          label: t.waiver_title || t.template_name || t.template_key,
        },
      ],
    };
  }

  return { targets: [], error: 'No active waiver templates found.' };
}

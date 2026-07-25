export function latestTemplatesByKey(templates) {
  const seen = new Set();
  const latest = [];
  for (const template of Array.isArray(templates) ? templates : []) {
    const key = template?.template_key || template?.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    latest.push(template);
  }
  return latest;
}

export function buildStationTemplateOptions(templates, settings) {
  const configured = Array.isArray(settings?.waiver_station_templates)
    ? settings.waiver_station_templates
    : [];

  return configured
    .map((item) => {
      const match = (Array.isArray(templates) ? templates : []).find((template) =>
        (item?.templateId && template.id === item.templateId) ||
        (item?.templateKey && template.template_key === item.templateKey)
      );
      if (!match) return null;

      const displayName =
        String(item?.displayName || '').trim() ||
        String(match.waiver_title || '').trim() ||
        String(match.template_name || '').trim() ||
        String(match.template_key || '').trim();

      return {
        templateId: match.id,
        templateKey: match.template_key,
        displayName,
        template: match
      };
    })
    .filter(Boolean);
}

export function resolveDefaultWaiverTemplate(templates, settings) {
  const latestTemplates = latestTemplatesByKey(templates);
  const stationMode = settings?.waiver_station_mode === 'multi' ? 'multi' : 'single';
  const stationTemplateOptions = buildStationTemplateOptions(latestTemplates, settings);
  const defaultTemplateKey = String(settings?.waiver_station_default_template_key || '').trim();

  const resolvedTemplate =
    (stationMode === 'multi' && stationTemplateOptions.length === 1
      ? stationTemplateOptions[0]?.template
      : null) ||
    latestTemplates.find((item) => item.template_key === defaultTemplateKey) ||
    stationTemplateOptions[0]?.template ||
    latestTemplates[0] ||
    null;

  return {
    latestTemplates,
    stationMode,
    stationTemplateOptions,
    defaultTemplateKey,
    resolvedTemplate
  };
}

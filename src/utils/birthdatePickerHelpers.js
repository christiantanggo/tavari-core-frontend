export function birthdatePartsToIso(parts) {
  const year = String(parts?.year || '').trim();
  const month = String(parts?.month || '').trim();
  const day = String(parts?.day || '').trim();
  if (!year || !month || !day) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function isoToBirthdateParts(iso) {
  if (!iso) return { year: '', month: '', day: '' };
  const raw = String(iso).split('T')[0];
  const [year, month, day] = raw.split('-');
  return {
    year: year || '',
    month: month || '',
    day: day || '',
  };
}

import React from 'react';
import { formatPositionDisplay } from '../../utils/positionCatalog';
import { useBusinessPositions } from '../../hooks/useBusinessPositions';

/**
 * Renders a stored position string; values not in HR catalog → "Unknown".
 * Pass `nameSet` from parent when already loaded to avoid an extra fetch.
 */
export default function PositionLabel({
  businessId,
  value,
  nameSet: nameSetProp,
  emptyFallback = '',
  unknownLabel = 'Unknown'
}) {
  const shouldFetch = !nameSetProp && Boolean(businessId);
  const { nameSet } = useBusinessPositions(shouldFetch ? businessId : null);
  const ns = nameSetProp ?? (shouldFetch ? nameSet : null);
  const out = formatPositionDisplay(value, ns);
  if (!out) return <>{emptyFallback}</>;
  if (out === 'Unknown') return <>{unknownLabel}</>;
  return <>{out}</>;
}

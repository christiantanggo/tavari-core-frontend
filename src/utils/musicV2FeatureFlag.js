// utils/musicV2FeatureFlag.js
// Feature flag utilities for Music V2 system

import React from 'react';
import { supabase } from '../supabaseClient';

/**
 * Check if Music V2 is enabled for a business
 * @param {string} businessId - Business ID
 * @returns {Promise<boolean>}
 */
export async function isMusicV2Enabled(businessId) {
  if (!businessId) {
    return false;
  }

  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('music_v2_enabled')
      .eq('id', businessId)
      .single();

    if (error || !business) {
      return false;
    }

    return business.music_v2_enabled === true;
  } catch (error) {
    console.error('Error checking Music V2 feature flag:', error);
    return false;
  }
}

/**
 * Enable Music V2 for a business
 * @param {string} businessId - Business ID
 * @returns {Promise<boolean>}
 */
export async function enableMusicV2(businessId) {
  if (!businessId) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('businesses')
      .update({ music_v2_enabled: true })
      .eq('id', businessId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.error('Error enabling Music V2:', error);
    return false;
  }
}

/**
 * Disable Music V2 for a business
 * @param {string} businessId - Business ID
 * @returns {Promise<boolean>}
 */
export async function disableMusicV2(businessId) {
  if (!businessId) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('businesses')
      .update({ music_v2_enabled: false })
      .eq('id', businessId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.error('Error disabling Music V2:', error);
    return false;
  }
}

/**
 * Hook to check feature flag (for React components)
 * @param {string} businessId - Business ID
 * @returns {[boolean, boolean]} - [isEnabled, isLoading]
 */
export function useMusicV2FeatureFlag(businessId) {
  const [isEnabled, setIsEnabled] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!businessId) {
      setIsEnabled(false);
      setIsLoading(false);
      return;
    }

    isMusicV2Enabled(businessId).then(enabled => {
      setIsEnabled(enabled);
      setIsLoading(false);
    });
  }, [businessId]);

  return [isEnabled, isLoading];
}


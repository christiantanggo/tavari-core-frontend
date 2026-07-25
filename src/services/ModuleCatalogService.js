// ModuleCatalogService.js
// Service for fetching all modules (activated + non-activated) with usage stats
import { supabase } from '../supabaseClient';

/** Shown on the home marketplace if `app_modules` is missing a row (e.g. migration not applied on an env). */
const MODULE_CATALOG_FALLBACK = [
  {
    module_key: 'vending',
    module_name: 'Tavari Vending',
    description:
      'Cloud vending devices, kiosk links, optional catalog mapping. Standalone add-on; Tavari POS is not required.',
    icon: 'FiCpu',
    enabled_by_default: false,
    module_category: 'Sales'
  },
  {
    module_key: 'reminders',
    module_name: 'Tavari Reminder',
    description:
      'Schedule employee email and portal reminders with complete and snooze actions.',
    icon: 'FiBell',
    enabled_by_default: false,
    module_category: 'Operations'
  },
  {
    module_key: 'tavari_apis',
    module_name: 'Tavari APIs',
    description:
      'Publish read-only business data to external websites and apps.',
    icon: 'FiGlobe',
    enabled_by_default: false,
    module_category: 'Integrations'
  },
  {
    module_key: 'invoices',
    module_name: 'Tavari Invoices',
    description:
      'Send invoices, collect online payments, and build tax summary invoices from paid receipts and bookings.',
    icon: 'FiFileText',
    enabled_by_default: false,
    module_category: 'Sales'
  },
  {
    module_key: 'funding',
    module_name: 'Tavari Funding',
    description:
      'Business plans, loan and grant applications, scenarios, collaborators, and Canadian funding program alerts via Deductly.',
    icon: 'FiDollarSign',
    enabled_by_default: false,
    module_category: 'Finance'
  },
  {
    module_key: 'gift_cards',
    module_name: 'Gift Cards',
    description:
      'Sell and redeem digital gift cards and prepaid item vouchers across POS, booking, portals, and the customer app.',
    icon: 'FiGift',
    enabled_by_default: false,
    module_category: 'Sales'
  },
  {
    module_key: 'deals',
    module_name: 'Deals & Coupons',
    description:
      'Create website deals, printable coupons, bundles, and promotional vouchers that are not prepaid gift cards.',
    icon: 'FiTag',
    enabled_by_default: false,
    module_category: 'Marketing'
  }
];

class ModuleCatalogService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  /**
   * Get all modules (catalog) with activation status and usage stats for current business
   * Returns: Array of modules with isEnabled, usageCount, lastUsed, etc.
   */
  async getAllModulesWithStatus() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    try {
      // Get all available modules from catalog
      const { data: allModules, error: catalogError } = await supabase
        .from('app_modules')
        .select('*')
        .order('module_category', { ascending: true })
        .order('module_name', { ascending: true });

      if (catalogError) {
        throw catalogError;
      }

      // Get business module usage (activated modules with usage stats)
      const { data: businessModules, error: usageError } = await supabase
        .from('business_module_usage')
        .select('*')
        .eq('business_id', this.businessId);

      if (usageError) {
        throw usageError;
      }

      // Create a map of business modules by module_key
      const businessModulesMap = {};
      businessModules?.forEach(bm => {
        businessModulesMap[bm.module_key] = bm;
      });

      // Merge catalog with business status (hide private personal module from marketplace)
      const modulesWithStatus = (allModules || [])
        .filter((module) => (module.module_key || '').toLowerCase() !== 'dividend_income')
        .map((module) => {
        const businessModule = businessModulesMap[module.module_key];
        return {
          ...module,
          isEnabled: businessModule?.enabled === true,
          usageCount: businessModule?.usage_count || 0,
          lastUsed: businessModule?.last_used || null,
          trialEnabled: businessModule?.trial_enabled || false,
          trialExpiresAt: businessModule?.trial_expires_at || null,
          businessModuleId: businessModule?.id || null
        };
      });

      // IMPORTANT: Also include enabled modules from business_module_usage that might not be in app_modules catalog
      // This ensures modules that were enabled before being added to the catalog still appear
      // BUT: Exclude System Settings and Reports - they're fixed items, not modules
      businessModules?.forEach(businessModule => {
        if (businessModule.enabled === true) {
          const moduleKey = (businessModule.module_key || '').toLowerCase();
          const moduleName = ((businessModule.module_name || '') || '').toLowerCase();
          
          // Skip System Settings and Reports - they're fixed sidebar items, not modules
          if (moduleKey === 'settings' || 
              moduleKey === 'system_settings' || 
              moduleKey === 'system-settings' ||
              moduleKey === 'reports' ||
              moduleKey === 'system' ||
              moduleKey === 'dividend_income' ||
              moduleName.includes('system settings') ||
              (moduleName.includes('settings') && !moduleName.includes('module') && !moduleName.includes('app'))) {
            return; // Skip this module
          }
          
          // Check if this module is already in the list
          const existingModule = modulesWithStatus.find(m => m.module_key === businessModule.module_key);
          if (!existingModule) {
            // Module is enabled but not in catalog - add it with basic info
            modulesWithStatus.push({
              module_key: businessModule.module_key,
              module_name: businessModule.module_name || businessModule.module_key,
              description: null,
              icon: null,
              enabled_by_default: false,
              module_category: null,
              isEnabled: true,
              usageCount: businessModule.usage_count || 0,
              lastUsed: businessModule.last_used || null,
              trialEnabled: businessModule.trial_enabled || false,
              trialExpiresAt: businessModule.trial_expires_at || null,
              businessModuleId: businessModule.id || null
            });
          }
        }
      });

      MODULE_CATALOG_FALLBACK.forEach((fallback) => {
        if (!modulesWithStatus.some((m) => m.module_key === fallback.module_key)) {
          const businessModule = businessModulesMap[fallback.module_key];
          modulesWithStatus.push({
            ...fallback,
            isEnabled: businessModule?.enabled === true,
            usageCount: businessModule?.usage_count || 0,
            lastUsed: businessModule?.last_used || null,
            trialEnabled: businessModule?.trial_enabled || false,
            trialExpiresAt: businessModule?.trial_expires_at || null,
            businessModuleId: businessModule?.id || null
          });
        }
      });

      return modulesWithStatus;
    } catch (error) {
      console.error('Error fetching modules with status:', error);
      throw error;
    }
  }

  /**
   * Get activated modules only (ordered by usage)
   */
  async getActivatedModules() {
    const allModules = await this.getAllModulesWithStatus();
    return allModules
      .filter(m => m.isEnabled)
      .sort((a, b) => {
        // Sort by usage count (desc), then last used (desc), then name
        if (b.usageCount !== a.usageCount) {
          return b.usageCount - a.usageCount;
        }
        if (b.lastUsed && a.lastUsed) {
          return new Date(b.lastUsed) - new Date(a.lastUsed);
        }
        if (b.lastUsed && !a.lastUsed) return -1;
        if (a.lastUsed && !b.lastUsed) return 1;
        return a.module_name.localeCompare(b.module_name);
      });
  }

  /**
   * Get non-activated modules only
   */
  async getNonActivatedModules() {
    const allModules = await this.getAllModulesWithStatus();
    return allModules.filter(m => !m.isEnabled);
  }

  /**
   * Track module usage (increment counter and update last_used)
   * Silently fails if there's an error - usage tracking shouldn't break the app
   */
  async trackModuleUsage(moduleKey) {
    if (!this.businessId || !moduleKey) {
      return; // Silently return if missing required params
    }

    try {
      const { error } = await supabase.rpc('appbuilder_update_module_usage', {
        business_uuid: this.businessId,
        module_key: moduleKey,
        increment_count: 1
      });

      if (error) {
        // Silently ignore - usage tracking is non-critical and errors are being fixed
        // Don't log to avoid console spam
      }
    } catch (error) {
      // Silently catch - usage tracking is non-critical
      if (process.env.NODE_ENV === 'development') {
        console.warn('Module usage tracking failed (non-critical):', error.message);
      }
    }
  }

  /**
   * Get module dashboard route
   */
  getModuleDashboardRoute(moduleKey) {
    const routes = {
      'pos': '/dashboard/pos/register',
      'music': '/dashboard/music/dashboard',
      'mail': '/dashboard/mail/dashboard',
      'hr': '/dashboard/hr/dashboard',
      'digital_signage': '/dashboard/digital-signage',
      'recipe_builder': '/dashboard/recipe-builder',
      'loyalty': '/dashboard/loyalty',
      'scheduling': '/dashboard/scheduling',
      'dining': '/dashboard/dining/dashboard',
      'bookings': '/dashboard/bookings',
      'accounting': '/dashboard/accounting',
      'file_storage': '/dashboard/file-storage',
      'liquor': '/dashboard/liquor/inventory',
      'inbox': '/dashboard/inbox',
      'appbuilder': '/dashboard/appbuilder',
      'waivers': '/dashboard/waivers',
      'social_media': '/dashboard/social-media',
      'voice_agent': '/dashboard/voice-agent',
      'custom_voice_agent': '/dashboard/custom-voice-agent',
      'reputation': '/dashboard/reputation',
      'tasks': '/dashboard/tasks',
      'forms': '/dashboard/forms',
      'reminders': '/dashboard/reminders',
      'vending': '/dashboard/vending',
      'tavari_apis': '/dashboard/tavari-apis',
      'invoices': '/dashboard/invoices',
      'funding': '/dashboard/funding',
      'gift_cards': '/dashboard/gift-cards',
      'deals': '/dashboard/deals',
      'dividend_income': '/dashboard/dividend-income',
      'power_bank': '/dashboard/power-bank'
    };
    return routes[moduleKey] || '/dashboard/home';
  }
}

export default new ModuleCatalogService();


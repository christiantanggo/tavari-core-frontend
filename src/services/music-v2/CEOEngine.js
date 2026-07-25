// services/music-v2/CEOEngine.js
// Customer Experience Optimizer - Rules engine for automatic playlist/ad optimization

import { supabase } from '../../supabaseClient';

class CEOEngine {
  constructor() {
    this.rulesCache = new Map();
  }

  /**
   * Load CEO rules for a location
   * @param {string} locationId - Location ID
   * @returns {Promise<Array>}
   */
  async loadRules(locationId) {
    try {
      const { data: rules, error } = await supabase
        .from('music_v2_ceo_rules')
        .select('*')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('priority', { ascending: false });

      if (error) throw error;

      return rules || [];
    } catch (error) {
      console.error('Error loading CEO rules:', error);
      throw error;
    }
  }

  /**
   * Evaluate rules and return the best match
   * @param {string} locationId - Location ID
   * @param {Date} currentTime - Current date/time
   * @returns {Promise<{playlistType: string, adFrequency: string, contentRating: string} | null>}
   */
  async evaluateRules(locationId, currentTime = new Date()) {
    try {
      const rules = await this.loadRules(locationId);
      
      // Evaluate rules in priority order (highest first)
      for (const rule of rules) {
        if (this.evaluateCondition(rule, currentTime)) {
          return {
            playlistType: rule.action_playlist_type,
            adFrequency: rule.action_ad_frequency,
            contentRating: rule.action_content_rating
          };
        }
      }

      return null; // No matching rule
    } catch (error) {
      console.error('Error evaluating CEO rules:', error);
      return null;
    }
  }

  /**
   * Evaluate a single rule condition
   * @param {object} rule - CEO rule
   * @param {Date} currentTime - Current date/time
   * @returns {boolean}
   */
  evaluateCondition(rule, currentTime) {
    const condition = rule.condition_value;
    
    switch (rule.condition_type) {
      case 'time_range':
        return this.evaluateTimeRange(condition, currentTime);
      
      case 'day_of_week':
        return this.evaluateDayOfWeek(condition, currentTime);
      
      case 'operating_hours':
        return this.evaluateOperatingHours(condition, currentTime);
      
      case 'day_and_time':
        return this.evaluateDayAndTime(condition, currentTime);
      
      default:
        return false;
    }
  }

  /**
   * Evaluate time range condition
   * @param {object} condition - { start_hour: number, end_hour: number }
   * @param {Date} currentTime - Current date/time
   * @returns {boolean}
   */
  evaluateTimeRange(condition, currentTime) {
    const currentHour = currentTime.getHours();
    const startHour = condition.start_hour || 0;
    const endHour = condition.end_hour || 23;
    
    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour < endHour;
    } else {
      // Overnight range (e.g., 22:00 - 02:00)
      return currentHour >= startHour || currentHour < endHour;
    }
  }

  /**
   * Evaluate day of week condition
   * @param {object} condition - { days: [0,1,2,...] } (0=Sunday, 6=Saturday)
   * @param {Date} currentTime - Current date/time
   * @returns {boolean}
   */
  evaluateDayOfWeek(condition, currentTime) {
    const currentDay = currentTime.getDay();
    const allowedDays = condition.days || [];
    return allowedDays.includes(currentDay);
  }

  /**
   * Evaluate operating hours condition
   * @param {object} condition - { before_open: boolean, after_close: boolean, during_hours: boolean }
   * @param {Date} currentTime - Current date/time
   * @returns {boolean}
   */
  evaluateOperatingHours(condition, currentTime) {
    // This would need operating hours from location
    // For now, return true if condition matches
    // Full implementation would check actual operating hours
    return true;
  }

  /**
   * Evaluate day and time combination
   * @param {object} condition - { days: [0,1,2], start_hour: number, end_hour: number }
   * @param {Date} currentTime - Current date/time
   * @returns {boolean}
   */
  evaluateDayAndTime(condition, currentTime) {
    const currentDay = currentTime.getDay();
    const currentHour = currentTime.getHours();
    const allowedDays = condition.days || [];
    const startHour = condition.start_hour || 0;
    const endHour = condition.end_hour || 23;
    
    if (!allowedDays.includes(currentDay)) {
      return false;
    }
    
    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour < endHour;
    } else {
      return currentHour >= startHour || currentHour < endHour;
    }
  }

  /**
   * Compile rules into schedule blocks
   * This takes CEO rules and converts them to schedule blocks for easier processing
   * @param {string} locationId - Location ID
   * @returns {Promise<Array>} - Array of compiled schedule blocks
   */
  async compileRulesToSchedule(locationId) {
    try {
      const rules = await this.loadRules(locationId);
      const compiledBlocks = [];

      // For each rule, create schedule blocks
      for (const rule of rules) {
        const blocks = this.ruleToScheduleBlocks(rule);
        compiledBlocks.push(...blocks);
      }

      return compiledBlocks;
    } catch (error) {
      console.error('Error compiling rules:', error);
      throw error;
    }
  }

  /**
   * Convert a rule to schedule blocks
   * @param {object} rule - CEO rule
   * @returns {Array} - Array of schedule block objects
   */
  ruleToScheduleBlocks(rule) {
    const blocks = [];
    const condition = rule.condition_value;

    switch (rule.condition_type) {
      case 'time_range':
        // Creates blocks for all days with this time range
        for (let day = 0; day < 7; day++) {
          blocks.push({
            day_of_week: day,
            start_hour: condition.start_hour || 0,
            end_hour: condition.end_hour || 23,
            playlist_type: rule.action_playlist_type,
            ad_frequency: rule.action_ad_frequency,
            content_rating: rule.action_content_rating
          });
        }
        break;

      case 'day_of_week':
        // Creates blocks for specified days, all hours
        const days = condition.days || [];
        days.forEach(day => {
          blocks.push({
            day_of_week: day,
            start_hour: 0,
            end_hour: 23,
            playlist_type: rule.action_playlist_type,
            ad_frequency: rule.action_ad_frequency,
            content_rating: rule.action_content_rating
          });
        });
        break;

      case 'day_and_time':
        // Creates blocks for specified days and time range
        const allowedDays = condition.days || [];
        allowedDays.forEach(day => {
          blocks.push({
            day_of_week: day,
            start_hour: condition.start_hour || 0,
            end_hour: condition.end_hour || 23,
            playlist_type: rule.action_playlist_type,
            ad_frequency: rule.action_ad_frequency,
            content_rating: rule.action_content_rating
          });
        });
        break;
    }

    return blocks;
  }

  /**
   * Create a new CEO rule
   * @param {string} locationId - Location ID
   * @param {object} ruleData - Rule data
   * @returns {Promise<object>}
   */
  async createRule(locationId, ruleData) {
    try {
      const { data, error } = await supabase
        .from('music_v2_ceo_rules')
        .insert({
          location_id: locationId,
          rule_name: ruleData.rule_name,
          condition_type: ruleData.condition_type,
          condition_value: ruleData.condition_value,
          action_playlist_type: ruleData.action_playlist_type,
          action_ad_frequency: ruleData.action_ad_frequency,
          action_content_rating: ruleData.action_content_rating,
          priority: ruleData.priority || 0,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating CEO rule:', error);
      throw error;
    }
  }

  /**
   * Update a CEO rule
   * @param {string} ruleId - Rule ID
   * @param {object} updates - Updates to apply
   * @returns {Promise<object>}
   */
  async updateRule(ruleId, updates) {
    try {
      const { data, error } = await supabase
        .from('music_v2_ceo_rules')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', ruleId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating CEO rule:', error);
      throw error;
    }
  }

  /**
   * Delete a CEO rule
   * @param {string} ruleId - Rule ID
   * @returns {Promise<void>}
   */
  async deleteRule(ruleId) {
    try {
      const { error } = await supabase
        .from('music_v2_ceo_rules')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting CEO rule:', error);
      throw error;
    }
  }
}

export const ceoEngine = new CEOEngine();
export default ceoEngine;



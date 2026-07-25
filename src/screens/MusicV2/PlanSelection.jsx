// screens/MusicV2/PlanSelection.jsx
// Plan selection screen - allows businesses to choose their plan

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiCheck, FiMusic, FiStar, FiAward } from 'react-icons/fi';
import { useBusiness } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import { pricingEngine } from '../../services/music-v2/PricingEngine';
import toast from 'react-hot-toast';

const PlanSelection = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const [plans, setPlans] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [pricingOptions, setPricingOptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (business?.id) {
      loadData();
    }
  }, [business?.id]);

  const loadData = async () => {
    try {
      // Load all active plans
      const { data: plansData, error: plansError } = await supabase
        .from('music_v2_plans')
        .select('*')
        .eq('is_active', true);
      
      // Sort plans: Standard, Plus, Premium
      const planOrder = { 'standard': 1, 'plus': 2, 'premium': 3 };
      const sortedPlans = (plansData || []).sort((a, b) => {
        return (planOrder[a.plan_key] || 999) - (planOrder[b.plan_key] || 999);
      });

      if (plansError) throw plansError;
      setPlans(sortedPlans);

      // Load current location
      const { data: locationData, error: locationError } = await supabase
        .from('music_v2_locations')
        .select(`
          *,
          plan:music_v2_plans(*)
        `)
        .eq('business_id', business.id)
        .maybeSingle();

      if (locationError && locationError.code !== 'PGRST116') {
        throw locationError;
      }

      if (locationData) {
        setCurrentLocation(locationData);
        
        // Load pricing options for each plan
        const pricing = {};
        for (const plan of sortedPlans) {
          try {
            const options = await pricingEngine.getPricingOptions(plan.plan_key);
            pricing[plan.plan_key] = options;
          } catch (err) {
            console.warn(`Error loading pricing for ${plan.plan_key}:`, err);
          }
        }
        setPricingOptions(pricing);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load plans');
      setLoading(false);
    }
  };

  const handlePlanSelect = async (planId, planKey) => {
    if (saving) return;
    
    if (!currentLocation) {
      toast.error('Location not found. Please refresh the page.');
      return;
    }

    setSaving(true);
    
    try {
      const { error } = await supabase
        .from('music_v2_locations')
        .update({
          plan_id: planId,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentLocation.id);

      if (error) throw error;

      toast.success('Plan updated successfully!');
      
      // Reload location data
      await loadData();
      
      // Navigate back after a short delay
      setTimeout(() => {
        navigate('/dashboard/music-v2/dashboard');
      }, 1000);
    } catch (error) {
      console.error('Error updating plan:', error);
      toast.error('Failed to update plan');
    } finally {
      setSaving(false);
    }
  };

  const getPlanIcon = (planKey) => {
    switch (planKey) {
      case 'standard':
        return <FiMusic />;
      case 'plus':
        return <FiStar />;
      case 'premium':
        return <FiAward />;
      default:
        return <FiMusic />;
    }
  };

  const getPlanColor = (planKey) => {
    switch (planKey) {
      case 'standard':
        return '#28a745';
      case 'plus':
        return '#007bff';
      case 'premium':
        return '#ffc107';
      default:
        return '#6c757d';
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading plans...</div>
      </div>
    );
  }

  const currentPlanKey = currentLocation?.plan?.plan_key;

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <button
        onClick={() => navigate('/dashboard/music-v2/dashboard')}
        style={{
          marginBottom: '1rem',
          padding: '0.5rem 1rem',
          backgroundColor: '#6c757d',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}
      >
        <FiArrowLeft /> Back to Dashboard
      </button>

      <h1 style={{ marginBottom: '0.5rem' }}>Select Your Music Plan</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Choose the plan that best fits your business needs. You can change your plan at any time.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        {plans.map((plan) => {
          const isCurrent = currentPlanKey === plan.plan_key;
          const color = getPlanColor(plan.plan_key);
          const pricing = pricingOptions[plan.plan_key] || [];

          return (
            <div
              key={plan.id}
              style={{
                border: `2px solid ${isCurrent ? color : '#ddd'}`,
                borderRadius: '8px',
                padding: '1.5rem',
                backgroundColor: '#fff',
                position: 'relative',
                opacity: saving ? 0.6 : 1
              }}
            >
              {isCurrent && (
                <div style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  backgroundColor: color,
                  color: 'white',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '12px',
                  fontSize: '0.875rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}>
                  <FiCheck /> Current
                </div>
              )}

              <div style={{
                fontSize: '2rem',
                color: color,
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                {getPlanIcon(plan.plan_key)}
                <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{plan.name}</h2>
              </div>

              <p style={{ color: '#666', marginBottom: '1rem', minHeight: '3rem' }}>
                {plan.description}
              </p>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Features:</div>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#666' }}>
                  <li>
                    {plan.allows_mainstream ? '✓ Mainstream licensed music' : '✗ Royalty-free only'}
                  </li>
                  <li>
                    {plan.allows_premium_content ? '✓ Premium upscale content' : '✗ Standard content only'}
                  </li>
                  <li>
                    {plan.base_devices_included} device{plan.base_devices_included !== 1 ? 's' : ''} included
                  </li>
                </ul>
              </div>

              <div style={{
                borderTop: '1px solid #eee',
                paddingTop: '1rem',
                marginTop: '1rem'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Pricing Options:</div>
                <div style={{ fontSize: '0.875rem', color: '#666' }}>
                  {pricing.length > 0 ? (
                    <div>
                      {pricing.slice(0, 3).map((option, idx) => (
                        <div key={idx} style={{ marginBottom: '0.25rem' }}>
                          • {option.displayText}
                        </div>
                      ))}
                      {pricing.length > 3 && (
                        <div style={{ fontStyle: 'italic' }}>
                          + {pricing.length - 3} more options
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>Loading pricing...</div>
                  )}
                </div>
              </div>

              <button
                onClick={() => handlePlanSelect(plan.id, plan.plan_key)}
                disabled={isCurrent || saving}
                style={{
                  width: '100%',
                  marginTop: '1rem',
                  padding: '0.75rem',
                  backgroundColor: isCurrent ? '#6c757d' : color,
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isCurrent || saving ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  opacity: isCurrent || saving ? 0.6 : 1
                }}
              >
                {saving ? 'Saving...' : isCurrent ? 'Current Plan' : 'Select Plan'}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{
        backgroundColor: '#f8f9fa',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #dee2e6'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Need Help Choosing?</h3>
        <p style={{ margin: 0, color: '#666', fontSize: '0.875rem' }}>
          <strong>Standard:</strong> Perfect for businesses wanting quality background music without licensing concerns.<br />
          <strong>Plus:</strong> Great balance of variety and cost with mainstream music included.<br />
          <strong>Premium:</strong> Ideal for high-end venues with full premium experience including upscale content.
        </p>
      </div>
    </div>
  );
};

export default PlanSelection;

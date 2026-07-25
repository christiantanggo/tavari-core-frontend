import toast from 'react-hot-toast';
import { supabase } from '../supabaseClient';

export async function deleteTrainingWithManagerPin({ businessId, trainingItem, hardDelete = false }) {
  if (!businessId || !trainingItem?.id) return false;

  const confirmed = window.confirm(`Delete training "${trainingItem.title}"? It will be removed from HR Training and detached from tasks.`);
  if (!confirmed) return false;

  const managerPin = window.prompt('Enter manager PIN to delete this training:');
  if (managerPin === null) return false;
  if (!managerPin.trim()) {
    toast.error('Manager PIN is required');
    return false;
  }

  const { data, error } = await supabase.rpc('hr_training_delete_with_manager_pin', {
    p_business_id: businessId,
    p_training_item_id: trainingItem.id,
    p_manager_pin: managerPin.trim(),
    p_hard_delete: hardDelete
  });

  if (error) throw error;
  const payload = typeof data === 'string' ? JSON.parse(data) : data;
  if (payload?.success === false) {
    throw new Error(payload.error || 'Failed to delete training');
  }

  toast.success('Training deleted');
  return true;
}

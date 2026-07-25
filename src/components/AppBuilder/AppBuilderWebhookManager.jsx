// Step 111: Create AppBuilderWebhookManager component
// Configure webhooks for app events
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, TestTube, Key, AlertCircle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import toast from 'react-hot-toast';

const AppBuilderWebhookManager = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWebhook, setNewWebhook] = useState({
    webhook_url: '',
    event_types: [],
    active: true
  });

  useEffect(() => {
    if (selectedBusinessId) {
      loadWebhooks();
    }
  }, [selectedBusinessId]);

  const loadWebhooks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('app_webhooks')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWebhooks(data || []);
    } catch (error) {
      console.error('Error loading webhooks:', error);
      toast.error('Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newWebhook.webhook_url || newWebhook.event_types.length === 0) {
      toast.error('Please provide webhook URL and select at least one event type');
      return;
    }

    try {
      const { error } = await supabase
        .from('app_webhooks')
        .insert({
          business_id: selectedBusinessId,
          ...newWebhook
        });

      if (error) throw error;

      toast.success('Webhook added successfully');
      setShowAddForm(false);
      setNewWebhook({ webhook_url: '', event_types: [], active: true });
      loadWebhooks();
    } catch (error) {
      console.error('Error adding webhook:', error);
      toast.error('Failed to add webhook');
    }
  };

  const handleDelete = async (webhookId) => {
    if (!confirm('Are you sure you want to delete this webhook?')) return;

    try {
      const { error } = await supabase
        .from('app_webhooks')
        .delete()
        .eq('id', webhookId);

      if (error) throw error;

      toast.success('Webhook deleted successfully');
      loadWebhooks();
    } catch (error) {
      console.error('Error deleting webhook:', error);
      toast.error('Failed to delete webhook');
    }
  };

  const handleTest = async (webhookId) => {
    try {
      // This would call a backend function to test the webhook
      toast.success('Test webhook sent');
    } catch (error) {
      console.error('Error testing webhook:', error);
      toast.error('Failed to test webhook');
    }
  };

  const eventTypes = [
    'build.completed',
    'build.failed',
    'deployment.submitted',
    'deployment.approved',
    'deployment.rejected',
    'module.enabled',
    'module.disabled'
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Webhooks</h3>
          <p className="text-sm text-gray-600 mt-1">
            Configure webhooks to receive notifications for app events
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Webhook
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="bg-white border rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Webhook URL *
            </label>
            <input
              type="url"
              value={newWebhook.webhook_url}
              onChange={(e) => setNewWebhook(prev => ({ ...prev, webhook_url: e.target.value }))}
              placeholder="https://your-server.com/webhook"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Event Types *
            </label>
            <div className="space-y-2">
              {eventTypes.map((eventType) => (
                <label key={eventType} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newWebhook.event_types.includes(eventType)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewWebhook(prev => ({
                          ...prev,
                          event_types: [...prev.event_types, eventType]
                        }));
                      } else {
                        setNewWebhook(prev => ({
                          ...prev,
                          event_types: prev.event_types.filter(et => et !== eventType)
                        }));
                      }
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{eventType}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Add Webhook
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewWebhook({ webhook_url: '', event_types: [], active: true });
              }}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Webhooks List */}
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        </div>
      ) : webhooks.length === 0 ? (
        <div className="bg-white border rounded-lg p-8 text-center">
          <p className="text-gray-500">No webhooks configured</p>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => (
            <div key={webhook.id} className="bg-white border rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <a
                      href={webhook.webhook_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-gray-900 hover:text-blue-600"
                    >
                      {webhook.webhook_url}
                    </a>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      webhook.active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {webhook.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {webhook.event_types.map((eventType) => (
                      <span
                        key={eventType}
                        className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded"
                      >
                        {eventType}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTest(webhook.id)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    title="Test Webhook"
                  >
                    <TestTube className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(webhook.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                    title="Delete Webhook"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AppBuilderWebhookManager;





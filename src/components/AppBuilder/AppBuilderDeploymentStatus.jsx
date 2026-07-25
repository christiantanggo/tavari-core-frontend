// Step 97: Create AppBuilderDeploymentStatus component
// Deployment status for each platform/store
import React from 'react';
import { CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';
import { DEPLOYMENT_STATUSES } from '../../constants/appBuilderConstants';

const AppBuilderDeploymentStatus = ({ platform }) => {
  // This would fetch actual deployment status
  // For now, showing placeholder structure
  const status = 'pending'; // This would come from props or hook

  const getStatusIcon = (status) => {
    switch (status) {
      case 'live':
      case 'approved':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'in_review':
      case 'submitted':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'rejected':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'live':
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'in_review':
      case 'submitted':
        return 'bg-yellow-100 text-yellow-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {getStatusIcon(status)}
          <div>
            <h3 className="font-semibold text-gray-900">Deployment Status</h3>
            <p className="text-sm text-gray-600">{platform.toUpperCase()} Store</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(status)}`}>
          {status}
        </span>
      </div>

      {/* Timeline would go here */}
      <div className="text-sm text-gray-600">
        <p>No deployments yet. Submit your app to see status updates.</p>
      </div>
    </div>
  );
};

export default AppBuilderDeploymentStatus;





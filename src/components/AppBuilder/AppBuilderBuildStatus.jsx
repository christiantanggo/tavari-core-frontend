// Step 94: Create AppBuilderBuildStatus component
// Display build status with progress, logs
import React from 'react';
import { CheckCircle2, Clock, XCircle, AlertCircle, Download, X } from 'lucide-react';

const AppBuilderBuildStatus = ({ build, onCancel }) => {
  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-6 h-6 text-green-500" />;
      case 'building':
      case 'queued':
        return <Clock className="w-6 h-6 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-6 h-6 text-red-500" />;
      default:
        return <AlertCircle className="w-6 h-6 text-gray-500" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-800';
      case 'building':
      case 'queued':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-4">
      {/* Build Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {getStatusIcon(build.build_status)}
          <div>
            <h3 className="font-semibold text-gray-900">
              {build.app_version} ({build.platform})
            </h3>
            <p className="text-sm text-gray-600">
              Build #{build.build_number} • Started {new Date(build.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(build.build_status)}`}>
            {build.build_status}
          </span>
          {(build.build_status === 'queued' || build.build_status === 'building') && onCancel && (
            <button
              onClick={() => onCancel()}
              className="px-3 py-1 text-red-600 hover:text-red-700 text-sm font-medium flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar for Building */}
      {(build.build_status === 'building' || build.build_status === 'queued') && (
        <div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                build.build_status === 'building' ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'
              }`}
              style={{ width: build.build_status === 'building' ? '75%' : '25%' }}
            />
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {build.build_status === 'building' ? 'Building in progress...' : 'Queued for build...'}
          </p>
        </div>
      )}

      {/* Error Message */}
      {build.build_status === 'failed' && build.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-red-900 mb-1">Build Failed</h4>
              <p className="text-sm text-red-700">{build.error_message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Build Logs */}
      {build.build_log_url && (
        <div>
          <a
            href={build.build_log_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            View Build Logs
          </a>
        </div>
      )}

      {/* Download Artifact */}
      {build.build_status === 'success' && build.artifact_url && (
        <div>
          <a
            href={build.artifact_url}
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Download className="w-4 h-4" />
            Download Artifact
          </a>
        </div>
      )}

      {/* Completed Time */}
      {build.completed_at && (
        <p className="text-xs text-gray-500">
          Completed {new Date(build.completed_at).toLocaleString()}
        </p>
      )}
    </div>
  );
};

export default AppBuilderBuildStatus;





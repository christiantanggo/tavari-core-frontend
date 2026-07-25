// Step 95: Create AppBuilderBuildHistory component
// List of past builds with status, download links
import React, { useState } from 'react';
import { Download, Filter, Search } from 'lucide-react';
import { PLATFORM_OPTIONS, BUILD_STATUSES } from '../../constants/appBuilderConstants';

const AppBuilderBuildHistory = ({ builds }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredBuilds = builds?.filter(build => {
    const matchesSearch = !searchTerm || 
      build.app_version.toLowerCase().includes(searchTerm.toLowerCase()) ||
      build.build_number.toString().includes(searchTerm);
    const matchesPlatform = platformFilter === 'all' || build.platform === platformFilter;
    const matchesStatus = statusFilter === 'all' || build.build_status === statusFilter;
    return matchesSearch && matchesPlatform && matchesStatus;
  }) || [];

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

  if (!builds || builds.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No builds found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search builds..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Platforms</option>
          {PLATFORM_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          {Object.values(BUILD_STATUSES).map(status => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </div>

      {/* Builds List */}
      <div className="space-y-2">
        {filteredBuilds.map((build) => (
          <div
            key={build.id}
            className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold text-gray-900">
                    {build.app_version} ({build.platform})
                  </h3>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(build.build_status)}`}>
                    {build.build_status}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span>Build #{build.build_number}</span>
                  <span>•</span>
                  <span>{new Date(build.created_at).toLocaleString()}</span>
                  {build.completed_at && (
                    <>
                      <span>•</span>
                      <span>Completed {new Date(build.completed_at).toLocaleString()}</span>
                    </>
                  )}
                </div>
              </div>
              {build.build_status === 'success' && build.artifact_url && (
                <a
                  href={build.artifact_url}
                  download
                  className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredBuilds.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No builds match your filters</p>
        </div>
      )}
    </div>
  );
};

export default AppBuilderBuildHistory;





// Step 113: Create AppBuilderHelp component
// Help documentation and guides
import React, { useState } from 'react';
import { Search, Book, Video, HelpCircle, X } from 'lucide-react';

const AppBuilderHelp = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = [
    { id: 'all', name: 'All Topics' },
    { id: 'getting-started', name: 'Getting Started' },
    { id: 'branding', name: 'Branding' },
    { id: 'modules', name: 'Modules' },
    { id: 'builds', name: 'Builds & Deployments' },
    { id: 'troubleshooting', name: 'Troubleshooting' }
  ];

  const articles = [
    {
      id: 1,
      category: 'getting-started',
      title: 'Getting Started with App Builder',
      content: 'Learn how to create your first white-label app...',
      video: false
    },
    {
      id: 2,
      category: 'branding',
      title: 'Configuring Your App Branding',
      content: 'Customize colors, logos, and visual identity...',
      video: true
    },
    {
      id: 3,
      category: 'modules',
      title: 'Enabling and Disabling Modules',
      content: 'Manage which modules appear in your app...',
      video: false
    },
    {
      id: 4,
      category: 'builds',
      title: 'Building and Deploying Your App',
      content: 'Create builds and submit to app stores...',
      video: true
    }
  ];

  const filteredArticles = articles.filter(article => {
    const matchesSearch = !searchTerm || 
      article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      article.content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Help & Documentation</h1>
          <p className="text-gray-600">Find answers and learn how to use App Builder</p>
        </div>

        {/* Search */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search help articles..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-md whitespace-nowrap ${
                selectedCategory === category.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* Articles */}
        <div className="space-y-4">
          {filteredArticles.map((article) => (
            <div key={article.id} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Book className="w-5 h-5 text-blue-500" />
                    <h3 className="text-lg font-semibold text-gray-900">{article.title}</h3>
                    {article.video && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full flex items-center gap-1">
                        <Video className="w-3 h-3" />
                        Video
                      </span>
                    )}
                  </div>
                  <p className="text-gray-600">{article.content}</p>
                </div>
                <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                  Read More →
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredArticles.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <HelpCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No articles found. Try a different search term.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppBuilderHelp;





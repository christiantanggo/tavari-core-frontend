// Step 115: Create AppBuilderKeyboardShortcuts component
// Keyboard shortcuts helper
import React, { useState, useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

const AppBuilderKeyboardShortcuts = () => {
  const [showModal, setShowModal] = useState(false);
  const [pressedKeys, setPressedKeys] = useState(new Set());

  const shortcuts = [
    { keys: ['g', 'b'], description: 'Open business selector', category: 'Navigation' },
    { keys: ['/'], description: 'Focus search', category: 'Navigation' },
    { keys: ['Esc'], description: 'Close modal/dialog', category: 'Navigation' },
    { keys: ['Ctrl', 'S'], description: 'Save changes', category: 'Actions' },
    { keys: ['Ctrl', 'K'], description: 'Open command palette', category: 'Actions' }
  ];

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for 'g' then 'b' sequence for business selector
      if (e.key === 'g') {
        setPressedKeys(new Set(['g']));
      } else if (e.key === 'b' && pressedKeys.has('g')) {
        e.preventDefault();
        const selector = document.querySelector('.selector');
        if (selector) {
          selector.focus();
          selector.click();
        }
        setPressedKeys(new Set());
      } else {
        setPressedKeys(new Set());
      }

      // Toggle shortcuts modal with Ctrl+?
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setShowModal(!showModal);
      }
    };

    const handleKeyUp = () => {
      setTimeout(() => setPressedKeys(new Set()), 1000);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pressedKeys, showModal]);

  if (!showModal) {
    return (
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-4 right-4 bg-gray-800 text-white rounded-full p-3 shadow-lg hover:bg-gray-700 transition-colors"
        title="Keyboard Shortcuts (Ctrl+/)"
      >
        <Keyboard className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Keyboard Shortcuts</h2>
          <button
            onClick={() => setShowModal(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {['Navigation', 'Actions'].map((category) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{category}</h3>
              <div className="space-y-3">
                {shortcuts
                  .filter(s => s.category === category)
                  .map((shortcut, index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-gray-600">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <React.Fragment key={keyIndex}>
                            <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs font-mono">
                              {key}
                            </kbd>
                            {keyIndex < shortcut.keys.length - 1 && (
                              <span className="text-gray-400 mx-1">+</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 border-t bg-gray-50">
          <p className="text-xs text-gray-500 text-center">
            Press <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">/</kbd> to toggle this help
          </p>
        </div>
      </div>
    </div>
  );
};

export default AppBuilderKeyboardShortcuts;





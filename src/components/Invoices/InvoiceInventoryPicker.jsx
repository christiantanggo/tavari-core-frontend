import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Package, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import invoiceService from '../../services/Invoices/invoiceService';

export default function InvoiceInventoryPicker({ businessId, onAddItems, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  const loadInventory = useCallback(async (term) => {
    if (!businessId) return;
    setLoading(true);
    try {
      invoiceService.setBusinessId(businessId);
      const rows = await invoiceService.searchInventory(term, 80);
      setResults(rows);
    } catch (err) {
      toast.error(err.message || 'Failed to load inventory');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      loadInventory(search.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [open, search, loadInventory]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const toggleOpen = () => {
    if (disabled) return;
    setOpen((prev) => {
      if (!prev) {
        setSearch('');
        setSelectedIds(new Set());
      }
      return !prev;
    });
  };

  const toggleItem = (itemId, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const toggleAllVisible = (checked) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(results.map((item) => item.id)));
  };

  const handleAddSelected = () => {
    const picked = results.filter((item) => selectedIds.has(item.id));
    if (!picked.length) {
      toast.error('Select at least one item');
      return;
    }
    onAddItems(picked);
    setSelectedIds(new Set());
    setOpen(false);
    toast.success(`Added ${picked.length} item${picked.length === 1 ? '' : 's'}`);
  };

  const allVisibleSelected = results.length > 0 && results.every((item) => selectedIds.has(item.id));
  const selectedCount = selectedIds.size;

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: '220px' }}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        style={{
          ...triggerBtnStyle,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Package size={16} />
        Add inventory
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={panelStyle}>
          <div style={searchRowStyle}>
            <Search size={16} color="#6b7280" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or SKU…"
              style={searchInputStyle}
              autoFocus
            />
          </div>

          {results.length > 0 && (
            <div style={selectAllRowStyle}>
              <TavariCheckbox
                checked={allVisibleSelected}
                onChange={(checked) => toggleAllVisible(checked)}
                label={`Select all (${results.length})`}
                size="sm"
              />
            </div>
          )}

          <div style={listStyle}>
            {loading ? (
              <div style={emptyStyle}>Loading inventory…</div>
            ) : results.length === 0 ? (
              <div style={emptyStyle}>
                {search.trim() ? 'No items match your search.' : 'No active inventory items found.'}
              </div>
            ) : (
              results.map((item) => (
                <div key={item.id} style={itemRowStyle}>
                  <TavariCheckbox
                    checked={selectedIds.has(item.id)}
                    onChange={(checked) => toggleItem(item.id, checked)}
                    label=""
                    size="sm"
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, display: 'block' }}>{item.name}</span>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>
                      ${Number(item.price || 0).toFixed(2)}
                      {item.sku ? ` · SKU ${item.sku}` : ''}
                      {item.is_bundle ? ' · Bundle' : ''}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>

          <div style={footerStyle}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={handleAddSelected}
              disabled={selectedCount === 0}
              style={{
                ...addBtnStyle,
                opacity: selectedCount === 0 ? 0.5 : 1,
              }}
            >
              Add to invoice
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const triggerBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 14px',
  backgroundColor: TavariStyles.colors.primary || '#008080',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '14px',
  width: '100%',
  justifyContent: 'center',
};

const panelStyle = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  zIndex: 50,
  width: 'min(420px, 92vw)',
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '10px',
  boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
  overflow: 'hidden',
};

const searchRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 12px',
  borderBottom: '1px solid #e5e7eb',
  backgroundColor: '#f9fafb',
};

const searchInputStyle = {
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: '14px',
};

const selectAllRowStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid #f3f4f6',
};

const listStyle = {
  maxHeight: '280px',
  overflowY: 'auto',
};

const itemRowStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  padding: '10px 12px',
  cursor: 'pointer',
  borderBottom: '1px solid #f3f4f6',
};

const emptyStyle = {
  padding: '24px 16px',
  textAlign: 'center',
  color: '#6b7280',
  fontSize: '14px',
};

const footerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '10px 12px',
  borderTop: '1px solid #e5e7eb',
  backgroundColor: '#f9fafb',
};

const addBtnStyle = {
  padding: '8px 14px',
  backgroundColor: TavariStyles.colors.primary || '#008080',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '13px',
};

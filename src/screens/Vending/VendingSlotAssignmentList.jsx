import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FiRefreshCw } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  VENDING_DEFAULT_SEV_NO,
  buildSlotChecklistGrid,
  getTotalPhysicalSlotCount,
  defaultRs485LaneByte
} from '../../utils/vendingSlotChecklist';
import {
  canEnableDualVend,
  defaultDualPartnerCol,
  isDualVendPartnerCell
} from '../../utils/vendingDualVend';
import './VendingSlotAssignmentList.css';

export default function VendingSlotAssignmentList({
  businessId,
  devices,
  selectedDeviceId,
  onSelectDeviceId,
  inventoryItems,
  onSaveSlot,
  onClearSlot,
  onSetDualMerge
}) {
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [productSlots, setProductSlots] = useState([]);
  const [pendingCatalog, setPendingCatalog] = useState({});
  const [pendingStock, setPendingStock] = useState({});

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const isRs485 = selectedDevice?.dispense_mode === 'rs485';

  const loadSlots = useCallback(async () => {
    if (!businessId || !selectedDeviceId) {
      setProductSlots([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vending_device_slots')
        .select(
          'sev_no, row_num, col_num, manufacturer_goods_id, rs485_lane_byte, rs485_lane_byte_secondary, dual_vend_col_num, pos_inventory_id, num, max_num, pos_inventory(name)'
        )
        .eq('business_id', businessId)
        .eq('vending_device_id', selectedDeviceId);

      if (error) throw error;
      setProductSlots(
        (data || []).map((row) => ({
          sev_no: row.sev_no,
          row_num: row.row_num,
          col_num: row.col_num,
          manufacturer_goods_id: row.manufacturer_goods_id,
          rs485_lane_byte: row.rs485_lane_byte,
          rs485_lane_byte_secondary: row.rs485_lane_byte_secondary,
          dual_vend_col_num: row.dual_vend_col_num,
          pos_inventory_id: row.pos_inventory_id,
          num: row.num,
          max_num: row.max_num,
          goods_name: row.pos_inventory?.name || ''
        }))
      );
    } catch (err) {
      toast.error(err.message || 'Could not load slots');
    } finally {
      setLoading(false);
    }
  }, [businessId, selectedDeviceId]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const cells = useMemo(() => {
    const grid = buildSlotChecklistGrid({
      sevNo: VENDING_DEFAULT_SEV_NO,
      productSlots
    });
    return grid.flat();
  }, [productSlots]);

  const assignedCount = useMemo(
    () => cells.filter((c) => c.posInventoryId || c.goodsId).length,
    [cells]
  );

  const stockValue = (cell, field) => {
    const draft = pendingStock[cell.key]?.[field];
    if (draft != null) return draft;
    const saved = field === 'num' ? cell.num : cell.maxNum;
    return String(saved ?? (field === 'num' ? 10 : 10));
  };

  const parseStockValue = (value, fallback = 0) => {
    const parsed = parseInt(String(value).replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };

  const handleStockChange = (cell, field, value) => {
    setPendingStock((p) => ({
      ...p,
      [cell.key]: {
        ...p[cell.key],
        [field]: value
      }
    }));
  };

  const handleSelect = async (cell, catalogInventoryId) => {
    setPendingCatalog((p) => ({ ...p, [cell.key]: catalogInventoryId }));
    setSavingKey(cell.key);
    try {
      if (!catalogInventoryId) {
        if (cell.posInventoryId || cell.goodsId) {
          await onClearSlot(cell, { skipConfirm: true });
          await loadSlots();
          toast.success(`Slot ${cell.row}-${cell.col} cleared`);
        }
        return;
      }
      const inv = inventoryItems.find((i) => i.id === catalogInventoryId);
      const num = parseStockValue(stockValue(cell, 'num'), 10);
      const maxNum = parseStockValue(stockValue(cell, 'maxNum'), 10);
      await onSaveSlot(cell, {
        catalogInventoryId,
        num,
        maxNum
      });
      await loadSlots();
      setPendingStock((p) => {
        const next = { ...p };
        delete next[cell.key];
        return next;
      });
      toast.success(`${cell.row}-${cell.col} → ${inv?.name || 'product'} (${num}/${maxNum})`);
    } catch (err) {
      toast.error(err.message || 'Could not save slot');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveStock = async (cell) => {
    const catalogInventoryId = catalogValue(cell);
    if (!catalogInventoryId && !cell.goodsId) {
      toast.error('Assign a product before setting stock');
      return;
    }
    const num = parseStockValue(stockValue(cell, 'num'), 0);
    const maxNum = parseStockValue(stockValue(cell, 'maxNum'), 0);
    setSavingKey(cell.key);
    try {
      await onSaveSlot(cell, {
        catalogInventoryId,
        num,
        maxNum
      });
      await loadSlots();
      setPendingStock((p) => {
        const next = { ...p };
        delete next[cell.key];
        return next;
      });
      toast.success(`Slot ${cell.row}-${cell.col} stock saved (${num}/${maxNum})`);
    } catch (err) {
      toast.error(err.message || 'Could not save stock');
    } finally {
      setSavingKey(null);
    }
  };

  const handleToggleDualMerge = async (cell) => {
    const enabled = !cell.dualVendColNum;
    setSavingKey(cell.key);
    try {
      await onSetDualMerge(cell, enabled);
      await loadSlots();
      if (enabled) {
        const partnerCol = defaultDualPartnerCol(cell.col);
        const lane2 =
          defaultRs485LaneByte(cell.row, partnerCol);
        toast.success(
          `Wide slot ${cell.row}-${cell.col} — motors L${cell.laneByte} + L${lane2} vend together`
        );
      } else {
        toast.success(`Slot ${cell.row}-${cell.col} back to single motor`);
      }
    } catch (err) {
      toast.error(err.message || 'Could not update merge');
    } finally {
      setSavingKey(null);
    }
  };

  const catalogValue = (cell) =>
    pendingCatalog[cell.key] !== undefined
      ? pendingCatalog[cell.key]
      : cell.posInventoryId || '';

  return (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Assign products to slots</h2>
      <p style={helpStyle}>
        Pick a catalog item for each slot. Changes save immediately and appear on the tablet within about a minute.
        Row 6 has 9 slots (no column 10). For wide products, use <strong>Wide (2 motors)</strong> to merge with the
        next column — both motors run at the same time when that product vends.
      </p>

      <div className="vending-slot-assign-toolbar">
        <select
          value={selectedDeviceId}
          onChange={(e) => onSelectDeviceId(e.target.value)}
          className="vending-slot-assign-select-device"
        >
          <option value="">Select device</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.display_name || d.external_device_id}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="vending-slot-assign-refresh"
          disabled={!selectedDeviceId || loading}
          onClick={loadSlots}
        >
          <FiRefreshCw style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {selectedDeviceId ? (
          <span className="vending-slot-assign-summary">
            {assignedCount} / {getTotalPhysicalSlotCount()} assigned
          </span>
        ) : null}
      </div>

      {!selectedDeviceId ? (
        <p style={mutedStyle}>Select a vending device to assign products.</p>
      ) : loading && cells.length === 0 ? (
        <p style={mutedStyle}>Loading slots…</p>
      ) : (
        <ul className="vending-slot-assign-list">
          {cells.map((cell) => {
            const busy = savingKey === cell.key;
            const assigned = Boolean(cell.posInventoryId || cell.goodsName || cell.goodsId);
            const isPartner = isDualVendPartnerCell(cell.row, cell.col, productSlots);
            const isWide = Boolean(cell.dualVendColNum);
            const canMerge = isRs485 && assigned && canEnableDualVend(cell.row, cell.col) && !isPartner;

            if (isPartner) {
              const primaryCol = cell.col - 1;
              return (
                <li key={cell.key} className="vending-slot-assign-row merged-partner">
                  <div className="vending-slot-assign-slot">
                    <span className="vending-slot-assign-pos">
                      {cell.row}-{cell.col}
                    </span>
                    <span className="vending-slot-assign-lane">L{cell.laneByte}</span>
                  </div>
                  <span className="vending-slot-assign-merged-label">
                    Merged with {cell.row}-{primaryCol} (wide product)
                  </span>
                </li>
              );
            }

            return (
              <li
                key={cell.key}
                className={`vending-slot-assign-row${assigned ? ' assigned' : ''}${busy ? ' saving' : ''}${isWide ? ' wide' : ''}`}
              >
                <div className="vending-slot-assign-slot">
                  <span className="vending-slot-assign-pos">
                    {cell.row}-{cell.col}
                  </span>
                  <span className="vending-slot-assign-lane">
                    L{cell.laneByte}
                    {isWide
                      ? ` + L${cell.rs485LaneByteSecondary ?? defaultRs485LaneByte(cell.row, cell.dualVendColNum)}`
                      : ''}
                  </span>
                </div>
                <select
                  className="vending-slot-assign-product"
                  value={catalogValue(cell)}
                  disabled={busy}
                  onChange={(e) => handleSelect(cell, e.target.value)}
                >
                  <option value="">— Empty —</option>
                  {inventoryItems.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name}
                      {inv.sku ? ` (${inv.sku})` : ''}
                    </option>
                  ))}
                </select>
                <div className="vending-slot-assign-stock">
                  <label>
                    Now
                    <input
                      type="text"
                      inputMode="numeric"
                      value={stockValue(cell, 'num')}
                      disabled={busy}
                      onChange={(e) => handleStockChange(cell, 'num', e.target.value)}
                    />
                  </label>
                  <span>/</span>
                  <label>
                    Max
                    <input
                      type="text"
                      inputMode="numeric"
                      value={stockValue(cell, 'maxNum')}
                      disabled={busy}
                      onChange={(e) => handleStockChange(cell, 'maxNum', e.target.value)}
                    />
                  </label>
                  {assigned ? (
                    <button
                      type="button"
                      className="vending-slot-assign-stock-save"
                      disabled={busy}
                      onClick={() => handleSaveStock(cell)}
                    >
                      Save stock
                    </button>
                  ) : null}
                </div>
                {canMerge ? (
                  <button
                    type="button"
                    className={`vending-slot-assign-merge${isWide ? ' active' : ''}`}
                    disabled={busy}
                    onClick={() => handleToggleDualMerge(cell)}
                    title={`Merge with column ${defaultDualPartnerCol(cell.col)} for simultaneous dual motor vend`}
                  >
                    {isWide ? 'Wide ✓' : 'Wide (2 motors)'}
                  </button>
                ) : null}
                {busy ? <span className="vending-slot-assign-status">Saving…</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const cardStyle = {
  backgroundColor: TavariStyles.colors.white,
  borderRadius: TavariStyles.borderRadius.lg,
  border: `1px solid ${TavariStyles.colors.gray200}`,
  padding: TavariStyles.spacing.xl,
  marginBottom: TavariStyles.spacing.xl
};

const helpStyle = {
  color: TavariStyles.colors.gray600,
  lineHeight: 1.5,
  marginBottom: TavariStyles.spacing.md
};

const mutedStyle = {
  color: TavariStyles.colors.gray500,
  margin: 0
};

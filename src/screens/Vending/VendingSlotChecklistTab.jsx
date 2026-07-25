// RS485 slot checklist — lane bytes + pass/fail before paid go-live.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiRefreshCw, FiCheckCircle, FiXCircle, FiGrid, FiZap, FiWifi, FiWifiOff } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  getTabletBridgeStatus,
  requestRemoteDispense,
  waitForRemoteDispense
} from '../../services/VendingMachine/vendingRemoteDispense';
import {
  VENDING_DEFAULT_SEV_NO,
  VENDING_SLOT_COLS,
  VENDING_SLOT_ROWS,
  getSlotColsForRow,
  getTotalPhysicalSlotCount,
  buildSlotChecklistGrid,
  defaultRs485LaneByte,
  summarizeChecklist
} from '../../utils/vendingSlotChecklist';
import { buildVendingShortKioskUrl } from '../../utils/vendingKioskSecret';
import './VendingSlotChecklistTab.css';

const cardStyle = {
  backgroundColor: TavariStyles.colors.white,
  borderRadius: TavariStyles.borderRadius.lg,
  border: `1px solid ${TavariStyles.colors.gray200}`,
  padding: TavariStyles.spacing.xl,
  marginBottom: TavariStyles.spacing.xl
};

export default function VendingSlotChecklistTab({
  devices,
  selectedDeviceId,
  onSelectDeviceId,
  businessId
}) {
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [testRows, setTestRows] = useState([]);
  const [productSlots, setProductSlots] = useState([]);
  const [laneDrafts, setLaneDrafts] = useState({});
  const [tabletBridge, setTabletBridge] = useState({ online: false, lastSeenAt: null });

  const device = devices.find((d) => d.id === selectedDeviceId);
  const kioskUrl = device?.kiosk_short_code
    ? `${buildVendingShortKioskUrl(typeof window !== 'undefined' ? window.location.origin : 'https://www.tavarios.ca', device.kiosk_short_code)}?dispense=rs485`
    : '';

  const loadChecklist = useCallback(async () => {
    if (!businessId || !selectedDeviceId) return;
    setLoading(true);
    try {
      const [testsRes, slotsRes] = await Promise.all([
        supabase
          .from('vending_device_slot_tests')
          .select('id, sev_no, row_num, col_num, rs485_lane_byte, test_status, tested_at, notes')
          .eq('business_id', businessId)
          .eq('vending_device_id', selectedDeviceId)
          .order('row_num')
          .order('col_num'),
        supabase
          .from('vending_device_slots')
          .select(
            'sev_no, row_num, col_num, manufacturer_goods_id, rs485_lane_byte, rs485_lane_byte_secondary, dual_vend_col_num, pos_inventory_id, pos_inventory(name)'
          )
          .eq('business_id', businessId)
          .eq('vending_device_id', selectedDeviceId)
      ]);

      if (testsRes.error) throw testsRes.error;
      if (slotsRes.error) throw slotsRes.error;

      setTestRows(testsRes.data || []);
      setProductSlots(
        (slotsRes.data || []).map((row) => ({
          ...row,
          goods_name: row.pos_inventory?.name || ''
        }))
      );
    } catch (err) {
      toast.error(err.message || 'Could not load slot checklist');
    } finally {
      setLoading(false);
    }
  }, [businessId, selectedDeviceId]);

  useEffect(() => {
    loadChecklist();
  }, [loadChecklist]);

  const refreshTabletBridge = useCallback(async () => {
    if (!selectedDeviceId) {
      setTabletBridge({ online: false, lastSeenAt: null });
      return;
    }
    try {
      const status = await getTabletBridgeStatus(selectedDeviceId);
      setTabletBridge(status);
    } catch (err) {
      console.warn('[slot-checklist] tablet bridge status', err);
      setTabletBridge({ online: false, lastSeenAt: null, error: err?.message });
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    refreshTabletBridge();
    if (!selectedDeviceId) return undefined;
    const interval = setInterval(refreshTabletBridge, 5000);
    return () => clearInterval(interval);
  }, [selectedDeviceId, refreshTabletBridge]);

  const grid = useMemo(
    () =>
      buildSlotChecklistGrid({
        rows: VENDING_SLOT_ROWS,
        cols: VENDING_SLOT_COLS,
        sevNo: VENDING_DEFAULT_SEV_NO,
        testRows,
        productSlots
      }),
    [testRows, productSlots]
  );

  const flatCells = useMemo(() => grid.flat(), [grid]);
  const summary = useMemo(() => summarizeChecklist(flatCells), [flatCells]);

  const syncLaneToProductSlot = async (cell, laneByte) => {
    await supabase
      .from('vending_device_slots')
      .update({
        rs485_lane_byte: laneByte,
        updated_at: new Date().toISOString()
      })
      .eq('business_id', businessId)
      .eq('vending_device_id', selectedDeviceId)
      .eq('sev_no', String(cell.sevNo))
      .eq('row_num', cell.row)
      .eq('col_num', cell.col);
  };

  const upsertTestRow = async (cell, patch) => {
    const laneByte =
      patch.rs485_lane_byte != null
        ? patch.rs485_lane_byte
        : laneDrafts[cell.key] != null
          ? Number(laneDrafts[cell.key])
          : cell.laneByte;

    const payload = {
      business_id: businessId,
      vending_device_id: selectedDeviceId,
      sev_no: String(cell.sevNo),
      row_num: cell.row,
      col_num: cell.col,
      rs485_lane_byte: laneByte,
      updated_at: new Date().toISOString(),
      ...patch
    };

    const { error } = await supabase.from('vending_device_slot_tests').upsert(payload, {
      onConflict: 'vending_device_id,sev_no,row_num,col_num'
    });
    if (error) throw error;

    if (cell.goodsId) {
      await syncLaneToProductSlot(cell, laneByte);
    }
  };

  const handleInitializeGrid = async () => {
    if (!selectedDeviceId) {
      toast.error('Select a device first');
      return;
    }
    setLoading(true);
    try {
      const rows = [];
      for (let r = 1; r <= VENDING_SLOT_ROWS; r += 1) {
        for (let c = 1; c <= getSlotColsForRow(r); c += 1) {
          rows.push({
            business_id: businessId,
            vending_device_id: selectedDeviceId,
            sev_no: VENDING_DEFAULT_SEV_NO,
            row_num: r,
            col_num: c,
            rs485_lane_byte: defaultRs485LaneByte(r, c),
            test_status: 'untested',
            updated_at: new Date().toISOString()
          });
        }
      }
      const { error } = await supabase.from('vending_device_slot_tests').upsert(rows, {
        onConflict: 'vending_device_id,sev_no,row_num,col_num',
        ignoreDuplicates: false
      });
      if (error) throw error;
      toast.success(`Initialized ${rows.length} slots (59 physical — row 6 has 9)`);
      await loadChecklist();
    } catch (err) {
      toast.error(err.message || 'Could not initialize grid');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyDefaultLanes = async () => {
    if (!selectedDeviceId) return;
    setLoading(true);
    try {
      for (const cell of flatCells) {
        const lane = defaultRs485LaneByte(cell.row, cell.col);
        await upsertTestRow(cell, { rs485_lane_byte: lane, test_status: cell.testStatus });
      }
      toast.success('Default lane bytes applied (row-major 0–58)');
      setLaneDrafts({});
      await loadChecklist();
    } catch (err) {
      toast.error(err.message || 'Could not apply lane bytes');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkStatus = async (cell, testStatus) => {
    setSavingKey(cell.key);
    try {
      await upsertTestRow(cell, {
        test_status: testStatus,
        tested_at: new Date().toISOString()
      });
      toast.success(`${cell.row}-${cell.col} marked ${testStatus}`);
      await loadChecklist();
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveLane = async (cell) => {
    const raw = laneDrafts[cell.key] ?? String(cell.laneByte);
    const lane = Number(raw);
    if (!Number.isFinite(lane) || lane < 0 || lane > 99) {
      toast.error('Lane byte must be 0–99');
      return;
    }
    setSavingKey(cell.key);
    try {
      await upsertTestRow(cell, { rs485_lane_byte: lane });
      toast.success(`Lane ${lane} saved for ${cell.row}-${cell.col}`);
      setLaneDrafts((d) => {
        const next = { ...d };
        delete next[cell.key];
        return next;
      });
      await loadChecklist();
    } catch (err) {
      toast.error(err.message || 'Could not save lane');
    } finally {
      setSavingKey(null);
    }
  };

  const handleRemoteTestVend = async (cell) => {
    if (!selectedDeviceId || !businessId) return;
    if (!tabletBridge.online) {
      toast.error('Tablet not connected — open Tavari Vending on the machine and keep the kiosk screen visible');
      return;
    }

    const raw = laneDrafts[cell.key] ?? String(cell.laneByte);
    const lane = Number(raw);
    if (!Number.isFinite(lane) || lane < 0 || lane > 99) {
      toast.error('Lane byte must be 0–99');
      return;
    }

    setSavingKey(cell.key);
    try {
      if (lane !== cell.laneByte) {
        await upsertTestRow(cell, { rs485_lane_byte: lane });
      }
      const cmd = await requestRemoteDispense({
        businessId,
        vendingDeviceId: selectedDeviceId,
        laneByte: lane,
        laneByteSecondary:
          cell.dualVendColNum != null
            ? Number(
                cell.rs485LaneByteSecondary ??
                  defaultRs485LaneByte(cell.row, cell.dualVendColNum)
              )
            : null,
        rowNum: cell.row,
        colNum: cell.col
      });
      toast.loading(
        cell.dualVendColNum
          ? `Testing wide slot ${cell.row}-${cell.col} (lanes ${lane}+${cell.rs485LaneByteSecondary ?? defaultRs485LaneByte(cell.row, cell.dualVendColNum)})…`
          : `Testing slot ${cell.row}-${cell.col} (lane ${lane})…`,
        { id: cell.key }
      );
      const outcome = await waitForRemoteDispense(cmd.id);
      toast.dismiss(cell.key);
      if (outcome.ok) {
        toast.success(`Slot ${cell.row}-${cell.col} — motor command sent. Mark Pass if the correct slot ran.`);
      } else {
        toast.error(outcome.error || 'Remote vend failed');
      }
    } catch (err) {
      toast.dismiss(cell.key);
      toast.error(err.message || 'Could not send remote vend');
    } finally {
      setSavingKey(null);
    }
  };

  const toolbarBtn = {
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: TavariStyles.colors.white,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.medium
  };

  return (
    <section style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>RS485 slot checklist</h2>
      <p style={{ color: TavariStyles.colors.gray600, lineHeight: 1.5, marginBottom: TavariStyles.spacing.md }}>
        Test every slot from this dashboard — commands go to the <strong>Tavari Vending tablet app</strong>, which
        runs the motor over RS485. Default lane bytes: <strong>1-1 = 0</strong>, <strong>1-10 = 9</strong>,{' '}
        <strong>2-1 = 10</strong>, … <strong>6-9 = 58</strong> (row 6 has 9 slots, no column 10).
      </p>

      {selectedDeviceId ? (
        <p
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: TavariStyles.spacing.md,
            fontSize: TavariStyles.typography.fontSize.sm,
            color: tabletBridge.online ? '#166534' : '#b45309',
            fontWeight: 600
          }}
        >
          {tabletBridge.online ? <FiWifi /> : <FiWifiOff />}
          {tabletBridge.online
            ? `Tablet connected${tabletBridge.lastSeenAt ? ` (seen ${new Date(tabletBridge.lastSeenAt).toLocaleTimeString()})` : ''} — remote test vend is ready`
            : tabletBridge.lastSeenAt
              ? `Tablet idle — last seen ${new Date(tabletBridge.lastSeenAt).toLocaleString()} (must be within 2 min). Keep Tavari Vending open on the tablet.`
              : `Tablet not connected — open Tavari Vending on the machine tablet (kiosk screen must stay open)${tabletBridge.error ? `. ${tabletBridge.error}` : ''}`}
        </p>
      ) : null}

      <div className="vending-checklist-toolbar">
        <select
          value={selectedDeviceId}
          onChange={(e) => onSelectDeviceId(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${TavariStyles.colors.gray300}`,
            minWidth: 200
          }}
        >
          <option value="">Select device</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.display_name || d.external_device_id}
            </option>
          ))}
        </select>
        <button type="button" style={toolbarBtn} onClick={loadChecklist} disabled={loading || !selectedDeviceId}>
          <FiRefreshCw style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Refresh
        </button>
        <button type="button" style={toolbarBtn} onClick={handleInitializeGrid} disabled={loading || !selectedDeviceId}>
          <FiGrid style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Initialize {getTotalPhysicalSlotCount()} slots
        </button>
        <button type="button" style={toolbarBtn} onClick={handleApplyDefaultLanes} disabled={loading || !selectedDeviceId}>
          Apply default lanes
        </button>
      </div>

      {kioskUrl ? (
        <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
          Tablet kiosk:{' '}
          <a href={kioskUrl} target="_blank" rel="noopener noreferrer">
            {kioskUrl}
          </a>
        </p>
      ) : null}

      <div className="vending-checklist-summary">
        <span className="vending-checklist-stat pass">
          <FiCheckCircle style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {summary.passed} passed
        </span>
        <span className="vending-checklist-stat fail">
          <FiXCircle style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {summary.failed} failed
        </span>
        <span className="vending-checklist-stat pending">{summary.untested} untested</span>
        <span className="vending-checklist-stat">{summary.total} total</span>
        {summary.ready ? (
          <span className="vending-checklist-stat pass">Ready for payment setup</span>
        ) : (
          <span className="vending-checklist-stat pending">Complete all slots before payment</span>
        )}
      </div>

      {!selectedDeviceId ? (
        <p style={{ color: TavariStyles.colors.gray500 }}>Select a vending device to begin.</p>
      ) : loading && flatCells.length === 0 ? (
        <p style={{ color: TavariStyles.colors.gray500 }}>Loading checklist…</p>
      ) : (
        <div className="vending-checklist-grid-wrap">
          <table className="vending-checklist-grid">
            <thead>
              <tr>
                <th />
                {Array.from({ length: VENDING_SLOT_COLS }, (_, i) => (
                  <th key={`col-h-${i + 1}`}>Col {i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((rowCells) => {
                const rowNum = rowCells[0]?.row;
                return (
                  <tr key={`row-${rowNum}`}>
                    <td className="vending-checklist-row-label">Row {rowNum}</td>
                    {rowCells.map((cell) => {
                      const busy = savingKey === cell.key;
                      const laneVal = laneDrafts[cell.key] ?? String(cell.laneByte);
                      return (
                        <td key={cell.key} className="vending-checklist-cell">
                          <div className={`vending-checklist-card ${cell.testStatus}`}>
                            <div className="vending-checklist-pos">
                              {cell.row}-{cell.col}
                            </div>
                            <div className="vending-checklist-lane">
                              <span>L</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={laneVal}
                                disabled={busy}
                                onChange={(e) =>
                                  setLaneDrafts((d) => ({ ...d, [cell.key]: e.target.value }))
                                }
                                onBlur={() => {
                                  if (laneDrafts[cell.key] != null && laneDrafts[cell.key] !== String(cell.laneByte)) {
                                    handleSaveLane(cell);
                                  }
                                }}
                              />
                            </div>
                            <div className="vending-checklist-product" title={cell.goodsName || 'No product'}>
                              {cell.goodsName || cell.goodsId || '—'}
                            </div>
                            <div className="vending-checklist-actions">
                              <button
                                type="button"
                                className="btn-vend"
                                disabled={busy || !tabletBridge.online}
                                onClick={() => handleRemoteTestVend(cell)}
                                title={tabletBridge.online ? 'Send RS485 vend to tablet' : 'Tablet not connected'}
                              >
                                <FiZap style={{ verticalAlign: 'middle' }} /> {busy ? '…' : 'Test vend'}
                              </button>
                              <button
                                type="button"
                                className="btn-pass"
                                disabled={busy}
                                onClick={() => handleMarkStatus(cell, 'pass')}
                              >
                                Pass
                              </button>
                              <button
                                type="button"
                                className="btn-fail"
                                disabled={busy}
                                onClick={() => handleMarkStatus(cell, 'fail')}
                              >
                                Fail
                              </button>
                              <button
                                type="button"
                                className="btn-reset"
                                disabled={busy}
                                onClick={() => handleMarkStatus(cell, 'untested')}
                              >
                                Reset
                              </button>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                    {rowNum === 6 && rowCells.length < VENDING_SLOT_COLS ? (
                      <td key="row-6-empty" className="vending-checklist-cell vending-checklist-empty">
                        —
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

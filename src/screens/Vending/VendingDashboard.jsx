// Tavari Vending — standalone module (does not require Tavari POS to be enabled).
// Tabs: Devices | Catalog & cloud | Slots & stock.

import React, { useState, useEffect, useCallback } from 'react';
import {
  FiCpu,
  FiPlus,
  FiTrash2,
  FiCopy,
  FiRefreshCw,
  FiUploadCloud,
  FiLayers,
  FiWifi,
  FiWifiOff,
  FiLoader,
  FiSettings,
  FiDownload,
  FiCheckSquare,
  FiExternalLink,
  FiBarChart2
} from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { supabase } from '../../supabaseClient';
import {
  sha256Hex,
  generateKioskShortCode,
  buildVendingShortKioskUrl
} from '../../utils/vendingKioskSecret';
import vendingMachineService, {
  normalizeVendorDeviceId,
  mergeVendorAndTavariSlots,
  normalizePersistedSlotRow
} from '../../services/VendingMachine/VendingMachineService';
import toast from 'react-hot-toast';
import { getVendingBridgeApkPublicUrl, getVendingBridgeKioskUrl } from '../../utils/vendingKioskDownload';
import { defaultRs485LaneByte, getSlotColsForRow, VENDING_DEFAULT_SEV_NO } from '../../utils/vendingSlotChecklist';
import {
  canEnableDualVend,
  defaultDualPartnerCol,
  isDualVendPartnerCell
} from '../../utils/vendingDualVend';
import VendingSlotChecklistTab from './VendingSlotChecklistTab';
import VendingSlotAssignmentList from './VendingSlotAssignmentList';
import VendingStaffDispenseReportTab from './VendingStaffDispenseReportTab';
import ModuleSettingsTabContent from '../../components/Modules/ModuleSettingsTabContent';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

function randomKioskSecret() {
  const u = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `vk_${u.replace(/-/g, '')}`;
}

/** Normalize vendor slot/inventory row to a string goods id */
function getCloudGoodsId(row) {
  if (!row || typeof row !== 'object') return '';
  const direct =
    row.goodsId ??
    row.goods_id ??
    row.goodsID ??
    row.goods_id_str ??
    row.goods_index_goodsid ??
    row.goodsIndexGoodsId ??
    row.GOODS_INDEX_GOODSID ??
    row.goodsid ??
    row.product_id;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  for (const k of Object.keys(row)) {
    if (/goodsid/i.test(k)) {
      const v = row[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  const nested = row.goods ?? row.goods_info ?? row.goodsInfo ?? row.product;
  if (nested && typeof nested === 'object') {
    const sub = nested.goods_id ?? nested.goodsId ?? nested.id;
    if (sub != null && String(sub).trim() !== '') return String(sub).trim();
  }
  return '';
}

function rowGoodsSnCandidates(row) {
  if (!row || typeof row !== 'object') return [];
  return [
    row.goods_sn,
    row.goodsSn,
    row.bar_code,
    row.barCode,
    row.sku,
    row.goods_barcode,
    row.barcode
  ].filter((x) => x != null && String(x).trim() !== '');
}

/** After /sync_goods with no goods_id in the body, match by SKU against device_detail.inventory */
function findGoodsIdByGoodsSnInInventory(rows, goodsSn) {
  const target = String(goodsSn ?? '')
    .trim()
    .toLowerCase();
  if (!target || !Array.isArray(rows)) return '';
  for (const row of rows) {
    for (const c of rowGoodsSnCandidates(row)) {
      if (String(c).trim().toLowerCase() === target) {
        const gid = getCloudGoodsId(row);
        if (gid) return gid;
      }
    }
  }
  return '';
}

function normalizeSlotRow(row, idx) {
  const sevNo = String(row.sev_no ?? row.sevNo ?? row.cabinet_no ?? row.cabinetNo ?? '1');
  const rowN = Number(
    row.row ?? row.row_num ?? row.layer ?? row.r ?? row.hang ?? row.layer_no ?? row.layerNo ?? 0
  );
  const colN = Number(
    row.col ?? row.col_num ?? row.column ?? row.c ?? row.cell ?? row.column_no ?? row.columnNo ?? idx
  );
  const gid = getCloudGoodsId(row);
  return {
    key: `${sevNo}-${rowN}-${colN}-${idx}`,
    sevNo,
    row: rowN,
    col: colN,
    goodsId: gid,
    goodsName: row.goodsName || row.goods_name || row.name || '—',
    num: row.num != null ? Number(row.num) : 0,
    maxNum: row.max_num != null ? Number(row.max_num) : row.maxNum != null ? Number(row.maxNum) : 0,
    raw: row
  };
}

function pickGoodsIdForSave(slot, draft, inventoryItems, { rs485Mode = false } = {}) {
  const catalogItem = inventoryItems.find((i) => i.id === draft.catalogInventoryId);
  const fromCatalog = catalogItem?.vending_cloud_goods_id;
  if (fromCatalog) return String(fromCatalog).trim();
  if (rs485Mode && catalogItem?.id) {
    return `tavari-${String(catalogItem.id).replace(/-/g, '').slice(0, 12)}`;
  }
  if (slot.goodsId) return slot.goodsId;
  return '';
}

function resolveGoodsIdForNewSlot(catalogItem, manualGoodsId, { rs485Mode = false } = {}) {
  const pasted = String(manualGoodsId ?? '').trim();
  if (pasted) return pasted;
  const cloud = catalogItem?.vending_cloud_goods_id?.trim();
  if (cloud) return cloud;
  if (rs485Mode && catalogItem?.id) {
    return `tavari-${String(catalogItem.id).replace(/-/g, '').slice(0, 12)}`;
  }
  return '';
}

const TABS = [
  { id: 'devices', label: 'Devices', Icon: FiCpu },
  { id: 'staff_report', label: 'Staff report', Icon: FiBarChart2 },
  { id: 'checklist', label: 'Slot checklist', Icon: FiCheckSquare },
  { id: 'tablet', label: 'Tablet app', Icon: FiDownload },
  { id: 'catalog', label: 'Catalog & cloud', Icon: FiUploadCloud },
  { id: 'slots', label: 'Slots & stock', Icon: FiLayers },
  { id: 'settings', label: 'Settings', Icon: FiSettings }
];

const VendingDashboard = () => {
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'admin', 'owner'],
    requireBusiness: true,
    componentName: 'VendingDashboard'
  });

  const [activeTab, setActiveTab] = useState('devices');
  const [devices, setDevices] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [newDevice, setNewDevice] = useState({ external_device_id: '', display_name: '' });
  const [secretReveal, setSecretReveal] = useState(null);

  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [cloudInventory, setCloudInventory] = useState([]);
  const [loadingCloud, setLoadingCloud] = useState(false);

  const [pushInventoryId, setPushInventoryId] = useState('');
  const [pushing, setPushing] = useState(false);

  const [slotRows, setSlotRows] = useState([]);
  const [slotDrafts, setSlotDrafts] = useState({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotSavingKey, setSlotSavingKey] = useState(null);
  const [testVendTogglingId, setTestVendTogglingId] = useState(null);
  const [kioskAccessTogglingId, setKioskAccessTogglingId] = useState(null);
  const [testDispenseKey, setTestDispenseKey] = useState(null);
  const [diagDeviceId, setDiagDeviceId] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagAction, setDiagAction] = useState(null);
  const [bulkSevNo, setBulkSevNo] = useState('1');
  const [bulkWorking, setBulkWorking] = useState(false);

  /** Manual lane programming when vendor returns no rows yet — maps to save_stock */
  const [newSlot, setNewSlot] = useState({
    sevNo: '1',
    row: '1',
    col: '1',
    catalogInventoryId: '',
    manualGoodsId: '',
    num: '0',
    maxNum: '10'
  });
  const [savingNewSlot, setSavingNewSlot] = useState(false);

  /** When /sync_goods returns only OK — paste goods_id from Apizza / merchant portal */
  const [manualLinkInventoryId, setManualLinkInventoryId] = useState('');
  const [manualGoodsIdPaste, setManualGoodsIdPaste] = useState('');

  const [onlineMap, setOnlineMap] = useState({});

  const loadDevices = useCallback(async () => {
    if (!auth.selectedBusinessId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vending_devices')
        .select(
          'id, external_device_id, display_name, kiosk_short_code, test_vend_enabled, dispense_mode, kiosk_access_mode, created_at, updated_at'
        )
        .eq('business_id', auth.selectedBusinessId)
        .order('display_name', { ascending: true });

      if (error) throw error;
      setDevices(data || []);
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Failed to load vending devices');
    } finally {
      setLoading(false);
    }
  }, [auth.selectedBusinessId]);

  const loadInventory = useCallback(async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('id, name, sku, vending_cloud_goods_id, price, cost, image_url')
        .eq('business_id', auth.selectedBusinessId)
        .or('is_active.eq.true,is_active.is.null')
        .order('name', { ascending: true })
        .limit(500);

      if (error) throw error;
      setInventoryItems(data || []);
    } catch (e) {
      console.warn('Inventory list:', e);
      setInventoryItems([]);
    }
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    if (activeTab !== 'slots' && activeTab !== 'tablet') return;
    const rs485Devices = devices.filter((d) => d.dispense_mode === 'rs485');
    if (!selectedDeviceId && rs485Devices.length === 1) {
      setSelectedDeviceId(rs485Devices[0].id);
    }
  }, [activeTab, devices, selectedDeviceId]);

  useEffect(() => {
    loadDevices();
    loadInventory();
  }, [loadDevices, loadInventory]);

  const pingOnline = async (deviceRow) => {
    setOnlineMap((m) => ({ ...m, [deviceRow.id]: 'loading' }));
    try {
      const ok = await vendingMachineService.checkMachineOnline(deviceRow.external_device_id);
      setOnlineMap((m) => ({ ...m, [deviceRow.id]: ok ? 'online' : 'offline' }));
      if (!ok) {
        toast(
          'Vendor reports this device as offline — check Wi‑Fi/SIM/power, or wait for the machine to sync with their cloud.',
          { duration: 5500 }
        );
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Ping failed — check Supabase vending secrets and Edge deploy.');
      setOnlineMap((m) => ({ ...m, [deviceRow.id]: 'offline' }));
    }
  };

  const handleLoadCloudProducts = async (opts = {}) => {
    const { silentToast } = opts;
    if (!selectedDeviceId) {
      toast.error('Select a device first');
      return;
    }
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      toast.error('Device not found');
      return;
    }
    setLoadingCloud(true);
    setCloudInventory([]);
    try {
      const data = await vendingMachineService.getInventory(device.external_device_id);
      const raw = data.inventory || [];
      const normalized = raw
        .map((row, idx) => {
          const gid = getCloudGoodsId(row);
          return { row, gid, idx };
        })
        .filter((x) => x.gid);
      setCloudInventory(
        normalized.map(({ row, gid, idx }) => ({
          key: `${gid}-${idx}`,
          goodsId: gid,
          goodsName: row.goodsName || row.goods_name || row.name || `Product ${gid}`,
          price: row.price,
          num: row.num,
          maxNum: row.max_num ?? row.maxNum,
          row,
          idx
        }))
      );
      if (!silentToast) {
        toast.success(
          normalized.length
            ? `Loaded ${normalized.length} product(s) from the cloud`
            : 'Cloud returned no products with a goods id'
        );
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not load cloud inventory');
    } finally {
      setLoadingCloud(false);
    }
  };

  const handlePushCatalogToCloud = async () => {
    if (!auth.selectedBusinessId || !pushInventoryId) {
      toast.error('Select a catalog item to push');
      return;
    }
    const inv = inventoryItems.find((i) => i.id === pushInventoryId);
    if (!inv) return;

    setPushing(true);
    try {
      const priceStr = Number(inv.price ?? 0).toFixed(2);
      const comeStr = Number(inv.cost ?? 0).toFixed(2);
      // Vendor /sync_goods often returns 参数不全 if goods_sn or pic_url is empty — supply defaults.
      const skuTrim = String(inv.sku ?? '')
        .trim()
        .slice(0, 120);
      const goodsSn =
        skuTrim || `TAVARI-${String(inv.id).replace(/-/g, '').slice(0, 40)}`.slice(0, 120);
      const picTrim = String(inv.image_url ?? '').trim();
      const picUrl =
        picTrim ||
        'https://placehold.co/96x96/e5e7eb/9ca3af/png?text=%20';
      const existingCloud = inv.vending_cloud_goods_id
        ? String(inv.vending_cloud_goods_id).trim()
        : '';
      const device = devices.find((d) => d.id === selectedDeviceId);
      const extId = device?.external_device_id != null ? String(device.external_device_id).trim() : '';

      let { goodsId, result: syncResult } = await vendingMachineService.syncProduct({
        goodsName: (inv.name || 'Product').slice(0, 200),
        goodsSn,
        picUrl,
        comePrice: comeStr,
        price: priceStr,
        vipPrice: priceStr,
        usage: '',
        ...(existingCloud ? { existingGoodsId: existingCloud } : {}),
        ...(extId ? { deviceId: extId } : {})
      });

      if (!goodsId && extId) {
        try {
          const resolved = await vendingMachineService.resolveGoodsIdAfterSync({
            deviceId: extId,
            goodsSn,
            goodsName: inv.name
          });
          if (resolved.goodsId) goodsId = resolved.goodsId;
        } catch (e) {
          console.warn('Vending: terminal goods_id resolve failed', e);
        }
      }

      if (!goodsId && syncResult != null) {
        console.info(
          '[vending] sync_goods returned OK without goods_id in JSON — paste goods_id from vendor portal (Catalog → Set goods_id manually).',
          syncResult
        );
      }

      if (!goodsId && selectedDeviceId) {
        const device = devices.find((d) => d.id === selectedDeviceId);
        const extId = device?.external_device_id != null ? String(device.external_device_id).trim() : '';
        if (extId) {
          try {
            const cloud = await vendingMachineService.getInventory(extId);
            goodsId = findGoodsIdByGoodsSnInInventory(cloud.inventory || [], goodsSn);
          } catch (e) {
            console.warn('Vending: could not resolve goods_id from device inventory', e);
          }
        }
      }

      if (goodsId) {
        const { error } = await supabase
          .from('pos_inventory')
          .update({
            vending_cloud_goods_id: goodsId,
            updated_at: new Date().toISOString()
          })
          .eq('id', inv.id)
          .eq('business_id', auth.selectedBusinessId);
        if (error) throw error;
        toast.success(`Pushed to vendor cloud — linked goods_id ${goodsId}`);
      } else {
        if (selectedDeviceId) {
          await handleLoadCloudProducts({ silentToast: true });
          toast.success(
            'Synced, but the vendor did not return a goods_id. Use “Set goods_id manually” below (copy from Apizza / merchant portal), then Program a slot.',
            { duration: 9000 }
          );
        } else {
          toast.success(
            'Synced, but no goods_id in the API response. Use “Set goods_id manually” on this tab, then pick a device and Program a slot.',
            { duration: 8000 }
          );
        }
      }
      loadInventory();
    } catch (err) {
      toast.error(err.message || 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  const handleSaveManualGoodsId = async () => {
    if (!auth.selectedBusinessId || !manualLinkInventoryId || !String(manualGoodsIdPaste).trim()) {
      toast.error('Choose a catalog item and paste the vendor goods_id.');
      return;
    }
    try {
      const { error } = await supabase
        .from('pos_inventory')
        .update({
          vending_cloud_goods_id: String(manualGoodsIdPaste).trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', manualLinkInventoryId)
        .eq('business_id', auth.selectedBusinessId);
      if (error) throw error;
      toast.success('Saved goods_id — you can Program a slot now.');
      setManualGoodsIdPaste('');
      loadInventory();
    } catch (err) {
      toast.error(err.message || 'Could not save');
    }
  };

  const loadPersistedSlots = async (vendingDeviceId) => {
    if (!auth.selectedBusinessId || !vendingDeviceId) return [];
    const { data, error } = await supabase
      .from('vending_device_slots')
      .select(
        'id, sev_no, row_num, col_num, manufacturer_goods_id, pos_inventory_id, rs485_lane_byte, num, max_num, synced_at'
      )
      .eq('business_id', auth.selectedBusinessId)
      .eq('vending_device_id', vendingDeviceId)
      .order('sev_no')
      .order('row_num')
      .order('col_num');

    if (error) throw error;
    return data || [];
  };

  const upsertPersistedSlot = async ({
    vendingDeviceId,
    sevNo,
    row,
    col,
    goodsId,
    posInventoryId,
    num,
    maxNum,
    rs485LaneByte,
    dualVendColNum,
    rs485LaneByteSecondary
  }) => {
    if (!auth.selectedBusinessId || !vendingDeviceId) return;
    const lane =
      rs485LaneByte != null ? rs485LaneByte : defaultRs485LaneByte(row, col);
    const payload = {
      business_id: auth.selectedBusinessId,
      vending_device_id: vendingDeviceId,
      sev_no: String(sevNo ?? '1'),
      row_num: row,
      col_num: col,
      manufacturer_goods_id: String(goodsId),
      pos_inventory_id: posInventoryId || null,
      rs485_lane_byte: lane >= 0 ? lane : null,
      num,
      max_num: maxNum,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (dualVendColNum !== undefined) {
      payload.dual_vend_col_num = dualVendColNum;
      payload.rs485_lane_byte_secondary = rs485LaneByteSecondary ?? null;
    }
    const { error } = await supabase.from('vending_device_slots').upsert(payload, {
      onConflict: 'vending_device_id,sev_no,row_num,col_num'
    });
    if (error) throw error;
  };

  const setDualVendMerge = async ({ vendingDeviceId, row, col, enabled }) => {
    if (!auth.selectedBusinessId || !vendingDeviceId) return;
    const partnerCol = col + 1;
    const secondaryLane = enabled ? defaultRs485LaneByte(row, partnerCol) : null;
    const { error } = await supabase
      .from('vending_device_slots')
      .update({
        dual_vend_col_num: enabled ? partnerCol : null,
        rs485_lane_byte_secondary: enabled ? secondaryLane : null,
        updated_at: new Date().toISOString()
      })
      .eq('business_id', auth.selectedBusinessId)
      .eq('vending_device_id', vendingDeviceId)
      .eq('sev_no', VENDING_DEFAULT_SEV_NO)
      .eq('row_num', row)
      .eq('col_num', col);
    if (error) throw error;
  };

  const deletePersistedSlot = async ({ vendingDeviceId, sevNo, row, col }) => {
    if (!auth.selectedBusinessId || !vendingDeviceId) return;
    const { error } = await supabase
      .from('vending_device_slots')
      .delete()
      .eq('business_id', auth.selectedBusinessId)
      .eq('vending_device_id', vendingDeviceId)
      .eq('sev_no', String(sevNo ?? '1'))
      .eq('row_num', row)
      .eq('col_num', col);
    if (error) throw error;
  };

  const handleAssignCloudToCatalog = async (cloudGoodsId, posInventoryId) => {
    if (!auth.selectedBusinessId || !posInventoryId || !cloudGoodsId) return;
    try {
      const { error } = await supabase
        .from('pos_inventory')
        .update({
          vending_cloud_goods_id: cloudGoodsId,
          updated_at: new Date().toISOString()
        })
        .eq('id', posInventoryId)
        .eq('business_id', auth.selectedBusinessId);

      if (error) throw error;
      toast.success('Linked catalog item to cloud product');
      loadInventory();
    } catch (err) {
      toast.error(err.message || 'Could not save link');
    }
  };

  const handleClearVendingLink = async (posInventoryId) => {
    if (!auth.selectedBusinessId) return;
    try {
      const { error } = await supabase
        .from('pos_inventory')
        .update({
          vending_cloud_goods_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', posInventoryId)
        .eq('business_id', auth.selectedBusinessId);

      if (error) throw error;
      toast.success('Vending link cleared');
      loadInventory();
    } catch (err) {
      toast.error(err.message || 'Could not clear link');
    }
  };

  const loadSlotLayout = async (opts = {}) => {
    const { suppressSuccessToast } = opts;
    if (!selectedDeviceId) {
      toast.error('Select a device');
      return 0;
    }
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      toast.error('Device not found');
      return 0;
    }
    setLoadingSlots(true);
    setSlotRows([]);
    setSlotDrafts({});
    try {
      const isRs485 = device.dispense_mode === 'rs485';
      let vendorNormalized = [];
      if (!isRs485) {
        const details = await vendingMachineService.getDeviceDetails(device.external_device_id);
        vendorNormalized = (details.inventory || []).map((row, idx) => normalizeSlotRow(row, idx));
      }
      const persistedRows = await loadPersistedSlots(device.id);
      const tavariNormalized = persistedRows.map((row) => {
        const catalogItem = inventoryItems.find(
          (i) => i.id === row.pos_inventory_id || i.vending_cloud_goods_id === row.manufacturer_goods_id
        );
        return normalizePersistedSlotRow(row, catalogItem);
      });
      const normalized = mergeVendorAndTavariSlots(vendorNormalized, tavariNormalized);

      setSlotRows(normalized);
      const drafts = {};
      for (const s of normalized) {
        const linkedId =
          inventoryItems.find((i) => i.vending_cloud_goods_id === s.goodsId)?.id ||
          s.posInventoryId ||
          '';
        drafts[s.key] = {
          catalogInventoryId: linkedId,
          num: String(s.num ?? '0'),
          maxNum: String(s.maxNum ?? '0')
        };
      }
      setSlotDrafts(drafts);
      if (!suppressSuccessToast) {
        if (normalized.length) {
          const fromTavari = normalized.filter((s) => s.source === 'tavari').length;
          toast.success(
            `Loaded ${normalized.length} slot(s)${
              isRs485
                ? ' (Tavari RS485 layout)'
                : fromTavari && !vendorNormalized.length
                  ? ' (from Tavari records)'
                  : ''
            }`
          );
        } else {
          toast(
            isRs485
              ? 'No slots yet — use Assign product to slot below (pick row/col and a catalog item).'
              : 'No slots yet — use Program a new slot below (calls vendor save_stock and saves in Tavari).',
            { duration: 7000 }
          );
        }
      }
      return normalized.length;
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not load machine layout');
      return 0;
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (!slotRows.length || !inventoryItems.length) return;
    setSlotDrafts((prev) => {
      const next = { ...prev };
      for (const s of slotRows) {
        if (!next[s.key]) continue;
        const linkedId = inventoryItems.find((i) => i.vending_cloud_goods_id === s.goodsId)?.id || '';
        if (linkedId && !next[s.key].catalogInventoryId) {
          next[s.key] = { ...next[s.key], catalogInventoryId: linkedId };
        }
      }
      return next;
    });
  }, [inventoryItems, slotRows]);

  const handleSaveSlot = async (slot) => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) return;
    const draft = slotDrafts[slot.key];
    if (!draft) return;
    const isRs485 = device.dispense_mode === 'rs485';

    const goodsId = pickGoodsIdForSave(slot, draft, inventoryItems, { rs485Mode: isRs485 });
    if (!goodsId) {
      toast.error(
        isRs485
          ? 'Choose a catalog product for this slot.'
          : 'Choose a catalog product that already has a cloud goods_id, or push it from the Catalog tab first.'
      );
      return;
    }

    const num = Math.max(0, parseInt(String(draft.num).replace(/\D/g, ''), 10) || 0);
    const maxNum = Math.max(0, parseInt(String(draft.maxNum).replace(/\D/g, ''), 10) || 0);

    setSlotSavingKey(slot.key);
    try {
      if (!isRs485) {
        try {
          await vendingMachineService.saveInventory({
            deviceId: device.external_device_id,
            sevNo: slot.sevNo,
            row: slot.row,
            col: slot.col,
            goodsId,
            maxNum,
            num
          });
        } catch (vendorErr) {
          toast.error(
            `${vendorErr.message || 'Vendor save_stock failed'} — slot saved in Tavari; retry when vendor API is reachable.`,
            { duration: 9000 }
          );
        }
      }
      await upsertPersistedSlot({
        vendingDeviceId: device.id,
        sevNo: slot.sevNo,
        row: slot.row,
        col: slot.col,
        goodsId,
        posInventoryId: draft.catalogInventoryId || null,
        num,
        maxNum
      });
      toast.success(isRs485 ? 'Slot saved — appears on tablet after refresh' : 'Slot saved');
      await loadSlotLayout();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSlotSavingKey(null);
    }
  };

  const handleSaveAssignmentSlot = async (cell, { catalogInventoryId, num, maxNum }) => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) throw new Error('Select a device');
    const draft = {
      catalogInventoryId,
      num: String(num ?? 10),
      maxNum: String(maxNum ?? 10)
    };
    const slot = {
      key: cell.key,
      sevNo: cell.sevNo,
      row: cell.row,
      col: cell.col,
      goodsId: cell.goodsId
    };
    const goodsId = pickGoodsIdForSave(slot, draft, inventoryItems, {
      rs485Mode: device.dispense_mode === 'rs485'
    });
    if (!goodsId) throw new Error('Could not resolve product');
    await upsertPersistedSlot({
      vendingDeviceId: device.id,
      sevNo: cell.sevNo,
      row: cell.row,
      col: cell.col,
      goodsId,
      posInventoryId: catalogInventoryId,
      num: Math.max(0, parseInt(String(num), 10) || 0),
      maxNum: Math.max(0, parseInt(String(maxNum), 10) || 10)
    });
  };

  const handleDualMergeAssignment = async (cell, enabled) => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) throw new Error('Select a device');
    if (device.dispense_mode !== 'rs485') {
      throw new Error('Dual-motor merge is only for RS485 devices');
    }
    if (enabled) {
      if (!canEnableDualVend(cell.row, cell.col)) {
        throw new Error(`Row ${cell.row} has no column to the right to merge`);
      }
      if (!cell.posInventoryId && !cell.goodsId) {
        throw new Error('Assign a product to this slot before merging columns');
      }
      const partnerCol = defaultDualPartnerCol(cell.col);
      const { data: partnerRows } = await supabase
        .from('vending_device_slots')
        .select('id, pos_inventory_id, manufacturer_goods_id')
        .eq('business_id', auth.selectedBusinessId)
        .eq('vending_device_id', device.id)
        .eq('row_num', cell.row)
        .eq('col_num', partnerCol)
        .maybeSingle();
      if (partnerRows?.pos_inventory_id || partnerRows?.manufacturer_goods_id) {
        throw new Error(`Clear slot ${cell.row}-${partnerCol} before merging`);
      }
    }
    await setDualVendMerge({
      vendingDeviceId: device.id,
      row: cell.row,
      col: cell.col,
      enabled
    });
  };

  const handleRemoveSlot = async (slot, { skipConfirm = false } = {}) => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) return;
    const isRs485 = device.dispense_mode === 'rs485';
    if (
      !skipConfirm &&
      !window.confirm(
        isRs485
          ? 'Clear this slot assignment?'
          : 'Remove this product from the slot in the vendor cloud?'
      )
    ) {
      return;
    }
    setSlotSavingKey(slot.key);
    try {
      if (!isRs485) {
        await vendingMachineService.removeInventory({
          deviceId: device.external_device_id,
          sevNo: slot.sevNo,
          row: slot.row,
          col: slot.col
        });
      }
      await deletePersistedSlot({
        vendingDeviceId: device.id,
        sevNo: slot.sevNo,
        row: slot.row,
        col: slot.col
      });
      if (!skipConfirm) {
        toast.success('Slot cleared');
        await loadSlotLayout();
      }
    } catch (err) {
      throw err;
    } finally {
      setSlotSavingKey(null);
    }
  };

  const handleProgramNewSlot = async (e) => {
    e?.preventDefault?.();
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      toast.error('Select a device first');
      return;
    }
    const inv = inventoryItems.find((i) => i.id === newSlot.catalogInventoryId);
    const isRs485 = device.dispense_mode === 'rs485';
    const goodsId = resolveGoodsIdForNewSlot(inv, newSlot.manualGoodsId, { rs485Mode: isRs485 });
    if (!goodsId) {
      toast.error(
        isRs485
          ? 'Pick a catalog product for this slot.'
          : 'Paste vendor goods_id above, or pick a catalog row that already has one (Catalog → Set goods_id manually).'
      );
      return;
    }
    const row = parseInt(String(newSlot.row).replace(/\D/g, ''), 10);
    const col = parseInt(String(newSlot.col).replace(/\D/g, ''), 10);
    const sevNo = String(newSlot.sevNo ?? '1').trim() || '1';
    const num = Math.max(0, parseInt(String(newSlot.num).replace(/\D/g, ''), 10) || 0);
    const maxNum = Math.max(0, parseInt(String(newSlot.maxNum).replace(/\D/g, ''), 10) || 0);
    if (Number.isNaN(row) || Number.isNaN(col)) {
      toast.error('Enter valid row and column numbers for your machine grid.');
      return;
    }
    if (col > getSlotColsForRow(row)) {
      toast.error(`Row ${row} only has ${getSlotColsForRow(row)} slot(s) on this machine.`);
      return;
    }
    if (isRs485 && !newSlot.catalogInventoryId) {
      toast.error('Pick a catalog product — RS485 mode assigns Tavari catalog items directly.');
      return;
    }

    setSavingNewSlot(true);
    try {
      if (!isRs485) {
        try {
          await vendingMachineService.saveInventory({
            deviceId: device.external_device_id,
            sevNo,
            row,
            col,
            goodsId,
            maxNum,
            num
          });
        } catch (vendorErr) {
          toast.error(
            `${vendorErr.message || 'Vendor save_stock failed'} — slot saved in Tavari; machine may need vendor API when online.`,
            { duration: 9000 }
          );
        }
      }
      await upsertPersistedSlot({
        vendingDeviceId: device.id,
        sevNo,
        row,
        col,
        goodsId,
        posInventoryId: newSlot.catalogInventoryId || null,
        num,
        maxNum
      });
      toast.success(
        isRs485
          ? `Slot ${row}-${col} assigned (lane ${defaultRs485LaneByte(row, col)}) — refresh tablet kiosk`
          : 'Slot programmed — saved in Tavari and sent to vendor cloud'
      );
      if (newSlot.catalogInventoryId && pasted && auth.selectedBusinessId) {
        try {
          await supabase
            .from('pos_inventory')
            .update({
              vending_cloud_goods_id: pasted,
              updated_at: new Date().toISOString()
            })
            .eq('id', newSlot.catalogInventoryId)
            .eq('business_id', auth.selectedBusinessId);
          await loadInventory();
        } catch {
          /* catalog sync is optional */
        }
      }
      await loadSlotLayout();
    } catch (err) {
      toast.error(err.message || 'Could not program slot');
    } finally {
      setSavingNewSlot(false);
    }
  };

  const handleBulkFillAll = async () => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) return;
    if (!window.confirm('Tell the vendor API to fill all stock for this cabinet?')) return;
    setBulkWorking(true);
    try {
      await vendingMachineService.fillAllInventory(device.external_device_id, bulkSevNo);
      const n = await loadSlotLayout({ suppressSuccessToast: true });
      toast.success(
        n > 0
          ? `Fill-all requested — refreshed ${n} slot row(s) from the vendor.`
          : 'Fill-all requested — vendor still reports no slot rows. Check the cabinet number matches your machine (sev_no) and refresh layout after slots are configured.',
        { duration: n > 0 ? 4000 : 8000 }
      );
    } catch (err) {
      toast.error(err.message || 'Request failed');
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkDownAll = async () => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) return;
    if (!window.confirm('Remove all stock from this cabinet in the vendor cloud?')) return;
    setBulkWorking(true);
    try {
      await vendingMachineService.downAllInventory(device.external_device_id, bulkSevNo);
      const n = await loadSlotLayout({ suppressSuccessToast: true });
      toast.success(
        n > 0
          ? `Down-all requested — refreshed ${n} slot row(s).`
          : 'Down-all requested — vendor still reports no slot rows (check device ID and sev_no).',
        { duration: n > 0 ? 4000 : 7000 }
      );
    } catch (err) {
      toast.error(err.message || 'Request failed');
    } finally {
      setBulkWorking(false);
    }
  };

  const handleAddDevice = async (e) => {
    e.preventDefault();
    if (!auth.selectedBusinessId) return;
    const ext = normalizeVendorDeviceId(newDevice.external_device_id);
    if (!ext) {
      toast.error('Enter the manufacturer device ID');
      return;
    }

    const plainSecret = randomKioskSecret();
    const kiosk_secret_hash = await sha256Hex(plainSecret);

    try {
      const kiosk_short_code = generateKioskShortCode();
      const { data, error } = await supabase
        .from('vending_devices')
        .insert({
          business_id: auth.selectedBusinessId,
          external_device_id: ext,
          display_name: newDevice.display_name.trim() || null,
          kiosk_secret_hash,
          kiosk_short_code
        })
        .select('id, kiosk_short_code')
        .single();

      if (error) throw error;

      setSecretReveal({
        deviceRowId: data.id,
        external_device_id: ext,
        kioskSecret: plainSecret,
        kiosk_short_code: data.kiosk_short_code
      });
      setNewDevice({ external_device_id: '', display_name: '' });
      toast.success('Device added — save the kiosk secret now (shown once).');
      loadDevices();
    } catch (err) {
      toast.error(err.message || 'Could not add device');
    }
  };

  const handleDeleteDevice = async (device) => {
    if (!window.confirm(`Remove device "${device.display_name || device.external_device_id}"?`)) return;
    try {
      const { error } = await supabase.from('vending_devices').delete().eq('id', device.id);
      if (error) throw error;
      toast.success('Device removed');
      if (selectedDeviceId === device.id) {
        setSelectedDeviceId('');
        setCloudInventory([]);
        setSlotRows([]);
        setSlotDrafts({});
      }
      loadDevices();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  const handleRotateSecret = async (device) => {
    const plainSecret = randomKioskSecret();
    const kiosk_secret_hash = await sha256Hex(plainSecret);
    try {
      const { error } = await supabase
        .from('vending_devices')
        .update({ kiosk_secret_hash, updated_at: new Date().toISOString() })
        .eq('id', device.id);

      if (error) throw error;
      setSecretReveal({
        deviceRowId: device.id,
        external_device_id: device.external_device_id,
        kioskSecret: plainSecret,
        kiosk_short_code: device.kiosk_short_code
      });
      toast.success('New kiosk secret generated — copy it now.');
    } catch (err) {
      toast.error(err.message || 'Rotate failed');
    }
  };

  const handleToggleTestVend = async (device) => {
    const next = !device.test_vend_enabled;
    setTestVendTogglingId(device.id);
    try {
      const { error } = await supabase
        .from('vending_devices')
        .update({ test_vend_enabled: next, updated_at: new Date().toISOString() })
        .eq('id', device.id);
      if (error) throw error;
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? { ...d, test_vend_enabled: next } : d))
      );
      toast.success(next ? 'Test vend enabled on public kiosk' : 'Test vend disabled');
    } catch (err) {
      toast.error(err.message || 'Could not update test vend setting');
    } finally {
      setTestVendTogglingId(null);
    }
  };

  const handleKioskAccessModeChange = async (device, nextMode) => {
    const mode = nextMode === 'staff_pin' ? 'staff_pin' : 'payment';
    if ((device.kiosk_access_mode || 'payment') === mode) return;
    setKioskAccessTogglingId(device.id);
    try {
      const { error } = await supabase
        .from('vending_devices')
        .update({ kiosk_access_mode: mode, updated_at: new Date().toISOString() })
        .eq('id', device.id);
      if (error) throw error;
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? { ...d, kiosk_access_mode: mode } : d))
      );
      toast.success(
        mode === 'staff_pin'
          ? 'Kiosk set to staff PIN mode — checkout requires PIN, no payment'
          : 'Kiosk set to payment mode — Helcim checkout required'
      );
    } catch (err) {
      toast.error(err.message || 'Could not update kiosk access mode');
    } finally {
      setKioskAccessTogglingId(null);
    }
  };

  const handleTestDispense = async (slot) => {
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      toast.error('Select a device first');
      return;
    }
    if (!slot.goodsId) {
      toast.error('This slot has no goods_id');
      return;
    }
    setTestDispenseKey(slot.key);
    try {
      const online = await vendingMachineService.checkMachineOnline(device.external_device_id);
      setOnlineMap((m) => ({ ...m, [device.id]: online ? 'online' : 'offline' }));
      if (!online) {
        toast('Vendor cloud reports offline — trying dispense anyway…', { icon: '⚠️' });
      }
      await vendingMachineService.createOrder({
        deviceId: device.external_device_id,
        goodsId: slot.goodsId,
        orderNo: `STAFF-TEST-${Date.now()}`
      });
      toast.success('Test dispense sent — check the machine');
      await loadSlotLayout();
    } catch (err) {
      toast.error(err.message || 'Test dispense failed');
    } finally {
      setTestDispenseKey(null);
    }
  };

  const runDeviceDiagnostics = async (device) => {
    setDiagDeviceId(device.id);
    setDiagLoading(true);
    setDiagResult(null);
    try {
      const [online, details, canOrder] = await Promise.all([
        vendingMachineService.checkMachineOnline(device.external_device_id),
        vendingMachineService.getDeviceDetails(device.external_device_id),
        vendingMachineService.getCanOrderStatus(device.external_device_id, '153714')
      ]);
      setOnlineMap((m) => ({ ...m, [device.id]: online ? 'online' : 'offline' }));
      setDiagResult({ online, details, canOrder, device });
    } catch (err) {
      toast.error(err.message || 'Diagnostics failed');
    } finally {
      setDiagLoading(false);
    }
  };

  const handleDiagTestSlot = async (device) => {
    setDiagAction('slot');
    try {
      await vendingMachineService.testRemoteChannel({
        deviceId: device.external_device_id,
        sevNo: '1',
        row: 1,
        col: 1
      });
      toast.success('Slot motor test sent (cabinet 1, row 1, col 1) — check the machine');
    } catch (err) {
      toast.error(err.message || 'Slot motor test failed');
    } finally {
      setDiagAction(null);
    }
  };

  const handleDiagTestBubly = async (device) => {
    setDiagAction('bubly');
    try {
      const canOrder = await vendingMachineService.getCanOrderStatus(
        device.external_device_id,
        '153714'
      );
      if (!canOrder.ok) {
        throw new Error(canOrder.msg || 'Vendor says this product cannot be ordered right now');
      }
      await vendingMachineService.createOrder({
        deviceId: device.external_device_id,
        goodsId: '153714',
        orderNo: `DIAG-BUBLY-${Date.now()}`
      });
      toast.success('Bubly test dispense sent — check the pickup door');
    } catch (err) {
      toast.error(err.message || 'Bubly test dispense failed');
    } finally {
      setDiagAction(null);
    }
  };

  const shortKioskUrl = (shortCode) => buildVendingShortKioskUrl(window.location.origin, shortCode);
  const testKioskUrl = (shortCode) => `${shortKioskUrl(shortCode)}?testVend=1`;

  const legacyKioskUrl = (externalId, secret) => {
    const base = `${window.location.origin}/kiosk/vending`;
    const q = new URLSearchParams({
      businessId: auth.selectedBusinessId || '',
      deviceId: externalId,
      kioskSecret: secret
    });
    return `${base}?${q.toString()}`;
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  const linkedCatalogRows = inventoryItems.filter((i) => i.vending_cloud_goods_id);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const selectedDeviceIsRs485 = selectedDevice?.dispense_mode === 'rs485';
  const showRs485SlotAssignment = !selectedDeviceId || selectedDeviceIsRs485;
  const catalogPickerItems = selectedDeviceIsRs485
    ? inventoryItems
    : inventoryItems.filter((i) => i.vending_cloud_goods_id);

  const updateDraft = (key, patch) => {
    setSlotDrafts((d) => ({
      ...d,
      [key]: { ...d[key], ...patch }
    }));
  };

  const renderOnlineBadge = (device) => {
    const st = onlineMap[device.id];
    if (st === 'loading') {
      return (
        <span style={styles.badgeMuted}>
          <FiLoader size={12} style={{ marginRight: 4 }} /> …
        </span>
      );
    }
    if (st === 'online') {
      return (
        <span style={styles.badgeOk}>
          <FiWifi size={12} style={{ marginRight: 4 }} /> Online
        </span>
      );
    }
    if (st === 'offline') {
      return (
        <span style={styles.badgeWarn}>
          <FiWifiOff size={12} style={{ marginRight: 4 }} /> Offline
        </span>
      );
    }
    return null;
  };

  const renderBody = () => {
    if (!auth.isReady) {
      return (
        <div style={{ padding: TavariStyles.spacing.xl, color: TavariStyles.colors.gray600 }}>
          Loading…
        </div>
      );
    }

    return (
      <div style={styles.page}>
        <TavariModuleHeader
          title="Tavari Vending"
          description="Register devices, map catalog items, and manage slot stock for vending kiosks. Vendor API mapping happens here in the dashboard."
          actionLabel="+ Add Device"
          actionIcon={<FiPlus size={18} />}
          onAction={() => setActiveTab('devices')}
        />

        <TavariTabSystemComponent
          tabs={TABS.map(({ id, label, Icon }) => ({
            id,
            label,
            icon: Icon,
          }))}
          mode="state"
          activeTab={activeTab}
          onTabChange={setActiveTab}
          ariaLabel="Vending module"
          variant="module"
        />

        {secretReveal && (
          <div style={styles.alert}>
            <strong>Kiosk link</strong>
            <p style={{ ...styles.help, marginTop: 8, marginBottom: TavariStyles.spacing.md }}>
              Type this URL on the vending machine browser (tap the box to select all).
            </p>

            <label style={styles.kioskFieldLabel}>Short kiosk URL</label>
            <textarea
              readOnly
              value={shortKioskUrl(
                secretReveal.kiosk_short_code ||
                  devices.find((d) => d.id === secretReveal.deviceRowId)?.kiosk_short_code
              )}
              style={styles.kioskUrlField}
              rows={2}
              onFocus={(e) => e.target.select()}
              aria-label="Short kiosk URL"
            />

            {secretReveal.kioskSecret ? (
              <>
                <p style={{ ...styles.muted, marginTop: TavariStyles.spacing.md, marginBottom: 8 }}>
                  Advanced: long URL with secret (only if the short link does not work).
                </p>
                <textarea
                  readOnly
                  value={legacyKioskUrl(secretReveal.external_device_id, secretReveal.kioskSecret)}
                  style={{ ...styles.kioskUrlField, fontSize: TavariStyles.typography.fontSize.xs }}
                  rows={2}
                  onFocus={(e) => e.target.select()}
                  aria-label="Legacy kiosk URL"
                />
              </>
            ) : null}

            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={styles.btnPrimary}
                onClick={() =>
                  copyText(
                    shortKioskUrl(
                      secretReveal.kiosk_short_code ||
                        devices.find((d) => d.id === secretReveal.deviceRowId)?.kiosk_short_code
                    )
                  )
                }
              >
                <FiCopy style={{ marginRight: 6 }} /> Copy short URL
              </button>
              {secretReveal.kioskSecret ? (
                <button
                  type="button"
                  style={styles.btnSecondary}
                  onClick={() => copyText(legacyKioskUrl(secretReveal.external_device_id, secretReveal.kioskSecret))}
                >
                  <FiCopy style={{ marginRight: 6 }} /> Copy legacy URL
                </button>
              ) : null}
              <button type="button" style={styles.btnGhost} onClick={() => setSecretReveal(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {activeTab === 'devices' && (
          <>
            <section style={styles.card}>
              <h2 style={styles.h2}>Add device</h2>
              <p style={styles.help}>
                Use the <strong>cloud device ID</strong> from the manufacturer portal — the same value as{' '}
                <code style={styles.code}>device_id</code> in their API (not necessarily the serial number on the unit).
                If ping returns “device ID does not exist”, that ID is not registered under your vending merchant account
                yet.
              </p>
              <form onSubmit={handleAddDevice} style={styles.formRow}>
                <input
                  style={styles.input}
                  placeholder="Manufacturer device ID"
                  value={newDevice.external_device_id}
                  onChange={(e) => setNewDevice((p) => ({ ...p, external_device_id: e.target.value }))}
                />
                <input
                  style={styles.input}
                  placeholder="Display name (optional)"
                  value={newDevice.display_name}
                  onChange={(e) => setNewDevice((p) => ({ ...p, display_name: e.target.value }))}
                />
                <button type="submit" style={styles.btnPrimary}>
                  <FiPlus style={{ marginRight: 6 }} /> Add device
                </button>
              </form>
            </section>

            <section style={styles.card}>
              <div style={styles.rowBetween}>
                <h2 style={styles.h2}>Devices</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={styles.btnGhost}
                    onClick={() => setActiveTab('tablet')}
                  >
                    <FiDownload size={16} style={{ marginRight: 6 }} /> Tablet app
                  </button>
                  <button type="button" style={styles.btnGhost} onClick={loadDevices} disabled={loading}>
                    <FiRefreshCw size={16} style={{ marginRight: 6 }} /> Refresh
                  </button>
                </div>
              </div>
              {devices.length === 0 ? (
                <p style={styles.muted}>No devices yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Name</th>
                        <th style={styles.th}>Device ID</th>
                        <th style={styles.th}>Kiosk URL</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>Kiosk access</th>
                        <th style={styles.th}>Test vend</th>
                        <th style={styles.th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.map((d) => (
                        <tr key={d.id}>
                          <td style={styles.td}>{d.display_name || '—'}</td>
                          <td style={styles.td}>
                            <code style={styles.code}>{d.external_device_id}</code>
                          </td>
                          <td style={styles.td}>
                            {d.kiosk_short_code ? (
                              <input
                                readOnly
                                value={shortKioskUrl(d.kiosk_short_code)}
                                style={styles.kioskUrlInline}
                                onFocus={(e) => e.target.select()}
                                aria-label={`Kiosk URL for ${d.display_name || d.external_device_id}`}
                              />
                            ) : (
                              <span style={styles.muted}>—</span>
                            )}
                          </td>
                          <td style={styles.td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {renderOnlineBadge(d)}
                              <button type="button" style={styles.btnGhost} onClick={() => pingOnline(d)}>
                                Ping
                              </button>
                            </div>
                          </td>
                          <td style={styles.td}>
                            <select
                              style={styles.input}
                              value={d.kiosk_access_mode === 'staff_pin' ? 'staff_pin' : 'payment'}
                              disabled={kioskAccessTogglingId === d.id}
                              onChange={(e) => handleKioskAccessModeChange(d, e.target.value)}
                              aria-label={`Kiosk access mode for ${d.display_name || d.external_device_id}`}
                            >
                              <option value="payment">Payment (Helcim)</option>
                              <option value="staff_pin">Staff PIN (no pay)</option>
                            </select>
                            {d.kiosk_access_mode === 'staff_pin' ? (
                              <div style={{ ...styles.muted, fontSize: TavariStyles.typography.fontSize.xs, marginTop: 6 }}>
                                Checkout logs staff name + items — see Staff report tab
                              </div>
                            ) : null}
                          </td>
                          <td style={styles.td}>
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                cursor: testVendTogglingId === d.id ? 'wait' : 'pointer'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(d.test_vend_enabled)}
                                disabled={testVendTogglingId === d.id}
                                onChange={() => handleToggleTestVend(d)}
                              />
                              <span>{d.test_vend_enabled ? 'On' : 'Off'}</span>
                            </label>
                            {d.kiosk_short_code ? (
                              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {d.test_vend_enabled ? (
                                  <button
                                    type="button"
                                    style={styles.btnLink}
                                    onClick={() => copyText(testKioskUrl(d.kiosk_short_code))}
                                  >
                                    Copy test kiosk URL
                                  </button>
                                ) : (
                                  <span style={{ ...styles.muted, fontSize: TavariStyles.typography.fontSize.xs }}>
                                    Enable for kiosk “Test vend (no pay)”
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </td>
                          <td style={styles.td}>
                            <button type="button" style={styles.btnLink} onClick={() => handleRotateSecret(d)}>
                              New kiosk secret
                            </button>
                            <button type="button" style={styles.btnDanger} onClick={() => handleDeleteDevice(d)}>
                              <FiTrash2 size={14} style={{ marginRight: 4 }} /> Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {devices.length > 0 ? (
              <section style={styles.card}>
                <h2 style={styles.h2}>Self-service diagnostics</h2>
                <p style={styles.help}>
                  Run these yourself — no vendor support needed. Dispense requires the machine to reach the vendor
                  cloud (power + Wi‑Fi/SIM). If offline, restart the unit or fix network, then Run diagnostics again.
                </p>
                <div style={{ ...styles.formRow, flexWrap: 'wrap', marginBottom: TavariStyles.spacing.md }}>
                  <select
                    style={styles.input}
                    value={diagDeviceId || devices[0]?.id || ''}
                    onChange={(e) => {
                      setDiagDeviceId(e.target.value);
                      setDiagResult(null);
                    }}
                  >
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.display_name || d.external_device_id}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={styles.btnPrimary}
                    disabled={diagLoading}
                    onClick={() => {
                      const device = devices.find((d) => d.id === (diagDeviceId || devices[0]?.id));
                      if (device) runDeviceDiagnostics(device);
                    }}
                  >
                    {diagLoading ? 'Checking…' : 'Run diagnostics'}
                  </button>
                </div>
                {diagResult ? (
                  <div style={{ marginBottom: TavariStyles.spacing.md }}>
                    <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
                      <li>
                        <strong>Online:</strong>{' '}
                        {diagResult.online ? 'Yes — cloud sees the machine' : 'No — check power/network'}
                      </li>
                      <li>
                        <strong>Bubly (153714) can order:</strong>{' '}
                        {diagResult.canOrder.ok ? diagResult.canOrder.msg : `No — ${diagResult.canOrder.msg}`}
                      </li>
                      <li>
                        <strong>Last cloud report:</strong>{' '}
                        {diagResult.details?.lastReportAt
                          ? new Date(Number(diagResult.details.lastReportAt) * 1000).toLocaleString()
                          : '—'}
                      </li>
                    </ul>
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={styles.btnSecondary}
                    disabled={diagAction != null}
                    onClick={() => {
                      const device = devices.find((d) => d.id === (diagDeviceId || devices[0]?.id));
                      if (device) handleDiagTestSlot(device);
                    }}
                  >
                    {diagAction === 'slot' ? '…' : 'Test slot 1-1 motor'}
                  </button>
                  <button
                    type="button"
                    style={styles.btnSecondary}
                    disabled={diagAction != null}
                    onClick={() => {
                      const device = devices.find((d) => d.id === (diagDeviceId || devices[0]?.id));
                      if (device) handleDiagTestBubly(device);
                    }}
                  >
                    {diagAction === 'bubly' ? '…' : 'Test dispense Bubly (153714)'}
                  </button>
                </div>
              </section>
            ) : null}
          </>
        )}

        {activeTab === 'catalog' && (
          <>
            <section style={styles.card}>
              <h2 style={styles.h2}>Push catalog item to vendor cloud</h2>
              <p style={styles.help}>
                Creates or updates the product at the vendor (<code style={styles.code}>/sync_goods</code>). When the
                response includes <code style={styles.code}>goods_id</code>, we save it on the inventory row as{' '}
                <code style={styles.code}>vending_cloud_goods_id</code>. The vendor API often requires a non-empty
                product code and image URL; if your catalog row has no SKU or image, we send stable placeholders
                automatically.
              </p>
              <div style={{ ...styles.formRow, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <select
                  style={{ ...styles.input, maxWidth: '420px' }}
                  value={pushInventoryId}
                  onChange={(e) => setPushInventoryId(e.target.value)}
                >
                  <option value="">Select catalog item…</option>
                  {inventoryItems.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name}
                      {inv.sku ? ` (${inv.sku})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  style={styles.btnPrimary}
                  disabled={!pushInventoryId || pushing}
                  onClick={handlePushCatalogToCloud}
                >
                  <FiUploadCloud style={{ marginRight: 6 }} />
                  {pushing ? 'Pushing…' : 'Push to vendor cloud'}
                </button>
              </div>
            </section>

            <section style={styles.card}>
              <h2 style={styles.h2}>Set goods_id manually</h2>
              <p style={styles.help}>
                Many vendors return only <code style={styles.code}>{'{ err: 0, msg: "OK" }'}</code> from{' '}
                <code style={styles.code}>sync_goods</code> — no <code style={styles.code}>goods_id</code> in JSON. Copy the
                id from <strong>Apizza</strong> / your <strong>merchant product list</strong>, then save it here so Slots can
                use the catalog dropdown.
              </p>
              <div style={{ ...styles.formRow, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <select
                  style={{ ...styles.input, maxWidth: '360px' }}
                  value={manualLinkInventoryId}
                  onChange={(e) => setManualLinkInventoryId(e.target.value)}
                >
                  <option value="">Catalog item…</option>
                  {inventoryItems.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name}
                      {inv.sku ? ` (${inv.sku})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  style={{ ...styles.input, maxWidth: '240px' }}
                  placeholder="Vendor goods_id"
                  value={manualGoodsIdPaste}
                  onChange={(e) => setManualGoodsIdPaste(e.target.value)}
                  autoComplete="off"
                />
                <button type="button" style={styles.btnSecondary} onClick={handleSaveManualGoodsId}>
                  Save on catalog row
                </button>
              </div>
            </section>

            <section style={styles.card}>
              <h2 style={styles.h2}>Link cloud products to your catalog</h2>
              <p style={styles.help}>
                Select a device, then <strong>Load products from cloud</strong>. Each row shows the vendor&rsquo;s{' '}
                <code style={styles.code}>goods_id</code>. Choose your catalog product — we save{' '}
                <code style={styles.code}>vending_cloud_goods_id</code> on that inventory row.
              </p>
              <div style={{ ...styles.formRow, flexWrap: 'wrap', marginBottom: TavariStyles.spacing.md }}>
                <select
                  style={styles.input}
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setSelectedDeviceId(e.target.value);
                    setCloudInventory([]);
                  }}
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
                  style={styles.btnPrimary}
                  disabled={!selectedDeviceId || loadingCloud}
                  onClick={handleLoadCloudProducts}
                >
                  <FiRefreshCw size={16} style={{ marginRight: 6 }} />
                  {loadingCloud ? 'Loading…' : 'Load products from cloud'}
                </button>
              </div>

              {cloudInventory.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Cloud goods_id</th>
                        <th style={styles.th}>Name (vendor)</th>
                        <th style={styles.th}>Stock</th>
                        <th style={styles.th}>Link to catalog product</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cloudInventory.map((c) => (
                        <tr key={c.key}>
                          <td style={styles.td}>
                            <code style={styles.code}>{c.goodsId}</code>
                          </td>
                          <td style={styles.td}>{c.goodsName}</td>
                          <td style={styles.td}>
                            {c.num ?? '—'} / {c.maxNum ?? '—'}
                          </td>
                          <td style={styles.td}>
                            <select
                              style={{ ...styles.input, minWidth: '220px', flex: 'none' }}
                              value={inventoryItems.find((i) => i.vending_cloud_goods_id === c.goodsId)?.id || ''}
                              onChange={(e) => {
                                const pid = e.target.value;
                                if (pid) handleAssignCloudToCatalog(c.goodsId, pid);
                              }}
                            >
                              <option value="">Choose catalog item…</option>
                              {inventoryItems.map((inv) => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.name}
                                  {inv.sku ? ` (${inv.sku})` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section style={styles.card}>
              <h2 style={styles.h2}>Catalog items linked for vending</h2>
              <p style={styles.help}>
                Inventory rows with <code style={styles.code}>vending_cloud_goods_id</code> set (for callbacks / POS
                sync).
              </p>
              {linkedCatalogRows.length === 0 ? (
                <p style={styles.muted}>None yet — push or link above.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Catalog product</th>
                        <th style={styles.th}>Cloud goods_id</th>
                        <th style={styles.th} />
                      </tr>
                    </thead>
                    <tbody>
                      {linkedCatalogRows.map((inv) => (
                        <tr key={inv.id}>
                          <td style={styles.td}>
                            {inv.name}
                            {inv.sku ? ` (${inv.sku})` : ''}
                          </td>
                          <td style={styles.td}>
                            <code style={styles.code}>{inv.vending_cloud_goods_id}</code>
                          </td>
                          <td style={styles.td}>
                            <button
                              type="button"
                              style={styles.btnDanger}
                              onClick={() => handleClearVendingLink(inv.id)}
                            >
                              Clear link
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === 'slots' && showRs485SlotAssignment ? (
          <VendingSlotAssignmentList
            businessId={auth.selectedBusinessId}
            devices={devices.filter((d) => d.dispense_mode === 'rs485')}
            selectedDeviceId={selectedDeviceId}
            onSelectDeviceId={setSelectedDeviceId}
            inventoryItems={inventoryItems}
            onSaveSlot={handleSaveAssignmentSlot}
            onClearSlot={handleRemoveSlot}
            onSetDualMerge={handleDualMergeAssignment}
          />
        ) : null}

        {activeTab === 'slots' && !showRs485SlotAssignment ? (
          <>
            <section style={styles.card}>
              <h2 style={styles.h2}>Machine slots</h2>
              <p style={styles.help}>
                {selectedDeviceIsRs485 ? (
                  <>
                    Products on the tablet come from these Tavari slot records (not the vendor cloud). Assign each row/col
                    to a catalog item, set stock counts, and save. The tablet reloads products automatically within about
                    a minute.
                  </>
                ) : (
                  <>
                    This is how products appear on the machine: load slot rows from the vendor, pick your Tavari catalog
                    item (it must have <code style={styles.code}>vending_cloud_goods_id</code> from Catalog &amp; cloud),
                    set counts, and save — that invokes <code style={styles.code}>save_stock</code>.
                  </>
                )}
              </p>
              <div style={{ ...styles.formRow, flexWrap: 'wrap', marginBottom: TavariStyles.spacing.md }}>
                <select
                  style={styles.input}
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setSelectedDeviceId(e.target.value);
                    setSlotRows([]);
                    setSlotDrafts({});
                  }}
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
                  style={styles.btnPrimary}
                  disabled={!selectedDeviceId || loadingSlots}
                  onClick={loadSlotLayout}
                >
                  <FiRefreshCw size={16} style={{ marginRight: 6 }} />
                  {loadingSlots ? 'Loading…' : selectedDeviceIsRs485 ? 'Refresh slot list' : 'Refresh layout from cloud'}
                </button>
              </div>

              {slotRows.length === 0 && !loadingSlots && (
                <p style={styles.muted}>
                  {selectedDeviceIsRs485 ? (
                    <>
                      No slots assigned yet — use <strong>Assign product to slot</strong> below for each row/column (1-1
                      through 6-9).
                    </>
                  ) : (
                    <>
                      No slots from the vendor yet — use <strong>Program a new slot</strong> below, or configure lanes in
                      the vendor portal, then refresh.
                    </>
                  )}
                </p>
              )}

              {slotRows.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Cabinet / position</th>
                        <th style={styles.th}>Cloud goods_id</th>
                        <th style={styles.th}>Vendor name</th>
                        <th style={styles.th}>Catalog link</th>
                        <th style={styles.th}>Now / max</th>
                        <th style={styles.th} />
                      </tr>
                    </thead>
                    <tbody>
                      {slotRows.map((slot) => {
                        const draft = slotDrafts[slot.key] || {
                          catalogInventoryId: '',
                          num: '0',
                          maxNum: '0'
                        };
                        const linkedItems = catalogPickerItems;
                        const busy = slotSavingKey === slot.key;
                        const dispensing = testDispenseKey === slot.key;
                        return (
                          <tr key={slot.key}>
                            <td style={styles.td}>
                              <code style={styles.code}>
                                sev {slot.sevNo} · r{slot.row} · c{slot.col}
                              </code>
                            </td>
                            <td style={styles.td}>
                              {slot.goodsId ? <code style={styles.code}>{slot.goodsId}</code> : '—'}
                            </td>
                            <td style={styles.td}>{slot.goodsName}</td>
                            <td style={styles.td}>
                              <select
                                style={{ ...styles.input, minWidth: '200px', flex: 'none' }}
                                value={draft.catalogInventoryId}
                                onChange={(e) =>
                                  updateDraft(slot.key, { catalogInventoryId: e.target.value })
                                }
                              >
                                <option value="">
                                  {selectedDeviceIsRs485 ? 'Select catalog product…' : 'Select catalog (needs cloud link)'}
                                </option>
                                {linkedItems.map((inv) => (
                                  <option key={inv.id} value={inv.id}>
                                    {inv.name}
                                    {inv.sku ? ` · ${inv.sku}` : ''} · id {inv.vending_cloud_goods_id}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={styles.td}>
                              <input
                                type="text"
                                inputMode="numeric"
                                style={{ ...styles.input, width: '56px', flex: 'none', minWidth: '56px' }}
                                value={draft.num}
                                onChange={(e) => updateDraft(slot.key, { num: e.target.value })}
                              />
                              <span style={{ margin: '0 6px' }}>/</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                style={{ ...styles.input, width: '56px', flex: 'none', minWidth: '56px' }}
                                value={draft.maxNum}
                                onChange={(e) => updateDraft(slot.key, { maxNum: e.target.value })}
                              />
                            </td>
                            <td style={styles.td}>
                              {slot.goodsId ? (
                                <button
                                  type="button"
                                  style={{ ...styles.btnSecondary, marginRight: 8 }}
                                  disabled={busy || dispensing}
                                  onClick={() => handleTestDispense(slot)}
                                >
                                  {dispensing ? '…' : 'Test dispense'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                style={styles.btnPrimary}
                                disabled={busy || dispensing}
                                onClick={() => handleSaveSlot(slot)}
                              >
                                {busy ? '…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                style={{ ...styles.btnDanger, marginLeft: 8 }}
                                disabled={busy || dispensing}
                                onClick={() => handleRemoveSlot(slot)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section style={styles.card}>
              <h2 style={styles.h2}>
                {selectedDeviceIsRs485 ? 'Assign product to slot' : 'Program a new slot'}
              </h2>
              <p style={styles.help}>
                {selectedDeviceIsRs485 ? (
                  <>
                    <strong>RS485 mode:</strong> pick cabinet (<code style={styles.code}>sev_no</code> = 1), row and
                    column from your slot checklist (row 6 has 9 columns), and a{' '}
                    <strong>Tavari catalog product</strong>. Lane byte is set automatically (same as checklist). No
                    vendor cloud required — products appear on the tablet after save.
                  </>
                ) : (
                  <>
                    If <strong>Refresh layout</strong> shows no rows yet, you can still create a lane by calling the
                    vendor <code style={styles.code}>save_stock</code> API: pick cabinet (
                    <code style={styles.code}>sev_no</code>) and grid position (
                    <code style={styles.code}>row</code> / <code style={styles.code}>col</code>) from your machine
                    manual or vendor portal, choose a catalog product that already has a{' '}
                    <code style={styles.code}>goods_id</code>, then save.
                  </>
                )}
              </p>
              <form
                onSubmit={handleProgramNewSlot}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: TavariStyles.spacing.md,
                  alignItems: 'end',
                  marginBottom: TavariStyles.spacing.md
                }}
              >
                <label style={styles.fieldLabel}>
                  Device
                  <select
                    style={styles.input}
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    required
                  >
                    <option value="">Select device</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.display_name || d.external_device_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  sev_no (cabinet)
                  <input
                    style={styles.input}
                    value={newSlot.sevNo}
                    onChange={(e) => setNewSlot((s) => ({ ...s, sevNo: e.target.value }))}
                    placeholder="1"
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Row
                  <input
                    style={styles.input}
                    inputMode="numeric"
                    value={newSlot.row}
                    onChange={(e) => setNewSlot((s) => ({ ...s, row: e.target.value }))}
                    placeholder="1"
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Col
                  <input
                    style={styles.input}
                    inputMode="numeric"
                    value={newSlot.col}
                    onChange={(e) => setNewSlot((s) => ({ ...s, col: e.target.value }))}
                    placeholder="1"
                  />
                </label>
                {!selectedDeviceIsRs485 ? (
                  <label style={{ ...styles.fieldLabel, gridColumn: 'span 2' }}>
                    Vendor goods_id (paste if catalog row has none)
                    <input
                      style={styles.input}
                      value={newSlot.manualGoodsId}
                      onChange={(e) => setNewSlot((s) => ({ ...s, manualGoodsId: e.target.value }))}
                      placeholder="From Apizza / merchant portal after sync_goods"
                      autoComplete="off"
                    />
                  </label>
                ) : null}
                <label style={{ ...styles.fieldLabel, gridColumn: 'span 2' }}>
                  {selectedDeviceIsRs485 ? 'Catalog product (required)' : 'Catalog product (optional — used with saved goods_id)'}
                  <select
                    style={styles.input}
                    value={newSlot.catalogInventoryId}
                    onChange={(e) => setNewSlot((s) => ({ ...s, catalogInventoryId: e.target.value }))}
                    required={selectedDeviceIsRs485}
                  >
                    <option value="">
                      {selectedDeviceIsRs485 ? 'Choose product…' : 'Optional — link bookkeeping only'}
                    </option>
                    {catalogPickerItems.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.name}
                        {inv.sku ? ` (${inv.sku})` : ''}
                        {inv.vending_cloud_goods_id ? ` · ${inv.vending_cloud_goods_id}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedDeviceIsRs485 &&
                newSlot.row &&
                newSlot.col &&
                !Number.isNaN(parseInt(String(newSlot.row), 10)) &&
                !Number.isNaN(parseInt(String(newSlot.col), 10)) ? (
                  <p style={{ ...styles.muted, gridColumn: '1 / -1', margin: 0 }}>
                    RS485 lane byte:{' '}
                    <code style={styles.code}>
                      {defaultRs485LaneByte(
                        parseInt(String(newSlot.row), 10),
                        parseInt(String(newSlot.col), 10)
                      )}
                    </code>
                  </p>
                ) : null}
                <label style={styles.fieldLabel}>
                  Now (num)
                  <input
                    style={styles.input}
                    inputMode="numeric"
                    value={newSlot.num}
                    onChange={(e) => setNewSlot((s) => ({ ...s, num: e.target.value }))}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Max
                  <input
                    style={styles.input}
                    inputMode="numeric"
                    value={newSlot.maxNum}
                    onChange={(e) => setNewSlot((s) => ({ ...s, maxNum: e.target.value }))}
                  />
                </label>
                <div style={{ gridColumn: '1 / -1' }}>
                  <button
                    type="submit"
                    style={styles.btnPrimary}
                    disabled={
                      !selectedDeviceId ||
                      savingNewSlot ||
                      (selectedDeviceIsRs485
                        ? !newSlot.catalogInventoryId
                        : !String(newSlot.manualGoodsId).trim() &&
                          !inventoryItems.find((i) => i.id === newSlot.catalogInventoryId)
                            ?.vending_cloud_goods_id)
                    }
                  >
                    <FiPlus style={{ marginRight: 6 }} />
                    {savingNewSlot
                      ? 'Saving…'
                      : selectedDeviceIsRs485
                        ? 'Assign to slot'
                        : 'Program slot (save_stock)'}
                  </button>
                </div>
              </form>
              {!selectedDeviceIsRs485 ? (
                <p style={styles.muted}>
                  At minimum, paste <strong>goods_id</strong> in the first field (vendor often returns only “OK” from
                  sync_goods). Or save goods_id on a catalog row using <strong>Set goods_id manually</strong> above, then
                  pick it here.
                </p>
              ) : null}
            </section>

            <section style={styles.card}>
              <h2 style={styles.h2}>Cabinet bulk actions</h2>
              <p style={styles.help}>
                Optional vendor calls: <code style={styles.code}>up_all_stock</code> /{' '}
                <code style={styles.code}>down_all_stock</code>. Confirm with your machine manual — cabinet index is
                often <code style={styles.code}>1</code>.
              </p>
              <div style={{ ...styles.formRow, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={styles.inlineLabel}>
                  sev_no
                  <input
                    style={{ ...styles.input, width: '80px', marginLeft: 8 }}
                    value={bulkSevNo}
                    onChange={(e) => setBulkSevNo(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  style={styles.btnSecondary}
                  disabled={!selectedDeviceId || bulkWorking}
                  onClick={handleBulkFillAll}
                >
                  Fill all (cabinet)
                </button>
                <button
                  type="button"
                  style={styles.btnDangerSolid}
                  disabled={!selectedDeviceId || bulkWorking}
                  onClick={handleBulkDownAll}
                >
                  Clear all (cabinet)
                </button>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === 'staff_report' && (
          <VendingStaffDispenseReportTab
            businessId={auth.selectedBusinessId}
            devices={devices}
          />
        )}

        {activeTab === 'checklist' && (
          <VendingSlotChecklistTab
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelectDeviceId={setSelectedDeviceId}
            businessId={auth.selectedBusinessId}
          />
        )}

        {activeTab === 'tablet' && (
          <section style={styles.card}>
            <h2 style={styles.h2}>Tablet app (RS485)</h2>
            <p style={styles.help}>
              On the vending machine tablet, open the download page in Chrome, install the APK, then launch{' '}
              <strong>Tavari Vending</strong>. No manufacturer app required for RS485 dispense.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: TavariStyles.spacing.md }}>
              <a
                href={`${typeof window !== 'undefined' ? window.location.origin : ''}/vending/download`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.btnPrimary, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
              >
                Open download page
              </a>
              <button
                type="button"
                style={styles.btnGhost}
                onClick={() =>
                  copyText(`${window.location.origin}/vending/download`)
                }
              >
                <FiCopy style={{ marginRight: 6 }} /> Copy tablet download link
              </button>
              <button
                type="button"
                style={styles.btnGhost}
                onClick={() => copyText(getVendingBridgeApkPublicUrl())}
              >
                <FiCopy style={{ marginRight: 6 }} /> Copy direct APK URL
              </button>
            </div>

            <hr style={{ border: 'none', borderTop: `1px solid ${TavariStyles.colors.gray200}`, margin: `${TavariStyles.spacing.lg} 0` }} />

            <h3 style={{ ...styles.h2, fontSize: TavariStyles.typography.fontSize.lg, marginBottom: TavariStyles.spacing.sm }}>
              Live kiosk preview
            </h3>
            <p style={styles.help}>
              Opens the <strong>same screen the APK shows</strong> in your browser — products, prices, and layout.
              RS485 dispense will not run in Chrome (view only); use the machine tablet for motor tests.
            </p>
            <div style={{ ...styles.formRow, flexWrap: 'wrap', marginBottom: TavariStyles.spacing.md }}>
              <select
                style={{ ...styles.input, minWidth: 220 }}
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
              >
                <option value="">Select device</option>
                {devices
                  .filter((d) => d.kiosk_short_code)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.display_name || d.external_device_id} ({d.kiosk_short_code})
                    </option>
                  ))}
              </select>
              <button
                type="button"
                style={styles.btnPrimary}
                disabled={
                  !devices.find((d) => d.id === selectedDeviceId && d.kiosk_short_code)
                }
                onClick={() => {
                  const device = devices.find((d) => d.id === selectedDeviceId);
                  if (!device?.kiosk_short_code) {
                    toast.error('Select a device with a kiosk code');
                    return;
                  }
                  window.open(getVendingBridgeKioskUrl(device.kiosk_short_code), '_blank', 'noopener,noreferrer');
                }}
              >
                <FiExternalLink style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Open live kiosk in browser
              </button>
              <button
                type="button"
                style={styles.btnGhost}
                disabled={
                  !devices.find((d) => d.id === selectedDeviceId && d.kiosk_short_code)
                }
                onClick={() => {
                  const device = devices.find((d) => d.id === selectedDeviceId);
                  if (device?.kiosk_short_code) {
                    copyText(getVendingBridgeKioskUrl(device.kiosk_short_code));
                  }
                }}
              >
                <FiCopy style={{ marginRight: 6 }} /> Copy kiosk URL
              </button>
            </div>
            {(() => {
              const device = devices.find((d) => d.id === selectedDeviceId && d.kiosk_short_code);
              if (!device) return null;
              const url = getVendingBridgeKioskUrl(device.kiosk_short_code);
              return (
                <p style={styles.muted}>
                  APK loads:{' '}
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </p>
              );
            })()}

            <p style={{ ...styles.help, marginTop: TavariStyles.spacing.lg }}>
              On the tablet, use the download link above — do not use the full Tavari dashboard on the vending tablet.
              The download page is a lightweight install screen that does not require logging in.
            </p>
            <p style={styles.help}>
              Direct APK:{' '}
              <a href={getVendingBridgeApkPublicUrl()} target="_blank" rel="noopener noreferrer">
                {getVendingBridgeApkPublicUrl()}
              </a>
            </p>
          </section>
        )}

        {activeTab === 'settings' && (
          <ModuleSettingsTabContent moduleKey="vending" />
        )}
      </div>
    );
  };

  return (
    <POSAuthWrapper
      requiredRoles={['manager', 'admin', 'owner']}
      requireBusiness
      componentName="VendingDashboard"
    >
      {renderBody()}
    </POSAuthWrapper>
  );
};

const styles = {
  page: {
    padding: TavariStyles.spacing['2xl'],
    maxWidth: '1100px',
    margin: '0 auto'
  },
  inlineLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700
  },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs,
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    color: TavariStyles.colors.gray700
  },
  badgeOk: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.success ?? '#15803d'
  },
  badgeWarn: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.warning ?? '#b45309'
  },
  badgeMuted: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500
  },
  header: {
    display: 'flex',
    gap: TavariStyles.spacing.lg,
    alignItems: 'flex-start',
    marginBottom: TavariStyles.spacing.lg
  },
  title: {
    margin: 0,
    fontSize: TavariStyles.typography.fontSize['3xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray900
  },
  subtitle: {
    margin: `${TavariStyles.spacing.sm} 0 0`,
    fontSize: TavariStyles.typography.fontSize.md,
    color: TavariStyles.colors.gray600,
    lineHeight: TavariStyles.typography.lineHeight.relaxed,
    maxWidth: '52rem'
  },
  h2: {
    margin: `0 0 ${TavariStyles.spacing.md}`,
    fontSize: TavariStyles.typography.fontSize.xl,
    color: TavariStyles.colors.gray800
  },
  card: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    padding: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.xl
  },
  alert: {
    backgroundColor: TavariStyles.colors.warningBg,
    border: `1px solid ${TavariStyles.colors.warning}55`,
    borderRadius: TavariStyles.borderRadius.md,
    padding: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.xl
  },
  kioskFieldLabel: {
    display: 'block',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray700,
    marginBottom: TavariStyles.spacing.xs
  },
  kioskUrlField: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    fontFamily: TavariStyles.typography.fontFamilyMono,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5,
    color: TavariStyles.colors.gray900,
    backgroundColor: TavariStyles.colors.white,
    resize: 'vertical',
    wordBreak: 'break-all'
  },
  kioskUrlInline: {
    width: '100%',
    minWidth: '200px',
    maxWidth: '320px',
    boxSizing: 'border-box',
    padding: '6px 8px',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    fontFamily: TavariStyles.typography.fontFamilyMono,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray900,
    backgroundColor: TavariStyles.colors.gray50
  },
  help: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.md,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
  muted: {
    color: TavariStyles.colors.gray500,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  formRow: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  input: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    fontSize: TavariStyles.typography.fontSize.base,
    minWidth: '160px',
    flex: '1 1 160px'
  },
  code: {
    fontFamily: TavariStyles.typography.fontFamilyMono,
    fontSize: TavariStyles.typography.fontSize.sm,
    backgroundColor: TavariStyles.colors.gray100,
    padding: '2px 6px',
    borderRadius: '4px'
  },
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontWeight: TavariStyles.typography.fontWeight.medium,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  btnSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.gray800,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  btnDangerSolid: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
    backgroundColor: TavariStyles.colors.danger,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  btnGhost: {
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    backgroundColor: 'transparent',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  btnLink: {
    marginRight: TavariStyles.spacing.md,
    padding: 0,
    border: 'none',
    background: 'none',
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm,
    textDecoration: 'underline'
  },
  btnDanger: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
    backgroundColor: 'transparent',
    border: 'none',
    color: TavariStyles.colors.danger,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  rowBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.md
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  th: {
    textAlign: 'left',
    padding: TavariStyles.spacing.sm,
    borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
    color: TavariStyles.colors.gray700
  },
  td: {
    padding: TavariStyles.spacing.sm,
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
    verticalAlign: 'middle'
  }
};

export default VendingDashboard;

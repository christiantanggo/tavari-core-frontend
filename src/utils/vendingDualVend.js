import { defaultRs485LaneByte, getSlotColsForRow } from './vendingSlotChecklist';

/** Partner column absorbed by a wide primary slot (same row). */
export function findDualVendPrimaryForPartner(rowNum, colNum, slots = []) {
  const row = Number(rowNum);
  const col = Number(colNum);
  for (const slot of slots) {
    const primaryCol = Number(slot.col_num ?? slot.col);
    const primaryRow = Number(slot.row_num ?? slot.row);
    const partnerCol = Number(slot.dual_vend_col_num);
    if (primaryRow === row && partnerCol === col && Number.isFinite(partnerCol)) {
      return { row: primaryRow, col: primaryCol, slot };
    }
  }
  return null;
}

export function isDualVendPartnerCell(rowNum, colNum, slots = []) {
  return Boolean(findDualVendPrimaryForPartner(rowNum, colNum, slots));
}

export function canEnableDualVend(rowNum, colNum) {
  const row = Number(rowNum);
  const col = Number(colNum);
  const maxCols = getSlotColsForRow(row);
  return col < maxCols;
}

export function defaultDualPartnerCol(colNum) {
  return Number(colNum) + 1;
}

export function resolveSecondaryLaneByte(rowNum, colNum, override) {
  if (override != null && Number.isFinite(Number(override))) {
    return Number(override);
  }
  return defaultRs485LaneByte(rowNum, colNum);
}

export function resolveRs485LanesFromSlotRecord(slot) {
  if (!slot) return [];
  const row = Number(slot.row_num ?? slot.row ?? 1);
  const col = Number(slot.col_num ?? slot.col ?? 1);
  const primaryLane =
    slot.rs485_lane_byte != null
      ? Number(slot.rs485_lane_byte)
      : slot.rs485LaneByte != null
        ? Number(slot.rs485LaneByte)
        : defaultRs485LaneByte(row, col);

  const lanes = [primaryLane];
  const partnerCol = slot.dual_vend_col_num ?? slot.dualVendColNum;
  if (partnerCol != null && Number.isFinite(Number(partnerCol))) {
    const secondaryLane = resolveSecondaryLaneByte(
      row,
      Number(partnerCol),
      slot.rs485_lane_byte_secondary ?? slot.rs485LaneByteSecondary
    );
    lanes.push(secondaryLane);
  }
  return lanes.filter((l) => Number.isFinite(l) && l >= 0 && l <= 99);
}

export function resolveRs485Lanes(product) {
  if (Array.isArray(product?.rs485LaneBytes) && product.rs485LaneBytes.length) {
    return [...new Set(product.rs485LaneBytes.map(Number))].filter(
      (l) => Number.isFinite(l) && l >= 0 && l <= 99
    );
  }
  const primary =
    product?.rs485LaneByte != null && Number.isFinite(Number(product.rs485LaneByte))
      ? Number(product.rs485LaneByte)
      : null;
  if (primary != null) return [primary];
  const slot = product?.slots?.[0];
  if (slot) {
    return resolveRs485LanesFromSlotRecord({
      row_num: slot.row ?? slot.row_num,
      col_num: slot.col ?? slot.col_num,
      rs485_lane_byte: slot.rs485_lane_byte ?? slot.rs485LaneByte,
      dual_vend_col_num: slot.dual_vend_col_num ?? slot.dualVendColNum,
      rs485_lane_byte_secondary: slot.rs485_lane_byte_secondary ?? slot.rs485LaneByteSecondary
    });
  }
  return [0];
}

/** Hide partner columns from kiosk catalog when merged into a wide primary slot. */
export function filterDualVendPartnerSlotRows(rows = []) {
  const partnerKeys = new Set();
  for (const row of rows) {
    const partnerCol = row.dual_vend_col_num;
    if (partnerCol == null) continue;
    partnerKeys.add(`${row.row_num}-${partnerCol}`);
  }
  return rows.filter((row) => !partnerKeys.has(`${row.row_num}-${row.col_num}`));
}

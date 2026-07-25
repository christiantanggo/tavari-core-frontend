/** M215-style cabinet: rows 1–5 have 10 columns; row 6 has 9. */
export const VENDING_SLOT_ROWS = 6;
export const VENDING_SLOT_COLS = 10;
export const VENDING_DEFAULT_SEV_NO = '1';

/** Physical columns per row (row 6 is 9-wide on this machine). */
export const VENDING_SLOT_COLS_BY_ROW = {
  1: 10,
  2: 10,
  3: 10,
  4: 10,
  5: 10,
  6: 9
};

export function getSlotColsForRow(rowNum) {
  const row = Number(rowNum);
  return VENDING_SLOT_COLS_BY_ROW[row] ?? VENDING_SLOT_COLS;
}

export function getTotalPhysicalSlotCount() {
  let total = 0;
  for (let r = 1; r <= VENDING_SLOT_ROWS; r += 1) {
    total += getSlotColsForRow(r);
  }
  return total;
}

/** Same formula as vending-kiosk-api attachRs485LaneBytes (10 cols per row in lane math). */
export function defaultRs485LaneByte(rowNum, colNum, colsPerRow = VENDING_SLOT_COLS) {
  const row = Number(rowNum);
  const col = Number(colNum);
  if (!Number.isFinite(row) || !Number.isFinite(col) || row < 1 || col < 1) return 0;
  if (col > getSlotColsForRow(row)) return -1;
  return (row - 1) * colsPerRow + (col - 1);
}

export function slotPositionKey(sevNo, rowNum, colNum) {
  return `${String(sevNo ?? VENDING_DEFAULT_SEV_NO)}-${rowNum}-${colNum}`;
}

/** Build full grid merged with DB rows and optional product slots. */
export function buildSlotChecklistGrid({
  rows = VENDING_SLOT_ROWS,
  cols = VENDING_SLOT_COLS,
  sevNo = VENDING_DEFAULT_SEV_NO,
  testRows = [],
  productSlots = []
}) {
  const testByKey = new Map();
  for (const row of testRows) {
    testByKey.set(slotPositionKey(row.sev_no, row.row_num, row.col_num), row);
  }

  const productByKey = new Map();
  for (const row of productSlots) {
    productByKey.set(slotPositionKey(row.sev_no ?? row.sevNo, row.row_num ?? row.row, row.col_num ?? row.col), row);
  }

  const grid = [];
  for (let r = 1; r <= rows; r += 1) {
    const colsThisRow = getSlotColsForRow(r);
    const rowCells = [];
    for (let c = 1; c <= colsThisRow; c += 1) {
      const key = slotPositionKey(sevNo, r, c);
      const test = testByKey.get(key);
      const product = productByKey.get(key);
      const laneFromDb = test?.rs485_lane_byte ?? product?.rs485_lane_byte;
      const laneByte =
        laneFromDb != null ? Number(laneFromDb) : defaultRs485LaneByte(r, c, cols);

      rowCells.push({
        key,
        sevNo,
        row: r,
        col: c,
        laneByte,
        testStatus: test?.test_status || 'untested',
        testedAt: test?.tested_at || null,
        notes: test?.notes || '',
        testId: test?.id || null,
        goodsId: product?.manufacturer_goods_id || product?.goodsId || '',
        goodsName: product?.goods_name || product?.goodsName || '',
        posInventoryId: product?.pos_inventory_id || product?.posInventoryId || null,
        num: product?.num ?? null,
        maxNum: product?.max_num ?? product?.maxNum ?? null,
        dualVendColNum: product?.dual_vend_col_num ?? product?.dualVendColNum ?? null,
        rs485LaneByteSecondary:
          product?.rs485_lane_byte_secondary ?? product?.rs485LaneByteSecondary ?? null
      });
    }
    grid.push(rowCells);
  }
  return grid;
}

export function summarizeChecklist(flatCells) {
  const total = flatCells.length;
  const passed = flatCells.filter((c) => c.testStatus === 'pass').length;
  const failed = flatCells.filter((c) => c.testStatus === 'fail').length;
  const untested = total - passed - failed;
  return { total, passed, failed, untested, ready: failed === 0 && untested === 0 && total > 0 };
}

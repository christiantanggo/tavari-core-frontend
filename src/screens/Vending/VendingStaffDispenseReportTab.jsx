import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiPrinter, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import VendingStaffDispensePrintModal from '../../components/Vending/VendingStaffDispensePrintModal';
import {
  buildVendingStaffDispensePrintHtml,
  buildVendingStaffDispenseReportAggregates,
  printVendingStaffDispenseReport
} from '../../helpers/Vending/vendingStaffDispensePrint';

function defaultDateFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultDateTo() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return String(value);
  }
}

export default function VendingStaffDispenseReportTab({ businessId, businessName, devices = [] }) {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [deviceId, setDeviceId] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const loadReport = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('vending_staff_dispenses')
        .select(`
          id,
          staff_user_id,
          staff_name,
          manufacturer_goods_id,
          goods_name,
          quantity,
          unit_price,
          order_no,
          dispensed_at,
          vending_device_id,
          vending_devices ( display_name, external_device_id )
        `)
        .eq('business_id', businessId)
        .gte('dispensed_at', `${dateFrom}T00:00:00.000Z`)
        .lte('dispensed_at', `${dateTo}T23:59:59.999Z`)
        .order('dispensed_at', { ascending: false })
        .limit(5000);

      if (deviceId) query = query.eq('vending_device_id', deviceId);
      if (staffFilter) query = query.eq('staff_user_id', staffFilter);
      if (productFilter.trim()) {
        query = query.ilike('goods_name', `%${productFilter.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      setRows(
        (data || []).map((row) => ({
          ...row,
          device_name:
            row.vending_devices?.display_name ||
            row.vending_devices?.external_device_id ||
            row.vending_device_id
        }))
      );
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Failed to load staff dispense report');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, dateFrom, dateTo, deviceId, staffFilter, productFilter]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const aggregates = useMemo(() => buildVendingStaffDispenseReportAggregates(rows), [rows]);

  const staffOptions = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (!row.staff_user_id) continue;
      map.set(row.staff_user_id, row.staff_name || 'Staff');
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filterLabels = useMemo(
    () => ({
      dateFrom,
      dateTo,
      deviceLabel: deviceId
        ? devices.find((d) => d.id === deviceId)?.display_name ||
          devices.find((d) => d.id === deviceId)?.external_device_id ||
          deviceId
        : 'All devices',
      staffLabel: staffFilter
        ? staffOptions.find(([id]) => id === staffFilter)?.[1] || staffFilter
        : 'All staff',
      productLabel: productFilter.trim() || 'All products'
    }),
    [dateFrom, dateTo, deviceId, staffFilter, productFilter, devices, staffOptions]
  );

  const handlePrint = async (sections) => {
    const html = buildVendingStaffDispensePrintHtml({
      businessName,
      filters: filterLabels,
      rows,
      sections
    });
    printVendingStaffDispenseReport(html);
  };

  const card = {
    background: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 12,
    padding: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.lg
  };

  const input = {
    ...TavariStyles.components.form.input,
    minWidth: 160
  };

  return (
    <div>
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Staff dispense report</h2>
            <p style={{ margin: '8px 0 0', color: TavariStyles.colors.gray600 }}>
              Track who took what from staff-PIN kiosks. Filter by date, device, staff, or product, then print
              selected sections.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={styles.btnGhost} onClick={loadReport} disabled={loading}>
              <FiRefreshCw size={16} style={{ marginRight: 6 }} />
              Refresh
            </button>
            <button
              type="button"
              style={styles.btnPrimary}
              onClick={() => setPrintOpen(true)}
              disabled={loading || rows.length === 0}
            >
              <FiPrinter size={16} style={{ marginRight: 6 }} />
              Print
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginTop: TavariStyles.spacing.lg
          }}
        >
          <label style={styles.label}>
            From
            <input type="date" style={input} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label style={styles.label}>
            To
            <input type="date" style={input} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <label style={styles.label}>
            Device
            <select style={input} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">All devices</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.display_name || d.external_device_id}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Staff
            <select style={input} value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
              <option value="">All staff</option>
              {staffOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Product search
            <input
              type="text"
              style={input}
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              placeholder="Product name"
            />
          </label>
        </div>
      </section>

      <section style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <SummaryCard label="Total units" value={aggregates.totalUnits} />
        <SummaryCard label="Lines" value={aggregates.totalLines} />
        <SummaryCard label="Staff" value={aggregates.uniqueStaff} />
        <SummaryCard label="Products" value={aggregates.uniqueProducts} />
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0 }}>By staff</h3>
        <ReportTable
          headers={['Staff', 'Units', 'Lines']}
          rows={aggregates.byStaff.map((row) => [row.staff, row.units, row.lines])}
          emptyLabel="No staff dispenses in this range."
        />
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0 }}>By product</h3>
        <ReportTable
          headers={['Product', 'Units', 'Lines']}
          rows={aggregates.byProduct.map((row) => [row.product, row.units, row.lines])}
          emptyLabel="No products in this range."
        />
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0 }}>Detail lines</h3>
        <ReportTable
          headers={['When', 'Staff', 'Product', 'Qty', 'Device', 'Order #']}
          rows={rows.map((row) => [
            formatDateTime(row.dispensed_at),
            row.staff_name || '—',
            row.goods_name || row.manufacturer_goods_id || '—',
            row.quantity || 1,
            row.device_name || '—',
            row.order_no || '—'
          ])}
          emptyLabel="No dispense lines match these filters."
        />
      </section>

      <VendingStaffDispensePrintModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        businessId={businessId}
        loading={loading}
        onPrint={handlePrint}
      />
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div
      style={{
        border: `1px solid ${TavariStyles.colors.gray200}`,
        borderRadius: 8,
        padding: 12,
        background: TavariStyles.colors.gray50
      }}
    >
      <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function ReportTable({ headers, rows, emptyLabel }) {
  if (!rows.length) {
    return <p style={{ color: TavariStyles.colors.gray600, margin: 0 }}>{emptyLabel}</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} style={styles.th}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} style={styles.td}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  label: {
    display: 'grid',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray700
  },
  btnPrimary: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    display: 'inline-flex',
    alignItems: 'center'
  },
  btnGhost: {
    ...TavariStyles.components.button.base,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: TavariStyles.colors.white,
    display: 'inline-flex',
    alignItems: 'center'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
    fontSize: 13,
    whiteSpace: 'nowrap'
  },
  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
    fontSize: 13,
    verticalAlign: 'top'
  }
};

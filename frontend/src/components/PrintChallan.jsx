import React, { useEffect, useState } from 'react';
import logo from '../assets/images/dhown-logo.png';

const API = 'http://localhost:4000';
const token = () => localStorage.getItem('dhown_token');

/* ── Helpers ─────────────────────────────────────── */
const fmt   = (v) => (v != null && v !== '') ? String(v) : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtKg = (v) => v != null ? parseFloat(v).toFixed(3) : '0.000';

function amtInWords(num) {
  if (!num || isNaN(num)) return 'Zero Only';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function words(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
    if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + words(n%100) : '');
    if (n < 100000) return words(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + words(n%1000) : '');
    if (n < 10000000) return words(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + words(n%100000) : '');
    return words(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + words(n%10000000) : '');
  }
  const rupees = Math.floor(num);
  const paise  = Math.round((num - rupees) * 100);
  let result = words(rupees) + ' Rupees';
  if (paise) result += ' and ' + words(paise) + ' Paise';
  return result + ' Only';
}

function docTitle(type, data) {
  if (type === 'SC_CHALLAN')  return `Subcontract Challan — ${data?.challan_number || ''}`;
  if (type === 'SC_RECEIPT')  return `Subcontract Receipt — ${data?.challan_number || ''}-R`;
  if (type === 'DISPATCH')    return `Delivery Challan — ${data?.dispatch_number || ''}`;
  if (type === 'GRN')         return `Goods Receipt Note — ${data?.grn_number || ''}`;
  if (type === 'YARN_ISSUE')  return `Yarn Issue Slip — ${data?.issue_number || ''}`;
  if (type === 'DYEING')      return `Dyeing Challan — ${data?.challan_number || ''}`;
  if (type === 'PACKING_LIST') return `Packing List — ${data?.challan_number || ''}`;
  return 'Document';
}

/* ── CSS injected into print window ─────────────── */
const PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 16px 20px; }

  /* Outer border like Busy */
  .page { border: 1px solid #222; padding: 0; }

  /* Company header strip */
  .co-header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #222; padding: 10px 14px; }
  .co-logo { height: 52px; width: auto; }
  .co-info { flex: 1; }
  .co-name { font-size: 17px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
  .co-addr { font-size: 10px; color: #444; margin-top: 2px; line-height: 1.4; }
  .co-gstin { font-size: 10px; font-weight: 700; color: #111; margin-top: 3px; }
  .doc-title-box { text-align: right; min-width: 200px; }
  .doc-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #555; border: 1px solid #888; display: inline-block; padding: 2px 10px; margin-bottom: 4px; }
  .doc-num { font-size: 18px; font-weight: 800; color: #1a3a8f; font-family: monospace; }
  .doc-date { font-size: 11px; color: #444; margin-top: 3px; }

  /* Meta row — two boxes side by side */
  .meta-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #bbb; }
  .meta-box { padding: 8px 12px; }
  .meta-box + .meta-box { border-left: 1px solid #bbb; }
  .meta-label { font-size: 9px; text-transform: uppercase; color: #777; font-weight: 700; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
  .meta-val { font-size: 12px; font-weight: 600; }
  .meta-val-sm { font-size: 11px; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a3a8f; color: #fff; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; border: 1px solid #1a3a8f; }
  th.center, td.center { text-align: center; }
  th.right, td.right { text-align: right; }
  td { padding: 5px 8px; border: 1px solid #ccc; font-size: 11px; vertical-align: middle; }
  tr.alt td { background: #f4f6ff; }
  tr.total-row td { background: #e8eeff; font-weight: 700; font-size: 12px; border-top: 2px solid #222; }
  tr.subtotal td { background: #f0f0f0; font-weight: 600; font-size: 11px; }
  tr.lot-header td { background: #dce8ff; font-weight: 700; font-size: 11px; }

  /* Summary boxes */
  .summary-row { display: flex; border-top: 1px solid #bbb; border-bottom: 1px solid #bbb; }
  .summary-box { flex: 1; padding: 7px 12px; border-right: 1px solid #bbb; }
  .summary-box:last-child { border-right: none; }
  .summary-box label { display: block; font-size: 9px; text-transform: uppercase; color: #777; font-weight: 700; margin-bottom: 2px; }
  .summary-box span { font-size: 13px; font-weight: 800; color: #1a3a8f; }

  /* Amount in words */
  .amt-words { padding: 7px 14px; background: #fffbeb; border-bottom: 1px solid #bbb; font-size: 11px; }
  .amt-words strong { text-transform: uppercase; font-size: 9px; color: #777; display: block; margin-bottom: 2px; }

  /* Notes */
  .notes { padding: 7px 14px; border-bottom: 1px solid #bbb; font-size: 11px; }
  .notes strong { text-transform: uppercase; font-size: 9px; color: #777; display: block; margin-bottom: 2px; }

  /* Signature strip */
  .sig-strip { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid #bbb; }
  .sig-box { padding: 10px 14px; min-height: 72px; display: flex; flex-direction: column; justify-content: flex-end; }
  .sig-box + .sig-box { border-left: 1px solid #bbb; }
  .sig-line { border-top: 1px solid #333; padding-top: 4px; font-size: 10px; color: #555; text-align: center; margin-top: 44px; }

  /* Footer */
  .page-footer { padding: 5px 14px; background: #f0f0f0; border-top: 1px solid #bbb; font-size: 9px; color: #888; text-align: center; }

  /* Lot section header in dyeing challan */
  .lot-section { margin-top: 0; }
  .lot-title { background: #1a3a8f; color: #fff; padding: 5px 10px; font-size: 11px; font-weight: 700; display: flex; justify-content: space-between; }

  @media print {
    body { padding: 4px; }
    @page { size: A4 portrait; margin: 8mm; }
    .no-print { display: none !important; }
  }
`;

/* ── Company header component (uses settings) ───── */
function BusyHeader({ co, docType, docNumber, docDate }) {
  return (
    <div className="co-header">
      <img className="co-logo" src={co.logo} alt="Logo" onError={e => { e.target.style.display='none'; }} />
      <div className="co-info">
        <div className="co-name">{co.company_name || 'DHOWN TEXTILES'}</div>
        <div className="co-addr">{co.factory_address || ''}{co.phone_number ? ` | Ph: ${co.phone_number}` : ''}{co.email ? ` | ${co.email}` : ''}</div>
        {co.gst_number && <div className="co-gstin">GSTIN: {co.gst_number}</div>}
      </div>
      <div className="doc-title-box">
        <div className="doc-type">{docType}</div>
        <div className="doc-num">{docNumber}</div>
        <div className="doc-date">Date: {docDate}</div>
      </div>
    </div>
  );
}

/* ── Signature footer ──────────────────────────── */
function SigStrip({ labels }) {
  return (
    <div className="sig-strip">
      {labels.map(l => (
        <div key={l} className="sig-box">
          <div className="sig-line">{l}</div>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════
   GRN — Goods Receipt Note
   Columns: #, Supplier Lot No., Yarn Type / Item, Colour, Boxes/Bags, Net (kg), Rate/kg, Value
════════════════════════════════════════════════ */
function GRNDoc({ data, co }) {
  if (!data) return null;
  const lots = data.lots || [];
  const totalNet  = lots.reduce((a, l) => a + parseFloat(l.net_weight_kg || 0), 0);
  const totalVal  = lots.reduce((a, l) => a + parseFloat(l.net_weight_kg || 0) * parseFloat(l.rate_per_kg || 0), 0);
  const totalPkgs = lots.reduce((a, l) => a + parseInt(l.cones || l.boxes || l.bags || 0), 0);

  const rows = lots.map((lot, i) => {
    const val  = parseFloat(lot.net_weight_kg || 0) * parseFloat(lot.rate_per_kg || 0);
    const pkgs = lot.cones || lot.boxes || lot.bags || '—';
    return `
      <tr class="${i%2===1?'alt':''}">
        <td class="center">${i+1}</td>
        <td>${fmt(lot.item_name || lot.yarn_type)}</td>
        <td><strong>${fmt(lot.supplier_lot_no) !== '—' ? fmt(lot.supplier_lot_no) : fmt(lot.lot_number)}</strong></td>
        <td>${fmt(lot.brand)}</td>
        <td>${fmt(lot.color)}</td>
        <td>${fmt(lot.count)}</td>
        <td>${fmt(lot.location)}</td>
        <td class="center">${pkgs}</td>
        <td class="right"><strong>${fmtKg(lot.net_weight_kg)}</strong></td>
        <td class="right">${lot.rate_per_kg ? '₹'+parseFloat(lot.rate_per_kg).toFixed(2) : '—'}</td>
        <td class="right">${lot.rate_per_kg ? '₹'+val.toFixed(2) : '—'}</td>
      </tr>`;
  }).join('');

  const html = `
    <div class="page">
      ${busyHeaderHTML(co, 'Goods Receipt Note', data.grn_number, fmtDate(data.receipt_date))}
      <div class="meta-row">
        <div class="meta-box">
          <span class="meta-label">Supplier</span>
          <div class="meta-val">${fmt(data.supplier_name)}</div>
          ${data.supplier_invoice ? `<div class="meta-val-sm">Invoice No.: <strong>${data.supplier_invoice}</strong></div>` : ''}
          ${data.lr_number ? `<div class="meta-val-sm">LR / Bilty: ${data.lr_number}</div>` : ''}
        </div>
        <div class="meta-box">
          <span class="meta-label">Receipt Details</span>
          <div class="meta-val-sm">Vehicle No.: <strong>${fmt(data.vehicle_number)}</strong></div>
          <div class="meta-val-sm">Received By: ${fmt(data.received_by)}</div>
          <div class="meta-val-sm">Status: <strong>${fmt(data.status)}</strong></div>
          ${data.notes ? `<div class="meta-val-sm">Remarks: ${data.notes}</div>` : ''}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:28px">#</th>
            <th>Yarn Type / Item</th>
            <th>Lot No.</th>
            <th>Brand</th>
            <th>Colour</th>
            <th>Count</th>
            <th>Location</th>
            <th class="center">Boxes / Bags</th>
            <th class="right">Net (kg)</th>
            <th class="right">Rate/kg (₹)</th>
            <th class="right">Value (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="7" class="center">TOTAL — ${lots.length} Lot(s)</td>
            <td class="center">${totalPkgs || '—'}</td>
            <td class="right">${totalNet.toFixed(3)}</td>
            <td></td>
            <td class="right">₹${totalVal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <div class="summary-row">
        <div class="summary-box"><label>Total Lots</label><span>${lots.length}</span></div>
        <div class="summary-box"><label>Total Boxes/Bags</label><span>${totalPkgs || '—'}</span></div>
        <div class="summary-box"><label>Net Weight</label><span>${totalNet.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Total Value</label><span>₹${totalVal.toFixed(2)}</span></div>
      </div>
      ${totalVal > 0 ? `<div class="amt-words"><strong>Amount in Words</strong>${amtInWords(totalVal)}</div>` : ''}
      <div class="sig-strip">
        ${sigBoxHTML('Store Incharge')}${sigBoxHTML('Quality Checked By')}${sigBoxHTML('Approved By')}
      </div>
      <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
    </div>`;
  return html;
}

/* ════════════════════════════════════════════════
   YARN ISSUE SLIP
   Columns: #, Lot No, Supplier Lot, Yarn Type, Count, Colour, HSN, Location, Issued(kg), Returned(kg), Net Consumed(kg)
════════════════════════════════════════════════ */
function YarnIssueDoc({ data, co }) {
  if (!data) return null;
  const items = data.items || [];
  const totalIssued   = items.reduce((a, i) => a + parseFloat(i.issued_kg   || 0), 0);
  const totalReturned = items.reduce((a, i) => a + parseFloat(i.returned_kg || 0), 0);
  const totalConsumed = totalIssued - totalReturned;

  const rows = items.map((item, i) => {
    const consumed = parseFloat(item.issued_kg || 0) - parseFloat(item.returned_kg || 0);
    return `
      <tr class="${i%2===1?'alt':''}">
        <td class="center">${i+1}</td>
        <td>${fmt(item.item_name || item.yarn_type)}</td>
        <td><strong>${fmt(item.supplier_lot_no) !== '—' ? fmt(item.supplier_lot_no) : fmt(item.lot_number)}</strong></td>
        <td>${fmt(item.brand)}</td>
        <td>${fmt(item.color)}</td>
        <td class="center">${item.cones || item.boxes || item.bags || '—'}</td>
        <td class="right"><strong>${fmtKg(item.issued_kg)}</strong></td>
        <td class="right">${parseFloat(item.returned_kg||0) > 0 ? fmtKg(item.returned_kg) : '—'}</td>
        <td class="right"><strong>${consumed.toFixed(3)}</strong></td>
      </tr>`;
  }).join('');

  const html = `
    <div class="page">
      ${busyHeaderHTML(co, 'Yarn Issue Slip', data.issue_number, fmtDate(data.issue_date || data.created_at))}
      <div class="meta-row">
        <div class="meta-box">
          <span class="meta-label">Issued To — Machine / Work Center</span>
          <div class="meta-val">${fmt(data.machine_name || data.machine_id)}</div>
          <div class="meta-val-sm">Machine ID: ${fmt(data.machine_id)} &nbsp;|&nbsp; Issue No.: ${fmt(data.issue_number)}</div>
        </div>
        <div class="meta-box">
          <span class="meta-label">Issue Details</span>
          <div class="meta-val-sm">Issued By: <strong>${fmt(data.issued_by)}</strong></div>
          <div class="meta-val-sm">Received By: <strong>${fmt(data.received_by)}</strong></div>
          <div class="meta-val-sm">Status: <strong>${fmt(data.status)}</strong></div>
          ${data.notes ? `<div class="meta-val-sm">Notes: ${data.notes}</div>` : ''}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:28px">#</th>
            <th>Yarn Type / Item</th>
            <th>Supplier Lot No.</th>
            <th>Brand</th>
            <th>Colour</th>
            <th class="center">Boxes / Bags</th>
            <th class="right">Issued (kg)</th>
            <th class="right">Returned (kg)</th>
            <th class="right">Net Consumed (kg)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="6" class="center">TOTAL — ${items.length} Lot(s)</td>
            <td class="right">${totalIssued.toFixed(3)}</td>
            <td class="right">${totalReturned > 0 ? totalReturned.toFixed(3) : '—'}</td>
            <td class="right">${totalConsumed.toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
      <div class="summary-row">
        <div class="summary-box"><label>Total Lots</label><span>${items.length}</span></div>
        <div class="summary-box"><label>Total Issued</label><span>${totalIssued.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Total Returned</label><span>${totalReturned.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Net Consumed</label><span>${totalConsumed.toFixed(3)} kg</span></div>
      </div>
      <div class="sig-strip">
        ${sigBoxHTML('Store Incharge (Issued By)')}${sigBoxHTML('Machine Operator (Received By)')}${sigBoxHTML('Supervisor')}
      </div>
      <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
    </div>`;
  return html;
}

/* ════════════════════════════════════════════════
   SUBCONTRACT CHALLAN (Send Out)
   Columns: #, Roll No, Fabric Type, HSN, Machine, Shift, Colour, Weight(kg)
════════════════════════════════════════════════ */
function SCChallanDoc({ data, co }) {
  if (!data) return null;
  const isYarn = data.challan_type === 'YARN_BASED';

  /* ── YARN-BASED (Knitting / Job Work) ── */
  if (isYarn) {
    const yarnItems = data.yarn_items || [];
    const totalKg   = yarnItems.reduce((a, y) => a + parseFloat(y.sent_kg || 0), 0);
    const jobCost   = data.rate_per_kg ? totalKg * parseFloat(data.rate_per_kg) : 0;
    const jobLabel  = data.is_job_work ? 'Job Work' : 'Knitting';

    const rows = yarnItems.map((y, i) => `
      <tr class="${i%2===1?'alt':''}">
        <td class="center">${i+1}</td>
        <td><strong>${fmt(y.lot_number)}</strong></td>
        <td>${fmt(y.item_name || y.yarn_type)}</td>
        <td>${fmt(y.color)}</td>
        <td>${fmt(y.count || '')}</td>
        <td>${fmt(y.brand || '')}</td>
        <td class="right"><strong>${fmtKg(y.sent_kg)}</strong></td>
      </tr>`).join('');

    return `
      <div class="page">
        ${busyHeaderHTML(co, `${jobLabel} Outward Challan`, data.challan_number, fmtDate(data.sent_date))}
        <div class="meta-row">
          <div class="meta-box">
            <span class="meta-label">Vendor / ${jobLabel} Party</span>
            <div class="meta-val">${fmt(data.vendor_name)}</div>
            ${data.vendor_contact ? `<div class="meta-val-sm">Contact: ${data.vendor_contact}</div>` : ''}
            <div class="meta-val-sm">Job Type: <strong>${fmt(data.job_type)}</strong></div>
            ${data.is_job_work ? `<div class="meta-val-sm">Customer: <strong>${fmt(data.customer_name)}</strong></div>` : ''}
          </div>
          <div class="meta-box">
            <span class="meta-label">Challan Details</span>
            <div class="meta-val-sm">Challan No: <strong>${fmt(data.challan_number)}</strong></div>
            <div class="meta-val-sm">Sent Date: <strong>${fmtDate(data.sent_date)}</strong></div>
            <div class="meta-val-sm">Expected Return: <strong>${fmtDate(data.expected_return_date)}</strong></div>
            ${data.rate_per_kg ? `<div class="meta-val-sm">Rate: ₹${parseFloat(data.rate_per_kg).toFixed(2)}/kg</div>` : ''}
          </div>
        </div>

        <div style="padding:6px 12px;background:#eef2ff;border-bottom:1px solid #bbb;font-size:11px;font-weight:700;text-transform:uppercase;color:#1a3a8f;">
          Yarn Sent for ${jobLabel}
        </div>
        <table>
          <thead>
            <tr>
              <th class="center" style="width:28px">#</th>
              <th>Lot No.</th>
              <th>Yarn Type</th>
              <th>Colour</th>
              <th>Count</th>
              <th>Brand</th>
              <th class="right">Weight (kg)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="total-row">
              <td colspan="6" class="center">TOTAL — ${yarnItems.length} Lot(s)</td>
              <td class="right">${totalKg.toFixed(3)} kg</td>
            </tr>
          </tbody>
        </table>
        <div class="summary-row">
          <div class="summary-box"><label>Total Lots</label><span>${yarnItems.length}</span></div>
          <div class="summary-box"><label>Total Weight</label><span>${totalKg.toFixed(3)} kg</span></div>
          ${data.rate_per_kg ? `<div class="summary-box"><label>Rate / kg</label><span>₹${parseFloat(data.rate_per_kg).toFixed(2)}</span></div>` : ''}
          ${jobCost ? `<div class="summary-box"><label>Est. Job Cost</label><span>₹${jobCost.toFixed(2)}</span></div>` : ''}
        </div>
        ${jobCost ? `<div class="amt-words"><strong>Amount in Words (Estimated Job Cost)</strong>${amtInWords(jobCost)}</div>` : ''}
        ${data.notes ? `<div class="notes"><strong>Special Instructions / Notes</strong>${data.notes}</div>` : ''}
        <div class="notes" style="font-size:10px;color:#666;font-style:italic;">
          Yarn sent for ${jobLabel.toLowerCase()} on job work basis. No sale involved. Greige fabric to be returned after processing.
        </div>
        <div class="sig-strip">
          ${sigBoxHTML('Store Incharge')}${sigBoxHTML('Transporter / Driver')}${sigBoxHTML('Received By (Vendor)')}
        </div>
        <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
      </div>`;
  }

  /* ── ROLL-BASED (Dyeing / Finishing) — consolidated: one line per fabric ── */
  const rolls = data.rolls || [];
  const totalKg  = rolls.reduce((a, r) => a + parseFloat(r.actual_weight_kg || 0), 0);
  const jobCost  = data.rate_per_kg ? totalKg * parseFloat(data.rate_per_kg) : 0;

  // Prefer challan fabric lines; fall back to grouping rolls by fabric
  let lines;
  if (Array.isArray(data.fabric_items) && data.fabric_items.length) {
    lines = data.fabric_items.map(it => ({
      fabric: it.fabric_type,
      lot: it.batch_number || data.batch_number,
      color: it.color || data.color_name,
      rolls: parseInt(it.roll_count) || 0,
      kg: parseFloat(it.weight_kg) || 0,
      hsn: (rolls.find(r => r.fabric_type === it.fabric_type) || {}).hsn_code || '—',
    }));
  } else {
    const g = {};
    rolls.forEach(r => {
      const f = r.fabric_type || data.fabric_type || 'Unknown';
      if (!g[f]) g[f] = { fabric: f, lot: data.batch_number, color: data.color_name, rolls: 0, kg: 0, hsn: r.hsn_code || '—' };
      g[f].rolls += 1;
      g[f].kg += parseFloat(r.actual_weight_kg || 0);
    });
    lines = Object.values(g);
  }
  const totalRollCount = lines.reduce((a, l) => a + l.rolls, 0);

  const rows = lines.map((l, i) => `
    <tr class="${i%2===1?'alt':''}">
      <td class="center">${i+1}</td>
      <td><strong>${fmt(l.fabric)}</strong></td>
      <td>${fmt(l.lot)}</td>
      <td>${fmt(l.color)}</td>
      <td class="center">${l.hsn}</td>
      <td class="center">${l.rolls}</td>
      <td class="right"><strong>${l.kg.toFixed(3)}</strong></td>
    </tr>`).join('');

  const html = `
    <div class="page">
      ${busyHeaderHTML(co, 'Subcontract Challan', data.challan_number, fmtDate(data.sent_date))}
      <div class="meta-row">
        <div class="meta-box">
          <span class="meta-label">Vendor / Job Worker</span>
          <div class="meta-val">${fmt(data.vendor_name)}</div>
          ${data.vendor_contact ? `<div class="meta-val-sm">Contact: ${data.vendor_contact}</div>` : ''}
          <div class="meta-val-sm">Job Type: <strong>${fmt(data.job_type)}</strong></div>
        </div>
        <div class="meta-box">
          <span class="meta-label">Batch Details</span>
          <div class="meta-val">Batch: <strong>${fmt(data.batch_number)}</strong></div>
          <div class="meta-val-sm">Fabric: ${fmt(data.fabric_type)} &nbsp;|&nbsp; Colour: ${fmt(data.color_name)}</div>
          <div class="meta-val-sm">Expected Return: <strong>${fmtDate(data.expected_return_date)}</strong></div>
          ${data.rate_per_kg ? `<div class="meta-val-sm">Rate: ₹${parseFloat(data.rate_per_kg).toFixed(2)}/kg</div>` : ''}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:28px">#</th>
            <th>Fabric / Item</th>
            <th>Lot No.</th>
            <th>Colour / Shade</th>
            <th class="center">HSN</th>
            <th class="center">No. of Rolls</th>
            <th class="right">Total Weight (kg)</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="5" class="center">TOTAL — ${lines.length} Item(s)</td>
            <td class="center">${totalRollCount}</td>
            <td class="right">${totalKg.toFixed(3)} kg</td>
          </tr>
        </tbody>
      </table>
      <div class="summary-row">
        <div class="summary-box"><label>Total Rolls</label><span>${totalRollCount}</span></div>
        <div class="summary-box"><label>Total Weight</label><span>${totalKg.toFixed(3)} kg</span></div>
        ${data.rate_per_kg ? `<div class="summary-box"><label>Rate / kg</label><span>₹${parseFloat(data.rate_per_kg).toFixed(2)}</span></div>` : ''}
        ${jobCost ? `<div class="summary-box"><label>Est. Job Cost</label><span>₹${jobCost.toFixed(2)}</span></div>` : ''}
      </div>
      ${jobCost ? `<div class="amt-words"><strong>Amount in Words (Estimated Job Cost)</strong>${amtInWords(jobCost)}</div>` : ''}
      ${data.notes ? `<div class="notes"><strong>Special Instructions / Notes</strong>${data.notes}</div>` : ''}
      <div class="notes" style="font-size:10px;color:#666;font-style:italic;">
        Goods sent for job work only. No sale involved. To be returned after processing.
      </div>
      <div class="sig-strip">
        ${sigBoxHTML('Dispatch Incharge')}${sigBoxHTML('Transporter / Driver')}${sigBoxHTML('Received By (Vendor)')}
      </div>
      <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
    </div>`;
  return html;
}

/* ════════════════════════════════════════════════
   SUBCONTRACT RECEIPT — ROLL-BASED (Dyeing / Finishing)
   Columns: #, Roll No, Fabric Type, HSN, Machine, Shift, Sent Wt
════════════════════════════════════════════════ */
function SCReceiptDoc({ data, co }) {
  if (!data) return null;

  const allReceipts = data.receipts || [];
  const isKnitting = data.challan_type === 'YARN_BASED';

  /* ── KNITTING / JOB-WORK receipt ── */
  if (isKnitting) {
    const yarnItems  = data.yarn_items || [];
    const sentKg     = yarnItems.reduce((a, y) => a + parseFloat(y.sent_kg || 0), 0);
    const totalRecvKg   = allReceipts.reduce((a, r) => a + parseFloat(r.received_weight_kg || 0), 0);
    const totalRolls    = allReceipts.reduce((a, r) => a + parseInt(r.rolls_received_count || 0), 0);
    const totalBalYarn  = allReceipts.reduce((a, r) => a + parseFloat(r.balance_yarn_kg || 0), 0);
    const totalRejKg    = allReceipts.reduce((a, r) => a + parseFloat(r.rejected_weight_kg || 0), 0);
    const consumed      = sentKg - totalBalYarn;

    const yarnRows = yarnItems.map((y, i) => `
      <tr class="${i%2===1?'alt':''}">
        <td class="center">${i+1}</td>
        <td><strong>${fmt(y.lot_number)}</strong></td>
        <td>${fmt(y.item_name || y.yarn_type)}</td>
        <td>${fmt(y.color)}</td>
        <td class="right"><strong>${fmtKg(y.sent_kg)}</strong></td>
      </tr>`).join('');

    const receiptRows = allReceipts.map((r, i) => `
      <tr class="${i%2===1?'alt':''}">
        <td class="center">${i+1}</td>
        <td>${fmtDate(r.received_date)}</td>
        <td class="right"><strong>${fmtKg(r.received_weight_kg)}</strong></td>
        <td class="center">${r.rolls_received_count || '—'}</td>
        <td class="right">${fmtKg(r.balance_yarn_kg || 0)}</td>
        <td class="center">${fmt(r.quality_status)}</td>
        <td>${r.notes || '—'}</td>
      </tr>`).join('');

    const docLabel = data.is_job_work ? 'Job Work Receipt Note' : 'Knitting Receipt Note';
    const jobLabel = data.is_job_work ? `Job Work for: <strong>${fmt(data.customer_name)}</strong>` : '';
    const latestReceipt = allReceipts[0] || {};

    const html = `
      <div class="page">
        ${busyHeaderHTML(co, docLabel, data.challan_number + '-R', fmtDate(latestReceipt.received_date || new Date()))}
        <div class="meta-row">
          <div class="meta-box">
            <span class="meta-label">Vendor / Knitter</span>
            <div class="meta-val">${fmt(data.vendor_name)}</div>
            ${data.vendor_contact ? `<div class="meta-val-sm">Contact: ${data.vendor_contact}</div>` : ''}
            <div class="meta-val-sm">Ref. Challan: <strong>${fmt(data.challan_number)}</strong> &nbsp;|&nbsp; Job: ${fmt(data.job_type)}</div>
            ${data.is_job_work ? `<div class="meta-val-sm">${jobLabel}</div>` : ''}
          </div>
          <div class="meta-box">
            <span class="meta-label">Receipt Summary</span>
            <div class="meta-val-sm">Total Receipts: <strong>${allReceipts.length}</strong></div>
            <div class="meta-val-sm">Greige Rolls Received: <strong>${totalRolls} roll(s) &nbsp;|&nbsp; ${totalRecvKg.toFixed(3)} kg</strong></div>
            <div class="meta-val-sm">Balance Yarn Returned: <strong>${totalBalYarn.toFixed(3)} kg</strong></div>
            <div class="meta-val-sm">Status: <strong>${fmt(data.status)}</strong></div>
          </div>
        </div>

        <div style="padding:6px 12px;background:#eef2ff;border-bottom:1px solid #bbb;font-size:11px;font-weight:700;text-transform:uppercase;color:#1a3a8f;">
          Yarn Sent for Knitting
        </div>
        <table>
          <thead>
            <tr>
              <th class="center" style="width:28px">#</th>
              <th>Lot No.</th>
              <th>Yarn Type</th>
              <th>Colour</th>
              <th class="right">Qty Sent (kg)</th>
            </tr>
          </thead>
          <tbody>
            ${yarnRows}
            <tr class="total-row">
              <td colspan="4" class="center">TOTAL YARN SENT — ${yarnItems.length} Lot(s)</td>
              <td class="right">${sentKg.toFixed(3)} kg</td>
            </tr>
          </tbody>
        </table>

        <div style="padding:6px 12px;background:#e8f5e9;border-bottom:1px solid #bbb;font-size:11px;font-weight:700;text-transform:uppercase;color:#1b5e20;margin-top:8px;">
          Receipt History (${allReceipts.length} Receipt${allReceipts.length > 1 ? 's' : ''})
        </div>
        <table>
          <thead>
            <tr>
              <th class="center" style="width:28px">#</th>
              <th>Date</th>
              <th class="right">Greige Weight (kg)</th>
              <th class="center">Rolls</th>
              <th class="right">Balance Yarn (kg)</th>
              <th class="center">Quality</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${receiptRows}
            <tr class="total-row">
              <td colspan="2" class="center">TOTAL — ${allReceipts.length} Receipt(s)</td>
              <td class="right">${totalRecvKg.toFixed(3)} kg</td>
              <td class="center">${totalRolls}</td>
              <td class="right">${totalBalYarn.toFixed(3)} kg</td>
              <td colspan="2"></td>
            </tr>
          </tbody>
        </table>

        <div class="summary-row">
          <div class="summary-box"><label>Yarn Sent (kg)</label><span>${sentKg.toFixed(3)}</span></div>
          <div class="summary-box"><label>Greige Rolls Received</label><span>${totalRolls} rolls</span></div>
          <div class="summary-box"><label>Greige Weight (kg)</label><span style="color:#155724">${totalRecvKg.toFixed(3)}</span></div>
          <div class="summary-box"><label>Balance Yarn Back (kg)</label><span style="color:#1a3a8f">${totalBalYarn.toFixed(3)}</span></div>
          <div class="summary-box"><label>Yarn Consumed (kg)</label><span>${consumed.toFixed(3)}</span></div>
          ${totalRejKg > 0 ? `<div class="summary-box"><label>Rejected (kg)</label><span style="color:#721c24">${totalRejKg.toFixed(3)}</span></div>` : ''}
        </div>

        <div class="notes" style="background:#fffbeb;">
          <strong>Yarn Account Reconciliation</strong>
          Yarn Sent: ${sentKg.toFixed(3)} kg &nbsp;|&nbsp;
          Balance Returned: ${totalBalYarn.toFixed(3)} kg &nbsp;|&nbsp;
          Net Consumed: ${consumed.toFixed(3)} kg &nbsp;|&nbsp;
          Knitting Yield: ${consumed > 0 ? ((totalRecvKg / consumed) * 100).toFixed(1) : '—'}%
        </div>

        ${latestReceipt.notes ? `<div class="notes"><strong>Latest Receipt Notes</strong>${latestReceipt.notes}</div>` : ''}
        <div class="notes" style="font-size:10px;color:#666;font-style:italic;">
          ${data.is_job_work
            ? 'Material received for job work on behalf of customer. Balance yarn and finished rolls reconciled above.'
            : 'Material returned after processing. This is a Material Receipt Note for record purposes.'}
        </div>
        <div class="sig-strip">
          ${sigBoxHTML('Store Incharge (Received By)')}${sigBoxHTML('Quality Checked By')}${sigBoxHTML('Vendor / Knitter Acknowledgement')}
        </div>
        <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
      </div>`;
    return html;
  }

  /* ── ROLL-BASED receipt (Dyeing / Finishing) ── */
  const rolls  = data.rolls || [];
  const sentKg = rolls.reduce((a, r) => a + parseFloat(r.actual_weight_kg || 0), 0);
  const totalRecvKg = allReceipts.reduce((a, r) => a + parseFloat(r.received_weight_kg || 0), 0);
  const totalRejKg  = allReceipts.reduce((a, r) => a + parseFloat(r.rejected_weight_kg || 0), 0);
  const goodKg  = totalRecvKg - totalRejKg;
  const lossKg  = sentKg - totalRecvKg;
  const lossPct = sentKg > 0 ? ((lossKg / sentKg) * 100).toFixed(1) : '0.0';
  const latestReceipt = allReceipts[0] || {};

  const rollRows = rolls.map((r, i) => `
    <tr class="${i%2===1?'alt':''}">
      <td class="center">${i+1}</td>
      <td><strong>${r.roll_display || ('ROLL-' + String(r.roll_id).padStart(4,'0'))}</strong></td>
      <td>${fmt(r.fabric_type || data.fabric_type)}</td>
      <td class="center">${r.hsn_code || '—'}</td>
      <td>${fmt(r.machine_name || r.machine_id)}</td>
      <td class="center">${fmt(r.shift)}</td>
      <td class="right">${fmtKg(r.actual_weight_kg)}</td>
    </tr>`).join('');

  const receiptRows = allReceipts.map((r, i) => `
    <tr class="${i%2===1?'alt':''}">
      <td class="center">${i+1}</td>
      <td>${fmtDate(r.received_date)}</td>
      <td class="right"><strong>${fmtKg(r.received_weight_kg)}</strong></td>
      <td class="right">${fmtKg(r.rejected_weight_kg || 0)}</td>
      <td class="center">${fmt(r.quality_status)}</td>
      <td>${r.notes || '—'}</td>
    </tr>`).join('');

  const jobLabel = (data.job_type || '').replace('_', ' + ');
  const processCost = data.rate_per_kg ? totalRecvKg * parseFloat(data.rate_per_kg) : 0;

  const html = `
    <div class="page">
      ${busyHeaderHTML(co, 'Material Receipt Note', data.challan_number + '-R', fmtDate(latestReceipt.received_date || new Date()))}
      <div class="meta-row">
        <div class="meta-box">
          <span class="meta-label">Vendor / Job Worker</span>
          <div class="meta-val">${fmt(data.vendor_name)}</div>
          ${data.vendor_contact ? `<div class="meta-val-sm">Contact: ${data.vendor_contact}</div>` : ''}
          <div class="meta-val-sm">Ref. Challan: <strong>${fmt(data.challan_number)}</strong> &nbsp;|&nbsp; Job: ${jobLabel}</div>
        </div>
        <div class="meta-box">
          <span class="meta-label">Receipt Summary</span>
          <div class="meta-val">Batch: <strong>${fmt(data.batch_number)}</strong></div>
          <div class="meta-val-sm">Fabric: ${fmt(data.fabric_type)} &nbsp;|&nbsp; Colour: ${fmt(data.color_name)}</div>
          <div class="meta-val-sm">Total Receipts: <strong>${allReceipts.length}</strong> &nbsp;|&nbsp; Status: <strong>${fmt(data.status)}</strong></div>
        </div>
      </div>

      <div style="padding:6px 12px;background:#eef2ff;border-bottom:1px solid #bbb;font-size:11px;font-weight:700;text-transform:uppercase;color:#1a3a8f;">
        Rolls Sent for ${jobLabel}
      </div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:28px">#</th>
            <th>Roll No.</th>
            <th>Fabric Type</th>
            <th class="center">HSN</th>
            <th>Machine</th>
            <th class="center">Shift</th>
            <th class="right">Sent Weight (kg)</th>
          </tr>
        </thead>
        <tbody>
          ${rollRows}
          <tr class="total-row">
            <td colspan="6" class="center">TOTAL — ${rolls.length} Roll(s)</td>
            <td class="right">${sentKg.toFixed(3)} kg</td>
          </tr>
        </tbody>
      </table>

      <div style="padding:6px 12px;background:#e8f5e9;border-bottom:1px solid #bbb;font-size:11px;font-weight:700;text-transform:uppercase;color:#1b5e20;margin-top:8px;">
        Receipt History (${allReceipts.length} Receipt${allReceipts.length > 1 ? 's' : ''})
      </div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:28px">#</th>
            <th>Date</th>
            <th class="right">Received (kg)</th>
            <th class="right">Rejected (kg)</th>
            <th class="center">Quality</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${receiptRows}
          <tr class="total-row">
            <td colspan="2" class="center">TOTAL — ${allReceipts.length} Receipt(s)</td>
            <td class="right">${totalRecvKg.toFixed(3)} kg</td>
            <td class="right">${totalRejKg.toFixed(3)} kg</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>

      <div class="summary-row">
        <div class="summary-box"><label>Rolls Sent</label><span>${rolls.length}</span></div>
        <div class="summary-box"><label>Weight Sent</label><span>${sentKg.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Weight Received</label><span style="color:#155724">${totalRecvKg.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Rejected</label><span style="color:#721c24">${totalRejKg.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Good / Accepted</label><span style="color:#155724">${goodKg.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Processing Loss</label><span style="color:${lossKg>0?'#721c24':'#155724'}">${lossKg.toFixed(3)} kg (${lossPct}%)</span></div>
      </div>
      ${processCost > 0 ? `
      <div class="summary-row">
        <div class="summary-box"><label>Rate / kg</label><span>₹${parseFloat(data.rate_per_kg).toFixed(2)}</span></div>
        <div class="summary-box"><label>Processing Cost (on recd. wt.)</label><span>₹${processCost.toFixed(2)}</span></div>
        <div class="summary-box" style="flex:3"></div>
      </div>
      <div class="amt-words"><strong>Processing Cost in Words</strong>${amtInWords(processCost)}</div>` : ''}
      ${latestReceipt.notes ? `<div class="notes"><strong>Latest Receipt Notes</strong>${latestReceipt.notes}</div>` : ''}
      <div class="notes" style="font-size:10px;color:#666;font-style:italic;">
        Material received back after ${jobLabel} processing. This is a Material Receipt Note for record purposes.
      </div>
      <div class="sig-strip">
        ${sigBoxHTML('Received By (Store Incharge)')}${sigBoxHTML('Quality Checked By')}${sigBoxHTML('Authorised Signatory')}
      </div>
      <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
    </div>`;
  return html;
}

/* ════════════════════════════════════════════════
   DISPATCH / DELIVERY CHALLAN
   Columns: #, Batch No, Fabric Type, HSN, Colour, Weight(kg)
════════════════════════════════════════════════ */
function DispatchDoc({ data, co }) {
  if (!data) return null;
  const items   = data.items || [];
  const totalKg = items.reduce((a, i) => a + parseFloat(i.weight_kg || 0), 0);
  const priced  = items.some(i => i.rate_per_kg && parseFloat(i.rate_per_kg) > 0);
  const totTaxable = items.reduce((a, i) => a + parseFloat(i.taxable_value || 0), 0);
  const totGst     = items.reduce((a, i) => a + parseFloat(i.gst_amount || 0), 0);
  const grand      = parseFloat(data.grand_total || (totTaxable + totGst));

  const itemLabel = (item) =>
    item.item_type === 'YARN'   ? fmt(item.lot_number || `LOT-${item.lot_id}`)
    : item.item_type === 'GREIGE' ? `Roll #${item.roll_id}`
    : fmt(item.batch_number);

  const rows = items.map((item, i) => `
    <tr class="${i%2===1?'alt':''}">
      <td class="center">${i+1}</td>
      <td>${itemLabel(item)}</td>
      <td>${fmt(item.fabric_type || item.item_name || item.yarn_type)}</td>
      <td class="center">${fmt(item.hsn_code || item.hsn)}</td>
      <td>${fmt(item.color_name || item.color)}</td>
      <td class="right">${fmtKg(item.weight_kg)}</td>
      ${priced ? `
      <td class="right">${item.rate_per_kg ? parseFloat(item.rate_per_kg).toFixed(2) : '—'}</td>
      <td class="right">${item.taxable_value ? parseFloat(item.taxable_value).toFixed(2) : '—'}</td>
      <td class="center">${item.gst_rate ? parseFloat(item.gst_rate).toFixed(1) + '%' : '—'}</td>
      <td class="right">${item.gst_amount ? parseFloat(item.gst_amount).toFixed(2) : '—'}</td>
      <td class="right"><strong>${item.line_total ? parseFloat(item.line_total).toFixed(2) : '—'}</strong></td>` : ''}
    </tr>`).join('');

  const html = `
    <div class="page">
      ${busyHeaderHTML(co, 'Delivery Challan', data.dispatch_number, fmtDate(data.dispatch_date))}
      <div class="meta-row">
        <div class="meta-box">
          <span class="meta-label">Customer / Consignee</span>
          <div class="meta-val">${fmt(data.customer_name)}</div>
          ${data.customer_contact ? `<div class="meta-val-sm">Contact: ${data.customer_contact}</div>` : ''}
        </div>
        <div class="meta-box">
          <span class="meta-label">Vehicle No.</span>
          <div class="meta-val">${fmt(data.vehicle_number || data.vehicle_no)}</div>
          <div class="meta-val-sm">Status: ${fmt(data.status || 'DISPATCHED')}</div>
          ${data.notes ? `<div class="meta-val-sm">Notes: ${data.notes}</div>` : ''}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="center">#</th>
            <th>Lot / Batch</th>
            <th>Item</th>
            <th class="center">HSN</th>
            <th>Colour</th>
            <th class="right">Qty (kg)</th>
            ${priced ? `
            <th class="right">Rate (₹/kg)</th>
            <th class="right">Taxable (₹)</th>
            <th class="center">GST %</th>
            <th class="right">GST (₹)</th>
            <th class="right">Total (₹)</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="5" class="center">TOTAL — ${items.length} Lots</td>
            <td class="right">${totalKg.toFixed(3)} kg</td>
            ${priced ? `
            <td></td>
            <td class="right">${totTaxable.toFixed(2)}</td>
            <td></td>
            <td class="right">${totGst.toFixed(2)}</td>
            <td class="right"><strong>${grand.toFixed(2)}</strong></td>` : ''}
          </tr>
        </tbody>
      </table>
      ${priced ? `
      <div class="summary-row">
        <div class="summary-box"><label>Taxable Value</label><span>₹${totTaxable.toFixed(2)}</span></div>
        <div class="summary-box"><label>Total GST</label><span>₹${totGst.toFixed(2)}</span></div>
        <div class="summary-box"><label>Grand Total</label><span>₹${grand.toFixed(2)}</span></div>
      </div>
      <div class="notes" style="font-size:11px;font-weight:bold;">
        Amount in words: ${amtInWords(grand)}
      </div>` : `
      <div class="summary-row">
        <div class="summary-box"><label>Total Lots</label><span>${items.length}</span></div>
        <div class="summary-box"><label>Total Weight (kg)</label><span>${totalKg.toFixed(3)} kg</span></div>
        <div class="summary-box"><label>Total Weight (g)</label><span>${(totalKg*1000).toFixed(0)} g</span></div>
      </div>`}
      <div class="notes" style="font-size:10px;font-style:italic;color:#888;">
        This is a computer generated delivery challan. Subject to verification on receipt.
      </div>
      <div class="sig-strip">
        ${sigBoxHTML('Dispatch Incharge')}${sigBoxHTML('Driver / Transporter')}${sigBoxHTML('Customer Acknowledgement')}
      </div>
      <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
    </div>`;
  return html;
}

/* ════════════════════════════════════════════════
   DYEING CHALLAN
   Structure: Batch → Lots → Rolls (per lot)
   Each lot groups rolls by colour required.
   Multiple fabric types within a lot are shown as sub-rows.
════════════════════════════════════════════════ */
function DyeingDoc({ data, co }) {
  if (!data) return null;

  const lots = data.lots || [];
  let totalRolls = 0;
  let totalKg    = 0;

  const lotsHTML = lots.map((lot, li) => {
    const rolls     = lot.rolls || [];
    const lotWeight = rolls.reduce((a, r) => a + parseFloat(r.actual_weight_kg || r.weight_kg || 0), 0);
    totalRolls += rolls.length;
    totalKg    += lotWeight;

    const rollRows = rolls.map((r, ri) => `
      <tr class="${ri%2===1?'alt':''}">
        <td class="center">${ri+1}</td>
        <td>${fmt(r.roll_id)}</td>
        <td>${fmt(r.fabric_type || lot.fabric_type)}</td>
        <td class="center">${fmt(r.hsn_code || r.hsn || lot.hsn_code)}</td>
        <td>${fmt(r.machine_name || r.machine_id)}</td>
        <td class="right">${fmtKg(r.actual_weight_kg || r.weight_kg)}</td>
      </tr>`).join('');

    return `
      <div class="lot-section">
        <div class="lot-title">
          <span>LOT ${li+1}: ${fmt(lot.lot_number || lot.lot_id)}</span>
          <span>Required Colour: ${fmt(lot.color_required || lot.color_name || lot.colour_required)} &nbsp;|&nbsp; ${rolls.length} Rolls &nbsp;|&nbsp; ${lotWeight.toFixed(3)} kg</span>
        </div>
        <table>
          <thead>
            <tr>
              <th class="center">#</th>
              <th>Roll ID</th>
              <th>Fabric Type</th>
              <th class="center">HSN</th>
              <th>Machine</th>
              <th class="right">Weight (kg)</th>
            </tr>
          </thead>
          <tbody>
            ${rollRows}
            <tr class="subtotal">
              <td colspan="4" class="center">Lot Subtotal — ${rolls.length} rolls</td>
              <td></td>
              <td class="right">${lotWeight.toFixed(3)} kg</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }).join('');

  const html = `
    <div class="page">
      ${busyHeaderHTML(co, 'Dyeing Challan', data.challan_number, fmtDate(data.sent_date || data.challan_date))}
      <div class="meta-row">
        <div class="meta-box">
          <span class="meta-label">Dye House / Vendor</span>
          <div class="meta-val">${fmt(data.vendor_name)}</div>
          ${data.vendor_contact ? `<div class="meta-val-sm">Contact: ${data.vendor_contact}</div>` : ''}
        </div>
        <div class="meta-box">
          <span class="meta-label">Batch No.</span>
          <div class="meta-val">${fmt(data.batch_number)}</div>
          <div class="meta-val-sm">Total Lots: ${lots.length} &nbsp;|&nbsp; Total Rolls: ${data.total_rolls || '—'}</div>
          ${data.expected_return_date ? `<div class="meta-val-sm">Expected Return: ${fmtDate(data.expected_return_date)}</div>` : ''}
          ${data.rate_per_kg ? `<div class="meta-val-sm">Rate: ₹${parseFloat(data.rate_per_kg).toFixed(2)}/kg</div>` : ''}
        </div>
      </div>
      ${lotsHTML}
      <div class="summary-row">
        <div class="summary-box"><label>Total Lots</label><span>${lots.length}</span></div>
        <div class="summary-box"><label>Total Rolls</label><span>${totalRolls}</span></div>
        <div class="summary-box"><label>Total Weight</label><span>${totalKg.toFixed(3)} kg</span></div>
        ${data.rate_per_kg ? `<div class="summary-box"><label>Est. Dyeing Cost</label><span>₹${(totalKg * parseFloat(data.rate_per_kg)).toFixed(2)}</span></div>` : ''}
      </div>
      ${data.notes ? `<div class="notes"><strong>Processing Instructions / Notes</strong>${data.notes}</div>` : ''}
      <div class="sig-strip">
        ${sigBoxHTML('Issued By')}${sigBoxHTML('Received By (Dye House)')}${sigBoxHTML('Authorised Signatory')}
      </div>
      <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
    </div>`;
  return html;
}

/* ── HTML string helpers (used inside window.open) ─ */
function busyHeaderHTML(co, docType, docNumber, docDate) {
  return `
    <div class="co-header">
      <img class="co-logo" src="${co.logo}" alt="Logo" onerror="this.style.display='none'" />
      <div class="co-info">
        <div class="co-name">${co.company_name || 'DHOWN TEXTILES'}</div>
        <div class="co-addr">${co.factory_address || ''}${co.phone_number ? ' | Ph: '+co.phone_number : ''}${co.email ? ' | '+co.email : ''}</div>
        ${co.gst_number ? `<div class="co-gstin">GSTIN: ${co.gst_number}</div>` : ''}
      </div>
      <div class="doc-title-box">
        <div class="doc-type">${docType}</div>
        <div class="doc-num">${docNumber || '—'}</div>
        <div class="doc-date">Date: ${docDate}</div>
      </div>
    </div>`;
}

function sigBoxHTML(label) {
  return `<div class="sig-box"><div class="sig-line">${label}</div></div>`;
}

/* ── Render to HTML string dispatch ─────────────── */
function renderDoc(type, data, co) {
  if (type === 'GRN')        return GRNDoc({ data, co });
  if (type === 'YARN_ISSUE') return YarnIssueDoc({ data, co });
  if (type === 'SC_CHALLAN') return SCChallanDoc({ data, co });
  if (type === 'SC_RECEIPT') return SCReceiptDoc({ data, co });
  if (type === 'DISPATCH')   return DispatchDoc({ data, co });
  if (type === 'DYEING')     return DyeingDoc({ data, co });
  if (type === 'PACKING_LIST') return PackingListDoc({ data, co });
  return '<p>Unknown document type</p>';
}

/* ── PACKING LIST (SC challan rolls, exact weights, grouped by fabric) ── */
function PackingListDoc({ data, co }) {
  if (!data) return null;
  const rolls = data.rolls || [];

  // Group rolls by fabric type
  const groups = {};
  rolls.forEach(r => {
    const f = r.fabric_type || data.fabric_type || 'Unknown';
    if (!groups[f]) groups[f] = [];
    groups[f].push(r);
  });

  const grandKg = rolls.reduce((a, r) => a + parseFloat(r.actual_weight_kg || 0), 0);
  let sn = 0;

  const groupHTML = Object.entries(groups).map(([fabric, items]) => {
    const subKg = items.reduce((a, r) => a + parseFloat(r.actual_weight_kg || 0), 0);
    const rows = items.map(r => {
      sn += 1;
      return `
      <tr class="${sn % 2 === 0 ? 'alt' : ''}">
        <td class="center">${sn}</td>
        <td><strong>${r.roll_display || r.roll_id || ('ROLL-' + String(r.roll_id).padStart(4, '0'))}</strong></td>
        <td>${fmt(fabric)}</td>
        <td>${fmt(r.machine_name || r.machine_id || '—')}</td>
        <td class="center">${fmt(r.shift === 'D' ? 'Day' : r.shift === 'N' ? 'Night' : r.shift || '—')}</td>
        <td class="right"><strong>${fmtKg(r.actual_weight_kg)}</strong></td>
      </tr>`;
    }).join('');
    return `
      ${rows}
      <tr style="background:#f3f4f6;">
        <td colspan="5" class="right" style="font-weight:700;">Subtotal — ${fmt(fabric)} (${items.length} roll${items.length !== 1 ? 's' : ''})</td>
        <td class="right" style="font-weight:700;">${subKg.toFixed(3)} kg</td>
      </tr>`;
  }).join('');

  return `
    <div class="page">
      ${busyHeaderHTML(co, 'Packing List', data.challan_number, fmtDate(data.sent_date))}
      <div class="meta-row">
        <div class="meta-box">
          <span class="meta-label">Sent To (Vendor / Job Worker)</span>
          <div class="meta-val">${fmt(data.vendor_name)}</div>
          ${data.vendor_contact ? `<div class="meta-val-sm">Contact: ${data.vendor_contact}</div>` : ''}
          <div class="meta-val-sm">Job Type: <strong>${fmt(data.job_type)}</strong></div>
        </div>
        <div class="meta-box">
          <span class="meta-label">Reference</span>
          <div class="meta-val-sm">Challan No: <strong>${fmt(data.challan_number)}</strong></div>
          <div class="meta-val-sm">Lot: <strong>${fmt(data.batch_number || '—')}</strong></div>
          <div class="meta-val-sm">Sent Date: <strong>${fmtDate(data.sent_date)}</strong></div>
        </div>
      </div>

      <div style="padding:6px 12px;background:#eef2ff;border-bottom:1px solid #bbb;font-size:11px;font-weight:700;text-transform:uppercase;color:#1a3a8f;">
        Roll-wise Packing Detail — ${rolls.length} Roll(s)
      </div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:32px">#</th>
            <th>Roll No.</th>
            <th>Fabric</th>
            <th>Machine</th>
            <th class="center">Shift</th>
            <th class="right">Exact Weight (kg)</th>
          </tr>
        </thead>
        <tbody>
          ${groupHTML}
          <tr class="total-row">
            <td colspan="5" class="center">GRAND TOTAL — ${rolls.length} Roll(s)</td>
            <td class="right">${grandKg.toFixed(3)} kg</td>
          </tr>
        </tbody>
      </table>

      <div class="summary-row">
        <div class="summary-box"><label>Total Rolls</label><span>${rolls.length}</span></div>
        <div class="summary-box"><label>Fabric Types</label><span>${Object.keys(groups).length}</span></div>
        <div class="summary-box"><label>Total Weight</label><span>${grandKg.toFixed(3)} kg</span></div>
      </div>

      ${data.notes ? `<div class="notes"><strong>Notes</strong>${data.notes}</div>` : ''}
      <div class="notes" style="font-size:10px;color:#666;font-style:italic;">
        Weights are exact roll weights as weighed at DHOWN. Please verify count and weight on receipt and report any discrepancy immediately.
      </div>
      <div class="sig-strip">
        ${sigBoxHTML('Packed By')}${sigBoxHTML('Transporter / Driver')}${sigBoxHTML('Received & Verified By (Vendor)')}
      </div>
      <div class="page-footer">This is a computer generated document. DHOWN MES | GSTIN: ${co.gst_number || ''}</div>
    </div>`;
}

/* ════════════════════════════════════════════════
   Main component
════════════════════════════════════════════════ */
export default function PrintChallan({ type, data, onClose }) {
  const [co, setCo] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/settings`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.json())
      .then(s => setCo({ ...s, logo: logo }))
      .catch(() => setCo({ logo: logo }));
  }, []);

  const handlePrint = () => {
    if (!co) return;
    const bodyHTML = renderDoc(type, data, co);
    const win = window.open('', '_blank', 'width=960,height=750');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle(type, data)}</title><style>${PRINT_CSS}</style></head><body>${bodyHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '24px 0' }}>
      <div style={{ background: '#fff', borderRadius: 10, width: 860, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 20px', background: '#1e293b', borderRadius: '10px 10px 0 0' }}>
          <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>Print Preview — {docTitle(type, data)}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handlePrint} disabled={!co}
              style={{ background: co ? '#3b82f6' : '#64748b', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: co ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 13 }}>
              🖨 Print
            </button>
            <button onClick={onClose} style={{ background: '#334155', color: '#e2e8f0', border: 'none', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>✕ Close</button>
          </div>
        </div>

        {/* Preview */}
        <div style={{ padding: '20px 24px', color: '#111', fontFamily: 'Arial, sans-serif', fontSize: 12, maxHeight: '78vh', overflowY: 'auto' }}>
          {!co ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading company settings...</div>
          ) : (
            <iframe
              srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_CSS} body{padding:12px;} </style></head><body>${renderDoc(type, data, co)}</body></html>`}
              style={{ width: '100%', height: 600, border: 'none' }}
              title="print-preview"
            />
          )}
        </div>
      </div>
    </div>
  );
}

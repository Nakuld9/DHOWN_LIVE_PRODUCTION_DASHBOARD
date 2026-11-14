// Printable stick-on labels for rolls and batches.
// Opens a print window sized ~100mm x 75mm (standard roll label). Every label
// carries a scannable QR: the roll's stored qr_image when present, otherwise one
// generated on the fly encoding a traceability deep link (so a phone scan opens
// the item's lineage in the MES).
import QRCode from 'qrcode';

const MILL = 'DHOWN HOSIERY MILLS';

// Absolute URLs — the print window is about:blank, so relative paths won't resolve.
// Labels are small + thermal, so the 192px icon (21KB) is plenty; A4 docs print
// the logo larger, so they use the 512px one. Neither is the 1.5MB source logo.
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
const LOGO = ORIGIN + '/icon-192.png';
const LOGO_HI = ORIGIN + '/icon-512.png';

// Letterhead details come from Settings (company_name / factory_address /
// gst_number / phone_number) so changing them there updates every future
// document — no hardcoded address to go stale.
async function fetchCompany() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    return {
      name: s.company_name || MILL,
      address: s.factory_address || '',
      gstin: s.gst_number || '',
      phone: s.phone_number || '',
    };
  } catch {
    return { name: MILL, address: '', gstin: '', phone: '' };
  }
}

// Print only once every image has settled. Labels embed QRs as data URLs (instant),
// but the logo is fetched over the network — a fixed timeout could fire the print
// dialog first and produce a logo-less page. Capped so a blocked image can't hang it.
function printWhenReady(win) {
  const imgs = Array.from(win.document.images || []);
  const loaded = Promise.all(imgs.map(img => (
    img.complete ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res; })
  )));
  Promise.race([loaded, new Promise(res => setTimeout(res, 3000))])
    .then(() => { win.print(); });
}

// Traceability deep link for a scanned label, + a QR data-URL generator.
const traceURL = (kind, id) => `${ORIGIN}/traceability?${kind}=${encodeURIComponent(id)}`;
async function qrDataURL(text) {
  try { return await QRCode.toDataURL(text, { margin: 0, width: 220, errorCorrectionLevel: 'M' }); }
  catch { return ''; }
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : '—';
const fmtKg = (v) => (v == null || v === '') ? '—' : `${parseFloat(v).toFixed(3)} kg`;

const LABEL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
  @page { size: 100mm 75mm; margin: 0; }
  .label {
    width: 100mm; height: 75mm; padding: 5mm; border: 1px solid #000;
    display: flex; flex-direction: column; page-break-after: always; overflow: hidden;
  }
  .head { display: flex; align-items: center; justify-content: center; gap: 3mm; border-bottom: 1.5px solid #000; padding-bottom: 2mm; }
  /* Thermal printers are monochrome — flatten to high-contrast greyscale so the
     logo prints crisp instead of as a muddy dither of the gold. */
  .logo { height: 11mm; width: 11mm; object-fit: contain; filter: grayscale(1) contrast(1.4); }
  .mill { font-size: 11pt; font-weight: bold; text-align: center; letter-spacing: 1px; }
  .kind { font-size: 8pt; text-transform: uppercase; letter-spacing: 2px; color: #333; margin-top: 1.5mm; text-align: center; }
  .body { display: flex; gap: 4mm; flex: 1; margin-top: 2mm; }
  .info { flex: 1; }
  .id { font-size: 15pt; font-weight: bold; font-family: monospace; word-break: break-all; line-height: 1.1; }
  .row { font-size: 9pt; margin-top: 1.5mm; }
  .row b { display: inline-block; width: 22mm; color: #333; font-weight: normal; }
  .qr { width: 28mm; height: 28mm; flex-shrink: 0; }
  .qr img { width: 100%; height: 100%; }
  .qrbox { width: 28mm; height: 28mm; border: 1px dashed #999; display: flex; align-items: center; justify-content: center; font-size: 7pt; color: #999; text-align: center; }
  .foot { font-size: 7pt; color: #555; text-align: center; border-top: 1px solid #ccc; padding-top: 1.5mm; margin-top: 1mm; }
`;

// Opens the window synchronously (so the popup blocker allows it inside the
// user gesture), THEN awaits the inner builder (QR generation is async).
async function openPrint(title, innerFn) {
  const win = window.open('', '_blank', 'width=520,height=420');
  if (!win) { alert('Popup blocked — allow popups to print labels.'); return; }
  const inner = typeof innerFn === 'function' ? await innerFn() : innerFn;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${LABEL_CSS}</style></head><body>${inner}</body></html>`);
  win.document.close();
  printWhenReady(win);
}

async function rollLabelHTML(roll) {
  const weight = roll.actual_weight_kg ?? roll.weight_kg;
  const machine = roll.machine_name || roll.machine_id || '—';
  const date = roll.closed_at || roll.approved_at || roll.created_at;
  const img = roll.qr_image || await qrDataURL(traceURL('roll', roll.roll_id));
  const qr = img
    ? `<div class="qr"><img src="${img}" alt="QR"/></div>`
    : `<div class="qrbox">${esc(roll.roll_id)}</div>`;
  return `
    <div class="label">
      <div class="head"><img class="logo" src="${LOGO}" alt=""/><div class="mill">${MILL}</div></div>
      <div class="kind">Roll Label</div>
      <div class="body">
        <div class="info">
          <div class="id">${esc(roll.roll_id)}</div>
          <div class="row"><b>Fabric</b>${esc(roll.fabric_type || '—')}</div>
          <div class="row"><b>Colour</b>${esc(roll.color || roll.color_name || '—')}</div>
          <div class="row"><b>Weight</b>${fmtKg(weight)}</div>
          <div class="row"><b>Machine</b>${esc(machine)}${roll.shift ? ` · Shift ${esc(roll.shift)}` : ''}</div>
          <div class="row"><b>Date</b>${fmtDate(date)}</div>
        </div>
        ${qr}
      </div>
      <div class="foot">Scan QR for roll traceability · ${MILL}</div>
    </div>`;
}

async function batchLabelHTML(batch) {
  const img = await qrDataURL(traceURL('lot', batch.batch_number));
  const qr = img ? `<div class="qr"><img src="${img}" alt="QR"/></div>` : `<div class="qrbox">LOT<br/>${esc(batch.batch_number)}</div>`;
  return `
    <div class="label">
      <div class="head"><img class="logo" src="${LOGO}" alt=""/><div class="mill">${MILL}</div></div>
      <div class="kind">Batch / Lot Label</div>
      <div class="body">
        <div class="info">
          <div class="id">${esc(batch.batch_number)}</div>
          <div class="row"><b>Fabric</b>${esc(batch.fabric_type || '—')}</div>
          <div class="row"><b>Colour</b>${esc(batch.color_name || '—')}</div>
          <div class="row"><b>Rolls</b>${batch.roll_count ?? (batch.rolls ? batch.rolls.length : '—')}</div>
          <div class="row"><b>Total Wt</b>${fmtKg(batch.total_weight_kg)}</div>
        </div>
        ${qr}
      </div>
      <div class="foot">Paste on each roll of this lot · ${MILL}</div>
    </div>`;
}

// Finished-goods stock/lot label: fabric, colour, lot no, weight + FG reference.
async function finishedLabelHTML(fg) {
  const ref = fg.lot_no || (fg.fg_id ? `FG-${fg.fg_id}` : '—');
  const img = await qrDataURL(traceURL('lot', ref));
  const qr = img ? `<div class="qr"><img src="${img}" alt="QR"/></div>` : `<div class="qrbox">FG<br/>${esc(ref)}</div>`;
  return `
    <div class="label">
      <div class="head"><img class="logo" src="${LOGO}" alt=""/><div class="mill">${MILL}</div></div>
      <div class="kind">Finished Fabric Label</div>
      <div class="body">
        <div class="info">
          <div class="id">${esc(ref)}</div>
          <div class="row"><b>Fabric</b>${esc(fg.fabric_type || '—')}</div>
          <div class="row"><b>Colour</b>${esc(fg.color_name || '—')}</div>
          <div class="row"><b>Lot No</b>${esc(fg.lot_no || '—')}</div>
          <div class="row"><b>Weight</b>${fmtKg(fg.weight_kg)}</div>
          <div class="row"><b>Date</b>${fmtDate(fg.created_at)}</div>
        </div>
        ${qr}
      </div>
      <div class="foot">Finished fabric stock · ${MILL}</div>
    </div>`;
}

export function printFinishedLabel(fg) {
  openPrint(`Finished Label ${fg.lot_no || fg.fg_id || ''}`, () => finishedLabelHTML(fg));
}

// Bulk: one finished-fabric label per entry, all in a single print window.
export function printFinishedLabels(list) {
  const items = (list || []).filter(f => f && (f.fg_id || f.lot_no));
  if (items.length === 0) { alert('No finished-fabric entries to print.'); return; }
  openPrint(`Finished Labels (${items.length})`, async () => (await Promise.all(items.map(finishedLabelHTML))).join(''));
}

export function printRollLabel(roll) {
  openPrint(`Roll Label ${roll.roll_id}`, () => rollLabelHTML(roll));
}

// Prints one roll label per roll, all in a single print window (bulk / opening-balance job).
export function printRollLabels(rolls) {
  const list = (rolls || []).filter(r => r && r.roll_id);
  if (list.length === 0) { alert('No rolls with a Roll ID to print.'); return; }
  openPrint(`Roll Labels (${list.length})`, async () => (await Promise.all(list.map(rollLabelHTML))).join(''));
}

// A4 packing list for a dispatch challan. Pass the object from GET /api/dispatch/:id
// (challan fields + items[]). One row per roll/lot/FG with weights and totals.
export async function printPackingList(dc) {
  // Open the window BEFORE any await — popup blockers only allow window.open
  // inside the user-gesture tick, and fetching settings first would lose it.
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) { alert('Popup blocked — allow popups to print.'); return; }
  const co = await fetchCompany();
  const dcNo = dc.dispatch_number || dc.dispatch_id;
  const dcQr = await qrDataURL(`${ORIGIN}/dispatch?no=${encodeURIComponent(dcNo)}`);

  const items = dc.items || [];
  const type = dc.dispatch_type || 'FG';
  const itemRef = (i) =>
    type === 'GREIGE' ? (i.roll_id || '—')
    : type === 'YARN' ? (i.lot_number || (i.lot_id ? `LOT-${i.lot_id}` : '—'))
    : (i.fg_roll_id || i.fg_lot_no || i.batch_number || (i.fg_id ? `FG-${i.fg_id}` : '—'));
  const itemDesc = (i) =>
    type === 'GREIGE' ? [i.roll_fabric || i.fabric_type, i.machine_name].filter(Boolean).join(' · ')
    : type === 'YARN' ? [i.yl_yarn_type || i.yarn_type, i.yl_color || i.color, i.count].filter(Boolean).join(' · ')
    : [i.fg_fabric || i.fabric_type, i.fg_color || i.color_name].filter(Boolean).join(' · ');
  const totalKg = items.reduce((s, i) => s + parseFloat(i.weight_kg || 0), 0);

  const rows = items.map((i, n) => `
    <tr>
      <td class="c">${n + 1}</td>
      <td class="mono">${esc(itemRef(i))}</td>
      <td>${esc(itemDesc(i) || '—')}</td>
      <td class="r">${fmtKg(i.weight_kg)}</td>
    </tr>`).join('');

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; color: #000; }
    @page { size: A4; margin: 12mm; }
    /* A4 goes to a normal (colour) printer — no greyscale flattening here,
       unlike the thermal labels. */
    .head { display: flex; align-items: center; justify-content: center; gap: 5mm; }
    .logo { height: 18mm; width: 18mm; object-fit: contain; }
    .mill { font-size: 16pt; font-weight: bold; text-align: center; letter-spacing: 1px; }
    .addr { font-size: 9pt; text-align: center; color: #333; margin-top: 1.5mm; }
    .contact { font-size: 9pt; text-align: center; color: #333; margin-top: 0.8mm; }
    .contact b { font-weight: bold; color: #000; }
    .doc  { font-size: 11pt; text-align: center; text-transform: uppercase; letter-spacing: 3px; margin: 2mm 0 5mm; border-bottom: 2px solid #000; padding-bottom: 3mm; }
    .meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 3mm; margin-bottom: 5mm; font-size: 10pt; }
    .meta b { display: inline-block; min-width: 26mm; color: #333; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    th, td { border: 1px solid #000; padding: 2.2mm 2.5mm; text-align: left; }
    th { background: #eee; font-size: 9pt; text-transform: uppercase; }
    .c { text-align: center; } .r { text-align: right; } .mono { font-family: monospace; font-weight: bold; }
    .tot td { font-weight: bold; background: #f5f5f5; }
    .sig { display: flex; justify-content: space-between; margin-top: 18mm; font-size: 10pt; }
    .sig div { width: 55mm; border-top: 1px solid #000; text-align: center; padding-top: 2mm; }
  `;

  const inner = `
    <div class="head"><img class="logo" src="${LOGO_HI}" alt=""/><div class="mill">${esc(co.name)}</div></div>
    ${co.address ? `<div class="addr">${esc(co.address)}</div>` : ''}
    ${(co.gstin || co.phone) ? `<div class="contact">${co.gstin ? `<b>GSTIN:</b> ${esc(co.gstin)}` : ''}${(co.gstin && co.phone) ? ' &nbsp;·&nbsp; ' : ''}${co.phone ? esc(co.phone) : ''}</div>` : ''}
    <div class="doc">Packing List</div>
    <div class="meta">
      <div>
        <div><b>Challan No</b> ${esc(dc.dispatch_number || dc.dispatch_id)}</div>
        <div><b>Date</b> ${fmtDate(dc.dispatch_date || dc.created_at)}</div>
        <div><b>Type</b> ${esc(type)}</div>
      </div>
      <div>
        <div><b>Customer</b> ${esc(dc.customer_name || '—')}</div>
        <div><b>Vehicle</b> ${esc(dc.vehicle_number || '—')}</div>
        <div><b>Transport</b> ${esc(dc.transport_name || '—')}</div>
      </div>
      ${dcQr ? `<div style="text-align:center"><img src="${dcQr}" style="width:24mm;height:24mm" alt="QR"/><div style="font-size:7pt;color:#555">Scan to verify</div></div>` : ''}
    </div>
    <table>
      <thead><tr><th class="c" style="width:10mm">#</th><th style="width:42mm">${type === 'GREIGE' ? 'Roll ID' : type === 'YARN' ? 'Lot No' : 'Batch / FG'}</th><th>Description</th><th class="r" style="width:30mm">Weight</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="tot"><td colspan="2">TOTAL</td><td>${items.length} item${items.length !== 1 ? 's' : ''}</td><td class="r">${totalKg.toFixed(3)} kg</td></tr></tfoot>
    </table>
    <div class="sig"><div>Packed By</div><div>Checked By</div><div>Received By</div></div>
  `;

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Packing List ${esc(dc.dispatch_number || '')}</title><style>${css}</style></head><body>${inner}</body></html>`);
  win.document.close();
  printWhenReady(win);
}

// Prints one batch label per roll in the lot (so each roll gets its own sticker).
export function printBatchLabels(batch) {
  const copies = batch.roll_count || (batch.rolls ? batch.rolls.length : 1) || 1;
  openPrint(`Batch Labels ${batch.batch_number}`, async () => (await batchLabelHTML(batch)).repeat(copies));
}

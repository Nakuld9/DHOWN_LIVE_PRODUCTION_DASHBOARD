// Printable stick-on labels for rolls and batches.
// Opens a print window sized ~100mm x 75mm (standard roll label). Uses the roll's
// stored qr_image (data URL) when available so the roll_id is scannable.

const MILL = 'DHOWN HOSIERY MILLS';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtKg = (v) => (v == null || v === '') ? '—' : `${parseFloat(v).toFixed(3)} kg`;

const LABEL_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
  @page { size: 100mm 75mm; margin: 0; }
  .label {
    width: 100mm; height: 75mm; padding: 5mm; border: 1px solid #000;
    display: flex; flex-direction: column; page-break-after: always; overflow: hidden;
  }
  .mill { font-size: 11pt; font-weight: bold; text-align: center; letter-spacing: 1px; border-bottom: 1.5px solid #000; padding-bottom: 2mm; }
  .kind { font-size: 8pt; text-transform: uppercase; letter-spacing: 2px; color: #333; margin-top: 1.5mm; }
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

function openPrint(title, inner) {
  const win = window.open('', '_blank', 'width=520,height=420');
  if (!win) { alert('Popup blocked — allow popups to print labels.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${LABEL_CSS}</style></head><body>${inner}</body></html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 400);
}

function rollLabelHTML(roll) {
  const weight = roll.actual_weight_kg ?? roll.weight_kg;
  const machine = roll.machine_name || roll.machine_id || '—';
  const date = roll.closed_at || roll.approved_at || roll.created_at;
  const qr = roll.qr_image
    ? `<div class="qr"><img src="${roll.qr_image}" alt="QR"/></div>`
    : `<div class="qrbox">No QR<br/>${esc(roll.roll_id)}</div>`;
  return `
    <div class="label">
      <div class="mill">${MILL}</div>
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

function batchLabelHTML(batch) {
  return `
    <div class="label">
      <div class="mill">${MILL}</div>
      <div class="kind">Batch / Lot Label</div>
      <div class="body">
        <div class="info">
          <div class="id">${esc(batch.batch_number)}</div>
          <div class="row"><b>Fabric</b>${esc(batch.fabric_type || '—')}</div>
          <div class="row"><b>Colour</b>${esc(batch.color_name || '—')}</div>
          <div class="row"><b>Rolls</b>${batch.roll_count ?? (batch.rolls ? batch.rolls.length : '—')}</div>
          <div class="row"><b>Total Wt</b>${fmtKg(batch.total_weight_kg)}</div>
        </div>
        <div class="qrbox">LOT<br/>${esc(batch.batch_number)}</div>
      </div>
      <div class="foot">Paste on each roll of this lot · ${MILL}</div>
    </div>`;
}

export function printRollLabel(roll) {
  openPrint(`Roll Label ${roll.roll_id}`, rollLabelHTML(roll));
}

// Prints one batch label per roll in the lot (so each roll gets its own sticker).
export function printBatchLabels(batch) {
  const copies = batch.roll_count || (batch.rolls ? batch.rolls.length : 1) || 1;
  const one = batchLabelHTML(batch);
  openPrint(`Batch Labels ${batch.batch_number}`, one.repeat(copies));
}

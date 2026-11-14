import React, { useEffect, useState, useCallback } from "react";

// Knitting Structure Library — machine "recipe" per fabric structure.
// Ported into MES from the standalone library; tied to fabric_types + GSM.
const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });

const CAM = { K: { bg: "var(--surface)", bd: "var(--link)", fg: "var(--link)" }, T: { bg: "var(--gold-dim)", bd: "var(--gold)", fg: "var(--gold)" }, M: { bg: "var(--surface)", bd: "var(--border)", fg: "var(--muted)" } };
const CAM_NEXT = { K: "T", T: "M", M: "K" };
const TRACKC = [null, { bg: "var(--green-dim)", bd: "var(--green)", fg: "var(--green-edge)" }, { bg: "var(--gold-dim)", bd: "var(--gold)", fg: "var(--gold)" }, { bg: "var(--crit-dim)", bd: "var(--pink)", fg: "var(--pink)" }, { bg: "var(--surface)", bd: "var(--link)", fg: "var(--link)" }];

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 13, boxSizing: "border-box", marginBottom: 8 };
const lbl = { color: "var(--muted)", fontSize: 11, fontWeight: 600, marginBottom: 3, display: "block" };
const Cell = ({ c, s, onClick }) => (
  <div onClick={onClick} style={{ width: 32, height: 32, border: `1px solid ${s.bd}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: s.bg, color: s.fg, fontSize: 11, fontWeight: 700, cursor: onClick ? "pointer" : "default", flexShrink: 0, userSelect: "none" }}>{c}</div>
);

// build cam track keys from track counts.
// Double Jersey convention: DIAL tracks on top, CYLINDER tracks below.
const camKeys = (cyl, dial, mtype) => {
  const keys = [];
  if (mtype === "DJ") for (let i = 1; i <= (dial || 0); i++) keys.push(`Dial T${i}`);
  for (let i = 1; i <= (cyl || 0); i++) keys.push(`Cylinder T${i}`);
  return keys;
};
// order keys for display: Dial rows above Cylinder rows (stable within each bed)
const dialAboveCyl = (keys) => [...keys].sort((a, b) => (a.startsWith("Dial") ? 0 : 1) - (b.startsWith("Dial") ? 0 : 1));
const emptyForm = () => ({ structure_name: "", machine_type: "SJ", fabric_code: "", gsm: "", category: "", cylinder_tracks: 2, dial_tracks: 0, feed_repeat: 4, needle_repeat: 2, description: "", yarns: [], feeder_data: [], cam_data: {}, needle_data: { Cylinder: [], Dial: [] }, images: [] });

// Read picked image files into compressed data-URLs (max 900px, JPEG) so they
// fit comfortably in the images[] jsonb column without a file-storage backend.
const readImages = (files) => Promise.all(Array.from(files).map(file => new Promise((resolve) => {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 900, scale = Math.min(1, max / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
      const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
      resolve({ name: file.name, data: cv.toDataURL("image/jpeg", 0.82) });
    };
    img.onerror = () => resolve(null);
    img.src = fr.result;
  };
  fr.onerror = () => resolve(null);
  fr.readAsDataURL(file);
}))).then(arr => arr.filter(Boolean));

// Build a printable HTML doc for a structure and open the browser print dialog
// (Save as PDF). No external library — light theme for clean paper output.
const exportStructurePDF = (d) => {
  const camC = { K: "#dbeafe", T: "#fef3c7", M: "#f1f5f9" };
  const trackC = ["#fff", "#dcfce7", "#fef3c7", "#fce7f3", "#dbeafe"];
  const camKeysOrdered = dialAboveCyl(Object.keys(d.cam_data || {}).filter(k => (d.cam_data[k] || []).length));
  const needleKeys = dialAboveCyl(Object.keys(d.needle_data || {}).filter(k => (d.needle_data[k] || []).length));
  const matrix = (title, keys, dataObj, isNeedle) => keys.length ? `
    <h3>${title}</h3>
    <table class="mx">${keys.map(k => `<tr><th>${k}</th>${(dataObj[k] || []).map(c =>
      `<td style="background:${isNeedle ? (trackC[c] || trackC[1]) : (camC[c] || camC.M)}">${c}</td>`).join("")}</tr>`).join("")}</table>` : "";
  const yarns = (d.yarns || []).length ? `<h3>Yarns</h3><table class="tb"><tr><th>#</th><th>Yarn</th><th>Count</th><th>Description</th></tr>${d.yarns.map((y, i) => `<tr><td>${y.yarnNumber || i + 1}</td><td>${y.yarnName || ""}</td><td>${y.count || ""}</td><td>${y.description || ""}</td></tr>`).join("")}</table>` : "";
  const feeder = (d.feeder_data || []).length ? `<h3>Feeder Setout</h3><table class="tb"><tr><th>Feed</th><th>Yarn</th><th>Stitch Len</th><th>Remarks</th></tr>${d.feeder_data.map((f, i) => `<tr><td>${i + 1}</td><td>${f.yarnRef || ""}</td><td>${f.stitchLength || ""}</td><td>${f.remarks || ""}</td></tr>`).join("")}</table>` : "";
  const imgs = (d.images || []).length ? `<h3>Reference Images</h3><div class="imgs">${d.images.map(im => `<img src="${im.data || im}" />`).join("")}</div>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${d.structure_name}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;max-width:820px;margin:auto}
      h1{color:var(--idle);margin:0 0 4px;font-size:22px}.sub{color:#555;font-size:13px;margin-bottom:14px}
      h3{color:var(--idle);font-size:14px;margin:18px 0 6px;border-bottom:1px solid #eee;padding-bottom:3px}
      .meta{font-size:12px;color:#333;margin-bottom:8px}.meta b{color:#000}
      table{border-collapse:collapse;font-size:12px}.tb{width:100%}.tb th,.tb td{border:1px solid #ddd;padding:4px 8px;text-align:left}.tb th{background:#f8fafc}
      .mx th{width:110px;text-align:left;font-size:11px;color:var(--surface-2);padding-right:8px}
      .mx td{width:26px;height:26px;text-align:center;border:1px solid var(--muted);font-weight:700;font-size:11px}
      .imgs{display:flex;flex-wrap:wrap;gap:8px}.imgs img{max-width:240px;max-height:240px;border:1px solid #ddd;border-radius:4px}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>${d.structure_name}</h1>
    <div class="sub">${d.machine_type} · ${d.category || "—"} · Fabric ${d.fabric_name || d.fabric_code || "—"} · GSM ${d.gsm ?? "—"}</div>
    ${d.description ? `<div class="meta">${d.description}</div>` : ""}
    <div class="meta">Cylinder tracks: <b>${d.cylinder_tracks}</b>${d.machine_type === "DJ" ? ` &nbsp; Dial tracks: <b>${d.dial_tracks}</b>` : ""} &nbsp; Feed repeat: <b>${d.feed_repeat}</b> &nbsp; Needle repeat: <b>${d.needle_repeat}</b></div>
    ${yarns}${feeder}
    ${matrix("Cam Arrangement (K = Knit · T = Tuck · M = Miss)", camKeysOrdered, d.cam_data, false)}
    ${matrix("Needle Setout (track number)", needleKeys, d.needle_data, true)}
    ${imgs}
    <script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script>
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to export the PDF."); return; }
  w.document.write(html); w.document.close();
};

export default function KnittingLibrary() {
  const [list, setList] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [machines, setMachines] = useState([]);
  const [mFilter, setMFilter] = useState("");
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);   // null = closed; object = create/edit
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch(`${API}/api/knitting-structures${mFilter ? `?machine_type=${mFilter}` : ""}`, { headers: h() }); setList(await r.json()); } catch {}
  }, [mFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch(`${API}/api/fabric-types`, { headers: h() }).then(r => r.json()).then(d => setFabrics(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => { fetch(`${API}/api/machines`, { headers: h() }).then(r => r.json()).then(d => setMachines(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const openDetail = async (id) => { try { const r = await fetch(`${API}/api/knitting-structures/${id}`, { headers: h() }); setDetail(await r.json()); } catch {} };
  const toggleFav = async (s, e) => { e.stopPropagation(); await fetch(`${API}/api/knitting-structures/${s.id}/favourite`, { method: "PATCH", headers: h(), body: JSON.stringify({ is_favourite: !s.is_favourite }) }); load(); };

  const openNew = () => setForm(emptyForm());
  const openEdit = (s) => { setForm({ ...emptyForm(), ...s, gsm: s.gsm ?? "", fabric_code: s.fabric_code || "" }); setDetail(null); };

  // regenerate cam/needle grids to match current track/feed/needle counts
  const syncGrids = (f) => {
    const keys = camKeys(f.cylinder_tracks, f.dial_tracks, f.machine_type);
    const cam = {};
    keys.forEach(k => { const prev = f.cam_data[k] || []; cam[k] = Array.from({ length: f.feed_repeat || 0 }, (_, i) => prev[i] || "K"); });
    const fill = (arr, len, max) => Array.from({ length: len || 0 }, (_, i) => (arr && arr[i]) || 1);
    const needle = { Cylinder: fill(f.needle_data.Cylinder, f.needle_repeat, f.cylinder_tracks), Dial: f.machine_type === "DJ" ? fill(f.needle_data.Dial, f.needle_repeat, f.dial_tracks) : [] };
    const feeder = Array.from({ length: f.feed_repeat || 0 }, (_, i) => (f.feeder_data && f.feeder_data[i]) || { yarnRef: `Y${(i % Math.max(1, f.yarns.length || 1)) + 1}`, stitchLength: "", remarks: "" });
    return { ...f, cam_data: cam, needle_data: needle, feeder_data: feeder };
  };
  const setF = (patch) => setForm(f => syncGrids({ ...f, ...patch }));

  const save = async () => {
    if (!form.structure_name) { alert("Structure name required"); return; }
    setSaving(true);
    const body = syncGrids(form);
    const editing = !!form.id;
    const url = editing ? `${API}/api/knitting-structures/${form.id}` : `${API}/api/knitting-structures`;
    try {
      const r = await fetch(url, { method: editing ? "PUT" : "POST", headers: h(), body: JSON.stringify({ ...body, gsm: body.gsm === "" ? null : body.gsm }) });
      if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); setSaving(false); return; }
      setForm(null); load();
    } catch { alert("Network error"); }
    setSaving(false);
  };
  const del = async (id) => { if (!window.confirm("Delete this structure?")) return; await fetch(`${API}/api/knitting-structures/${id}`, { method: "DELETE", headers: h() }); setDetail(null); load(); };

  return (
    <div style={{ padding: 20, color: "var(--text)", minHeight: "100vh", fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--yellow)", fontSize: 24 }}>Knitting Library</h2>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Machine settings (cam / needle / yarn) per fabric structure</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["", "SJ", "DJ"].map(m => (
            <button key={m || "all"} onClick={() => setMFilter(m)} style={{ background: mFilter === m ? "var(--yellow)" : "var(--surface)", color: mFilter === m ? "#000" : "var(--muted)", border: "1px solid var(--border)", padding: "8px 14px", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>{m || "All"}</button>
          ))}
          <button onClick={openNew} style={{ background: "var(--green)", color: "var(--bg)", border: "none", padding: "8px 18px", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>+ New Structure</button>
        </div>
      </div>

      {list.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            { label: "Structures", value: list.length, c: "var(--text)" },
            { label: "Single Jersey", value: list.filter(s => s.machine_type === "SJ").length, c: "var(--link)" },
            { label: "Double Jersey", value: list.filter(s => s.machine_type === "DJ").length, c: "var(--pink)" },
            { label: "Fabrics covered", value: new Set(list.map(s => s.fabric_code).filter(Boolean)).size, c: "var(--link)" },
            { label: "Favourites", value: list.filter(s => s.is_favourite).length, c: "var(--yellow)" },
          ].map(t => (
            <div key={t.label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: t.c }}>{t.value}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 50 }}>No structures yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {list.map(s => (
            <div key={s.id} onClick={() => openDetail(s.id)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{s.structure_name}</div>
                <span onClick={(e) => toggleFav(s, e)} style={{ cursor: "pointer", fontSize: 18, color: s.is_favourite ? "var(--yellow)" : "var(--surface)" }}>★</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ background: s.machine_type === "SJ" ? "var(--surface)" : "var(--crit-dim)", color: s.machine_type === "SJ" ? "var(--link)" : "var(--pink)", border: `1px solid ${s.machine_type === "SJ" ? "var(--link)" : "var(--pink)"}`, borderRadius: 10, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{s.machine_type}</span>
                {s.category && <span style={{ color: "var(--muted)", fontSize: 11, padding: "2px 0" }}>{s.category}</span>}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>Fabric: <b style={{ color: "var(--link)" }}>{s.fabric_name || s.fabric_code || "—"}</b></span>
                <span>GSM: <b style={{ color: "var(--yellow)" }}>{s.gsm ?? "—"}</b></span>
              </div>
              <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 6 }}>Feeds {s.feed_repeat} · Needle rep {s.needle_repeat} · Cyl {s.cylinder_tracks}{s.machine_type === "DJ" ? ` · Dial ${s.dial_tracks}` : ""}</div>
            </div>
          ))}
        </div>
      )}

      {detail && <DetailModal d={detail} fabrics={fabrics} machines={machines} onEdit={() => openEdit(detail)} onDelete={() => del(detail.id)} onClose={() => setDetail(null)} />}
      {form && <FormModal form={form} setForm={setForm} setF={setF} fabrics={fabrics} saving={saving} onSave={save} onClose={() => setForm(null)} />}
    </div>
  );
}

function Matrix({ title, data, needle }) {
  const keys = dialAboveCyl(Object.keys(data || {}).filter(k => (data[k] || []).length));
  if (!keys.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: "var(--yellow)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {keys.map(k => (
        <div key={k} style={{ display: "flex", gap: 4, marginBottom: 5, alignItems: "center" }}>
          <strong style={{ width: 100, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{k}</strong>
          {(data[k] || []).map((c, i) => needle ? <Cell key={i} c={c} s={TRACKC[c] || TRACKC[1]} /> : <Cell key={i} c={c} s={CAM[c] || CAM.M} />)}
        </div>
      ))}
    </div>
  );
}

function DetailModal({ d, machines = [], onEdit, onDelete, onClose }) {
  const [lightbox, setLightbox] = useState(null);
  // Structure ties to machines via the fabric_code set in each machine's config (Settings).
  const boundMachines = d.fabric_code
    ? machines.filter(m => m.fabric_code === d.fabric_code && m.active !== false)
    : [];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
      <div style={{ background: "var(--bg)", border: "1px solid var(--gold)", borderRadius: 12, width: "min(96vw, 760px)", padding: 24, margin: "20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h3 style={{ color: "var(--yellow)", margin: 0, fontSize: 20 }}>{d.structure_name}</h3>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>{d.machine_type} · {d.category || "—"} · Fabric {d.fabric_name || d.fabric_code || "—"} · GSM {d.gsm ?? "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => exportStructurePDF(d)} style={{ background: "var(--surface)", color: "var(--green)", border: "1px solid var(--green-dim)", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>⬇ PDF</button>
            <button onClick={onEdit} style={{ background: "var(--surface)", color: "var(--yellow)", border: "1px solid var(--crit-dim)", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>Edit</button>
            <button onClick={onDelete} style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>🗑</button>
            <button onClick={onClose} style={{ background: "var(--border)", color: "var(--text)", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>Close</button>
          </div>
        </div>
        {d.description && <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>{d.description}</div>}

        {d.fabric_code && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ color: "var(--muted)", fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
              RUNS ON MACHINES <span style={{ color: "var(--muted)", fontWeight: 400 }}>(configured for fabric {d.fabric_name || d.fabric_code})</span>
            </div>
            {boundMachines.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {boundMachines.map(m => (
                  <a key={m.machine_id} href={`/machine/${m.machine_id}`}
                    style={{ background: "var(--surface)", color: "var(--link)", border: "1px solid var(--link)", borderRadius: 8, padding: "3px 10px", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                    {m.machine_name || m.machine_id}
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>No active machine is configured for this fabric yet (set it in Settings → machine config).</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", color: "var(--muted)", fontSize: 12, marginBottom: 16 }}>
          <span>Cylinder tracks: <b style={{ color: "var(--text)" }}>{d.cylinder_tracks}</b></span>
          {d.machine_type === "DJ" && <span>Dial tracks: <b style={{ color: "var(--text)" }}>{d.dial_tracks}</b></span>}
          <span>Feed repeat: <b style={{ color: "var(--text)" }}>{d.feed_repeat}</b></span>
          <span>Needle repeat: <b style={{ color: "var(--text)" }}>{d.needle_repeat}</b></span>
        </div>

        {(d.yarns || []).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--yellow)", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Yarns</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}>{["#", "Yarn", "Count", "Description"].map(c => <th key={c} style={{ padding: "4px 8px" }}>{c}</th>)}</tr></thead>
              <tbody>{d.yarns.map((y, i) => <tr key={i} style={{ borderTop: "1px solid var(--surface)" }}><td style={{ padding: "4px 8px" }}>{y.yarnNumber || i + 1}</td><td style={{ padding: "4px 8px" }}>{y.yarnName}</td><td style={{ padding: "4px 8px", color: "var(--muted)" }}>{y.count}</td><td style={{ padding: "4px 8px", color: "var(--muted)" }}>{y.description}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        {(d.feeder_data || []).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--yellow)", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Feeder Setout</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ color: "var(--muted)", textAlign: "left" }}>{["Feed", "Yarn", "Stitch Len", "Remarks"].map(c => <th key={c} style={{ padding: "4px 8px" }}>{c}</th>)}</tr></thead>
              <tbody>{d.feeder_data.map((f, i) => <tr key={i} style={{ borderTop: "1px solid var(--surface)" }}><td style={{ padding: "4px 8px" }}>{i + 1}</td><td style={{ padding: "4px 8px" }}>{f.yarnRef}</td><td style={{ padding: "4px 8px", color: "var(--muted)" }}>{f.stitchLength}</td><td style={{ padding: "4px 8px", color: "var(--muted)" }}>{f.remarks}</td></tr>)}</tbody>
            </table>
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <Matrix title="Cam Arrangement (K = Knit · T = Tuck · M = Miss)" data={d.cam_data} />
          <Matrix title="Needle Setout (track number)" data={d.needle_data} needle />
        </div>

        {(d.images || []).length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: "var(--yellow)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Reference Images</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {d.images.map((im, i) => (
                <img key={i} src={im.data || im} alt={im.name || `img-${i}`} onClick={() => setLightbox(im.data || im)}
                  style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", cursor: "zoom-in" }} />
              ))}
            </div>
          </div>
        )}
      </div>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 1002, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox} alt="preview" style={{ maxWidth: "94vw", maxHeight: "94vh", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}

function FormModal({ form, setForm, setF, fabrics, saving, onSave, onClose }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cam = form.cam_data || {};
  const needle = form.needle_data || { Cylinder: [], Dial: [] };
  const cycleCam = (key, i) => { const arr = [...(cam[key] || [])]; arr[i] = CAM_NEXT[arr[i]] || "K"; setForm(f => ({ ...f, cam_data: { ...f.cam_data, [key]: arr } })); };
  const cycleNeedle = (bed, i, max) => { const arr = [...(needle[bed] || [])]; arr[i] = arr[i] >= max ? 1 : (arr[i] || 1) + 1; setForm(f => ({ ...f, needle_data: { ...f.needle_data, [bed]: arr } })); };
  const setFeed = (i, k, v) => { const fd = [...(form.feeder_data || [])]; fd[i] = { ...fd[i], [k]: v }; setForm(f => ({ ...f, feeder_data: fd })); };
  const addYarn = () => setForm(f => ({ ...f, yarns: [...(f.yarns || []), { yarnNumber: (f.yarns?.length || 0) + 1, yarnName: "", count: "", description: "" }] }));
  const setYarn = (i, k, v) => { const y = [...form.yarns]; y[i] = { ...y[i], [k]: v }; setForm(f => ({ ...f, yarns: y })); };
  const rmYarn = (i) => setForm(f => ({ ...f, yarns: f.yarns.filter((_, j) => j !== i) }));
  const addImages = async (e) => { const imgs = await readImages(e.target.files); e.target.value = ""; setForm(f => ({ ...f, images: [...(f.images || []), ...imgs] })); };
  const rmImage = (i) => setForm(f => ({ ...f, images: (f.images || []).filter((_, j) => j !== i) }));
  // ensure grids exist on first open
  useEffect(() => { setF({}); }, []); // eslint-disable-line

  const camK = dialAboveCyl(Object.keys(cam));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1001, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, overflowY: "auto" }}>
      <div style={{ background: "var(--bg)", border: "1px solid var(--green)", borderRadius: 12, width: "min(96vw, 780px)", padding: 24, margin: "20px 0" }}>
        <h3 style={{ color: "var(--green)", margin: "0 0 14px" }}>{form.id ? "Edit Structure" : "New Structure"}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Structure Name *</label><input style={inp} value={form.structure_name} onChange={e => set("structure_name", e.target.value)} /></div>
          <div><label style={lbl}>Machine Type</label><select style={inp} value={form.machine_type} onChange={e => setF({ machine_type: e.target.value })}><option value="SJ">SJ (Single Jersey)</option><option value="DJ">DJ (Double Jersey)</option></select></div>
          <div><label style={lbl}>Category</label><input style={inp} value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Fleece / Pique" /></div>
          <div><label style={lbl}>Fabric Type</label><select style={inp} value={form.fabric_code} onChange={e => set("fabric_code", e.target.value)}><option value="">— none —</option>{fabrics.map(ft => <option key={ft.code} value={ft.code}>{ft.code} - {ft.name}</option>)}</select></div>
          <div><label style={lbl}>GSM</label><input style={inp} type="number" step="0.1" value={form.gsm} onChange={e => set("gsm", e.target.value)} /></div>
          <div><label style={lbl}>Cylinder Tracks</label><input style={inp} type="number" value={form.cylinder_tracks} onChange={e => setF({ cylinder_tracks: parseInt(e.target.value) || 0 })} /></div>
          {form.machine_type === "DJ" && <div><label style={lbl}>Dial Tracks</label><input style={inp} type="number" value={form.dial_tracks} onChange={e => setF({ dial_tracks: parseInt(e.target.value) || 0 })} /></div>}
          <div><label style={lbl}>Feed Repeat</label><input style={inp} type="number" value={form.feed_repeat} onChange={e => setF({ feed_repeat: parseInt(e.target.value) || 0 })} /></div>
          <div><label style={lbl}>Needle Repeat</label><input style={inp} type="number" value={form.needle_repeat} onChange={e => setF({ needle_repeat: parseInt(e.target.value) || 0 })} /></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Description</label><textarea style={{ ...inp, minHeight: 44 }} value={form.description} onChange={e => set("description", e.target.value)} /></div>
        </div>

        {/* Yarns */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={lbl}>Yarns</label>
            <button onClick={addYarn} style={{ background: "var(--border)", color: "var(--muted)", border: "none", borderRadius: 5, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>+ Yarn</button>
          </div>
          {(form.yarns || []).map((y, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input style={{ ...inp, marginBottom: 0, width: 50 }} value={y.yarnNumber} onChange={e => setYarn(i, "yarnNumber", e.target.value)} />
              <input style={{ ...inp, marginBottom: 0 }} placeholder="Yarn name" value={y.yarnName} onChange={e => setYarn(i, "yarnName", e.target.value)} />
              <input style={{ ...inp, marginBottom: 0, width: 90 }} placeholder="Count" value={y.count} onChange={e => setYarn(i, "count", e.target.value)} />
              <button onClick={() => rmYarn(i)} style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", borderRadius: 5, padding: "0 10px", cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>

        {/* Images */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={lbl}>Reference Images</label>
            <label style={{ background: "var(--border)", color: "var(--muted)", borderRadius: 5, padding: "4px 12px", cursor: "pointer", fontSize: 12 }}>
              + Image<input type="file" accept="image/*" multiple onChange={addImages} style={{ display: "none" }} />
            </label>
          </div>
          {(form.images || []).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {form.images.map((im, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={im.data || im} alt={im.name || `img-${i}`} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                  <button onClick={() => rmImage(i)} style={{ position: "absolute", top: -6, right: -6, background: "var(--crit-dim)", color: "var(--text)", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: 11, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feeder */}
        {(form.feeder_data || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label style={lbl}>Feeder Setout (per feed)</label>
            {form.feeder_data.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <span style={{ color: "var(--muted)", fontSize: 12, width: 40 }}>F{i + 1}</span>
                <input style={{ ...inp, marginBottom: 0, width: 80 }} placeholder="Yarn" value={f.yarnRef || ""} onChange={e => setFeed(i, "yarnRef", e.target.value)} />
                <input style={{ ...inp, marginBottom: 0, width: 100 }} placeholder="Stitch len" value={f.stitchLength || ""} onChange={e => setFeed(i, "stitchLength", e.target.value)} />
                <input style={{ ...inp, marginBottom: 0 }} placeholder="Remarks" value={f.remarks || ""} onChange={e => setFeed(i, "remarks", e.target.value)} />
              </div>
            ))}
          </div>
        )}

        {/* Cam matrix editor */}
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <label style={lbl}>Cam Arrangement — click cells to cycle K → T → M</label>
          {camK.map(key => (
            <div key={key} style={{ display: "flex", gap: 4, marginBottom: 5, alignItems: "center" }}>
              <strong style={{ width: 100, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{key}</strong>
              {(cam[key] || []).map((c, i) => <Cell key={i} c={c} s={CAM[c] || CAM.M} onClick={() => cycleCam(key, i)} />)}
            </div>
          ))}
        </div>

        {/* Needle matrix editor */}
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <label style={lbl}>Needle Setout — click to cycle track</label>
          {(form.machine_type === "DJ" ? ["Dial", "Cylinder"] : ["Cylinder"]).map(bed => (
            <div key={bed} style={{ display: "flex", gap: 4, marginBottom: 5, alignItems: "center" }}>
              <strong style={{ width: 100, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{bed}</strong>
              {(needle[bed] || []).map((c, i) => <Cell key={i} c={c} s={TRACKC[c] || TRACKC[1]} onClick={() => cycleNeedle(bed, i, bed === "Cylinder" ? form.cylinder_tracks : form.dial_tracks)} />)}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onSave} disabled={saving} style={{ flex: 1, background: "var(--green)", color: "var(--bg)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>{saving ? "Saving…" : "Save Structure"}</button>
          <button onClick={onClose} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

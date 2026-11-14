// Vessel master (spec §9) + honest position map (last verified location only).
//
// The map plots ONLY positions that exist as real tracking events (manual or
// provider). Nothing is interpolated or guessed — an import with no recorded
// coordinate simply does not appear. Region labels are static map orientation
// aids, not vessel data.

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import worldLand from "../data/world-land.json";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}`, "Content-Type": "application/json" });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").replace(/\//g, "-") : "—");
const dt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : "—");

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", whiteSpace: "nowrap" };
const inp = { width: "100%", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "7px 15px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" });

// Parse pasted CSV/TSV of vessels into row objects. First line must be a header;
// recognised columns (any order, case/space-insensitive): vessel_name (or "name"/
// "vessel"), imo_number ("imo"), mmsi, call_sign, flag, vessel_type ("type"),
// operator, gross_tonnage ("gt"), built_year ("built"/"year"), remarks.
const VESSEL_ALIASES = {
  vessel_name: "vessel_name", name: "vessel_name", vessel: "vessel_name", vesselname: "vessel_name",
  imo_number: "imo_number", imo: "imo_number", imonumber: "imo_number",
  mmsi: "mmsi", call_sign: "call_sign", callsign: "call_sign", sign: "call_sign",
  flag: "flag", vessel_type: "vessel_type", type: "vessel_type",
  operator: "operator", gross_tonnage: "gross_tonnage", gt: "gross_tonnage", tonnage: "gross_tonnage",
  built_year: "built_year", built: "built_year", year: "built_year", remarks: "remarks", notes: "remarks",
};
function splitLine(line, delim) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
function parseVesselCSV(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/\t/) ? "\t" : ",");
  const header = splitLine(lines[0], delim).map((h) => VESSEL_ALIASES[h.toLowerCase().replace(/[\s-]+/g, "_")] || VESSEL_ALIASES[h.toLowerCase().replace(/[\s_-]+/g, "")] || null);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const o = {};
    header.forEach((key, idx) => { if (key && cells[idx] != null && cells[idx] !== "") o[key] = cells[idx]; });
    if (o.vessel_name || o.imo_number) rows.push(o);
  }
  return rows;
}

// Equirectangular projection into a WxH box.
const W = 960, H = 480;
const px = (lon) => ((Number(lon) + 180) / 360) * W;
const py = (lat) => ((90 - Number(lat)) / 180) * H;
// World landmass drawn in the SAME equirectangular projection so it aligns with the
// plotted positions. Precomputed once from Natural Earth 110m land.
const LAND_PATHS = (worldLand.features || []).map((f) => {
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  return polys.map((rings) => rings.map((ring) =>
    "M" + ring.map(([lo, la]) => `${px(lo).toFixed(1)},${py(la).toFixed(1)}`).join("L") + "Z"
  ).join(" ")).join(" ");
});
const REGIONS = [ // orientation labels only — not vessel data
  ["India", 79, 22], ["China", 104, 35], ["Singapore", 104, 1.3], ["Suez", 32, 30],
  ["Rotterdam", 4, 52], ["Shanghai", 121, 31], ["Dubai", 55, 25], ["Mundra", 69.7, 22.8],
];

export default function ImportVessels() {
  const nav = useNavigate();
  const [vessels, setVessels] = useState([]);
  const [positions, setPositions] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // null | {} (new) | vessel (edit)
  const [err, setErr] = useState("");
  const [bulk, setBulk] = useState(null);   // null | { text } bulk-import modal
  const [bulkResult, setBulkResult] = useState(null);

  const [syncing, setSyncing] = useState(false);
  const load = useCallback(async () => {
    try {
      const [v, p] = await Promise.all([
        fetch(`${API}/api/imports/vessels?search=${encodeURIComponent(search)}`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/imports/map/positions`, { headers: auth() }).then(r => r.json()),
      ]);
      setVessels(Array.isArray(v) ? v : []);
      setPositions(Array.isArray(p) ? p : []);
    } catch (e) { setErr(e.message); }
  }, [search]);

  // Pull fresh positions for every active import from the tracking provider, then reload.
  const refreshTracking = async () => {
    setSyncing(true); setErr("");
    try {
      const r = await fetch(`${API}/api/imports/tracking/sync-all`, { method: "POST", headers: auth() });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Refresh failed");
      else if (j.skipped) setErr(j.reason || "No tracking provider configured.");
      else setErr("");
      await load();
    } catch (e) { setErr(e.message); }
    setSyncing(false);
  };
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setErr("");
    const isEdit = modal.vessel_id;
    const r = await fetch(`${API}/api/imports/vessels${isEdit ? "/" + modal.vessel_id : ""}`, {
      method: isEdit ? "PATCH" : "POST", headers: auth(), body: JSON.stringify(modal),
    });
    const out = await r.json();
    if (!r.ok) return setErr(out.error || "Save failed");
    setModal(null); load();
  };
  const del = async (v) => {
    if (!window.confirm(`Delete vessel "${v.vessel_name}"?`)) return;
    const r = await fetch(`${API}/api/imports/vessels/${v.vessel_id}`, { method: "DELETE", headers: auth() });
    const out = await r.json(); if (!r.ok) return setErr(out.error || "Delete failed"); load();
  };
  const runBulk = async () => {
    setErr(""); setBulkResult(null);
    const rows = parseVesselCSV(bulk?.text || "");
    if (!rows.length) return setErr("No rows found. Include a header row and at least one vessel.");
    const r = await fetch(`${API}/api/imports/vessels/bulk`, { method: "POST", headers: auth(), body: JSON.stringify({ rows }) });
    const out = await r.json();
    if (!r.ok) return setErr(out.error || "Bulk import failed");
    setBulkResult(out); load();
  };

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>🚢 Vessels & Position Map</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={refreshTracking} disabled={syncing} title="Pull fresh vessel positions (AIS) and container/BL carrier milestones for every active import" style={{ ...btn("var(--bg)", "var(--text)"), opacity: syncing ? 0.5 : 1 }}>{syncing ? "Refreshing…" : "🔄 Refresh tracking (vessels + containers)"}</button>
          <button onClick={() => { setBulk({ text: "" }); setBulkResult(null); setErr(""); }} style={btn("var(--bg)", "var(--text)")}>⇪ Bulk import</button>
          <button onClick={() => setModal({})} style={btn("var(--yellow)", "#000")}>+ Add vessel</button>
        </div>
      </div>
      {err && <div style={{ color: "var(--crit)", fontSize: 13 }}>{err}</div>}

      {/* Map — last verified positions only */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={label}>Last verified positions · {positions.length} import(s)</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Real fixes from tracking events; ships at sea without a fresh fix show an auto-estimated position (labeled).</div>
        </div>
        {!positions.length ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
            No verified positions yet. Add a tracking event with coordinates (Import → Timeline → manual entry) or configure a tracking provider.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 640, background: "var(--surface)", borderRadius: 8, display: "block" }}>
              {/* landmasses (equirectangular, aligned to the plotted positions) */}
              {LAND_PATHS.map((d, i) => <path key={"land" + i} d={d} fill="var(--green-dim)" stroke="#6b8f73" strokeWidth="0.5" />)}
              {/* graticule */}
              {[...Array(13)].map((_, i) => <line key={"v" + i} x1={i * W / 12} y1={0} x2={i * W / 12} y2={H} stroke="#ffffff" strokeWidth="0.4" opacity="0.08" />)}
              {[...Array(7)].map((_, i) => <line key={"h" + i} x1={0} y1={i * H / 6} x2={W} y2={i * H / 6} stroke="#ffffff" strokeWidth="0.4" opacity="0.08" />)}
              <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="4 4" opacity="0.5" />
              {REGIONS.map(([n, lo, la]) => <text key={n} x={px(lo)} y={py(la)} fontSize="10" fill="var(--muted)" opacity="0.6" textAnchor="middle">{n}</text>)}
              {/* vessel/import positions */}
              {positions.map((p) => (
                <g key={p.import_id} transform={`translate(${px(p.longitude)},${py(p.latitude)})`}>
                  <circle r="6" fill={p.estimated ? "var(--gold)" : p.is_external ? "var(--green)" : "var(--yellow)"} stroke="#000" strokeWidth="0.7"
                          strokeDasharray={p.estimated ? "2 1.5" : undefined} opacity="0.9" />
                  <text x="9" y="4" fontSize="11" fill="var(--text)" fontWeight="600">{p.import_no}{p.estimated ? " ~" : ""}</text>
                  <title>{`${p.import_no} · ${p.material || ""}\n${p.vessel_name || "no vessel"}\n${p.location || ""} (${p.latitude}, ${p.longitude})\n${p.estimated ? "AUTO-ESTIMATE (not a real fix)" : p.is_external ? p.source : "manual entry"} · ${dt(p.position_time)}`}</title>
                </g>
              ))}
            </svg>
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
              <span><span style={{ color: "var(--green)" }}>●</span> external (provider/AIS)</span>
              <span><span style={{ color: "var(--yellow)" }}>●</span> manual entry</span>
              <span><span style={{ color: "var(--gold)" }}>●</span> auto-estimated (en route, no fresh fix)</span>
            </div>
          </div>
        )}
      </div>

      {/* Position table */}
      {positions.length > 0 && (
        <div style={{ ...card, overflowX: "auto" }}>
          <div style={{ ...label, marginBottom: 10 }}>Positions detail</div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead><tr>{["Import", "Material", "Vessel", "Location", "Lat", "Lon", "Source", "As of", "ETA"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.import_id} style={{ cursor: "pointer" }} onClick={() => nav(`/imports/${p.import_id}`)}>
                  <td style={{ ...td, color: "var(--yellow)" }}>{p.import_no}</td>
                  <td style={td}>{p.material || "—"}</td><td style={td}>{p.vessel_name || "—"}</td>
                  <td style={td}>{p.location || "—"}</td><td style={td}>{p.latitude}</td><td style={td}>{p.longitude}</td>
                  <td style={td}>{p.estimated ? <span style={{ color: "var(--gold)" }}>auto-estimate{p.est_progress != null ? ` · ${p.est_progress}%` : ""}</span> : p.is_external ? (p.provider || p.source) : "manual"}</td>
                  <td style={td}>{dt(p.position_time)}</td><td style={td}>{day(p.current_eta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Vessel master */}
      <div style={{ ...card, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10 }}>
          <div style={label}>Vessel master · {vessels.length}</div>
          <input placeholder="Search name / IMO / operator…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, width: 260 }} />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead><tr>{["Vessel", "IMO", "MMSI", "Flag", "Type", "Operator", "GT", "Built", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {!vessels.length && <tr><td colSpan={9} style={{ ...td, color: "var(--muted)" }}>No vessels yet.</td></tr>}
            {vessels.map(v => (
              <tr key={v.vessel_id}>
                <td style={{ ...td, fontWeight: 600 }}>{v.vessel_name}</td>
                <td style={td}>{v.imo_number || "—"}</td><td style={td}>{v.mmsi || "—"}</td>
                <td style={td}>{v.flag || "—"}</td><td style={td}>{v.vessel_type || "—"}</td>
                <td style={td}>{v.operator || "—"}</td><td style={td}>{v.gross_tonnage > 0 ? v.gross_tonnage : "—"}</td>
                <td style={td}>{v.built_year || "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button onClick={() => setModal(v)} style={{ ...btn("var(--bg)", "var(--text)"), padding: "4px 10px", marginRight: 6 }}>Edit</button>
                  <button onClick={() => del(v)} style={{ ...btn("var(--bg)", "var(--crit)"), padding: "4px 10px" }}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setModal(null)}>
          <div style={{ ...card, width: 520, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{modal.vessel_id ? "Edit vessel" : "Add vessel"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[["vessel_name", "Vessel name *"], ["imo_number", "IMO number"], ["mmsi", "MMSI"], ["call_sign", "Call sign"], ["flag", "Flag"], ["vessel_type", "Type"], ["operator", "Operator"], ["gross_tonnage", "Gross tonnage"], ["built_year", "Built year"]].map(([k, lb]) => (
                <div key={k}>
                  <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>{lb}</div>
                  <input style={inp} value={modal[k] ?? ""} onChange={e => setModal({ ...modal, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Remarks</div>
              <input style={inp} value={modal.remarks ?? ""} onChange={e => setModal({ ...modal, remarks: e.target.value })} />
            </div>
            {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 10 }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setModal(null)} style={btn("var(--bg)", "var(--text)")}>Cancel</button>
              <button onClick={save} style={btn("var(--yellow)", "#000")}>Save</button>
            </div>
          </div>
        </div>
      )}

      {bulk && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setBulk(null)}>
          <div style={{ ...card, width: 640, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Bulk import vessels</h3>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
              Paste CSV or TSV with a <b>header row</b>. Recognised columns (any order):
              <code style={{ display: "block", margin: "6px 0", fontSize: 11.5 }}>vessel_name, imo_number, mmsi, call_sign, flag, vessel_type, operator, gross_tonnage, built_year, remarks</code>
              Existing vessels are matched by IMO (or name) and have only their blank fields filled — nothing is overwritten.
            </div>
            <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
              <button onClick={() => setBulk({ text: "vessel_name,imo_number,mmsi,flag,operator\nCOSCO FORTUNE,9472127,563277300,Hong Kong,COSCO\nHANSA AFRICA,9419797,636093354,Liberia,Leonhardt & Blumberg" })} style={{ ...btn("var(--bg)", "var(--text)"), fontSize: 11 }}>Insert example</button>
              <label style={{ ...btn("var(--bg)", "var(--text)"), fontSize: 11, display: "inline-flex", alignItems: "center" }}>
                Choose .csv file
                <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setBulk({ text: String(rd.result || "") }); rd.readAsText(f); }} />
              </label>
            </div>
            <textarea style={{ ...inp, minHeight: 180, fontFamily: "var(--mono)", fontSize: 12, resize: "vertical" }}
              placeholder="vessel_name,imo_number,mmsi,flag&#10;MSC ..., 9xxxxxxx, 2xxxxxxxx, Panama"
              value={bulk.text} onChange={e => setBulk({ text: e.target.value })} />
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{parseVesselCSV(bulk.text).length} vessel row(s) detected.</div>
            {bulkResult && (
              <div style={{ marginTop: 10, padding: 10, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5 }}>
                ✅ Created <b>{bulkResult.created}</b> · Updated <b>{bulkResult.updated}</b> · Skipped <b>{bulkResult.skipped}</b>
                {bulkResult.errors?.length ? <div style={{ color: "var(--gold)", marginTop: 6 }}>{bulkResult.errors.length} row(s) failed: {bulkResult.errors.slice(0, 5).map(e => `row ${e.row} (${e.reason})`).join("; ")}{bulkResult.errors.length > 5 ? "…" : ""}</div> : null}
              </div>
            )}
            {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 10 }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setBulk(null)} style={btn("var(--bg)", "var(--text)")}>Close</button>
              <button onClick={runBulk} disabled={!parseVesselCSV(bulk.text).length} style={btn("var(--yellow)", "#000")}>Import {parseVesselCSV(bulk.text).length || ""}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// DataTable — a reusable, theme-aware table with a sticky header, click-to-sort
// columns and one-click CSV export. Opt-in: pages pass a columns spec + rows.
//
// columns: [{ key, label, align?, fmt?(raw,row), tone?(raw,row)->color,
//             render?(raw,row)->node, sortable?=true, csv?(raw,row) }]
// props:   { columns, rows, rowKey?, csvName?, initialSort?={key,dir}, empty?,
//            maxHeight?, minWidth? }
import React, { useState, useMemo } from "react";

export default function DataTable({
  columns, rows, rowKey, csvName = "export", initialSort = null,
  empty = "No rows.", maxHeight = "70vh", minWidth = 720, toolbar = null,
}) {
  const [sort, setSort] = useState(initialSort);

  const sorted = useMemo(() => {
    if (!sort || !sort.key) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = (r) => (col && col.sortValue ? col.sortValue(r[sort.key], r) : r[sort.key]);
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
  }, [rows, sort, columns]);

  const toggleSort = (c) => {
    if (c.sortable === false) return;
    setSort((s) => (s && s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: -1 }));
  };

  const exportCSV = () => {
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = columns.map((c) => esc(c.label)).join(",");
    const lines = sorted.map((r) => columns.map((c) => {
      const raw = r[c.key];
      const v = c.csv ? c.csv(raw, r) : (c.fmt && !c.render ? c.fmt(raw, r) : raw);
      return esc(v);
    }).join(","));
    const csv = [head, ...lines].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${csvName}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const th = { padding: "9px 11px", color: "var(--muted)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", borderBottom: "2px solid var(--border)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 };
  const td = { padding: "8px 11px", fontSize: 13, borderTop: "1px solid var(--border-soft)", whiteSpace: "nowrap" };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <span style={{ fontSize: 12, color: "var(--faint)", fontFamily: "var(--mono)" }}>{sorted.length} row{sorted.length === 1 ? "" : "s"}</span>
        <div style={{ flex: 1 }} />
        {toolbar}
        {sorted.length > 0 && (
          <button onClick={exportCSV} style={{ font: "inherit", fontSize: 12, fontWeight: 700, color: "var(--green-deep)", background: "var(--green-dim)", border: "1px solid var(--green-edge)", borderRadius: 7, padding: "7px 12px", cursor: "pointer" }}>⬇ CSV</button>
        )}
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: 24, color: "var(--muted)" }}>{empty}</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c)}
                    style={{ ...th, textAlign: c.align || "right", cursor: c.sortable === false ? "default" : "pointer" }}>
                    {c.label}{sort && sort.key === c.key ? (sort.dir === -1 ? " ▾" : " ▴") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={rowKey ? r[rowKey] : i}>
                  {columns.map((c) => {
                    const raw = r[c.key];
                    const content = c.render ? c.render(raw, r) : (c.fmt ? c.fmt(raw, r) : (raw == null ? "—" : raw));
                    const color = c.tone ? c.tone(raw, r) : "var(--text)";
                    return (
                      <td key={c.key} style={{ ...td, textAlign: c.align || "right", color, fontWeight: c.bold ? 600 : 400 }}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

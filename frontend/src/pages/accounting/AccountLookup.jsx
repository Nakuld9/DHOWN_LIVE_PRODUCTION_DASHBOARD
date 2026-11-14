// Keyboard-first account selector — type to filter, Up/Down to move, Enter to pick.
// Busy users select ledgers by typing; this mirrors that. `ledgers` is the full
// in-memory list (loaded once by the workspace) so filtering is instant.
import React, { useState, useRef, useEffect, useMemo } from 'react';

export default function AccountLookup({ ledgers, value, onChange, onPicked, autoFocus, placeholder = 'Account…', tabIndex, inputRef: extRef }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const localRef = useRef(null);
  const ref = extRef || localRef;
  const popRef = useRef(null);

  const selected = value ? ledgers.find((l) => l.ledger_id === value) : null;
  const text = open ? q : (selected ? selected.name : '');

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = ledgers.filter((l) => l.is_active);
    if (!s) return base.slice(0, 50);
    return base.filter((l) => l.name.toLowerCase().includes(s) || (l.code || '').toLowerCase().includes(s)).slice(0, 50);
  }, [q, ledgers]);

  useEffect(() => { if (open) setHi(0); }, [q, open]);
  useEffect(() => {
    if (open && popRef.current) {
      const el = popRef.current.children[hi];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [hi, open]);

  const pick = (l) => {
    if (!l) return;
    onChange(l.ledger_id);
    setQ(''); setOpen(false);
    if (onPicked) setTimeout(onPicked, 0);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      if (open && matches[hi]) { e.preventDefault(); e.stopPropagation(); pick(matches[hi]); }
    } else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(''); } }
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        ref={ref}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQ(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        autoComplete="off"
        spellCheck={false}
      />
      {open && matches.length > 0 && (
        <div className="acct-pop" ref={popRef}>
          {matches.map((l, i) => (
            <div key={l.ledger_id} className={i === hi ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(l); }}
              onMouseEnter={() => setHi(i)}>
              <span>{l.name}</span>
              <small>{l.group_name}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

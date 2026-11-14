// Minimal, dependency-free XML reader for Busy's machine-generated export.
// Handles elements, attributes, text, CDATA, self-closing tags, comments, the
// XML declaration and DOCTYPE, and the five predefined entities + numeric refs.
// NOT a general-purpose parser (no namespaces, no DTD processing) — enough for a
// regular, well-formed export, and it throws on malformed structure rather than
// guessing. Returns a tree of { name, attrs, children, text }.

function decode(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });
}

function parseXml(input) {
  const src = String(input == null ? '' : input);
  let i = 0;
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i) { const t = decode(src.slice(i, lt)).trim(); if (t) top().text += t; }

    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); if (e === -1) throw new Error('XML: unterminated comment'); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); if (e === -1) throw new Error('XML: unterminated CDATA'); top().text += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); if (e === -1) throw new Error('XML: unterminated processing instruction'); i = e + 2; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); if (e === -1) throw new Error('XML: unterminated declaration'); i = e + 1; continue; }

    const gt = src.indexOf('>', lt);
    if (gt === -1) throw new Error('XML: unterminated tag');
    let tag = src.slice(lt + 1, gt).trim();

    if (tag[0] === '/') { // closing
      const name = tag.slice(1).trim();
      const node = top();
      if (stack.length < 2 || node.name !== name) throw new Error(`XML: mismatched closing tag </${name}>`);
      stack.pop();
      i = gt + 1; continue;
    }

    const selfClose = tag.endsWith('/');
    if (selfClose) tag = tag.slice(0, -1).trim();
    const sp = tag.search(/\s/);
    const name = sp === -1 ? tag : tag.slice(0, sp);
    const attrs = {};
    if (sp !== -1) {
      const re = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let m;
      while ((m = re.exec(tag.slice(sp)))) attrs[m[1]] = decode(m[3] !== undefined ? m[3] : m[4]);
    }
    const node = { name, attrs, children: [], text: '' };
    top().children.push(node);
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }
  if (stack.length !== 1) throw new Error(`XML: ${stack.length - 1} unclosed element(s) (e.g. <${top().name}>)`);
  return root;
}

// ── tolerant accessors (case-insensitive, alias-aware) ───────────────────────
const lc = (s) => String(s || '').toLowerCase();
function childrenNamed(node, ...names) {
  const set = new Set(names.map(lc));
  return (node.children || []).filter((c) => set.has(lc(c.name)));
}
function child(node, ...names) { return childrenNamed(node, ...names)[0] || null; }
// First non-empty text among the given child-name aliases (or an attribute of the same name).
function text(node, ...names) {
  for (const n of names) {
    const c = child(node, n);
    if (c && c.text !== '') return c.text;
    const a = node && node.attrs && (node.attrs[n] ?? node.attrs[Object.keys(node.attrs).find((k) => lc(k) === lc(n))]);
    if (a !== undefined && a !== '') return a;
  }
  return '';
}
// Depth-first collect of every element whose name matches one of the aliases.
function findAll(node, ...names) {
  const set = new Set(names.map(lc)); const out = [];
  (function walk(n) { for (const c of n.children || []) { if (set.has(lc(c.name))) out.push(c); walk(c); } })(node);
  return out;
}

module.exports = { parseXml, decode, child, childrenNamed, text, findAll };

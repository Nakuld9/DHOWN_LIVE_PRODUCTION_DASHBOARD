/**
 * Minimal read-side XML helpers.
 *
 * Deliberately not a general XML parser. These read BUSY's ack/export files,
 * which are flat, machine-generated and shallow. Pulling in a full parser (and
 * its XXE surface) to read a dozen known tag names is not a good trade.
 *
 * If BUSY's real exports turn out to be deeply nested or namespaced, replace
 * this with a real parser — it is used only by the XML adapter.
 */

function unescapeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** First value of <name>...</name>, or undefined. */
function tagValue(xml, name) {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!match || match[1] === undefined) return undefined;
  const value = unescapeXml(match[1].trim());
  return value === '' ? undefined : value;
}

function tagNumber(xml, name) {
  const raw = tagValue(xml, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Every <name>...</name> block, returned as raw inner XML. */
function tagBlocks(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

module.exports = { tagValue, tagNumber, tagBlocks };

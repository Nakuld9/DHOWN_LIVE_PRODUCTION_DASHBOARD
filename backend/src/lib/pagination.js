// Shared list pagination — the opt-in, backward-compatible convention used across
// the API. When the request has no ?page, callers return the full array as before;
// when ?page is present they return a { data, total, page, pages } envelope.
//
//   const pg = parsePage(req.query);            // null when ?page absent
//   if (!pg) return res.json(rows);             // legacy full-array response
//   res.json(pageEnvelope(rows, total, pg));    // paginated envelope

// Parse ?page / ?limit into clamped { page, limit, offset }, or null when ?page
// is absent (signal to keep the legacy full-array response).
function parsePage(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  if (query.page === undefined || query.page === null || query.page === '') return null;
  const page  = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(Math.max(parseInt(query.limit || defaultLimit) || defaultLimit, 1), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

// Standard paginated envelope. `pg` is the object from parsePage.
function pageEnvelope(rows, total, pg) {
  const t = parseInt(total) || 0;
  return { data: rows, total: t, page: pg.page, pages: pg.limit > 0 ? Math.ceil(t / pg.limit) : 0 };
}

module.exports = { parsePage, pageEnvelope };

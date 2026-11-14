// Audit-logs service — pagination clamping (verbatim from the original handler).
module.exports = (repo) => ({
  async list({ page, limit, module }) {
    const pg  = parseInt(page  || '1') || 1;
    const lim = Math.min(Math.max(parseInt(limit || '100') || 100, 1), 500);
    const offset = (pg - 1) * lim;
    const [rows, cnt] = await repo.page({ module, limit: lim, offset });
    const total = parseInt(cnt.rows[0].count);
    return { data: rows.rows, total, page: pg, pages: Math.ceil(total / lim) };
  },
});

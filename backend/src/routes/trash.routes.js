// Trash — what has been soft-deleted, and how to get it back.
// Mounted at /api/trash.
//
// ADMIN throughout. Restoring a user or a fabric type changes what the rest of
// the system sees, and the audit question "who put this back" should have a
// small, senior answer.

const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  router.use(verifyToken);

  const trash = require('../lib/soft-delete')(pool);
  const fail = (res, out) => res.status(out.code || 400).json({ error: out.error });

  router.get('/', requireRole('ADMIN'), async (req, res) => {
    try { res.json({ tables: trash.tables, items: await trash.list({}) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/:table/:id/restore', requireRole('ADMIN'), async (req, res) => {
    try {
      const out = await trash.restore(req.params.table, req.params.id, { by: req.user?.username });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Irreversible, and gated higher than restore for that reason.
  router.delete('/:table/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
    try {
      const out = await trash.purge(req.params.table, req.params.id, { by: req.user?.username });
      if (out.error) return fail(res, out);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};

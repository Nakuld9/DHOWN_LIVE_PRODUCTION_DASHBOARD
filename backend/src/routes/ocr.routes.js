// OCR endpoints. Mounted at /api/ocr.
//   POST /invoice — extract structured data from a supplier invoice / order PDF.
//                   Reads only; returns the extraction for a human to review. It
//                   NEVER creates a GRN — the review screen does that through the
//                   normal, human-approved GRN flow.
//
// The PDF arrives base64-encoded in the JSON body (the app already allows a 12mb
// body), so there is no multipart/file-upload dependency. Rate-limited with the
// shared AI limiter because it calls the model.
const express = require('express');
const { parseInvoice, parseImage } = require('../lib/invoice-ocr');

module.exports = ({ verifyToken, requireRole, aiLimiter }) => {
  const router = express.Router();

  router.post('/invoice', verifyToken, aiLimiter, requireRole('OPERATOR'), async (req, res) => {
    const pdf = req.body?.pdf_base64;
    const img = req.body?.image_base64;
    if (!pdf && !img) return res.status(400).json({ error: 'pdf_base64 or image_base64 is required' });
    try {
      // Digital PDFs → text-layer extraction; scanned/photographed images → vision model.
      const out = img ? await parseImage(img, req.body?.mime) : await parseInvoice(pdf);
      // A scanned PDF or a parse miss is a 200 with ok:false so the UI can show a
      // clean message rather than a generic failure.
      res.json(out);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
};

const express = require('express');
const cors = require('cors');
const { verifyToken, loginLimiter, pinLimiter, requireRole } = require('./middleware/auth'); // We'll create this later
const path = require('path');
const fs = require('fs');
const config = require('./config/environment');

// Initialize express app
const app = express();

// CORS configuration (same as original)
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests from localhost, any 192.168.x.x device, and no-origin (curl/apps)
    if (!origin || origin.includes('localhost') || /^https?:\/\/192\.168\./.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed'));
    }
  },
  credentials: true,
}));

// Body parser
app.use(express.json());

// Serve React build for network PCs
const FRONTEND_BUILD = path.join(__dirname, '..', '..', 'frontend', 'build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
}

// TODO: Mount routes here (will be implemented later)
// app.use('/api', require('./routes'));

// Error handling middleware (to be implemented)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
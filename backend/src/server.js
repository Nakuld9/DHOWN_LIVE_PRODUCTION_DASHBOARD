const http = require('http');
const { initSocketIO } = require('./config/socket');
const app = require('./app');
const config = require('./config/environment');

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io and attach to app for access in routes
const io = initSocketIO(server);
app.set('io', io);

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { server, app }; // Export for testing if needed
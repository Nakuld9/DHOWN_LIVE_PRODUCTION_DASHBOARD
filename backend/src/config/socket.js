const { Server } = require('socket.io');

/**
 * Initialize Socket.io on the given HTTP server.
 * @param {http.Server} httpServer - The HTTP server instance
 * @returns {SocketIO.Server} The Socket.io server instance
 */
function initSocketIO(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  // Placeholder for socket event handlers; to be moved to sockets/ directory
  io.on('connection', (socket) => {
    // Connection handler can be expanded or moved to a dedicated socket handler file
    // For now, keep it minimal to maintain existing behavior
  });

  return io;
}

module.exports = { initSocketIO };
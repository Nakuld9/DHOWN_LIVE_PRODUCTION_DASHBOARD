const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const config = require('../config/environment');

// Extract JWT secret and expiration from environment config
const JWT_SECRET = config.jwtSecret;
const JWT_EXPIRES_IN = config.jwtExpiresIn;
console.log('JWT_SECRET from config:', JWT_SECRET);

// ===========================
// Verify Token Middleware
// ===========================
function verifyToken(req, res, next) {
  const auth = req.headers['authorization'];
  console.log('Auth header:', auth);
  if (!auth || !auth.startsWith('Bearer ')) {
    console.log('No auth header or does not start with Bearer');
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = auth.slice(7);
  console.log('Token:', token);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token decoded:', decoded);
    req.user = decoded;
    next();
  } catch (err) {
    console.log('JWT verification error:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ===========================
// Login rate limiter (10 attempts / 15 min per IP)
// ===========================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ===========================
// Supervisor PIN rate limiter (5 attempts / 5 min per IP)
// ===========================
const pinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PIN attempts. Try again in 5 minutes.' },
});

// ===========================
// Role-based access control
// ===========================
const ROLE_HIERARCHY = { VIEWER: 1, OPERATOR: 2, SUPERVISOR: 3, ADMIN: 4, SUPER_ADMIN: 5 };
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 99;
    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

module.exports = { verifyToken, loginLimiter, pinLimiter, requireRole };
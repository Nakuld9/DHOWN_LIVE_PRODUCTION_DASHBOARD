require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '4000'),
  jwtSecret: process.env.JWT_SECRET || 'dhown_mes_jwt_secret_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  pgBin: process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin',
  // Database config is in database.js, but we can also expose the db config here if needed
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'dhown_mes',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'dhown123',
  }
};

module.exports = config;
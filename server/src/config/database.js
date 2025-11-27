const mysql = require('mysql2/promise');
const { db } = require('./env');

let pool;

const createPool = () => {
  if (! pool) {
    pool = mysql.createPool({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.name,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  }
  return pool;
};

const getConnection = async () => {
  const pool = createPool();
  return await pool.getConnection();
};

const query = async (sql, params) => {
  const pool = createPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
};

module.exports = {
  createPool,
  getConnection,
  query
};
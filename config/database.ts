import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventori',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  multipleStatements: true,
});

// Test connection
pool.getConnection()
  .then((connection) => {
    console.log(' Database connected successfully');
    connection.release();
  })
  .catch((err) => {
    console.error(' Database connection failed:', err);
  });

/**
 * Jalankan migrasi dari file SQL
 */
export async function runMigrations(sqlFilePath?: string) {
  // Default path jika tidak disediakan
  const defaultPath = path.resolve(process.cwd(), 'config', 'database.schema.sql');
  const sqlPath = sqlFilePath || defaultPath;

  try {
    console.log(` Loading SQL file from: ${sqlPath}`);
    const sql = await fs.readFile(sqlPath, 'utf8');

    // Opsional: bersihkan BOM jika ada
    const cleanedSql = sql.replace(/^\uFEFF/, '');

    const conn = await pool.getConnection();
    try {
      console.log(' Executing migration...');
      await conn.query(cleanedSql);
      console.log(' Migration executed successfully');
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error(' Migration failed:', err?.message || err);
    throw err;
  }
}

/**
 * Opsional: jalankan otomatis jika DB_MIGRATE=true
 */
if ((process.env.DB_MIGRATE || '').toLowerCase() === 'true') {
  runMigrations().catch(() => {
    // error sudah dilog di atas
  });
}

export default pool;
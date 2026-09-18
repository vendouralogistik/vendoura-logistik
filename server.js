const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Koneksi ke Database Cloud PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Auto Inisialisasi Tabel Database Cloud
async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, nama TEXT, email TEXT UNIQUE, password TEXT, role TEXT
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS items (
      kode TEXT PRIMARY KEY, nama TEXT, kategori TEXT, satuan TEXT, lokasi TEXT, harga INTEGER DEFAULT 0, stok INTEGER DEFAULT 0, "stokMin" INTEGER DEFAULT 0
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS stock_in (
      id TEXT PRIMARY KEY, tanggal TEXT, kode TEXT, jumlah INTEGER, sumber TEXT, keterangan TEXT, oleh TEXT
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS stock_out (
      id TEXT PRIMARY KEY, tanggal TEXT, kode TEXT, jumlah INTEGER, pengambil TEXT, divisi TEXT, keterangan TEXT, oleh TEXT
    )`);

    const adminPass = bcrypt.hashSync('admin123', 10);
    await pool.query(`INSERT INTO users (id, nama, email, password, role) 
                      VALUES ('USR-admin', 'Admin Logistik', 'admin@vendoura.com', $1, 'Admin')
                      ON CONFLICT (email) DO NOTHING`, [adminPass]);
    console.log('Database PostgreSQL Cloud Berhasil Terhubung.');
  } catch (err) {
    console.error('Gagal inisialisasi DB:', err);
  }
}
initDB();

/* ================= API ENDPOINTS ================= */

app.get('/api/sync', async (req, res) => {
  try {
    const users = (await pool.query('SELECT id, nama, email, role FROM users')).rows;
    const items = (await pool.query('SELECT * FROM items')).rows;
    const stockIn = (await pool.query('SELECT * FROM stock_in ORDER BY tanggal DESC')).rows;
    const stockOut = (await pool.query('SELECT * FROM stock_out ORDER BY tanggal DESC')).rows;
    res.json({ users, items, stockIn, stockOut });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: 'Email atau password salah' });
    }
    res.json({ user: { id: user.id, name: user.nama, role: user.role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/items', async (req, res) => {
  const { kode, nama, kategori, satuan, lokasi, harga, stok, stokMin } = req.body;
  try {
    await pool.query(
      `INSERT INTO items (kode, nama, kategori, satuan, lokasi, harga, stok, "stokMin") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [kode, nama, kategori, satuan, lokasi, harga||0, stok||0, stokMin||0]
    );
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: 'Kode sparepart sudah digunakan.' }); }
});

app.put('/api/items/:kode', async (req, res) => {
  const { nama, kategori, satuan, lokasi, harga, stok, stokMin } = req.body;
  try {
    await pool.query(
      `UPDATE items SET nama=$1, kategori=$2, satuan=$3, lokasi=$4, harga=$5, stok=$6, "stokMin"=$7 WHERE kode=$8`,
      [nama, kategori, satuan, lokasi, harga||0, stok||0, stokMin||0, req.params.kode]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/items/:kode', async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE kode=$1', [req.params.kode]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stock-in', async (req, res) => {
  const { id, tanggal, kode, jumlah, sumber, keterangan, oleh } = req.body;
  try {
    await pool.query(`INSERT INTO stock_in (id, tanggal, kode, jumlah, sumber, keterangan, oleh) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, tanggal, kode, jumlah, sumber, keterangan, oleh]);
    await pool.query(`UPDATE items SET stok = stok + $1 WHERE kode = $2`, [jumlah, kode]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stock-out', async (req, res) => {
  const { id, tanggal, kode, jumlah, pengambil, divisi, keterangan, oleh } = req.body;
  try {
    const itemRes = await pool.query('SELECT stok, satuan FROM items WHERE kode = $1', [kode]);
    const item = itemRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Item tidak ditemukan' });
    if (item.stok < jumlah) return res.status(400).json({ error: `Stok tidak mencukupi! Stok: ${item.stok}` });

    await pool.query(`INSERT INTO stock_out (id, tanggal, kode, jumlah, pengambil, divisi, keterangan, oleh) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, tanggal, kode, jumlah, pengambil, divisi, keterangan, oleh]);
    await pool.query(`UPDATE items SET stok = stok - $1 WHERE kode = $2`, [jumlah, kode]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', async (req, res) => {
  const { id, nama, email, password, role } = req.body;
  try {
    await pool.query(`INSERT INTO users (id, nama, email, password, role) VALUES ($1, $2, $3, $4, $5)`, [id, nama, email, bcrypt.hashSync(password, 10), role]);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: 'Email sudah terdaftar.' }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Server Cloud Berjalan di Port ${PORT}`));

module.exports = app;
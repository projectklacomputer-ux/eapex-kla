// ============================================================================
//  Abstraksi basis data EAPEX
// ============================================================================
// Satu API async untuk dua mesin:
//   - PostgreSQL (Neon/Supabase) bila DATABASE_URL diisi  -> dipakai saat deploy
//   - SQLite lokal (data/eapex.db) bila tidak              -> dipakai di kantor/laptop
//
// Semua SQL di aplikasi ditulis memakai placeholder tanda tanya (?) dan hanya
// memakai tipe yang dipahami kedua mesin (TEXT, INTEGER, NUMERIC). Kunci utama
// selalu TEXT berisi UUID yang dibuat aplikasi, supaya tidak bergantung pada
// SERIAL (Postgres) atau AUTOINCREMENT (SQLite) yang perilakunya berbeda.
const path = require('path');
const fs = require('fs');

const pakaiPg = !!process.env.DATABASE_URL;

function bungkus(ops) {
  return {
    ...ops,
    // Ambil satu nilai skalar (kolom pertama baris pertama), atau null.
    nilai: async (sql, params = []) => {
      const r = await ops.get(sql, params);
      if (!r) return null;
      const k = Object.keys(r);
      return k.length ? r[k[0]] : null;
    },
  };
}

let modul;

if (pakaiPg) {
  const pg = require('pg');
  const { Pool } = pg;

  // PENTING: secara bawaan node-postgres mengembalikan BIGINT sebagai STRING supaya
  // tidak kehilangan presisi. Semua uang di aplikasi ini BIGINT rupiah bulat yang jauh
  // di bawah 2^53, jadi aman dijadikan Number — tanpa ini perhitungan jadi rangkaian teks.
  pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));
  // Di hosting tanpa server tetap, TIAP contoh fungsi punya kolam sambungannya
  // sendiri. Sepuluh contoh × 5 sambungan sudah cukup menghabiskan jatah pooler
  // Supabase, dan gejalanya bukan galat yang jelas — melainkan permintaan yang
  // menggantung sampai kehabisan waktu. Karena itu di sana kolamnya dikecilkan.
  const dilambda = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const maksKolam = Number(process.env.PG_MAX_KOLAM) || (dilambda ? 2 : 5);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: maksKolam,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: dilambda ? 10000 : 30000,
    allowExitOnIdle: true,
  });

  // ? -> $1, $2, ... (tanda tanya di dalam string literal tidak dipakai di aplikasi ini)
  const kePg = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };

  const opsDari = q => bungkus({
    all: async (sql, params = []) => (await q(kePg(sql), params)).rows,
    get: async (sql, params = []) => (await q(kePg(sql), params)).rows[0] || null,
    run: async (sql, params = []) => { await q(kePg(sql), params); },
  });

  modul = {
    jenis: 'pg',
    ...opsDari((sql, params) => pool.query(sql, params)),
    exec: async sql => { await pool.query(sql); },
    tx: async fn => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const hasil = await fn(opsDari((sql, params) => client.query(sql, params)));
        await client.query('COMMIT');
        return hasil;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    tutup: async () => { await pool.end(); },
  };
} else {
  const Database = require('better-sqlite3');
  const berkas = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'eapex.db');
  fs.mkdirSync(path.dirname(berkas), { recursive: true });
  const db = new Database(berkas);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // better-sqlite3 menolak undefined; ubah jadi null supaya perilakunya sama dengan pg.
  const rapikan = params => params.map(v => (v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : v)));

  const ops = bungkus({
    all: async (sql, params = []) => db.prepare(sql).all(...rapikan(params)),
    get: async (sql, params = []) => db.prepare(sql).get(...rapikan(params)) || null,
    run: async (sql, params = []) => { db.prepare(sql).run(...rapikan(params)); },
  });

  modul = {
    jenis: 'sqlite',
    ...ops,
    exec: async sql => { db.exec(sql); },
    tx: async fn => {
      // Transaksi manual (bukan db.transaction) karena fn boleh async.
      db.exec('BEGIN');
      try {
        const hasil = await fn(ops);
        db.exec('COMMIT');
        return hasil;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_) { /* sudah tergulung */ }
        throw e;
      }
    },
    tutup: async () => { db.close(); },
  };
}

module.exports = modul;

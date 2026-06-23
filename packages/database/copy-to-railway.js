const { createClient } = require('@libsql/client');
const { Client: PgClient } = require('pg');

const TURSO_URL = 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io';
const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw';
const PG_URL = 'postgresql://postgres:KmvtFgpNBqxNKiXlhUNzaqCrSZXExIeK@trolley.proxy.rlwy.net:15523/railway';

const TABLES = [
  { name: 'crops', limit: 100 },
  { name: 'users', limit: 100 },
  { name: 'refresh_tokens', limit: 200 },
  { name: 'player_titles', limit: 100 },
  { name: 'player_title_collection', limit: 100 },
  { name: 'farm_tiles', limit: 100 },
  { name: 'inventories', limit: 100 },
  { name: 'orders', limit: 100 },
];

const TS_FIELDS = new Set(['created_at','last_login_at','expires_at','planted_at','finish_at','unlocked_at','last_equipped_at','delivery_complete_at']);

function fix(val) {
  if (val == null) return null;
  if (typeof val === 'object') return JSON.stringify(val);
  if (TS_FIELDS.has(val)) {
    // field name passed accidentally, ignore
  }
  return val;
}

function fixRow(row, fields) {
  return fields.map(f => {
    let v = row[f];
    if (TS_FIELDS.has(f) && v != null) {
      const ms = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : v;
      try { return new Date(ms).toISOString(); } catch { return v; }
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
}

async function copyOne(turso, pg, name, limit) {
  process.stdout.write(`${name}: `);
  
  // Get all rows (limit)
  const all = await turso.execute(`SELECT * FROM ${name}`);
  const rows = all.rows;
  
  if (rows.length === 0) { console.log('empty'); return; }
  
  // Get column names from first row
  const fields = Object.keys(rows[0]);
  const ph = fields.map((_, i) => `$${i+1}`).join(',');
  const sql = `INSERT INTO "${name}" (${fields.map(f=>`"${f}"`).join(',')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
  
  let ok = 0, err = 0;
  for (const row of rows) {
    const vals = fixRow(row, fields);
    try {
      await pg.query(sql, vals);
      ok++;
    } catch(e) { err++; if (err <= 2) console.log(`err:${e.message.substring(0,80)}`); }
    if (ok % 20 === 0) process.stdout.write(`${ok}/${rows.length} `);
  }
  console.log(`${ok}/${rows.length} ✅ (${err} err)`);
}

async function main() {
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  const pg = new PgClient({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
  
  await pg.connect();
  await turso.execute('SELECT 1');
  console.log('🚀 Copying Turso → Railway PostgreSQL...\n');
  
  for (const t of TABLES) {
    await copyOne(turso, pg, t.name, t.limit);
  }
  
  console.log('\n🎉 All done!');
  await pg.end();
  await turso.close();
}

main().catch(e => { console.error('\n❌ Error:', e.message); process.exit(1); });

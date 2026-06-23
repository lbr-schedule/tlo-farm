const { createClient } = require('@libsql/client');
const { Client } = require('pg');

const turso = createClient({ url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io', authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw' });
const pg = new Client({ connectionString: 'postgresql://postgres:KmvtFgpNBqxNKiXlhUNzaqCrSZXExIeK@trolley.proxy.rlwy.net:15523/railway', ssl: { rejectUnauthorized: false } });

const TABLES = [
  { name: 'farm_tiles', offset: 0 },
  { name: 'inventories', offset: 0 },
  { name: 'orders', offset: 0 },
];

const TS = new Set(['created_at','last_login_at','expires_at','planted_at','finish_at','unlocked_at','last_equipped_at','delivery_complete_at']);

async function copyTable(name, offset) {
  process.stdout.write(`${name} (from ${offset}): `);
  
  const all = await turso.execute(`SELECT * FROM ${name}`);
  const rows = all.rows.slice(offset);
  
  if (rows.length === 0) { console.log('nothing left'); return; }
  
  const fields = Object.keys(rows[0]);
  const sql = `INSERT INTO "${name}" (${fields.map(f=>`"${f}"`).join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`;
  
  let ok = 0;
  for (const row of rows) {
    const vals = fields.map(f => {
      let v = row[f];
      if (TS.has(f) && v != null) {
        const ms = v > 1e12 ? v : v * 1000;
        try { return new Date(ms).toISOString(); } catch { return v; }
      }
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    try {
      await pg.query(sql, vals);
      ok++;
    } catch(e) {}
  }
  console.log(`${ok} inserted ✅`);
}

async function main() {
  await pg.connect();
  await turso.execute('SELECT 1');
  
  for (const t of TABLES) {
    await copyTable(t.name, t.offset);
  }
  
  await pg.end();
  await turso.close();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });

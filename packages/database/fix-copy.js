const { createClient } = require('@libsql/client');
const { Client } = require('pg');

const turso = createClient({ url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io', authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw' });
const pg = new Client({ connectionString: 'postgresql://postgres:KmvtFgpNBqxNKiXlhUNzaqCrSZXExIeK@trolley.proxy.rlwy.net:15523/railway', ssl: { rejectUnauthorized: false } });

const TS = new Set(['created_at','last_login_at','expires_at','planted_at','finish_at','unlocked_at','last_equipped_at','delivery_complete_at']);

async function copyTable(name) {
  process.stdout.write(`${name}: `);
  await pg.query(`DELETE FROM "${name}"`); // Clear existing
  console.log('cleared, ');
  
  const all = await turso.execute(`SELECT * FROM ${name}`);
  const rows = all.rows;
  if (rows.length === 0) { console.log('empty'); return; }
  
  const fields = Object.keys(rows[0]);
  const sql = `INSERT INTO "${name}" (${fields.map(f=>`"${f}"`).join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')})`;
  
  let ok = 0, err = 0;
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
      const r = await pg.query(sql, vals);
      ok += r.rowCount;
    } catch(e) {
      err++;
      if (err <= 3) console.log('  ERR ' + name + ':', e.message.substring(0, 120));
    }
  }
  console.log(`${ok} inserted, ${err} errors`);
}

async function main() {
  await pg.connect();
  await turso.execute('SELECT 1');
  console.log('Connected, clearing and re-copying...\n');
  
  await copyTable('farm_tiles');
  await copyTable('orders');
  
  await pg.end();
  await turso.close();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });

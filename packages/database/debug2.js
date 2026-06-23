const { createClient } = require('@libsql/client');
const { Client } = require('pg');
const turso = createClient({ url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io', authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw' });
const pg = new Client({ connectionString: 'postgresql://postgres:KmvtFgpNBqxNKiXlhUNzaqCrSZXExIeK@trolley.proxy.rlwy.net:15523/railway', ssl: { rejectUnauthorized: false } });

async function test() {
  await pg.connect();
  
  // Test farm_tiles
  const ft = await turso.execute('SELECT * FROM farm_tiles LIMIT 1');
  const fields = Object.keys(ft.rows[0]);
  const sql = `INSERT INTO "farm_tiles" (${fields.map(f=>`"${f}"`).join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`;
  
  for (const row of ft.rows) {
    const vals = fields.map(f => row[f]);
    try {
      const r = await pg.query(sql, vals);
      console.log('farm_tiles insert:', r.rowCount, r.rows);
    } catch(e) {
      console.log('farm_tiles error:', e.message);
    }
  }
  
  // Test orders  
  const ord = await turso.execute('SELECT * FROM orders LIMIT 1');
  if (ord.rows.length > 0) {
    const ofields = Object.keys(ord.rows[0]);
    const osql = `INSERT INTO "orders" (${ofields.map(f=>`"${f}"`).join(',')}) VALUES (${ofields.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`;
    const ovals = ofields.map(f => ord.rows[0][f]);
    console.log('orders SQL:', osql);
    console.log('orders vals:', ovals);
    try {
      const r = await pg.query(osql, ovals);
      console.log('orders insert:', r.rowCount);
    } catch(e) {
      console.log('orders error:', e.message);
    }
  }
  
  await pg.end();
  await turso.close();
}
test().catch(console.error);

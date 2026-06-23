const { createClient } = require('@libsql/client');
const { Client } = require('pg');
const turso = createClient({ url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io', authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw' });
const pg = new Client({ connectionString: 'postgresql://postgres:KmvtFgpNBqxNKiXlhUNzaqCrSZXExIeK@trolley.proxy.rlwy.net:15523/railway', ssl: { rejectUnauthorized: false } });

async function test() {
  await pg.connect();
  const all = await turso.execute('SELECT * FROM farm_tiles LIMIT 1');
  const row = all.rows[0];
  const fields = Object.keys(row);
  console.log('Fields:', fields);
  console.log('Row:', JSON.stringify(row));
  
  const vals = fields.map(f => {
    let v = row[f];
    if (v === null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  console.log('Vals:', vals);
  
  const sql = `INSERT INTO "farm_tiles" (${fields.map(f=>`"${f}"`).join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`;
  console.log('SQL:', sql);
  
  try {
    const r = await pg.query(sql, vals);
    console.log('Insert result:', r.rowCount, 'rows');
  } catch(e) {
    console.log('Error:', e.message);
  }
  
  await pg.end();
  await turso.close();
}
test().catch(console.error);

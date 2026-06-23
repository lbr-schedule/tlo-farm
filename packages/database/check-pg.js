const { Client } = require('pg');
const pg = new Client({ connectionString: 'postgresql://postgres:KmvtFgpNBqxNKiXlhUNzaqCrSZXExIeK@trolley.proxy.rlwy.net:15523/railway', ssl: { rejectUnauthorized: false } });
pg.connect().then(async () => {
  const r = await pg.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  for (const row of r.rows) {
    const cnt = await pg.query(`SELECT COUNT(*) as c FROM "${row.table_name}"`);
    console.log(`${row.table_name}: ${cnt.rows[0].c}`);
  }
  await pg.end();
}).catch(e => console.error(e.message));

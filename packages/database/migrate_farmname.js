const { createClient } = require('@libsql/client');
const client = createClient({ url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io', authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw' });

async function migrate() {
  // Fix null farm_name
  const r1 = await client.execute("UPDATE users SET farm_name = nickname || '的農場' WHERE farm_name IS NULL");
  console.log('✅ Fixed', r1.rowsAffected, 'null farm_name rows');

  // Fix null player_code (should not happen but just in case)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function genCode() {
    let r = '';
    for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return 'TLO-' + r;
  }

  const users = await client.execute('SELECT id, player_code FROM users WHERE player_code IS NULL');
  for (const row of users.rows) {
    const code = genCode();
    await client.execute('UPDATE users SET player_code = ? WHERE id = ?', [code, row.id]);
    console.log('✅ Generated player_code', code, 'for user id', row.id);
  }
}

migrate().finally(() => client.close()).catch(e => console.error(e.message));

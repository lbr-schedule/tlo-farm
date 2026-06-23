const { createClient } = require('@libsql/client');

const client = createClient({
  url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw'
});

function generatePlayerCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return 'TLO-' + code;
}

async function migrate() {
  // 1. Add player_code column (non-unique first)
  try {
    await client.execute('ALTER TABLE users ADD COLUMN player_code TEXT');
    console.log('✅ Added player_code column');
  } catch (e) {
    if (e.message.includes('duplicate column') || e.message.includes('already exists')) {
      console.log('⏭️  player_code column already exists');
    } else {
      console.error('❌ add column:', e.message);
    }
  }

  // 2. Check if player_code is already filled
  const users = await client.execute('SELECT id, account FROM users');
  let count = 0;
  for (const user of users.rows) {
    const result = await client.execute({
      sql: 'SELECT player_code FROM users WHERE id = ?',
      args: [user.id]
    });
    if (!result.rows[0]?.player_code) {
      const code = generatePlayerCode();
      await client.execute({
        sql: 'UPDATE users SET player_code = ? WHERE id = ?',
        args: [code, user.id]
      });
      count++;
      console.log(`✅ ${code} → ${user.account}`);
    }
  }

  // 3. Add unique index
  try {
    await client.execute('CREATE UNIQUE INDEX idx_users_player_code ON users(player_code)');
    console.log('✅ Created unique index on player_code');
  } catch (e) {
    console.log('⏭️  unique index:', e.message.includes('already exists') || e.message.includes('index') ? 'already exists' : e.message);
  }

  console.log(`🏁 Done! ${count} users got player_code.`);
  client.close();
}

migrate().catch(console.error);

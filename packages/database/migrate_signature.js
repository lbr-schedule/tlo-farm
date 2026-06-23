const { createClient } = require('@libsql/client');
const client = createClient({ url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io', authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw' });

async function migrate() {
  // Check if signature column exists
  const cols = await client.execute("PRAGMA table_info(users)");
  const hasSig = cols.rows.some(r => r.name === 'signature');
  
  if (!hasSig) {
    await client.execute("ALTER TABLE users ADD COLUMN signature TEXT DEFAULT '歡迎來我的農場！'");
    console.log('✅ Added signature column');
  } else {
    console.log('signature column already exists');
  }
  
  // Set default signature for existing users who have null
  await client.execute("UPDATE users SET signature = '歡迎來我的農場！' WHERE signature IS NULL");
  console.log('✅ Updated null signatures');
}

migrate().finally(() => client.close()).catch(e => console.error(e.message));

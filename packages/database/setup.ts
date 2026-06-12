import { createClient } from '@libsql/client';

const client = createClient({
  url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Nzk4NTg3NTgsImlkIjoiMDE5ZTY3ZDktM2IwMS03NzE3LWJhYjItYWFlNDM1YmE1ZjgxIiwicmlkIjoiNDA1ZDM4YTQtYmIyMi00ZDFlLWJmNmQtNmM2ZjE5ZWZjYjcxIn0.NahD7Miq0d9H7Es6baSfibzeFigI2Xtmjn8kYN6ZAUAh5Y5TroGOQCiRTVinyYGWjl6hJQCpUUy4ZvehK0jkDA'
});

async function setup() {
  console.log('🔌 連線到 Turso 資料庫...');

  // Create tables
  console.log('📦 建立資料表...');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      email TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      gold INTEGER NOT NULL DEFAULT 500,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER NOT NULL
    )
  `);
  console.log('  ✅ users 表');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  console.log('  ✅ refresh_tokens 表');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS crops (
      id INTEGER PRIMARY KEY,
      name_zh_tw TEXT NOT NULL,
      grow_time_sec INTEGER NOT NULL,
      sell_price INTEGER NOT NULL,
      buy_price INTEGER NOT NULL,
      exp INTEGER NOT NULL,
      sprite TEXT NOT NULL,
      required_level INTEGER NOT NULL DEFAULT 1
    )
  `);
  console.log('  ✅ crops 表');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS farm_tiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      crop_id INTEGER REFERENCES crops(id),
      planted_at INTEGER,
      finish_at INTEGER,
      state TEXT NOT NULL DEFAULT 'empty',
      UNIQUE(user_id, x, y)
    )
  `);
  console.log('  ✅ farm_tiles 表');

  // ── 加入 watered_at 欄位（如果還沒有）──
  try {
    await client.execute(`ALTER TABLE farm_tiles ADD COLUMN watered_at INTEGER`);
    console.log('  ✅ watered_at 欄位已加入');
  } catch (e: any) {
    if (e.message?.includes('duplicate column') || e.message?.includes('no such column')) {
      // 欄位已存在，忽略
    } else {
      console.log('  ⚠️ watered_at 欄位檢查:', e.message?.split('\n')[0]);
    }
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS inventories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      amount INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, item_type, item_id)
    )
  `);
  console.log('  ✅ inventories 表');

  // Seed crops data
  console.log('🌱 種植作物資料...');
  
  const cropData = [
    { id: 1, name: '小麥', time: 30, sell: 5, buy: 5, exp: 10, sprite: 'crop_wheat', level: 1 },
    { id: 2, name: '玉米', time: 60, sell: 15, buy: 10, exp: 20, sprite: 'crop_corn', level: 1 },
    { id: 3, name: '草莓', time: 120, sell: 30, buy: 20, exp: 40, sprite: 'crop_strawberry', level: 2 },
    { id: 4, name: '番茄', time: 180, sell: 50, buy: 35, exp: 60, sprite: 'crop_tomato', level: 3 },
    { id: 5, name: '西瓜', time: 300, sell: 100, buy: 70, exp: 100, sprite: 'crop_watermelon', level: 5 },
    { id: 6, name: '南瓜', time: 240, sell: 80, buy: 55, exp: 80, sprite: 'crop_pumpkin', level: 4 },
    { id: 7, name: '胡蘿蔔', time: 90, sell: 25, buy: 18, exp: 30, sprite: 'crop_carrot', level: 2 },
    { id: 8, name: '藍莓', time: 150, sell: 40, buy: 28, exp: 50, sprite: 'crop_blueberry', level: 3 }
  ];

  for (const crop of cropData) {
    try {
      await client.execute({
        sql: `INSERT OR REPLACE INTO crops (id, name_zh_tw, grow_time_sec, sell_price, buy_price, exp, sprite, required_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [crop.id, crop.name, crop.time, crop.sell, crop.buy, crop.exp, crop.sprite, crop.level]
      });
      console.log(`  ✅ ${crop.name}`);
    } catch (e: any) {
      console.log(`  ⏭️ ${crop.name} 已存在`);
    }
  }

  // Verify
  const crops = await client.execute('SELECT * FROM crops');
  console.log('\n📋 作物清單：');
  for (const row of crops.rows) {
    console.log(`  ${row.name_zh_tw} - 生長時間: ${row.grow_time_sec}秒, 賣價: ${row.sell_price}金, 經驗: ${row.exp}`);
  }

  console.log('\n🎉 資料庫設定完成！');
}

setup().catch(console.error);

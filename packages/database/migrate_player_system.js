// Migration script for player system tables
// Run: node migrate_player_system.js

const { createClient } = require('@libsql/client');

const client = createClient({
  url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiJiMjg4MTBmZi1kOTY1LTRmMzUtYTAzOC0wOGRjOGIyOWM1YmMiLCJpYXQiOjE3ODAwMjk1NjksInJpZCI6IjVlNjRhMTk1LTY1M2EtNGUzNS1iY2Q5LTI5YjRmNTg1NWU4NiJ9.wtFi92eDtb-aCugsTgHRNONFaTeoqip41xUhjJlqQFgUVZUDvvdbpnthCGA-XJhRHypKMwcgrXrfx9IP-Z0ZCw'
});

async function migrate() {
  console.log('🔧 Running player system migration...');

  // 1. Add new columns to users table
  const userColumns = [
    'ALTER TABLE users ADD COLUMN farm_name TEXT;',
    'ALTER TABLE users ADD COLUMN diamonds INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN avatar TEXT;',
    'ALTER TABLE users ADD COLUMN title_id TEXT REFERENCES player_titles(id);',
    'ALTER TABLE users ADD COLUMN friend_count INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN friend_limit INTEGER NOT NULL DEFAULT 50;',
    'ALTER TABLE users ADD COLUMN farm_popularity INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN unread_message_count INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN bag_capacity INTEGER NOT NULL DEFAULT 50;',
    'ALTER TABLE users ADD COLUMN plot_count INTEGER NOT NULL DEFAULT 6;',
    'ALTER TABLE users ADD COLUMN invite_code TEXT NOT NULL UNIQUE;',
    'ALTER TABLE users ADD COLUMN inviter_code TEXT;',
    'ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT \'正常\';',
    'ALTER TABLE users ADD COLUMN tutorial_status TEXT NOT NULL DEFAULT \'未完成\';',
    'ALTER TABLE users ADD COLUMN daily_login_reward_claimed INTEGER NOT NULL DEFAULT 0;',
  ];

  for (const sql of userColumns) {
    try {
      await client.execute(sql);
      console.log('✅', sql.substring(0, 60));
    } catch (e) {
      if (e.message.includes('duplicate column') || e.message.includes('no such column')) {
        console.log('⏭️  (already exists)', sql.substring(0, 50));
      } else {
        console.error('❌', e.message);
      }
    }
  }

  // 2. Create player_titles table
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS player_titles (
        id TEXT PRIMARY KEY,
        name_zh_tw TEXT NOT NULL,
        unlock_condition TEXT NOT NULL,
        rarity TEXT NOT NULL,
        color_hex TEXT NOT NULL DEFAULT '#FFFFFF',
        has_effect INTEGER NOT NULL DEFAULT 0,
        effect_description TEXT,
        title_type TEXT NOT NULL
      );
    `);
    console.log('✅ Created player_titles table');
  } catch (e) {
    console.log('⏭️  player_titles:', e.message.includes('already exists') ? 'already exists' : e.message);
  }

  // 3. Seed player_titles data
  const titles = [
    ['T001','初芽農夫','玩家Lv1','普通','#FFFFFF',0,null,'等級'],
    ['T002','晨露耕耘者','玩家Lv10','普通','#7ED957',0,null,'等級'],
    ['T003','麥田巡守者','玩家Lv20','稀有','#A8E063',0,null,'等級'],
    ['T004','莊園經營家','玩家Lv40','高級','#66B3FF',0,null,'等級'],
    ['T005','皇家農場主','玩家Lv70','傳說','#FFD700',1,'金色微光','等級'],
    ['T006','永恆豐收者','玩家Lv100','傳說','#FF66CC',1,'彩虹流光','等級'],
    ['T007','小小收割員','累積收成500次','普通','#FFFFFF',0,null,'收成'],
    ['T008','金穗管理人','累積收成5000次','稀有','#F6D365',0,null,'收成'],
    ['T009','豐收領航者','累積收成20000次','高級','#F9A826',1,'金色微光','收成'],
    ['T010','傳說收成者','累積收成100000次','傳說','#FFB347',1,'金色粒子流光','收成'],
    ['T011','畜牧助手','累積收集動物產物500次','普通','#FFFFFF',0,null,'畜牧'],
    ['T012','牧場管理員','累積收集動物產物3000次','稀有','#90CAF9',0,null,'畜牧'],
    ['T013','畜牧經營者','累積收集動物產物10000次','高級','#64B5F6',1,'淡藍微光','畜牧'],
    ['T014','皇家牧場主','累積收集動物產物50000次','傳說','#42A5F5',1,'藍色流光粒子','畜牧'],
    ['T015','路過看看','偷菜10次','普通','#FFFFFF',0,null,'偷菜'],
    ['T016','只拿一點點','偷菜50次','普通','#D6D6D6',0,null,'偷菜'],
    ['T017','你家菜真香','偷菜200次','稀有','#B39DDB',0,null,'偷菜'],
    ['T018','深夜農地觀察員','偷菜500次','稀有','#9575CD',0,null,'偷菜'],
    ['T019','偷菜界模範生','偷菜1000次','高級','#7E57C2',1,'紫色微光','偷菜'],
    ['T020','偷菜五星會員','偷菜3000次','高級','#AB47BC',1,'紫色粒子','偷菜'],
    ['T021','月下採收人','偷菜6000次','傳說','#CE93D8',1,'夜色流光','偷菜'],
    ['T022','農地裡的那道黑影','偷菜10000次','傳說','#E1BEE7',1,'黑紫色暗光','偷菜'],
    ['T023','木牌訪客','留言20次','普通','#FFFFFF',0,null,'社交'],
    ['T024','農場熟客','留言100次','普通','#FFE066',0,null,'社交'],
    ['T025','木牌常駐戶','留言500次','稀有','#FFD54F',0,null,'社交'],
    ['T026','留言板管理員','留言2000次','高級','#FFB300',1,'黃色微光','社交'],
    ['T027','初識農友','好友10人','普通','#FFFFFF',0,null,'好友'],
    ['T028','農場交際家','好友30人','稀有','#FF99CC',0,null,'好友'],
    ['T029','人氣農場主','好友50人','高級','#FF66B2',1,'粉色愛心粒子','好友'],
    ['T030','金穗收藏家','累積獲得10萬金幣','普通','#FFE082',0,null,'財富'],
    ['T031','莊園投資家','累積獲得100萬金幣','稀有','#FFD54F',0,null,'財富'],
    ['T032','黃金經營者','累積獲得1000萬金幣','高級','#FFCA28',1,'黃金微光','財富'],
    ['T033','皇家富農','累積獲得1億金幣','傳說','#FFD700',1,'黃金流光粒子','財富'],
    ['T034','咕咕養殖員','累積收集雞蛋5000次','稀有','#FFF59D',0,null,'動物專精'],
    ['T035','牛奶供應商','累積收集牛奶3000次','稀有','#90CAF9',0,null,'動物專精'],
    ['T036','咩咩牧場主','累積收集羊毛1500次','高級','#CE93D8',0,null,'動物專精'],
    ['T037','蜂蜜收藏家','累積收集蜂蜜1000次','高級','#FFCC80',1,'蜂蜜微光','動物專精'],
    ['T038','海鮮大亨','累積收集海鮮500次','傳說','#4FC3F7',1,'水波流光','動物專精'],
    ['T039','點心學徒','製作甜點100次','普通','#F8BBD0',0,null,'加工'],
    ['T040','烘焙熟手','製作甜點500次','稀有','#F48FB1',0,null,'加工'],
    ['T041','甜點研究生','製作甜點2000次','高級','#EC407A',1,'粉色微光','加工'],
    ['T042','皇家甜點師','製作傳說甜點100次','傳說','#FF80AB',1,'糖霜粒子','加工'],
    ['T043','今天也沒澆水','作物枯萎100次','隱藏','#9E9E9E',0,null,'隱藏'],
    ['T044','守田稻草人','被偷菜500次','隱藏','#A1887F',0,null,'隱藏'],
    ['T045','鹿比的好朋友','特殊活動取得','活動','#80DEEA',1,'七彩泡泡','活動'],
    ['T046','慶典人氣王','節慶活動排名取得','活動','#FF7043',1,'慶典煙火','活動'],
  ];

  for (const [id, name, cond, rarity, color, effect, effectDesc, type] of titles) {
    try {
      await client.execute({
        sql: `INSERT OR IGNORE INTO player_titles (id, name_zh_tw, unlock_condition, rarity, color_hex, has_effect, effect_description, title_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, name, cond, rarity, color, effect, effectDesc, type]
      });
      console.log(`✅ Seeded ${id} ${name}`);
    } catch (e) {
      console.log(`⏭️  ${id}: ${e.message}`);
    }
  }

  // 4. Create player_title_collection table
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS player_title_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title_id TEXT NOT NULL REFERENCES player_titles(id),
        is_unlocked INTEGER NOT NULL DEFAULT 0,
        is_equipped INTEGER NOT NULL DEFAULT 0,
        is_new INTEGER NOT NULL DEFAULT 1,
        current_progress INTEGER NOT NULL DEFAULT 0,
        target_progress INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        unlocked_at INTEGER,
        last_equipped_at INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        is_event_limited INTEGER NOT NULL DEFAULT 0
      );
    `);
    console.log('✅ Created player_title_collection table');
  } catch (e) {
    console.log('⏭️  player_title_collection:', e.message.includes('already exists') ? 'already exists' : e.message);
  }

  console.log('🏁 Migration complete!');
  client.close();
}

migrate().catch(console.error);

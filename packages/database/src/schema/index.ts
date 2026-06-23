import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  account: text('account').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nickname: text('nickname').notNull(),
  email: text('email'),
  level: integer('level').notNull().default(1),
  exp: integer('exp').notNull().default(0),
  gold: integer('gold').notNull().default(500),
  // 農場相關
  farmName: text('farm_name'),
  diamonds: integer('diamonds').notNull().default(0),
  avatar: text('avatar'), // 頭像圖片ID或URL
  // 稱號
  titleId: text('title_id').references(() => playerTitles.id),
  // 社交
  friendCount: integer('friend_count').notNull().default(0),
  friendLimit: integer('friend_limit').notNull().default(50),
  farmPopularity: integer('farm_popularity').notNull().default(0),
  unreadMessageCount: integer('unread_message_count').notNull().default(0),
  // 背包與農地
  bagCapacity: integer('bag_capacity').notNull().default(50),
  plotCount: integer('plot_count').notNull().default(6),
  // 邀請碼
  inviteCode: text('invite_code').notNull().unique(), // 玩家專屬邀請碼（=帳號）
  inviterCode: text('inviter_code'), // 邀請人邀請碼
  // 狀態
  accountStatus: text('account_status').notNull().default('正常'), // 正常/停權/封鎖
  tutorialStatus: text('tutorial_status').notNull().default('未完成'), // 未完成/已完成
  dailyLoginRewardClaimed: integer('daily_login_reward_claimed').notNull().default(0), // 0=未領, 1=已領
  // 時間
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

// 玩家稱號資料表（靜態資料）
export const playerTitles = sqliteTable('player_titles', {
  id: text('id').primaryKey(), // T001, T002...
  nameZhTw: text('name_zh_tw').notNull(),
  unlockCondition: text('unlock_condition').notNull(),
  rarity: text('rarity').notNull(), // 普通/稀有/高級/傳說/隱藏/活動
  colorHex: text('color_hex').notNull().default('#FFFFFF'),
  hasEffect: integer('has_effect', { mode: 'boolean' }).notNull().default(false),
  effectDescription: text('effect_description'),
  titleType: text('title_type').notNull() // 等級/收成/畜牧/偷菜/社交/好友/財富/動物專精/加工/隱藏/活動
});

// 玩家稱號收藏表
export const playerTitleCollection = sqliteTable('player_title_collection', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  titleId: text('title_id').notNull().references(() => playerTitles.id),
  isUnlocked: integer('is_unlocked', { mode: 'boolean' }).notNull().default(false),
  isEquipped: integer('is_equipped', { mode: 'boolean' }).notNull().default(false),
  isNew: integer('is_new', { mode: 'boolean' }).notNull().default(true),
  currentProgress: integer('current_progress').notNull().default(0),
  targetProgress: integer('target_progress').notNull().default(0),
  source: text('source'), // 等級/成就/活動/隱藏/任務
  unlockedAt: integer('unlocked_at', { mode: 'timestamp' }),
  lastEquippedAt: integer('last_equipped_at', { mode: 'timestamp' }),
  sortOrder: integer('sort_order').notNull().default(0),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  isEventLimited: integer('is_event_limited', { mode: 'boolean' }).notNull().default(false)
});

// 作物資料表（靜態資料）
export const crops = sqliteTable('crops', {
  id: integer('id').primaryKey(),
  nameZhTw: text('name_zh_tw').notNull(),
  growTimeSec: integer('grow_time_sec').notNull(),
  sellPrice: integer('sell_price').notNull(),
  buyPrice: integer('buy_price').notNull(),
  exp: integer('exp').notNull(),
  sprite: text('sprite').notNull(),
  requiredLevel: integer('required_level').notNull().default(1)
});

// 農場土地資料表
export const farmTiles = sqliteTable('farm_tiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  cropId: integer('crop_id').references(() => crops.id),
  plantedAt: integer('planted_at', { mode: 'timestamp' }),
  finishAt: integer('finish_at', { mode: 'timestamp' }),
  state: text('state').notNull().default('empty') // empty, planted, growing, ready, dead
});

// 背包資料表
export const inventories = sqliteTable('inventories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  itemType: text('item_type').notNull(), // 'seed' | 'crop' | 'item'
  itemId: integer('item_id').notNull(),
  amount: integer('amount').notNull().default(1)
});

// 訂單資料表
export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  npcName: text('npc_name').notNull(),
  difficulty: text('difficulty').notNull(), // easy, medium, hard
  requirements: text('requirements').notNull(), // JSON: [{itemName, quantity}]
  rewardCoins: integer('reward_coins').notNull(),
  rewardExp: integer('reward_exp').notNull(),
  status: text('status').notNull().default('active'), // active, delivering, completed, expired
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  deliveryCompleteAt: integer('delivery_complete_at', { mode: 'timestamp' }),
  createdAt: integer('created_at').notNull()
});

// 等級解鎖設定
export const levelUnlocks = sqliteTable('level_unlocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  level: integer('level').notNull().unique(),
  unlockType: text('unlock_type').notNull(), // 'crop' | 'feature' | 'plot'
  unlockId: integer('unlock_id').notNull()
});

export const dailyLoginRewards = sqliteTable('daily_login_rewards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  currentDay: integer('current_day').notNull().default(1), // 1-7, cycles back to 1 after Day7
  lastLoginDate: text('last_login_date'), // YYYY-MM-DD format
  streakDays: integer('streak_days').notNull().default(0), // consecutive days, resets if missed a day
  totalLoginDays: integer('total_login_days').notNull().default(0), // never resets, permanent
  todayClaimed: integer('today_claimed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type Crop = typeof crops.$inferSelect;
export type FarmTile = typeof farmTiles.$inferSelect;
export type Inventory = typeof inventories.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type PlayerTitle = typeof playerTitles.$inferSelect;
export type PlayerTitleCollection = typeof playerTitleCollection.$inferSelect;
export const chickenBuildings = sqliteTable('chicken_buildings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  unlockedAt: integer('unlocked_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const chickenSlots = sqliteTable('chicken_slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  slotIndex: integer('slot_index').notNull(),
  state: text('state').notNull().default('EMPTY'),
  feedAppliedAt: integer('feed_applied_at', { mode: 'timestamp' }),
  producedAt: integer('produced_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export type DailyLoginReward = typeof dailyLoginRewards.$inferSelect;

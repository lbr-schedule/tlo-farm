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

// 農場土地複合唯一鍵
export const farmTileUnique = sqliteTable('farm_tiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  cropId: integer('crop_id').references(() => crops.id),
  plantedAt: integer('planted_at', { mode: 'timestamp' }),
  finishAt: integer('finish_at', { mode: 'timestamp' }),
  state: text('state').notNull().default('empty')
});

// 等級解鎖設定
export const levelUnlocks = sqliteTable('level_unlocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  level: integer('level').notNull().unique(),
  unlockType: text('unlock_type').notNull(), // 'crop' | 'feature' | 'plot'
  unlockId: integer('unlock_id').notNull()
});

// 計算：土地位置唯一
// user_id + x + y 複合唯一

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type Crop = typeof crops.$inferSelect;
export type FarmTile = typeof farmTiles.$inferSelect;
export type Inventory = typeof inventories.$inferSelect;

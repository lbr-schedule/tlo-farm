import { pgTable, text, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  account: text('account').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nickname: text('nickname').notNull(),
  email: text('email'),
  level: integer('level').notNull().default(1),
  exp: integer('exp').notNull().default(0),
  gold: integer('gold').notNull().default(500),
  farmName: text('farm_name'),
  diamonds: integer('diamonds').notNull().default(0),
  avatar: text('avatar'),
  titleId: text('title_id').references(() => playerTitles.id),
  friendCount: integer('friend_count').notNull().default(0),
  friendLimit: integer('friend_limit').notNull().default(50),
  farmPopularity: integer('farm_popularity').notNull().default(0),
  unreadMessageCount: integer('unread_message_count').notNull().default(0),
  bagCapacity: integer('bag_capacity').notNull().default(50),
  plotCount: integer('plot_count').notNull().default(6),
  inviteCode: text('invite_code').notNull().unique(),
  inviterCode: text('inviter_code'),
  accountStatus: text('account_status').notNull().default('正常'),
  tutorialStatus: text('tutorial_status').notNull().default('未完成'),
  dailyLoginRewardClaimed: integer('daily_login_reward_claimed').notNull().default(0),
  playerCode: text('player_code').notNull().unique(), // T-LOXXXXXX format
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at').notNull().defaultNow()
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
});

export const playerTitles = pgTable('player_titles', {
  id: text('id').primaryKey(),
  nameZhTw: text('name_zh_tw').notNull(),
  unlockCondition: text('unlock_condition').notNull(),
  rarity: text('rarity').notNull(),
  colorHex: text('color_hex').notNull().default('#FFFFFF'),
  hasEffect: boolean('has_effect').notNull().default(false),
  effectDescription: text('effect_description'),
  titleType: text('title_type').notNull()
});

export const playerTitleCollection = pgTable('player_title_collection', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull().references(() => users.id),
  titleId: text('title_id').notNull().references(() => playerTitles.id),
  isUnlocked: boolean('is_unlocked').notNull().default(false),
  isEquipped: boolean('is_equipped').notNull().default(false),
  isNew: boolean('is_new').notNull().default(true),
  currentProgress: integer('current_progress').notNull().default(0),
  targetProgress: integer('target_progress').notNull().default(0),
  source: text('source'),
  unlockedAt: timestamp('unlocked_at'),
  lastEquippedAt: timestamp('last_equipped_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  isHidden: boolean('is_hidden').notNull().default(false),
  isEventLimited: boolean('is_event_limited').notNull().default(false)
});

export const crops = pgTable('crops', {
  id: integer('id').primaryKey(),
  nameZhTw: text('name_zh_tw').notNull(),
  growTimeSec: integer('grow_time_sec').notNull(),
  sellPrice: integer('sell_price').notNull(),
  buyPrice: integer('buy_price').notNull(),
  exp: integer('exp').notNull(),
  sprite: text('sprite').notNull(),
  requiredLevel: integer('required_level').notNull().default(1)
});

export const farmTiles = pgTable('farm_tiles', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull().references(() => users.id),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  cropId: integer('crop_id').references(() => crops.id),
  plantedAt: timestamp('planted_at'),
  finishAt: timestamp('finish_at'),
  state: text('state').notNull().default('empty')
});

export const inventories = pgTable('inventories', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull().references(() => users.id),
  itemType: text('item_type').notNull(),
  itemId: integer('item_id').notNull(),
  amount: integer('amount').notNull().default(1)
});

export const orders = pgTable('orders', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull().references(() => users.id),
  npcName: text('npc_name').notNull(),
  difficulty: text('difficulty').notNull(),
  requirements: text('requirements').notNull(),
  rewardCoins: integer('reward_coins').notNull(),
  rewardExp: integer('reward_exp').notNull(),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expires_at').notNull(),
  deliveryCompleteAt: timestamp('delivery_complete_at'),
  createdAt: integer('created_at').notNull()
});

export const levelUnlocks = pgTable('level_unlocks', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  level: integer('level').notNull().unique(),
  unlockType: text('unlock_type').notNull(),
  unlockId: integer('unlock_id').notNull()
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

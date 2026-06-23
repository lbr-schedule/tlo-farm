const { Client } = require('pg');

const DATABASE_PUBLIC_URL = 'postgresql://postgres:KmvtFgpNBqxNKiXlhUNzaqCrSZXExIeK@trolley.proxy.rlwy.net:15523/railway';

async function createTables() {
  const client = new Client({
    connectionString: DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to Railway PostgreSQL!');

    // Create all tables
    const sql = `
-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS "users" (
  "id" SERIAL PRIMARY KEY,
  "account" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "email" TEXT,
  "level" INTEGER NOT NULL DEFAULT 1,
  "exp" INTEGER NOT NULL DEFAULT 0,
  "gold" INTEGER NOT NULL DEFAULT 500,
  "farm_name" TEXT,
  "diamonds" INTEGER NOT NULL DEFAULT 0,
  "avatar" TEXT,
  "title_id" TEXT,
  "friend_count" INTEGER NOT NULL DEFAULT 0,
  "friend_limit" INTEGER NOT NULL DEFAULT 50,
  "farm_popularity" INTEGER NOT NULL DEFAULT 0,
  "unread_message_count" INTEGER NOT NULL DEFAULT 0,
  "bag_capacity" INTEGER NOT NULL DEFAULT 50,
  "plot_count" INTEGER NOT NULL DEFAULT 6,
  "invite_code" TEXT NOT NULL UNIQUE,
  "inviter_code" TEXT,
  "account_status" TEXT NOT NULL DEFAULT '正常',
  "tutorial_status" TEXT NOT NULL DEFAULT '未完成',
  "daily_login_reward_claimed" INTEGER NOT NULL DEFAULT 0,
  "player_code" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "last_login_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "token" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMP NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Player titles (static data)
CREATE TABLE IF NOT EXISTS "player_titles" (
  "id" TEXT PRIMARY KEY,
  "name_zh_tw" TEXT NOT NULL,
  "unlock_condition" TEXT NOT NULL,
  "rarity" TEXT NOT NULL,
  "color_hex" TEXT NOT NULL DEFAULT '#FFFFFF',
  "has_effect" BOOLEAN NOT NULL DEFAULT false,
  "effect_description" TEXT,
  "title_type" TEXT NOT NULL
);

-- Player title collection
CREATE TABLE IF NOT EXISTS "player_title_collection" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "title_id" TEXT NOT NULL REFERENCES "player_titles"("id"),
  "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
  "is_equipped" BOOLEAN NOT NULL DEFAULT false,
  "is_new" BOOLEAN NOT NULL DEFAULT true,
  "current_progress" INTEGER NOT NULL DEFAULT 0,
  "target_progress" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT,
  "unlocked_at" TIMESTAMP,
  "last_equipped_at" TIMESTAMP,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_hidden" BOOLEAN NOT NULL DEFAULT false,
  "is_event_limited" BOOLEAN NOT NULL DEFAULT false
);

-- Crops (static data)
CREATE TABLE IF NOT EXISTS "crops" (
  "id" SERIAL PRIMARY KEY,
  "name_zh_tw" TEXT NOT NULL,
  "grow_time_sec" INTEGER NOT NULL,
  "sell_price" INTEGER NOT NULL,
  "buy_price" INTEGER NOT NULL,
  "exp" INTEGER NOT NULL,
  "sprite" TEXT NOT NULL,
  "required_level" INTEGER NOT NULL DEFAULT 1
);

-- Farm tiles
CREATE TABLE IF NOT EXISTS "farm_tiles" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "crop_id" INTEGER REFERENCES "crops"("id"),
  "planted_at" TIMESTAMP,
  "finish_at" TIMESTAMP,
  "state" TEXT NOT NULL DEFAULT 'empty'
);

-- Inventories
CREATE TABLE IF NOT EXISTS "inventories" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "item_type" TEXT NOT NULL,
  "item_id" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1
);

-- Orders
CREATE TABLE IF NOT EXISTS "orders" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "npc_name" TEXT NOT NULL,
  "difficulty" TEXT NOT NULL,
  "requirements" TEXT NOT NULL,
  "reward_coins" INTEGER NOT NULL,
  "reward_exp" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMP NOT NULL,
  "delivery_complete_at" TIMESTAMP,
  "created_at" INTEGER NOT NULL
);

-- Level unlocks
CREATE TABLE IF NOT EXISTS "level_unlocks" (
  "id" SERIAL PRIMARY KEY,
  "level" INTEGER NOT NULL UNIQUE,
  "unlock_type" TEXT NOT NULL,
  "unlock_id" INTEGER NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_users_account" ON "users"("account");
CREATE INDEX IF NOT EXISTS "idx_users_invite_code" ON "users"("invite_code");
CREATE INDEX IF NOT EXISTS "idx_users_player_code" ON "users"("player_code");
CREATE INDEX IF NOT EXISTS "idx_farm_tiles_user_id" ON "farm_tiles"("user_id");
CREATE INDEX IF NOT EXISTS "idx_inventories_user_id" ON "inventories"("user_id");
CREATE INDEX IF NOT EXISTS "idx_orders_user_id" ON "orders"("user_id");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_id" ON "refresh_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "idx_player_title_collection_user_id" ON "player_title_collection"("user_id");
    `;

    // Split by semicolons and execute each statement
    const statements = sql.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await client.query(statement);
        console.log('✅ Executed:', statement.substring(0, 50).replace(/\n/g, ' ') + '...');
      }
    }

    console.log('\n🎉 All tables created successfully!');

    // Verify
    const result = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'');
    console.log('\n📋 Existing tables:');
    result.rows.forEach(r => console.log('  -', r.table_name));

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

createTables();

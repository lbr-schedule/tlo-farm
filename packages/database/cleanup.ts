import { createClient } from '@libsql/client';

const client = createClient({
  url: 'libsql://lbr-farm-lbr-schedule.aws-ap-northeast-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Nzk4NTg3NTgsImlkIjoiMDE5ZTY3ZDktM2IwMS03NzE3LWJhYjItYWFlNDM1YmE1ZjgxIiwicmlkIjoiNDA1ZDM4YTQtYmIyMi00ZDFlLWJmNmQtNmM2ZjE5ZWZjYjcxIn0.OhD7Miq0d9H7Es6baSfibzeFigI2Xtmjn8kYN6ZAUAh5Y5TroGOQCiRTVinyYGWjl6hJQCpUUy4ZvehK0jkDA'
});

async function cleanup() {
  // Delete test user
  try {
    await client.execute({
      sql: "DELETE FROM refresh_tokens WHERE user_id = 1",
      args: []
    });
    await client.execute({
      sql: "DELETE FROM farm_tiles WHERE user_id = 1",
      args: []
    });
    await client.execute({
      sql: "DELETE FROM inventories WHERE user_id = 1",
      args: []
    });
    await client.execute({
      sql: "DELETE FROM users WHERE account = 'test001'",
      args: []
    });
    console.log('🧹 測試資料已清理');
  } catch (e) {
    console.error('清理失敗:', e);
  }
}

cleanup();

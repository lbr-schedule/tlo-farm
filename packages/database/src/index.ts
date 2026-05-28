import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.DATABASE_URL || '',
  authToken: process.env.DATABASE_AUTH_TOKEN
});

export { client as db };

export const usersTableName = 'users';
export const refreshTokensTableName = 'refresh_tokens';

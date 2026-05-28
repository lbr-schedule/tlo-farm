import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const client = createClient({
  url: process.env.DATABASE_URL || '',
  authToken: process.env.DATABASE_AUTH_TOKEN
});

// Disable automatic migration checks by not passing schema initially
export const db = drizzle(client, { schema, migrations: undefined });

export * from './schema';

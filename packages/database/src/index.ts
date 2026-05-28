import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.DATABASE_URL || '',
  authToken: process.env.DATABASE_AUTH_TOKEN
});

// Don't pass schema as second argument - it triggers drizzle's migration check
export const db = drizzle(client);

export * from './schema';

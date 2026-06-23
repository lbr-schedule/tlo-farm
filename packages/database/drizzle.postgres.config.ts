import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/postgres-schema.ts',
  out: './drizzle-postgres',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  }
});

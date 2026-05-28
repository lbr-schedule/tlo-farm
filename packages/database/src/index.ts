import { createClient, type Client } from '@libsql/client';

const client: Client = createClient({
  url: process.env.DATABASE_URL || '',
  authToken: process.env.DATABASE_AUTH_TOKEN
});

// Wrap client.execute to convert array-of-arrays rows to array-of-objects
const db = {
  async execute(sql: string, args?: any[]) {
    const result = await client.execute(sql, args);
    if (result.rows && result.columns) {
      const mappedRows = result.rows.map(row => {
        const obj: Record<string, any> = {};
        result.columns!.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });
      return { ...result, rows: mappedRows };
    }
    return result;
  }
};

export { db };

export const usersTableName = 'users';
export const refreshTokensTableName = 'refresh_tokens';

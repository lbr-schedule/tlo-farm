import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.DATABASE_URL || '',
  authToken: process.env.DATABASE_AUTH_TOKEN
});

// Wrap client.execute to convert rows from array-of-arrays to array-of-objects
const db = {
  async execute(sql: string, args?: any[]) {
    const result = args !== undefined
      ? await client.execute(sql, args)
      : await client.execute(sql);
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

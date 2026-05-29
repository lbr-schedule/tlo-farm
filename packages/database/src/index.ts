import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.DATABASE_URL || '',
  authToken: process.env.DATABASE_AUTH_TOKEN
});

// Wrap client.execute to convert rows from array-of-arrays to array-of-objects
// and handle both simple execute(sql, args) and object execute({sql, args}) formats
const db = {
  async execute(sqlOrConfig: string | { sql: string; args?: any[] }, args?: any[]) {
    let result;
    if (typeof sqlOrConfig === 'object' && sqlOrConfig !== null && 'sql' in sqlOrConfig) {
      // Object format: { sql, args }
      result = await client.execute(sqlOrConfig.sql, sqlOrConfig.args ?? []);
    } else {
      // Simple format: execute(sql, args)
      result = args !== undefined
        ? await client.execute(sqlOrConfig as string, args)
        : await client.execute(sqlOrConfig as string);
    }
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

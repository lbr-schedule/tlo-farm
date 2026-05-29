// Bypass @libsql/client due to NULL parameter issue in server environments
// Use raw fetch to call Turso HTTP API directly

const dbUrl = process.env.FARM_DATABASE_URL || process.env.DATABASE_URL || '';
const authToken = process.env.FARM_DATABASE_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || '';

function getDbInfo() {
  const url = dbUrl.replace('libsql://', '');
  const slashIdx = url.indexOf('/');
  const host = slashIdx >= 0 ? url.substring(0, slashIdx) : url;
  const path = slashIdx >= 0 ? '/' + url.substring(slashIdx + 1) : '/';
  return { host, path };
}

async function rawExecute(sql: string, args: any[] = []) {
  const { host, path } = getDbInfo();
  console.log('[RAW-FETCH] sql:', sql, 'args:', JSON.stringify(args));
  
  const response = await fetch(`https://${host}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        type: 'execute',
        stmt: { sql, args }
      }]
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    const errMsg = data.error?.message || JSON.stringify(data);
    console.log('[RAW-FETCH] error:', errMsg);
    throw new Error(errMsg);
  }
  
  const result = data.results?.[0];
  console.log('[RAW-FETCH] result:', JSON.stringify(result));
  
  return {
    rows: result?.rows || [],
    columns: result?.columns || [],
    rowsAffected: result?.rows_affected || 0
  };
}

async function rawQuery(sql: string, args: any[] = []) {
  const { host, path } = getDbInfo();
  console.log('[RAW-FETCH-QUERY] sql:', sql, 'args:', JSON.stringify(args));
  
  const response = await fetch(`https://${host}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        type: 'query',
        stmt: { sql, args }
      }]
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    const errMsg = data.error?.message || JSON.stringify(data);
    console.log('[RAW-FETCH] query error:', errMsg);
    throw new Error(errMsg);
  }
  
  const result = data.results?.[0];
  return {
    rows: result?.rows || [],
    columns: result?.columns || []
  };
}

const db = {
  async execute(sqlOrConfig: string | { sql: string; args?: any[] }, args?: any[]): Promise<any> {
    let sql: string;
    let actualArgs: any[];
    
    if (typeof sqlOrConfig === 'object' && sqlOrConfig !== null && 'sql' in sqlOrConfig) {
      sql = sqlOrConfig.sql;
      actualArgs = sqlOrConfig.args ?? [];
    } else {
      sql = sqlOrConfig as string;
      actualArgs = args ?? [];
    }
    
    console.log('[DB] execute called with sql:', sql, 'args:', JSON.stringify(actualArgs));
    
    const result = await rawExecute(sql, actualArgs);
    
    if (result.rows.length > 0 && result.columns.length > 0) {
      const mappedRows = result.rows.map((row: any[]) => {
        const obj: Record<string, any> = {};
        result.columns.forEach((col: string, i: number) => {
          obj[col] = row[i];
        });
        return obj;
      });
      return { ...result, rows: mappedRows };
    }
    
    return result;
  },
  
  async query(sql: string, args?: any[]): Promise<any> {
    return rawQuery(sql, args ?? []);
  }
};

export { db };

export const usersTableName = 'users';
export const refreshTokensTableName = 'refresh_tokens';

// Bypass @libsql/client due to NULL parameter issue in server environments
// Use raw fetch to call Turso HTTP API v2 directly

const dbUrl = process.env.FARM_DATABASE_URL || process.env.DATABASE_URL || '';
const authToken = process.env.FARM_DATABASE_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || '';

function getDbHostAndPath() {
  const url = dbUrl.replace('libsql://', '');
  const slashIdx = url.indexOf('/');
  const host = slashIdx >= 0 ? url.substring(0, slashIdx) : url;
  const path = slashIdx >= 0 ? '/' + url.substring(slashIdx + 1) : '/';
  return { host, path };
}

// Convert JS value to Turso tagged format
function toTursoValue(val: any): any {
  if (val === null || val === undefined) {
    return { type: 'null' };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { type: 'integer', value: String(val) };
    }
    return { type: 'real', value: String(val) };
  }
  if (typeof val === 'string') {
    return { type: 'text', value: val };
  }
  if (typeof val === 'boolean') {
    return { type: 'integer', value: val ? '1' : '0' };
  }
  return { type: 'text', value: String(val) };
}

// Convert Turso result rows back to normal format
function parseTursoRows(cols: string[], rows: any[][]) {
  return rows.map(row => {
    const obj: Record<string, any> = {};
    cols.forEach((col, i) => {
      const cell = row[i];
      if (cell === null || cell === undefined || (typeof cell === 'object' && cell.type === 'null')) {
        obj[col] = null;
      } else if (typeof cell === 'object' && cell.type === 'text') {
        obj[col] = cell.value;
      } else if (typeof cell === 'object' && cell.type === 'integer') {
        obj[col] = parseInt(cell.value, 10);
      } else if (typeof cell === 'object' && cell.type === 'real') {
        obj[col] = parseFloat(cell.value);
      } else if (typeof cell === 'object' && cell.type === 'blob') {
        obj[col] = Buffer.from(cell.value, 'base64');
      } else {
        obj[col] = cell;
      }
    });
    return obj;
  });
}

async function rawExecute(sql: string, args: any[] = []) {
  const { host } = getDbHostAndPath();
  const tursoArgs = args.map(toTursoValue);
  
  console.log('[RAW-FETCH] sql:', sql, 'tursoArgs:', JSON.stringify(tursoArgs));
  
  const response = await fetch(`https://${host}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        type: 'execute',
        stmt: { sql, args: tursoArgs }
      }]
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    const errMsg = data.error?.message || JSON.stringify(data);
    console.log('[RAW-FETCH] error:', errMsg);
    throw new Error(errMsg);
  }
  
  const result = data.results?.[0]?.response?.result;
  if (!result) {
    console.log('[RAW-FETCH] result is undefined, full response:', JSON.stringify(data).substring(0, 500));
  }
  console.log('[RAW-FETCH] result cols:', result?.cols, 'rows:', result?.rows?.length);
  
  const cols = result?.cols?.map((c: any) => c.name) || [];
  const rows = parseTursoRows(cols, result?.rows || []);
  
  return {
    rows,
    columns: cols,
    rowsAffected: result?.affected_row_count || 0
  };
}

async function rawQuery(sql: string, args: any[] = []) {
  const { host } = getDbHostAndPath();
  const tursoArgs = args.map(toTursoValue);
  
  console.log('[RAW-FETCH-QUERY] sql:', sql, 'tursoArgs:', JSON.stringify(tursoArgs));
  
  const response = await fetch(`https://${host}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        type: 'execute',
        stmt: { sql, args: tursoArgs }
      }]
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    const errMsg = data.error?.message || JSON.stringify(data);
    console.log('[RAW-FETCH] query error:', errMsg);
    throw new Error(errMsg);
  }
  
  const result = data.results?.[0]?.response?.result;
  const cols = result?.cols?.map((c: any) => c.name) || [];
  const rows = parseTursoRows(cols, result?.rows || []);
  
  return { rows, columns: cols };
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
    
    console.log('[DB] execute called with sql:', sql, 'actualArgs:', JSON.stringify(actualArgs));
    return rawExecute(sql, actualArgs);
  },
  
  async query(sql: string, args?: any[]): Promise<any> {
    return rawQuery(sql, args ?? []);
  }
};

export { db };

export const usersTableName = 'users';
export const refreshTokensTableName = 'refresh_tokens';

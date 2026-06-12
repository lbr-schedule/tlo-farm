// api.ts - 共用的 API fetch 工具（自動處理 401 + token refresh）

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('accessToken');
  const refreshToken = localStorage.getItem('refreshToken');

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(url, { ...options, headers });

  // 遇到 401 → 嘗試刷新 token
  if (response.status === 401) {
    console.log('[api] Token 過期，嘗試刷新...');

    if (refreshToken) {
      try {
        const refreshRes = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const refreshData = await refreshRes.json();

        if (refreshData.success) {
          localStorage.setItem('accessToken', refreshData.accessToken);
          localStorage.setItem('refreshToken', refreshData.refreshToken);
          console.log('[api] Token 刷新成功');

          // 重新發送請求
          headers['Authorization'] = `Bearer ${refreshData.accessToken}`;
          response = await fetch(url, { ...options, headers });
        } else {
          throw new Error('Refresh failed');
        }
      } catch {
        console.warn('[api] Token 刷新失敗，請重新登入');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        throw new Error('TOKEN_EXPIRED');
      }
    } else {
      console.warn('[api] 沒有 refreshToken，請重新登入');
      window.location.href = '/login';
      throw new Error('TOKEN_EXPIRED');
    }
  }

  return response;
}

// 檢查當前 token 是否存在且有效
export function hasValidToken(): boolean {
  const token = localStorage.getItem('accessToken');
  return !!token;
}
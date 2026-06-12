// BackpackSystem - 背包系統
// 管理背包中的物品（種子、農作物），與伺服器 API 同步

import { CropData } from '../scenes/FarmScene';

export interface BackpackItem {
  id: number;
  itemType: 'seed' | 'crop';
  itemId: number;
  amount: number;
  name: string;
  sprite: string;
  sellPrice: number;
  growTimeSec: number;
}

export interface BackpackState {
  seeds: BackpackItem[];
  crops: BackpackItem[];
  loading: boolean;
  error: string | null;
}

export type BackpackListener = (state: BackpackState) => void;

// ── Token 刷新輔助函式 ──
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── 自動處理 401 的 fetch ──
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('accessToken');
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response = await fetch(url, { ...options, headers });

  // 遇到 401 → 嘗試刷新 token
  if (response.status === 401) {
    console.log('[BackpackSystem] Token 過期，嘗試刷新...');
    const refreshed = await refreshAccessToken();

    if (refreshed) {
      const newToken = localStorage.getItem('accessToken');
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(url, { ...options, headers });
    } else {
      // 刷新失敗 → 導向登入
      console.warn('[BackpackSystem] Token 刷新失敗，請重新登入');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
      throw new Error('TOKEN_EXPIRED');
    }
  }

  return response;
}

class BackpackSystem {
  private state: BackpackState = {
    seeds: [],
    crops: [],
    loading: false,
    error: null,
  };
  private listeners: Set<BackpackListener> = new Set();

  subscribe(listener: BackpackListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l({ ...this.state }));
  }

  private setState(partial: Partial<BackpackState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  getState(): BackpackState {
    return this.state;
  }

  async fetchAll() {
    this.setState({ loading: true, error: null });
    try {
      const [seeds, crops] = await Promise.all([
        this.fetchItems('seed'),
        this.fetchItems('crop'),
      ]);
      this.setState({ seeds, crops, loading: false });
    } catch (err: any) {
      this.setState({ loading: false, error: err.message });
    }
  }

  async fetchItems(type: 'seed' | 'crop', page = 1, limit = 50): Promise<BackpackItem[]> {
    const res = await authFetch(`/api/inventory?type=${type}&page=${page}&limit=${limit}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || '取得背包失敗');
    return data.inventory || [];
  }

  // 從背包扣除物品（本地樂觀更新）
  async deductItem(itemType: 'seed' | 'crop', itemId: number): Promise<boolean> {
    const items = itemType === 'seed' ? this.state.seeds : this.state.crops;
    const idx = items.findIndex(i => i.itemId === itemId && i.amount > 0);
    if (idx === -1) return false;

    // 樂觀更新
    const updated = [...items];
    updated[idx] = { ...updated[idx], amount: updated[idx].amount - 1 };
    if (updated[idx].amount === 0) updated.splice(idx, 1);

    if (itemType === 'seed') {
      this.setState({ seeds: updated });
    } else {
      this.setState({ crops: updated });
    }

    try {
      const res = await authFetch('/api/inventory/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: items[idx].id, amount: 1 }),
      });
      const data = await res.json();
      if (!data.success) {
        await this.fetchAll();
        return false;
      }
      return true;
    } catch {
      await this.fetchAll();
      return false;
    }
  }

  // 賣出作物
  async sellItem(itemId: number): Promise<{ success: boolean; newGold: number; message: string }> {
    const invItem = this.state.crops.find(i => i.id === itemId);
    if (!invItem) return { success: false, newGold: 0, message: '物品不存在' };

    try {
      const res = await authFetch('/api/shop/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cropId: invItem.itemId, amount: 1 }),
      });
      const data = await res.json();
      if (data.success) {
        await this.fetchAll();
        return { success: true, newGold: data.user.gold, message: data.message };
      }
      return { success: false, newGold: 0, message: data.message || '賣出失敗' };
    } catch {
      return { success: false, newGold: 0, message: '網路錯誤' };
    }
  }

  getSeedCount(cropId: number): number {
    const item = this.state.seeds.find(i => i.itemId === cropId);
    return item?.amount ?? 0;
  }
}

export const backpackSystem = new BackpackSystem();
export default backpackSystem;

const DEBUG = false;

// BackpackSystem - 背包系統
// 管理背包中的物品（種子、農作物、道具），與伺服器 API 同步

import { CropData } from '../scenes/FarmScene';

export interface BackpackItem {
  id: number;
  itemType: 'seed' | 'crop' | 'item' | 'livestock';
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
  items: BackpackItem[];
  livestock: BackpackItem[];
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
    if (DEBUG) { console.log('[BackpackSystem] Token 過期，嘗試刷新...'); }
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
    items: [],
    livestock: [],
    loading: false,
    error: null,
  };
  private listeners: Set<BackpackListener> = new Set();

  // ── Livestock localStorage 持久化（原子性更新） ──
  private static readonly LIVESTOCK_STORAGE_KEY = 'tlo_farm_inventory_livestock';

  // 原子性更新：只改指定 itemId 的數量，不覆蓋其他物品
  updateLivestockItem(itemId: number, delta: number): void {
    const idx = this.state.livestock.findIndex(i => i.itemId === itemId);
    const updated = [...this.state.livestock];

    if (idx !== -1) {
      const newAmount = (updated[idx].amount ?? 0) + delta;
      if (newAmount <= 0) {
        updated.splice(idx, 1);
      } else {
        updated[idx] = { ...updated[idx], amount: newAmount };
      }
    } else if (delta > 0) {
      // 不存在且要增加：新增
      const newItem = this._makeLivestockItem(itemId);
      if (newItem) {
        updated.push({ ...newItem, amount: delta });
      }
    }

    this.setState({ livestock: updated });
    this.saveLivestockLocal();
  }

  // 讀取當前 livestock 中的某 itemId（如用於 log）
  getLivestockItem(itemId: number): BackpackItem | undefined {
    return this.state.livestock.find(i => i.itemId === itemId);
  }

  private saveLivestockLocal(): void {
    try {
      localStorage.setItem(
        BackpackSystem.LIVESTOCK_STORAGE_KEY,
        JSON.stringify(this.state.livestock)
      );
    } catch (e) {
      console.warn('[BackpackSystem] Failed to save livestock localStorage:', e);
    }
  }

  private loadLivestockLocal(): BackpackItem[] {
    try {
      const raw = localStorage.getItem(BackpackSystem.LIVESTOCK_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as BackpackItem[];
      return parsed;
    } catch (e) {
      console.warn('[BackpackSystem] Failed to load livestock localStorage:', e);
      return [];
    }
  }

  subscribe(listener: BackpackListener): () => void {
    this.listeners.add(listener);
    listener({
      seeds: this.state.seeds ?? [],
      crops: this.state.crops ?? [],
      items: this.state.items ?? [],
      livestock: this.state.livestock ?? [],
      loading: this.state.loading,
      error: this.state.error,
    });
    return () => this.listeners.delete(listener);
  }

  private notify() {
    if (DEBUG) { console.log('[BACKPACK SYSTEM STATE]', this.state); }
    this.listeners.forEach(l => l({
      seeds: this.state.seeds ?? [],
      crops: this.state.crops ?? [],
      items: this.state.items ?? [],
      livestock: this.state.livestock ?? [],
      loading: this.state.loading,
      error: this.state.error,
    }));
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
      const [seeds, crops, items, apiLivestock] = await Promise.all([
        this.fetchItems('seed'),
        this.fetchItems('crop'),
        this.fetchItems('item'),
        this.fetchItems('livestock'),
      ]);
      // Merge：localStorage 永遠是事實來源（本地操作的紀錄）
      // API 結果只用來補充 localStorage 沒有的 itemId
      // 注意：itemId=1 在 items 表是普通肥料，在 crops 表是小麥，不是雞蛋
      //       若 localStorage 有 itemId=1 的殘留資料，直接忽略（避免假雞蛋顯示）
      const mergedMap = new Map<string, BackpackItem>();
      const localSaved = this.loadLivestockLocal();
      for (const localItem of localSaved) {
        if (localItem.itemId === 1) {
          // itemId=1 不是雞蛋，是小麥/肥料，忽略並清除
          continue;
        }
        mergedMap.set(String(localItem.itemId), { ...localItem });
      }
      // 再用 API 結果補充（只加 API 有而 localStorage 沒有的）
      for (const apiItem of apiLivestock) {
        const key = String(apiItem.itemId);
        if (!mergedMap.has(key)) {
          mergedMap.set(key, apiItem);
        }
      }
      // feed (itemId=2) 只出現在畜牧分頁，不出現在道具分頁
      const itemsWithoutFeed = items.filter((i: BackpackItem) => i.itemId !== 2);
      // Migration：如果 'items' API 回傳中有 feed (itemId=2)，寫入 livestock localStorage
      // 只在從未執行過 migration 時才做；且若本地已有 feed 不覆蓋（保留本地已扣的數量）
      const MIGRATION_KEY = 'tlo_feed_migration_done';
      const feedInItems = items.find((i: BackpackItem) => i.itemId === 2);
      const localSaved2 = this.loadLivestockLocal();
      const localFeedIdx = localSaved2.findIndex((item: any) => item.itemId === 2);
      const hasLocalFeed = localFeedIdx !== -1;

      if (localStorage.getItem(MIGRATION_KEY) === '1') {
        // 已做過 migration，不再覆蓋本地資料
      } else if (feedInItems && feedInItems.amount > 0) {
        // 從未 migration，且 API 有 feed：寫入本地（若本地已有 feed 不覆蓋）
        if (hasLocalFeed) {
        } else {
          localSaved2.push({ id: 0, itemType: 'livestock', itemId: 2, amount: feedInItems.amount, name: '普通飼料', sprite: 'feed_normal.png', sellPrice: 0, growTimeSec: 0 });
          localStorage.setItem(BackpackSystem.LIVESTOCK_STORAGE_KEY, JSON.stringify(localSaved2));
        }
        localStorage.setItem(MIGRATION_KEY, '1');
      } else if (feedInItems && feedInItems.amount <= 0 && hasLocalFeed) {
        // API feed 已扣到 0，但本地還有（或已扣到 0），標記已完成
        localStorage.setItem(MIGRATION_KEY, '1');
      }
      const mergedLivestock = Array.from(mergedMap.values());
      // 同步清理後的 livestock 回 localStorage（去除 itemId=1 假雞蛋殘留）
      this.setState({ seeds, crops, items: itemsWithoutFeed, livestock: mergedLivestock, loading: false });
      // 立即寫回 localStorage（下次 fetchAll 不會重複出現假雞蛋）
      try {
        localStorage.setItem(BackpackSystem.LIVESTOCK_STORAGE_KEY, JSON.stringify(mergedLivestock));
      } catch (e) { /* ignore */ }
    } catch (err: any) {
      this.setState({ loading: false, error: err.message, livestock: this.state.livestock });
    }
  }

  async fetchItems(type: 'seed' | 'crop' | 'item' | 'livestock', page = 1, limit = 50): Promise<BackpackItem[]> {
    const res = await authFetch(`/api/inventory?type=${type}&page=${page}&limit=${limit}`);
    const data = await res.json();
        if (!data.success) throw new Error(data.message || '取得背包失敗');
    return data.inventory || [];
  }

  // 從背包扣除物品（本地樂觀更新）
  // 注意：這個函式只做本地樂觀更新，不打 API
  // API 呼叫和同步由呼叫端（如 plantCrop）處理
  deductItem(itemType: 'seed' | 'crop' | 'item' | 'livestock', itemId: number): boolean {
    let items: BackpackItem[];
    if (itemType === 'seed') items = this.state.seeds;
    else if (itemType === 'crop') items = this.state.crops;
    else if (itemType === 'livestock') items = this.state.livestock;
    else items = this.state.items;
    
    const idx = items.findIndex(i => i.itemId === itemId && i.amount > 0);
    if (idx === -1) return false;

    // 樂觀更新
    const updated = [...items];
    updated[idx] = { ...updated[idx], amount: updated[idx].amount - 1 };
    if (updated[idx].amount === 0) updated.splice(idx, 1);

    if (itemType === 'seed') {
      this.setState({ seeds: updated });
    } else if (itemType === 'crop') {
      this.setState({ crops: updated });
    } else if (itemType === 'livestock') {
      this.setState({ livestock: updated });
      this.saveLivestockLocal();
    } else {
      this.setState({ items: updated });
    }

    return true;
  }

  // 補償：加回物品到背包（只用於 revert 失敗的操作，不打 API）
  addItem(itemType: 'seed' | 'crop' | 'item' | 'livestock', itemId: number): void {
    let items: BackpackItem[];
    if (itemType === 'seed') items = this.state.seeds;
    else if (itemType === 'crop') items = this.state.crops;
    else if (itemType === 'livestock') items = this.state.livestock;
    else items = this.state.items;
    
    const idx = items.findIndex(i => i.itemId === itemId);
    const updated = [...items];
    
    if (idx !== -1) {
      // 已有此物品，加數量
      updated[idx] = { ...updated[idx], amount: updated[idx].amount + 1 };
    } else {
      // 沒有此物品，新增一筆記錄（livestock 物品有 name/sprite）
      const newItem = this._makeLivestockItem(itemId);
      if (newItem) {
        updated.push(newItem);
      } else {
        updated.push({ id: 0, itemType: itemType as any, itemId, amount: 1, name: '', sprite: '', sellPrice: 0, growTimeSec: 0 });
      }
    }

    if (itemType === 'seed') {
      this.setState({ seeds: updated });
    } else if (itemType === 'crop') {
      this.setState({ crops: updated });
    } else if (itemType === 'livestock') {
      this.setState({ livestock: updated });
      this.saveLivestockLocal();
    } else {
      this.setState({ items: updated });
    }
  }

  // 畜牧物品靜態資料
  private _makeLivestockItem(itemId: number): BackpackItem | null {
    const livestockItems: Record<number, { name: string; sprite: string; sellPrice: number }> = {
      1: { name: '雞蛋', sprite: 'egg.png', sellPrice: 5 },
      2: { name: '普通飼料', sprite: 'feed_normal.png', sellPrice: 0 },
    };
    const info = livestockItems[itemId];
    if (!info) return null;
    return { id: 0, itemType: 'livestock', itemId, amount: 1, name: info.name, sprite: info.sprite, sellPrice: info.sellPrice, growTimeSec: 0 };
  }

  // 賣出作物
  async sellItem(itemId: number): Promise<{ success: boolean; newGold: number; message: string }> {
    // 優先從 crops 找
    const cropItem = this.state.crops.find(i => i.id === itemId);
    if (cropItem) {
      try {
        const res = await authFetch('/api/shop/sell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropId: cropItem.itemId, amount: 1 }),
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

    // 從 livestock 找
    const liveItem = this.state.livestock.find(i => i.id === itemId);
    if (liveItem) {
      try {
        const res = await authFetch('/api/shop/sell-livestock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: liveItem.itemId, amount: 1 }),
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

    return { success: false, newGold: 0, message: '物品不存在' };
  }

  getSeedCount(cropId: number): number {
    const item = this.state.seeds.find(i => i.itemId === cropId);
    return item?.amount ?? 0;
  }
}

export const backpackSystem = new BackpackSystem();
export default backpackSystem;

// ============================================================
// 背包道具圖示映射（統一管理）
// 圖示路徑與商店 SeedShopModal 一致
// ============================================================

const DEBUG = false;
// ============================================================
// 背包道具圖示映射（統一管理）
// 圖示路徑與商店 SeedShopModal 一致
// ============================================================

// ── 種子圖示（itemId → icon 路徑）─────────────────────────
// crops table: id 1=小麥, 2=玉米, 3=紅蘿蔔, 4=馬鈴薯, 5=甘蔗, 6+=預留
export const seedIconById: Record<number, string> = {
  1: '/assets/icon/cropped/icon_seed_wheat.png',
  2: '/assets/icon/cropped/icon_seed_corn.png',
  3: '/assets/icon/cropped/icon_seed_carrot.png',
  4: '/assets/icon/cropped/icon_seed_potato.png',
  5: '/assets/crops/甘蔗種子.png',   // 甘蔗
  6: '/assets/icon/cropped/icon_seed.png',  // 南瓜 (無專用)
  7: '/assets/icon/cropped/icon_seed.png',  // 胡蘿蔔 (無專用)
  8: '/assets/icon/cropped/icon_seed.png',  // 藍莓 (無專用)
};

// ── 果實圖示（itemId → icon 路徑）─────────────────────────
export const fruitIconById: Record<number, string> = {
  1: '/assets/icon/cropped/icon_fruit_wheat.png',
  2: '/assets/icon/cropped/icon_fruit_corn.png',
  3: '/assets/icon/cropped/icon_fruit_carrot.png',  // 紅蘿蔔
  4: '/assets/icon/cropped/icon_fruit_potato.png',
  5: '/assets/icon/cropped/icon_fruit.png',   // 西瓜 (無專用)
  6: '/assets/icon/cropped/icon_fruit.png',   // 南瓜 (無專用)
  7: '/assets/icon/cropped/icon_fruit.png',   // 胡蘿蔔 (無專用)
  8: '/assets/icon/cropped/icon_fruit.png',   // 藍莓 (無專用)
};

// ── 道具圖示（itemId → icon 路徑）─────────────────────────
export const itemIconById: Record<number, string> = {
  1: '/assets/icon/普通肥料.png', // 普通肥料
};

export const itemIconByName: Record<string, string> = {
  普通肥料: '/assets/icon/普通肥料.png',
  '普通肥料.png': '/assets/icon/普通肥料.png',
  normal_fertilizer: '/assets/icon/普通肥料.png',
  普通飼料: '/assets/icon/icon_feed.png.png',
  '普通飼料.png': '/assets/icon/icon_feed.png.png',
  common_feed: '/assets/icon/icon_feed.png.png',
};

// ── 畜牧圖示（itemId → icon 路徑）────────────────────────
export const livestockIconById: Record<number, string> = {
  1: '/assets/animals/egg.png',   // 雞蛋
  2: '/assets/items/feed_normal.png', // 普通飼料
};

// ── Fallback ──
export const FALLBACK_ICON = '/assets/ui/ui_slot_normal.png';

// ── 統一 icon 取得函式 ──
export function getInventoryIcon(item: {
  itemType: string;
  itemId?: number;
  name?: string;
  sprite?: string;
}): string {
  if (DEBUG) { console.log('[GET INVENTORY ICON]', {
    itemType: item.itemType,
    itemId: item.itemId,
    name: item.name,
    sprite: item.sprite,
  }); }

  // ── seed ──
  if (item.itemType === 'seed') {
    if (item.itemId && seedIconById[item.itemId]) {
      const icon = seedIconById[item.itemId]!;
      if (DEBUG) { console.log('[GET INVENTORY ICON] matched by itemId', { itemId: item.itemId, icon }); }
      return icon;
    }
    console.warn('[BACKPACK ICON MISSING]', {
      itemType: item.itemType,
      itemId: item.itemId,
      name: item.name,
    });
    return FALLBACK_ICON;
  }

  // ── crop ──
  if (item.itemType === 'crop') {
    if (item.itemId && fruitIconById[item.itemId]) {
      const icon = fruitIconById[item.itemId]!;
      if (DEBUG) { console.log('[GET INVENTORY ICON] matched by itemId', { itemId: item.itemId, icon }); }
      return icon;
    }
    console.warn('[BACKPACK ICON MISSING]', {
      itemType: item.itemType,
      itemId: item.itemId,
      name: item.name,
    });
    return FALLBACK_ICON;
  }

  // ── item (道具) ──
  if (item.itemType === 'item') {
    // 優先用 itemId 查 itemIconById
    if (item.itemId && itemIconById[item.itemId]) {
      return itemIconById[item.itemId]!;
    }
    // 再用 sprite 或 name 查 itemIconByName
    if (item.sprite && itemIconByName[item.sprite]) {
      return itemIconByName[item.sprite]!;
    }
    if (item.name && itemIconByName[item.name]) {
      return itemIconByName[item.name]!;
    }
    // Fallback
    console.warn('[BACKPACK ICON MISSING]', {
      itemType: item.itemType,
      itemId: item.itemId,
      name: item.name,
      sprite: item.sprite,
    });
    return FALLBACK_ICON;
  }

  // ── livestock ──
  if (item.itemType === 'livestock') {
    if (item.itemId && livestockIconById[item.itemId]) {
      return livestockIconById[item.itemId]!;
    }
    if (item.sprite) {
      return `/assets/animals/${item.sprite}`;
    }
    console.warn('[BACKPACK ICON MISSING]', {
      itemType: item.itemType,
      itemId: item.itemId,
      name: item.name,
    });
    return FALLBACK_ICON;
  }

  // 完全未知
  console.warn('[BACKPACK ICON MISSING]', {
    itemType: item.itemType,
    itemId: item.itemId,
    name: item.name,
    reason: 'unknown itemType',
  });
  return FALLBACK_ICON;
}

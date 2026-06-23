// Hotbar 五個按鈕的 icon 路徑（使用裁切後的單一 icon）
export const HotbarIconMap = {
  inventory: '/assets/icon/hotbar/icon_inventory_hotbar.png',
  shop: '/assets/icon/hotbar/icon_shop_hotbar.png',
  order: '/assets/icon/hotbar/icon_order_hotbar.png',
  quest: '/assets/icon/hotbar/icon_quest_hotbar.png',
  player: '/assets/icon/hotbar/icon_player_hotbar.png',
  event: '/assets/icon/hotbar/icon_event.png',
} as const;

export type HotbarAction = keyof typeof HotbarIconMap;

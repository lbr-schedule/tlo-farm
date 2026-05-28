# T-LO 像素農場 - 完整遊戲專案

## 📁 完整資料夾結構

```
tlo-farm/
├── apps/
│   ├── client/                              # React + Vite 前端
│   │   ├── src/
│   │   │   ├── components/                  # React 組件
│   │   │   ├── hooks/
│   │   │   │   └── useAuth.tsx             # 認證鉤子
│   │   │   ├── pages/
│   │   │   │   ├── LoginPage.tsx           # 登入頁
│   │   │   │   ├── RegisterPage.tsx        # 註冊頁
│   │   │   │   └── GamePage.tsx            # 遊戲頁（Phaser）
│   │   │   ├── scenes/
│   │   │   │   └── FarmScene.ts            # Phaser 農場場景
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── index.css
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── server/                             # Express 後端 API
│       ├── src/
│       │   ├── middleware/
│       │   │   └── auth.ts                # JWT 認證中介層
│       │   ├── routes/
│       │   │   ├── auth.ts                # 登入/註冊/刷新/登出
│       │   │   ├── farm.ts                # 農場操作（種植/收成/澆水）
│       │   │   ├── shop.ts                # 商店（購買/賣出）
│       │   │   └── inventory.ts           # 背包管理
│       │   └── index.ts                   # 伺服器入口
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── shared/                            # 共用類型
│   │   ├── src/
│   │   │   └── index.ts                  # Types、API類型、等級經驗常數
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── database/                          # Drizzle ORM + Turso
│       ├── src/
│       │   ├── index.ts                  # 資料庫連線
│       │   ├── seed.ts                   # 作物資料初始化
│       │   └── schema/
│       │       └── index.ts              # users, crops, farm_tiles, inventories
│       ├── drizzle.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
├── .env.example
├── .eslintrc.json
├── .prettierrc
└── README.md
```

---

## 🔌 API Routes

### 認證 API (`/api/auth`)

| 方法 | 路徑 | 說明 | 需要認證 |
|------|------|------|----------|
| POST | `/api/auth/register` | 註冊新帳號 | ❌ |
| POST | `/api/auth/login` | 會員登入 | ❌ |
| POST | `/api/auth/refresh` | 刷新 Access Token | ❌ |
| POST | `/api/auth/logout` | 會員登出 | ❌ |
| GET | `/api/auth/me` | 取得當前用戶資料 | ✅ |

### 農場 API (`/api/farm`)

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/farm/status` | 取得農場狀態 |
| POST | `/api/farm/plant` | 種植作物 |
| POST | `/api/farm/harvest` | 收成作物 |
| POST | `/api/farm/water` | 澆水加速 |
| GET | `/api/farm/crops` | 取得作物清單 |

### 商店 API (`/api/shop`)

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/shop/items` | 取得商店物品 |
| POST | `/api/shop/buy` | 購買種子 |
| POST | `/api/shop/sell` | 賣出作物 |

### 背包 API (`/api/inventory`)

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/inventory` | 取得背包內容 |
| POST | `/api/inventory/use` | 使用道具 |

---

## 📊 Database Schema

### users（用戶資料表）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INTEGER | 主鍵，自動遞增 |
| account | TEXT | 帳號（唯一） |
| password_hash | TEXT | 密碼雜湊（bcrypt） |
| nickname | TEXT | 遊戲暱稱 |
| email | TEXT | 電子郵件（可選） |
| level | INTEGER | 等級（預設 1） |
| exp | INTEGER | 經驗值（預設 0） |
| gold | INTEGER | 金幣（預設 500） |
| created_at | TIMESTAMP | 創建時間 |
| last_login_at | TIMESTAMP | 最後登入時間 |

### crops（作物資料表）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INTEGER | 主鍵 |
| name_zh_tw | TEXT | 中文名稱 |
| grow_time_sec | INTEGER | 生長時間（秒） |
| sell_price | INTEGER | 賣出價格 |
| buy_price | INTEGER | 購買價格 |
| exp | INTEGER | 獲得經驗值 |
| sprite | TEXT | 圖示資源名稱 |
| required_level | INTEGER | 需要的等級 |

### farm_tiles（農場土地資料表）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INTEGER | 主鍵 |
| user_id | INTEGER | 玩家 ID |
| x | INTEGER | X 座標（0-9） |
| y | INTEGER | Y 座標（0-9） |
| crop_id | INTEGER | 作物 ID（可空） |
| planted_at | TIMESTAMP | 種植時間 |
| finish_at | TIMESTAMP | 成熟時間 |
| state | TEXT | 狀態（empty/growing/ready） |

### inventories（背包資料表）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | INTEGER | 主鍵 |
| user_id | INTEGER | 玩家 ID |
| item_type | TEXT | 物品類型（seed/crop） |
| item_id | INTEGER | 物品 ID |
| amount | INTEGER | 數量 |

---

## 🌾 作物清單

| 等級 | 作物 | 生長時間 | 買價 | 賣價 | 經驗 |
|------|------|----------|------|------|------|
| 1 | 小麥 | 30秒 | 5 | 5 | 10 |
| 1 | 玉米 | 60秒 | 10 | 15 | 20 |
| 2 | 草莓 | 120秒 | 20 | 30 | 40 |
| 2 | 胡蘿蔔 | 90秒 | 18 | 25 | 30 |
| 3 | 番茄 | 180秒 | 35 | 50 | 60 |
| 3 | 藍莓 | 150秒 | 28 | 40 | 50 |
| 4 | 南瓜 | 240秒 | 55 | 80 | 80 |
| 5 | 西瓜 | 300秒 | 70 | 100 | 100 |

---

## 🎮 等級系統

### 等級與經驗需求

| 等級 | 需要經驗值 |
|------|-----------|
| 1 | 0 |
| 2 | 100 |
| 3 | 250 |
| 4 | 500 |
| 5 | 1000 |
| 6 | 2000 |
| 7 | 4000 |
| 8 | 8000 |

### 等級解鎖

- **Lv.1**: 小麥、玉米
- **Lv.2**: 草莓、胡蘿蔔
- **Lv.3**: 番茄、藍莓
- **Lv.4**: 南瓜
- **Lv.5**: 西瓜

---

## 🔐 Middleware

### authMiddleware

用於保護需要認證的路由。

**使用方式：**
```typescript
import { authMiddleware } from './middleware/auth';

app.use('/api/farm', authMiddleware, farmRouter);
```

**失敗回應：**
- 未提供 Token：401 `{"success": false, "message": "未提供認證令牌"}`
- Token 過期：401 `{"success": false, "message": "認證令牌已過期，請重新登入"}`
- Token 無效：401 `{"success": false, "message": "無效的認證令牌"}`

---

## 🚀 啟動方式

```bash
cd /Users/lbrrobot/.openclaw/workspace/tlo-farm

# 安裝 pnpm（如需要）
npm install -g pnpm

# 安裝依賴
npx pnpm install

# 複製環境變數
cp .env.example .env
# 編輯 .env 填入：
#   DATABASE_URL=libsql://xxx.turso.io
#   DATABASE_AUTH_TOKEN=xxx
#   JWT_SECRET=your-secret-key

# 初始化資料庫
npx pnpm --filter @tlo-farm/database push

# 初始化作物資料
npx pnpm --filter @tlo-farm/database seed

# 啟動開發伺服器
npx pnpm dev

# 或個別啟動
npx pnpm --filter @tlo-farm/server dev    # 後端 :3001
npx pnpm --filter @tlo-farm/client dev     # 前端 :5173
```

---

## 📝 遊戲操作說明

### 工具列

| 工具 | 說明 |
|------|------|
| 🌱 播種 | 點擊空地種植選擇的作物 |
| 💧 澆水 | 對生長中的作物澆水 |
| 🌾 收成 | 收取成熟的作物 |

### 作物成熟判定

使用 `finish_at` 時間戳判定：
- `現在時間 > finish_at` → 可收成
- 不使用 setTimeout/setInterval

### 農場地圖

- 10x10 網格
- Tile Size: 32x32
- 邊緣為草地和樹木裝飾
- 中心為可耕作土壤

---

## 🛠️ 技術棧

- **前端**: React 18 + TypeScript + Vite + Phaser 3
- **後端**: Express + TypeScript
- **資料庫**: Turso (libSQL) + Drizzle ORM
- **認證**: JWT + bcrypt
- **字體**: 俐方體11號 (Cubic 11)
- **風格**: 16-bit 像素美術

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import authRouter from './routes/auth';
import { authMiddleware } from './middleware/auth';
import farmRouter from './routes/farm';
import shopRouter from './routes/shop';
import inventoryRouter from './routes/inventory';
import ordersRouter from './routes/orders';
import tasksRouter from './routes/tasks';
import playerRouter from './routes/player';
import eventsRouter from './routes/events';
import animalsRouter from './routes/animals';
import workshopRouter from './routes/workshop';
import gameRouter from './routes/game';

const app = express();
const PORT = process.env.PORT || 3001;

// 中間件
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// 開放上傳資料夾（開發環境用）
const UPLOADS_DIR = path.join(process.cwd(), '../client/public/uploads');
app.use('/uploads', express.static(UPLOADS_DIR));

// 健康檢查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API 路由
app.use('/api/auth', authRouter);

// 公開的農場路由（不需要認證）
app.get('/api/farm/crops', async (_req, res) => {
  try {
    const { db } = await import('@tlo-farm/database');
    const cropResult = await db.execute(
      `SELECT id, name_zh_tw as nameZhTw, grow_time_sec as growTimeSec, sell_price as sellPrice, buy_price as buyPrice, exp, sprite, required_level as requiredLevel FROM crops`
    );
    return res.json({ success: true, crops: cropResult.rows || [] });
  } catch (err) {
    console.error('取得作物清單錯誤:', err);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

// 需要認證的路由
app.use('/api/farm', authMiddleware, farmRouter);
app.use('/api/shop', authMiddleware, shopRouter);
app.use('/api/inventory', authMiddleware, inventoryRouter);
app.use('/api/orders', authMiddleware, ordersRouter);
app.use('/api/tasks', authMiddleware, tasksRouter);
app.use('/api/player', authMiddleware, playerRouter);
app.use('/api/events', authMiddleware, eventsRouter);
app.use('/api/animals', authMiddleware, animalsRouter);
app.use('/api/workshop', authMiddleware, workshopRouter);

// 遊戲通用資料路由
app.use('/api/game', gameRouter);

// Serve client static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// 錯誤處理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('未處理的錯誤:', err);
  res.status(500).json({
    success: false,
    message: '伺服器內部錯誤'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器已啟動: http://localhost:${PORT}`);
  console.log(`📦 環境: ${process.env.NODE_ENV || 'development'}`);
});

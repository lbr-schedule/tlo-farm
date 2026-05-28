import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import authRouter from './routes/auth';
import { authMiddleware } from './middleware/auth';
import farmRouter from './routes/farm';
import shopRouter from './routes/shop';
import inventoryRouter from './routes/inventory';

const app = express();
const PORT = process.env.PORT || 3001;

// 中間件
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// 健康檢查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API 路由
app.use('/api/auth', authRouter);

// 需要認證的路由
app.use('/api/farm', authMiddleware, farmRouter);
app.use('/api/shop', authMiddleware, shopRouter);
app.use('/api/inventory', authMiddleware, inventoryRouter);

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

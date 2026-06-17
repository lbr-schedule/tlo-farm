import { Router, Request, Response } from 'express';

const router = Router();

// 廣告圖片清單（靜態備用）
const AD_IMAGES = [
  '/assets/ads/ad1.png',
  '/assets/ads/ad2.png',
  '/assets/ads/ad3.png',
  '/assets/ads/ad4.png',
  '/assets/ads/ad5.png',
  '/assets/ads/ad6.png',
  '/assets/ads/ad7.png',
  '/assets/ads/ad8.png',
  '/assets/ads/ad9.png',
  '/assets/ads/ad10.png',
  '/assets/ads/ad11.png',
  '/assets/ads/ad12.png',
  '/assets/ads/ad13.png',
  '/assets/ads/ad14.png',
  '/assets/ads/ad15.png',
  '/assets/ads/ad16.png',
];

// 取得隨機廣告（公開，不需要認證）
router.get('/ad', async (req: Request, res: Response) => {
  try {
    // 嘗試從 BBR Garage API 取得今日新照片
    let adPhotos: { imageUrl: string; username: string; caption: string; igUrl: string }[] = [];
    try {
      const categories = ['街車', '仿賽', 'ADV', '美式巡航', '滑胎車', '越野車'];
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const bbrRes = await fetch(`https://bbr-garage.up.railway.app/api/photos/${encodeURIComponent(cat)}?limit=4`);
      if (bbrRes.ok) {
        const bbrData = await bbrRes.json();
        if (bbrData.success && bbrData.photos && bbrData.photos.length > 0) {
          adPhotos = bbrData.photos.slice(0, 4).map((p: any) => ({
            imageUrl: p.imageUrl || '', // base64 data:image/jpeg;base64,...
            username: p.username,
            caption: p.caption || '',
            igUrl: p.igUrl || ''
          }));
        }
      }
    } catch (e) {
      console.log('[Roulette Ad] BBR 照片取得失敗:', e);
    }

    // 如果有拿到 BBR 照片，回傳（imageUrl 是 base64 data URL）
    if (adPhotos.length > 0) {
      const ad = adPhotos[Math.floor(Math.random() * adPhotos.length)];
      return res.json({
        success: true,
        adImage: ad.imageUrl,       // base64 data URL
        adUsername: ad.username,
        adCaption: ad.caption,
        adLink: ad.igUrl || 'https://www.instagram.com/lbr_home62/',
        isBbrPhoto: true
      });
    }

    // 否則用預設靜態廣告
    const randomAd = AD_IMAGES[Math.floor(Math.random() * AD_IMAGES.length)];
    return res.json({
      success: true,
      adImage: randomAd,
      isBbrPhoto: false
    });
  } catch (error) {
    console.error('[Roulette Ad] 取得廣告錯誤:', error);
    return res.status(500).json({ success: false, message: '伺服器錯誤' });
  }
});

export default router;

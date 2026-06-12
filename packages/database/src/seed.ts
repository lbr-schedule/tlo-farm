import { db, crops } from './index';

async function seedCrops() {
  console.log('🌱 開始種植作物資料...');

  const cropData = [
    {
      id: 1,
      nameZhTw: '小麥',
      growTimeSec: 30,
      sellPrice: 10,
      buyPrice: 5,
      exp: 2,
      sprite: 'crop_wheat',
      requiredLevel: 1
    },
    {
      id: 2,
      nameZhTw: '玉米',
      growTimeSec: 45,
      sellPrice: 20,
      buyPrice: 10,
      exp: 3,
      sprite: 'crop_corn',
      requiredLevel: 1
    },
    {
      id: 3,
      nameZhTw: '紅蘿蔔',
      growTimeSec: 60,
      sellPrice: 35,
      buyPrice: 15,
      exp: 4,
      sprite: 'crop_carrot',
      requiredLevel: 1
    },
    {
      id: 4,
      nameZhTw: '馬鈴薯',
      growTimeSec: 90,
      sellPrice: 55,
      buyPrice: 25,
      exp: 5,
      sprite: 'crop_potato',
      requiredLevel: 1
    },
    {
      id: 5,
      nameZhTw: '西瓜',
      growTimeSec: 300,
      sellPrice: 100,
      buyPrice: 70,
      exp: 100,
      sprite: 'crop_watermelon',
      requiredLevel: 5
    },
    {
      id: 6,
      nameZhTw: '南瓜',
      growTimeSec: 240,
      sellPrice: 80,
      buyPrice: 55,
      exp: 80,
      sprite: 'crop_pumpkin',
      requiredLevel: 4
    },
    {
      id: 7,
      nameZhTw: '胡蘿蔔',
      growTimeSec: 90,
      sellPrice: 25,
      buyPrice: 18,
      exp: 30,
      sprite: 'crop_carrot',
      requiredLevel: 2
    },
    {
      id: 8,
      nameZhTw: '藍莓',
      growTimeSec: 150,
      sellPrice: 40,
      buyPrice: 28,
      exp: 50,
      sprite: 'crop_blueberry',
      requiredLevel: 3
    }
  ];

  for (const crop of cropData) {
    try {
      // 檢查是否已存在
      const existing = await db.select().from(crops).where(
        // @ts-ignore - drizzle-orm eq type issue
        (c) => c.id.equals(crop.id)
      ).get();

      if (existing) {
        console.log(`  ⏭️  ${crop.nameZhTw} 已存在，跳過`);
      } else {
        await db.insert(crops).values(crop);
        console.log(`  ✅ ${crop.nameZhTw} 已新增`);
      }
    } catch (error) {
      console.error(`  ❌ 新增 ${crop.nameZhTw} 失敗:`, error);
    }
  }

  console.log('🌱 作物資料種植完成！');
}

seedCrops()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed 失敗:', error);
    process.exit(1);
  });

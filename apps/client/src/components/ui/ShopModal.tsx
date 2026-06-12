// 商店系統 - 整合 SeedShopModal
import SeedShopModal from './SeedShopModal';

interface ShopModalProps {
  onClose: () => void;
  userGold: number;
  userLevel: number;
  onPurchaseSuccess: (newGold: number, message: string) => void;
}

export default function ShopModal(props: ShopModalProps) {
  return <SeedShopModal {...props} />;
}
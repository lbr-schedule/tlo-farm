// 訂單系統 - 空殼頁（MVP 第一階段不做實際邏輯）
import PixelWindow from './PixelWindow';

interface OrderModalProps {
  onClose: () => void;
}

export default function OrderModal({ onClose }: OrderModalProps) {
  return (
    <PixelWindow title="📋 訂單系統" onClose={onClose} width={480}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        fontFamily: "'Cubic 11', sans-serif",
        color: '#5C3D2E',
        gap: '16px'
      }}>
        <div style={{ fontSize: '48px' }}>📋</div>
        <div style={{
          fontSize: '22px',
          fontWeight: 'bold',
          color: '#3d2518',
          textShadow: '2px 2px 0 #d4c4a8'
        }}>
          敬請期待
        </div>
        <div style={{
          fontSize: '14px',
          color: '#8B6243',
          textAlign: 'center'
        }}>
          訂單功能即將開放<br />敬請期待後續更新！
        </div>
      </div>
    </PixelWindow>
  );
}

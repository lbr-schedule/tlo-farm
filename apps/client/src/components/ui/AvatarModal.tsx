import { useEffect, useRef, useState } from 'react';

const DEFAULT_AVATARS = [
  '/assets/avatars/avatar_01.jpg',
  '/assets/avatars/avatar_02.jpg',
  '/assets/avatars/avatar_03.jpg',
  '/assets/avatars/avatar_04.jpg',
  '/assets/avatars/avatar_05.jpg',
  '/assets/avatars/avatar_06.jpg',
];

const DEFAULT_AVATAR = '/assets/icon/hotbar/icon_player_hotbar.png';

interface AvatarModalProps {
  currentAvatar: string | null | undefined;
  onClose: () => void;
  onAvatarUpdate: (newAvatar: string) => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  setPlayerToast: (msg: string) => void;
}

export default function AvatarModal({ currentAvatar, onClose, onAvatarUpdate, authFetch, setPlayerToast }: AvatarModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(currentAvatar || null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Sync selected when currentAvatar changes (modal reopened)
  useEffect(() => {
    if (!preview) {
      setSelected(currentAvatar || null);
    }
  }, [currentAvatar, preview]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setPlayerToast('請上傳 PNG、JPG、JPEG 或 WEBP 圖片');
      setTimeout(() => setPlayerToast(''), 1500);
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setPlayerToast('圖片太大，請選擇 2MB 以下圖片');
      setTimeout(() => setPlayerToast(''), 1500);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(ev.target?.result as string);
      setSelected(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    let avatarUrl = selected || preview;
    if (!avatarUrl) return;

    setUploading(true);
    try {
      // If it's a custom upload (data URL), we need to upload it first
      if (preview && !selected) {
        const res = await authFetch('/api/player/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: preview }),
        });
        const data = await res.json();
        if (data.success) {
          avatarUrl = data.avatarUrl;
        } else {
          setPlayerToast(data.message || '上傳失敗');
          setTimeout(() => setPlayerToast(''), 1500);
          setUploading(false);
          return;
        }
      }

      // Update avatar in database
      const updateRes = await authFetch('/api/player/avatar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl }),
      });
      const updateData = await updateRes.json();
      if (updateData.success) {
        onAvatarUpdate(avatarUrl);
        onClose();
      } else {
        setPlayerToast(updateData.message || '更新失敗');
        setTimeout(() => setPlayerToast(''), 1500);
      }
    } catch {
      setPlayerToast('更新失敗');
      setTimeout(() => setPlayerToast(''), 1500);
    }
    setUploading(false);
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg,#C89A5B 0%,#A07040 100%)',
          border: '4px solid #5A3418',
          borderRadius: '12px',
          padding: '20px',
          width: '90%',
          maxWidth: '380px',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 4px 0 #4B2A12, 0 8px 16px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ position: 'relative', marginBottom: '14px' }}>
          <h3 style={{ color: '#3B2412', fontSize: '16px', fontWeight: 700, textAlign: 'center', margin: 0 }}>更換頭像</h3>
          <button
            onClick={onClose}
            style={{ position: 'absolute', right: 0, top: '-2px', background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#5A3418', padding: 0, lineHeight: 1 }}
          >✕</button>
        </div>

        {/* 預設頭像 */}
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', color: '#5A3418', fontWeight: 700, marginBottom: '8px' }}>預設頭像</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {DEFAULT_AVATARS.map((src) => (
              <div
                key={src}
                onClick={() => { setSelected(src); setPreview(null); }}
                style={{
                  cursor: 'pointer',
                  border: selected === src ? '3px solid #D4B896' : '2px solid #4A2D16',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  boxShadow: selected === src ? '0 0 0 2px #5A3418' : 'none',
                  aspectRatio: '1',
                  position: 'relative',
                }}
              >
                <img
                  src={src}
                  alt="avatar"
                  onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    imageRendering: 'pixelated',
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 分隔線 */}
        <div style={{ height: '1px', background: '#D4B896', margin: '12px 0' }} />

        {/* 自行上傳 */}
        <div>
          <div style={{ fontSize: '12px', color: '#5A3418', fontWeight: 700, marginBottom: '8px' }}>自行上傳</div>

          {/* 預覽 */}
          {preview && (
            <div style={{ marginBottom: '10px', textAlign: 'center' }}>
              <div style={{
                display: 'inline-block',
                width: '72px',
                height: '72px',
                border: '3px solid #4A2D16',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 0 0 2px #D4B896',
              }}>
                <img src={preview || DEFAULT_AVATAR} alt="preview" onError={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', imageRendering: 'pixelated' }} />
              </div>
              <div style={{ fontSize: '11px', color: '#9A8268', marginTop: '4px' }}>預覽</div>
            </div>
          )}

          {/* 選擇圖片按鈕 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%',
              padding: '8px',
              background: '#E8DCC4',
              color: '#5A3418',
              border: '2px solid #4A2D16',
              borderRadius: '8px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            選擇圖片（PNG/JPG/WEBP，最大 2MB）
          </button>
        </div>

        {/* 確認套用 */}
        <button
          onClick={handleSave}
          disabled={uploading || (!selected && !preview)}
          style={{
            width: '100%',
            marginTop: '14px',
            padding: '10px',
            background: (!selected && !preview) ? '#C0A080' : '#5A3418',
            color: '#FFF3D5',
            border: '2px solid #3B2412',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: (!selected && !preview) || uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.7 : 1,
          }}
        >
          {uploading ? '上傳中...' : '確認套用'}
        </button>
      </div>
    </div>
  );
}

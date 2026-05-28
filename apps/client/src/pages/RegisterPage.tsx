import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LoginPage from './LoginPage';

export default function RegisterPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // 這個頁面現在是重新導向到 LoginPage 的註冊模式
    // 實際上用 LoginPage 的 isRegister 狀態切換
    navigate('/login', { replace: true });
  }, [navigate]);

  // 臨時顯示 LoginPage（會自動切換到註冊模式）
  return <LoginPage />;
}

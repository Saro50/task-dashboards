import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './utils/logger';   // 初始化日志 SDK（副作用导入）
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

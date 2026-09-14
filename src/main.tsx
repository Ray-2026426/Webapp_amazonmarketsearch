import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installDomMutationGuards } from './utils/domSafety.ts';

installDomMutationGuards();

/**
 * 开机把构建指纹打到控制台。
 * 用途：用户反馈"刷新了还是老界面"时，让他把这一行发过来，就能确定他打开的是哪次构建
 * （这个项目为此来回猜过好几次）。设置 → 诊断 里也有同样的指纹。
 */
try {
  // eslint-disable-next-line no-console
  console.info(
    `%cKairo 前端构建：${typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : '未知'}`,
    'color:#4f46e5;font-weight:600'
  );
} catch {
  /* 控制台不可用时忽略 */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

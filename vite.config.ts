import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { sellerspriteMcpProxyPlugin } from './server/sellerspriteMcpProxy';
import { devApiPlugin } from './server/devApiPlugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  /**
   * 构建指纹：用于回答"你看到的是哪一次构建"。
   * Vercel 会注入 VERCEL_GIT_COMMIT_SHA / VERCEL_ENV / VERCEL_GIT_COMMIT_REF，本地构建则显示 local。
   */
  const buildStamp = [
    (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
    process.env.VERCEL_ENV || mode,
    process.env.VERCEL_GIT_COMMIT_REF || '',
    new Date().toISOString().slice(0, 16).replace('T', ' '),
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    // devApiPlugin：本地补齐 /api/*（登录、云同步、健康自检），使 npm run dev 与线上行为一致
    plugins: [react(), tailwindcss(), devApiPlugin(env), sellerspriteMcpProxyPlugin(env)],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __BUILD_STAMP__: JSON.stringify(buildStamp),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: false,
      port: 3000,
      host: '0.0.0.0',
      watch: {
        /**
         * 本地开发踩过的坑：devApiPlugin 用 ssrLoadModule 就地编译 api/**\/*.ts，
         * Windows 下会在源文件旁边生成 `.[action].ts.<pid>.<uuid>.tmpdir/*.tmp`，
         * Vite 的 watcher 去 watch 这个临时文件时会抛 EBUSY（resource busy or locked），
         * **直接让 dev server 崩掉**（编辑 api 路由时必现）。
         * 这里忽略编译产物与临时目录，避免"改一行后端代码 dev server 就挂"。
         */
        ignored: ['**/*.tmpdir/**', '**/*.tmp', '**/node_modules/**', '**/dist/**', '**/.git/**'],
      },
      proxy: {
        '/api-proxy/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/gemini/, ''),
        },
        '/api-proxy/openai': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/openai/, ''),
        },
        '/api-proxy/deepseek': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/deepseek/, ''),
        },
        '/api-proxy/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/claude/, ''),
        },
        '/api-proxy/qwen': {
          target: 'https://dashscope.aliyuncs.com',
          changeOrigin: true,
          secure: false,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/qwen/, ''),
          headers: { 'Host': 'dashscope.aliyuncs.com' },
        },
        '/api-proxy/moonshot': {
          target: 'https://api.moonshot.cn',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/moonshot/, ''),
        },
        '/api-proxy/zhipu': {
          target: 'https://open.bigmodel.cn',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/zhipu/, ''),
        },
        '/api-proxy/doubao': {
          target: 'https://ark.cn-beijing.volces.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/doubao/, ''),
        },
        '/api-proxy/sellersprite-mcp': {
          target: 'https://mcp.sellersprite.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/sellersprite-mcp/, '/mcp'),
        },
        '/api-proxy/xydc-mcp': {
          target: 'https://mcp.xydc.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/xydc-mcp/, '/mcp'),
        },
        '/api-proxy/lingxing-mcp': {
          target: 'https://openmcp.lingxing.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api-proxy\/lingxing-mcp/, '/mcp-servers/lingxing-mcp'),
        },
        '/api-proxy/sorftime-mcp': {
          target: 'https://mcp.sorftime.com',
          changeOrigin: true,
          // Key 在 query（?key=），代理会原样转发；路径改到根
          rewrite: () => '/',
        },
      },
    },
  };
});

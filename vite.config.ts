import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
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
          target: 'https://openrouter.fans',
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
      },
    },
  };
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const reactPath = path.resolve(__dirname, './node_modules/react');
const reactDomPath = path.resolve(__dirname, './node_modules/react-dom');
const useHttps = process.env.BLYVE_DEV_HTTPS !== '0';

export default defineConfig({
  plugins: useHttps ? [basicSsl(), react(), tailwindcss()] : [react(), tailwindcss()],
  resolve: {
    alias: {
      // Single React instance — prevents "Cannot read properties of null (reading 'useState')"
      react: reactPath,
      'react-dom': reactDomPath,
      'react/jsx-runtime': path.join(reactPath, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(reactPath, 'jsx-dev-runtime.js'),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'framer-motion',
      'sonner',
      '@tanstack/react-query',
      'i18next',
      'react-i18next',
    ],
  },
  server: {
    strictPort: false,
    host: true,
    headers: {
      'Permissions-Policy': 'camera=*, microphone=*, display-capture=*, fullscreen=*',
    },
    fs: {
      // Don't resolve deps from parent ~/node_modules (duplicate React)
      allow: [path.resolve(__dirname, '.')],
    },
  },
});

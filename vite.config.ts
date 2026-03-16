import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/vk/',
  envPrefix: [
    'VITE_BACKEND_',
    'VITE_BUY_VIA_VK_',
    'VITE_VK_DIALOG_',
    'NEXT_PUBLIC_BACKEND_',
    'NEXT_PUBLIC_BUY_VIA_VK_',
    'NEXT_PUBLIC_VK_DIALOG_',
  ],
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});

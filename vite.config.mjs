import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  base:'./',
  plugins:[tailwind()],
  server:{
    port:5173, strictPort:true,
    proxy:{'/api':'http://127.0.0.1:8787'}
  }
});

import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  base:'./',
  plugins:[tailwind()],
  esbuild:{jsx:'automatic'},
  test:{include:['web-tests/**/*.test.{ts,tsx}'], coverage:{include:['src/**/*.{ts,tsx}'], thresholds:{lines:80,branches:80}}},
  server:{
    port:5173, strictPort:true,
    proxy:{'/api':'http://127.0.0.1:8787'}
  }
});

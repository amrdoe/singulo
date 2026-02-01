import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import singulo from '@singulo/core/vite';

export default defineConfig({
  plugins: [react(), singulo()],
});

import { bootstrap } from '@singulo/core';

// Auto-detect pages
const pages = import.meta.glob('./pages/**/*.singulo.tsx', { eager: true });

bootstrap(pages);

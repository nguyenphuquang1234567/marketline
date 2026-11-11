import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const barlowLicense = readFileSync(new URL('./src/fonts/OFL.txt', import.meta.url), 'utf8');

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    modulePreload: false,
    chunkSizeWarningLimit: 850,
    assetsInlineLimit: Infinity,
    rollupOptions: { output: { entryFileNames: 'marketline.js', inlineDynamicImports: true } },
  },
  plugins: [{
    name: 'portable-script',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      const script = bundle['marketline.js'];
      if (script?.type === 'chunk') script.code = '/*!\n' + barlowLicense + '\n*/\n' + script.code;
      const html = bundle['index.html'];
      if (html?.type === 'asset') {
        html.source = String(html.source)
          .replace(/type="module" crossorigin src="\.\/marketline\.js"/, 'defer src="./marketline.js"');
      }
    },
  }],
});

const { cpSync, mkdirSync, rmSync } = require('node:fs');
const { buildSync } = require('esbuild');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const path of ['index.html', 'hero-prototype.html', 'app.js', 'styles.css', 'projects.json', 'home.json', 'img', 'editor']) {
  cpSync(path, `dist/${path}`, { recursive: true });
}
buildSync({
  entryPoints: ['editor/image-upload.js'],
  outfile: 'dist/editor/image-upload.bundle.js',
  bundle: true,
  format: 'esm',
  minify: true,
});

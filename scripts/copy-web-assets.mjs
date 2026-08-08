import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src', 'web');
const distDir = resolve(__dirname, '..', 'dist', 'web');
const vendorDir = resolve(distDir, 'vendor');

const assets = ['visual.html', 'visual.js'];

mkdirSync(vendorDir, { recursive: true });
for (const file of assets) {
  copyFileSync(resolve(srcDir, file), resolve(distDir, file));
  console.log(`copied ${file} -> dist/web/${file}`);
}

const threeBuild = resolve(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.js');
const threeCore = resolve(__dirname, '..', 'node_modules', 'three', 'build', 'three.core.js');
const orbitControls = resolve(
  __dirname,
  '..',
  'node_modules',
  'three',
  'examples',
  'jsm',
  'controls',
  'OrbitControls.js'
);

copyFileSync(threeBuild, resolve(vendorDir, 'three.module.js'));
console.log('copied three.module.js -> dist/web/vendor/three.module.js');
copyFileSync(threeCore, resolve(vendorDir, 'three.core.js'));
console.log('copied three.core.js -> dist/web/vendor/three.core.js');
copyFileSync(orbitControls, resolve(vendorDir, 'OrbitControls.js'));
console.log('copied OrbitControls.js -> dist/web/vendor/OrbitControls.js');
// also mirror the three/addons/ layout so import-map paths resolve
mkdirSync(resolve(vendorDir, 'controls'), { recursive: true });
copyFileSync(orbitControls, resolve(vendorDir, 'controls', 'OrbitControls.js'));
console.log('copied OrbitControls.js -> dist/web/vendor/controls/OrbitControls.js');

// Line2 addons (for thicker, visible edge lines)
const lineFiles = ['Line2.js', 'LineSegments2.js', 'LineGeometry.js', 'LineSegmentsGeometry.js', 'LineMaterial.js'];
mkdirSync(resolve(vendorDir, 'lines'), { recursive: true });
for (const f of lineFiles) {
  copyFileSync(
    resolve(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm', 'lines', f),
    resolve(vendorDir, 'lines', f)
  );
  console.log(`copied ${f} -> dist/web/vendor/lines/${f}`);
}
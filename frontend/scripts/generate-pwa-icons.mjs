/**
 * Genera iconos PNG para la PWA a partir de los SVG existentes.
 * Requiere: npm install -D sharp  (solo devDependency)
 *
 * Uso: node scripts/generate-pwa-icons.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public', 'icons');

const SIZES = [192, 512];

async function generateIcons() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('❌  sharp no está instalado. Ejecuta: npm install -D sharp');
    process.exit(1);
  }

  for (const size of SIZES) {
    const svgPath = join(publicDir, `icon-${size}.svg`);
    const pngPath = join(publicDir, `icon-${size}.png`);

    if (!existsSync(svgPath)) {
      console.warn(`⚠️  No se encontró ${svgPath}`);
      continue;
    }

    const svgBuffer = readFileSync(svgPath);

    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`✅  Generado: icons/icon-${size}.png`);
  }

  console.log('\n✅  Iconos PNG generados. Recuerda hacer commit de los archivos .png');
}

generateIcons().catch((err) => {
  console.error('Error generando iconos:', err);
  process.exit(1);
});

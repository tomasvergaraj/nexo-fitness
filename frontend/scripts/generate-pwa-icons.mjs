/**
 * Genera iconos PNG para la PWA a partir del icono maestro de Nexo Fitness.
 *
 * Uso: node scripts/generate-pwa-icons.mjs
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootPublicDir = join(__dirname, '..', 'public');
const sourceIconPath = join(rootPublicDir, 'icon.png');
const publicIconsDir = join(rootPublicDir, 'icons');

const SIZES = [192, 512];

async function generateIcons() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('❌  sharp no está instalado. Ejecuta: npm install -D sharp');
    process.exit(1);
  }

  if (!existsSync(sourceIconPath)) {
    console.error(`❌  No se encontró el icono maestro: ${sourceIconPath}`);
    process.exit(1);
  }

  for (const size of SIZES) {
    const pngPath = join(publicIconsDir, `icon-${size}.png`);

    await sharp(sourceIconPath)
      .resize(size, size)
      .png()
      .toFile(pngPath);

    console.log(`✅  Generado: icons/icon-${size}.png`);
  }

  console.log('\n✅  Iconos PNG generados desde public/icon.png');
}

generateIcons().catch((err) => {
  console.error('Error generando iconos:', err);
  process.exit(1);
});

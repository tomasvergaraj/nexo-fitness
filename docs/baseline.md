# Baseline — Landing pública (nexofitness.cl)

Medición previa a cualquier cambio. **2026-06-10**, Lighthouse 12.8.2 (Chrome 148 headless, desde el VPS) contra **https://nexofitness.cl en producción** (detrás de Cloudflare). Form factor principal: **mobile** (emulación + throttling simulado por defecto de Lighthouse), que es la audiencia declarada de la landing.

## Verificación del artefacto

Build de comprobación a `/tmp` (NO a `landing/` — `emptyOutDir: true` habría destruido los meta tags SEO parchados a mano y `og.png`, que no existen en la fuente `frontend-landing/`):

```
frontend-landing $ vite build --outDir /tmp/landing-baseline-dist
assets/index-CvvuBcYd.css   96.65 kB │ gzip:  16.60 kB
assets/index-CMw7Coa-.js   322.71 kB │ gzip: 100.14 kB
```

Hashes **idénticos** a lo desplegado en `landing/assets/` → lo que sirve prod ES el build de la fuente actual. Medir prod = medir el dist.

## Scores

| Categoría | Mobile | Desktop (ref.) |
|---|---|---|
| Performance | **45** | 82 |
| Accessibility | **89** | 87 |
| Best Practices | **96** | 96 |
| SEO | **92** | 92 |

## Core Web Vitals (mobile)

| Métrica | Valor | Objetivo | Estado |
|---|---|---|---|
| LCP | **10.5 s** | < 2.5 s | 🔴 4× sobre objetivo |
| CLS | **0** | < 0.1 | 🟢 |
| TBT | **1,060 ms** | < 200 ms | 🔴 |
| Max Potential FID (proxy INP) | 670 ms | < 200 ms | 🔴 |
| FCP | 3.1 s | — | 🔴 |
| Speed Index | 4.2 s | — | 🟡 |

Desktop: LCP 2.4 s, CLS 0.026, TBT 70 ms — el problema es esencialmente mobile.

**Fases del LCP (mobile)**: TTFB 512 ms (5%) · **Render Delay 10,036 ms (95%)**. El elemento LCP es `<p class="hero-lead">` con `style="opacity: 1; transform: none"` — llega animado por framer-motion (BlurText/entrada del hero): el texto no existe hasta que descarga el JS, bootea React y termina la animación de opacity.

## Peso del first load de la home

| Recurso | Transfer | Raw |
|---|---|---|
| `assets/index-CMw7Coa-.js` | 98 KB | 322.7 KB |
| `assets/index-CvvuBcYd.css` (render-blocking) | 17 KB | 96.7 KB |
| Google Fonts (CSS + 2 woff2 Manrope/Outfit) | 57 KB | — |
| Cloudflare Insights beacon | 11 KB | — |
| **`icon.png` (logo 40px servido a 1024×1024)** | **1,327 KB** | 1,357 KB |
| **Total página** | **1,513 KB / 11 requests** | — |

JS total transferido: **109 KB** (~100 KB gzip propio + beacon). El icon.png solo es el **88% del peso total**.

## HTML del servidor: solo shell

```
$ curl -s https://nexofitness.cl/ | sed -n '/<body>/,/<\/body>/p'
  <body>
    <div id="root"></div>
  </body>
```

**El hero NO está en el HTML.** 2,238 bytes totales, cero `<h1>`, cero texto visible. Lo único server-side son los meta tags (description, OG completo, twitter, canonical) — que además viven solo en el dist parchado, no en la fuente. 100% CSR, coherente con el render delay del 95%.

## Top 5 problemas por impacto

1. **`icon.png` de 1.36 MB (1024×1024 PNG) para un logo de 40/32 px** (`Nav.tsx:24`, `Footer.tsx:7`). Ahorro estimado por Lighthouse: **~6.7 s y ~1.3 MB** (properly-size + next-gen formats). Sin WebP/AVIF ni pipeline de imágenes. La corrección más barata y de mayor impacto.
2. **CSR sin prerender + animación de entrada bloqueando el LCP**: render delay = 95% del LCP. El hero depende de JS (100 KB gz) + boot de React + animación de opacity de framer-motion. Emitir HTML estático del hero (prerender) y/o animar desde un estado visible quitaría ~8 s de LCP.
3. **JS pesado para una página estática**: bootup 1.7 s, main-thread 6.8 s, DOM 1,367 nodos, TBT 1,060 ms, max-FID 670 ms. React + framer-motion completos para contenido que no cambia.
4. **Render-blocking ≈ 1.26 s**: CSS de Google Fonts (759 ms, CDN — contra la regla de self-host) + `index-*.css` de 96.7 KB raw (424 ms). Sin preload de fuente, sin subset, pesos sueltos (9 entre Manrope y Outfit).
5. **Accesibilidad (89)**: 11 fallos de contraste — patrón dominante `#0891b2` sobre blanco = **3.68:1** (< 4.5 AA) en precios/tags/botones del mockup HowItWorks, con micro-tipografías de 6–10 px; `mobile-drawer` y `mobile-sticky-bar` con `aria-hidden="true"` conteniendo focusables; salto de jerarquía h2→h4; `aria-label` del logo que no contiene su texto visible.

## Hallazgos funcionales (de regalo, fuera del scope perf)

- **El fetch de precios da 404 en prod**: `Pricing.tsx:235` llama `GET /api/v1/public/plans` → `{"detail":"Not Found"}`. El endpoint real es **`/api/v1/billing/public/plans`** (`backend/.../billing.py:47`). La sección siempre cae al array `FALLBACK` hardcodeado mientras el copy dice "Precios directamente desde el sistema — siempre actualizados". Es además el único error de consola (penaliza Best Practices).
- **robots.txt inválido (34 errores, penaliza SEO)**: no existe `robots.txt` en `landing/`; el fallback SPA de nginx responde `index.html` con 200 y Cloudflare le antepone su bloque "Managed content" → resultado: robots.txt con HTML adentro. Fix: archivo `robots.txt` real en `frontend-landing/public/`.

## Resultado post-Fase 1 (2026-06-10, mismas condiciones)

Tras prerender (vite-prerender-plugin), self-host de fuentes (variable, preload), logo 2.6 KB (antes icon.png 1.36 MB), fix endpoint pricing y robots.txt:

| Métrica | Antes | Después |
|---|---|---|
| Performance (mobile) | 45 | **77** |
| LCP | 10.5 s | **2.6 s** |
| CLS | 0 | 0 |
| FCP | 3.1 s | 2.1 s |
| TBT | 1,060 ms | 730 ms |
| Peso total | 1,513 KB | **224 KB** |
| Best Practices | 96 | 100 |
| Hero en HTML del servidor | No (shell) | **Sí** |

Pendiente estructural: TBT/JS (React + framer-motion para página estática — se aborda si hay rediseño), robots.txt con 1 directiva `Content-Signal` de Cloudflare que Lighthouse no reconoce (se quita en el dashboard CF), contraste/a11y (89), íconos below-fold.

## Resultado post-Fase 2 — tokens canónicos (2026-06-10)

Migración a paleta canónica de CLAUDE.md (solo tema claro, sin gradientes/glow/sombras, radio 8px, escala tipográfica tokenizada, derivados AA `--brand-dark #1C7A98` / `--brand-deep #176B86` / `--success-dark #147D57` porque teal y green canónicos fallan AA como texto):

| Métrica | Baseline | Fase 1 | Fase 2 |
|---|---|---|---|
| Performance (mobile) | 45 | 77 | **95** |
| Accessibility | 89 | 89 | **94** |
| LCP | 10.5 s | 2.6 s | **2.5 s** |
| TBT | 1,060 ms | 730 ms | **70 ms** |
| CLS | 0 | 0 | 0 |
| Fallos de contraste | 11 | 13 | **0** |

A11y restante (preexistente, fuera del scope de tokens): `aria-hidden` con focusables en drawer/sticky-bar móvil (2), salto de jerarquía h2→h4 (1), `aria-label` del logo sin el texto visible (1).

## Condiciones de la medición

- Lighthouse 12.8.2 vía `npx`, Chrome 148 (puppeteer cache), `--headless=new --no-sandbox`, throttling simulado default (mobile: Moto G–class, CPU 4×, slow 4G; desktop: preset `desktop`).
- Una pasada por form factor (no mediana de 3) — los valores tienen varianza de ±10%; las conclusiones estructurales (LCP render-delay, peso del PNG, CSR) no dependen de ella.
- Medido a través de Cloudflare (incluye su beacon RUM y el robots.txt gestionado).

## Cierre final (2026-06-11) — mediana de 3 corridas Lighthouse mobile contra prod

Tras toda la serie (prerender → tokens canónicos → hero Stripe/Family con screenshot real → Features con capturas → trust honesto → pricing → FAQ nativo → pasada mobile-first):

| Métrica | Baseline (2026-06-10) | Final (mediana de 3) | Objetivo | Estado |
|---|---|---|---|---|
| Performance (mobile) | 45 | **90** (85–94) | verde | ✅ |
| Accessibility | 89 | **100** (3/3 corridas) | AA | ✅ |
| Best Practices | 96 | **100** | verde | ✅ |
| SEO | 92 | 92 | verde | ✅ (resto = Content-Signal de CF) |
| LCP | 10.5 s | **2.8 s** | < 2.5 s | 🟡 +0.3 s (lab, vía Cloudflare) |
| CLS | 0 | **0.035** (0 / 0.035 / 0.185) | < 0.1 | ✅ mediana (carrera de font swap en ~1/3 corridas lab) |
| TBT (proxy INP) | 1,060 ms | **79 ms** | < 200 ms | ✅ |
| Max Potential FID | 670 ms | 202 ms | < 200 ms | 🟡 límite |
| FCP | 3.1 s | 2.1 s | — | ✅ |
| Peso total | 1,513 KB | **234 KB** | — | −85 % |
| JS first-load (raw) | 322.7 KB | **292.1 KB** | — | −9 % |
| CSS (raw) | 96.6 KB | **40.4 KB** | — | −58 % |
| HTML servido | 2.2 KB (shell vacío) | **44.9 KB con hero + FAQ + pricing** | prerender | ✅ `curl \| grep "Gestión integral"` lo encuentra |
| Código de rutas autenticadas en la home | N/A (proyecto separado) | **0 marcadores** (`AuthGuard`, `/member`, `Sidebar`… = 0 hits en el bundle) | — | ✅ |

### Pendiente (cierre de loop)

1. **LCP 2.8 s vs objetivo 2.5 s** (solo lab/slow-4G): el residuo es CSS render-blocking + boot de React. Bajar más = reemplazar framer-motion por CSS/IntersectionObserver (~30 KB gz) o migrar a estático puro (Astro) si marketing crece.
2. **CLS por font swap en ~1/3 de corridas lab**: fallback con métricas ajustadas (`size-adjust`/`ascent-override` tipo fontaine) lo haría determinista. En campo, las fuentes quedan cacheadas tras la primera visita.
3. **robots.txt — 1 directiva `Content-Signal`** que Lighthouse no reconoce: la inyecta Cloudflare (managed robots.txt); se desactiva en su dashboard, no en el repo. Único punto que retiene SEO en 92.
4. **INP real**: el lab solo da proxies (TBT 79 ms ✅, maxFID 202 ms al límite). Confirmar con datos de campo (CrUX cuando haya tráfico suficiente).
5. **`server.browser-*.js`** (70 KB) queda en disco como artefacto del plugin de prerender — el HTML no lo referencia, nunca se descarga. Cosmético.
6. **Testimonio real**: cita + permiso de Alpha Gimnasio Híbrido (pendiente del dueño, no del código).

## Post-cierre (2026-06-11, commit cf8e359) — los dos pendientes accionables, resueltos

Sin framer-motion (ScrollReveal → IntersectionObserver con gate `html.js`; toast/pulso/escenas → keyframes CSS) y fallbacks de fuente con métricas ajustadas (`size-adjust` calculado de los woff2 reales):

| Métrica | Baseline | Cierre | **Post-cierre (3 corridas)** | Objetivo |
|---|---|---|---|---|
| Performance | 45 | 90 | **96–97** | ✅ |
| LCP | 10.5 s | 2.8 s | **2.4–2.5 s** | ✅ < 2.5 s |
| CLS | 0 | 0.035 (race 1/3) | **0.000–0.035, sin race** | ✅ < 0.1 |
| TBT | 1,060 ms | 79 ms | **24–62 ms** | ✅ |
| Max Potential FID | 670 ms | 202 ms | **88–120 ms** | ✅ < 200 ms |
| JS first-load | 322.7 KB | 292.1 KB | **177.4 KB** (gzip 55.9) | −45 % vs baseline |
| A11y | 89 | 100 | **100** | ✅ |

Bonus: sin JS ahora se ve TODO el contenido (el ocultamiento del reveal está gateado por `html.js`); el HTML prerenderizado quedó sin `opacity:0` inline.

Quedan (no accionables desde el repo): directiva `Content-Signal` de Cloudflare en robots.txt (dashboard CF), INP de campo vía CrUX cuando haya tráfico, y la cita/permiso de Alpha Gimnasio Híbrido.

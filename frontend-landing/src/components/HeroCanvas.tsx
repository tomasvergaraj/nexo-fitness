import { useEffect, useRef } from 'react';

/**
 * Campo de puntos teal animado, detrás del hero, sobre fondo blanco.
 * WebGL crudo (sin three.js) para no engordar el bundle de marketing.
 * - Blending normal (additive se lava sobre blanco).
 * - Respeta prefers-reduced-motion: pinta un frame estático, sin loop.
 * - Pausa cuando la pestaña se oculta o el hero sale de viewport.
 */
export default function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return; // sin WebGL: el hero queda en blanco, sin romper nada

    const VERT = `
      attribute vec2 a_base;
      uniform float u_time;
      uniform float u_size;
      uniform float u_aspect;
      uniform vec2 u_mouse;   // posición del cursor en NDC (-1..1)
      uniform float u_force;  // 0..1, ramp al entrar/salir el mouse
      varying float v_depth;
      void main() {
        float x = a_base.x;
        float y = a_base.y;
        float z = sin(x * 3.0 + u_time) * 0.5 + cos(y * 3.4 + u_time * 0.9) * 0.5;
        float depth = 0.5 + z * 0.18;
        v_depth = depth;
        float px = x + sin(u_time * 0.3) * 0.02;
        float py = y + z * 0.04;

        // Dispersión sutil: empuja los puntos levemente lejos del cursor.
        vec2 d = vec2(px - u_mouse.x, py - u_mouse.y);
        float distA = length(vec2(d.x * u_aspect, d.y));
        float R = 0.42;
        float push = (1.0 - smoothstep(0.0, R, distA)) * u_force;
        vec2 dir = distA > 0.0001 ? normalize(d) : vec2(0.0);
        px += dir.x * push * 0.16;
        py += dir.y * push * 0.16;

        gl_Position = vec4(px, py, 0.0, 1.0);
        gl_PointSize = (3.0 + depth * 5.0 + push * 1.5) * u_size;
      }
    `;
    const FRAG = `
      precision mediump float;
      varying float v_depth;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.12, d);
        vec3 teal = vec3(0.122, 0.525, 0.651); // #1F86A6
        gl_FragColor = vec4(teal, a * (0.30 + v_depth * 0.45));
      }
    `;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const a_base = gl.getAttribLocation(prog, 'a_base');
    const u_time = gl.getUniformLocation(prog, 'u_time');
    const u_size = gl.getUniformLocation(prog, 'u_size');
    const u_aspect = gl.getUniformLocation(prog, 'u_aspect');
    const u_mouse = gl.getUniformLocation(prog, 'u_mouse');
    const u_force = gl.getUniformLocation(prog, 'u_force');
    const buffer = gl.createBuffer();

    // ── Programa del rastro: puntos teal que se desvanecen siguiendo el cursor.
    const TRAIL_VERT = `
      attribute vec3 a_tp;    // x, y, life (1→0)
      uniform float u_size;
      varying float v_life;
      void main() {
        v_life = a_tp.z;
        gl_Position = vec4(a_tp.x, a_tp.y, 0.0, 1.0);
        gl_PointSize = (2.0 + a_tp.z * a_tp.z * 11.0) * u_size;
      }
    `;
    const TRAIL_FRAG = `
      precision mediump float;
      varying float v_life;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        vec3 col = vec3(0.094, 0.596, 0.741); // teal algo más vivo que la grilla
        gl_FragColor = vec4(col, a * v_life * 0.55);
      }
    `;
    const trailProg = gl.createProgram()!;
    gl.attachShader(trailProg, compile(gl.VERTEX_SHADER, TRAIL_VERT));
    gl.attachShader(trailProg, compile(gl.FRAGMENT_SHADER, TRAIL_FRAG));
    gl.linkProgram(trailProg);
    const a_tp = gl.getAttribLocation(trailProg, 'a_tp');
    const u_size_trail = gl.getUniformLocation(trailProg, 'u_size');
    const trailBuffer = gl.createBuffer();

    // Estado del mouse (NDC) con easing hacia el target.
    const mouse = { x: 0, y: 0, tx: 0, ty: 0, force: 0, tforce: 0 };

    // Rastro: lista de partículas {x, y, life}; las viejas se desvanecen y caen.
    const TRAIL_CAP = 34;
    const TRAIL_LIFE = 0.75; // segundos
    type Particle = { x: number; y: number; life: number };
    const trail: Particle[] = [];
    const trailData = new Float32Array(TRAIL_CAP * 3);
    let lastSpawnX = 0;
    let lastSpawnY = 0;
    const spawn = (x: number, y: number) => {
      const dx = x - lastSpawnX;
      const dy = y - lastSpawnY;
      if (dx * dx + dy * dy < 0.0004) return; // throttle por distancia (~0.02 NDC)
      lastSpawnX = x;
      lastSpawnY = y;
      trail.push({ x, y, life: 1 });
      if (trail.length > TRAIL_CAP) trail.shift();
    };

    let dpr = 1;
    let count = 0;

    // (Re)genera la grilla según el aspect actual para que los puntos no se estiren.
    const buildGrid = (aspect: number) => {
      const rows = 26;
      const cols = Math.max(8, Math.round(rows * aspect));
      const verts = new Float32Array(rows * cols * 2);
      let k = 0;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          verts[k++] = (i / (cols - 1)) * 2 - 1; // x ∈ [-1, 1]
          verts[k++] = (j / (rows - 1)) * 2 - 1; // y ∈ [-1, 1]
        }
      }
      count = rows * cols;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(a_base);
      gl.vertexAttribPointer(a_base, 2, gl.FLOAT, false, 0, 0);
    };

    const resize = () => {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.uniform1f(u_size, dpr);
      gl.uniform1f(u_aspect, w / h);
      gl.useProgram(trailProg);
      gl.uniform1f(u_size_trail, dpr);
      gl.useProgram(prog);
      buildGrid(w / h);
    };

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const draw = (t: number) => {
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Pasada 1: grilla de fondo.
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(a_base);
      gl.vertexAttribPointer(a_base, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(u_time, t);
      gl.uniform2f(u_mouse, mouse.x, mouse.y);
      gl.uniform1f(u_force, mouse.force);
      gl.drawArrays(gl.POINTS, 0, count);

      // Pasada 2: rastro del cursor.
      if (trail.length) {
        for (let i = 0; i < trail.length; i++) {
          trailData[i * 3] = trail[i].x;
          trailData[i * 3 + 1] = trail[i].y;
          trailData[i * 3 + 2] = trail[i].life;
        }
        gl.useProgram(trailProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, trailBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, trailData.subarray(0, trail.length * 3), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(a_tp);
        gl.vertexAttribPointer(a_tp, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, trail.length);
      }
    };

    resize();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      draw(0); // frame estático, sin animar
      const onResize = () => { resize(); draw(0); };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    let raf = 0;
    let last = 0;
    let elapsed = 0;
    let running = false;

    const ease = (cur: number, tgt: number, rate: number, dt: number) =>
      cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

    const frame = (now: number) => {
      if (!last) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      elapsed += dt * 0.4; // velocidad lenta
      last = now;
      mouse.x = ease(mouse.x, mouse.tx, 14, dt);
      mouse.y = ease(mouse.y, mouse.ty, 14, dt);
      mouse.force = ease(mouse.force, mouse.tforce, 8, dt);

      // Rastro: envejecer + leve deriva hacia arriba; spawnear con el cursor activo.
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].life -= dt / TRAIL_LIFE;
        trail[i].y += dt * 0.04;
        if (trail[i].life <= 0) trail.splice(i, 1);
      }
      if (mouse.force > 0.25) spawn(mouse.x, mouse.y);

      draw(elapsed);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // Pausa cuando el hero sale de viewport.
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    // Dispersión al mover el mouse sobre el hero.
    const host = (canvas.parentElement as HTMLElement) ?? canvas;
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      mouse.tx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.ty = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouse.tforce = 1;
    };
    const onLeave = () => { mouse.tforce = 0; };
    host.addEventListener('mousemove', onMove);
    host.addEventListener('mouseleave', onLeave);

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      host.removeEventListener('mousemove', onMove);
      host.removeEventListener('mouseleave', onLeave);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}

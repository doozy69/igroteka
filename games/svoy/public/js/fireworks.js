/* Салют на ТВ-экране при завершении игры.
 *
 * Рисует залпы на отдельном canvas поверх страницы. Модуль используется
 * только на экране ТВ (display.html) и запускается/останавливается из display.js
 * вместе с экраном итогов. Звук салюта не нужен — аплодисменты играет sound.js.
 */
(function () {
  const COLORS = ['#ffd166', '#f59e0b', '#60a5fa', '#22c55e', '#ef4444', '#e879f9', '#38bdf8', '#facc15', '#fb7185', '#a78bfa'];
  const MAX_PARTICLES = 2600;
  const BURST_MS = 20000; // сколько времени запускаем новые залпы

  let canvas = null;
  let ctx = null;
  let raf = 0;
  let running = false;
  let particles = [];
  let lastFrame = 0;
  let nextBurstAt = 0;
  let burstUntil = 0;
  let width = 0;
  let height = 0;

  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'fireworks-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burst(x, y) {
    if (particles.length >= MAX_PARTICLES) return;
    const count = Math.floor(rand(70, 115));
    const base = rand(140, 400);           // начальная скорость, px/сек
    const color = pick(COLORS);
    const spark = Math.floor(rand(0, count / 3));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = base * rand(0.35, 1);
      particles.push({
        x,
        y,
        px: x,
        py: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: rand(0.9, 1.9),
        size: rand(1.6, 3.4),
        color: i < spark ? '#ffffff' : color
      });
    }
    // короткая яркая вспышка в центре залпа
    particles.push({
      x, y, px: x, py: y, vx: 0, vy: 0,
      age: 0, life: 0.32, size: 26, color, flash: true
    });
  }

  function randomBurst() {
    const x = rand(width * 0.12, width * 0.88);
    const y = rand(height * 0.12, height * 0.52);
    burst(x, y);
  }

  function frame(now) {
    if (!running || !ctx) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    if (now < burstUntil && now >= nextBurstAt) {
      randomBurst();
      if (Math.random() < 0.45) randomBurst();
      nextBurstAt = now + rand(260, 620);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }

      p.px = p.x;
      p.py = p.y;

      if (p.flash) {
        // вспышка залпа: мягкий светящийся круг
        const fk = 1 - p.age / p.life;
        const radius = p.size * (0.5 + (1 - fk) * 1.6);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = Math.max(0, fk * 0.8);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      p.vy += 190 * dt;           // гравитация
      p.vx *= 1 - 0.9 * dt;       // сопротивление воздуха
      p.vy *= 1 - 0.9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const k = 1 - p.age / p.life; // яркость/размер к концу жизни
      ctx.globalAlpha = Math.max(0, k);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(0.6, p.size * k);
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      // яркая точка на конце — искры выглядят объёмнее
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.7, p.size * k * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;            // повторный вызов не перезапускает салют
    ensureCanvas();
    running = true;
    particles = [];
    const now = performance.now();
    lastFrame = 0;
    burstUntil = now + BURST_MS;
    nextBurstAt = now;
    burst(width * 0.5, height * 0.34); // первый залп сразу
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    particles = [];
    if (canvas) {
      window.removeEventListener('resize', resize);
      canvas.remove();
      canvas = null;
      ctx = null;
    }
  }

  window.Fireworks = { start, stop };
})();

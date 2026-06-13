import { LidarEngine, emitters, ramps, scannables } from '../../src/index';

const canvas = document.getElementById('view') as HTMLCanvasElement;
function fit() {
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
}
fit();

const engine = new LidarEngine({
  canvas,
  scannable: scannables.proceduralCave(),
  emitter: emitters.cursorCone({ halfAngle: 0.1, raysPerFrame: 400 }),
  ramp: ramps.rainbowDepth,
  pointBudget: 500_000,
  persistence: 'accumulate',
});
engine.start();

// Auto-sweep with a Lissajous aim until the user moves the mouse.
let userActive = false;
const startTime = performance.now();
function autoAim() {
  if (userActive) return;
  const t = (performance.now() - startTime) / 1000;
  engine.setAim(Math.sin(t * 0.7) * 0.6, Math.sin(t * 0.43) * 0.25);
  requestAnimationFrame(autoAim);
}
autoAim();

// Pointer: aim on move, drag to look.
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  userActive = true;
  if (dragging) {
    engine.look(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  } else {
    engine.aimAt(e.clientX, e.clientY);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') engine.clear();
});

window.addEventListener('resize', () => { fit(); engine.resize(); });

// HUD wiring.
document.querySelectorAll<HTMLButtonElement>('.panel button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const r = btn.dataset.ramp as keyof typeof ramps | undefined;
    const em = btn.dataset.emitter;
    const p = btn.dataset.persistence as 'accumulate' | 'fade' | undefined;
    if (r) engine.setRamp(ramps[r]);
    if (em === 'cursorCone') engine.setEmitter(emitters.cursorCone({ halfAngle: 0.1, raysPerFrame: 400 }));
    if (em === 'pulseRing') engine.setEmitter(emitters.pulseRing({ raysPerFrame: 500 }));
    if (p) engine.setPersistence(p);
    if (btn.dataset.action === 'clear') engine.clear();
  });
});

// Stats readout.
const stats = document.getElementById('stats')!;
setInterval(() => {
  stats.textContent = `${engine.pointCount.toLocaleString()} points`;
}, 250);

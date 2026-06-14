import { LidarEngine, PointCloud, buildCategoryLUT } from '../../src/index';

const canvas = document.getElementById('view') as HTMLCanvasElement;
function fit() { canvas.style.width = '100vw'; canvas.style.height = '100vh'; }
fit();

const engine = new LidarEngine({
  canvas,
  autoScan: false,
  cameraMode: 'orbit',
  cameraPosition: [0, 120, 160],
  cameraTarget: [0, 0, 0],
  pointBudget: 1000,
});
engine.start();

// Temporary: a small grid of test points to confirm value-mode rendering + orbit.
const lut = buildCategoryLUT([[255, 110, 110], [90, 230, 160], [120, 200, 255]]);
const layer = new PointCloud({ capacity: 1000, ramp: lut, persistence: 'accumulate', colorMode: 'value' });
const pos: number[] = []; const val: number[] = [];
for (let i = 0; i < 30; i++) {
  pos.push((i - 15) * 4, 0, 0); val.push(((i % 3) + 0.5) / 3);
}
layer.addPoints(new Float32Array(pos), new Float32Array(val));
engine.addLayer(layer.points);

window.addEventListener('resize', () => { fit(); engine.resize(); });

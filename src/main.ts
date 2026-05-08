import './style.css';
import { SceneManager } from './scene/SceneManager';
import { LODPlanet } from './planet/LODPlanet';
import { Sun } from './atmosphere/Sun';
import { FlightModel } from './flight/FlightModel';
import { KeyboardControls } from './controls/KeyboardControls';
import { PlaneVisual } from './plane/PlaneVisual';
import { ChaseCamera } from './camera/ChaseCamera';
import { FlightDebug } from './debug/FlightDebug';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
// Global error handler — display errors on screen
function showError(msg: string) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:red;background:#1a1a1a;padding:1em;margin:1em;border-radius:4px;font-size:14px;white-space:pre-wrap;position:fixed;top:0;left:0;z-index:9999;max-height:100vh;overflow:auto;';
  pre.textContent = msg;
  document.body.prepend(pre);
}
function showInfo(msg: string) {
  const div = document.createElement('div');
  div.style.cssText = 'color:#0f0;background:#000;padding:4px 8px;font-family:monospace;font-size:12px;position:fixed;bottom:0;left:0;z-index:9999;';
  div.textContent = msg;
  document.body.appendChild(div);
}
window.addEventListener('error', (e) => {
  showError(`Uncaught: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  showError(`Unhandled promise: ${e.reason}\n${e.reason?.stack ?? ''}`);
});
try {
const canvas = document.getElementById('app') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas element #app not found');
showInfo('Canvas found ✓');
// Scene setup with floating origin
const scene = new SceneManager(canvas);
void scene.getEngine();
const worldGroup = scene.getWorldGroup();
const bjsScene = scene.getScene();
showInfo(`Engine created ✓`);
// Sun — directional + hemisphere light with day/night cycle, visible disc
const sun = new Sun(bjsScene);
sun.getSunDisc(bjsScene);
// Planet — cube-sphere LOD with quadtree
const planet = new LODPlanet({
  planetRadius: 6371,
  seed: 91,
  heightAmplitude: 8,
  chunkResolution: 16,
  baseDepth: 4,
}, bjsScene);
planet.getRoot().parent = worldGroup;
// Flight model + controls — spawn above highest mountain (seed 91, lat=20°, lon=0°, 6.64 km)
const MOUNTAIN_POS: [number, number, number] = [5993.87, 2181.71, 0];
const flight = new FlightModel(6371, MOUNTAIN_POS);
const controls = new KeyboardControls();
const debug = new FlightDebug(flight);
// Plane visual
const plane = new PlaneVisual(bjsScene);
plane.getMesh().parent = worldGroup;
// Camera
const cam = scene.getCamera();
cam.fov = 70 * Math.PI / 180;
cam.minZ = 0.001;
// Chase camera
const chaseCamera = new ChaseCamera(cam, {
  offset: [-2, 0, 0.5],
  lerpSpeed: 0.3,
  rollCouple: false,
});
// Game loop
const _quat = new Quaternion();
let frameCount = 0;
// Debug globals
(window as any).__debug = { scene, planet, sun, chaseCamera, flight, cam, bjsScene };
scene.onUpdate((dt) => {
  frameCount++;
  if (frameCount === 1) showInfo(`Render loop started ✓`);
  sun.update(dt);
  const input = debug.getPatternName() === 'MANUAL'
    ? controls.getInput()
    : debug.getControls();
  flight.applyControls(input);
  flight.update(dt);
  debug.update();
  const state = flight.getState();
  const [px, py, pz] = state.position;
  _quat.copyFrom(flight.getQuaternion());
  plane.update([px, py, pz], _quat);
  // Chase camera — smooth follow behind/above plane
  chaseCamera.update(new Vector3(px, py, pz), _quat, dt);
  // Update planet (no-op after first call with baseDepth mode)
  planet.update(cam.position);
});
// Controls overlay toggle
const overlay = document.getElementById('controls-help');
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && overlay) {
    overlay.classList.toggle('visible');
  }
  if (e.code === 'KeyT') {
    debug.nextPattern();
  }
  if (e.code === 'KeyR') {
    flight.reset();
  }
  if (e.code === 'BracketRight') {
    flight.changeSpeed(1);
  }
  if (e.code === 'BracketLeft') {
    flight.changeSpeed(-1);
  }
});
// Start
controls.attach();
scene.start();
} catch (e: any) {
  showError(`Initialization error: ${e.message}\n${e.stack ?? ''}`);
}

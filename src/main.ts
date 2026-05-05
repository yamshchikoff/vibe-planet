import './style.css';
import { SceneManager } from './scene/SceneManager';
import { LODPlanet } from './planet/LODPlanet';
import { Atmosphere } from './atmosphere/Atmosphere';
import { Sun } from './atmosphere/Sun';
import { FlightModel } from './flight/FlightModel';
import { KeyboardControls } from './controls/KeyboardControls';
import { PlaneVisual } from './plane/PlaneVisual';
import { ChaseCamera } from './camera/ChaseCamera';
import { FlightDebug } from './debug/FlightDebug';
import { Vector3 } from 'three';

const canvas = document.getElementById('app') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas element #app not found');

// Scene setup with floating origin
const scene = new SceneManager(canvas);
const worldGroup = scene.getWorldGroup();

// Sun — directional + ambient light with day/night cycle
const sun = new Sun();
scene.getScene().add(sun.getLight());
scene.getScene().add(sun.getAmbient());

// Planet — cube-sphere LOD with quadtree
const planet = new LODPlanet({
  planetRadius: 6371,
  seed: 91,
  heightAmplitude: 8,
  maxDepth: 12,
  maxChunks: 1000,
  chunkResolution: 16,
});
worldGroup.add(planet.getMesh());

// Atmosphere — shader-based scattering shell
const atmosphere = new Atmosphere({
  planetRadius: 6371,
  atmosphereHeight: 80,
});
worldGroup.add(atmosphere.getMesh());

// Flight model + controls — spawn above highest mountain (seed 91, lat=20°, lon=0°, 6.64 km)
const MOUNTAIN_POS: [number, number, number] = [5993.87, 2181.71, 0];
const flight = new FlightModel(6371, MOUNTAIN_POS);
const controls = new KeyboardControls();
const debug = new FlightDebug(flight);

// Plane visual
const plane = new PlaneVisual();
worldGroup.add(plane.getMesh());

// Camera
const cam = scene.getCamera();
cam.fov = 85;
cam.near = 0.001; // 1m near plane for close chase camera
cam.updateProjectionMatrix();

// Chase camera
const chaseCamera = new ChaseCamera(cam, {
  offset: [0, 0.006, 0.015],
  lerpSpeed: 0.3,
});

// Game loop
scene.onUpdate((dt) => {
  sun.update(dt);

  const input = debug.getPatternName() === 'MANUAL'
    ? controls.getInput()
    : debug.getControls();
  flight.applyControls(input);
  flight.update(dt);
  debug.update();

  const state = flight.getState();
  const [px, py, pz] = state.position;
  const { yaw, pitch, roll } = state.orientation;

  plane.update([px, py, pz], yaw, pitch, roll);

  // Chase camera — smooth follow behind/above plane
  chaseCamera.update(new Vector3(px, py, pz), plane.getMesh().quaternion, dt);

  // LOD updates use actual camera position
  planet.update(cam.position);
  atmosphere.update(cam.position, sun.getDirection());
});

// Controls overlay toggle
const overlay = document.getElementById('controls-help');
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && overlay) {
    overlay.classList.toggle('visible');
  }
  if (e.code === 'KeyU') {
    atmosphere.getMesh().visible = !atmosphere.getMesh().visible;
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

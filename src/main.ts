import './style.css';
import { SceneManager } from './scene/SceneManager';
import { LODPlanet } from './planet/LODPlanet';
import { Atmosphere } from './atmosphere/Atmosphere';
import { Sun } from './atmosphere/Sun';
import { FlightModel } from './flight/FlightModel';
import { KeyboardControls } from './controls/KeyboardControls';
import { PlaneVisual } from './plane/PlaneVisual';
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

// Flight model + controls
const flight = new FlightModel(6371);
const controls = new KeyboardControls();

// Plane visual
const plane = new PlaneVisual();
worldGroup.add(plane.getMesh());

// Camera
const cam = scene.getCamera();
cam.fov = 85;
cam.updateProjectionMatrix();

// Chase camera offset: 6m above (+Y), 15m behind (+Z) in plane's local frame
const _camOffset = new Vector3(0, 0.006, 0.015);

// Game loop
scene.onUpdate((dt) => {
  sun.update(dt);

  const input = controls.getInput();
  flight.applyControls(input);
  flight.update(dt);

  const state = flight.getState();
  const [px, py, pz] = state.position;
  const { yaw, pitch, roll } = state.orientation;

  plane.update([px, py, pz], yaw, pitch, roll);

  // Chase camera — behind/above in plane's local frame, lookAt (no roll coupling)
  const q = plane.getMesh().quaternion;
  _camOffset.set(0, 0.006, 0.015).applyQuaternion(q);
  cam.position.set(px + _camOffset.x, py + _camOffset.y, pz + _camOffset.z);
  cam.lookAt(px, py, pz);

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
});

// Start
controls.attach();
scene.start();

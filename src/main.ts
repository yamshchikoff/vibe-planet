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

// Chase camera state — smooth follow, 15m above, 20m behind in local frame
const _camOffset = new Vector3(0, 0.015, 0.02);
const _camPos = new Vector3();

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

  // Smooth chase camera: position behind/above in plane's local frame, look at plane
  const q = plane.getMesh().quaternion;
  _camOffset.set(0, 0.015, 0.02).applyQuaternion(q);
  const targetX = px + _camOffset.x;
  const targetY = py + _camOffset.y;
  const targetZ = pz + _camOffset.z;

  const t = 1 - Math.exp(-20 * dt);
  if (_camPos.lengthSq() === 0) {
    _camPos.set(targetX, targetY, targetZ);
  } else {
    _camPos.x += (targetX - _camPos.x) * t;
    _camPos.y += (targetY - _camPos.y) * t;
    _camPos.z += (targetZ - _camPos.z) * t;
  }
  cam.position.copy(_camPos);
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

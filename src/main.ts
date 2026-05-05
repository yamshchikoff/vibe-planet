import './style.css';
import { SceneManager } from './scene/SceneManager';
import { PlanetGenerator } from './planet/PlanetGenerator';
import { FlightModel } from './flight/FlightModel';
import { KeyboardControls } from './controls/KeyboardControls';
import { PlaneVisual } from './plane/PlaneVisual';
import { DirectionalLight, AmbientLight } from 'three';

const canvas = document.getElementById('app') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas element #app not found');

// Scene
const scene = new SceneManager(canvas);

// Lights
const sun = new DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 30, 20);
scene.getScene().add(sun);

const ambient = new AmbientLight(0x223355, 0.4);
scene.getScene().add(ambient);

// Planet
const planet = new PlanetGenerator({ radius: 10, segments: 48, seed: 42 });
const mesh = planet.generate();
scene.getScene().add(mesh);

// Flight
const flight = new FlightModel(10);
const controls = new KeyboardControls();

// Plane visual
const plane = new PlaneVisual();
scene.getScene().add(plane.getMesh());

// Camera FOV
const cam = scene.getCamera();
cam.fov = 120;
cam.updateProjectionMatrix();

// Camera follow + plane visual update
scene.onUpdate((_dt) => {
  const state = flight.getState();
  const [px, py, pz] = state.position;
  const { yaw, pitch, roll } = state.orientation;

  plane.update([px, py, pz], yaw, pitch, roll);

  const camDist = 20;
  const camHeight = 10;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  // Forward direction of the plane
  const fwdX = -sinYaw * cosPitch;
  const fwdZ = -cosYaw * cosPitch;
  const fwdY = sinPitch;

  // Camera behind and above the plane
  const camX = px - fwdX * camDist;
  const camZ = pz - fwdZ * camDist;
  const camY = py + camHeight;

  cam.position.set(camX, camY, camZ);
  // Look in the direction the plane is flying, parallel to its longitudinal axis
  cam.lookAt(px + fwdX * 50, py + fwdY * 50, pz + fwdZ * 50);
});

// Physics + controls update
scene.onUpdate((dt) => {
  const input = controls.getInput();
  flight.applyControls(input);
  flight.update(dt);
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

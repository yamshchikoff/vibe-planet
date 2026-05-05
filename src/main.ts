import './style.css';
import { SceneManager } from './scene/SceneManager';
import { PlanetGenerator } from './planet/PlanetGenerator';
import { FlightModel } from './flight/FlightModel';
import { KeyboardControls } from './controls/KeyboardControls';
import { PlaneVisual } from './plane/PlaneVisual';
import { DirectionalLight, AmbientLight, Vector3 } from 'three';

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

const _offset = new Vector3(0, 10, 20);

// Camera follow — rigidly attached to plane's local frame
scene.onUpdate((_dt) => {
  const state = flight.getState();
  const [px, py, pz] = state.position;
  const { yaw, pitch, roll } = state.orientation;

  plane.update([px, py, pz], yaw, pitch, roll);

  const q = plane.getMesh().quaternion;

  _offset.set(0, 10, 20).applyQuaternion(q);

  cam.position.set(px + _offset.x, py + _offset.y, pz + _offset.z);
  cam.quaternion.copy(q);
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

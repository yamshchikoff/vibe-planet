import './style.css';
import { SceneManager } from './scene/SceneManager';
import { FlightModel } from './flight/FlightModel';
import { PlaneVisual } from './plane/PlaneVisual';
import { ChaseCamera } from './camera/ChaseCamera';
import { FlightDebug } from './debug/FlightDebug';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';

const canvas = document.getElementById('app') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #app not found');

const sceneMgr = new SceneManager(canvas);
void sceneMgr.getEngine();
const worldGroup = sceneMgr.getWorldGroup();
const bjsScene = sceneMgr.getScene();
const cam = sceneMgr.getCamera();
cam.fov = 70 * Math.PI / 180;
cam.minZ = 0.001;

// Minimal lighting
const light = new DirectionalLight('debugLight', new Vector3(0.5, -1, 0.5), bjsScene);
light.intensity = 1.0;
light.diffuse = Color3.White();
const hemi = new HemisphericLight('debugHemi', new Vector3(0, 1, 0), bjsScene);
hemi.intensity = 0.4;
hemi.diffuse = new Color3(0.53, 0.81, 0.92);

// Flight — spawn in clear sky, directly above origin
const flight = new FlightModel(6371, [0, 6375, 0]);
const controls = new FlightDebug(flight);

// Plane
const plane = new PlaneVisual(bjsScene);
plane.getMesh().parent = worldGroup;

// Camera
const chaseCamera = new ChaseCamera(cam, {
  offset: [-2, 0, 0.5],
  lerpSpeed: 0.3,
});

// Debug globals
(window as any).__debug = { scene: sceneMgr, plane, chaseCamera, flight, cam, bjsScene };

// Game loop
const _quat = new Quaternion();
sceneMgr.onUpdate((dt) => {
  const input = controls.getControls();
  flight.applyControls(input);
  flight.update(dt);

  const state = flight.getState();
  const [px, py, pz] = state.position;
  _quat.copyFrom(flight.getQuaternion());
  plane.update([px, py, pz], _quat);
  chaseCamera.update(new Vector3(px, py, pz), _quat, dt);
});

controls.attach();
sceneMgr.start();

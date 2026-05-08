import './style.css';
import '@babylonjs/core/Shaders/default.vertex';
import '@babylonjs/core/Shaders/default.fragment';
import { SceneManager } from './SceneManager';
import { PlaneVisual } from './PlaneVisual';
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

const light = new DirectionalLight('debugLight', new Vector3(0.5, -1, 0.5), bjsScene);
light.intensity = 1.0;
light.diffuse = Color3.White();
const hemi = new HemisphericLight('debugHemi', new Vector3(0, 1, 0), bjsScene);
hemi.intensity = 0.4;
hemi.diffuse = new Color3(0.53, 0.81, 0.92);

cam.rotationQuaternion = Quaternion.Identity();

const plane = new PlaneVisual(bjsScene);
const planeGroup = plane.getMesh();
planeGroup.position.set(0, 0, 8);
planeGroup.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 1, 0), 0.44);
planeGroup.parent = worldGroup;

(window as any).__debug = { scene: sceneMgr, cam, bjsScene, plane, planeGroup };

sceneMgr.onUpdate((_dt) => { /* static scene */ });
sceneMgr.start();

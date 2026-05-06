// Debug script — loads key modules to check for import errors
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';

void Engine;
void Scene;
void FreeCamera;

console.log('All Babylon.js modules loaded successfully');

const canvas = document.getElementById('app') as HTMLCanvasElement;
console.log('Canvas:', canvas);
if (!canvas) throw new Error('No canvas');

try {
  const engine = new Engine(canvas, true);
  console.log('Engine created');
  const scene = new Scene(engine);
  console.log('Scene created');
  new FreeCamera('cam', Vector3.Zero(), scene);
  console.log('Camera created');
  new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  console.log('DirectionalLight created');
  scene.render();
  console.log('First render completed');
  engine.dispose();
} catch (e: any) {
  console.error('ERROR:', e.message);
  document.body.innerHTML += `<pre style="color:red">ERROR: ${e.message}</pre>`;
}

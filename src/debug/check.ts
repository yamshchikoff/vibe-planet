// Debug script — loads key modules to check for import errors
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';

console.log('All Babylon.js modules loaded successfully');

const canvas = document.getElementById('app') as HTMLCanvasElement;
console.log('Canvas:', canvas);
if (!canvas) throw new Error('No canvas');

try {
  const engine = new Engine(canvas, true);
  console.log('Engine created');
  const scene = new Scene(engine);
  console.log('Scene created');
  const cam = new FreeCamera('cam', Vector3.Zero(), scene);
  console.log('Camera created');
  const light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  console.log('DirectionalLight created');
  scene.render();
  console.log('First render completed');
  engine.dispose();
} catch (e: any) {
  console.error('ERROR:', e.message);
  document.body.innerHTML += `<pre style="color:red">ERROR: ${e.message}</pre>`;
}

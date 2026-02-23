import type { MuJoCoModule } from '../types';
import { SCENE_XML, MESH_FILES } from '../constants';

/**
 * Initialize MuJoCo WASM, load MJCF + STL files into the virtual filesystem,
 * and return model + data.
 */
export async function initMuJoCo(): Promise<{
  mujoco: MuJoCoModule;
  model: InstanceType<MuJoCoModule['MjModel']> & Record<string, any>;
  data: InstanceType<MuJoCoModule['MjData']> & Record<string, any>;
}> {
  // Dynamic import of the WASM module
  const loadMuJoCo = (await import('mujoco-js')).default;
  const mujoco = await loadMuJoCo();

  // Create directories in the Emscripten virtual filesystem
  mujoco.FS.mkdir('/scenes');
  mujoco.FS.mkdir('/scenes/meshes');

  // Fetch and write the MJCF scene file
  const xmlResponse = await fetch(SCENE_XML);
  const xmlText = await xmlResponse.text();
  mujoco.FS.writeFile('/scenes/so101_scene.xml', xmlText);

  // Fetch and write all STL mesh files in parallel
  const meshPromises = MESH_FILES.map(async (filename) => {
    const response = await fetch(`/scenes/meshes/${filename}`);
    const buffer = await response.arrayBuffer();
    mujoco.FS.writeFile(`/scenes/meshes/${filename}`, new Uint8Array(buffer));
  });
  await Promise.all(meshPromises);

  // Load model from MJCF
  const model = mujoco.MjModel.loadFromXML('/scenes/so101_scene.xml') as any;
  const data = new mujoco.MjData(model) as any;

  // Run forward kinematics to initialize body positions
  mujoco.mj_forward(model, data);

  return { mujoco, model, data };
}

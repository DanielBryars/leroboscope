import { initMuJoCo } from './mujoco/loader';
import { buildScene, updateBodyTransforms } from './mujoco/scene-builder';
import { createRenderer } from './mujoco/renderer';
import { loadDatasetContext, loadEpisode, type DatasetContext } from './dataset/episode-loader';
import { autoConvertToRadians, getJointQposIndices, setJointPositions } from './replay/joint-mapper';
import { PlaybackController } from './replay/playback-controller';
import {
  getUIElements,
  populateEpisodes,
  updatePlaybackUI,
  setDatasetMeta,
  applyUrlParams,
  updateUrlParams,
} from './ui/controls';
import { showLoading, showError, hideStatus } from './ui/status';
import type { EpisodeData } from './types';

// --- Global State ---
let mujoco: any;
let model: any;
let data: any;
let qposIndices: number[] = [];
let currentEpisode: EpisodeData | null = null;
let datasetCtx: DatasetContext | null = null;

const playback = new PlaybackController();

async function main() {
  const ui = getUIElements();
  const { dataset: urlDataset, episode: urlEpisode } = applyUrlParams(ui);

  // --- 1. Initialize MuJoCo + Three.js ---
  showLoading('Initializing MuJoCo WASM...');

  try {
    const result = await initMuJoCo();
    mujoco = result.mujoco;
    model = result.model;
    data = result.data;
  } catch (err) {
    showError(`Failed to initialize MuJoCo: ${err}`);
    console.error(err);
    return;
  }

  showLoading('Building 3D scene...');

  // Get joint qpos indices
  qposIndices = getJointQposIndices(mujoco, model);

  // Build Three.js scene from MuJoCo model
  const viewport = document.getElementById('viewport')!;
  const { scene, camera, renderer, controls } = createRenderer(viewport);
  const { bodyGroups, root } = buildScene(mujoco, model, data);
  scene.add(root);

  // Initial transform update
  updateBodyTransforms(model, data, bodyGroups);

  hideStatus();
  ui.loadBtn.disabled = false;

  // --- 2. Render Loop ---
  function renderLoop() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }
  renderLoop();

  // --- 3. Frame Update Callback ---
  function onFrame(frameIdx: number) {
    if (!currentEpisode || frameIdx >= currentEpisode.frames.length) return;

    const frame = currentEpisode.frames[frameIdx];
    const radians = autoConvertToRadians(frame.state);
    setJointPositions(data, qposIndices, radians);

    // Forward kinematics only (no physics step)
    mujoco.mj_forward(model, data);

    // Update Three.js transforms
    updateBodyTransforms(model, data, bodyGroups);
  }

  // --- 4. Playback Callbacks ---
  playback.setCallbacks(onFrame, (state) => {
    updatePlaybackUI(ui, state);
  });

  // --- 5. Wire UI Events ---

  // Load dataset
  async function loadDataset(repoId: string, episodeIdx?: number) {
    showLoading(`Loading dataset: ${repoId}...`);
    ui.loadBtn.disabled = true;

    try {
      datasetCtx = await loadDatasetContext(repoId);
      const info = datasetCtx.info;

      populateEpisodes(ui, info.total_episodes);
      setDatasetMeta(ui, info.fps, info.total_episodes, info.total_frames);

      // Select episode
      const ep = episodeIdx !== undefined && episodeIdx < info.total_episodes ? episodeIdx : 0;
      ui.episodeSelect.value = ep.toString();

      await loadEpisodeData(ep);
      updateUrlParams(repoId, ep);
    } catch (err) {
      showError(`Failed to load dataset: ${err}`);
      console.error(err);
    } finally {
      ui.loadBtn.disabled = false;
    }
  }

  // Load a specific episode
  async function loadEpisodeData(episodeIdx: number) {
    if (!datasetCtx) return;
    showLoading(`Loading episode ${episodeIdx}...`);

    try {
      currentEpisode = await loadEpisode(datasetCtx, episodeIdx);
      playback.loadEpisode(currentEpisode);
      hideStatus();
      updateUrlParams(datasetCtx.repoId, episodeIdx);
    } catch (err) {
      showError(`Failed to load episode: ${err}`);
      console.error(err);
    }
  }

  // Load button
  ui.loadBtn.addEventListener('click', () => {
    const repoId = ui.datasetInput.value.trim();
    if (repoId) loadDataset(repoId);
  });

  // Enter key in dataset input
  ui.datasetInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const repoId = ui.datasetInput.value.trim();
      if (repoId) loadDataset(repoId);
    }
  });

  // Episode selection
  ui.episodeSelect.addEventListener('change', () => {
    const ep = parseInt(ui.episodeSelect.value, 10);
    if (!isNaN(ep)) loadEpisodeData(ep);
  });

  // Playback controls
  ui.playPauseBtn.addEventListener('click', () => playback.togglePlay());
  ui.prevFrameBtn.addEventListener('click', () => playback.prevFrame());
  ui.nextFrameBtn.addEventListener('click', () => playback.nextFrame());

  // Timeline scrubber
  ui.timeline.addEventListener('input', () => {
    const frame = parseInt(ui.timeline.value, 10);
    playback.seek(frame);
  });

  // Speed control
  ui.speedSelect.addEventListener('change', () => {
    playback.setSpeed(parseFloat(ui.speedSelect.value));
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Don't capture keys when typing in input fields
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        playback.togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        playback.prevFrame();
        break;
      case 'ArrowRight':
        e.preventDefault();
        playback.nextFrame();
        break;
      case 'Home':
        e.preventDefault();
        playback.seek(0);
        break;
      case 'End':
        e.preventDefault();
        if (currentEpisode) playback.seek(currentEpisode.totalFrames - 1);
        break;
    }
  });

  // --- 6. Auto-load from URL params ---
  if (urlDataset) {
    loadDataset(urlDataset, urlEpisode);
  }
}

main().catch(console.error);

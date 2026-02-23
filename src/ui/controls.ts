import type { PlaybackState } from '../types';

/** All the UI elements we need */
export interface UIElements {
  datasetInput: HTMLInputElement;
  episodeSelect: HTMLSelectElement;
  loadBtn: HTMLButtonElement;
  playPauseBtn: HTMLButtonElement;
  prevFrameBtn: HTMLButtonElement;
  nextFrameBtn: HTMLButtonElement;
  timeline: HTMLInputElement;
  frameInfo: HTMLSpanElement;
  speedSelect: HTMLSelectElement;
  datasetMeta: HTMLSpanElement;
}

export function getUIElements(): UIElements {
  return {
    datasetInput: document.getElementById('dataset-id') as HTMLInputElement,
    episodeSelect: document.getElementById('episode-select') as HTMLSelectElement,
    loadBtn: document.getElementById('load-btn') as HTMLButtonElement,
    playPauseBtn: document.getElementById('play-pause') as HTMLButtonElement,
    prevFrameBtn: document.getElementById('prev-frame') as HTMLButtonElement,
    nextFrameBtn: document.getElementById('next-frame') as HTMLButtonElement,
    timeline: document.getElementById('timeline') as HTMLInputElement,
    frameInfo: document.getElementById('frame-info') as HTMLSpanElement,
    speedSelect: document.getElementById('speed-select') as HTMLSelectElement,
    datasetMeta: document.getElementById('dataset-meta') as HTMLSpanElement,
  };
}

/**
 * Populate episode dropdown with a range of episode numbers.
 */
export function populateEpisodes(ui: UIElements, totalEpisodes: number): void {
  ui.episodeSelect.innerHTML = '';
  for (let i = 0; i < totalEpisodes; i++) {
    const opt = document.createElement('option');
    opt.value = i.toString();
    opt.textContent = `Episode ${i}`;
    ui.episodeSelect.appendChild(opt);
  }
  ui.episodeSelect.disabled = false;
}

/**
 * Update the playback controls to reflect current state.
 */
export function updatePlaybackUI(ui: UIElements, state: PlaybackState): void {
  // Play/pause button
  ui.playPauseBtn.innerHTML = state.playing ? '&#9646;&#9646;' : '&#9654;';
  ui.playPauseBtn.title = state.playing ? 'Pause [Space]' : 'Play [Space]';

  // Timeline
  ui.timeline.max = Math.max(0, state.totalFrames - 1).toString();
  ui.timeline.value = state.currentFrame.toString();

  // Frame info
  ui.frameInfo.textContent = `${state.currentFrame + 1} / ${state.totalFrames}`;
}

/**
 * Set dataset metadata display.
 */
export function setDatasetMeta(ui: UIElements, fps: number, totalEpisodes: number, totalFrames: number): void {
  ui.datasetMeta.textContent = `${fps} fps | ${totalEpisodes} episodes | ${totalFrames} frames`;
}

/**
 * Initialize URL parameter reading and apply to UI.
 */
export function applyUrlParams(ui: UIElements): { dataset?: string; episode?: number } {
  const params = new URLSearchParams(window.location.search);
  const dataset = params.get('dataset') || undefined;
  const episodeStr = params.get('episode');
  const episode = episodeStr ? parseInt(episodeStr, 10) : undefined;

  if (dataset) {
    ui.datasetInput.value = dataset;
  }

  return { dataset, episode };
}

/**
 * Update URL parameters without reloading the page.
 */
export function updateUrlParams(dataset: string, episode: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set('dataset', dataset);
  url.searchParams.set('episode', episode.toString());
  window.history.replaceState({}, '', url.toString());
}

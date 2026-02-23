import type { PlaybackState } from '../types';

/** All the UI elements we need */
export interface UIElements {
  datasetInput: HTMLInputElement;
  episodeList: HTMLElement;
  loadBtn: HTMLButtonElement;
  playPauseBtn: HTMLButtonElement;
  prevFrameBtn: HTMLButtonElement;
  nextFrameBtn: HTMLButtonElement;
  timeline: HTMLInputElement;
  frameInfo: HTMLSpanElement;
  speedSelect: HTMLSelectElement;
  unitsSelect: HTMLSelectElement;
  datasetMeta: HTMLSpanElement;
}

export function getUIElements(): UIElements {
  return {
    datasetInput: document.getElementById('dataset-id') as HTMLInputElement,
    episodeList: document.getElementById('episode-list') as HTMLElement,
    loadBtn: document.getElementById('load-btn') as HTMLButtonElement,
    playPauseBtn: document.getElementById('play-pause') as HTMLButtonElement,
    prevFrameBtn: document.getElementById('prev-frame') as HTMLButtonElement,
    nextFrameBtn: document.getElementById('next-frame') as HTMLButtonElement,
    timeline: document.getElementById('timeline') as HTMLInputElement,
    frameInfo: document.getElementById('frame-info') as HTMLSpanElement,
    speedSelect: document.getElementById('speed-select') as HTMLSelectElement,
    unitsSelect: document.getElementById('units-select') as HTMLSelectElement,
    datasetMeta: document.getElementById('dataset-meta') as HTMLSpanElement,
  };
}

/**
 * Populate episode list sidebar.
 */
export function populateEpisodes(
  ui: UIElements,
  totalEpisodes: number,
  onSelect: (index: number) => void,
): void {
  ui.episodeList.innerHTML = '';
  for (let i = 0; i < totalEpisodes; i++) {
    const item = document.createElement('div');
    item.className = 'episode-item';
    item.dataset.episode = i.toString();
    item.textContent = `Episode ${i}`;
    item.addEventListener('click', () => onSelect(i));
    ui.episodeList.appendChild(item);
  }
}

/**
 * Highlight the selected episode in the list.
 */
export function selectEpisodeInList(ui: UIElements, index: number): void {
  // Remove previous selection
  const prev = ui.episodeList.querySelector('.episode-item.active');
  if (prev) prev.classList.remove('active');

  // Select new
  const item = ui.episodeList.querySelector(`[data-episode="${index}"]`);
  if (item) {
    item.classList.add('active');
    // Scroll into view if needed
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
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
  ui.datasetMeta.textContent = `${fps} fps | ${totalEpisodes} ep | ${totalFrames} frames`;
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

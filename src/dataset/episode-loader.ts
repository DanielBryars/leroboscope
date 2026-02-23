import { detectVersion, fetchDatasetInfo, fetchParquetFile, formatDataPath } from './hf-client';
import { readParquetAsObjects, readParquetSlice } from './parquet-reader';
import type { DatasetInfo, EpisodeMetadata, EpisodeData, FrameData } from '../types';

/**
 * Full dataset info including version + revision for subsequent fetches.
 */
export interface DatasetContext {
  repoId: string;
  version: string;
  revision: string;
  info: DatasetInfo;
}

/**
 * Load dataset metadata from a HF repo ID.
 */
export async function loadDatasetContext(repoId: string): Promise<DatasetContext> {
  const { version, revision } = await detectVersion(repoId);
  const info = await fetchDatasetInfo(repoId, revision);
  return { repoId, version, revision, info };
}

/**
 * Load an episode's frame data from a dataset.
 */
export async function loadEpisode(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<EpisodeData> {
  if (ctx.version === 'v3.0') {
    return loadEpisodeV3(ctx, episodeIndex);
  }
  return loadEpisodeV2(ctx, episodeIndex);
}

/**
 * V3.0: Load episode metadata parquet, then data parquet slice.
 */
async function loadEpisodeV3(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<EpisodeData> {
  // Load episode metadata
  const epMeta = await loadEpisodeMetadata(ctx, episodeIndex);

  // Build data file path
  const chunk = epMeta.data_chunk_index;
  const file = epMeta.data_file_index;
  const dataPath = `data/chunk-${chunk.toString().padStart(3, '0')}/file-${file.toString().padStart(3, '0')}.parquet`;

  const buffer = await fetchParquetFile(ctx.repoId, ctx.revision, dataPath);

  // Read the slice for this episode
  const fromIndex = epMeta.dataset_from_index;
  const toIndex = epMeta.dataset_to_index;

  // First read full data to find file start offset
  const fullData = await readParquetAsObjects(buffer);

  // Calculate local indices
  let fileStartIndex = 0;
  if (fullData.length > 0 && fullData[0].index !== undefined) {
    fileStartIndex = Number(fullData[0].index);
  }
  const localFrom = Math.max(0, fromIndex - fileStartIndex);
  const localTo = Math.min(fullData.length, toIndex - fileStartIndex);
  const episodeRows = fullData.slice(localFrom, localTo);

  const frames = extractFrames(episodeRows, ctx.info);

  return {
    frames,
    fps: ctx.info.fps,
    episodeIndex,
    totalFrames: frames.length,
  };
}

/**
 * V2.x: Load per-episode parquet file directly.
 */
async function loadEpisodeV2(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<EpisodeData> {
  const episodeChunk = Math.floor(episodeIndex / (ctx.info.chunks_size || 1000));
  const dataPath = formatDataPath(ctx.info.data_path, {
    episode_chunk: episodeChunk,
    episode_index: episodeIndex,
  });

  const buffer = await fetchParquetFile(ctx.repoId, ctx.revision, dataPath);
  const rows = await readParquetAsObjects(buffer);

  const frames = extractFrames(rows, ctx.info);

  return {
    frames,
    fps: ctx.info.fps,
    episodeIndex,
    totalFrames: frames.length,
  };
}

/**
 * Load episode metadata for V3.0 datasets.
 */
async function loadEpisodeMetadata(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<EpisodeMetadata> {
  // Try chunk-000/file-000 first, iterate files if needed
  let fileIdx = 0;
  const chunkIdx = 0;

  while (true) {
    const path = `meta/episodes/chunk-${chunkIdx.toString().padStart(3, '0')}/file-${fileIdx.toString().padStart(3, '0')}.parquet`;

    try {
      const buffer = await fetchParquetFile(ctx.repoId, ctx.revision, path);
      const rows = await readParquetAsObjects(buffer);

      for (const row of rows) {
        const epIdx = toNumber(row.episode_index ?? row['0']);
        if (epIdx === episodeIndex) {
          return parseEpisodeMetadata(row);
        }
      }

      // Episode not in this file, try next
      fileIdx++;
    } catch {
      throw new Error(`Episode ${episodeIndex} not found in metadata`);
    }
  }
}

function parseEpisodeMetadata(row: Record<string, unknown>): EpisodeMetadata {
  // Handle both named and numeric key formats
  if ('episode_index' in row) {
    return {
      episode_index: toNumber(row.episode_index),
      data_chunk_index: toNumber(row['data/chunk_index'] ?? row.data_chunk_index ?? 0),
      data_file_index: toNumber(row['data/file_index'] ?? row.data_file_index ?? 0),
      dataset_from_index: toNumber(row.dataset_from_index ?? 0),
      dataset_to_index: toNumber(row.dataset_to_index ?? 0),
      length: toNumber(row.length ?? 0),
    };
  }
  // Numeric key fallback
  return {
    episode_index: toNumber(row['0'] ?? 0),
    data_chunk_index: toNumber(row['1'] ?? 0),
    data_file_index: toNumber(row['2'] ?? 0),
    dataset_from_index: toNumber(row['3'] ?? 0),
    dataset_to_index: toNumber(row['4'] ?? 0),
    length: toNumber(row['9'] ?? 0),
  };
}

/**
 * Extract frame data from parquet rows.
 * Looks for observation.state (or action as fallback) in each row.
 */
function extractFrames(rows: Record<string, unknown>[], info: DatasetInfo): FrameData[] {
  const frames: FrameData[] = [];

  // Determine which column has the state data
  const hasState = 'observation.state' in (info.features || {});
  const hasAction = 'action' in (info.features || {});

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let state: number[] | null = null;
    let action: number[] | undefined;

    // Try observation.state
    const stateVal = row['observation.state'];
    if (Array.isArray(stateVal)) {
      state = stateVal.map(Number);
    }

    // Try action
    const actionVal = row['action'];
    if (Array.isArray(actionVal)) {
      action = actionVal.map(Number);
    }

    // If no observation.state, use action as state
    if (!state && action) {
      state = action;
    }

    // If using v3 with numeric keys, try to find the right array column
    if (!state) {
      for (const [key, val] of Object.entries(row)) {
        if (Array.isArray(val) && val.length === 6) {
          state = val.map(Number);
          break;
        }
      }
    }

    if (state) {
      frames.push({
        state,
        action,
        frameIndex: i,
        timestamp: row.timestamp !== undefined ? Number(row.timestamp) : undefined,
      });
    }
  }

  return frames;
}

function toNumber(val: unknown): number {
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'number') return val;
  return Number(val) || 0;
}

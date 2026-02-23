import { detectVersion, fetchDatasetInfo, fetchParquetFile, formatDataPath } from './hf-client';
import { readParquetAsObjects } from './parquet-reader';
import type { DatasetInfo, EpisodeMetadata, EpisodeData, FrameData, VideoInfo } from '../types';

const HF_BASE = 'https://huggingface.co';

export interface DatasetContext {
  repoId: string;
  version: string;
  revision: string;
  info: DatasetInfo;
}

export async function loadDatasetContext(repoId: string): Promise<DatasetContext> {
  const { version, revision } = await detectVersion(repoId);
  const info = await fetchDatasetInfo(repoId, revision);
  return { repoId, version, revision, info };
}

export async function loadEpisode(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<EpisodeData> {
  if (ctx.version === 'v3.0') {
    return loadEpisodeV3(ctx, episodeIndex);
  }
  return loadEpisodeV2(ctx, episodeIndex);
}

async function loadEpisodeV3(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<EpisodeData> {
  const epMeta = await loadEpisodeMetadata(ctx, episodeIndex);
  const epMetaRaw = await loadEpisodeMetadataRaw(ctx, episodeIndex);

  const chunk = epMeta.data_chunk_index;
  const file = epMeta.data_file_index;
  const dataPath = `data/chunk-${pad3(chunk)}/file-${pad3(file)}.parquet`;

  const buffer = await fetchParquetFile(ctx.repoId, ctx.revision, dataPath);
  const fullData = await readParquetAsObjects(buffer);

  const fromIndex = epMeta.dataset_from_index;
  const toIndex = epMeta.dataset_to_index;

  let fileStartIndex = 0;
  if (fullData.length > 0 && fullData[0].index !== undefined) {
    fileStartIndex = Number(fullData[0].index);
  }
  const localFrom = Math.max(0, fromIndex - fileStartIndex);
  const localTo = Math.min(fullData.length, toIndex - fileStartIndex);
  const episodeRows = fullData.slice(localFrom, localTo);

  const frames = extractFrames(episodeRows);
  const videos = extractVideoInfoV3(ctx, epMetaRaw);

  return {
    frames,
    fps: ctx.info.fps,
    episodeIndex,
    totalFrames: frames.length,
    videos,
  };
}

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

  const frames = extractFrames(rows);
  // v2 video paths use a simpler template
  const videos = extractVideoInfoV2(ctx, episodeIndex, episodeChunk);

  return {
    frames,
    fps: ctx.info.fps,
    episodeIndex,
    totalFrames: frames.length,
    videos,
  };
}

// --- Episode metadata ---

async function loadEpisodeMetadata(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<EpisodeMetadata> {
  const row = await loadEpisodeMetadataRaw(ctx, episodeIndex);
  return parseEpisodeMetadata(row);
}

async function loadEpisodeMetadataRaw(
  ctx: DatasetContext,
  episodeIndex: number,
): Promise<Record<string, unknown>> {
  let fileIdx = 0;
  const chunkIdx = 0;

  while (true) {
    const path = `meta/episodes/chunk-${pad3(chunkIdx)}/file-${pad3(fileIdx)}.parquet`;
    try {
      const buffer = await fetchParquetFile(ctx.repoId, ctx.revision, path);
      const rows = await readParquetAsObjects(buffer);

      for (const row of rows) {
        const epIdx = toNumber(row.episode_index ?? row['0']);
        if (epIdx === episodeIndex) return row;
      }
      fileIdx++;
    } catch {
      throw new Error(`Episode ${episodeIndex} not found in metadata`);
    }
  }
}

function parseEpisodeMetadata(row: Record<string, unknown>): EpisodeMetadata {
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
  return {
    episode_index: toNumber(row['0'] ?? 0),
    data_chunk_index: toNumber(row['1'] ?? 0),
    data_file_index: toNumber(row['2'] ?? 0),
    dataset_from_index: toNumber(row['3'] ?? 0),
    dataset_to_index: toNumber(row['4'] ?? 0),
    length: toNumber(row['9'] ?? 0),
  };
}

// --- Video info extraction ---

function extractVideoInfoV3(
  ctx: DatasetContext,
  epRow: Record<string, unknown>,
): VideoInfo[] {
  const videoFeatures = Object.entries(ctx.info.features).filter(
    ([, v]) => v.dtype === 'video',
  );

  return videoFeatures.map(([videoKey]) => {
    // Look for per-camera metadata: videos/{key}/chunk_index, file_index, from_timestamp, to_timestamp
    const chunkVal = epRow[`videos/${videoKey}/chunk_index`];
    const fileVal = epRow[`videos/${videoKey}/file_index`];
    const fromTs = epRow[`videos/${videoKey}/from_timestamp`];
    const toTs = epRow[`videos/${videoKey}/to_timestamp`];

    const chunkIndex = chunkVal !== undefined ? toNumber(chunkVal) : 0;
    const fileIndex = fileVal !== undefined ? toNumber(fileVal) : 0;
    const fromTimestamp = fromTs !== undefined ? toNumber(fromTs) : 0;
    const toTimestamp = toTs !== undefined ? toNumber(toTs) : 30;

    const videoPath = `videos/${videoKey}/chunk-${pad3(chunkIndex)}/file-${pad3(fileIndex)}.mp4`;
    const url = `${HF_BASE}/datasets/${ctx.repoId}/resolve/${ctx.revision}/${videoPath}`;

    return { key: videoKey, url, fromTimestamp, toTimestamp };
  });
}

function extractVideoInfoV2(
  ctx: DatasetContext,
  episodeIndex: number,
  episodeChunk: number,
): VideoInfo[] {
  if (!ctx.info.video_path) return [];

  const videoFeatures = Object.entries(ctx.info.features).filter(
    ([, v]) => v.dtype === 'video',
  );

  return videoFeatures.map(([videoKey]) => {
    const videoPath = ctx.info.video_path!
      .replace(/{video_key}/g, videoKey)
      .replace(/{episode_chunk(?::\d+d)?}/g, pad3(episodeChunk))
      .replace(/{episode_index(?::\d+d)?}/g, episodeIndex.toString().padStart(6, '0'));

    const url = `${HF_BASE}/datasets/${ctx.repoId}/resolve/${ctx.revision}/${videoPath}`;
    return { key: videoKey, url, fromTimestamp: 0, toTimestamp: 0 };
  });
}

// --- Frame extraction ---

function extractFrames(rows: Record<string, unknown>[]): FrameData[] {
  const frames: FrameData[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let state: number[] | null = null;
    let action: number[] | undefined;

    const stateVal = row['observation.state'];
    if (Array.isArray(stateVal)) {
      state = stateVal.map(Number);
    }

    const actionVal = row['action'];
    if (Array.isArray(actionVal)) {
      action = actionVal.map(Number);
    }

    if (!state && action) {
      state = action;
    }

    // Fallback: find first 6-element array
    if (!state) {
      for (const [, val] of Object.entries(row)) {
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

// --- Helpers ---

function toNumber(val: unknown): number {
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'number') return val;
  return Number(val) || 0;
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

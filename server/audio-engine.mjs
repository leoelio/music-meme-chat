import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const app = express();
const port = Number(process.env.AUDIO_ENGINE_PORT || 8787);
const rootDir = path.resolve('.tmp', 'audio-engine');
const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';

await fs.mkdir(rootDir, { recursive: true });

const upload = multer({
  dest: rootDir,
  limits: { fileSize: 80 * 1024 * 1024 },
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: '120mb' }));
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

async function sendAudioFile(res, outputPath, filename, format) {
  const buffer = await fs.readFile(outputPath);
  res.setHeader('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

async function commandWorks(command, args) {
  try {
    await run(command, args);
    return true;
  } catch {
    return false;
  }
}

function parseConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clamp(value, min, max, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function quoteConcatPath(filePath) {
  return `file '${filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

async function probeDuration(filePath) {
  const { stdout } = await run(ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return Math.max(0, Number(stdout.trim()) || 0);
}

function normalizeSegments(config, duration) {
  const rawSegments = Array.isArray(config.segments) && config.segments.length
    ? config.segments
    : [{ start: 0, end: Math.min(duration, 15), gain: 1, muted: false }];
  return rawSegments.map((segment) => {
    const start = clamp(segment.start, 0, duration, 0);
    const end = clamp(segment.end, start + 0.05, duration, Math.min(duration, start + 15));
    return {
      start,
      end,
      gain: clamp(segment.gain, 0, 2, 1),
      muted: Boolean(segment.muted),
    };
  }).filter((segment) => segment.end - segment.start > 0.04);
}

function atempoFilters(speed) {
  let value = clamp(speed, 0.5, 2, 1);
  const filters = [];
  while (value > 2) {
    filters.push('atempo=2');
    value /= 2;
  }
  while (value < 0.5) {
    filters.push('atempo=0.5');
    value /= 0.5;
  }
  if (Math.abs(value - 1) > 0.001) filters.push(`atempo=${value.toFixed(3)}`);
  return filters;
}

function pitchFilters(semitones) {
  const value = clamp(semitones, -12, 12, 0);
  if (!value) return [];
  const ratio = Math.pow(2, value / 12);
  return [
    `asetrate=44100*${ratio.toFixed(6)}`,
    'aresample=44100',
    `atempo=${(1 / ratio).toFixed(6)}`,
  ];
}

function buildEffectFilters(config, totalDuration) {
  const filters = [];
  const denoiseLevel = config.denoiseLevel || 'light';
  const denoiseMap = { light: 8, medium: 14, strong: 22 };
  if (config.denoise) filters.push(`afftdn=nr=${denoiseMap[denoiseLevel] || denoiseMap.light}`);

  const environment = config.environmentEffect || 'raw';
  if (environment === 'hall') filters.push('aecho=0.8:0.9:120|240:0.3|0.18');
  if (environment === 'valley') filters.push('aecho=0.82:0.92:340|620|920:0.48|0.28|0.16,lowpass=f=6200');
  if (environment === 'speaker') filters.push('acrusher=level_in=1.6:level_out=0.8:bits=8:mode=log,highpass=f=220,lowpass=f=4200');
  if (environment === 'muffled') filters.push('lowpass=f=1200');
  if (environment === 'bathroom') filters.push('aecho=0.8:0.88:70:0.35');

  const voice = config.voiceEffect || 'native';
  if (voice === 'robot') filters.push('acrusher=level_in=1.4:level_out=0.75:bits=6:mode=log');
  if (voice === 'opera') filters.push('bass=g=5:f=180,treble=g=2');
  if (voice === 'sweet') filters.push(...pitchFilters(1.4), 'treble=g=2');
  if (voice === 'uncle') filters.push(...pitchFilters(-2.2), 'bass=g=4:f=160');
  if (voice === 'cartoon') filters.push(...pitchFilters(3.5), 'treble=g=3');

  filters.push(...pitchFilters(config.semitones));
  filters.push(...atempoFilters(config.speed));

  const volumeDb = clamp(config.volumeDb, -20, 10, 0);
  if (volumeDb !== 0) filters.push(`volume=${volumeDb}dB`);
  const fadeIn = clamp(config.fadeIn, 0, 15, 0);
  const fadeOut = clamp(config.fadeOut, 0, 15, 0);
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0) filters.push(`afade=t=out:st=${Math.max(0, totalDuration - fadeOut)}:d=${fadeOut}`);

  return filters.length ? filters.join(',') : 'anull';
}

async function concatSegments(inputPath, segments, workDir) {
  const segmentPaths = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const segmentPath = path.join(workDir, `segment-${index}.wav`);
    const gainFilter = segment.muted ? 'volume=0' : `volume=${segment.gain}`;
    await run(ffmpegBin, [
      '-y',
      '-ss', String(segment.start),
      '-t', String(segment.end - segment.start),
      '-i', inputPath,
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-af', gainFilter,
      '-c:a', 'pcm_s16le',
      segmentPath,
    ]);
    segmentPaths.push(segmentPath);
  }

  const concatList = path.join(workDir, 'segments.txt');
  await fs.writeFile(concatList, segmentPaths.map(quoteConcatPath).join(os.EOL), 'utf8');
  const joinedPath = path.join(workDir, 'joined.wav');
  await run(ffmpegBin, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', joinedPath]);
  return joinedPath;
}

function outputArgs(config, outputPath) {
  const clarityRates = { standard: 22050, balanced: 44100, clear: 48000 };
  const rate = clarityRates[config.clarity] || clarityRates.balanced;
  const format = config.exportFormat === 'wav' ? 'wav' : 'mp3';
  if (format === 'wav') {
    return ['-ar', String(rate), '-c:a', 'pcm_s16le', outputPath];
  }
  return ['-ar', String(rate), '-c:a', 'libmp3lame', '-b:a', rate <= 22050 ? '96k' : '160k', outputPath];
}

async function writeDataUrlFile(payload, workDir, fallbackName) {
  if (!payload?.dataUrl) throw new Error('缺少音频数据');
  const [, base64 = ''] = payload.dataUrl.split(',');
  const extension = path.extname(payload.name || '') || '.mp3';
  const filePath = path.join(workDir, `${fallbackName}${extension}`);
  await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

async function processToFile(sourcePath, config, workDir) {
  const duration = await probeDuration(sourcePath);
  const segments = normalizeSegments(config, duration);
  const totalDuration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  if (!segments.length || totalDuration > 15.01) {
    throw new Error('总时长需要控制在 15 秒内');
  }

  const joinedPath = await concatSegments(sourcePath, segments, workDir);
  const format = config.exportFormat === 'wav' ? 'wav' : 'mp3';
  const outputPath = path.join(workDir, `output.${format}`);
  await run(ffmpegBin, [
    '-y',
    '-i', joinedPath,
    '-vn',
    '-af', buildEffectFilters(config, totalDuration),
    ...outputArgs(config, outputPath),
  ]);
  return { outputPath, format };
}

app.get('/api/audio/health', async (_req, res) => {
  const ffmpeg = await commandWorks(ffmpegBin, ['-version']);
  res.json({
    ok: ffmpeg,
    ffmpeg,
    mode: ffmpeg ? 'ffmpeg-only' : 'offline',
  });
});

app.post('/api/audio/process', upload.single('file'), async (req, res) => {
  const source = req.file;
  if (!source) {
    res.status(400).json({ error: '缺少音频文件' });
    return;
  }

  const workDir = path.join(rootDir, crypto.randomUUID());
  await fs.mkdir(workDir, { recursive: true });
  try {
    const config = parseConfig(req.body.config);
    const { outputPath, format } = await processToFile(source.path, config, workDir);
    await sendAudioFile(res, outputPath, `${config.title || '音梗'}.${format}`, format);
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(source.path, { force: true });
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(source.path, { force: true });
    res.status(500).json({ error: error.message || '处理失败' });
  }
});

app.post('/api/audio/process-json', async (req, res) => {
  const workDir = path.join(rootDir, crypto.randomUUID());
  await fs.mkdir(workDir, { recursive: true });
  try {
    const config = parseConfig(req.body.config);
    const sourcePath = await writeDataUrlFile(req.body.file, workDir, 'source');
    const { outputPath, format } = await processToFile(sourcePath, config, workDir);
    await sendAudioFile(res, outputPath, `${config.title || '音梗'}.${format}`, format);
    await fs.rm(workDir, { recursive: true, force: true });
  } catch (error) {
    console.error(error);
    await fs.rm(workDir, { recursive: true, force: true });
    res.status(500).json({ error: error.message || '处理失败' });
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Audio engine listening on http://127.0.0.1:${port}`);
});

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'test mp3');
const publicDir = path.join(root, 'public', 'audio', 'library');
const outFile = path.join(root, 'src', 'data', 'tracks.js');
const audioExts = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);

const manual = new Map([
  [
    'i am rich man',
    {
      title: 'Rich Man',
      artist: 'aespa',
      genre: 'Kpop',
      category: 'Kpop',
      triggers: [
        'i am rich man',
        'iam rich man',
        'rich man',
        '我是 rich man',
        '我是有钱人',
        '我很有钱',
        '有钱',
        '富哥',
        '有钱就是任性',
      ],
    },
  ],
  [
    'sorry sorry',
    {
      title: 'Sorry Sorry',
      artist: 'SUPER JUNIOR',
      genre: 'Kpop',
      category: 'Kpop',
      triggers: ['sorry sorry', 'sorry', '对不起', '抱歉', '骚瑞', '我错了', '对不起对不起'],
    },
  ],
]);

const triggerExtras = new Map([
  ['come on', ['comeon', '来吧', '快点', '冲', '加油']],
  ['gogogo出发咯', ['gogogo', '出发咯', '出发喽', '狗狗狗出发咯']],
  ["let's go party", ['lets go party', 'lets go', 'party', '出发', '派对']],
  ['waitwaitwait', ['waitwait', 'wait wait', 'wait', '等等', '等一下']],
  ['再给我两分钟', ['给我两分钟', '两分钟', '再等两分钟', '等我两分钟']],
  ['还要多久', ['多久', '要多久', '还得多久', '什么时候好']],
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

function clean(value) {
  return value
    .replace(/[“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq(values) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function dedupeKey(meta) {
  return [meta.triggers[0], meta.title, meta.artist]
    .map((value) => clean(String(value || '')).toLowerCase())
    .join('|');
}

function hash(value) {
  let result = 0;
  for (const char of value) {
    result = (result * 31 + char.codePointAt(0)) >>> 0;
  }
  return result.toString(36);
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
  return slug ? slug : `track-${hash(value)}`;
}

function formatDuration(filePath) {
  try {
    const output = execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { encoding: 'utf8' });
    const seconds = Math.max(1, Math.round(Number(output.trim()) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  } catch {
    return '0:00';
  }
}

function inferTags(genre, artist, filePath) {
  const explicit = String(genre || '').toLowerCase();
  const text = `${genre} ${artist} ${filePath}`.toLowerCase();
  const tags = [];
  if (/华语|中文|流行舞曲/.test(explicit)) tags.push('华语');
  if (/kpop|k-pop/.test(explicit)) tags.push('Kpop');
  if (/欧美/.test(explicit)) tags.push('欧美');
  if (/综艺/.test(explicit)) tags.push('综艺');
  if (/自选|音效/.test(explicit)) tags.push('自选');

  if (/\bkpop\b|\bk-pop\b|\baespa\b|\btwice\b|\bbts\b|\bblackpink\b|\bive\b|\billit\b|\bseventeen\b|\bnct\b|\ble sserafim\b|\bros[eé]\b/.test(text)) tags.push('Kpop');
  if (/欧美|\bbruno mars\b|\bsia\b|\bcheap thrills\b|\btaylor swift\b|\badele\b|\bjustin bieber\b|\blady gaga\b|\bbeyonce\b|\btate mcrae\b/.test(text)) tags.push('欧美');
  if (/华语|周杰伦|蔡徐坤|邓超|中文|流行舞曲/.test(text)) tags.push('华语');
  if (/综艺/.test(text)) tags.push('综艺');
  if (/自创|自选|音效/.test(text)) tags.push('自选');
  return uniq(tags.length ? tags : ['自选']);
}

function isGenreOnly(value) {
  return /^(华语|中文|kpop|k-pop|欧美|综艺|自选|抽象)([、,，/\s]*(华语|中文|kpop|k-pop|欧美|综艺|自选|抽象))*$/i.test(clean(value));
}

function splitMeta(base) {
  if (base.includes('--')) return base.split(/\s*--\s*/).map(clean);
  if (/[—–]/.test(base)) return base.split(/\s*[—–]\s*/).map(clean);
  return base.split(/\s*-\s*/).map(clean);
}

function parseTriggers(raw) {
  const aliases = [];
  const withoutOuterQuotes = clean(raw);
  let primary = withoutOuterQuotes;
  const parenPattern = /（([^）]+)）|\(([^)]+)\)/g;
  primary = primary.replace(parenPattern, (_, cn, en) => {
    aliases.push(cn || en);
    return ' ';
  });
  const compactPrimary = clean(primary);
  const pieces = [withoutOuterQuotes, compactPrimary, ...aliases];
  compactPrimary.split(/\s+/).forEach((piece) => {
    if (/[\p{Script=Han}]/u.test(piece)) pieces.push(piece);
  });
  const extras = triggerExtras.get(compactPrimary.toLowerCase()) ?? triggerExtras.get(compactPrimary);
  if (extras) pieces.push(...extras);
  return uniq(pieces);
}

function parseFormatted(filePath) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const parts = splitMeta(base);
  let [triggerRaw, titleRaw, artistRaw, genreRaw] = parts;
  if (parts.length === 3 && isGenreOnly(parts[2])) {
    [triggerRaw, artistRaw, genreRaw] = parts;
    titleRaw = triggerRaw;
  }
  const genre = genreRaw || (filePath.includes('kpop抽象1') ? 'Kpop' : '自选');
  const artist = artistRaw || '未知歌手';
  const tags = inferTags(genre, artist, filePath);
  return {
    title: titleRaw || clean(triggerRaw),
    artist,
    genre,
    category: tags[0],
    categories: tags,
    triggers: parseTriggers(triggerRaw),
  };
}

function parseSimple(filePath) {
  const ext = path.extname(filePath);
  const base = clean(path.basename(filePath, ext));
  const key = base.toLowerCase();
  if (manual.has(key)) {
    const item = manual.get(key);
    return { ...item, categories: inferTags(item.genre, item.artist, filePath) };
  }
  const isCustomFx = /自创音效库614|自设音效|音效/.test(filePath);
  if (!isCustomFx) return null;
  return {
    title: base,
    artist: '自选音效',
    genre: '自选',
    category: '自选',
    categories: ['自选'],
    triggers: [base],
  };
}

function shouldImport(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!audioExts.has(ext)) return false;
  if (filePath.includes('整曲')) return false;
  const base = path.basename(filePath, path.extname(filePath));
  const parts = splitMeta(base);
  return parts.length >= 4 || (parts.length === 3 && isGenreOnly(parts[2])) || manual.has(base.toLowerCase()) || /自创音效库614|自设音效|音效/.test(filePath);
}

function toTrack(filePath, index, usedIds, seenKeys) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, path.extname(filePath));
  const parts = splitMeta(base);
  const formatted = parts.length >= 4 || (parts.length === 3 && isGenreOnly(parts[2]));
  const meta = formatted ? parseFormatted(filePath) : parseSimple(filePath);
  if (!meta) return null;
  const key = dedupeKey(meta);
  if (seenKeys.has(key)) return null;
  seenKeys.add(key);
  const seed = `${meta.triggers[0]}-${meta.title}-${meta.artist}`;
  let id = slugify(seed);
  while (usedIds.has(id)) id = `${slugify(seed)}-${index}`;
  usedIds.add(id);
  const filename = `${id}${ext}`;
  fs.copyFileSync(filePath, path.join(publicDir, filename));
  return {
    id,
    title: meta.title,
    artist: meta.artist,
    audioUrl: `/audio/library/${filename}`,
    duration: formatDuration(filePath),
    tone: meta.category,
    category: meta.category,
    categories: meta.categories,
    genre: meta.genre,
    triggers: uniq(meta.triggers),
    source: formatted ? 'library' : 'seed',
    savedName: `${meta.triggers[0]}-${meta.title}-${meta.artist}-${meta.genre}`,
  };
}

fs.mkdirSync(publicDir, { recursive: true });
for (const file of fs.readdirSync(publicDir)) {
  if (audioExts.has(path.extname(file).toLowerCase())) fs.rmSync(path.join(publicDir, file));
}

const usedIds = new Set();
const seenKeys = new Set();
const tracks = walk(sourceRoot)
  .filter(shouldImport)
  .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  .map((filePath, index) => toTrack(filePath, index, usedIds, seenKeys))
  .filter(Boolean);

const output = `export const categories = ['全部', '华语', 'Kpop', '欧美', '综艺', '自选'];\n\nexport const tracks = ${JSON.stringify(tracks, null, 2)};\n`;
fs.writeFileSync(outFile, output, 'utf8');

console.log(`Imported ${tracks.length} clips into ${path.relative(root, publicDir)}`);

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
    : null;

function normalize(value) {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chars(value) {
  const normalized = normalize(value);
  if (!normalized) return [];
  return segmenter
    ? [...segmenter.segment(normalized)].map((part) => part.segment)
    : [...normalized];
}

function bigrams(value) {
  const parts = chars(value).filter((part) => part.trim());
  if (parts.length <= 1) return parts;
  return parts.slice(0, -1).map((part, index) => `${part}${parts[index + 1]}`);
}

function levenshtein(a, b) {
  const left = chars(a);
  const right = chars(b);
  const rows = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    let previous = rows[0];
    rows[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const saved = rows[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + cost);
      previous = saved;
    }
  }

  return rows[right.length];
}

function diceScore(input, target) {
  const left = bigrams(input);
  const right = bigrams(target);
  if (!left.length || !right.length) return 0;

  const rightCounts = new Map();
  right.forEach((item) => rightCounts.set(item, (rightCounts.get(item) ?? 0) + 1));

  let overlap = 0;
  left.forEach((item) => {
    const count = rightCounts.get(item) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(item, count - 1);
    }
  });

  return (2 * overlap) / (left.length + right.length);
}

function tokenSet(value) {
  return new Set(normalize(value).split(' ').filter(Boolean));
}

function startsWordWith(input, target) {
  const needle = normalize(input);
  return normalize(target)
    .split(' ')
    .filter(Boolean)
    .some((part) => part.startsWith(needle));
}

function containsScore(input, target) {
  const a = normalize(input);
  const b = normalize(target);
  const inputLength = chars(a).length;
  const targetLength = chars(b).length;
  const short = Math.min(inputLength, targetLength);
  const long = Math.max(inputLength, targetLength);
  const haystack = b.includes(a) ? b : a;
  const needle = b.includes(a) ? a : b;
  const index = haystack.indexOf(needle);
  const coverage = long ? short / long : 0;
  const tokens = tokenSet(target);
  const startsAtBeginning = b.startsWith(a) || a.startsWith(b);

  let score = 0.55 + coverage * 0.25;

  if (startsAtBeginning) {
    score += 0.2;
  } else if (startsWordWith(input, target)) {
    const spread = Math.max(1, chars(haystack).length - chars(needle).length);
    score += Math.max(0, 0.06 * (1 - index / spread));
  } else if (index >= 0) {
    const spread = Math.max(1, chars(haystack).length - chars(needle).length);
    score += Math.max(0, 0.08 * (1 - index / spread));
  }

  if (tokens.has(a)) {
    score += startsAtBeginning ? 0.08 : 0.04;
  }

  return Math.min(0.94, score);
}

function phraseScore(input, target) {
  const a = normalize(input);
  const b = normalize(target);
  if (!a || !b) return 0;
  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) {
    return containsScore(a, b);
  }

  const maxLength = Math.max(chars(a).length, chars(b).length);
  const editScore = maxLength ? 1 - levenshtein(a, b) / maxLength : 0;
  return Math.max(editScore, diceScore(a, b));
}

export const MATCH_THRESHOLD = 0.54;

function hasCjk(value) {
  return /\p{Script=Han}/u.test(value);
}

export function findTrackMatches(input, tracks, usageByTrack = {}, favoriteTrackIds = []) {
  const normalized = normalize(input);
  if (normalized.length < 2 && !hasCjk(normalized)) return [];
  const favoriteSet = new Set(favoriteTrackIds);

  const ranked = tracks.map((track) => {
    const best = track.triggers.reduce(
      (winner, trigger) => {
        const score = phraseScore(normalized, trigger);
        return score > winner.score ? { score, trigger } : winner;
      },
      { score: 0, trigger: track.triggers[0] },
    );

    const usageBoost = Math.min(0.06, Math.log1p(usageByTrack[track.id] ?? 0) * 0.018);
    const favoriteBoost = favoriteSet.has(track.id) ? 0.08 : 0;

    return {
      ...track,
      score: Math.min(1, best.score + usageBoost + favoriteBoost),
      baseScore: best.score,
      usageBoost,
      favoriteBoost,
      matchedTrigger: best.trigger,
    };
  });

  return ranked
    .filter((track) => track.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

export function findBestTrack(input, tracks, usageByTrack = {}, favoriteTrackIds = []) {
  return findTrackMatches(input, tracks, usageByTrack, favoriteTrackIds)[0] || null;
}

export function percent(score) {
  return `${Math.round(score * 100)}%`;
}

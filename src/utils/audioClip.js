import lamejs from 'lamejs';

export function formatSeconds(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function audioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('当前浏览器不支持音频处理。');
  }
  return new AudioContextClass();
}

function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function floatTo16BitPcm(view, offset, input) {
  for (let index = 0; index < input.length; index += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
}

export function encodeWav(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = samples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const channelData = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let sample = 0; sample < samples; sample += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      floatTo16BitPcm(view, offset, [channelData[channel][sample]]);
      offset += bytesPerSample;
    }
  }

  return buffer;
}

function readChunkId(view, offset) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function parseWavBitDepth(arrayBuffer) {
  if (arrayBuffer.byteLength < 44) return null;
  const view = new DataView(arrayBuffer);
  if (readChunkId(view, 0) !== 'RIFF' || readChunkId(view, 8) !== 'WAVE') return null;
  let offset = 12;
  while (offset + 8 < view.byteLength) {
    const id = readChunkId(view, offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16) {
      return view.getUint16(offset + 22, true);
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

export async function decodeAudioFile(file) {
  const context = audioContext();
  const sourceBuffer = await file.arrayBuffer();
  const decoded = await context.decodeAudioData(sourceBuffer.slice(0));
  await context.close();
  return { buffer: decoded, sourceBuffer };
}

export function inspectAudioFile(file, audioBuffer, sourceBuffer) {
  const extension = file?.name?.split('.').pop()?.toLowerCase() || 'audio';
  const bitDepth = extension === 'wav' ? parseWavBitDepth(sourceBuffer) : null;
  return {
    name: file?.name || '未命名音频',
    format: extension.toUpperCase(),
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    bitDepth: bitDepth || '压缩/未知',
    duration: audioBuffer.duration,
    size: file?.size || 0,
  };
}

export function initialSegments(audioBuffer) {
  return [{
    id: `seg-${Date.now()}`,
    start: 0,
    end: audioBuffer.duration,
    gain: 1,
    muted: false,
  }];
}

export function waveformSummary(audioBuffer, bins = 72) {
  if (!audioBuffer) return [];
  const channel = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(channel.length / bins));
  return Array.from({ length: bins }, (_, index) => {
    const start = index * step;
    const end = Math.min(channel.length, start + step);
    let peak = 0;
    for (let sample = start; sample < end; sample += 1) {
      peak = Math.max(peak, Math.abs(channel[sample]));
    }
    return Number(peak.toFixed(3));
  });
}

export function spectrumSummary(audioBuffer, bands = 20) {
  if (!audioBuffer) return [];
  const channel = audioBuffer.getChannelData(0);
  const size = Math.min(2048, channel.length);
  if (!size) return [];
  return Array.from({ length: bands }, (_, band) => {
    const frequencyBin = Math.max(1, Math.floor(((band + 1) / bands) * 120));
    let real = 0;
    let imag = 0;
    for (let index = 0; index < size; index += 1) {
      const angle = (2 * Math.PI * frequencyBin * index) / size;
      real += channel[index] * Math.cos(angle);
      imag -= channel[index] * Math.sin(angle);
    }
    return Math.min(1, Math.sqrt(real * real + imag * imag) / size * 8);
  });
}

function sampleLinear(data, position) {
  const left = Math.max(0, Math.min(data.length - 1, Math.floor(position)));
  const right = Math.max(0, Math.min(data.length - 1, left + 1));
  const mix = position - left;
  return data[left] * (1 - mix) + data[right] * mix;
}

function segmentFrameCount(audioBuffer, segments) {
  return segments.reduce((total, segment) => {
    const start = Math.floor(segment.start * audioBuffer.sampleRate);
    const end = Math.floor(segment.end * audioBuffer.sampleRate);
    return total + Math.max(0, end - start);
  }, 0);
}

function buildSegmentChannels(audioBuffer, segments) {
  const frameCount = Math.max(1, segmentFrameCount(audioBuffer, segments));
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, () => new Float32Array(frameCount));
  let cursor = 0;
  segments.forEach((segment) => {
    const start = Math.max(0, Math.floor(segment.start * audioBuffer.sampleRate));
    const end = Math.min(audioBuffer.length, Math.floor(segment.end * audioBuffer.sampleRate));
    const gain = segment.muted ? 0 : Number(segment.gain) || 1;
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const source = audioBuffer.getChannelData(channel);
      for (let frame = start; frame < end; frame += 1) {
        channels[channel][cursor + frame - start] = source[frame] * gain;
      }
    }
    cursor += Math.max(0, end - start);
  });
  return channels;
}

function convertChannels(channels, mode) {
  if (mode === 'mono' && channels.length > 1) {
    const mono = new Float32Array(channels[0].length);
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] = channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length;
    }
    return [mono];
  }
  if (mode === 'stereo' && channels.length === 1) {
    return [channels[0].slice(), channels[0].slice()];
  }
  return channels.map((channel) => channel.slice());
}

function applyDenoise(channels, level = 'light') {
  const thresholdMap = {
    light: 0.008,
    medium: 0.014,
    strong: 0.022,
  };
  const threshold = thresholdMap[level] ?? thresholdMap.light;
  channels.forEach((channel) => {
    const sampleCount = Math.min(channel.length, 2048);
    let mean = 0;
    for (let index = 0; index < sampleCount; index += 1) mean += channel[index];
    mean /= Math.max(1, sampleCount);
    for (let index = 0; index < channel.length; index += 1) {
      const cleaned = channel[index] - mean;
      channel[index] = Math.abs(cleaned) < threshold ? 0 : cleaned;
    }
  });
}

function applyFadesAndVolume(channels, sampleRate, volume, fadeIn, fadeOut) {
  const fadeInFrames = Math.max(0, Math.floor(fadeIn * sampleRate));
  const fadeOutFrames = Math.max(0, Math.floor(fadeOut * sampleRate));
  channels.forEach((channel) => {
    for (let index = 0; index < channel.length; index += 1) {
      let gain = volume;
      if (fadeInFrames && index < fadeInFrames) gain *= index / fadeInFrames;
      if (fadeOutFrames && index > channel.length - fadeOutFrames) gain *= Math.max(0, (channel.length - index) / fadeOutFrames);
      channel[index] = Math.max(-1, Math.min(1, channel[index] * gain));
    }
  });
}

function resampleChannels(channels, factor) {
  if (Math.abs(factor - 1) < 0.001) return channels;
  const outputLength = Math.max(1, Math.floor(channels[0].length / factor));
  return channels.map((channel) => {
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      output[index] = sampleLinear(channel, index * factor);
    }
    return output;
  });
}

function timeStretchChannels(channels, speed) {
  const factor = Math.max(0.5, Math.min(2, Number(speed) || 1));
  if (Math.abs(factor - 1) < 0.001) return channels;
  const grainSize = 2048;
  const hopOut = 512;
  const outputLength = Math.max(1, Math.floor(channels[0].length / factor));
  return channels.map((channel) => {
    const output = new Float32Array(outputLength + grainSize);
    const weight = new Float32Array(outputLength + grainSize);
    for (let outPos = 0; outPos < outputLength; outPos += hopOut) {
      const inPos = outPos * factor;
      for (let index = 0; index < grainSize; index += 1) {
        const target = outPos + index;
        if (target >= output.length) break;
        const windowGain = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, grainSize - 1));
        output[target] += sampleLinear(channel, inPos + index) * windowGain;
        weight[target] += windowGain;
      }
    }
    const trimmed = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      trimmed[index] = weight[index] ? output[index] / weight[index] : output[index];
    }
    return trimmed;
  });
}

function pitchShiftChannels(channels, semitones) {
  const value = Number(semitones) || 0;
  if (!value) return channels;
  const pitchRatio = Math.pow(2, value / 12);
  const shifted = resampleChannels(channels, pitchRatio);
  return timeStretchChannels(shifted, 1 / pitchRatio);
}

function resampleToSampleRate(channels, sourceRate, targetRate) {
  const nextRate = Number(targetRate) || sourceRate;
  if (Math.abs(nextRate - sourceRate) < 1) return { channels, sampleRate: sourceRate };
  const ratio = sourceRate / nextRate;
  const outputLength = Math.max(1, Math.floor(channels[0].length / ratio));
  return {
    sampleRate: nextRate,
    channels: channels.map((channel) => {
      const output = new Float32Array(outputLength);
      for (let index = 0; index < outputLength; index += 1) {
        output[index] = sampleLinear(channel, index * ratio);
      }
      return output;
    }),
  };
}

function applyEnvironmentEffect(channels, sampleRate, effect) {
  if (!effect || effect === 'raw') return;
  const presets = {
    hall: { delay: 0.12, feedback: 0.34, mix: 0.36 },
    valley: { delay: 0.34, feedback: 0.5, mix: 0.48, lowpass: 0.26, wide: true },
    speaker: { delay: 0.018, feedback: 0.12, mix: 0.2, drive: 2.2 },
    muffled: { delay: 0.02, feedback: 0.08, mix: 0.18, lowpass: 0.18 },
    bathroom: { delay: 0.07, feedback: 0.28, mix: 0.32 },
  };
  const preset = presets[effect];
  if (!preset) return;
  channels.forEach((channel, channelIndex) => {
    const spread = preset.wide ? channelIndex * 0.055 : 0;
    const delayFrames = Math.max(1, Math.floor((preset.delay + spread) * sampleRate));
    let low = 0;
    for (let index = delayFrames; index < channel.length; index += 1) {
      const echo = channel[index - delayFrames] * preset.feedback;
      let next = channel[index] * (1 - preset.mix) + echo * preset.mix;
      if (preset.lowpass) {
        low += (next - low) * preset.lowpass;
        next = low;
      }
      if (preset.drive) next = Math.tanh(next * preset.drive);
      channel[index] = Math.max(-1, Math.min(1, next));
    }
  });
}

function applyVoiceEffect(channels, effect) {
  if (!effect || effect === 'native') return;
  const presets = {
    robot: { quantize: 0.11, tremolo: 0.18 },
    opera: { gain: 1.18, body: 0.08 },
    sweet: { pitch: 1.08, gain: 0.94 },
    uncle: { pitch: 0.88, gain: 1.08 },
    cartoon: { pitch: 1.22, gain: 0.86 },
  };
  const preset = presets[effect];
  if (!preset) return;
  channels.forEach((channel) => {
    if (preset.pitch) {
      const shifted = new Float32Array(channel.length);
      for (let index = 0; index < channel.length; index += 1) {
        shifted[index] = sampleLinear(channel, index * preset.pitch);
      }
      channel.set(shifted);
    }
    for (let index = 0; index < channel.length; index += 1) {
      let next = channel[index] * (preset.gain || 1);
      if (preset.quantize) next = Math.round(next / preset.quantize) * preset.quantize;
      if (preset.tremolo) next *= 0.86 + Math.sin(index * 0.035) * preset.tremolo;
      if (preset.body && index > 0) next = next * (1 - preset.body) + channel[index - 1] * preset.body;
      channel[index] = Math.max(-1, Math.min(1, next));
    }
  });
}

async function channelsToAudioBuffer(channels, sampleRate) {
  const context = audioContext();
  const output = context.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((channel, index) => output.copyToChannel(channel, index));
  await context.close();
  return output;
}

export async function renderEditedAudio(audioBuffer, segments, options = {}) {
  const {
    volume = 1,
    fadeIn = 0,
    fadeOut = 0,
    speed = 1,
    semitones = 0,
    denoise = false,
    denoiseLevel = 'light',
    channelMode = 'keep',
    environmentEffect = 'raw',
    voiceEffect = 'native',
    outputSampleRate = audioBuffer.sampleRate,
  } = options;

  let channels = buildSegmentChannels(audioBuffer, segments);
  channels = convertChannels(channels, channelMode);
  if (denoise) applyDenoise(channels, denoiseLevel);
  applyEnvironmentEffect(channels, audioBuffer.sampleRate, environmentEffect);
  applyVoiceEffect(channels, voiceEffect);
  applyFadesAndVolume(channels, audioBuffer.sampleRate, Number(volume) || 1, Number(fadeIn) || 0, Number(fadeOut) || 0);
  channels = pitchShiftChannels(channels, semitones);
  channels = timeStretchChannels(channels, speed);
  const resampled = resampleToSampleRate(channels, audioBuffer.sampleRate, outputSampleRate);
  return channelsToAudioBuffer(resampled.channels, resampled.sampleRate);
}

export function audioBufferToWavBlob(audioBuffer) {
  return new Blob([encodeWav(audioBuffer)], { type: 'audio/wav' });
}

export function audioBufferToMp3Blob(audioBuffer, kbps = 128) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const encoder = new lamejs.Mp3Encoder(channels, audioBuffer.sampleRate, kbps);
  const blockSize = 1152;
  const mp3Data = [];
  const pcm = Array.from({ length: channels }, (_, channel) => {
    const data = audioBuffer.getChannelData(channel);
    const output = new Int16Array(data.length);
    for (let index = 0; index < data.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, data[index]));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  });

  for (let index = 0; index < pcm[0].length; index += blockSize) {
    const left = pcm[0].subarray(index, index + blockSize);
    const chunk = channels > 1
      ? encoder.encodeBuffer(left, pcm[1].subarray(index, index + blockSize))
      : encoder.encodeBuffer(left);
    if (chunk.length) mp3Data.push(chunk);
  }
  const flush = encoder.flush();
  if (flush.length) mp3Data.push(flush);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

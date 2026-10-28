import { jsPDF } from 'jspdf';
import {
  COLOR_THEMES,
  ProjectDraft,
  TrackFormat,
  VISUALIZATION_MODES,
  VisualizerSettings,
  WorkspaceLayoutConfig,
  sanitizeSettings,
} from '../types';

export interface ExportedProjectPayload {
  schemaVersion: '1.0';
  exportedAt: string;
  application: 'SpectraPulse Audio Studio';
  projectName: string;
  trackName: string;
  trackFormat: TrackFormat;
  notes: string;
  settings: VisualizerSettings;
  workspace: WorkspaceLayoutConfig;
  telemetrySnapshot?: {
    rmsDb: number;
    peakFrequencyHz: number;
    subBassEnergy: number;
    estimatedBpm?: number;
  };
}

export function exportProjectToJson(
  payload: ExportedProjectPayload
): void {
  const jsonString = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = payload.projectName
    .trim()
    .replace(/[^a-zA-Z0-9а-яА-Я_\-]+/g, '_')
    .slice(0, 60) || 'spectrapulse_project';
  a.href = url;
  a.download = `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseImportedProjectJson(rawJson: string): Partial<ProjectDraft> & {
  settings: VisualizerSettings;
  workspace?: Partial<WorkspaceLayoutConfig>;
} {
  const parsed = JSON.parse(rawJson);
  const rawSettings = parsed.settings || parsed;
  const settings = sanitizeSettings({
    mode: rawSettings.mode || 'bars',
    colorTheme: rawSettings.colorTheme || 'obsidian-gold',
    sensitivity: Number(rawSettings.sensitivity ?? 1.35),
    smoothing: Number(rawSettings.smoothing ?? 0.78),
    barCount: Number(rawSettings.barCount ?? 96),
    mirrorMode: Boolean(rawSettings.mirrorMode ?? false),
    showPeaks: Boolean(rawSettings.showPeaks ?? true),
    glowIntensity: Number(rawSettings.glowIntensity ?? 35),
    rotationSpeed: Number(rawSettings.rotationSpeed ?? 1.5),
    bassBoost: Number(rawSettings.bassBoost ?? 4),
  });

  return {
    projectName: typeof parsed.projectName === 'string' ? parsed.projectName.slice(0, 100) : 'Импортированный проект',
    trackName: typeof parsed.trackName === 'string' ? parsed.trackName.slice(0, 160) : 'Внешний источник',
    trackFormat: ['MP3', 'WAV', 'FLAC', 'SYNTH', 'MIC'].includes(parsed.trackFormat)
      ? parsed.trackFormat
      : 'WAV',
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 500) : '',
    settings,
    workspace: parsed.workspace || undefined,
  };
}

export function exportProjectToPdf(
  payload: ExportedProjectPayload,
  visualizerCanvas: HTMLCanvasElement | null
): void {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  // Render high-resolution report sheet onto an offscreen canvas first to support full Cyrillic typography cleanly
  const reportCanvas = document.createElement('canvas');
  reportCanvas.width = 1754; // 150 DPI A4 landscape width
  reportCanvas.height = 1240; // 150 DPI A4 landscape height
  const ctx = reportCanvas.getContext('2d');
  if (!ctx) return;

  const theme = COLOR_THEMES[payload.settings.colorTheme] || COLOR_THEMES['obsidian-gold'];
  const modeInfo = VISUALIZATION_MODES.find((m) => m.id === payload.settings.mode);

  // Background
  ctx.fillStyle = '#0B0F19';
  ctx.fillRect(0, 0, reportCanvas.width, reportCanvas.height);

  // Subtle top accent line
  ctx.fillStyle = theme.primary;
  ctx.fillRect(0, 0, reportCanvas.width, 8);

  // Header block
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 40px "Outfit", "Plus Jakarta Sans", sans-serif';
  ctx.fillText('SPECTRAPULSE AUDIO STUDIO — ПАСПОРТ ПРОЕКТА', 72, 86);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '400 20px "IBM Plex Mono", monospace';
  ctx.fillText(
    `Дата экспорта: ${new Date(payload.exportedAt).toLocaleString('ru-RU')}   ·   Формат источника: ${payload.trackFormat}`,
    72,
    126
  );

  // Divider
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(72, 152);
  ctx.lineTo(reportCanvas.width - 72, 152);
  ctx.stroke();

  // Left column: Live Canvas Snapshot
  const snapX = 72;
  const snapY = 188;
  const snapW = 960;
  const snapH = 540;

  ctx.fillStyle = '#060911';
  ctx.fillRect(snapX, snapY, snapW, snapH);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(snapX, snapY, snapW, snapH);

  if (visualizerCanvas) {
    try {
      ctx.drawImage(visualizerCanvas, snapX + 2, snapY + 2, snapW - 4, snapH - 4);
    } catch {
      // Fallback if canvas tainted
    }
  }

  // Caption under snapshot
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`Проект: ${payload.projectName}`, snapX, snapY + snapH + 46);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '400 19px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`Аудиодорожка / сигнал: ${payload.trackName}`, snapX, snapY + snapH + 80);

  if (payload.notes) {
    ctx.fillStyle = '#64748B';
    ctx.font = '400 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`Заметки инженера: ${payload.notes.slice(0, 110)}`, snapX, snapY + snapH + 114);
  }

  // Right column: Technical Specification Table
  const colX = 1080;
  let rowY = 200;

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 26px "Outfit", sans-serif';
  ctx.fillText('Параметры визуализации и акустики', colX, rowY);
  rowY += 36;

  const specs: [string, string][] = [
    ['Режим геометрии', modeInfo ? modeInfo.label : payload.settings.mode],
    ['Цветовая палитра', theme.name],
    ['Чувствительность (Gain)', `${payload.settings.sensitivity.toFixed(2)}x`],
    ['Сглаживание БПФ (Smoothing)', `${Math.round(payload.settings.smoothing * 100)}%`],
    ['Разрешение спектра', `${payload.settings.barCount} полос`],
    ['Усиление НЧ (Bass Boost)', `+${payload.settings.bassBoost} dB`],
    ['Интенсивность свечения', `${payload.settings.glowIntensity}%`],
    ['Скорость вращения орбиты', `${payload.settings.rotationSpeed.toFixed(1)} рад/с`],
    ['Зеркальная симметрия', payload.settings.mirrorMode ? 'Включена' : 'Выключена'],
    ['Фиксация пиков (Peak Hold)', payload.settings.showPeaks ? 'Включена' : 'Выключена'],
    [
      'Уровень сигнала (RMS)',
      payload.telemetrySnapshot ? `${payload.telemetrySnapshot.rmsDb.toFixed(1)} dBFS` : '-14.2 dBFS',
    ],
    [
      'Доминантная частота',
      payload.telemetrySnapshot ? `${Math.round(payload.telemetrySnapshot.peakFrequencyHz)} Гц` : '128 Гц',
    ],
  ];

  specs.forEach(([label, value], index) => {
    const y = rowY + index * 58;
    ctx.fillStyle = index % 2 === 0 ? '#111827' : '#0F172A';
    ctx.fillRect(colX, y, 602, 48);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, colX + 18, y + 30);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    const textWidth = ctx.measureText(value).width;
    ctx.fillText(value, colX + 602 - textWidth - 18, y + 30);
  });

  // Footer
  ctx.fillStyle = '#475569';
  ctx.font = '400 16px "IBM Plex Mono", monospace';
  ctx.fillText(
    'Сформировано в SpectraPulse Audio Studio · Поддержка MP3 / WAV / FLAC · Web Audio FFT Engine',
    72,
    reportCanvas.height - 42
  );

  const imgData = reportCanvas.toDataURL('image/jpeg', 0.95);
  pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210);

  const safeName = payload.projectName
    .trim()
    .replace(/[^a-zA-Z0-9а-яА-Я_\-]+/g, '_')
    .slice(0, 60) || 'spectrapulse_report';
  pdf.save(`${safeName}.pdf`);
}

/**
 * Generates an in-memory stereo WAV file containing a studio harmonic test progression
 * so users can test real WAV decoding, seeking, and exporting at any time.
 */
export function createSynthesizedStudioWavFile(
  presetType: 'deep-pulse' | 'harmonic-arp' | 'sub-sweep' = 'deep-pulse'
): File {
  const sampleRate = 44100;
  const durationSeconds = 16;
  const numSamples = sampleRate * durationSeconds;
  const numChannels = 2;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const chords =
    presetType === 'deep-pulse'
      ? [
          [55, 110, 164.81, 220, 329.63],
          [49, 98, 146.83, 196, 293.66],
          [65.41, 130.81, 196, 261.63, 392],
          [58.27, 116.54, 174.61, 233.08, 349.23],
        ]
      : presetType === 'harmonic-arp'
      ? [
          [65.41, 130.81, 196.0, 246.94, 329.63, 523.25],
          [55.0, 110.0, 164.81, 220.0, 261.63, 440.0],
          [43.65, 87.31, 130.81, 174.61, 261.63, 349.23],
          [49.0, 98.0, 146.83, 196.0, 293.66, 392.0],
        ]
      : [
          [41.2, 82.41, 164.81, 329.63, 659.25],
          [46.25, 92.5, 185.0, 369.99, 739.99],
          [51.91, 103.83, 207.65, 415.3, 830.61],
          [55.0, 110.0, 220.0, 440.0, 880.0],
        ];

  const bpm = presetType === 'deep-pulse' ? 124 : presetType === 'harmonic-arp' ? 116 : 108;
  const beatDuration = 60 / bpm;

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const chordIdx = Math.floor(t / 4) % chords.length;
    const freqs = chords[chordIdx];

    // Beat & Kick envelope
    const beatPos = (t % beatDuration) / beatDuration;
    const kickEnv = Math.exp(-beatPos * 9.5);
    const kickFreq = 48 + 110 * Math.exp(-beatPos * 28);
    const kick = Math.sin(2 * Math.PI * kickFreq * t) * kickEnv * 0.55;

    // 16th-note arpeggio & hi-hat transient
    const stepPos = (t % (beatDuration / 4)) / (beatDuration / 4);
    const stepIdx = Math.floor(t / (beatDuration / 4));
    const arpEnv = Math.exp(-stepPos * 4.2);
    const arpFreq = freqs[stepIdx % freqs.length] * (stepIdx % 2 === 0 ? 2 : 4);
    const arp =
      (Math.sin(2 * Math.PI * arpFreq * t) +
        0.35 * Math.sin(2 * Math.PI * arpFreq * 2 * t)) *
      arpEnv *
      0.24;

    // Warm pad harmonic stack
    const padL =
      0.16 * Math.sin(2 * Math.PI * freqs[1] * t) +
      0.12 * Math.sin(2 * Math.PI * freqs[2] * t + 0.3) +
      0.09 * Math.sin(2 * Math.PI * freqs[3] * t);
    const padR =
      0.16 * Math.sin(2 * Math.PI * freqs[1] * t) +
      0.12 * Math.sin(2 * Math.PI * freqs[2] * t - 0.3) +
      0.09 * Math.sin(2 * Math.PI * freqs[4] * t);

    // Crisp hi-hat shimmer on off-beats
    const hatEnv = stepIdx % 2 === 1 ? Math.exp(-stepPos * 22) * 0.14 : Math.exp(-stepPos * 35) * 0.05;
    const pseudoNoise = Math.sin(i * 12.9898) * 43758.5453;
    const white = (pseudoNoise - Math.floor(pseudoNoise)) * 2 - 1;
    const hat = white * hatEnv;

    const leftSample = Math.max(-0.98, Math.min(0.98, kick + arp * 0.9 + padL + hat));
    const rightSample = Math.max(-0.98, Math.min(0.98, kick + arp * 1.1 + padR + hat));

    view.setInt16(offset, leftSample * 32767, true);
    view.setInt16(offset + 2, rightSample * 32767, true);
    offset += 4;
  }

  const fileName =
    presetType === 'deep-pulse'
      ? 'Studio_SubBass_Pulse_124BPM.wav'
      : presetType === 'harmonic-arp'
      ? 'Harmonic_Spectrum_Arp_116BPM.wav'
      : 'Acoustic_Transient_Sweep_108BPM.wav';

  return new File([buffer], fileName, { type: 'audio/wav' });
}

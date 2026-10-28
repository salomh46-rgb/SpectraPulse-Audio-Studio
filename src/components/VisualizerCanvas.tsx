import React, { useEffect, useRef } from 'react';
import { COLOR_THEMES, VisualizerSettings } from '../types';
import { RealtimeBpmTracker } from '../utils/bpmDetector';

export interface HarmonicPartial {
  order: number; // 1 = f0, 2 = 2f0, 3 = 3f0, 4 = 4f0, 5 = 5f0
  label: string;
  intervalLabel: string;
  frequencyHz: number;
  noteName: string;
  magnitudePct: number; // 0 to 100
  dbFs: number; // -60 to 0
}

export interface AcousticTelemetry {
  rmsDb: number;
  peakFrequencyHz: number;
  subBassEnergy: number;
  midEnergy: number;
  highEnergy: number;
  fps: number;
  bpm: number;
  bpmConfidence: number;
  isBeat: boolean;
  fundamentalHz: number;
  fundamentalNote: string;
  overtoneRatioPct: number;
  harmonics: HarmonicPartial[];
}

interface VisualizerCanvasProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  settings: VisualizerSettings;
  darkTheme: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  detectedFileBpm: number | null;
  onTelemetryUpdate?: (telemetry: AcousticTelemetry) => void;
}

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  bandIndex: number;
  alpha: number;
}

interface NebulaParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radialDist: number;
  bandRatio: number; // 0.0 (sub-bass) to 1.0 (treble)
  baseSize: number;
  phase: number;
  orbitDir: number;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  analyser,
  isPlaying,
  settings,
  darkTheme,
  canvasRef,
  detectedFileBpm,
  onTelemetryUpdate,
}) => {
  const smoothedBarsRef = useRef<Float32Array>(new Float32Array(256));
  const peakBarsRef = useRef<Float32Array>(new Float32Array(256));
  const rotationAngleRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const nebulaParticlesRef = useRef<NebulaParticle[]>([]);
  const lastTelemetryTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimeRef = useRef<number>(performance.now());
  const currentFpsRef = useRef<number>(60);
  const bpmTrackerRef = useRef<RealtimeBpmTracker>(new RealtimeBpmTracker());

  useEffect(() => {
    bpmTrackerRef.current.setLockedFileBpm(detectedFileBpm);
  }, [detectedFileBpm]);

  // Initialize particle pools once
  useEffect(() => {
    const count = 110;
    const pool: Particle[] = [];
    for (let i = 0; i < count; i++) {
      pool.push({
        angle: (Math.PI * 2 * i) / count + (i % 7) * 0.13,
        radius: 60 + (i * 19) % 360,
        speed: 0.4 + (i % 5) * 0.28,
        size: 1.8 + (i % 4) * 1.1,
        bandIndex: i % 64,
        alpha: 0.35 + (i % 6) * 0.1,
      });
    }
    particlesRef.current = pool;

    const nebulaCount = 220;
    const nebulaPool: NebulaParticle[] = [];
    for (let i = 0; i < nebulaCount; i++) {
      const bandRatio = i / nebulaCount;
      const angle = (Math.PI * 2 * (i * 1.6180339)) % (Math.PI * 2);
      const radialDist = 0.06 + (i % 20) * 0.024;
      nebulaPool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angle,
        radialDist,
        bandRatio,
        baseSize: 1.6 + (1 - bandRatio) * 2.8,
        phase: (i * 0.47) % (Math.PI * 2),
        orbitDir: i % 2 === 0 ? 1 : -1,
      });
    }
    nebulaParticlesRef.current = nebulaPool;
  }, []);

  // Resize observer to keep crisp high-DPI canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      const targetW = Math.max(640, Math.floor(rect.width * dpr));
      const targetH = Math.max(360, Math.floor(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [canvasRef]);

  useEffect(() => {
    let animationFrameId: number;
    const freqData = new Uint8Array(1024);
    const timeData = new Uint8Array(1024);

    const render = (now: number) => {
      frameCountRef.current += 1;
      if (now - lastFpsTimeRef.current >= 500) {
        currentFpsRef.current = Math.min(
          60,
          Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current))
        );
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const theme = COLOR_THEMES[settings.colorTheme] || COLOR_THEMES['obsidian-gold'];

      // Update analyser smoothing if available
      if (analyser) {
        analyser.smoothingTimeConstant = Math.min(0.95, Math.max(0.1, settings.smoothing));
      }

      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
      } else {
        // Subtle idle studio reference wave when paused
        const t = now * 0.0015;
        for (let i = 0; i < 512; i++) {
          const idleVal =
            10 +
            8 * Math.sin(t * 1.7 + i * 0.06) +
            5 * Math.cos(t * 0.9 - i * 0.03);
          freqData[i] = Math.max(2, Math.floor(idleVal));
          timeData[i] = Math.floor(128 + 8 * Math.sin(t * 2.4 + i * 0.04));
        }
      }

      // Compute acoustic energy metrics
      const barCount = settings.barCount;
      const smoothed = smoothedBarsRef.current;
      const peaks = peakBarsRef.current;
      const sensitivity = settings.sensitivity;
      const bassMultiplier = 1 + settings.bassBoost * 0.045;

      let sumSquares = 0;
      let maxBinValue = 0;
      let maxBinIndex = 0;
      let subBassSum = 0;
      let midSum = 0;
      let highSum = 0;

      const usableBins = Math.min(freqData.length, 360);
      const eq = settings.eqBands || { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 };
      const eqGainsDb = [eq.low, eq.lowMid, eq.mid, eq.highMid, eq.high];

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.min(
          usableBins - 1,
          Math.floor(Math.pow(i / barCount, 1.35) * usableBins)
        );
        let raw = freqData[binIndex] / 255;

        // Apply low-frequency emphasis if bassBoost > 0
        if (i < barCount * 0.22) {
          raw *= bassMultiplier;
        }

        // Interpolate 5-band EQ curve across the spectrum (Low, Low-Mid, Mid, High-Mid, High)
        const bandPos = (i / Math.max(1, barCount - 1)) * 4;
        const idxLow = Math.min(3, Math.floor(bandPos));
        const frac = bandPos - idxLow;
        const interpDb =
          eqGainsDb[idxLow] * (1 - frac) + eqGainsDb[idxLow + 1] * frac;
        // Convert dB offset into a gentle visual envelope multiplier (reinforcing the BiquadFilterNode chain)
        const eqVisualGain = Math.pow(10, (interpDb * 0.35) / 20);
        raw *= eqVisualGain;

        const scaled = Math.min(1.0, Math.max(0, raw * sensitivity));
        const lerpFactor = 1 - settings.smoothing * 0.78;
        smoothed[i] = smoothed[i] + (scaled - smoothed[i]) * lerpFactor;

        if (smoothed[i] >= peaks[i]) {
          peaks[i] = smoothed[i];
        } else {
          peaks[i] = Math.max(0, peaks[i] - 0.0045);
        }

        sumSquares += smoothed[i] * smoothed[i];
        if (smoothed[i] > maxBinValue) {
          maxBinValue = smoothed[i];
          maxBinIndex = binIndex;
        }

        if (i < barCount * 0.2) subBassSum += smoothed[i];
        else if (i < barCount * 0.65) midSum += smoothed[i];
        else highSum += smoothed[i];
      }

      const rms = Math.sqrt(sumSquares / barCount);
      const rmsDb = rms > 0.0005 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
      const subBassNorm = subBassSum / Math.max(1, barCount * 0.2);
      const midNorm = midSum / Math.max(1, barCount * 0.45);
      const highNorm = highSum / Math.max(1, barCount * 0.35);

      const bpmEstimate = bpmTrackerRef.current.processFrame(freqData, now, isPlaying);

      if (onTelemetryUpdate && (now - lastTelemetryTimeRef.current > 110 || bpmEstimate.isBeat)) {
        lastTelemetryTimeRef.current = now;
        const sampleRate = analyser?.context?.sampleRate || 44100;
        const fftSize = analyser?.fftSize || 2048;
        const peakHz = Math.max(20, Math.round((maxBinIndex * sampleRate) / fftSize));
        const harmonicData = extractHarmonicSeries(
          freqData,
          sampleRate,
          fftSize,
          isPlaying,
          settings.sensitivity
        );

        onTelemetryUpdate({
          rmsDb,
          peakFrequencyHz: isPlaying ? peakHz : 0,
          subBassEnergy: Math.min(100, Math.round(subBassNorm * 100)),
          midEnergy: Math.min(100, Math.round(midNorm * 100)),
          highEnergy: Math.min(100, Math.round(highNorm * 100)),
          fps: currentFpsRef.current,
          bpm: bpmEstimate.bpm,
          bpmConfidence: bpmEstimate.confidence,
          isBeat: bpmEstimate.isBeat,
          fundamentalHz: harmonicData.fundamentalHz,
          fundamentalNote: harmonicData.fundamentalNote,
          overtoneRatioPct: harmonicData.overtoneRatioPct,
          harmonics: harmonicData.harmonics,
        });
      }

      // Clear background with subtle acoustic ambient gradient
      ctx.save();
      ctx.fillStyle = darkTheme ? theme.bgDark : theme.bgLight;
      ctx.fillRect(0, 0, width, height);

      // Subtle studio calibration grid lines
      ctx.strokeStyle = darkTheme
        ? 'rgba(148, 163, 184, 0.055)'
        : 'rgba(15, 23, 42, 0.055)';
      ctx.lineWidth = 1;
      const gridStep = Math.round(Math.min(width, height) / 8);
      for (let x = gridStep; x < width; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = gridStep; y < height; y += gridStep) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Ambient acoustic core glow proportional to sub-bass energy & glowIntensity
      if (settings.glowIntensity > 0) {
        const glowRadius =
          Math.min(width, height) * (0.28 + subBassNorm * 0.25 * (settings.glowIntensity / 100));
        const radialGrad = ctx.createRadialGradient(
          centerX,
          centerY,
          10,
          centerX,
          centerY,
          glowRadius
        );
        const alpha = Math.min(
          0.34,
          (0.06 + subBassNorm * 0.22) * (settings.glowIntensity / 60)
        );
        radialGrad.addColorStop(0, hexToRgba(theme.primary, alpha));
        radialGrad.addColorStop(0.55, hexToRgba(theme.secondary, alpha * 0.45));
        radialGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = radialGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Advance orbital rotation
      rotationAngleRef.current += 0.0025 * settings.rotationSpeed * (1 + subBassNorm * 0.65);

      // Configure bloom shadow
      if (settings.glowIntensity > 10) {
        ctx.shadowColor = theme.primary;
        ctx.shadowBlur = (settings.glowIntensity / 100) * 22;
      } else {
        ctx.shadowBlur = 0;
      }

      // Render active geometry mode
      if (settings.mode === 'bars') {
        renderSpectrumBars(
          ctx,
          width,
          height,
          barCount,
          smoothed,
          peaks,
          settings,
          theme,
          darkTheme
        );
      } else if (settings.mode === 'circular') {
        renderCircularSpectrum(
          ctx,
          centerX,
          centerY,
          Math.min(width, height),
          barCount,
          smoothed,
          peaks,
          rotationAngleRef.current,
          subBassNorm,
          settings,
          theme
        );
      } else if (settings.mode === 'radial-wave') {
        renderRadialWave(
          ctx,
          centerX,
          centerY,
          Math.min(width, height),
          timeData,
          smoothed,
          barCount,
          rotationAngleRef.current,
          subBassNorm,
          theme
        );
      } else if (settings.mode === 'dual-spectrum') {
        renderDualHorizon(
          ctx,
          width,
          height,
          barCount,
          smoothed,
          peaks,
          timeData,
          settings,
          theme
        );
      } else if (settings.mode === 'particles') {
        renderParticleField(
          ctx,
          centerX,
          centerY,
          width,
          height,
          particlesRef.current,
          smoothed,
          barCount,
          subBassNorm,
          highNorm,
          rotationAngleRef.current,
          settings,
          theme
        );
      } else if (settings.mode === 'spectrum-nebula') {
        renderSpectrumNebulaParticles(
          ctx,
          centerX,
          centerY,
          width,
          height,
          nebulaParticlesRef.current,
          smoothed,
          peaks,
          barCount,
          subBassNorm,
          midNorm,
          highNorm,
          bpmEstimate.isBeat,
          rotationAngleRef.current,
          settings,
          theme
        );
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [analyser, isPlaying, settings, darkTheme, canvasRef, onTelemetryUpdate]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block select-none"
      aria-label="Холст аудиовизуализации SpectraPulse"
    />
  );
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const HARMONIC_META: { order: number; label: string; intervalLabel: string }[] = [
  { order: 1, label: 'f₀ Основной', intervalLabel: 'Фундаментальный тон' },
  { order: 2, label: '2f₀ Обертон I', intervalLabel: 'Октава' },
  { order: 3, label: '3f₀ Обертон II', intervalLabel: 'Дуодецима (Квинта)' },
  { order: 4, label: '4f₀ Обертон III', intervalLabel: 'Двойная октава' },
  { order: 5, label: '5f₀ Обертон IV', intervalLabel: 'Большая терция' },
];

function frequencyToNoteName(freqHz: number): string {
  if (!Number.isFinite(freqHz) || freqHz < 20) return '—';
  const midi = Math.round(69 + 12 * Math.log2(freqHz / 440));
  if (midi < 12 || midi > 120) return '—';
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function extractHarmonicSeries(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  isPlaying: boolean,
  sensitivity: number
): {
  fundamentalHz: number;
  fundamentalNote: string;
  overtoneRatioPct: number;
  harmonics: HarmonicPartial[];
} {
  if (!isPlaying) {
    return {
      fundamentalHz: 0,
      fundamentalNote: '—',
      overtoneRatioPct: 0,
      harmonics: HARMONIC_META.map((m) => ({
        order: m.order,
        label: m.label,
        intervalLabel: m.intervalLabel,
        frequencyHz: 0,
        noteName: '—',
        magnitudePct: 0,
        dbFs: -60,
      })),
    };
  }

  const binHz = sampleRate / fftSize;
  const minBin = Math.max(2, Math.floor(42 / binHz));
  const maxCandidateBin = Math.min(Math.floor(freqData.length / 5), Math.ceil(900 / binHz));

  // Harmonic Product / Weighted Sum scoring to find the true fundamental f0
  let bestBin = minBin;
  let bestScore = -1;

  for (let b = minBin; b <= maxCandidateBin; b++) {
    const a1 = freqData[b] / 255;
    if (a1 < 0.05) continue;
    // Check local peak
    if (freqData[b] < freqData[b - 1] || freqData[b] < freqData[b + 1]) continue;

    const a2 = (freqData[b * 2] || 0) / 255;
    const a3 = (freqData[b * 3] || 0) / 255;
    const a4 = (freqData[b * 4] || 0) / 255;

    const score = a1 * (1 + 0.55 * a2 + 0.35 * a3 + 0.22 * a4);
    if (score > bestScore) {
      bestScore = score;
      bestBin = b;
    }
  }

  // Parabolic interpolation around bestBin for sub-bin frequency accuracy
  const alpha = freqData[bestBin - 1] || 0;
  const beta = freqData[bestBin] || 0;
  const gamma = freqData[bestBin + 1] || 0;
  const denom = alpha - 2 * beta + gamma;
  const delta = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (alpha - gamma)) / denom)) : 0;

  const exactFundamentalBin = bestBin + delta;
  const fundamentalHz =
    beta > 6 ? Number((exactFundamentalBin * binHz).toFixed(1)) : 0;
  const fundamentalNote =
    fundamentalHz > 0 ? frequencyToNoteName(fundamentalHz) : '—';

  let totalEnergy = 0;
  let overtoneEnergy = 0;

  const harmonics: HarmonicPartial[] = HARMONIC_META.map((meta) => {
    if (fundamentalHz <= 0) {
      return {
        order: meta.order,
        label: meta.label,
        intervalLabel: meta.intervalLabel,
        frequencyHz: 0,
        noteName: '—',
        magnitudePct: 0,
        dbFs: -60,
      };
    }

    const targetHz = Number((fundamentalHz * meta.order).toFixed(1));
    const centerBin = Math.round(exactFundamentalBin * meta.order);
    let peakByte = 0;
    for (let offset = -1; offset <= 1; offset++) {
      const idx = centerBin + offset;
      if (idx >= 0 && idx < freqData.length) {
        if (freqData[idx] > peakByte) {
          peakByte = freqData[idx];
        }
      }
    }

    const norm = Math.min(1, (peakByte / 255) * Math.min(1.8, sensitivity * 0.85));
    const magnitudePct = Math.round(norm * 100);
    const dbFs =
      norm > 0.001 ? Number(Math.max(-60, 20 * Math.log10(norm)).toFixed(1)) : -60;

    totalEnergy += norm;
    if (meta.order > 1) {
      overtoneEnergy += norm;
    }

    return {
      order: meta.order,
      label: meta.label,
      intervalLabel: meta.intervalLabel,
      frequencyHz: targetHz,
      noteName: frequencyToNoteName(targetHz),
      magnitudePct,
      dbFs,
    };
  });

  const overtoneRatioPct =
    totalEnergy > 0.01 ? Math.round((overtoneEnergy / totalEnergy) * 100) : 0;

  return {
    fundamentalHz,
    fundamentalNote,
    overtoneRatioPct,
    harmonics,
  };
}

function renderSpectrumBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  barCount: number,
  smoothed: Float32Array,
  peaks: Float32Array,
  settings: VisualizerSettings,
  theme: { primary: string; secondary: string; tertiary: string; peak: string },
  darkTheme: boolean
) {
  const padX = width * 0.05;
  const usableW = width - padX * 2;
  const maxBarH = height * 0.72;
  const baseLineY = height * 0.86;

  const grad = ctx.createLinearGradient(0, baseLineY - maxBarH, 0, baseLineY);
  grad.addColorStop(0, theme.tertiary);
  grad.addColorStop(0.45, theme.primary);
  grad.addColorStop(1, theme.secondary);

  const totalSlots = settings.mirrorMode ? barCount * 2 : barCount;
  const slotWidth = usableW / totalSlots;
  const barWidth = Math.max(2, slotWidth * 0.72);

  for (let i = 0; i < totalSlots; i++) {
    const dataIdx = settings.mirrorMode
      ? i < barCount
        ? barCount - 1 - i
        : i - barCount
      : i;

    const val = smoothed[dataIdx] || 0;
    const peakVal = peaks[dataIdx] || 0;
    const barH = Math.max(4, val * maxBarH);
    const x = padX + i * slotWidth + (slotWidth - barWidth) / 2;
    const y = baseLineY - barH;

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barH, [3, 3, 0, 0]);
    ctx.fill();

    // Subtle reflection below baseline
    ctx.fillStyle = hexToRgba(theme.primary, darkTheme ? 0.14 : 0.08);
    ctx.fillRect(x, baseLineY + 2, barWidth, barH * 0.18);

    if (settings.showPeaks) {
      const peakY = baseLineY - Math.max(6, peakVal * maxBarH) - 4;
      ctx.fillStyle = theme.peak;
      ctx.fillRect(x, peakY, barWidth, 2.5);
    }
  }

  // Baseline axis rule
  ctx.strokeStyle = hexToRgba(theme.primary, 0.35);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, baseLineY);
  ctx.lineTo(width - padX, baseLineY);
  ctx.stroke();
}

function renderCircularSpectrum(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  minDim: number,
  barCount: number,
  smoothed: Float32Array,
  peaks: Float32Array,
  rotationAngle: number,
  subBassNorm: number,
  settings: VisualizerSettings,
  theme: { primary: string; secondary: string; tertiary: string; peak: string }
) {
  const baseRadius = minDim * (0.17 + subBassNorm * 0.035);
  const maxRayLength = minDim * 0.25;

  // Inner harmonic ring
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotationAngle);

  ctx.strokeStyle = hexToRgba(theme.primary, 0.45);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, baseRadius * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  const totalRays = barCount;
  for (let i = 0; i < totalRays; i++) {
    const idx = settings.mirrorMode
      ? i < totalRays / 2
        ? i * 2
        : (totalRays - 1 - i) * 2
      : i;
    const val = smoothed[idx % barCount] || 0;
    const peakVal = peaks[idx % barCount] || 0;

    const angle = (i / totalRays) * Math.PI * 2;
    const rayLen = Math.max(6, val * maxRayLength);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const x1 = cos * baseRadius;
    const y1 = sin * baseRadius;
    const x2 = cos * (baseRadius + rayLen);
    const y2 = sin * (baseRadius + rayLen);

    ctx.strokeStyle = i % 2 === 0 ? theme.primary : theme.tertiary;
    ctx.lineWidth = Math.max(2, (minDim / totalRays) * 0.85);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Inner inward pulse
    const innerLen = val * baseRadius * 0.35;
    ctx.strokeStyle = hexToRgba(theme.secondary, 0.55);
    ctx.beginPath();
    ctx.moveTo(cos * (baseRadius * 0.88), sin * (baseRadius * 0.88));
    ctx.lineTo(cos * (baseRadius * 0.88 - innerLen), sin * (baseRadius * 0.88 - innerLen));
    ctx.stroke();

    if (settings.showPeaks) {
      const px = cos * (baseRadius + Math.max(8, peakVal * maxRayLength) + 6);
      const py = sin * (baseRadius + Math.max(8, peakVal * maxRayLength) + 6);
      ctx.fillStyle = theme.peak;
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function renderRadialWave(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  minDim: number,
  timeData: Uint8Array,
  smoothed: Float32Array,
  barCount: number,
  rotationAngle: number,
  subBassNorm: number,
  theme: { primary: string; secondary: string; tertiary: string; peak: string }
) {
  const rings = 3;
  const points = 180;

  for (let r = 0; r < rings; r++) {
    const baseR = minDim * (0.14 + r * 0.085) + subBassNorm * 18;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const pct = (i % points) / points;
      const angle = pct * Math.PI * 2 + rotationAngle * (r % 2 === 0 ? 1 : -0.7);
      const timeSample = (timeData[Math.floor(pct * 512)] - 128) / 128;
      const freqSample = smoothed[Math.floor(pct * (barCount - 1))] || 0;

      const offset =
        timeSample * minDim * (0.06 + r * 0.025) + freqSample * minDim * 0.08;
      const rad = baseR + offset;
      const x = centerX + Math.cos(angle) * rad;
      const y = centerY + Math.sin(angle) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = r === 0 ? theme.tertiary : r === 1 ? theme.primary : theme.secondary;
    ctx.lineWidth = r === 1 ? 3 : 2;
    ctx.stroke();
    ctx.fillStyle = hexToRgba(theme.primary, 0.035);
    ctx.fill();
  }
}

function renderDualHorizon(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  barCount: number,
  smoothed: Float32Array,
  peaks: Float32Array,
  timeData: Uint8Array,
  settings: VisualizerSettings,
  theme: { primary: string; secondary: string; tertiary: string; peak: string }
) {
  const padX = width * 0.05;
  const usableW = width - padX * 2;
  const midY = height / 2;
  const maxHalfH = height * 0.38;

  const totalSlots = settings.mirrorMode ? barCount * 2 : barCount;
  const slotWidth = usableW / totalSlots;
  const barWidth = Math.max(2, slotWidth * 0.68);

  for (let i = 0; i < totalSlots; i++) {
    const dataIdx = settings.mirrorMode
      ? i < barCount
        ? barCount - 1 - i
        : i - barCount
      : i;
    const val = smoothed[dataIdx] || 0;
    const peakVal = peaks[dataIdx] || 0;
    const halfH = Math.max(3, val * maxHalfH);
    const x = padX + i * slotWidth + (slotWidth - barWidth) / 2;

    ctx.fillStyle = theme.primary;
    ctx.fillRect(x, midY - halfH, barWidth, halfH);

    ctx.fillStyle = hexToRgba(theme.secondary, 0.72);
    ctx.fillRect(x, midY, barWidth, halfH * 0.85);

    if (settings.showPeaks) {
      const peakOffset = Math.max(5, peakVal * maxHalfH) + 4;
      ctx.fillStyle = theme.peak;
      ctx.fillRect(x, midY - peakOffset, barWidth, 2);
      ctx.fillRect(x, midY + peakOffset * 0.85, barWidth, 2);
    }
  }

  // Center time-domain oscilloscope ribbon
  ctx.beginPath();
  const sliceW = usableW / 256;
  for (let i = 0; i < 256; i++) {
    const v = (timeData[i * 2] - 128) / 128;
    const x = padX + i * sliceW;
    const y = midY + v * (height * 0.14);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = theme.tertiary;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderParticleField(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  particles: Particle[],
  smoothed: Float32Array,
  barCount: number,
  subBassNorm: number,
  highNorm: number,
  rotationAngle: number,
  settings: VisualizerSettings,
  theme: { primary: string; secondary: string; tertiary: string; peak: string }
) {
  const maxRadius = Math.hypot(width, height) * 0.48;

  // Draw central harmonic polygon
  const sides = 6;
  const coreR = Math.min(width, height) * (0.08 + subBassNorm * 0.08);
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotationAngle * 1.4);
  ctx.beginPath();
  for (let s = 0; s <= sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    const r = coreR + (smoothed[(s * 8) % barCount] || 0) * 28;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (s === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = hexToRgba(theme.secondary, 0.18);
  ctx.fill();
  ctx.restore();

  // Update and draw particles
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const bandEnergy = smoothed[p.bandIndex % barCount] || 0;
    p.radius += p.speed * (0.6 + subBassNorm * 3.8 + bandEnergy * 2.2);
    p.angle += 0.002 * settings.rotationSpeed * (i % 2 === 0 ? 1 : -1);

    if (p.radius > maxRadius) {
      p.radius = coreR * 0.7;
    }

    const x = centerX + Math.cos(p.angle) * p.radius;
    const y = centerY + Math.sin(p.angle) * p.radius;
    const dynamicSize = p.size * (1 + bandEnergy * 2.4 + highNorm * 1.2);

    ctx.fillStyle =
      i % 3 === 0 ? theme.tertiary : i % 3 === 1 ? theme.primary : theme.secondary;
    ctx.beginPath();
    ctx.arc(x, y, dynamicSize, 0, Math.PI * 2);
    ctx.fill();

    // Connect nearby harmonic nodes when energy is high
    if (bandEnergy > 0.42 && i > 0) {
      const prev = particles[i - 1];
      const px = centerX + Math.cos(prev.angle) * prev.radius;
      const py = centerY + Math.sin(prev.angle) * prev.radius;
      const dist = Math.hypot(x - px, y - py);
      if (dist < 130) {
        ctx.strokeStyle = hexToRgba(theme.tertiary, (1 - dist / 130) * 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
  }
}

function interpolateHexColor(hexA: string, hexB: string, t: number, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const numA = parseInt(hexA.replace('#', ''), 16);
  const numB = parseInt(hexB.replace('#', ''), 16);
  const rA = (numA >> 16) & 255;
  const gA = (numA >> 8) & 255;
  const bA = numA & 255;
  const rB = (numB >> 16) & 255;
  const gB = (numB >> 8) & 255;
  const bB = numB & 255;

  const r = Math.round(rA + (rB - rA) * clamped);
  const g = Math.round(gA + (gB - gA) * clamped);
  const b = Math.round(bA + (bB - bA) * clamped);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function renderSpectrumNebulaParticles(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  particles: NebulaParticle[],
  smoothed: Float32Array,
  peaks: Float32Array,
  barCount: number,
  subBassNorm: number,
  midNorm: number,
  highNorm: number,
  isBeat: boolean,
  rotationAngle: number,
  settings: VisualizerSettings,
  theme: { primary: string; secondary: string; tertiary: string; peak: string }
) {
  const minDim = Math.min(width, height);
  const maxSpan = Math.hypot(width, height) * 0.52;

  // Draw spectrum energy Shockwave Ring at center
  const coreRadius = minDim * (0.055 + subBassNorm * 0.09 + (isBeat ? 0.025 : 0));
  const coreGrad = ctx.createRadialGradient(
    centerX,
    centerY,
    coreRadius * 0.1,
    centerX,
    centerY,
    coreRadius * 2.4
  );
  coreGrad.addColorStop(0, hexToRgba(theme.peak, 0.35 + subBassNorm * 0.45));
  coreGrad.addColorStop(0.45, hexToRgba(theme.primary, 0.22 + midNorm * 0.3));
  coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, coreRadius * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Active particle count scales with barCount setting (up to pool length)
  const activeCount = Math.min(
    particles.length,
    Math.max(80, Math.floor((barCount / 256) * particles.length))
  );

  for (let i = 0; i < activeCount; i++) {
    const p = particles[i];
    const binIdx = Math.min(barCount - 1, Math.floor(p.bandRatio * barCount));
    const bandEnergy = smoothed[binIdx] || 0;
    const peakEnergy = peaks[binIdx] || 0;

    // 1. Dynamic Motion generated from FFT Spectrum Analyzer:
    // - Sub-bass & beat transients drive radial outward acceleration
    // - Mid frequencies drive tangential vortex swirl velocity
    // - High frequencies drive harmonic turbulence oscillation
    const radialSpeed =
      0.0014 +
      subBassNorm * 0.0065 +
      bandEnergy * 0.0085 +
      (isBeat && p.bandRatio < 0.35 ? 0.009 : 0);

    p.radialDist += radialSpeed * settings.sensitivity * 0.65;
    if (p.radialDist > 1.0) {
      p.radialDist = 0.04 + (p.bandRatio * 0.08);
    }

    const vortexAngularVel =
      (0.002 + midNorm * 0.012 + bandEnergy * 0.015) *
      (0.4 + settings.rotationSpeed * 0.35) *
      (settings.mirrorMode ? p.orbitDir : 1);

    p.angle += vortexAngularVel;
    p.phase += 0.06 + highNorm * 0.18;

    const turbulenceOffset =
      Math.sin(p.phase) * minDim * 0.022 * (0.2 + highNorm * 1.4 + bandEnergy);

    const currentRadius = p.radialDist * maxSpan + turbulenceOffset;
    const drawAngle = p.angle + rotationAngle * 0.3;

    const prevX = p.x || centerX + Math.cos(drawAngle) * currentRadius;
    const prevY = p.y || centerY + Math.sin(drawAngle) * currentRadius;

    const nextX = centerX + Math.cos(drawAngle) * currentRadius;
    const nextY = centerY + Math.sin(drawAngle) * currentRadius;

    p.vx = nextX - prevX;
    p.vy = nextY - prevY;
    p.x = nextX;
    p.y = nextY;

    // 2. Dynamic Intensity & Size generated from Spectrum Data:
    const intensityAlpha = Math.min(
      0.98,
      0.22 + bandEnergy * 0.78 + subBassNorm * 0.18
    );
    const radiusPx =
      p.baseSize * (0.75 + bandEnergy * 2.9 + (isBeat && p.bandRatio < 0.25 ? 1.3 : 0));

    // 3. Dynamic Color generated from Spectrum Frequency Band & Instantaneous Energy:
    let particleColor: string;
    if (p.bandRatio < 0.33) {
      // Bass band: secondary -> primary boosted by bandEnergy
      particleColor = interpolateHexColor(
        theme.secondary,
        theme.primary,
        Math.min(1, p.bandRatio * 2.2 + bandEnergy * 0.5),
        intensityAlpha
      );
    } else if (p.bandRatio < 0.72) {
      // Mid-harmonic band: primary -> tertiary
      particleColor = interpolateHexColor(
        theme.primary,
        theme.tertiary,
        Math.min(1, (p.bandRatio - 0.33) * 2.0 + bandEnergy * 0.4),
        intensityAlpha
      );
    } else {
      // High-treble band: tertiary -> white-hot peak color
      particleColor = interpolateHexColor(
        theme.tertiary,
        theme.peak,
        Math.min(1, (p.bandRatio - 0.72) * 2.5 + bandEnergy * 0.65),
        intensityAlpha
      );
    }

    // Draw velocity vector trail proportional to spectrum energy
    const speedMag = Math.hypot(p.vx, p.vy);
    if (speedMag < 80 && bandEnergy > 0.12) {
      const trailScale = 1.8 + bandEnergy * 4.2;
      ctx.strokeStyle = particleColor;
      ctx.lineWidth = Math.max(1, radiusPx * 0.65);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(nextX, nextY);
      ctx.lineTo(nextX - p.vx * trailScale, nextY - p.vy * trailScale);
      ctx.stroke();
    }

    // Draw particle core
    ctx.fillStyle = particleColor;
    ctx.beginPath();
    ctx.arc(nextX, nextY, radiusPx, 0, Math.PI * 2);
    ctx.fill();

    // Draw Peak Hold Halo if showPeaks is enabled and bin is near peak
    if (settings.showPeaks && peakEnergy > 0.55 && bandEnergy >= peakEnergy * 0.88) {
      ctx.strokeStyle = hexToRgba(theme.peak, 0.55);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(nextX, nextY, radiusPx * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

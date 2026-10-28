/**
 * Automatic BPM Detection Engine for SpectraPulse Audio Studio
 * Combines:
 * 1. High-accuracy Offline AudioBuffer Onset Interval Clustering (for MP3/WAV/FLAC files)
 * 2. Real-time Spectral Flux Onset Tracker (for Live Microphone & real-time audio streams)
 */

export interface BpmEstimate {
  bpm: number;
  confidence: number; // 0 to 100
  isBeat: boolean;
}

/**
 * Analyzes an audio File or Blob by decoding PCM data, filtering low-end transients (45-160 Hz),
 * extracting energy onset peaks, and clustering Inter-Onset Intervals (IOI) into the 60-180 BPM range.
 */
export async function detectBpmFromAudioFile(file: File | Blob): Promise<number | null> {
  let tempCtx: AudioContext | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    tempCtx = new AudioContextClass();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));

    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);

    // Analyze up to 30 seconds from the active body of the track
    const maxSamples = Math.min(channelData.length, sampleRate * 30);
    const startOffset =
      channelData.length > sampleRate * 36 ? Math.floor(sampleRate * 4) : 0;

    // Downsample / compute RMS energy in 10ms hop windows (~100 Hz envelope rate)
    const windowSize = Math.max(128, Math.floor(sampleRate * 0.01));
    const numWindows = Math.floor((maxSamples - startOffset) / windowSize);
    if (numWindows < 100) return null;

    const energies = new Float32Array(numWindows);
    // Simple 1-pole low-pass filter state to isolate kick/bass transients (~130 Hz cutoff)
    const rc = 1.0 / (2 * Math.PI * 130);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (rc + dt);
    let lpState = 0;

    for (let w = 0; w < numWindows; w++) {
      let sumSq = 0;
      const baseIdx = startOffset + w * windowSize;
      for (let i = 0; i < windowSize; i++) {
        const sample = channelData[baseIdx + i];
        lpState = lpState + alpha * (sample - lpState);
        sumSq += lpState * lpState;
      }
      energies[w] = Math.sqrt(sumSq / windowSize);
    }

    // Compute positive first-order difference (onset strength envelope)
    const onsetEnv = new Float32Array(numWindows);
    for (let w = 1; w < numWindows; w++) {
      const diff = energies[w] - energies[w - 1];
      onsetEnv[w] = diff > 0 ? diff : 0;
    }

    // Detect local peaks exceeding adaptive moving average threshold
    const peakIndices: number[] = [];
    const localRadius = 40; // ~0.4s local threshold neighborhood
    const minPeakDistance = 24; // minimum 240ms between beats (max ~250 BPM)

    let lastPeak = -minPeakDistance;
    for (let w = 2; w < numWindows - 2; w++) {
      if (w - lastPeak < minPeakDistance) continue;

      const val = onsetEnv[w];
      if (val <= 0) continue;

      // Check local maximum
      if (
        val >= onsetEnv[w - 1] &&
        val >= onsetEnv[w + 1] &&
        val >= onsetEnv[w - 2] &&
        val >= onsetEnv[w + 2]
      ) {
        let localSum = 0;
        let count = 0;
        const from = Math.max(0, w - localRadius);
        const to = Math.min(numWindows - 1, w + localRadius);
        for (let k = from; k <= to; k++) {
          localSum += onsetEnv[k];
          count++;
        }
        const localMean = localSum / Math.max(1, count);
        if (val > localMean * 1.45 && val > 0.002) {
          peakIndices.push(w);
          lastPeak = w;
        }
      }
    }

    if (peakIndices.length < 6) return null;

    // Build BPM histogram from Inter-Onset Intervals (IOIs) across neighboring peaks
    const bpmBuckets = new Float32Array(240); // index = integer BPM
    const envelopeRate = sampleRate / windowSize;

    for (let i = 0; i < peakIndices.length; i++) {
      for (let step = 1; step <= 6 && i + step < peakIndices.length; step++) {
        const deltaFrames = peakIndices[i + step] - peakIndices[i];
        const deltaSeconds = deltaFrames / envelopeRate;
        if (deltaSeconds <= 0.22 || deltaSeconds > 4.0) continue;

        let candidateBpm = 60.0 / deltaSeconds;
        // Fold octave multiples into standard 75..165 BPM studio window
        while (candidateBpm < 75) candidateBpm *= 2;
        while (candidateBpm > 165) candidateBpm /= 2;

        const rounded = Math.round(candidateBpm);
        if (rounded >= 65 && rounded <= 185) {
          const weight = step === 1 ? 2.5 : step === 2 ? 1.5 : 0.8;
          bpmBuckets[rounded] += weight;
          // Smooth into adjacent integer bins
          bpmBuckets[rounded - 1] += weight * 0.55;
          bpmBuckets[rounded + 1] += weight * 0.55;
        }
      }
    }

    let bestBpm = 0;
    let maxScore = 0;
    for (let b = 70; b <= 180; b++) {
      if (bpmBuckets[b] > maxScore) {
        maxScore = bpmBuckets[b];
        bestBpm = b;
      }
    }

    return bestBpm > 0 ? bestBpm : null;
  } catch {
    return null;
  } finally {
    if (tempCtx && tempCtx.state !== 'closed') {
      tempCtx.close().catch(() => {});
    }
  }
}

/**
 * Real-Time Spectral Flux BPM Tracker for live microphone and continuous audio playback.
 */
export class RealtimeBpmTracker {
  private energyHistory: number[] = [];
  private prevLowEnergy = 0;
  private onsetTimes: number[] = [];
  private lastOnsetTime = 0;
  private currentBpm = 0;
  private confidence = 0;
  private lockedFileBpm: number | null = null;

  public setLockedFileBpm(bpm: number | null) {
    this.lockedFileBpm = bpm;
    if (bpm) {
      this.currentBpm = bpm;
      this.confidence = 94;
    }
  }

  public reset() {
    this.energyHistory = [];
    this.prevLowEnergy = 0;
    this.onsetTimes = [];
    this.lastOnsetTime = 0;
    if (!this.lockedFileBpm) {
      this.currentBpm = 0;
      this.confidence = 0;
    }
  }

  public processFrame(freqData: Uint8Array, nowMs: number, isPlaying: boolean): BpmEstimate {
    if (!isPlaying) {
      return {
        bpm: this.lockedFileBpm || this.currentBpm,
        confidence: this.lockedFileBpm ? 95 : this.confidence,
        isBeat: false,
      };
    }

    // Calculate sub-bass and punch kick energy (bins 1..14)
    let lowSum = 0;
    const binLimit = Math.min(14, freqData.length);
    for (let i = 1; i < binLimit; i++) {
      const normalized = freqData[i] / 255;
      lowSum += normalized * normalized;
    }
    const lowEnergy = Math.sqrt(lowSum / Math.max(1, binLimit - 1));

    // Positive spectral flux in low frequencies
    const flux = Math.max(0, lowEnergy - this.prevLowEnergy);
    this.prevLowEnergy = lowEnergy * 0.7 + this.prevLowEnergy * 0.3;

    this.energyHistory.push(flux);
    if (this.energyHistory.length > 48) {
      this.energyHistory.shift();
    }

    const avgFlux =
      this.energyHistory.reduce((acc, v) => acc + v, 0) /
      Math.max(1, this.energyHistory.length);

    let isBeat = false;
    const minBeatIntervalMs = 250; // max 240 BPM

    if (
      flux > Math.max(0.035, avgFlux * 1.65) &&
      nowMs - this.lastOnsetTime > minBeatIntervalMs
    ) {
      isBeat = true;
      this.lastOnsetTime = nowMs;
      this.onsetTimes.push(nowMs);

      // Keep onsets from the last 12 seconds
      const cutoff = nowMs - 12000;
      while (this.onsetTimes.length > 0 && this.onsetTimes[0] < cutoff) {
        this.onsetTimes.shift();
      }

      if (this.onsetTimes.length >= 4) {
        this.estimateBpmFromOnsets();
      }
    }

    // If we have an offline file BPM analyzed, refine around it or report it directly
    if (this.lockedFileBpm) {
      return {
        bpm: this.lockedFileBpm,
        confidence: 96,
        isBeat,
      };
    }

    return {
      bpm: this.currentBpm,
      confidence: this.confidence,
      isBeat,
    };
  }

  private estimateBpmFromOnsets() {
    const intervals: number[] = [];
    for (let i = 1; i < this.onsetTimes.length; i++) {
      const dt = this.onsetTimes[i] - this.onsetTimes[i - 1];
      if (dt >= 260 && dt <= 1500) {
        intervals.push(dt);
      }
    }
    if (intervals.length < 3) return;

    // Convert intervals to folded BPM candidates (75..165 BPM)
    const candidates: number[] = intervals.map((dt) => {
      let bpm = 60000 / dt;
      while (bpm < 75) bpm *= 2;
      while (bpm > 165) bpm /= 2;
      return bpm;
    });

    // Cluster around median
    candidates.sort((a, b) => a - b);
    const median = candidates[Math.floor(candidates.length / 2)];
    const closeMatches = candidates.filter((c) => Math.abs(c - median) <= 6);

    if (closeMatches.length >= 2) {
      const avgCluster =
        closeMatches.reduce((acc, v) => acc + v, 0) / closeMatches.length;
      const rounded = Math.round(avgCluster);

      if (this.currentBpm === 0) {
        this.currentBpm = rounded;
      } else {
        this.currentBpm = Math.round(this.currentBpm * 0.7 + rounded * 0.3);
      }

      this.confidence = Math.min(
        95,
        Math.round((closeMatches.length / candidates.length) * 100)
      );
    }
  }
}

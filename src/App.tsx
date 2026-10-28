import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  Mic,
  MicOff,
  Upload,
  Video,
  Square,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Repeat,
  Sun,
  Moon,
  Plus,
  Trash2,
  Download,
  FileJson,
  FileText,
  Eye,
  EyeOff,
  Sliders,
  Sparkles,
  Music,
  Cloud,
  Check,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  signInWithGoogle,
  logOutFirebase,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  COLOR_THEMES,
  ColorThemeId,
  DEFAULT_EQ_BANDS,
  EQ_BAND_DEFINITIONS,
  EqBands,
  FACTORY_PRESETS,
  ProjectDraft,
  TrackFormat,
  VISUALIZATION_MODES,
  VisualizerPreset,
  VisualizerSettings,
  WorkspaceLayoutConfig,
  clampNumber,
  sanitizeFirestoreSettings,
  sanitizeId,
  sanitizeSettings,
} from './types';
import { VisualizerCanvas, AcousticTelemetry } from './components/VisualizerCanvas';
import {
  createSynthesizedStudioWavFile,
  exportProjectToJson,
  exportProjectToPdf,
  parseImportedProjectJson,
} from './utils/exportUtils';
import { detectBpmFromAudioFile } from './utils/bpmDetector';
import { DraftsModal, HotkeysModal, WorkspaceModal } from './components/Modals';

const LOCAL_PRESETS_KEY = 'spectrapulse_user_presets_v1';
const LOCAL_AUTOSAVE_KEY = 'spectrapulse_autosave_draft_v1';
const LOCAL_LAYOUT_KEY = 'spectrapulse_workspace_layout_v1';

const DEFAULT_LAYOUT: WorkspaceLayoutConfig = {
  showLeftPanel: true,
  showRightPanel: true,
  showTimeline: true,
  showMeters: true,
  autoHideControls: false,
  darkTheme: true,
  swapSidebars: false,
};

const DEFAULT_SETTINGS: VisualizerSettings = {
  mode: 'bars',
  colorTheme: 'obsidian-gold',
  sensitivity: 1.35,
  smoothing: 0.78,
  barCount: 96,
  mirrorMode: false,
  showPeaks: true,
  glowIntensity: 35,
  rotationSpeed: 1.5,
  bassBoost: 4,
  eqBands: { ...DEFAULT_EQ_BANDS },
};

export default function App() {
  // Project metadata state
  const [projectName, setProjectName] = useState<string>('Ночной мастеринг-сеанс 01');
  const [projectNotes, setProjectNotes] = useState<string>(
    'Калибровка суббаса 40–90 Гц и пикового анализатора спектра'
  );
  const [trackName, setTrackName] = useState<string>('Studio_SubBass_Pulse_124BPM.wav');
  const [trackFormat, setTrackFormat] = useState<TrackFormat>('WAV');

  // Visualizer parameters
  const [settings, setSettings] = useState<VisualizerSettings>(DEFAULT_SETTINGS);

  // Workspace layout & customization
  const [layout, setLayout] = useState<WorkspaceLayoutConfig>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_LAYOUT_KEY);
      if (saved) {
        return { ...DEFAULT_LAYOUT, ...JSON.parse(saved) };
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_LAYOUT;
  });

  // Audio playback & source states
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.85);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [activeSynthPreset, setActiveSynthPreset] = useState<
    'deep-pulse' | 'harmonic-arp' | 'sub-sweep'
  >('deep-pulse');
  const [detectedFileBpm, setDetectedFileBpm] = useState<number | null>(124);
  const [isAnalyzingBpm, setIsAnalyzingBpm] = useState<boolean>(false);

  // Video export (MediaRecorder) state
  const [isRecordingVideo, setIsRecordingVideo] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [lastRecordedVideoUrl, setLastRecordedVideoUrl] = useState<string | null>(null);
  const [lastRecordedVideoExt, setLastRecordedVideoExt] = useState<string>('webm');

  // Fullscreen & unobtrusive idle states
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isIdleHidden, setIsIdleHidden] = useState<boolean>(false);
  const [zenCanvasOnly, setZenCanvasOnly] = useState<boolean>(false);

  // Presets & Drafts state
  const [userPresets, setUserPresets] = useState<VisualizerPreset[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [localDraft, setLocalDraft] = useState<ProjectDraft | null>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_AUTOSAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [cloudDrafts, setCloudDrafts] = useState<ProjectDraft[]>([]);
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<string>('');
  const [isSavingCloud, setIsSavingCloud] = useState<boolean>(false);

  // Auth & Notification Banner state
  const [user, setUser] = useState<User | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'info' | 'success' | 'error';
  } | null>(null);

  // Modals
  const [isHotkeysOpen, setIsHotkeysOpen] = useState<boolean>(false);
  const [isDraftsOpen, setIsDraftsOpen] = useState<boolean>(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState<boolean>(false);

  // Telemetry state
  const [telemetry, setTelemetry] = useState<AcousticTelemetry>({
    rmsDb: -60,
    peakFrequencyHz: 0,
    subBassEnergy: 0,
    midEnergy: 0,
    highEnergy: 0,
    fps: 60,
    bpm: 124,
    bpmConfidence: 96,
    isBeat: false,
    fundamentalHz: 0,
    fundamentalNote: '—',
    overtoneRatioPct: 0,
    harmonics: [
      { order: 1, label: 'f₀ Основной', intervalLabel: 'Фундаментальный тон', frequencyHz: 0, noteName: '—', magnitudePct: 0, dbFs: -60 },
      { order: 2, label: '2f₀ Обертон I', intervalLabel: 'Октава', frequencyHz: 0, noteName: '—', magnitudePct: 0, dbFs: -60 },
      { order: 3, label: '3f₀ Обертон II', intervalLabel: 'Дуодецима (Квинта)', frequencyHz: 0, noteName: '—', magnitudePct: 0, dbFs: -60 },
      { order: 4, label: '4f₀ Обертон III', intervalLabel: 'Двойная октава', frequencyHz: 0, noteName: '—', magnitudePct: 0, dbFs: -60 },
      { order: 5, label: '5f₀ Обертон IV', intervalLabel: 'Большая терция', frequencyHz: 0, noteName: '—', magnitudePct: 0, dbFs: -60 },
    ],
  });

  // Web Audio & DOM Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaElementSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonImportInputRef = useRef<HTMLInputElement | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (text: string, type: 'info' | 'success' | 'error' = 'info') => {
      setStatusMessage({ text, type });
      window.setTimeout(() => {
        setStatusMessage((prev) => (prev?.text === text ? null : prev));
      }, 3800);
    },
    []
  );

  // Initialize HTML5 Audio Element and load initial synthesized WAV reference track
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.loop = true;
    audio.volume = volume;
    audioElRef.current = audio;

    // Load initial synthesized studio WAV so the user can hit Play immediately
    const initialWav = createSynthesizedStudioWavFile('deep-pulse');
    const url = URL.createObjectURL(initialWav);
    audio.src = url;
    detectBpmFromAudioFile(initialWav).then((bpm) => {
      if (bpm) setDetectedFileBpm(bpm);
    });

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 16);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onEnded = () => {
      if (!audio.loop) {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      URL.revokeObjectURL(url);
    };
  }, []);

  // Ensure Web Audio Graph is initialized on user gesture
  const ensureAudioGraph = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = settings.smoothing;

      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 110;
      bassFilter.gain.value = settings.bassBoost;

      // Create 5-Band Graphic Equalizer filter chain (Low, Low-Mid, Mid, High-Mid, High)
      const activeEq = settings.eqBands || DEFAULT_EQ_BANDS;
      const eqNodes = EQ_BAND_DEFINITIONS.map((bandDef) => {
        const filter = ctx.createBiquadFilter();
        filter.type = bandDef.type;
        filter.frequency.value = bandDef.frequency;
        if (bandDef.type === 'peaking') {
          filter.Q.value = 1.1;
        }
        filter.gain.value = activeEq[bandDef.key] ?? 0;
        return filter;
      });

      const gainNode = ctx.createGain();
      gainNode.gain.value = isMuted || isMicActive ? 0 : volume;

      const streamDest = ctx.createMediaStreamDestination();

      // Connect pre-analyser chain: bassFilter -> EQ[0..4] -> analyser -> gainNode
      let prevNode: AudioNode = bassFilter;
      for (const eqFilter of eqNodes) {
        prevNode.connect(eqFilter);
        prevNode = eqFilter;
      }
      prevNode.connect(analyser);

      analyser.connect(gainNode);
      gainNode.connect(ctx.destination);
      gainNode.connect(streamDest);

      if (audioElRef.current && !mediaElementSourceRef.current) {
        const mediaSource = ctx.createMediaElementSource(audioElRef.current);
        mediaSource.connect(bassFilter);
        mediaElementSourceRef.current = mediaSource;
      }

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      bassFilterRef.current = bassFilter;
      eqFiltersRef.current = eqNodes;
      gainNodeRef.current = gainNode;
      streamDestRef.current = streamDest;
    }

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, [isMicActive, isMuted, settings.bassBoost, settings.eqBands, settings.smoothing, volume]);

  // Sync Bass Boost filter node when settings.bassBoost changes
  useEffect(() => {
    if (bassFilterRef.current && audioCtxRef.current) {
      bassFilterRef.current.gain.setTargetAtTime(
        settings.bassBoost,
        audioCtxRef.current.currentTime,
        0.04
      );
    }
  }, [settings.bassBoost]);

  // Sync 5-Band Graphic Equalizer BiquadFilterNodes before the AnalyserNode
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const filters = eqFiltersRef.current;
    if (!ctx || filters.length !== EQ_BAND_DEFINITIONS.length) return;

    const eq = settings.eqBands || DEFAULT_EQ_BANDS;
    EQ_BAND_DEFINITIONS.forEach((bandDef, index) => {
      const node = filters[index];
      if (node) {
        node.gain.setTargetAtTime(eq[bandDef.key] ?? 0, ctx.currentTime, 0.03);
      }
    });
  }, [settings.eqBands]);

  // Sync Volume & Mute (mute speaker output while mic is active to avoid feedback howl)
  useEffect(() => {
    if (audioElRef.current) {
      audioElRef.current.volume = isMuted ? 0 : volume;
    }
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(
        isMuted || isMicActive ? 0 : volume,
        audioCtxRef.current.currentTime,
        0.03
      );
    }
  }, [volume, isMuted, isMicActive]);

  // Sync Loop
  useEffect(() => {
    if (audioElRef.current) {
      audioElRef.current.loop = isLooping;
    }
  }, [isLooping]);

  // Toggle Play / Pause for Audio Files
  const handleTogglePlay = useCallback(async () => {
    ensureAudioGraph();
    if (isMicActive) {
      // Stop microphone first when switching back to file playback
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (micSourceRef.current) {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      }
      setIsMicActive(false);
    }

    const audio = audioElRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (err) {
        showToast('Не удалось запустить воспроизведение аудиофайла', 'error');
        console.error(err);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [ensureAudioGraph, isMicActive, showToast]);

  // Toggle Live Microphone Input
  const handleToggleMicrophone = useCallback(async () => {
    ensureAudioGraph();
    const ctx = audioCtxRef.current;
    const bassFilter = bassFilterRef.current;
    const analyser = analyserRef.current;
    if (!ctx || !bassFilter || !analyser) return;

    if (isMicActive) {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (micSourceRef.current) {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      }
      setIsMicActive(false);
      setIsPlaying(false);
      showToast('Микрофон отключен', 'info');
      return;
    }

    try {
      if (audioElRef.current && !audioElRef.current.paused) {
        audioElRef.current.pause();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const micSource = ctx.createMediaStreamSource(stream);
      // Route microphone through the 5-band Graphic EQ chain before the AnalyserNode
      micSource.connect(bassFilter);
      micStreamRef.current = stream;
      micSourceRef.current = micSource;
      setIsMicActive(true);
      setIsPlaying(true);
      setDetectedFileBpm(null);
      setTrackName('Живой вход с микрофона (Live Mic)');
      setTrackFormat('MIC');
      showToast('Захват сигнала с микрофона активен', 'success');
    } catch {
      showToast(
        'Доступ к микрофону отклонен браузером. Проверьте разрешения сайта.',
        'error'
      );
    }
  }, [ensureAudioGraph, isMicActive, showToast]);

  // Load Uploaded Audio File (MP3, WAV, FLAC)
  const handleAudioFileUpload = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toUpperCase() || '';
      const validExts = ['MP3', 'WAV', 'FLAC'];
      const validMimes = [
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/x-wav',
        'audio/wave',
        'audio/flac',
        'audio/x-flac',
      ];

      if (!validExts.includes(ext) && !validMimes.includes(file.type)) {
        showToast('Поддерживаются только форматы MP3, WAV и FLAC', 'error');
        return;
      }

      ensureAudioGraph();
      if (isMicActive) {
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach((t) => t.stop());
          micStreamRef.current = null;
        }
        if (micSourceRef.current) {
          micSourceRef.current.disconnect();
          micSourceRef.current = null;
        }
        setIsMicActive(false);
      }

      const detectedFormat: TrackFormat =
        ext === 'FLAC' || file.type.includes('flac')
          ? 'FLAC'
          : ext === 'MP3' || file.type.includes('mpeg')
          ? 'MP3'
          : 'WAV';

      const audio = audioElRef.current;
      if (!audio) return;

      const objectUrl = URL.createObjectURL(file);
      audio.src = objectUrl;
      setTrackName(file.name.slice(0, 160));
      setTrackFormat(detectedFormat);

      // Run automatic BPM analysis on the audio file
      setIsAnalyzingBpm(true);
      detectBpmFromAudioFile(file)
        .then((bpm) => {
          setDetectedFileBpm(bpm);
        })
        .finally(() => {
          setIsAnalyzingBpm(false);
        });

      try {
        await audio.play();
        setIsPlaying(true);
        showToast(`Загружен ${detectedFormat}: ${file.name}`, 'success');
      } catch {
        setIsPlaying(false);
        showToast(`Файл ${file.name} готов к воспроизведению`, 'info');
      }
    },
    [ensureAudioGraph, isMicActive, showToast]
  );

  // Switch built-in Studio Reference WAV Track
  const handleSelectReferenceWav = useCallback(
    async (presetType: 'deep-pulse' | 'harmonic-arp' | 'sub-sweep') => {
      setActiveSynthPreset(presetType);
      const wavFile = createSynthesizedStudioWavFile(presetType);
      await handleAudioFileUpload(wavFile);
    },
    [handleAudioFileUpload]
  );

  // Video Recording Export (Canvas 60fps + Web Audio Track)
  const handleToggleVideoRecording = useCallback(() => {
    if (isRecordingVideo) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecordingVideo(false);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    ensureAudioGraph();

    try {
      const canvasStream = canvas.captureStream(60);
      const combinedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

      if (streamDestRef.current) {
        const audioTracks = streamDestRef.current.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          combinedTracks.push(audioTracks[0]);
        }
      }

      const combinedStream = new MediaStream(combinedTracks);
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
      const supportedMime =
        mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      const recorder = supportedMime
        ? new MediaRecorder(combinedStream, {
            mimeType: supportedMime,
            videoBitsPerSecond: 6_000_000,
          })
        : new MediaRecorder(combinedStream);

      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const ext = supportedMime.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunksRef.current, {
          type: supportedMime || 'video/webm',
        });
        const url = URL.createObjectURL(blob);
        setLastRecordedVideoUrl(url);
        setLastRecordedVideoExt(ext);

        // Automatically trigger video file download
        const a = document.createElement('a');
        const cleanTitle =
          projectName
            .trim()
            .replace(/[^a-zA-Z0-9а-яА-Я_\-]+/g, '_')
            .slice(0, 50) || 'spectrapulse_video';
        a.href = url;
        a.download = `${cleanTitle}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`Видеофайл (${ext.toUpperCase()}) успешно экспортирован`, 'success');
      };

      recorder.start(200);
      mediaRecorderRef.current = recorder;
      setRecordingSeconds(0);
      setIsRecordingVideo(true);
      showToast('Запись видео начата (60 FPS + звук)', 'info');
    } catch (err) {
      console.error(err);
      showToast('Запись видео не поддерживается в текущем окружении', 'error');
    }
  }, [ensureAudioGraph, isRecordingVideo, projectName, showToast]);

  // Recording timer
  useEffect(() => {
    if (!isRecordingVideo) return;
    const interval = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecordingVideo]);

  // Fullscreen Mode
  const handleToggleFullscreen = useCallback(() => {
    const target = containerRef.current || document.documentElement;
    if (!document.fullscreenElement) {
      target.requestFullscreen?.().catch(() => {
        // Fallback if iframe blocks native fullscreen
        setIsFullscreen((prev) => !prev);
      });
    } else {
      document.exitFullscreen?.().catch(() => {
        setIsFullscreen(false);
      });
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Unobtrusive Auto-Hide Controls on Mouse Idle
  useEffect(() => {
    if (!layout.autoHideControls && !isFullscreen) {
      setIsIdleHidden(false);
      return;
    }

    const resetIdle = () => {
      setIsIdleHidden(false);
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
      }
      idleTimerRef.current = window.setTimeout(() => {
        if (isPlaying) {
          setIsIdleHidden(true);
        }
      }, 2800);
    };

    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    resetIdle();

    return () => {
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [layout.autoHideControls, isFullscreen, isPlaying]);

  // Persist workspace layout to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // Ignore storage quota errors
    }
  }, [layout]);

  // Automatic Draft Saving (Debounced every 900ms)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const sanitized = sanitizeSettings(settings);
      const draft: ProjectDraft = {
        id: 'local_autosave_draft',
        projectName: projectName.trim().slice(0, 100) || 'Черновик проекта',
        trackName: trackName.trim().slice(0, 160) || 'Источник сигнала',
        trackFormat,
        notes: projectNotes.slice(0, 500),
        ...sanitized,
        showLeftPanel: layout.showLeftPanel,
        showRightPanel: layout.showRightPanel,
        showTimeline: layout.showTimeline,
        showMeters: layout.showMeters,
        autoHideControls: layout.autoHideControls,
        darkTheme: layout.darkTheme,
        updatedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(LOCAL_AUTOSAVE_KEY, JSON.stringify(draft));
        setLocalDraft(draft);
        setLastAutoSaveTime(
          new Date().toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        );
      } catch {
        // Ignore storage errors
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [projectName, projectNotes, trackName, trackFormat, settings, layout]);

  // Firebase Auth & Real-Time Firestore Listeners for Presets and Drafts
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setCloudDrafts([]);
      return;
    }

    const presetsQuery = query(
      collection(db, 'presets'),
      where('ownerId', '==', user.uid)
    );
    const unsubPresets = onSnapshot(
      presetsQuery,
      (snapshot) => {
        const cloudItems: VisualizerPreset[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: data.ownerId,
            name: data.name,
            mode: data.mode,
            colorTheme: data.colorTheme,
            sensitivity: data.sensitivity,
            smoothing: data.smoothing,
            barCount: data.barCount,
            mirrorMode: data.mirrorMode,
            showPeaks: data.showPeaks,
            glowIntensity: data.glowIntensity,
            rotationSpeed: data.rotationSpeed,
            bassBoost: data.bassBoost,
            syncedToCloud: true,
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toDate().toISOString()
                : String(data.updatedAt || ''),
          };
        });

        setUserPresets((prev) => {
          const mergedMap = new Map<string, VisualizerPreset>();
          prev.forEach((p) => mergedMap.set(p.id, p));
          cloudItems.forEach((cp) => mergedMap.set(cp.id, cp));
          const merged = Array.from(mergedMap.values());
          try {
            localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(merged));
          } catch {
            // Ignore
          }
          return merged;
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'presets');
      }
    );

    const draftsQuery = query(
      collection(db, 'drafts'),
      where('ownerId', '==', user.uid)
    );
    const unsubDrafts = onSnapshot(
      draftsQuery,
      (snapshot) => {
        const loadedDrafts: ProjectDraft[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            ownerId: data.ownerId,
            projectName: data.projectName,
            trackName: data.trackName,
            trackFormat: data.trackFormat,
            mode: data.mode,
            colorTheme: data.colorTheme,
            sensitivity: data.sensitivity,
            smoothing: data.smoothing,
            barCount: data.barCount,
            mirrorMode: data.mirrorMode,
            showPeaks: data.showPeaks,
            glowIntensity: data.glowIntensity,
            rotationSpeed: data.rotationSpeed,
            bassBoost: data.bassBoost,
            notes: data.notes || '',
            showLeftPanel: Boolean(data.showLeftPanel),
            showRightPanel: Boolean(data.showRightPanel),
            showTimeline: Boolean(data.showTimeline),
            showMeters: Boolean(data.showMeters),
            autoHideControls: Boolean(data.autoHideControls),
            darkTheme: Boolean(data.darkTheme),
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toDate().toISOString()
                : new Date().toISOString(),
          };
        });
        setCloudDrafts(
          loadedDrafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'drafts');
      }
    );

    return () => {
      unsubPresets();
      unsubDrafts();
    };
  }, [user]);

  // Save Preset (Local + Cloud Firestore when signed in)
  const handleSavePreset = useCallback(
    async (customName?: string) => {
      const nameToUse = (customName ?? newPresetName).trim() || `Пресет ${userPresets.length + 1}`;
      const safeName = nameToUse.slice(0, 80);
      const presetId = sanitizeId(`preset_${Date.now()}`);
      const cleanSettings = sanitizeSettings(settings);

      const newPreset: VisualizerPreset = {
        id: presetId,
        ownerId: user?.uid,
        name: safeName,
        ...cleanSettings,
        syncedToCloud: Boolean(user),
        updatedAt: new Date().toISOString(),
      };

      const updatedLocal = [newPreset, ...userPresets];
      setUserPresets(updatedLocal);
      setNewPresetName('');
      try {
        localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(updatedLocal));
      } catch {
        // Ignore
      }

      if (user) {
        const path = `presets/${presetId}`;
        const firestoreFields = sanitizeFirestoreSettings(settings);
        try {
          await setDoc(doc(db, 'presets', presetId), {
            id: presetId,
            ownerId: user.uid,
            name: safeName,
            ...firestoreFields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          showToast(`Пресет «${safeName}» сохранен локально и в облаке`, 'success');
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      } else {
        showToast(`Пресет «${safeName}» сохранен в браузере`, 'success');
      }
    },
    [newPresetName, settings, showToast, user, userPresets]
  );

  // Delete User Preset
  const handleDeletePreset = useCallback(
    async (presetId: string) => {
      const next = userPresets.filter((p) => p.id !== presetId);
      setUserPresets(next);
      try {
        localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(next));
      } catch {
        // Ignore
      }

      if (user) {
        const path = `presets/${presetId}`;
        try {
          await deleteDoc(doc(db, 'presets', presetId));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      }
      showToast('Пресет удален', 'info');
    },
    [showToast, user, userPresets]
  );

  // Save Project Draft Snapshot to Cloud Firestore
  const handleSaveCloudDraftNow = useCallback(async () => {
    if (!user) return;
    setIsSavingCloud(true);
    const draftId = sanitizeId(`draft_${Date.now()}`);
    const firestoreFields = sanitizeFirestoreSettings(settings);
    const path = `drafts/${draftId}`;

    try {
      await setDoc(doc(db, 'drafts', draftId), {
        id: draftId,
        ownerId: user.uid,
        projectName: projectName.trim().slice(0, 100) || 'Студийный проект',
        trackName: trackName.trim().slice(0, 160) || 'Источник сигнала',
        trackFormat,
        ...firestoreFields,
        notes: projectNotes.slice(0, 500),
        showLeftPanel: Boolean(layout.showLeftPanel),
        showRightPanel: Boolean(layout.showRightPanel),
        showTimeline: Boolean(layout.showTimeline),
        showMeters: Boolean(layout.showMeters),
        autoHideControls: Boolean(layout.autoHideControls),
        darkTheme: Boolean(layout.darkTheme),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Черновик проекта синхронизирован с облаком', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setIsSavingCloud(false);
    }
  }, [
    layout,
    projectName,
    projectNotes,
    settings,
    showToast,
    trackFormat,
    trackName,
    user,
  ]);

  const handleDeleteCloudDraft = useCallback(
    async (draftId: string) => {
      if (!user) return;
      const path = `drafts/${draftId}`;
      try {
        await deleteDoc(doc(db, 'drafts', draftId));
        showToast('Облачный черновик удален', 'info');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    },
    [showToast, user]
  );

  const handleRestoreDraft = useCallback(
    (draft: ProjectDraft) => {
      setProjectName(draft.projectName);
      setTrackName(draft.trackName);
      setTrackFormat(draft.trackFormat);
      setProjectNotes(draft.notes || '');
      setSettings(sanitizeSettings(draft));
      setLayout((prev) => ({
        ...prev,
        showLeftPanel: draft.showLeftPanel,
        showRightPanel: draft.showRightPanel,
        showTimeline: draft.showTimeline,
        showMeters: draft.showMeters,
        autoHideControls: draft.autoHideControls,
        darkTheme: draft.darkTheme,
      }));
      showToast(`Восстановлен черновик «${draft.projectName}»`, 'success');
    },
    [showToast]
  );

  // Export Project to JSON & PDF
  const buildExportPayload = useCallback(
    () => ({
      schemaVersion: '1.0' as const,
      exportedAt: new Date().toISOString(),
      application: 'SpectraPulse Audio Studio' as const,
      projectName: projectName.trim() || 'SpectraPulse_Project',
      trackName,
      trackFormat,
      notes: projectNotes,
      settings: sanitizeSettings(settings),
      workspace: layout,
      telemetrySnapshot: {
        rmsDb: telemetry.rmsDb,
        peakFrequencyHz: telemetry.peakFrequencyHz,
        subBassEnergy: telemetry.subBassEnergy,
        estimatedBpm: telemetry.bpm || detectedFileBpm || undefined,
      },
    }),
    [detectedFileBpm, layout, projectName, projectNotes, settings, telemetry, trackFormat, trackName]
  );

  const handleExportJson = useCallback(() => {
    exportProjectToJson(buildExportPayload());
    showToast('Проект экспортирован в формат JSON', 'success');
  }, [buildExportPayload, showToast]);

  const handleExportPdf = useCallback(() => {
    exportProjectToPdf(buildExportPayload(), canvasRef.current);
    showToast('Паспорт проекта экспортирован в формат PDF', 'success');
  }, [buildExportPayload, showToast]);

  const handleImportJsonFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = parseImportedProjectJson(String(reader.result || ''));
          if (result.projectName) setProjectName(result.projectName);
          if (result.trackName) setTrackName(result.trackName);
          if (result.trackFormat) setTrackFormat(result.trackFormat);
          if (result.notes !== undefined) setProjectNotes(result.notes);
          setSettings(result.settings);
          if (result.workspace) {
            setLayout((prev) => ({ ...prev, ...result.workspace }));
          }
          showToast('Конфигурация проекта успешно импортирована из JSON', 'success');
        } catch {
          showToast('Ошибка чтения файла проекта JSON', 'error');
        }
      };
      reader.readAsText(file);
    },
    [showToast]
  );

  // Global Hotkeys System
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
        e.preventDefault();
        handleToggleMicrophone();
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        e.preventDefault();
        handleToggleVideoRecording();
      } else if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        e.preventDefault();
        setZenCanvasOnly((prev) => !prev);
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
        e.preventDefault();
        setLayout((prev) => ({ ...prev, darkTheme: !prev.darkTheme }));
      } else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') {
        e.preventDefault();
        const themeIds = Object.keys(COLOR_THEMES) as ColorThemeId[];
        setSettings((prev) => {
          const nextIdx = (themeIds.indexOf(prev.colorTheme) + 1) % themeIds.length;
          return { ...prev, colorTheme: themeIds[nextIdx] };
        });
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
        e.preventDefault();
        handleSavePreset(`Быстрый пресет ${new Date().toLocaleTimeString('ru-RU')}`);
      } else if (e.key === '[') {
        e.preventDefault();
        setSettings((prev) => ({
          ...prev,
          sensitivity: Number(clampNumber(prev.sensitivity - 0.15, 0.2, 4.0).toFixed(2)),
        }));
      } else if (e.key === ']') {
        e.preventDefault();
        setSettings((prev) => ({
          ...prev,
          sensitivity: Number(clampNumber(prev.sensitivity + 0.15, 0.2, 4.0).toFixed(2)),
        }));
      } else if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        const idx = Number(e.key) - 1;
        const modeObj = VISUALIZATION_MODES[idx];
        if (modeObj) {
          setSettings((prev) => ({ ...prev, mode: modeObj.id }));
        }
      } else if (e.key === '?' || e.key === '/') {
        e.preventDefault();
        setIsHotkeysOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleSavePreset,
    handleToggleFullscreen,
    handleToggleMicrophone,
    handleTogglePlay,
    handleToggleVideoRecording,
  ]);

  const formatTime = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isDark = layout.darkTheme;
  const uiHidden = isIdleHidden || zenCanvasOnly;

  // Source & Presets Sidebar Component
  const LeftSourceSidebar = (
    <aside
      className={`w-80 shrink-0 border-r flex flex-col justify-between overflow-y-auto transition-opacity duration-200 ${
        isDark
          ? 'bg-slate-950/90 border-slate-800/80 text-slate-100'
          : 'bg-white/95 border-slate-200 text-slate-900'
      } ${uiHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <div className="p-4 space-y-6">
        {/* Section 1: Audio Input Sources */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2">
              <Music className="w-4 h-4 text-amber-500" />
              Источник аудиосигнала
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {trackFormat}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`px-3 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-slate-900 border-slate-800 hover:border-amber-500/50 text-slate-100'
                  : 'bg-slate-100 border-slate-200 hover:border-amber-500 text-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-amber-500" />
              Загрузить файл
            </button>

            <button
              type="button"
              onClick={handleToggleMicrophone}
              className={`px-3 py-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                isMicActive
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                  : isDark
                  ? 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
                  : 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-800'
              }`}
            >
              {isMicActive ? (
                <>
                  <MicOff className="w-3.5 h-3.5 text-rose-400" />
                  Выкл. микрофон
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-cyan-400" />
                  Микрофон (M)
                </>
              )}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAudioFileUpload(file);
            }}
          />

          <p className="text-xs text-slate-400 mt-2">
            Поддержка студийных форматов MP3 · WAV · FLAC
          </p>

          {/* Built-in Reference Audio Generator */}
          <div className="mt-3 pt-3 border-t border-slate-800/50">
            <div className="text-xs text-slate-400 mb-2">
              Эталонные генераторы сигнала (WAV PCM):
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'deep-pulse' as const, label: 'Суббас 124' },
                { id: 'harmonic-arp' as const, label: 'Арпеджио' },
                { id: 'sub-sweep' as const, label: 'Импульс' },
              ].map((synth) => (
                <button
                  key={synth.id}
                  type="button"
                  onClick={() => handleSelectReferenceWav(synth.id)}
                  className={`px-2 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 truncate ${
                    !isMicActive && activeSynthPreset === synth.id
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : isDark
                      ? 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {synth.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 2: Visualization Modes */}
        <div>
          <h2 className="text-sm font-semibold tracking-tight mb-2.5 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Геометрия визуализации
          </h2>
          <div className="space-y-1.5">
            {VISUALIZATION_MODES.map((m) => {
              const active = settings.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, mode: m.id }))}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2 ${
                    active
                      ? isDark
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                        : 'bg-amber-50 border-amber-500 text-slate-900'
                      : isDark
                      ? 'bg-slate-900/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{m.label}</div>
                    <div className="text-[11px] text-slate-400 truncate">{m.shortDesc}</div>
                  </div>
                  <kbd className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                    [{m.hotkey}]
                  </kbd>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 3: Color Themes */}
        <div>
          <h2 className="text-sm font-semibold tracking-tight mb-2.5">
            Цветовая палитра (T)
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(COLOR_THEMES) as ColorThemeId[]).map((themeKey) => {
              const theme = COLOR_THEMES[themeKey];
              const active = settings.colorTheme === themeKey;
              return (
                <button
                  key={themeKey}
                  type="button"
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, colorTheme: themeKey }))
                  }
                  className={`px-2.5 py-2 rounded-lg border text-left transition-colors flex items-center gap-2 min-w-0 ${
                    active
                      ? isDark
                        ? 'bg-slate-900 border-amber-500 text-slate-100'
                        : 'bg-amber-50/60 border-amber-500 text-slate-900'
                      : isDark
                      ? 'bg-slate-900/40 border-slate-800 text-slate-300 hover:border-slate-700'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-sm shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
                    }}
                  />
                  <span className="text-xs font-medium truncate">{theme.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 4: Presets Library (Local + Cloud Sync) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold tracking-tight">
              Пресеты настроек
            </h2>
            <span className="text-xs text-slate-400">
              {user ? 'Облако + Браузер' : 'Локально'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 mb-3">
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Название нового пресета..."
              maxLength={80}
              className={`flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:border-amber-500 ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-100 placeholder:text-slate-500'
                  : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
              }`}
            />
            <button
              type="button"
              onClick={() => handleSavePreset()}
              className="px-3 py-1.5 text-xs font-medium bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Сохранить
            </button>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
            {userPresets.map((preset) => (
              <div
                key={preset.id}
                className={`px-2.5 py-2 rounded-lg border flex items-center justify-between gap-2 ${
                  isDark
                    ? 'bg-slate-900/70 border-slate-800'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSettings(sanitizeSettings(preset));
                    showToast(`Применен пресет «${preset.name}»`, 'info');
                  }}
                  className="text-left min-w-0 flex-1"
                >
                  <div className="text-xs font-medium truncate">{preset.name}</div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                    {preset.mode} · {preset.sensitivity.toFixed(2)}x · {preset.barCount} полос
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePreset(preset.id)}
                  className="p-1 text-slate-400 hover:text-rose-400 transition-colors shrink-0"
                  aria-label="Удалить пресет"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {FACTORY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setSettings(sanitizeSettings(preset));
                  showToast(`Применен эталон «${preset.name}»`, 'info');
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                  isDark
                    ? 'bg-slate-900/30 border-slate-800/60 hover:bg-slate-900 text-slate-300'
                    : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <div className="text-xs font-medium truncate">{preset.name}</div>
                <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                  Заводской эталон · {preset.barCount} полос
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Auto-Save status */}
      <div
        className={`px-4 py-2.5 border-t text-[11px] font-mono tabular-nums flex items-center justify-between ${
          isDark
            ? 'border-slate-800/80 text-slate-400 bg-slate-950'
            : 'border-slate-200 text-slate-500 bg-slate-50'
        }`}
      >
        <span>Автосохранение черновика</span>
        <span>{lastAutoSaveTime || 'Активно'}</span>
      </div>
    </aside>
  );

  // Acoustic & Visual Inspector Right Sidebar
  const RightInspectorSidebar = (
    <aside
      className={`w-80 shrink-0 border-l flex flex-col justify-between overflow-y-auto transition-opacity duration-200 ${
        isDark
          ? 'bg-slate-950/90 border-slate-800/80 text-slate-100'
          : 'bg-white/95 border-slate-200 text-slate-900'
      } ${uiHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-500" />
            Калибровка анализатора
          </h2>
          <button
            type="button"
            onClick={() => setSettings(DEFAULT_SETTINGS)}
            className="text-xs text-slate-400 hover:text-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            Сброс
          </button>
        </div>

        {/* Sliders */}
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <label htmlFor="slider-sensitivity" className="text-slate-300 font-medium">
                Чувствительность (Gain)
              </label>
              <span className="font-mono tabular-nums text-amber-400">
                {settings.sensitivity.toFixed(2)}x
              </span>
            </div>
            <input
              id="slider-sensitivity"
              type="range"
              min={0.2}
              max={4.0}
              step={0.05}
              value={settings.sensitivity}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  sensitivity: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <label htmlFor="slider-smoothing" className="text-slate-300 font-medium">
                Инерция сглаживания (FFT)
              </label>
              <span className="font-mono tabular-nums text-amber-400">
                {Math.round(settings.smoothing * 100)}%
              </span>
            </div>
            <input
              id="slider-smoothing"
              type="range"
              min={0.1}
              max={0.95}
              step={0.01}
              value={settings.smoothing}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  smoothing: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <label htmlFor="slider-bars" className="text-slate-300 font-medium">
                Плотность спектра (Полосы)
              </label>
              <span className="font-mono tabular-nums text-amber-400">
                {settings.barCount}
              </span>
            </div>
            <input
              id="slider-bars"
              type="range"
              min={32}
              max={256}
              step={16}
              value={settings.barCount}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  barCount: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <label htmlFor="slider-bass" className="text-slate-300 font-medium">
                Усиление суббаса (110 Гц)
              </label>
              <span className="font-mono tabular-nums text-amber-400">
                +{settings.bassBoost} dB
              </span>
            </div>
            <input
              id="slider-bass"
              type="range"
              min={0}
              max={24}
              step={1}
              value={settings.bassBoost}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  bassBoost: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <label htmlFor="slider-glow" className="text-slate-300 font-medium">
                Атмосферное свечение
              </label>
              <span className="font-mono tabular-nums text-amber-400">
                {settings.glowIntensity}%
              </span>
            </div>
            <input
              id="slider-glow"
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.glowIntensity}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  glowIntensity: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <label htmlFor="slider-rotation" className="text-slate-300 font-medium">
                Скорость орбитального вращения
              </label>
              <span className="font-mono tabular-nums text-amber-400">
                {settings.rotationSpeed.toFixed(1)} рад/с
              </span>
            </div>
            <input
              id="slider-rotation"
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={settings.rotationSpeed}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  rotationSpeed: Number(e.target.value),
                }))
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Boolean toggles */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60">
          <button
            type="button"
            onClick={() =>
              setSettings((prev) => ({ ...prev, mirrorMode: !prev.mirrorMode }))
            }
            className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              settings.mirrorMode
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : isDark
                ? 'bg-slate-900 border-slate-800 text-slate-400'
                : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}
          >
            Симметрия: {settings.mirrorMode ? 'Вкл' : 'Выкл'}
          </button>

          <button
            type="button"
            onClick={() =>
              setSettings((prev) => ({ ...prev, showPeaks: !prev.showPeaks }))
            }
            className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              settings.showPeaks
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : isDark
                ? 'bg-slate-900 border-slate-800 text-slate-400'
                : 'bg-slate-100 border-slate-200 text-slate-600'
            }`}
          >
            Пики (Hold): {settings.showPeaks ? 'Вкл' : 'Выкл'}
          </button>
        </div>

        {/* 5-Band Graphic Equalizer (Pre-Analyser Signal Conditioning) */}
        <div className="pt-4 border-t border-slate-800/60 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold tracking-tight">
                5-полосный эквалайзер (Pre-FFT)
              </h3>
              <p className="text-[11px] text-slate-400">
                Коррекция АЧХ перед подачей на анализатор
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  eqBands: { ...DEFAULT_EQ_BANDS },
                }))
              }
              className="text-[11px] font-mono text-slate-400 hover:text-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              0 dB
            </button>
          </div>

          {/* Quick EQ Contour Buttons */}
          <div className="grid grid-cols-4 gap-1">
            {[
              {
                label: 'Линейный',
                bands: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
              },
              {
                label: 'V-Контур',
                bands: { low: 6.5, lowMid: 2.0, mid: -3.5, highMid: 3.0, high: 6.0 },
              },
              {
                label: 'Панч НЧ',
                bands: { low: 8.5, lowMid: 4.5, mid: -1.5, highMid: 0.5, high: 1.5 },
              },
              {
                label: 'Середина',
                bands: { low: -2.5, lowMid: 2.5, mid: 6.0, highMid: 4.0, high: -1.0 },
              },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() =>
                  setSettings((prev) => ({
                    ...prev,
                    eqBands: preset.bands,
                  }))
                }
                className={`px-1.5 py-1 rounded border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 truncate ${
                  isDark
                    ? 'bg-slate-900 border-slate-800 text-slate-300 hover:border-amber-500/40'
                    : 'bg-slate-100 border-slate-200 text-slate-700 hover:border-amber-500'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Live SVG Frequency Response Curve */}
          <div
            className={`h-12 w-full rounded-lg border px-2 py-1 relative overflow-hidden ${
              isDark
                ? 'bg-slate-900/80 border-slate-800'
                : 'bg-slate-100 border-slate-200'
            }`}
          >
            <svg
              viewBox="0 0 240 44"
              className="w-full h-full overflow-visible"
              aria-hidden="true"
            >
              {/* 0 dB center reference line */}
              <line
                x1="0"
                y1="22"
                x2="240"
                y2="22"
                stroke="currentColor"
                strokeOpacity="0.18"
                strokeDasharray="3 3"
              />
              {(() => {
                const eq: EqBands = settings.eqBands || DEFAULT_EQ_BANDS;
                const vals = [eq.low, eq.lowMid, eq.mid, eq.highMid, eq.high];
                const pts = vals.map((v, idx) => {
                  const x = 18 + idx * 51;
                  const y = 22 - (v / 12) * 17;
                  return { x, y };
                });
                const polylinePoints = pts.map((p) => `${p.x},${p.y}`).join(' ');
                return (
                  <>
                    <polyline
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={polylinePoints}
                    />
                    {pts.map((p, idx) => (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r="3"
                        fill="#FDE68A"
                        stroke="#F59E0B"
                        strokeWidth="1.5"
                      />
                    ))}
                  </>
                );
              })()}
            </svg>
          </div>

          {/* 5 Band Sliders (Low, Low-Mid, Mid, High-Mid, High) */}
          <div className="space-y-2.5">
            {EQ_BAND_DEFINITIONS.map((band) => {
              const currentEq = settings.eqBands || DEFAULT_EQ_BANDS;
              const val = currentEq[band.key] ?? 0;
              return (
                <div key={band.key}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-200">{band.label}</span>
                      <span className="text-slate-400 font-mono tabular-nums">
                        ({band.freqLabel})
                      </span>
                    </div>
                    <button
                      type="button"
                      title="Нажмите для сброса полосы в 0 dB"
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          eqBands: {
                            ...(prev.eqBands || DEFAULT_EQ_BANDS),
                            [band.key]: 0,
                          },
                        }))
                      }
                      className={`font-mono tabular-nums cursor-pointer ${
                        val > 0
                          ? 'text-amber-400'
                          : val < 0
                          ? 'text-cyan-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)} dB
                    </button>
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={val}
                    aria-label={`Полоса эквалайзера ${band.label} ${band.freqLabel}`}
                    onChange={(e) => {
                      const nextVal = Number(e.target.value);
                      setSettings((prev) => ({
                        ...prev,
                        eqBands: {
                          ...(prev.eqBands || DEFAULT_EQ_BANDS),
                          [band.key]: nextVal,
                        },
                      }));
                    }}
                    className="w-full accent-amber-500 cursor-pointer h-1.5"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Real-Time Harmonic Series & Overtone Tracker Widget */}
        <div className="pt-4 border-t border-slate-800/60 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold tracking-tight">
                Гармонический ряд (f₀ и обертоны)
              </h3>
              <p className="text-[11px] text-slate-400">
                Фундаментальная частота и спектр гармоник
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-amber-400 font-semibold">
              {telemetry.fundamentalHz > 0
                ? `${telemetry.fundamentalNote} · ${telemetry.fundamentalHz.toFixed(1)} Гц`
                : 'Ожидание сигнала'}
            </span>
          </div>

          {/* Summary Telemetry Strip (Unboxed clean metadata with typographic separator) */}
          <div
            className={`px-3 py-2 rounded-lg border flex items-center justify-between text-[11px] font-mono tabular-nums ${
              isDark
                ? 'bg-slate-900/75 border-slate-800 text-slate-300'
                : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <span>
              Тон f₀:{' '}
              <strong className="text-amber-400 font-semibold">
                {telemetry.fundamentalHz > 0 ? `${telemetry.fundamentalHz.toFixed(1)} Гц` : '—'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Нота:{' '}
              <strong className="font-semibold">
                {telemetry.fundamentalNote}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Обертоны: <strong className="text-cyan-400">{telemetry.overtoneRatioPct}%</strong>
            </span>
          </div>

          {/* 5 Harmonic Rows: f0, 2f0, 3f0, 4f0, 5f0 */}
          <div className="space-y-2">
            {telemetry.harmonics.map((h) => {
              const isFundamental = h.order === 1;
              return (
                <div
                  key={h.order}
                  className={`p-2 rounded-lg border transition-colors ${
                    isDark
                      ? isFundamental
                        ? 'bg-slate-900/90 border-amber-500/35'
                        : 'bg-slate-900/45 border-slate-800/80'
                      : isFundamental
                      ? 'bg-amber-50/50 border-amber-500/40'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`font-semibold ${
                          isFundamental
                            ? 'text-amber-400'
                            : isDark
                            ? 'text-slate-200'
                            : 'text-slate-800'
                        }`}
                      >
                        {h.label}
                      </span>
                      <span className="text-slate-400 truncate font-sans">
                        · {h.intervalLabel}
                      </span>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                        {h.frequencyHz > 0 ? `${h.frequencyHz.toFixed(0)} Гц` : '— Гц'}
                      </span>
                      <span aria-hidden="true" className="text-slate-500">
                        ·
                      </span>
                      <span className="text-amber-400 w-6 text-right">{h.noteName}</span>
                    </div>
                  </div>

                  {/* Real-time Amplitude Meter Bar + dBFS Readout */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex-1 h-1.5 rounded-sm overflow-hidden ${
                        isDark ? 'bg-slate-800' : 'bg-slate-200'
                      }`}
                    >
                      <div
                        className={`h-full transition-transform duration-100 origin-left ${
                          isFundamental ? 'bg-amber-500' : 'bg-cyan-400'
                        }`}
                        style={{
                          transform: `scaleX(${Math.max(0.02, h.magnitudePct / 100)})`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono tabular-nums text-slate-400 w-14 text-right shrink-0">
                      {h.dbFs > -59.5 ? `${h.dbFs.toFixed(1)} dB` : '-60.0 dB'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Video Recording & Export Studio Box */}
        <div className="pt-4 border-t border-slate-800/60 space-y-2.5">
          <h3 className="text-xs font-semibold tracking-tight">
            Видеоэкспорт визуализации (R)
          </h3>
          <button
            type="button"
            onClick={handleToggleVideoRecording}
            className={`w-full px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
              isRecordingVideo
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
            }`}
          >
            {isRecordingVideo ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                Остановить запись ({formatTime(recordingSeconds)})
              </>
            ) : (
              <>
                <Video className="w-4 h-4" />
                Экспортировать в видеофайл
              </>
            )}
          </button>

          {lastRecordedVideoUrl && (
            <a
              href={lastRecordedVideoUrl}
              download={`${projectName.slice(0, 40) || 'spectrapulse'}.${lastRecordedVideoExt}`}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-center text-slate-300 hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              Скачать последнюю запись (.{lastRecordedVideoExt.toUpperCase()})
            </a>
          )}
        </div>

        {/* Project Details & Export / Import */}
        <div className="pt-4 border-t border-slate-800/60 space-y-2.5">
          <h3 className="text-xs font-semibold tracking-tight">
            Паспорт проекта (PDF / JSON)
          </h3>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            maxLength={100}
            placeholder="Название проекта..."
            className={`w-full px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:border-amber-500 ${
              isDark
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-slate-50 border-slate-300 text-slate-900'
            }`}
          />
          <textarea
            value={projectNotes}
            onChange={(e) => setProjectNotes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Технические заметки по проекту..."
            className={`w-full px-2.5 py-1.5 text-xs rounded-lg border resize-none focus:outline-none focus:border-amber-500 ${
              isDark
                ? 'bg-slate-900 border-slate-800 text-slate-300'
                : 'bg-slate-50 border-slate-300 text-slate-800'
            }`}
          />
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={handleExportPdf}
              className={`px-2.5 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
                  : 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-amber-500" />
              PDF
            </button>
            <button
              type="button"
              onClick={handleExportJson}
              className={`px-2.5 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
                  : 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-800'
              }`}
            >
              <FileJson className="w-3.5 h-3.5 text-cyan-400" />
              JSON
            </button>
            <button
              type="button"
              onClick={() => jsonImportInputRef.current?.click()}
              className={`px-2.5 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
                  : 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-800'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
              Импорт
            </button>
          </div>
          <input
            ref={jsonImportInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportJsonFile(file);
            }}
          />
        </div>
      </div>
    </aside>
  );

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) {
          if (file.name.endsWith('.json')) {
            handleImportJsonFile(file);
          } else {
            handleAudioFileUpload(file);
          }
        }
      }}
      className={`h-screen w-screen overflow-hidden flex flex-col select-none ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Strict 3-Zone Top Bar Contract */}
      <header
        className={`flex items-center justify-between gap-8 px-6 py-3.5 border-b shrink-0 z-20 transition-opacity duration-200 ${
          isDark
            ? 'bg-slate-950 border-slate-800/80'
            : 'bg-white border-slate-200'
        } ${uiHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#studio"
          onClick={(e) => e.preventDefault()}
          className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0 font-display"
        >
          SpectraPulse Studio
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setIsDraftsOpen(true)}
            className="hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Черновики
          </button>
          <button
            type="button"
            onClick={() => setIsWorkspaceOpen(true)}
            className="hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Интерфейс
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Экспорт PDF
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Экспорт JSON
          </button>
          <button
            type="button"
            onClick={() => setIsHotkeysOpen(true)}
            className="hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Клавиши
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={async () => {
              if (user) {
                await logOutFirebase();
                showToast('Вы вышли из облачного аккаунта', 'info');
              } else {
                try {
                  await signInWithGoogle();
                  showToast('Облачная синхронизация подключена', 'success');
                } catch {
                  showToast('Вход через Google отменен', 'error');
                }
              }
            }}
            className="px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <Cloud className="w-3.5 h-3.5" />
            {user ? 'Облако активно · Выйти' : 'Облачная синхронизация'}
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="flex-1 flex min-h-0 relative">
        {layout.swapSidebars ? (
          <>
            {layout.showRightPanel && RightInspectorSidebar}
          </>
        ) : (
          <>
            {layout.showLeftPanel && LeftSourceSidebar}
          </>
        )}

        {/* Center Stage: Live Visualizer Canvas + Unobtrusive Floating Overlays */}
        <main className="flex-1 relative min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 relative">
            <VisualizerCanvas
              analyser={analyserRef.current}
              isPlaying={isPlaying}
              settings={settings}
              darkTheme={isDark}
              canvasRef={canvasRef}
              detectedFileBpm={detectedFileBpm}
              onTelemetryUpdate={setTelemetry}
            />

            {/* Top-left Unobtrusive Acoustic Telemetry HUD */}
            {layout.showMeters && (
              <div
                className={`absolute top-4 left-4 px-3.5 py-2 rounded-lg border backdrop-blur-md transition-opacity duration-200 pointer-events-none ${
                  isDark
                    ? 'bg-slate-950/70 border-slate-800/80 text-slate-300'
                    : 'bg-white/80 border-slate-200 text-slate-700'
                } ${uiHidden ? 'opacity-0' : 'opacity-100'}`}
              >
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
                  <span>{trackName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{trackFormat}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold transition-colors ${
                      telemetry.isBeat
                        ? 'text-amber-400'
                        : isDark
                        ? 'text-amber-300/90'
                        : 'text-amber-600'
                    }`}
                  >
                    {isAnalyzingBpm
                      ? 'Анализ BPM...'
                      : telemetry.bpm > 0
                      ? `~${telemetry.bpm} BPM`
                      : 'Ожидание ритма'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{telemetry.rmsDb.toFixed(1)} dBFS</span>
                  <span aria-hidden="true">·</span>
                  <span>Пик {telemetry.peakFrequencyHz} Гц</span>
                  <span aria-hidden="true">·</span>
                  <span>НЧ {telemetry.subBassEnergy}%</span>
                  <span aria-hidden="true">·</span>
                  <span>{telemetry.fps} FPS</span>
                </div>
              </div>
            )}

            {/* Top-right Unobtrusive Quick View Controls */}
            <div
              className={`absolute top-4 right-4 flex items-center gap-2 transition-opacity duration-200 ${
                uiHidden ? 'opacity-20 hover:opacity-100' : 'opacity-100'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setLayout((prev) => ({ ...prev, darkTheme: !prev.darkTheme }))
                }
                title="Переключить темную / светлую тему (D)"
                className={`p-2 rounded-lg border backdrop-blur-md transition-colors ${
                  isDark
                    ? 'bg-slate-950/75 border-slate-800 text-slate-200 hover:border-slate-700'
                    : 'bg-white/85 border-slate-200 text-slate-800 hover:border-slate-300'
                }`}
              >
                {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setZenCanvasOnly((prev) => !prev)}
                title="Скрыть / Показать панели управления (H)"
                className={`p-2 rounded-lg border backdrop-blur-md transition-colors ${
                  isDark
                    ? 'bg-slate-950/75 border-slate-800 text-slate-200 hover:border-slate-700'
                    : 'bg-white/85 border-slate-200 text-slate-800 hover:border-slate-300'
                }`}
              >
                {zenCanvasOnly ? (
                  <Eye className="w-4 h-4 text-amber-400" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>

              <button
                type="button"
                onClick={handleToggleFullscreen}
                title="Полноэкранный режим (F)"
                className={`p-2 rounded-lg border backdrop-blur-md transition-colors ${
                  isDark
                    ? 'bg-slate-950/75 border-slate-800 text-slate-200 hover:border-slate-700'
                    : 'bg-white/85 border-slate-200 text-slate-800 hover:border-slate-300'
                }`}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4 text-amber-400" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Toast Notification Banner */}
            {statusMessage && (
              <div
                className={`absolute bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg border text-xs font-medium shadow-lg backdrop-blur-md flex items-center gap-2 z-30 ${
                  statusMessage.type === 'error'
                    ? 'bg-rose-950/90 border-rose-700 text-rose-100'
                    : statusMessage.type === 'success'
                    ? 'bg-emerald-950/90 border-emerald-700 text-emerald-100'
                    : 'bg-slate-900/90 border-slate-700 text-slate-100'
                }`}
              >
                {statusMessage.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}
          </div>

          {/* Bottom Transport & Sensitivity Console */}
          {layout.showTimeline && (
            <div
              className={`h-16 border-t px-6 flex items-center justify-between gap-6 shrink-0 transition-opacity duration-200 ${
                isDark
                  ? 'bg-slate-950/95 border-slate-800/80'
                  : 'bg-white/95 border-slate-200'
              } ${uiHidden ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            >
              {/* Play / Pause & Loop Controls */}
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isPlaying && !isMicActive ? (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      Пауза
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Воспроизвести
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setIsLooping((prev) => !prev)}
                  title="Зациклить трек"
                  className={`p-2 rounded-lg border transition-colors ${
                    isLooping
                      ? 'border-amber-500/50 text-amber-400 bg-amber-500/10'
                      : isDark
                      ? 'border-slate-800 text-slate-400 hover:text-slate-200'
                      : 'border-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Repeat className="w-4 h-4" />
                </button>
              </div>

              {/* Timeline Scrubber */}
              <div className="flex-1 flex items-center gap-3 min-w-0">
                <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                  {isMicActive ? 'LIVE' : formatTime(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 16}
                  step={0.05}
                  disabled={isMicActive}
                  value={isMicActive ? 0 : currentTime}
                  onChange={(e) => {
                    const nextTime = Number(e.target.value);
                    setCurrentTime(nextTime);
                    if (audioElRef.current) {
                      audioElRef.current.currentTime = nextTime;
                    }
                  }}
                  aria-label="Позиция воспроизведения аудиофайла"
                  className="flex-1 accent-amber-500 cursor-pointer disabled:opacity-40"
                />
                <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                  {isMicActive ? 'MIC' : formatTime(duration)}
                </span>
              </div>

              {/* Quick Sensitivity & Volume Controls */}
              <div className="hidden lg:flex items-center gap-5 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">
                    Чувствительность:
                  </span>
                  <input
                    type="range"
                    min={0.2}
                    max={4.0}
                    step={0.05}
                    value={settings.sensitivity}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        sensitivity: Number(e.target.value),
                      }))
                    }
                    aria-label="Быстрый регулятор чувствительности"
                    className="w-24 accent-amber-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono tabular-nums text-amber-400 w-10">
                    {settings.sensitivity.toFixed(1)}x
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMuted((prev) => !prev)}
                    className="text-slate-400 hover:text-slate-200 transition-colors"
                    aria-label="Включить или выключить звук"
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4 text-rose-400" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      setIsMuted(false);
                      setVolume(Number(e.target.value));
                    }}
                    aria-label="Громкость воспроизведения"
                    className="w-20 accent-amber-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}
        </main>

        {layout.swapSidebars ? (
          <>
            {layout.showLeftPanel && LeftSourceSidebar}
          </>
        ) : (
          <>
            {layout.showRightPanel && RightInspectorSidebar}
          </>
        )}
      </div>

      {/* Studio Modals */}
      <HotkeysModal
        isOpen={isHotkeysOpen}
        onClose={() => setIsHotkeysOpen(false)}
        darkTheme={isDark}
      />

      <DraftsModal
        isOpen={isDraftsOpen}
        onClose={() => setIsDraftsOpen(false)}
        darkTheme={isDark}
        localDraft={localDraft}
        cloudDrafts={cloudDrafts}
        isAuthenticated={Boolean(user)}
        onRestoreDraft={handleRestoreDraft}
        onSaveCloudDraftNow={handleSaveCloudDraftNow}
        onDeleteCloudDraft={handleDeleteCloudDraft}
        isSavingCloud={isSavingCloud}
      />

      <WorkspaceModal
        isOpen={isWorkspaceOpen}
        onClose={() => setIsWorkspaceOpen(false)}
        layout={layout}
        onChangeLayout={setLayout}
        onResetLayout={() => setLayout(DEFAULT_LAYOUT)}
      />
    </div>
  );
}

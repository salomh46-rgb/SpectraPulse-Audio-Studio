import React from 'react';
import {
  Keyboard,
  X,
  Cloud,
  HardDrive,
  Trash2,
  RotateCcw,
  Layout,
  Save,
  Check,
} from 'lucide-react';
import { ProjectDraft, VISUALIZATION_MODES, WorkspaceLayoutConfig } from '../types';

interface HotkeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkTheme: boolean;
}

export const HotkeysModal: React.FC<HotkeysModalProps> = ({
  isOpen,
  onClose,
  darkTheme,
}) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Пробел', action: 'Воспроизведение / Пауза активного трека' },
    { key: 'M', action: 'Включить / Выключить захват звука с микрофона' },
    { key: '1 – 6', action: 'Быстрое переключение режима визуализации' },
    { key: 'T', action: 'Переключить цветовую тему по кругу' },
    { key: '[  /  ]', action: 'Уменьшить / Увеличить чувствительность (Gain)' },
    { key: 'R', action: 'Начать / Остановить видеозапись холста (WebM/MP4)' },
    { key: 'F', action: 'Полноэкранный режим просмотра' },
    { key: 'H', action: 'Скрыть / Показать боковые панели управления (Чистый холст)' },
    { key: 'D', action: 'Переключить ночную темную / дневную светлую тему' },
    { key: 'S', action: 'Быстрое сохранение текущего пресета' },
    { key: '?', action: 'Открыть справочник горячих клавиш' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hotkeys-modal-title"
    >
      <div
        className={`w-full max-w-xl rounded-xl border p-6 shadow-2xl ${
          darkTheme
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-5 h-5 text-amber-500" />
            <h2 id="hotkeys-modal-title" className="text-lg font-semibold tracking-tight">
              Горячие клавиши студии
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
            aria-label="Закрыть окно"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 divide-y divide-slate-800/40 max-h-[65vh] overflow-y-auto">
          {shortcuts.map((item) => (
            <div key={item.key} className="flex items-center justify-between py-2.5 text-sm">
              <span className={darkTheme ? 'text-slate-300' : 'text-slate-600'}>
                {item.action}
              </span>
              <kbd
                className={`px-2.5 py-1 rounded text-xs font-mono tabular-nums font-medium border ${
                  darkTheme
                    ? 'bg-slate-950 border-slate-800 text-amber-400'
                    : 'bg-slate-100 border-slate-300 text-slate-800'
                }`}
              >
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};

interface DraftsModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkTheme: boolean;
  localDraft: ProjectDraft | null;
  cloudDrafts: ProjectDraft[];
  isAuthenticated: boolean;
  onRestoreDraft: (draft: ProjectDraft) => void;
  onSaveCloudDraftNow: () => void;
  onDeleteCloudDraft: (draftId: string) => void;
  isSavingCloud: boolean;
}

export const DraftsModal: React.FC<DraftsModalProps> = ({
  isOpen,
  onClose,
  darkTheme,
  localDraft,
  cloudDrafts,
  isAuthenticated,
  onRestoreDraft,
  onSaveCloudDraftNow,
  onDeleteCloudDraft,
  isSavingCloud,
}) => {
  if (!isOpen) return null;

  const getModeLabel = (modeId: string) =>
    VISUALIZATION_MODES.find((m) => m.id === modeId)?.label || modeId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drafts-modal-title"
    >
      <div
        className={`w-full max-w-2xl rounded-xl border p-6 shadow-2xl ${
          darkTheme
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/60">
          <div>
            <h2 id="drafts-modal-title" className="text-lg font-semibold tracking-tight">
              Черновики проекта и облачный архив
            </h2>
            <p className={`text-xs mt-0.5 ${darkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
              Автоматическое сохранение предотвращает потерю настроек при перезагрузке страницы
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-5 max-h-[65vh] overflow-y-auto pr-1">
          {/* Local Auto-Save Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-amber-500" />
                Локальный авто-черновик браузера
              </span>
            </div>
            {localDraft ? (
              <div
                className={`p-3.5 rounded-lg border flex items-center justify-between gap-4 ${
                  darkTheme
                    ? 'bg-slate-950/70 border-slate-800'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{localDraft.projectName}</div>
                  <div
                    className={`text-xs mt-1 font-mono tabular-nums ${
                      darkTheme ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {getModeLabel(localDraft.mode)} · {localDraft.trackFormat} · Чувств.{' '}
                    {localDraft.sensitivity.toFixed(2)}x · Обновлено{' '}
                    {new Date(localDraft.updatedAt).toLocaleTimeString('ru-RU')}
                  </div>
                </div>
                <button
                  onClick={() => {
                    onRestoreDraft(localDraft);
                    onClose();
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Восстановить
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-2">
                Локальный черновик будет создан автоматически при первом изменении настроек.
              </div>
            )}
          </div>

          {/* Cloud Firestore Synced Drafts */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-cyan-400" />
                Облачные черновики (Кроссплатформенная синхронизация)
              </span>
              {isAuthenticated && (
                <button
                  onClick={onSaveCloudDraftNow}
                  disabled={isSavingCloud}
                  className="px-3 py-1.5 text-xs font-medium bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {isSavingCloud ? 'Сохранение...' : 'Сохранить снимок в облако'}
                </button>
              )}
            </div>

            {!isAuthenticated ? (
              <div
                className={`p-4 rounded-lg border text-xs ${
                  darkTheme
                    ? 'bg-slate-950/50 border-slate-800 text-slate-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                Войдите через Google в верхней панели, чтобы синхронизировать черновики проекта и
                пользовательские пресеты между всеми вашими устройствами.
              </div>
            ) : cloudDrafts.length === 0 ? (
              <div
                className={`p-4 rounded-lg border text-xs ${
                  darkTheme
                    ? 'bg-slate-950/50 border-slate-800 text-slate-400'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                В облаке пока нет сохраненных черновиков. Нажмите «Сохранить снимок в облако», чтобы
                зафиксировать текущую конфигурацию проекта.
              </div>
            ) : (
              <div className="space-y-2">
                {cloudDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className={`p-3 rounded-lg border flex items-center justify-between gap-4 ${
                      darkTheme
                        ? 'bg-slate-950/70 border-slate-800'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{draft.projectName}</div>
                      <div
                        className={`text-xs mt-0.5 font-mono tabular-nums ${
                          darkTheme ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        {getModeLabel(draft.mode)} · {draft.trackName} ({draft.trackFormat}) ·{' '}
                        {new Date(draft.updatedAt).toLocaleString('ru-RU')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          onRestoreDraft(draft);
                          onClose();
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-800 text-slate-100 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                      >
                        Загрузить
                      </button>
                      <button
                        onClick={() => onDeleteCloudDraft(draft.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                        aria-label="Удалить черновик"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium border border-slate-700 rounded-lg hover:bg-slate-800/50 transition-colors whitespace-nowrap shrink-0"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  layout: WorkspaceLayoutConfig;
  onChangeLayout: (next: WorkspaceLayoutConfig) => void;
  onResetLayout: () => void;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  isOpen,
  onClose,
  layout,
  onChangeLayout,
  onResetLayout,
}) => {
  if (!isOpen) return null;

  const toggles: {
    key: keyof WorkspaceLayoutConfig;
    title: string;
    desc: string;
  }[] = [
    {
      key: 'showLeftPanel',
      title: 'Левая панель (Источники сигнала и пресеты)',
      desc: 'Загрузка MP3/WAV/FLAC, включение микрофона, список локальных и облачных пресетов',
    },
    {
      key: 'showRightPanel',
      title: 'Правая панель (Акустический и визуальный инспектор)',
      desc: 'Тонкая настройка чувствительности, сглаживания БПФ, баса, свечения и заметок проекта',
    },
    {
      key: 'showTimeline',
      title: 'Нижняя транспортная консоль',
      desc: 'Кнопки воспроизведения, паузы, перемотки аудиофайла и регулятор громкости',
    },
    {
      key: 'showMeters',
      title: 'Телеметрия спектра в реальном времени',
      desc: 'Индикаторы уровня dBFS, доминантной частоты (Гц) и распределения энергии НЧ/СЧ/ВЧ',
    },
    {
      key: 'autoHideControls',
      title: 'Ненавязчивый режим (Автоскрытие интерфейса)',
      desc: 'Автоматически скрывать панели через 2.8 секунды бездействия курсора мыши',
    },
    {
      key: 'swapSidebars',
      title: 'Поменять местами боковые панели',
      desc: 'Разместить инспектор параметров слева, а библиотеку пресетов и источников справа',
    },
    {
      key: 'darkTheme',
      title: 'Ночная студийная тема (Dark Mode)',
      desc: 'Глубокий темный фон с пониженной нагрузкой на зрение для работы в ночное время',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-modal-title"
    >
      <div
        className={`w-full max-w-xl rounded-xl border p-6 shadow-2xl ${
          layout.darkTheme
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <Layout className="w-5 h-5 text-amber-500" />
            <h2 id="workspace-modal-title" className="text-lg font-semibold tracking-tight">
              Настройка рабочего пространства
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          {toggles.map((item) => {
            const active = layout[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() =>
                  onChangeLayout({
                    ...layout,
                    [item.key]: !active,
                  })
                }
                className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-start justify-between gap-4 ${
                  layout.darkTheme
                    ? active
                      ? 'bg-slate-950 border-amber-500/40'
                      : 'bg-slate-950/40 border-slate-800'
                    : active
                    ? 'bg-amber-50/50 border-amber-500/40'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <div className="text-sm font-medium">{item.title}</div>
                  <div
                    className={`text-xs mt-0.5 ${
                      layout.darkTheme ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {item.desc}
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 border ${
                    active
                      ? 'bg-amber-500 border-amber-500 text-slate-950'
                      : 'border-slate-600 bg-transparent'
                  }`}
                >
                  {active && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onResetLayout}
            className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Сбросить по умолчанию
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            Применить конфигурацию
          </button>
        </div>
      </div>
    </div>
  );
};

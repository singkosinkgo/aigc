import { ArrowRight, ArrowUp, Check, ChevronDown, Clapperboard, Copy, Download, Film, Play, Plus, Scissors, Sparkles, Trash2, Upload, UserRound, Wand2, X } from 'lucide-react';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { PrimaryButton } from '../components/Controls';
import { generateVideo, getErrorMessage, getWorks, uploadImage, uploadMedia } from '../lib/api';
import { resultUrlsFromContent } from '../lib/shotParser';
import { effectiveStatusClass, effectiveStatusLabel, elapsedSinceCreated, isVideoReady, workVideoUrl } from '../lib/workStatus';
import type { Shot, Work } from '../types';
import imageEmpty from '../assets/image-empty.png';

interface Props {
  shots: Shot[];
  videoWorks: Work[];
  onShotsChange: (shots: Shot[]) => void;
  onVideoGenerated: (work: Work) => void;
}

interface ReferenceAsset {
  url: string;
  type: 'image' | 'video' | 'audio';
  name?: string;
  durationSeconds?: number;
}

interface GeneralTask {
  id: string;
  prompt: string;
  refs: ReferenceAsset[];
  duration: number;
  referenceMode: 'all' | 'firstLast';
}

const MIN_REFERENCE_VIDEO_SECONDS = 1.8;

function tryParseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractFailureReason(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractFailureReason).find(Boolean) || '';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const direct = record.message || record.detail || record.reason || record.error_message;
    if (typeof direct === 'string') return direct;
    return extractFailureReason(record.error) || extractFailureReason(record.data) || extractFailureReason(record.result);
  }
  return '';
}

function failureReason(work: Work) {
  if (work.status !== 'failed') return '';
  return extractFailureReason(tryParseJson(work.content)) || work.content || '未返回失败原因';
}

function shortReferenceVideoMessage(items: ReferenceAsset[]) {
  const shortItem = items.find((item) => item.type === 'video' && item.durationSeconds !== undefined && item.durationSeconds < MIN_REFERENCE_VIDEO_SECONDS);
  if (!shortItem) return '';
  const duration = shortItem.durationSeconds?.toFixed(1);
  return `参考视频「${shortItem.name || '未命名视频'}」时长 ${duration} 秒，Seedance 2.0 要求参考视频不少于 1.8 秒`;
}

function referenceTypeFromUrl(url: string): ReferenceAsset['type'] {
  if (/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/i.test(url)) return 'audio';
  return 'image';
}

function draftReferenceMode(value: string | undefined): 'all' | 'firstLast' {
  if (value === '首尾帧' || value === 'firstLast') return 'firstLast';
  return 'all';
}

function ResponsiveResultVideo({ src, compact = false }: { src: string; compact?: boolean }) {
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const isPortrait = orientation === 'portrait';
  const wrapperClass = compact
    ? isPortrait
      ? 'mx-auto h-[132px] w-[74px]'
      : 'h-[132px] w-full'
    : isPortrait
      ? 'mx-auto max-h-[560px] w-[min(68%,360px)]'
      : 'w-full';

  return (
    <div className={wrapperClass}>
      <video
        src={src}
        controls
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setOrientation(video.videoHeight > video.videoWidth ? 'portrait' : 'landscape');
        }}
        className={`${compact ? 'h-full' : isPortrait ? 'aspect-[9/16]' : 'aspect-video'} w-full rounded-[8px] bg-black object-contain`}
      />
    </div>
  );
}

export default function VideoPage({ shots, videoWorks, onShotsChange, onVideoGenerated }: Props) {
  const [mode, setMode] = useState<'general' | 'drama' | 'avatar'>('general');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [generalPrompt, setGeneralPrompt] = useState('');
  const [generalRefs, setGeneralRefs] = useState<ReferenceAsset[]>([]);
  const [generalDuration, setGeneralDuration] = useState(15);
  const [referenceMode, setReferenceMode] = useState<'all' | 'firstLast'>('all');
  const [dramaReferenceMode, setDramaReferenceMode] = useState<'all' | 'firstLast'>('all');
  const [copiedGeneralTasks, setCopiedGeneralTasks] = useState<GeneralTask[]>([]);
  const [generalResults, setGeneralResults] = useState<Record<string, Work | undefined>>({});
  const [dramaResults, setDramaResults] = useState<Record<string, Work | undefined>>({});
  const [dramaGenerating, setDramaGenerating] = useState<Record<string, number>>({});
  const [brokenDramaLinks, setBrokenDramaLinks] = useState<Set<number>>(new Set());
  const [generatingTaskId, setGeneratingTaskId] = useState('');
  const [generatingStartedAt, setGeneratingStartedAt] = useState<Record<string, number>>({});
  const [openDropdown, setOpenDropdown] = useState('');
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('水晶2');
  const [imageWorks, setImageWorks] = useState<Work[]>([]);
  const [visibleMaterialCount, setVisibleMaterialCount] = useState(4);
  const [directShots, setDirectShots] = useState<Shot[]>([
    {
      id: '01',
      title: '直接创作',
      duration_seconds: 5,
      description: '直接输入视频画面需求。',
      prompt: '',
      imageUrls: [],
      selected: true,
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const openVideoEditWorks = () => {
    localStorage.setItem('leapai:video-edit-entry', 'works');
    window.location.hash = 'edit';
  };

  const openVideoEditLocal = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    localStorage.setItem('leapai:video-edit-draft', JSON.stringify({
      url,
      name: file.name,
    }));
    window.location.hash = 'edit';
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode !== 'drama') return;
    setVisibleMaterialCount(4);
    void getWorks('image')
      .then((items) => setImageWorks(items.filter((work) => Boolean(work.file_url || work.thumbnail_url || resultUrlsFromContent(work.content)[0]))))
      .catch(() => setImageWorks([]));
  }, [mode]);

  useEffect(() => {
    const raw = localStorage.getItem('leapai:video-draft');
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        prompt?: string;
        referenceUrls?: string[];
        aspectRatio?: string;
        resolution?: string;
        mode?: string;
        duration?: number;
      };
      setMode('general');
      setGeneralPrompt(draft.prompt || '');
      setAspectRatio(draft.aspectRatio || '16:9');
      setResolution(draft.resolution || '720p');
      setReferenceMode(draftReferenceMode(draft.mode));
      if (typeof draft.duration === 'number' && Number.isFinite(draft.duration)) {
        setGeneralDuration(draft.duration);
      }
      setGeneralRefs((draft.referenceUrls || []).map((url) => ({
        url,
        type: referenceTypeFromUrl(url),
      })));
      setCopiedGeneralTasks([]);
      setGeneralResults({});
    } catch {
      // Ignore malformed drafts.
    } finally {
      localStorage.removeItem('leapai:video-draft');
    }
  }, []);

  useEffect(() => {
    if (!videoWorks.length) return;
    setGeneralResults((items) => {
      const next = { ...items };
      for (const work of videoWorks) {
        for (const [taskId, currentWork] of Object.entries(items)) {
          if (currentWork?.id === work.id) next[taskId] = work;
        }
      }
      return next;
    });
    setDramaResults((items) => {
      const next = { ...items };
      for (const work of videoWorks) {
        for (const [shotId, currentWork] of Object.entries(items)) {
          if (currentWork?.id === work.id) next[shotId] = work;
        }
      }
      return next;
    });
  }, [videoWorks]);

  const activeShots = shots.length ? shots : directShots;
  const hasScriptShots = shots.length > 0;
  const selected = activeShots.filter((shot) => shot.selected);
  const totalDuration = selected.reduce((sum, shot) => sum + shot.duration_seconds, 0);
  const tabs = [
    { key: 'general' as const, label: '通用', icon: Wand2 },
    { key: 'drama' as const, label: '微短剧', icon: Clapperboard },
    { key: 'avatar' as const, label: '数字人', icon: UserRound },
  ];
  const avatarItems = [
    { name: '水晶2', tone: 'from-blue-100 to-amber-100' },
    { name: '伦琴4', tone: 'from-slate-100 to-blue-100' },
    { name: '水晶', tone: 'from-rose-100 to-slate-100' },
    { name: '伦琴3', tone: 'from-white to-blue-100' },
    { name: '伦琴2', tone: 'from-emerald-50 to-amber-100' },
    { name: '伦琴AI', tone: 'from-blue-50 to-white' },
    { name: '咖姐', tone: 'from-zinc-900 to-zinc-700' },
    { name: '达人探店1', tone: 'from-cyan-100 to-blue-200' },
  ];

  const toggleShot = (id: string) => {
    const updater = (items: Shot[]) => items.map((shot) => (shot.id === id ? { ...shot, selected: !shot.selected } : shot));
    if (hasScriptShots) onShotsChange(updater(shots));
    else setDirectShots(updater(directShots));
  };

  const updateShot = (id: string, patch: Partial<Shot>) => {
    const updater = (items: Shot[]) => items.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot));
    if (hasScriptShots) onShotsChange(updater(shots));
    else setDirectShots(updater(directShots));
  };

  const addReference = async (id: string, files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    try {
      const urls = await Promise.all(Array.from(files).map((file) => uploadImage(file).then((result) => result.url)));
      const shot = activeShots.find((item) => item.id === id);
      if (shot) updateShot(id, { imageUrls: [...shot.imageUrls, ...urls] });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const imageWorkUrl = (work: Work) => work.file_url || work.thumbnail_url || resultUrlsFromContent(work.content)[0] || '';

  const droppedMaterialUrl = (event: DragEvent<HTMLElement>) => (
    event.dataTransfer.getData('application/x-leapai-image-url')
    || event.dataTransfer.getData('text/uri-list')
  );

  const dropDramaReference = (event: DragEvent<HTMLElement>, shot: Shot) => {
    event.preventDefault();
    if (event.dataTransfer.files.length) {
      void addReference(shot.id, event.dataTransfer.files);
      return;
    }
    const url = droppedMaterialUrl(event);
    if (url && !shot.imageUrls.includes(url)) updateShot(shot.id, { imageUrls: [...shot.imageUrls, url] });
  };

  const dropDramaFrame = (event: DragEvent<HTMLElement>, shot: Shot, index: number, role: 'first' | 'last') => {
    event.preventDefault();
    if (event.dataTransfer.files.length) {
      void uploadDramaFrame(index, role, event.dataTransfer.files);
      return;
    }
    const url = droppedMaterialUrl(event);
    if (url) updateDramaFrame(index, role, url);
  };

  const mediaTypeForFile = (file: File): ReferenceAsset['type'] => {
    const suffix = file.name.split('.').pop()?.toLowerCase() || '';
    if (file.type.startsWith('video/') || ['mp4', 'mov'].includes(suffix)) return 'video';
    if (file.type.startsWith('audio/') || ['mp3', 'wav', 'm4a'].includes(suffix)) return 'audio';
    return 'image';
  };

  const getMediaDuration = (file: File, type: ReferenceAsset['type']) => {
    if (type === 'image') return Promise.resolve(undefined);
    return new Promise<number | undefined>((resolve) => {
      const element = document.createElement(type === 'video' ? 'video' : 'audio');
      const objectUrl = URL.createObjectURL(file);
      element.preload = 'metadata';
      element.onloadedmetadata = () => {
        const duration = Number.isFinite(element.duration) ? element.duration : undefined;
        URL.revokeObjectURL(objectUrl);
        resolve(duration);
      };
      element.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(undefined);
      };
      element.src = objectUrl;
    });
  };

  const prepareGeneralRefs = async (files: FileList | null, currentRefs: ReferenceAsset[], currentReferenceMode: 'all' | 'firstLast') => {
    if (!files?.length) return;
    setError('');
    const prepared = await Promise.all(Array.from(files).map(async (file) => {
      const type = mediaTypeForFile(file);
      const suffix = file.name.split('.').pop()?.toLowerCase() || '';
      if (currentReferenceMode === 'firstLast' && type !== 'image') throw new Error('首尾帧模式只能上传图片');
      if (type === 'audio' && !['mp3', 'wav', 'm4a'].includes(suffix)) throw new Error('音频仅支持 MP3、WAV，m4a 会自动转为 mp3');
      if (type === 'video' && !['mp4', 'mov'].includes(suffix)) throw new Error('视频仅支持 MP4、MOV');
      if (type === 'audio' && file.size > 15 * 1024 * 1024) throw new Error('音频不能超过 15MB');
      if (type === 'video' && file.size > 50 * 1024 * 1024) throw new Error('视频不能超过 50MB');
      if (type === 'image' && file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
      const durationSeconds = await getMediaDuration(file, type);
      if (type === 'video' && durationSeconds !== undefined && durationSeconds < MIN_REFERENCE_VIDEO_SECONDS) {
        throw new Error(`参考视频「${file.name}」时长 ${durationSeconds.toFixed(1)} 秒，Seedance 2.0 要求参考视频不少于 1.8 秒`);
      }
      if (type === 'audio' && durationSeconds && durationSeconds > 15) throw new Error('单个音频时长不能超过 15 秒');
      return { file, type, name: file.name, durationSeconds };
    }));
    const planned = [...currentRefs, ...prepared.map((item) => ({ url: '', type: item.type, name: item.name, durationSeconds: item.durationSeconds }))];
    const imageCount = planned.filter((item) => item.type === 'image').length;
    const videoCount = planned.filter((item) => item.type === 'video').length;
    const audioCount = planned.filter((item) => item.type === 'audio').length;
    const message =
      (currentReferenceMode === 'firstLast' && imageCount > 2 && '首尾帧模式最多上传 2 张图片')
      || (videoCount > 3 && '视频最多上传 3 个')
      || (audioCount > 3 && '音频最多上传 3 个')
      || '';
    if (message) throw new Error(message);

    return Promise.all(prepared.map(async ({ file, type, durationSeconds }) => {
      const result = type === 'image'
        ? await uploadImage(file).then((item) => ({ ...item, type: 'image' as const }))
        : await uploadMedia(file);
      if (result.type === 'file') throw new Error('视频参考素材仅支持图片、视频和音频');
      return { url: result.url, type: result.type, name: file.name, durationSeconds };
    }));
  };

  const addGeneralRefs = async (files: FileList | null) => {
    try {
      const incoming = await prepareGeneralRefs(files, generalRefs, referenceMode);
      if (!incoming) return;
      setGeneralRefs((items) => [...items, ...incoming]);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const replaceFirstLastRef = async (
    index: number,
    files: FileList | null,
    currentRefs: ReferenceAsset[],
    setRefs: (updater: (items: ReferenceAsset[]) => ReferenceAsset[]) => void,
  ) => {
    const file = files?.[0];
    if (!file) return;
    setError('');
    try {
      const suffix = file.name.split('.').pop()?.toLowerCase() || '';
      if (!file.type.startsWith('image/') && !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(suffix)) {
        throw new Error('首尾帧模式只能上传图片');
      }
      if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
      const uploaded = await uploadImage(file);
      setRefs(() => {
        const next = currentRefs.filter((item) => item.type === 'image').slice(0, 2);
        next[index] = { url: uploaded.url, type: 'image', name: file.name };
        return next.filter((item) => item?.url);
      });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const updateReferenceMode = (nextMode: 'all' | 'firstLast') => {
    setReferenceMode(nextMode);
    if (nextMode === 'firstLast') {
      setGeneralRefs((items) => items.filter((item) => item.type === 'image').slice(0, 2));
    }
  };

  const addCopiedGeneralRefs = async (taskId: string, files: FileList | null) => {
    const task = copiedGeneralTasks.find((item) => item.id === taskId);
    if (!task) return;
    try {
      const incoming = await prepareGeneralRefs(files, task.refs, task.referenceMode);
      if (!incoming) return;
      setCopiedGeneralTasks((items) => items.map((item) => (
        item.id === taskId ? { ...item, refs: [...item.refs, ...incoming] } : item
      )));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const updateCopiedGeneralTask = (taskId: string, patch: Partial<Omit<GeneralTask, 'id'>>) => {
    setCopiedGeneralTasks((items) => items.map((item) => (item.id === taskId ? { ...item, ...patch } : item)));
  };

  const copyGeneralTask = (task: Omit<GeneralTask, 'id'>) => {
    setCopiedGeneralTasks((items) => [
      ...items,
      {
        ...task,
        id: `${Date.now()}-${items.length}`,
        refs: task.refs.map((item) => ({ ...item })),
      },
    ]);
  };

  const addEmptyGeneralTask = () => {
    setCopiedGeneralTasks((items) => [
      ...items,
      {
        id: `${Date.now()}-${items.length}`,
        prompt: '',
        refs: [],
        duration: generalDuration,
        referenceMode,
      },
    ]);
  };

  const deleteGeneralTask = (idPrefix: string) => {
    if (idPrefix === 'general') {
      if (copiedGeneralTasks.length === 0) {
        setGeneralPrompt('');
        setGeneralRefs([]);
        setGeneralResults((items) => {
          const next = { ...items };
          delete next.general;
          return next;
        });
        return;
      }
      const [nextTask, ...restTasks] = copiedGeneralTasks;
      setGeneralResults((items) => {
        const next: Record<string, Work | undefined> = { ...items, general: items[nextTask.id] };
        delete next[nextTask.id];
        return next;
      });
      setGeneralPrompt(nextTask.prompt);
      setGeneralRefs(nextTask.refs);
      setGeneralDuration(nextTask.duration);
      updateReferenceMode(nextTask.referenceMode);
      setCopiedGeneralTasks(restTasks);
      return;
    }
    setCopiedGeneralTasks((items) => items.filter((item) => item.id !== idPrefix));
    setGeneralResults((items) => {
      const next = { ...items };
      delete next[idPrefix];
      return next;
    });
  };

  const renderInlineDropdown = <T extends string | number,>({
    id,
    value,
    options,
    onChange,
  }: {
    id: string;
    value: T;
    options: Array<{ value: T; label: string }>;
    onChange: (nextValue: T) => void;
  }) => {
    const active = options.find((option) => option.value === value);
    const isOpen = openDropdown === id;

    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenDropdown(isOpen ? '' : id)}
          className={`flex h-10 w-full items-center justify-between rounded-[4px] border bg-white px-3 text-left text-sm font-semibold text-ink shadow-none transition ${
            isOpen ? 'border-primary ring-2 ring-primary/10' : 'border-[rgba(120,145,190,0.28)] hover:border-primary/50'
          }`}
        >
          <span>{active?.label}</span>
          <ChevronDown size={16} className={`text-ink/35 transition ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen ? (
          <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-full overflow-hidden rounded-[6px] bg-white py-1 shadow-[0_10px_28px_rgba(31,43,77,0.14)] ring-1 ring-[rgba(120,145,190,0.18)]">
            {options.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpenDropdown('');
                }}
                className={`block h-9 w-full px-3 text-left text-sm font-semibold transition ${
                  option.value === value ? 'bg-[#E8F7FF] text-ink' : 'text-ink/75 hover:bg-[#F2F8FF]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderAssetPreview = (asset: ReferenceAsset) => (
    <div className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-50 hidden -translate-x-1/2 overflow-hidden rounded-[10px] bg-white p-2 shadow-[0_18px_48px_rgba(23,35,61,0.22)] ring-1 ring-blue-100 group-hover:block">
      {asset.type === 'video' ? (
        <video src={asset.url} muted autoPlay loop playsInline className="max-h-[260px] w-[220px] rounded-[8px] bg-black object-contain" />
      ) : asset.type === 'audio' ? (
        <div className="flex h-28 w-56 items-center justify-center rounded-[8px] bg-blue-50 text-sm font-black text-primary">音频素材</div>
      ) : (
        <img src={asset.url} className="max-h-[260px] w-[220px] rounded-[8px] object-contain" />
      )}
    </div>
  );

  const renderUploadedThumb = (url: string, onRemove: () => void, sizeClass = 'h-16 w-16') => (
    <div key={url} className="group relative">
      <div className={`relative ${sizeClass} overflow-hidden rounded-[8px]`}>
        <img src={url} className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/75 group-hover:opacity-100"
          aria-label="删除图片"
        >
          <X size={12} />
        </button>
      </div>
      {renderAssetPreview({ url, type: 'image' })}
    </div>
  );

  const addDirectShot = () => {
    const nextIndex = directShots.length + 1;
    setDirectShots([
      ...directShots,
      {
        id: `${nextIndex}`.padStart(2, '0'),
        title: `段落 ${nextIndex}`,
        duration_seconds: 5,
        description: '直接输入视频画面需求。',
        prompt: '',
        imageUrls: [],
        selected: true,
      },
    ]);
  };

  const createDramaShotId = () => (
    `${Math.max(0, ...activeShots.map((item) => Number.parseInt(item.id, 10) || 0)) + 1}`.padStart(2, '0')
  );

  const insertDramaShot = (index: number, source?: Shot) => {
    const nextId = createDramaShotId();
    const nextShot: Shot = source ? {
      ...source,
      id: nextId,
      title: `${source.title || '段落'}（副本）`,
      imageUrls: [...source.imageUrls],
      selected: true,
    } : {
      id: nextId,
      title: `段落 ${nextId}`,
      duration_seconds: activeShots[index]?.duration_seconds || 5,
      description: '直接输入视频画面需求。',
      prompt: '',
      imageUrls: [],
      selected: true,
    };
    const nextShots = [...activeShots];
    nextShots.splice(index + 1, 0, nextShot);
    if (hasScriptShots) onShotsChange(nextShots);
    else setDirectShots(nextShots);
    setBrokenDramaLinks(new Set());
  };

  const deleteDramaShot = (index: number, shot: Shot) => {
    if (activeShots.length === 1) {
      updateShot(shot.id, { prompt: '', imageUrls: [] });
    } else {
      const nextShots = activeShots.filter((_, itemIndex) => itemIndex !== index);
      if (hasScriptShots) onShotsChange(nextShots);
      else setDirectShots(nextShots);
    }
    setDramaResults((items) => {
      const next = { ...items };
      delete next[shot.id];
      return next;
    });
    setDramaGenerating((items) => {
      const next = { ...items };
      delete next[shot.id];
      return next;
    });
    setBrokenDramaLinks(new Set());
  };

  const frameUrl = (shot: Shot, role: 'first' | 'last') => shot.imageUrls[role === 'first' ? 0 : 1] || '';

  const updateDramaFrame = (index: number, role: 'first' | 'last', url: string) => {
    const nextShots = activeShots.map((item) => ({ ...item, imageUrls: item.imageUrls.slice(0, 2) }));
    const shot = nextShots[index];
    if (!shot) return;
    shot.imageUrls[role === 'first' ? 0 : 1] = url;

    if (role === 'last' && index < nextShots.length - 1 && !brokenDramaLinks.has(index)) {
      nextShots[index + 1].imageUrls[0] = url;
    }
    if (role === 'first' && index > 0 && !brokenDramaLinks.has(index - 1)) {
      nextShots[index - 1].imageUrls[1] = url;
    }

    if (hasScriptShots) onShotsChange(nextShots);
    else setDirectShots(nextShots);
  };

  const uploadDramaFrame = async (index: number, role: 'first' | 'last', files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError('');
    try {
      if (!file.type.startsWith('image/')) throw new Error('首尾帧只能上传图片');
      const result = await uploadImage(file);
      updateDramaFrame(index, role, result.url);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const unlinkDramaFrames = (index: number) => {
    setBrokenDramaLinks((items) => new Set(items).add(index));
  };

  const buildDramaSegment = (shot: Shot) => ({
    title: shot.title,
    duration_seconds: shot.duration_seconds,
    prompt: shot.prompt,
    image_urls: dramaReferenceMode === 'all' ? shot.imageUrls.filter((url) => url.startsWith('http')) : [],
    image_inputs: dramaReferenceMode === 'firstLast'
      ? [
        frameUrl(shot, 'first') ? {
          type: 'image_url',
          image_url: { url: frameUrl(shot, 'first') },
          role: 'first_frame' as const,
        } : null,
        frameUrl(shot, 'last') ? {
          type: 'image_url',
          image_url: { url: frameUrl(shot, 'last') },
          role: 'last_frame' as const,
        } : null,
      ].filter(Boolean) as Array<{ type: 'image_url'; image_url: { url: string }; role: 'first_frame' | 'last_frame' }>
      : undefined,
  });

  const generateDramaShot = async (shot: Shot, index: number) => {
    if (dramaGenerating[shot.id]) return;
    setError('');
    setDramaGenerating((items) => ({ ...items, [shot.id]: Date.now() }));
    try {
      const result = await generateVideo({
        aspect_ratio: aspectRatio,
        resolution,
        segments: [buildDramaSegment(shot)],
      });
      setDramaResults((items) => ({ ...items, [shot.id]: result.work }));
      onVideoGenerated(result.work);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      const failedWork: Work = {
        id: -Date.now() - index,
        user_id: 0,
        title: '生成视频',
        type: 'video',
        prompt: shot.prompt || null,
        content: JSON.stringify({ error: { message } }),
        file_url: null,
        thumbnail_url: null,
        model_id: null,
        status: 'failed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setDramaResults((items) => ({ ...items, [shot.id]: failedWork }));
      onVideoGenerated(failedWork);
    } finally {
      setDramaGenerating((items) => {
        const next = { ...items };
        delete next[shot.id];
        return next;
      });
    }
  };

  const handleGenerate = async () => {
    setError('');
    setLoading(true);
    await Promise.all(selected.map((shot, index) => dramaGenerating[shot.id] ? Promise.resolve() : generateDramaShot(shot, index)));
    setLoading(false);
  };

  const getVideoUrl = (work: Work) => {
    return workVideoUrl(work);
  };

  const handleDownloadVideo = async (work: Work, index = 0) => {
    const url = getVideoUrl(work);
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `video-${index + 1}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `video-${index + 1}.mp4`;
      anchor.target = '_blank';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  };

  const handleDownloadAllVideos = () => {
    Object.values(generalResults).filter((work): work is Work => Boolean(work)).forEach((work, index) => {
      setTimeout(() => void handleDownloadVideo(work, index), index * 180);
    });
  };

  const handleGenerateGeneral = async (taskId = 'general', task?: Omit<GeneralTask, 'id'>) => {
    const currentPrompt = task?.prompt ?? generalPrompt;
    const currentRefs = task?.refs ?? generalRefs;
    const currentDuration = task?.duration ?? generalDuration;
    const currentReferenceMode = task?.referenceMode ?? referenceMode;
    setError('');
    const shortVideoMessage = shortReferenceVideoMessage(currentRefs);
    if (currentReferenceMode === 'all' && shortVideoMessage) {
      setError(shortVideoMessage);
      return;
    }
    const mediaDuration = currentRefs.reduce((sum, item) => sum + (item.type === 'video' || item.type === 'audio' ? item.durationSeconds || 0 : 0), 0);
    if (currentReferenceMode === 'all' && mediaDuration > 0 && mediaDuration < 2) {
      setError('视频和音频合计时长需至少 2 秒');
      return;
    }
    setGeneratingTaskId(taskId);
    setGeneratingStartedAt((items) => ({ ...items, [taskId]: Date.now() }));
    setLoading(true);
    try {
      const result = await generateVideo({
        aspect_ratio: aspectRatio,
        resolution,
        segments: [
          {
            title: '通用视频',
            duration_seconds: currentDuration,
            prompt: currentPrompt,
            image_urls: currentReferenceMode === 'all'
              ? currentRefs.filter((item) => item.type === 'image' && item.url.startsWith('http')).map((item) => item.url)
              : [],
            image_inputs: currentReferenceMode === 'firstLast'
              ? currentRefs.filter((item) => item.type === 'image' && item.url.startsWith('http')).slice(0, 2).map((item, index) => ({
                type: 'image_url',
                image_url: { url: item.url },
                role: index === 0 ? 'first_frame' : 'last_frame',
              }))
              : undefined,
            video_urls: currentReferenceMode === 'all' ? currentRefs.filter((item) => item.type === 'video').map((item) => item.url) : [],
            audio_urls: currentReferenceMode === 'all' ? currentRefs.filter((item) => item.type === 'audio').map((item) => item.url) : [],
          },
        ],
      });
      setGeneralResults((items) => ({ ...items, [taskId]: result.work }));
      onVideoGenerated(result.work);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      const failedWork: Work = {
        id: -Date.now(),
        user_id: 0,
        title: '生成视频',
        type: 'video',
        prompt: currentPrompt || null,
        content: JSON.stringify({ error: { message } }),
        file_url: null,
        thumbnail_url: null,
        model_id: null,
        status: 'failed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setGeneralResults((items) => ({ ...items, [taskId]: failedWork }));
      onVideoGenerated(failedWork);
    } finally {
      setLoading(false);
      setGeneratingTaskId('');
    }
  };

  const renderVideoEmpty = (title: string, desc: string) => (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <img src={imageEmpty} className="h-[368px] w-[368px] object-contain" />
      <div className="mt-7 text-xl font-black text-ink">{title}</div>
      <div className="mt-3 text-sm font-semibold text-ink/50">{desc}</div>
    </div>
  );

  const renderGeneratingPanel = (startedAt?: number) => {
    const elapsedSeconds = Math.max(0, Math.floor(((now || Date.now()) - (startedAt || Date.now())) / 1000));
    const progress = Math.min(92, Math.max(18, 32 + Math.floor(elapsedSeconds * 1.5)));
    const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
    const steps = [
      { label: '分析素材', done: true },
      { label: '构思视频', done: true },
      { label: '生成视频', done: false },
      { label: '检查视频', done: false },
    ];
    return (
    <div className="relative flex min-h-[620px] flex-1 overflow-hidden rounded-[8px] bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.98),rgba(247,251,255,0.92)_42%,rgba(240,246,255,0.72)_100%)] text-center">
      <div className="absolute inset-0">
        <div className="absolute left-[12%] top-[14%] h-32 w-32 rounded-full bg-blue-200/20 blur-3xl" />
        <div className="absolute bottom-[10%] right-[10%] h-40 w-40 rounded-full bg-violet-200/25 blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-[780px] flex-col items-center justify-center px-8 py-10">
        <div className="relative h-[260px] w-[420px]">
          <div className="absolute left-1/2 top-[46%] h-[126px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-[#7DBBFF]/45 opacity-80 orbit-spin" style={{ '--orbit-angle': '-8deg' } as React.CSSProperties} />
          <div className="absolute left-1/2 top-[46%] h-[154px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-[#7A6CFF]/35 opacity-75 orbit-counter-spin" style={{ '--orbit-angle': '14deg' } as React.CSSProperties} />
          <div className="absolute left-1/2 top-[55%] h-[50px] w-[250px] -translate-x-1/2 rounded-[50%] bg-gradient-to-r from-transparent via-[#7DBBFF]/45 to-transparent blur-[1px]" />
          <div className="absolute left-[19%] top-[33%] h-11 w-11 rounded-full bg-[radial-gradient(circle_at_35%_30%,white,#DCEBFF_55%,#AFC7FF)] opacity-80 shadow-[0_10px_24px_rgba(47,128,255,0.12)] crystal-float" />
          <div className="absolute right-[22%] top-[20%] h-12 w-12 rounded-full bg-[radial-gradient(circle_at_35%_30%,white,#EAF1FF_58%,#C7D6FF)] opacity-80 shadow-[0_10px_24px_rgba(47,128,255,0.12)] crystal-float" style={{ animationDelay: '-1.2s' }} />
          <div className="absolute right-[14%] bottom-[24%] h-9 w-9 rounded-full bg-[radial-gradient(circle_at_35%_30%,white,#E6F6FF_60%,#9ED8FF)] opacity-85 shadow-[0_10px_24px_rgba(47,128,255,0.12)] crystal-float" style={{ animationDelay: '-2s' }} />
          <div className="absolute left-1/2 top-[45%] flex h-36 w-36 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[radial-gradient(circle_at_34%_26%,#FFFFFF_0%,#EEF5FF_36%,#BFD4FF_68%,#7DBBFF_100%)] shadow-[inset_-18px_-18px_36px_rgba(47,128,255,0.16),inset_16px_16px_34px_rgba(255,255,255,0.95),0_22px_54px_rgba(47,128,255,0.18)] crystal-float">
            <div className="absolute inset-5 rounded-full border border-white/70" />
            <div className="absolute right-8 top-7 h-8 w-12 rounded-full bg-white/55 blur-sm" />
            <Sparkles size={42} className="relative z-10 text-[#6B8CFF]" />
          </div>
        </div>
        <div className="text-3xl font-black text-primary">AI 正在创作中</div>
        <div className="mt-4 text-base font-black text-ink/45">灵感正在生成画面，请稍候片刻...</div>
        <div className="mt-7 text-base font-black text-ink">{progress}%</div>
        <div className="mt-5 h-2 w-[330px] overflow-hidden rounded-full bg-blue-100">
          <div className="relative h-full rounded-full bg-gradient-to-r from-primary to-[#7A6CFF]" style={{ width: `${progress}%` }}>
            <span className="shimmer-slide absolute inset-y-0 w-20 bg-white/35 blur-sm" />
          </div>
        </div>
        <div className="mt-12 grid w-full max-w-[520px] grid-cols-4 items-start gap-2">
          {steps.map((step, index) => (
            <div key={step.label} className="relative flex flex-col items-center">
              {index > 0 ? <span className="absolute left-[-50%] top-5 h-px w-full bg-gradient-to-r from-transparent via-blue-200 to-transparent" /> : null}
              <span className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border text-lg font-black shadow-[0_10px_24px_rgba(47,128,255,0.12)] ${step.done ? 'border-primary bg-primary text-white' : index === 2 ? 'border-[#7A6CFF] bg-white text-[#7A6CFF]' : 'border-blue-100 bg-white text-ink/35'}`}>
                {step.done ? <Check size={22} /> : index === 2 ? <Sparkles size={18} /> : <ArrowUp size={18} />}
              </span>
              <span className={`mt-3 text-xs font-black ${step.done || index === 2 ? 'text-ink/55' : 'text-ink/35'}`}>{step.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-10 text-base font-black text-ink/45">已生成时间：<span className="text-ink/55">{elapsedLabel}</span></div>
      </div>
    </div>
    );
  };

  const renderGeneralResult = (work: Work | undefined, isGenerating = false, startedAt?: number) => {
    if (isGenerating) return renderGeneratingPanel(startedAt);
    if (!work) return renderVideoEmpty('生成结果将显示在这里', '在左侧输入描述并设置参数，点击“生成视频”开始创作吧～');
    const url = getVideoUrl(work);
    const reason = failureReason(work);
    if (url && isVideoReady(work)) return <ResponsiveResultVideo src={url} />;
    if (work.status !== 'failed') return renderGeneratingPanel(new Date(work.created_at).getTime());
    return (
      <div className="flex aspect-video flex-col items-center justify-center rounded-[8px] bg-blue-50 text-center text-blue-300">
        <Play size={50} />
        <div className={`mt-4 text-base font-black ${effectiveStatusClass(work)}`}>{effectiveStatusLabel(work)}</div>
        {reason ? (
          <div className="mt-3 max-w-[86%] rounded-[8px] bg-red-50 px-4 py-3 text-left text-xs font-semibold leading-5 text-[#E57373]">
            <span className="font-black">失败原因：</span>{reason}
          </div>
        ) : (
          <div className="mt-2 text-sm font-semibold text-ink/45">{elapsedSinceCreated(work, now)}</div>
        )}
      </div>
    );
  };

  const renderDramaResult = (work: Work | undefined, index: number, isGenerating = false, startedAt?: number) => {
    if (isGenerating) {
      return (
        <div className="flex h-[132px] flex-col items-center justify-center rounded-[8px] px-3 text-center">
          <Sparkles size={30} className="animate-pulse text-primary" />
          <div className="mt-2 text-sm font-black text-primary">生成中</div>
          <div className="mt-1 text-xs font-semibold text-ink/45">{elapsedSinceCreated({ created_at: new Date(startedAt || Date.now()).toISOString(), status: 'processing' } as Work, now)}</div>
        </div>
      );
    }
    if (!work) {
      return (
        <div className="flex h-[132px] flex-col items-center justify-center rounded-[8px] text-center text-ink/45">
          <img src={imageEmpty} className="h-24 w-24 object-contain" />
          <div className="mt-1 text-xs font-bold">生成结果</div>
        </div>
      );
    }
    const url = getVideoUrl(work);
    const reason = failureReason(work);
    if (url && isVideoReady(work)) {
      return <ResponsiveResultVideo src={url} compact />;
    }
    return (
      <div className="flex h-[132px] flex-col items-center justify-center rounded-[8px] px-3 text-center">
        <Play size={34} className="text-blue-300" />
        <div className={`mt-2 text-sm font-black ${effectiveStatusClass(work)}`}>{effectiveStatusLabel(work)}</div>
        {reason ? (
          <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-[#E57373]">{reason}</div>
        ) : (
          <div className="mt-1 text-xs font-semibold text-ink/45">视频 {index + 1}</div>
        )}
      </div>
    );
  };

  const renderDramaFrameCard = (shot: Shot, index: number, role: 'first' | 'last') => {
    const label = role === 'first' ? '首帧' : '尾帧';
    const url = frameUrl(shot, role);
    return (
      <div className="relative">
        <div className="mb-2 text-center text-sm font-black text-ink">{label}</div>
        <label
          className="relative flex h-[92px] w-[92px] cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-dashed border-blue-200 bg-white/70 text-primary transition hover:border-primary hover:bg-blue-50"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            dropDramaFrame(event, shot, index, role);
          }}
        >
          {url ? (
            <img src={url} className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm font-black">
              <Plus size={24} />
              上传{label}
            </div>
          )}
          <input
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            type="file"
            accept="image/*"
            onChange={(event) => {
              void uploadDramaFrame(index, role, event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </label>
      </div>
    );
  };

  const renderGeneralTask = ({
    idPrefix,
    prompt,
    refs,
    duration,
    taskReferenceMode,
    setPrompt,
    setRefs,
    setDuration,
    setTaskReferenceMode,
    addRefs,
  }: {
    idPrefix: string;
    prompt: string;
    refs: ReferenceAsset[];
    duration: number;
    taskReferenceMode: 'all' | 'firstLast';
    setPrompt: (value: string) => void;
    setRefs: (updater: (items: ReferenceAsset[]) => ReferenceAsset[]) => void;
    setDuration: (value: number) => void;
    setTaskReferenceMode: (value: 'all' | 'firstLast') => void;
    addRefs: (files: FileList | null) => void;
  }) => (
      <section className="glass-panel flex min-h-[calc(100vh-170px)] flex-col rounded-[8px] p-5">
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="grid grid-cols-4 gap-3">
            {renderInlineDropdown({
              id: `${idPrefix}-referenceMode`,
              value: taskReferenceMode,
              onChange: (nextMode) => {
                setTaskReferenceMode(nextMode);
                if (nextMode === 'firstLast') setRefs((items) => items.filter((item) => item.type === 'image').slice(0, 2));
              },
              options: [
                { value: 'all', label: '全能参考' },
                { value: 'firstLast', label: '首尾帧' },
              ],
            })}
            {renderInlineDropdown({
              id: `${idPrefix}-duration`,
              value: duration,
              onChange: setDuration,
              options: [
                { value: 4, label: '4秒' },
                { value: 6, label: '6秒' },
                { value: 8, label: '8秒' },
                { value: 10, label: '10秒' },
                { value: 12, label: '12秒' },
                { value: 15, label: '15秒' },
              ],
            })}
            {renderInlineDropdown({
              id: `${idPrefix}-ratio`,
              value: aspectRatio,
              onChange: setAspectRatio,
              options: [
                { value: '16:9', label: '横屏16:9' },
                { value: '9:16', label: '竖屏9:16' },
                { value: '1:1', label: '方形1:1' },
              ],
            })}
            {renderInlineDropdown({
              id: `${idPrefix}-resolution`,
              value: resolution,
              onChange: setResolution,
              options: [
                { value: '720p', label: '720P' },
                { value: '1080p', label: '1080P' },
              ],
            })}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between text-sm font-black text-ink">
              <span>参考素材</span>
              <span className="font-semibold text-ink/50">{refs.filter((item) => item.url).length}/{taskReferenceMode === 'firstLast' ? 2 : 10}</span>
            </div>
            {taskReferenceMode === 'firstLast' ? (
              <div className="flex flex-wrap items-center gap-4">
                {(['首帧', '尾帧'] as const).map((label, index) => {
                  const asset = refs.filter((item) => item.type === 'image')[index];
                  return (
                    <label key={label} className="relative flex aspect-square h-[112px] w-[112px] cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-dashed border-blue-200 bg-white/70 text-primary transition hover:border-primary hover:bg-blue-50">
                      {asset?.url ? (
                        <>
                          <img src={asset.url} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              setRefs((items) => items.filter((item, itemIndex) => item.type !== 'image' || itemIndex !== index));
                            }}
                            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75"
                            aria-label={`删除${label}`}
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-sm font-black">
                          <Plus size={24} />
                          {label}
                        </div>
                      )}
                      <span className="absolute bottom-2 left-2 rounded-[4px] bg-primary/90 px-2 py-0.5 text-xs font-black text-white">{label}</span>
                      <input
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          void replaceFirstLastRef(index, event.target.files, refs, setRefs);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <label className="upload-box relative flex h-[112px] w-[112px] shrink-0 cursor-pointer items-center justify-center overflow-hidden text-primary transition hover:border-primary hover:bg-blue-50">
                  <Plus size={24} />
                  <input
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                    type="file"
                    accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4,.mp3,.wav,.m4a,.mp4,.mov"
                    multiple
                    onChange={(event) => {
                      addRefs(event.target.files);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {refs.map((asset) => (
                    <div key={asset.url} className="relative">
                      {asset.type === 'image' ? (
                        renderUploadedThumb(asset.url, () => setRefs((items) => items.filter((item) => item.url !== asset.url)), 'h-[112px] w-[112px]')
                      ) : (
                        <div className="group relative">
                          <div className="relative flex h-[112px] w-[112px] items-center justify-center overflow-hidden rounded-[8px] bg-blue-50 text-xs font-black text-primary">
                            {asset.type === 'video' ? '视频' : '音频'}
                            <button
                              type="button"
                              onClick={() => setRefs((items) => items.filter((item) => item.url !== asset.url))}
                              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/75 group-hover:opacity-100"
                              aria-label="删除素材"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          {renderAssetPreview(asset)}
                        </div>
                      )}
                      <span className="absolute bottom-1 left-1 rounded-[4px] bg-black/65 px-1.5 py-0.5 text-[10px] font-black text-white">
                        {asset.type === 'image' ? '图片' : asset.type === 'video' ? '视频' : '音频'}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 text-sm font-black text-ink">提示词</div>
            <div className="relative min-h-[150px] flex-1 overflow-hidden">
              <textarea
                ref={(node) => {
                  if (idPrefix === 'general') promptTextareaRef.current = node;
                }}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={9999}
                className="absolute inset-0 block h-full min-h-[150px] w-full resize-none overflow-y-auto rounded-[8px] border border-blue-100 bg-white/70 p-4 pr-24 text-sm font-semibold leading-6 outline-none focus:border-primary"
                placeholder="请输入您想要生成的视频描述..."
              />
              <span className="absolute bottom-4 right-4 text-right text-sm font-bold text-ink/50">{prompt.length}/9999</span>
            </div>
          </div>

        </div>
        <div className="mt-5 flex shrink-0 items-center justify-between">
          <PrimaryButton disabled={!prompt.trim() || loading} onClick={() => void handleGenerateGeneral(idPrefix, { prompt, refs, duration, referenceMode: taskReferenceMode })}>
            {loading ? '生成中...' : '生成视频'} <Sparkles size={18} />
          </PrimaryButton>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => deleteGeneralTask(idPrefix)}
              className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary"
              title="删除任务"
              aria-label="删除任务"
            >
              <Trash2 size={18} />
            </button>
            <button
              type="button"
              onClick={addEmptyGeneralTask}
              className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary"
              title="添加任务"
              aria-label="添加任务"
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              onClick={() => copyGeneralTask({ prompt, refs, duration, referenceMode: taskReferenceMode })}
              className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary"
              title="复制任务"
              aria-label="复制任务"
            >
              <Copy size={18} />
            </button>
          </div>
        </div>
      </section>
  );

  const renderGeneralResultPanel = (taskId: string) => (
      <section className="glass-panel flex min-h-[calc(100vh-170px)] flex-col rounded-[8px] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black text-black">生成结果</h2>
          <button type="button" onClick={handleDownloadAllVideos} disabled={!Object.values(generalResults).some((work) => work && isVideoReady(work))} className="secondary-button flex h-11 items-center justify-center gap-2 px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50">
            <Download size={16} /> 全部下载
          </button>
        </div>
        {renderGeneralResult(generalResults[taskId], loading && generatingTaskId === taskId, generatingStartedAt[taskId])}
      </section>
  );

  const renderGeneral = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 items-stretch gap-5">
        {renderGeneralTask({
          idPrefix: 'general',
          prompt: generalPrompt,
          refs: generalRefs,
          duration: generalDuration,
          taskReferenceMode: referenceMode,
          setPrompt: setGeneralPrompt,
          setRefs: setGeneralRefs,
          setDuration: setGeneralDuration,
          setTaskReferenceMode: updateReferenceMode,
          addRefs: (files) => void addGeneralRefs(files),
        })}
        {renderGeneralResultPanel('general')}
      </div>
      {copiedGeneralTasks.map((task) => (
        <div key={task.id} className="grid grid-cols-2 items-stretch gap-5">
          {renderGeneralTask({
            idPrefix: task.id,
            prompt: task.prompt,
            refs: task.refs,
            duration: task.duration,
            taskReferenceMode: task.referenceMode,
            setPrompt: (value) => updateCopiedGeneralTask(task.id, { prompt: value }),
            setRefs: (updater) => {
              setCopiedGeneralTasks((items) => items.map((item) => (
                item.id === task.id ? { ...item, refs: updater(item.refs) } : item
              )));
            },
            setDuration: (value) => updateCopiedGeneralTask(task.id, { duration: value }),
            setTaskReferenceMode: (value) => updateCopiedGeneralTask(task.id, { referenceMode: value }),
            addRefs: (files) => void addCopiedGeneralRefs(task.id, files),
          })}
          {renderGeneralResultPanel(task.id)}
        </div>
      ))}
    </div>
  );

  const renderDrama = () => (
    <div className="grid grid-cols-[minmax(0,1fr)_280px] items-start gap-5">
      <div className="min-w-0 space-y-5">
      <section className="glass-panel relative z-40 overflow-visible rounded-[8px] p-5">
        <div className="grid max-w-[760px] grid-cols-4 gap-3">
          {renderInlineDropdown({
            id: 'drama-referenceMode',
            value: dramaReferenceMode,
            onChange: (value) => setDramaReferenceMode(value === 'firstLast' ? 'firstLast' : 'all'),
            options: [
              { value: 'all', label: '全能参考' },
              { value: 'firstLast', label: '首尾帧' },
            ],
          })}
          {renderInlineDropdown({
            id: 'drama-duration',
            value: activeShots[0]?.duration_seconds || 5,
            onChange: (value) => {
              const nextDuration = Number(value);
              if (hasScriptShots) onShotsChange(shots.map((shot) => ({ ...shot, duration_seconds: nextDuration })));
              else setDirectShots((items) => items.map((shot) => ({ ...shot, duration_seconds: nextDuration })));
            },
            options: [
              { value: 5, label: '5秒' },
              { value: 10, label: '10秒' },
              { value: 15, label: '15秒' },
              { value: 30, label: '30秒' },
            ],
          })}
          {renderInlineDropdown({
            id: 'drama-ratio',
            value: aspectRatio,
            onChange: setAspectRatio,
            options: [
              { value: '16:9', label: '横屏16:9' },
              { value: '9:16', label: '竖屏9:16' },
              { value: '1:1', label: '方形1:1' },
            ],
          })}
          {renderInlineDropdown({
            id: 'drama-resolution',
            value: resolution,
            onChange: setResolution,
            options: [
              { value: '720p', label: '720P' },
              { value: '1080p', label: '1080P' },
            ],
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6">
        <section className="glass-panel rounded-[8px]">
          <div>
            {activeShots.map((shot, index) => (
              <article key={shot.id} className="relative grid grid-cols-[220px_minmax(240px,1fr)_52px_220px] items-start gap-3 border-b border-blue-50 px-4 py-4">
                <div className="col-start-2 row-start-1">
                  <div className="flex h-8 items-center justify-between">
                    <div className="inline-flex h-8 items-center gap-3 rounded-full bg-blue-50 px-4 text-sm font-black text-ink">
                      <span>{index + 1}</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={shot.duration_seconds}
                        onChange={(event) => updateShot(shot.id, { duration_seconds: Number(event.target.value) })}
                        className="w-10 bg-transparent text-center text-sm font-black text-ink outline-none"
                      />
                      <span>秒</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => deleteDramaShot(index, shot)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="删除任务" aria-label="删除任务">
                        <Trash2 size={17} />
                      </button>
                      <button type="button" onClick={() => insertDramaShot(index)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="添加任务" aria-label="添加任务">
                        <Plus size={17} />
                      </button>
                      <button type="button" onClick={() => insertDramaShot(index, shot)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="复制任务" aria-label="复制任务">
                        <Copy size={17} />
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={shot.prompt}
                    onChange={(event) => updateShot(shot.id, { prompt: event.target.value })}
                    className="mt-3 h-24 w-full resize-none rounded-[8px] border border-blue-100 p-3 text-sm font-semibold leading-6 text-ink/70 outline-none focus:border-primary"
                    placeholder="请输入视频提示词、运镜、旁白、音效"
                  />
                </div>
                <div className="relative col-start-1 row-start-1 flex min-h-[144px] items-start justify-center gap-6 pt-1">
                  {dramaReferenceMode === 'firstLast' ? (
                    <>
                      {renderDramaFrameCard(shot, index, 'first')}
                      {renderDramaFrameCard(shot, index, 'last')}
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-6">
                      {shot.imageUrls.map((url) => (
                        renderUploadedThumb(url, () => updateShot(shot.id, { imageUrls: shot.imageUrls.filter((item) => item !== url) }), 'h-[64px] w-[64px]')
                      ))}
                      <label
                        className="upload-box relative flex h-[64px] w-[64px] cursor-pointer items-center justify-center overflow-hidden text-primary transition hover:border-primary hover:bg-blue-50"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          dropDramaReference(event, shot);
                        }}
                      >
                        <Plus />
                        <input
                          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => {
                            void addReference(shot.id, event.target.files);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
                {dramaReferenceMode === 'firstLast' && index < activeShots.length - 1 && !brokenDramaLinks.has(index) ? (
                  <div className="pointer-events-none absolute left-[calc(50%+58px)] top-[154px] z-20 h-[82px] w-[calc(52px+1.5rem)] rounded-br-[22px] border-b-2 border-r-2 border-dashed border-primary/55">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        unlinkDramaFrames(index);
                      }}
                      className="pointer-events-auto absolute bottom-[22px] right-[-17px] flex h-8 w-8 items-center justify-center rounded-full border border-blue-100 bg-white text-primary shadow-[0_8px_20px_rgba(47,128,255,0.18)] transition hover:border-primary hover:bg-blue-50"
                      title="断开首尾帧联动"
                      aria-label="断开首尾帧联动"
                    >
                      <Scissors size={16} />
                    </button>
                  </div>
                ) : null}
                <div className="flex h-[132px] items-center justify-center pt-7">
                  <button
                    type="button"
                    onClick={() => void generateDramaShot(shot, index)}
                    disabled={Boolean(dramaGenerating[shot.id]) || !shot.prompt.trim()}
                    className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-primary bg-white text-primary shadow-[0_8px_20px_rgba(47,128,255,0.12)] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                    title="生成本行视频"
                    aria-label="生成本行视频"
                  >
                    <ArrowRight size={22} />
                  </button>
                </div>
                <div className="pt-1">
                  {renderDramaResult(dramaResults[shot.id], index, Boolean(dramaGenerating[shot.id]), dramaGenerating[shot.id])}
                </div>
              </article>
            ))}
          </div>
          <div className="flex items-center justify-between px-6 py-4">
            {!hasScriptShots ? (
              <button onClick={addDirectShot} className="flex h-12 min-w-[150px] items-center justify-center gap-2 rounded-[8px] border border-primary bg-white/70 px-5 text-sm font-black text-primary shadow-[0_8px_20px_rgba(47,128,255,0.08)]">
                <Plus size={18} /> 添加
              </button>
            ) : <div />}
            <PrimaryButton disabled={!selected.length || loading} onClick={handleGenerate}>
              {loading ? '生成中...' : '批量生成'} <Sparkles size={18} />
            </PrimaryButton>
          </div>
        </section>
      </div>
      </div>

      <aside className="glass-panel sticky top-5 min-h-[620px] overflow-hidden rounded-[8px] p-4">
        <h2 className="text-lg font-black text-ink">我的素材</h2>
        <div
          className="mt-4 grid max-h-[calc(100vh-170px)] grid-cols-1 gap-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
              setVisibleMaterialCount((count) => Math.min(imageWorks.length, count + 4));
            }
          }}
        >
          {imageWorks.slice(0, visibleMaterialCount).map((work) => {
            const url = imageWorkUrl(work);
            return (
              <div
                key={work.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData('application/x-leapai-image-url', url);
                  event.dataTransfer.setData('text/uri-list', url);
                }}
                className="group cursor-grab overflow-hidden rounded-[8px] border border-blue-100 bg-white active:cursor-grabbing"
                title="拖到任务的上传卡片中引用"
              >
                <img src={url} alt="" loading="lazy" className="aspect-square w-full object-cover transition group-hover:scale-105" />
                <div className="truncate px-2 py-2 text-xs font-bold text-ink/65">{work.title || '生成图片'}</div>
              </div>
            );
          })}
          {!imageWorks.length ? <div className="py-16 text-center text-sm font-semibold text-ink/45">暂无已生成图片</div> : null}
        </div>
      </aside>
    </div>
  );

  const renderAvatar = () => (
    <div className="space-y-5">
      <section className="glass-panel rounded-[8px] p-6">
        <h2 className="text-xl font-black text-ink">主播形象</h2>
        <div className="mt-6 flex gap-4 overflow-x-auto pb-2">
          <label className="upload-box relative flex min-h-[210px] w-[170px] shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden text-center text-primary">
            <Plus size={34} />
            <span className="mt-4 text-sm font-black">创建新主播</span>
            <span className="mt-4 max-w-[120px] text-xs font-semibold leading-5 text-ink/55">上传视频，可同步训练声音</span>
            <input className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" type="file" accept="video/*" />
          </label>
          {avatarItems.map((item, index) => (
            <button
              key={item.name}
              onClick={() => setSelectedAvatar(item.name)}
              className={`w-[146px] shrink-0 overflow-hidden rounded-[10px] border bg-white text-center transition ${selectedAvatar === item.name ? 'border-primary shadow-[0_0_0_2px_rgba(91,120,214,0.16)]' : 'border-[rgba(120,145,190,0.2)] hover:border-primary/60'}`}
            >
              <div className={`relative flex h-[170px] items-center justify-center bg-gradient-to-br ${item.tone}`}>
                {item.name === '咖姐' ? (
                  <div className="px-3 text-lg font-black leading-7 text-white">市场开启反弹<br />这轮风险解除了？</div>
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/60 text-primary">
                    <UserRound size={46} />
                  </div>
                )}
                {selectedAvatar === item.name ? (
                  <span className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-white">
                    <Check size={20} />
                  </span>
                ) : null}
              </div>
              <div className="py-3 text-base font-black text-ink">{item.name || `主播 ${index + 1}`}</div>
            </button>
          ))}
        </div>
        <button className="mx-auto mt-5 block text-sm font-bold text-primary">收起主播</button>
      </section>

      <section className="glass-panel grid min-h-[520px] grid-cols-[minmax(0,1fr)_360px] gap-7 rounded-[8px] p-6">
        <div>
          <h2 className="text-xl font-black text-ink">创作视频</h2>
          <div className="mt-6 flex items-center gap-4">
            <span className="text-sm font-black text-ink">主播声音</span>
            <select className="h-10 w-56 rounded-[8px] border border-blue-100 px-3 text-sm font-semibold text-ink outline-none">
              <option>{selectedAvatar}</option>
              <option>咖姐</option>
              <option>伦琴AI</option>
            </select>
          </div>
          <div className="relative mt-5">
            <textarea
              value={avatarPrompt}
              onChange={(event) => setAvatarPrompt(event.target.value)}
              maxLength={5000}
              className="h-[260px] w-full resize-none rounded-[8px] border border-blue-100 bg-white/70 p-4 pr-24 text-sm font-semibold leading-6 outline-none focus:border-primary"
              placeholder="请输入口播文案，10-1000字"
            />
            <span className="absolute bottom-4 right-4 text-right text-sm font-bold text-ink/50">{avatarPrompt.length} / 5000</span>
          </div>
          <div className="mt-5 flex items-center gap-6">
            <PrimaryButton disabled={!avatarPrompt.trim()}>
              生成视频 <Sparkles size={18} />
            </PrimaryButton>
            <div className="text-sm font-semibold text-ink/50">预计生成时长：0 秒</div>
            <div className="text-sm font-semibold text-ink/50">预计扣费：<span className="font-black text-primary">0</span> 积分</div>
          </div>
        </div>
        <div className="border-l border-[rgba(120,145,190,0.16)] pl-7">
          <h2 className="text-xl font-black text-ink">生成结果</h2>
          <div className="mt-6 flex h-[360px] items-center justify-center rounded-[8px] bg-[#F3F6FB] text-center text-sm font-semibold text-ink/45">
            选择主播并填写剧本后生成视频
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-[56px] w-[430px] grid-cols-3 gap-1 rounded-[10px] bg-white/80 p-1 shadow-[0_8px_24px_rgba(31,43,77,0.04)]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} onClick={() => setMode(tab.key)} className={`flex h-12 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] text-base font-black transition ${mode === tab.key ? 'border border-[rgba(107,140,255,0.42)] bg-[#F3F7FF] text-primary' : 'border border-transparent text-ink hover:bg-blue-50/70'}`}>
                <Icon size={18} className="shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setEditMenuOpen((value) => !value)}
            className="secondary-button flex h-11 items-center gap-2 px-5 text-sm font-black"
          >
            <Film size={18} /> 视频剪辑 <ChevronDown size={16} />
          </button>
          {editMenuOpen ? (
            <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-44 overflow-hidden rounded-[10px] border border-blue-100 bg-white p-2 text-sm font-bold text-ink shadow-[0_16px_40px_rgba(47,128,255,0.16)]">
              <button
                type="button"
                onClick={openVideoEditWorks}
                className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left transition hover:bg-blue-50"
              >
                <Film size={16} /> 选择作品
              </button>
              <label className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left transition hover:bg-blue-50">
                <Upload size={16} /> 本地上传
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(event) => {
                    openVideoEditLocal(event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          ) : null}
        </div>
      </div>

      {error ? <div className="rounded-[8px] bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</div> : null}
      {mode === 'general' ? renderGeneral() : null}
      {mode === 'drama' ? renderDrama() : null}
      {mode === 'avatar' ? renderAvatar() : null}
    </div>
  );
}

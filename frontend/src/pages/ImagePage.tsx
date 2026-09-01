import { ArrowRight, ChevronDown, Copy, Download, Eye, Grid2X2, ImageIcon, Images, LayoutList, Mountain, Package, Plus, RefreshCcw, Sparkles, Trash2, UserRound, Wand2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GhostButton, PrimaryButton } from '../components/Controls';
import imageEmpty from '../assets/image-empty.png';
import { generateImages, getErrorMessage, uploadImage } from '../lib/api';
import { resultUrlsFromContent } from '../lib/shotParser';
import type { Shot, Work } from '../types';

interface Props {
  shots: Shot[];
  onShotsChange: (shots: Shot[]) => void;
  onImagesGenerated: (work: Work, shots: Shot[]) => void;
  onGoVideo: () => void;
}

type ImageMode = 'general' | 'storyboard' | 'character' | 'scene' | 'product';

const imageModePaths: Record<ImageMode, string> = {
  general: '/aigc/image/general',
  storyboard: '/aigc/image/shots',
  character: '/aigc/image/character',
  scene: '/aigc/image/scene',
  product: '/aigc/image/product',
};

function imageModeFromPath(): ImageMode {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  const entry = (Object.entries(imageModePaths) as Array<[ImageMode, string]>).find(([, path]) => pathname === path);
  return entry?.[0] || 'general';
}

interface GeneralImageTask {
  id: string;
  prompt: string;
  refs: string[];
  count: number;
  aspectRatio: string;
  resolution: string;
}

const tabs: Array<{ key: ImageMode; label: string; icon: typeof Wand2 }> = [
  { key: 'general', label: '通用', icon: Wand2 },
  { key: 'storyboard', label: '分镜图', icon: Images },
  { key: 'character', label: '人物形象', icon: UserRound },
  { key: 'scene', label: '场景环境', icon: Mountain },
  { key: 'product', label: '商品套图', icon: Package },
];

const ratioOptions = [
  { value: '16:9', title: '16:9', subtitle: '横屏' },
  { value: '9:16', title: '9:16', subtitle: '竖屏' },
  { value: '1:1', title: '1:1', subtitle: '正方形' },
  { value: '3:4', title: '3:4', subtitle: '竖图' },
  { value: '4:3', title: '4:3', subtitle: '横图' },
];

const resolutionOptions = [
  { value: '1K', title: '1K', subtitle: '1024x576' },
  { value: '2K', title: '2K', subtitle: '2048x1152' },
  { value: '4K', title: '4K', subtitle: '3840x2160' },
];

const realisticXianxiaPrompt = '东方仙侠电影感，写实唯美。人物采用真人风格。去掉所有文字和黑边。其他细节不变。';

export default function ImagePage({ shots, onShotsChange, onImagesGenerated, onGoVideo }: Props) {
  const [mode, setMode] = useState<ImageMode>(imageModeFromPath);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('1K');
  const [storyboardStyle, setStoryboardStyle] = useState<'free' | 'realistic-xianxia'>('free');
  const [directShots, setDirectShots] = useState<Shot[]>([
    {
      id: '01',
      title: '直接创作',
      duration_seconds: 5,
      description: '直接输入画面需求生成分镜图。',
      prompt: '',
      imageUrls: [],
      selected: true,
    },
  ]);
  const [generalPrompt, setGeneralPrompt] = useState('');
  const [generalRefs, setGeneralRefs] = useState<string[]>([]);
  const [generalCount, setGeneralCount] = useState(1);
  const [generalPendingCount, setGeneralPendingCount] = useState(0);
  const [generalResults, setGeneralResults] = useState<string[]>([]);
  const [copiedGeneralTasks, setCopiedGeneralTasks] = useState<GeneralImageTask[]>([]);
  const [copiedGeneralResults, setCopiedGeneralResults] = useState<Record<string, string[]>>({});
  const [copiedGeneralPending, setCopiedGeneralPending] = useState<Record<string, number>>({});
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [productRefs, setProductRefs] = useState<string[]>([]);
  const [productName, setProductName] = useState('');
  const [sellingPoint, setSellingPoint] = useState('');
  const [platform, setPlatform] = useState('淘宝');
  const [mainCount, setMainCount] = useState(5);
  const [detailCount, setDetailCount] = useState(10);
  const [productResults, setProductResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingShotIds, setGeneratingShotIds] = useState<Set<string>>(() => new Set());
  const [storyboardResults, setStoryboardResults] = useState<Record<string, string>>({});
  const [storyboardNumbers, setStoryboardNumbers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [openDropdown, setOpenDropdown] = useState('');
  const activeShots = shots.length ? shots : directShots;
  const hasScriptShots = shots.length > 0;
  const storyboardNumber = (shot: Shot) => {
    const stored = storyboardNumbers[shot.id];
    if (stored) return stored;
    const numericId = Number.parseInt(shot.id, 10);
    const fallback = Number.isFinite(numericId) && numericId > 0
      ? numericId
      : Math.max(1, activeShots.findIndex((item) => item.id === shot.id) + 1);
    return `${Math.min(99, fallback)}`.padStart(2, '0');
  };
  const nextStoryboardNumber = () => (
    `${Math.min(99, Math.max(0, ...activeShots.map((item) => Number.parseInt(storyboardNumber(item), 10) || 0)) + 1)}`.padStart(2, '0')
  );
  const storyboardImageName = (shot: Shot) => {
    const stylePrompt = storyboardStyle === 'realistic-xianxia' ? realisticXianxiaPrompt : '';
    const promptPrefix = (shot.prompt.trim() || stylePrompt).replace(/\s+/g, '').slice(0, 2) || '图片';
    return `镜头${storyboardNumber(shot)}-${promptPrefix}`;
  };

  useEffect(() => {
    const rawDraft = localStorage.getItem('leapai:image-draft');
    if (!rawDraft) return;
    localStorage.removeItem('leapai:image-draft');
    try {
      const draft = JSON.parse(rawDraft) as {
        prompt?: string;
        referenceUrls?: string[];
        aspectRatio?: string;
        resolution?: string;
      };
      setMode('general');
      setGeneralPrompt(draft.prompt || '');
      setGeneralRefs(Array.isArray(draft.referenceUrls) ? draft.referenceUrls.slice(0, 4) : []);
      if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
      if (draft.resolution) setResolution(draft.resolution);
    } catch {
      // Ignore malformed handoff data.
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => setMode(imageModeFromPath());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const changeImageMode = (nextMode: ImageMode) => {
    setMode(nextMode);
    const nextPath = imageModePaths[nextMode];
    if (window.location.pathname !== nextPath || window.location.hash) {
      window.history.pushState(null, '', nextPath);
    }
  };

  const updateShot = (id: string, patch: Partial<Shot>) => {
    const updater = (items: Shot[]) => items.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot));
    if (hasScriptShots) onShotsChange(updater(shots));
    else setDirectShots(updater(directShots));
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return [];
    return Promise.all(Array.from(files).map((file) => uploadImage(file).then((result) => result.url)));
  };

  const addReference = async (id: string, files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    try {
      const urls = await uploadFiles(files);
      const shot = activeShots.find((item) => item.id === id);
      if (shot) updateShot(id, { imageUrls: [...shot.imageUrls, ...urls] });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const insertStoryboardShot = (shot: Shot, copyCurrent = false) => {
    const nextId = `storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextNumber = copyCurrent ? storyboardNumber(shot) : nextStoryboardNumber();
    const nextShot: Shot = copyCurrent ? {
      ...shot,
      id: nextId,
      title: `${shot.title || '画面'}（副本）`,
      imageUrls: [...shot.imageUrls],
      selected: true,
    } : {
      id: nextId,
      title: `画面 ${nextId}`,
      duration_seconds: shot.duration_seconds || 5,
      description: '直接输入画面需求生成分镜图。',
      prompt: '',
      imageUrls: [],
      selected: true,
    };
    const currentIndex = activeShots.findIndex((item) => item.id === shot.id);
    const nextShots = [...activeShots];
    nextShots.splice(currentIndex < 0 ? nextShots.length : currentIndex + 1, 0, nextShot);
    if (hasScriptShots) onShotsChange(nextShots);
    else setDirectShots(nextShots);
    setStoryboardNumbers((items) => ({ ...items, [nextId]: nextNumber }));
  };

  const deleteStoryboardShot = (shot: Shot) => {
    if (activeShots.length === 1) {
      updateShot(shot.id, { prompt: '', imageUrls: [] });
    } else {
      const nextShots = activeShots.filter((item) => item.id !== shot.id);
      if (hasScriptShots) onShotsChange(nextShots);
      else setDirectShots(nextShots);
    }
    setStoryboardResults((items) => {
      const next = { ...items };
      delete next[shot.id];
      return next;
    });
    setStoryboardNumbers((items) => {
      const next = { ...items };
      delete next[shot.id];
      return next;
    });
  };

  const handleGenerateStoryboard = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await generateImages({
        aspect_ratio: aspectRatio,
        resolution,
        shots: activeShots.map((shot) => ({
          title: storyboardImageName(shot),
          duration_seconds: shot.duration_seconds,
          prompt: [
            shot.prompt,
            storyboardStyle === 'realistic-xianxia' ? realisticXianxiaPrompt : '',
          ].filter(Boolean).join('\n'),
          reference_urls: shot.imageUrls.filter((url) => url.startsWith('http')),
        })),
      });
      const urls = resultUrlsFromContent(result.work.content);
      setStoryboardResults((items) => ({
        ...items,
        ...Object.fromEntries(activeShots.flatMap((shot, index) => (urls[index] ? [[shot.id, urls[index]]] : []))),
      }));
      onImagesGenerated(result.work, activeShots);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSingleShot = async (shot: Shot) => {
    setError('');
    setGeneratingShotIds((items) => new Set(items).add(shot.id));
    try {
      const result = await generateImages({
        aspect_ratio: aspectRatio,
        resolution,
        shots: [{
          title: storyboardImageName(shot),
          duration_seconds: shot.duration_seconds,
          prompt: [
            shot.prompt,
            storyboardStyle === 'realistic-xianxia' ? realisticXianxiaPrompt : '',
          ].filter(Boolean).join('\n'),
          reference_urls: shot.imageUrls.filter((url) => url.startsWith('http')),
        }],
      });
      const generatedUrl = resultUrlsFromContent(result.work.content)[0];
      if (generatedUrl) setStoryboardResults((items) => ({ ...items, [shot.id]: generatedUrl }));
      onImagesGenerated(result.work, activeShots);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setGeneratingShotIds((items) => {
        const next = new Set(items);
        next.delete(shot.id);
        return next;
      });
    }
  };

  const continueStoryboardShot = (shot: Shot, resultUrl: string) => {
    const nextId = `storyboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextNumber = nextStoryboardNumber();
    const nextShot: Shot = {
      ...shot,
      id: nextId,
      title: `${shot.title || '画面'}（继续生成）`,
      imageUrls: [resultUrl],
      selected: true,
    };
    const currentIndex = activeShots.findIndex((item) => item.id === shot.id);
    const nextShots = [...activeShots];
    nextShots.splice(currentIndex < 0 ? nextShots.length : currentIndex + 1, 0, nextShot);
    if (hasScriptShots) onShotsChange(nextShots);
    else setDirectShots(nextShots);
    setStoryboardNumbers((items) => ({ ...items, [nextId]: nextNumber }));
  };

  const handleGenerateGeneral = async (taskId = 'general', task?: Omit<GeneralImageTask, 'id'>) => {
    const currentPrompt = task?.prompt ?? generalPrompt;
    const currentRefs = task?.refs ?? generalRefs;
    const currentCount = task?.count ?? generalCount;
    const currentAspectRatio = task?.aspectRatio ?? aspectRatio;
    const currentResolution = task?.resolution ?? resolution;
    setError('');
    if (taskId === 'general') {
      setGeneralResults([]);
      setGeneralPendingCount(currentCount);
    } else {
      setCopiedGeneralResults((items) => ({ ...items, [taskId]: [] }));
      setCopiedGeneralPending((items) => ({ ...items, [taskId]: currentCount }));
    }
    setLoading(true);
    try {
      const result = await generateImages({
        aspect_ratio: currentAspectRatio,
        resolution: currentResolution,
        shots: Array.from({ length: currentCount }).map((_, index) => ({
          title: `图片 ${index + 1}`,
          duration_seconds: 5,
          prompt: currentPrompt,
          reference_urls: currentRefs,
        })),
      });
      const urls = resultUrlsFromContent(result.work.content);
      if (taskId === 'general') setGeneralResults(urls);
      else setCopiedGeneralResults((items) => ({ ...items, [taskId]: urls }));
      onImagesGenerated(result.work, activeShots);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setGeneralPendingCount(0);
      setLoading(false);
    }
  };

  const addEmptyGeneralTask = () => {
    setCopiedGeneralTasks((items) => [...items, {
      id: `${Date.now()}-${items.length}`,
      prompt: '',
      refs: [],
      count: generalCount,
      aspectRatio,
      resolution,
    }]);
  };

  const copyGeneralTask = (task: Omit<GeneralImageTask, 'id'>) => {
    setCopiedGeneralTasks((items) => [...items, {
      ...task,
      id: `${Date.now()}-${items.length}`,
      refs: [...task.refs],
    }]);
  };

  const continueGeneralTask = (taskId: string, resultUrl: string) => {
    const source = taskId === 'general'
      ? { prompt: generalPrompt, count: generalCount, aspectRatio, resolution }
      : copiedGeneralTasks.find((item) => item.id === taskId);
    if (!source) return;
    const nextTask: GeneralImageTask = {
      id: `${Date.now()}-${copiedGeneralTasks.length}`,
      prompt: source.prompt,
      refs: [resultUrl],
      count: source.count,
      aspectRatio: source.aspectRatio,
      resolution: source.resolution,
    };
    setCopiedGeneralTasks((items) => {
      if (taskId === 'general') return [nextTask, ...items];
      const currentIndex = items.findIndex((item) => item.id === taskId);
      if (currentIndex < 0) return [...items, nextTask];
      const next = [...items];
      next.splice(currentIndex + 1, 0, nextTask);
      return next;
    });
  };

  const updateCopiedGeneralTask = (taskId: string, patch: Partial<Omit<GeneralImageTask, 'id'>>) => {
    setCopiedGeneralTasks((items) => items.map((item) => (item.id === taskId ? { ...item, ...patch } : item)));
  };

  const deleteGeneralTask = (taskId: string) => {
    if (taskId === 'general') {
      if (!copiedGeneralTasks.length) {
        setGeneralPrompt('');
        setGeneralRefs([]);
        setGeneralResults([]);
        return;
      }
      const [nextTask, ...rest] = copiedGeneralTasks;
      setGeneralPrompt(nextTask.prompt);
      setGeneralRefs(nextTask.refs);
      setGeneralCount(nextTask.count);
      setAspectRatio(nextTask.aspectRatio);
      setResolution(nextTask.resolution);
      setGeneralResults(copiedGeneralResults[nextTask.id] || []);
      setCopiedGeneralTasks(rest);
      return;
    }
    setCopiedGeneralTasks((items) => items.filter((item) => item.id !== taskId));
    setCopiedGeneralResults((items) => {
      const next = { ...items };
      delete next[taskId];
      return next;
    });
  };

  const handleGenerateProduct = async () => {
    setError('');
    setLoading(true);
    try {
      const prompt = [
        `为商品「${productName || '未命名商品'}」生成电商商品套图。`,
        `平台：${platform}。`,
        `主图 ${mainCount} 张，详情图 ${detailCount} 张，白底图 1 张，规格图 1 张，商详首帧图 1 张。`,
        sellingPoint ? `核心卖点：${sellingPoint}` : '',
      ].filter(Boolean).join('\n');
      const total = Math.min(mainCount + detailCount + 3, 20);
      const result = await generateImages({
        aspect_ratio: '1:1',
        resolution: '1K',
        shots: Array.from({ length: total }).map((_, index) => ({
          title: `商品图 ${index + 1}`,
          duration_seconds: 5,
          prompt,
          reference_urls: productRefs,
        })),
      });
      setProductResults(resultUrlsFromContent(result.work.content));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const renderUploadedThumb = (url: string, onRemove: () => void, sizeClass = 'h-16 w-16') => (
    <div key={url} className={`group relative ${sizeClass} overflow-hidden rounded-[8px]`}>
      <img src={url} className="h-full w-full object-cover" />
      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setPreviewImageUrl(url)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75"
          title="预览图片"
          aria-label="预览图片"
        >
          <Eye size={13} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75"
          title="删除图片"
          aria-label="删除图片"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );

  const renderUploadBox = (title: string, urls: string[], onUpload: (files: FileList | null) => void, onRemove: (url: string) => void) => (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm font-black text-ink">
        <span>{title}</span>
        <span className="font-semibold text-ink/50">{urls.length}/4</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="upload-box relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden text-primary transition hover:border-primary hover:bg-blue-50">
          <Plus size={24} />
          <input
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              onUpload(event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </label>
        {urls.map((url) => renderUploadedThumb(url, () => onRemove(url)))}
      </div>
    </div>
  );

  const renderInlineDropdown = ({ id, value, options, onChange }: { id: string; value: string; options: Array<{ value: string; label: string }>; onChange: (nextValue: string) => void }) => {
    const active = options.find((option) => option.value === value);
    const isOpen = openDropdown === id;
    return (
      <div className="relative">
        <button type="button" onClick={() => setOpenDropdown(isOpen ? '' : id)} className={`flex h-10 w-full items-center justify-between rounded-[4px] border bg-white px-3 text-left text-sm font-semibold text-ink transition ${isOpen ? 'border-primary ring-2 ring-primary/10' : 'border-[rgba(120,145,190,0.28)] hover:border-primary/50'}`}>
          <span>{active?.label}</span>
          <ChevronDown size={16} className={`text-ink/35 transition ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen ? (
          <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-[6px] bg-white py-1 shadow-[0_10px_28px_rgba(31,43,77,0.14)] ring-1 ring-[rgba(120,145,190,0.18)]">
            {options.map((option) => (
              <button key={option.value} type="button" onClick={() => { onChange(option.value); setOpenDropdown(''); }} className={`block h-9 w-full px-3 text-left text-sm font-semibold transition ${option.value === value ? 'bg-[#E8F7FF] text-ink' : 'text-ink/75 hover:bg-[#F2F8FF]'}`}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderCompactOptions = (
    title: string,
    value: string,
    onChange: (next: string) => void,
    options: Array<{ value: string; title: string; subtitle: string; badge?: string }>,
    columns: 3 | 5 = 5,
  ) => {
    return (
      <div>
        <div className="mb-2 text-sm font-black text-ink">{title}</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`relative h-[54px] text-center transition ${
                value === option.value ? 'option-card-selected text-primary' : 'option-card text-ink hover:border-primary/50'
              }`}
            >
              {option.badge ? (
                <span className="absolute -right-1 -top-3 rounded-[6px] bg-violet px-2 py-0.5 text-xs font-black text-white">{option.badge}</span>
              ) : null}
              <div className="text-base font-black leading-5">{option.title}</div>
              <div className="mt-1 text-xs font-bold">{option.subtitle}</div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const downloadImage = async (url: string, index: number, filename?: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${filename || `image-${index + 1}`}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filename || `image-${index + 1}`}.png`;
      anchor.target = '_blank';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  };

  const renderResultTile = (url: string | undefined, index: number, onContinue: () => void) => (
    <div key={index} className="group relative aspect-[16/10] overflow-hidden rounded-[8px] bg-blue-50">
      {url ? (
        <img src={url} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-blue-300">
          <ImageIcon size={34} />
        </div>
      )}
      <span className="absolute left-3 top-3 flex h-7 min-w-7 items-center justify-center rounded-[6px] bg-white/90 px-2 text-sm font-black text-ink shadow-sm">
        {index + 1}
      </span>
      <div className="absolute bottom-3 right-3 flex gap-2">
        <button onClick={() => url && void downloadImage(url, index)} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-black/65 text-white backdrop-blur">
          <Download size={17} />
        </button>
        <button onClick={() => url && setPreviewImageUrl(url)} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-black/65 text-white backdrop-blur">
          <Eye size={17} />
        </button>
        <button onClick={onContinue} disabled={!url} className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-black/65 text-white backdrop-blur disabled:opacity-40" title="继续生成" aria-label="继续生成">
          <RefreshCcw size={17} />
        </button>
      </div>
    </div>
  );

  const renderPendingTile = (index: number, fullSize = false) => (
    <div key={index} className={`relative overflow-hidden rounded-[8px] bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.98),rgba(242,248,255,0.94)_48%,rgba(232,241,255,0.82)_100%)] ${fullSize ? 'min-h-[620px] w-full' : 'aspect-[16/10]'}`}>
      <span className="absolute left-3 top-3 flex h-7 min-w-7 items-center justify-center rounded-[6px] bg-white/90 px-2 text-sm font-black text-ink shadow-sm">
        {index + 1}
      </span>
      <div className="absolute left-[8%] top-[12%] h-20 w-20 rounded-full bg-blue-200/25 blur-2xl" />
      <div className="absolute bottom-[8%] right-[8%] h-24 w-24 rounded-full bg-violet-200/25 blur-2xl" />
      <div className="relative flex h-full w-full flex-col items-center justify-center">
        <div className={`relative ${fullSize ? 'h-[260px] w-[420px]' : 'h-[132px] w-[220px]'}`}>
          <div className={`orbit-spin absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-[#7DBBFF]/55 ${fullSize ? 'h-[126px] w-[360px]' : 'h-[70px] w-[190px]'}`} style={{ '--orbit-angle': '-8deg' } as React.CSSProperties} />
          <div className={`orbit-counter-spin absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-[#7A6CFF]/40 ${fullSize ? 'h-[154px] w-[400px]' : 'h-[88px] w-[214px]'}`} style={{ '--orbit-angle': '14deg' } as React.CSSProperties} />
          <div className="crystal-float absolute left-[15%] top-[28%] h-6 w-6 rounded-full bg-[radial-gradient(circle_at_35%_30%,white,#DCEBFF_55%,#AFC7FF)] shadow-[0_8px_18px_rgba(47,128,255,0.14)]" />
          <div className="crystal-float absolute right-[13%] top-[18%] h-7 w-7 rounded-full bg-[radial-gradient(circle_at_35%_30%,white,#EAF1FF_58%,#C7D6FF)] shadow-[0_8px_18px_rgba(47,128,255,0.14)]" style={{ animationDelay: '-1.2s' }} />
          <div className={`crystal-float absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[radial-gradient(circle_at_34%_26%,#FFFFFF_0%,#EEF5FF_36%,#BFD4FF_68%,#7DBBFF_100%)] shadow-[inset_-10px_-10px_22px_rgba(47,128,255,0.16),inset_9px_9px_20px_rgba(255,255,255,0.95),0_14px_34px_rgba(47,128,255,0.2)] ${fullSize ? 'h-36 w-36' : 'h-20 w-20'}`}>
            <div className="absolute inset-3 rounded-full border border-white/70" />
            <Sparkles size={fullSize ? 42 : 28} className="relative z-10 text-[#6B8CFF]" />
          </div>
        </div>
        <span className={`font-black text-primary ${fullSize ? 'mt-2 text-3xl' : '-mt-2 text-sm'}`}>AI 正在创作中...</span>
        {fullSize ? <span className="mt-4 text-base font-black text-ink/45">灵感正在生成画面，请稍候片刻...</span> : null}
      </div>
    </div>
  );

  const renderGeneralTask = (task: GeneralImageTask) => {
    const isPrimary = task.id === 'general';
    const update = (patch: Partial<Omit<GeneralImageTask, 'id'>>) => {
      if (!isPrimary) return updateCopiedGeneralTask(task.id, patch);
      if (patch.prompt !== undefined) setGeneralPrompt(patch.prompt);
      if (patch.refs !== undefined) setGeneralRefs(patch.refs);
      if (patch.count !== undefined) setGeneralCount(patch.count);
      if (patch.aspectRatio !== undefined) setAspectRatio(patch.aspectRatio);
      if (patch.resolution !== undefined) setResolution(patch.resolution);
    };
    return (
      <section className="glass-panel flex max-h-[calc(100vh-220px)] min-h-[560px] flex-col rounded-[8px] p-5">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          <div>
          <div className="mb-3 flex items-center justify-between text-sm font-black text-ink">
            <span>参考图 <span className="text-ink/50">（可选）</span></span>
            <span className="font-semibold text-ink/50">{task.refs.length}/4</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="upload-box relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden text-primary transition hover:border-primary hover:bg-blue-50">
              <Plus size={24} />
              <input
                className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  void uploadFiles(event.target.files)
                    .then((urls) => update({ refs: [...task.refs, ...urls].slice(0, 4) }))
                    .catch((err) => setError(getErrorMessage(err)));
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {task.refs.map((url) => renderUploadedThumb(url, () => update({ refs: task.refs.filter((item) => item !== url) })))}
          </div>
          </div>
          <div>
          <div className="mb-3 text-sm font-black text-ink">提示词 <span className="text-ink/50">（可编辑）</span></div>
          <div className="relative">
            <textarea
              value={task.prompt}
              onChange={(event) => update({ prompt: event.target.value })}
              maxLength={9999}
              className="h-[150px] w-full resize-none rounded-[8px] border border-blue-100 bg-white/70 p-4 pr-24 text-sm font-semibold leading-6 outline-none focus:border-primary"
              placeholder="请输入您想要生成的图片描述..."
            />
            <span className="absolute bottom-4 right-4 text-right text-sm font-bold text-ink/50">{task.prompt.length}/9999</span>
          </div>
          </div>
          <div className="space-y-5 pt-4">
          <div className="text-base font-black text-ink">生成参数</div>
          {renderCompactOptions('画面比例', task.aspectRatio, (value) => update({ aspectRatio: value }), ratioOptions, 5)}
          {renderCompactOptions('分辨率', task.resolution, (value) => update({ resolution: value }), resolutionOptions, 3)}
          <div>
            <div className="mb-2 text-sm font-black text-ink">生成数量</div>
            <div className="flex h-10 w-40 items-center rounded-[8px] border border-blue-100 bg-white">
              <button onClick={() => update({ count: Math.max(1, task.count - 1) })} className="h-full w-10 text-primary">-</button>
              <div className="flex-1 text-center font-black text-ink">{task.count}</div>
              <button onClick={() => update({ count: Math.min(30, task.count + 1) })} className="h-full w-10 text-primary">+</button>
            </div>
          </div>
        </div>
        </div>
        <div className="mt-4 flex shrink-0 items-center justify-between bg-white/20 pt-1">
          <PrimaryButton disabled={!task.prompt.trim() || loading} onClick={() => void handleGenerateGeneral(task.id, task)}>
            {loading ? '生成中...' : '生成图片'} <Sparkles size={18} />
          </PrimaryButton>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => deleteGeneralTask(task.id)} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="删除任务" aria-label="删除任务"><Trash2 size={18} /></button>
            <button type="button" onClick={addEmptyGeneralTask} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="添加任务" aria-label="添加任务"><Plus size={18} /></button>
            <button type="button" onClick={() => copyGeneralTask(task)} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="复制任务" aria-label="复制任务"><Copy size={18} /></button>
          </div>
        </div>
      </section>
    );
  };

  const renderGeneralResultPanel = (taskId: string) => {
    const results = taskId === 'general' ? generalResults : copiedGeneralResults[taskId] || [];
    const pendingCount = taskId === 'general' ? generalPendingCount : copiedGeneralPending[taskId] || 0;
    return (
      <section className="glass-panel rounded-[8px] p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-black text-black">生成结果</h2>
          <div className="flex gap-3">
            <GhostButton><Download size={16} /> 全部下载</GhostButton>
            <button className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-primary text-primary"><Grid2X2 size={18} /></button>
            <button className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-blue-100 text-ink/50"><LayoutList size={18} /></button>
          </div>
        </div>
        {results.length ? (
          <div className={`grid gap-4 ${results.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {results.map((url, index) => renderResultTile(url, index, () => continueGeneralTask(taskId, url)))}
          </div>
        ) : loading && pendingCount ? (
          pendingCount === 1 ? renderPendingTile(0, true) : <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: pendingCount }).map((_, index) => renderPendingTile(index))}
          </div>
        ) : (
          <div className="flex min-h-[620px] flex-col items-center justify-center text-center">
            <img src={imageEmpty} className="h-[368px] w-[368px] object-contain" />
            <div className="mt-7 text-xl font-black text-ink">生成结果将显示在这里</div>
            <div className="mt-3 text-sm font-semibold text-ink/50">在左侧输入描述并设置参数，点击“生成图片”开始创作吧～</div>
          </div>
        )}
      </section>
    );
  };

  const renderGeneral = () => (
    <div className="space-y-5">
      {[
        { id: 'general', prompt: generalPrompt, refs: generalRefs, count: generalCount, aspectRatio, resolution },
        ...copiedGeneralTasks,
      ].map((task) => (
        <div key={task.id} className="grid grid-cols-2 gap-5">
          {renderGeneralTask(task)}
          {renderGeneralResultPanel(task.id)}
        </div>
      ))}
      {previewImageUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setPreviewImageUrl('')}>
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(event) => event.stopPropagation()}>
            <button onClick={() => setPreviewImageUrl('')} className="absolute -right-4 -top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink shadow-soft">
              <X size={20} />
            </button>
            <img src={previewImageUrl} className="max-h-[90vh] max-w-[90vw] rounded-[8px] object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );

  const renderStoryboard = () => (
    <>
      <section className="glass-panel relative z-40 overflow-visible rounded-[8px] p-5">
        <div className="grid max-w-[570px] grid-cols-3 gap-3">
          {renderInlineDropdown({
            id: 'storyboard-ratio',
            value: aspectRatio,
            onChange: setAspectRatio,
            options: [
              { value: '16:9', label: '横屏16:9' },
              { value: '9:16', label: '竖屏9:16' },
              { value: '1:1', label: '方形1:1' },
              { value: '3:4', label: '竖图3:4' },
              { value: '4:3', label: '横图4:3' },
            ],
          })}
          {renderInlineDropdown({
            id: 'storyboard-resolution',
            value: resolution,
            onChange: setResolution,
            options: resolutionOptions.map((option) => ({ value: option.value, label: `${option.title} ${option.subtitle}` })),
          })}
          {renderInlineDropdown({
            id: 'storyboard-style',
            value: storyboardStyle,
            onChange: (value) => setStoryboardStyle(value === 'realistic-xianxia' ? 'realistic-xianxia' : 'free'),
            options: [
              { value: 'free', label: '自由' },
              { value: 'realistic-xianxia', label: '写实仙侠' },
            ],
          })}
        </div>
      </section>
      <section className="space-y-3">
        {activeShots.map((shot) => (
          <article key={shot.id} className="glass-panel relative grid grid-cols-[56px_240px_minmax(280px,1fr)_56px_260px] items-center gap-5 rounded-[8px] px-5 pb-16 pt-5">
            <div className="flex items-center justify-center">
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={storyboardNumbers[shot.id] ?? storyboardNumber(shot)}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, '').slice(0, 2);
                  setStoryboardNumbers((items) => ({ ...items, [shot.id]: value }));
                }}
                onBlur={() => {
                  const value = Number.parseInt(storyboardNumbers[shot.id] || storyboardNumber(shot), 10);
                  setStoryboardNumbers((items) => ({ ...items, [shot.id]: `${Math.min(99, Math.max(1, value || 1))}`.padStart(2, '0') }));
                }}
                className="h-8 w-10 rounded-[6px] border border-primary bg-white text-center text-sm font-black text-primary outline-none focus:ring-2 focus:ring-primary/15"
                title="镜头编号（01-99）"
                aria-label="镜头编号"
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-black text-ink">参考图 <span className="text-xs text-ink/50">（可选）</span></div>
              <div className="flex gap-2">
                {shot.imageUrls.slice(0, 2).map((url) => renderUploadedThumb(url, () => updateShot(shot.id, { imageUrls: shot.imageUrls.filter((item) => item !== url) }), 'h-[70px] w-[70px]'))}
                <label className="upload-box relative flex h-[70px] w-[70px] cursor-pointer items-center justify-center overflow-hidden text-primary">
                  <Plus />
                  <input className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" type="file" accept="image/*" multiple onChange={(event) => { void addReference(shot.id, event.target.files); event.currentTarget.value = ''; }} />
                </label>
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-black text-ink">提示语 <span className="text-xs text-ink/50">（可编辑）</span></div>
              <textarea value={shot.prompt} onChange={(event) => updateShot(shot.id, { prompt: event.target.value })} maxLength={300} className="h-[86px] w-full resize-none rounded-[8px] border border-blue-100 bg-white p-4 text-sm font-semibold leading-6 outline-none focus:border-primary" />
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateSingleShot(shot)}
              disabled={(!shot.prompt.trim() && storyboardStyle === 'free') || generatingShotIds.has(shot.id)}
              className="mt-6 flex h-11 w-11 items-center justify-center rounded-[8px] border border-primary/45 bg-white text-primary transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="生成当前分镜"
              aria-label="生成当前分镜"
            >
              {generatingShotIds.has(shot.id) ? <RefreshCcw size={19} className="animate-spin" /> : <ArrowRight size={20} />}
            </button>
            <div>
              <div className="mb-2 text-sm font-black text-ink">生成预览</div>
              {storyboardResults[shot.id] ? (
                <div className="group relative h-[82px] overflow-hidden rounded-[8px]">
                  <img src={storyboardResults[shot.id]} className="h-full w-full object-cover" />
                  <div className="absolute bottom-2 right-2 flex gap-1.5">
                    <button type="button" onClick={() => void downloadImage(storyboardResults[shot.id], activeShots.indexOf(shot), storyboardImageName(shot))} className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-black/65 text-white backdrop-blur" title="下载" aria-label="下载">
                      <Download size={15} />
                    </button>
                    <button type="button" onClick={() => setPreviewImageUrl(storyboardResults[shot.id])} className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-black/65 text-white backdrop-blur" title="预览" aria-label="预览">
                      <Eye size={15} />
                    </button>
                    <button type="button" onClick={() => continueStoryboardShot(shot, storyboardResults[shot.id])} className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-black/65 text-white backdrop-blur" title="继续生成" aria-label="继续生成">
                      <RefreshCcw size={15} />
                    </button>
                  </div>
                </div>
              ) : <div className="flex h-[82px] items-center justify-center rounded-[8px] bg-blue-50"><img src={imageEmpty} className="h-16 w-16 object-contain" /></div>}
            </div>
            <div className="absolute bottom-3 left-5 flex items-center gap-1">
              <button type="button" onClick={() => deleteStoryboardShot(shot)} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="删除任务" aria-label="删除任务">
                <Trash2 size={18} />
              </button>
              <button type="button" onClick={() => insertStoryboardShot(shot)} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="添加任务" aria-label="添加任务">
                <Plus size={18} />
              </button>
              <button type="button" onClick={() => insertStoryboardShot(shot, true)} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/50 transition hover:bg-blue-50 hover:text-primary" title="复制任务" aria-label="复制任务">
                <Copy size={18} />
              </button>
            </div>
          </article>
        ))}
      </section>
      {previewImageUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setPreviewImageUrl('')}>
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(event) => event.stopPropagation()}>
            <button onClick={() => setPreviewImageUrl('')} className="absolute -right-4 -top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink shadow-soft">
              <X size={20} />
            </button>
            <img src={previewImageUrl} className="max-h-[90vh] max-w-[90vw] rounded-[8px] object-contain" />
          </div>
        </div>
      ) : null}
    </>
  );

  const renderProduct = () => {
    const sections = [
      { title: '主图', count: mainCount },
      { title: '详情图', count: detailCount },
      { title: '白底图', count: 1 },
      { title: '规格图', count: 1 },
      { title: '商详首帧图', count: 1 },
    ];
    let cursor = 0;
    return (
      <div className="grid grid-cols-2 gap-5">
        <section className="glass-panel flex max-h-[calc(100vh-220px)] min-h-[560px] flex-col rounded-[8px] p-6">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {renderUploadBox(
              '上传图片',
              productRefs,
              (files) => void uploadFiles(files).then((urls) => setProductRefs((items) => [...items, ...urls])).catch((err) => setError(getErrorMessage(err))),
              (url) => setProductRefs((items) => items.filter((item) => item !== url)),
            )}
            <div className="space-y-3">
            <div className="text-base font-black text-ink">规格数量</div>
            <label className="block text-sm font-semibold text-ink/60">电商平台</label>
            <select value={platform} onChange={(event) => setPlatform(event.target.value)} className="h-11 w-full rounded-[8px] border border-blue-100 bg-white px-3 font-semibold outline-none focus:border-primary">
              <option>淘宝</option>
              <option>天猫</option>
              <option>京东</option>
              <option>抖音</option>
            </select>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-semibold text-ink/60">主图<input type="number" min={1} max={10} value={mainCount} onChange={(event) => setMainCount(Number(event.target.value))} className="mt-1 h-11 w-full rounded-[8px] border border-blue-100 px-3 text-ink outline-none focus:border-primary" /></label>
              <label className="text-sm font-semibold text-ink/60">比例<select className="mt-1 h-11 w-full rounded-[8px] border border-blue-100 px-3 text-ink outline-none"><option>1:1</option><option>3:4</option></select></label>
              <label className="text-sm font-semibold text-ink/60">详情图<input type="number" min={1} max={12} value={detailCount} onChange={(event) => setDetailCount(Number(event.target.value))} className="mt-1 h-11 w-full rounded-[8px] border border-blue-100 px-3 text-ink outline-none focus:border-primary" /></label>
              <label className="text-sm font-semibold text-ink/60">比例<select className="mt-1 h-11 w-full rounded-[8px] border border-blue-100 px-3 text-ink outline-none"><option>9:16</option><option>1:1</option></select></label>
            </div>
            <label className="block text-sm font-semibold text-ink/60">清晰度<select className="mt-1 h-11 w-full rounded-[8px] border border-blue-100 px-3 text-ink outline-none"><option>1K</option><option>2K</option></select></label>
            </div>
            <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-black text-ink">核心卖点</div>
              <button className="rounded-[8px] border border-violet px-4 py-2 text-sm font-black text-violet">AI 帮我写</button>
            </div>
            <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="请输入商品名称" className="mb-3 h-11 w-full rounded-[8px] border border-blue-100 px-3 outline-none focus:border-primary" />
            <textarea value={sellingPoint} onChange={(event) => setSellingPoint(event.target.value)} placeholder="核心卖点，生成更精准" className="h-28 w-full resize-none rounded-[8px] border border-blue-100 p-3 outline-none focus:border-primary" />
            </div>
          </div>
          <div className="mt-4 shrink-0 bg-white/20 pt-1">
            <PrimaryButton disabled={!productRefs.length || loading} onClick={handleGenerateProduct}>
              {loading ? '生成中...' : '一键生成'} <Sparkles size={18} />
            </PrimaryButton>
          </div>
        </section>
        <section className="glass-panel rounded-[8px] p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-black text-black">生成结果</h2>
            <GhostButton><Download size={16} /> 全部下载</GhostButton>
          </div>
          {productResults.length ? (
            <div className="space-y-6">
              {sections.map((item) => {
                const urls = productResults.slice(cursor, cursor + item.count);
                cursor += item.count;
                return (
                  <div key={item.title}>
                    <div className="mb-3 text-sm font-black text-ink">{item.title}</div>
                    <div className="grid grid-cols-3 gap-3">
                      {urls.map((url) => <img key={url} src={url} className="aspect-square rounded-[8px] object-cover" />)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[620px] flex-col items-center justify-center text-center">
              <img src={imageEmpty} alt="" className="h-[368px] w-[368px] object-contain" />
              <div className="mt-7 text-xl font-black text-ink">生成结果将显示在这里</div>
              <div className="mt-3 text-sm font-semibold text-ink/50">在左侧输入描述并设置参数，点击“生成图片”开始创作吧～</div>
            </div>
          )}
        </section>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="grid h-[56px] w-[730px] grid-cols-5 gap-1 rounded-[10px] bg-white/80 p-1 shadow-[0_8px_24px_rgba(31,43,77,0.04)]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} onClick={() => changeImageMode(tab.key)} className={`flex h-12 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] text-base font-black transition ${mode === tab.key ? 'border border-[rgba(107,140,255,0.42)] bg-[#F3F7FF] text-primary' : 'border border-transparent text-ink hover:bg-blue-50/70'}`}>
                <Icon size={18} className="shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        {mode === 'storyboard' && shots.length ? (
          <button type="button" onClick={onGoVideo} className="flex h-11 items-center justify-center rounded-[8px] border border-blue-100 bg-white px-5 text-sm font-black text-ink shadow-[0_8px_24px_rgba(31,43,77,0.06)] transition hover:border-primary/35 hover:bg-blue-50/40">
            进入视频生成
          </button>
        ) : null}
      </div>

      {error ? <div className="rounded-[8px] bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</div> : null}
      {mode === 'general' ? renderGeneral() : null}
      {mode === 'storyboard' ? renderStoryboard() : null}
      {mode === 'character' ? renderGeneral() : null}
      {mode === 'scene' ? renderGeneral() : null}
      {mode === 'product' ? renderProduct() : null}
    </div>
  );
}

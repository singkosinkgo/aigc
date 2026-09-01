import { CalendarDays, Check, Copy, Download, Eye, FileText, ImageIcon, MoreHorizontal, PencilLine, Play, PlaySquare, RefreshCcw, Scissors, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import imageEmpty from '../assets/image-empty.png';
import { getWork, getWorks, getWorksSummary } from '../lib/api';
import { resultUrlsFromContent } from '../lib/shotParser';
import { effectiveStatusClass, effectiveStatusLabel, elapsedSinceCreated, isVideoGenerating, isVideoReady, workVideoUrl } from '../lib/workStatus';
import type { ContentType, Work } from '../types';

function statusLabel(status: string) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '生成失败';
  return '生成中';
}

function statusClass(status: string) {
  if (status === 'completed') return 'text-[#38A169]';
  if (status === 'failed') return 'text-[#E57373]';
  return 'text-[#2F80FF]';
}

const mutedControlClass = 'border border-[rgba(120,145,190,0.15)] bg-white/60 shadow-none';
const coverFilterClass = 'filter saturate-[0.85] brightness-[0.98]';
const sectionCountClass = 'text-[#667799]';
const floatingDownloadClass = 'absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-[6px] border-none bg-white/65 text-ink/70 backdrop-blur-[12px] transition hover:text-primary';
const skeletonClass = 'animate-pulse rounded-[8px] bg-gradient-to-r from-blue-50 via-white to-blue-50';
const collapsedVideoCount = 4;
const expandedVideoPageSize = 8;

function workUrl(work: Work) {
  if (work.type === 'video') return workVideoUrl(work);
  return (
    resultUrlsFromContent(work.file_url)[0]
    || resultUrlsFromContent(work.content)[0]
    || resultUrlsFromContent(work.thumbnail_url)[0]
    || ''
  );
}

function downloadUrl(work: Work) {
  return `/api/works/${work.id}/download`;
}

function handleDownload(work: Work) {
  const anchor = document.createElement('a');
  anchor.href = downloadUrl(work);
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function formatWorkTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const pad = (number: number) => String(number).padStart(2, '0');
  const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (isToday) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tryParseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function collectUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return resultUrlsFromContent(value);
  if (Array.isArray(value)) return value.flatMap((item) => collectUrls(item));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectUrls(item));
  }
  return [];
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls.filter((url) => /^(https?:\/\/|data:image\/)/.test(url))));
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);
}

function imageWorkMeta(work: Work) {
  const promptJson = tryParseJson(work.prompt);
  const paramsJson = tryParseJson(work.generation_params_json || null);
  const referenceUrlsJson = tryParseJson(work.reference_urls_json || null);
  const contentJson = tryParseJson(work.content);
  const generatedUrls = uniqueUrls([
    ...resultUrlsFromContent(work.file_url),
    ...resultUrlsFromContent(work.content),
    ...resultUrlsFromContent(work.thumbnail_url),
  ]);
  const promptText = extractPromptText(paramsJson) || extractPromptText(promptJson) || work.prompt || '';
  const inputUrls = uniqueUrls([
    ...collectUrls(referenceUrlsJson),
    ...extractReferenceUrls(paramsJson),
    ...extractReferenceUrls(promptJson),
  ].filter((url) => !generatedUrls.includes(url)));
  const aspectRatio = extractStringField(paramsJson, ['aspect_ratio', 'aspectRatio']) || extractStringField(promptJson, ['aspect_ratio', 'aspectRatio']) || '未记录';
  const resolution = extractStringField(paramsJson, ['resolution']) || extractStringField(promptJson, ['resolution']) || '未记录';
  const count = generatedUrls.length || collectUrls(contentJson).length || 1;

  return { generatedUrls, inputUrls, promptText, aspectRatio, resolution, count };
}

function videoWorkMeta(work: Work) {
  const promptJson = tryParseJson(work.prompt);
  const paramsJson = tryParseJson(work.generation_params_json || null);
  const referenceUrlsJson = tryParseJson(work.reference_urls_json || null);
  const contentJson = tryParseJson(work.content);
  const promptText = extractPromptText(paramsJson) || extractPromptText(promptJson) || work.prompt || '';
  const aspectRatio = extractStringField(paramsJson, ['aspect_ratio', 'aspectRatio']) || extractStringField(contentJson, ['ratio', 'aspect_ratio']) || '未记录';
  const resolution = extractStringField(paramsJson, ['resolution']) || extractStringField(contentJson, ['resolution']) || '未记录';
  const mode = extractStringField(paramsJson, ['reference_mode', 'referenceMode', 'mode']) || '全能参考';
  const duration = extractDuration(paramsJson) || extractDuration(contentJson) || '未记录';
  const generatedUrl = workUrl(work);
  const inputUrls = uniqueUrls([
    ...collectUrls(referenceUrlsJson),
    ...extractReferenceUrls(paramsJson),
    ...extractReferenceUrls(promptJson),
    ...extractReferenceUrls(contentJson),
  ].filter((url) => url !== generatedUrl));
  return { promptText, aspectRatio, resolution, mode, duration, inputUrls };
}

function extractPromptText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractPromptText(item)).filter(Boolean).join('\n\n');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const direct = record.prompt || record.text || record.description;
    if (typeof direct === 'string') return direct;
    const collection = record.shots || record.segments || record.data;
    if (collection) return extractPromptText(collection);
  }
  return '';
}

function extractReferenceUrls(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => extractReferenceUrls(item));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const explicit = ['reference_urls', 'referenceUrls', 'image_urls', 'imageUrls', 'input_images', 'source_images']
      .flatMap((key) => collectUrls(record[key]));
    const nested = ['shots', 'segments', 'data'].flatMap((key) => extractReferenceUrls(record[key]));
    return uniqueUrls([...explicit, ...nested]);
  }
  return [];
}

function extractStringField(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return '';
}

function extractDuration(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const direct = record.duration || record.duration_seconds || record.durationSeconds;
  if (typeof direct === 'number' && Number.isFinite(direct)) return `${Math.round(direct)}秒`;
  if (typeof direct === 'string' && direct) return /^\d+$/.test(direct) ? `${direct}秒` : direct;
  const segments = record.segments;
  if (Array.isArray(segments)) {
    const total = segments.reduce((sum, item) => {
      if (!item || typeof item !== 'object') return sum;
      const duration = (item as Record<string, unknown>).duration_seconds || (item as Record<string, unknown>).durationSeconds;
      return typeof duration === 'number' && Number.isFinite(duration) ? sum + duration : sum;
    }, 0);
    if (total > 0) return `${Math.round(total)}秒`;
  }
  return '';
}

function durationSecondsFromLabel(value: string | undefined) {
  if (!value || value === '未记录') return undefined;
  const minuteMatch = value.match(/^(\d+(?:\.\d+)?)\s*分钟$/);
  if (minuteMatch) return Math.round(Number(minuteMatch[1]) * 60);
  const secondMatch = value.match(/^(\d+(?:\.\d+)?)\s*秒$/);
  if (secondMatch) return Math.round(Number(secondMatch[1]));
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
}

function normalizeVideoDraftMode(value: string | undefined) {
  if (value === '首尾帧' || value === 'firstLast') return 'firstLast';
  return 'all';
}

function cleanVideoPrompt(value: string | null | undefined) {
  return (value || '').replace(/^\s*\d+\.\s*通用视频[:：]\s*/u, '').trim();
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
  return extractFailureReason(tryParseJson(work.content)) || extractFailureReason(tryParseJson(work.generation_params_json || null)) || work.content || '未返回失败原因';
}

function openImageDraft(draft: { prompt: string; referenceUrls: string[]; aspectRatio: string; resolution: string }) {
  localStorage.setItem('leapai:image-draft', JSON.stringify(draft));
  window.open(`${window.location.origin}${window.location.pathname}#image`, '_blank');
}

function openVideoDraft(draft: { prompt: string; referenceUrls: string[]; aspectRatio: string; resolution: string; mode: string; duration?: number }) {
  localStorage.setItem('leapai:video-draft', JSON.stringify(draft));
  window.open(`${window.location.origin}${window.location.pathname}#video`, '_blank');
}

function openVideoEditDraft(work: Work) {
  const url = workVideoUrl(work);
  if (!url) return;
  localStorage.setItem('leapai:video-edit-draft', JSON.stringify({
    url,
    name: cleanVideoPrompt(work.prompt) || work.title || '我的作品视频',
  }));
  window.location.hash = 'edit';
}

function EmptySection({ type, onGo }: { type: ContentType; onGo: () => void }) {
  const map = {
    video: { title: '暂无视频作品', desc: '开始创作您的第一个视频吧', button: '去创作视频' },
    image: { title: '暂无图片作品', desc: '开始生成您的第一张图片吧', button: '去创作图片' },
    script: { title: '暂无剧本作品', desc: '开始编写您的第一个剧本吧', button: '去创作剧本' },
  } satisfies Record<ContentType, { title: string; desc: string; button: string }>;
  const item = map[type];
  return (
    <div className="flex h-[210px] items-center justify-center rounded-[8px] border border-blue-100 bg-white/65 text-center">
      <div>
        <img src={imageEmpty} alt="" className="mx-auto h-[93px] w-[93px] object-contain" />
        <div className="mt-4 text-lg font-black text-ink">{item.title}</div>
        <div className="mt-2 text-sm font-semibold text-ink/50">{item.desc}</div>
        <button onClick={onGo} className="mt-4 rounded-[8px] bg-primary px-5 py-2 text-sm font-black text-white">{item.button}</button>
      </div>
    </div>
  );
}

function MediaSkeleton() {
  return (
    <div className={`absolute inset-0 ${skeletonClass}`}>
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 rounded-full bg-white/70" />
      </div>
    </div>
  );
}

function AsyncImage({ src, className }: { src: string; className: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    const timer = window.setTimeout(() => setFailed(true), 10000);
    return () => window.clearTimeout(timer);
  }, [src]);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-blue-50 text-center text-blue-300">
        <ImageIcon size={34} />
        <span className="mt-2 text-xs font-bold text-ink/40">封面加载失败</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {!loaded ? <MediaSkeleton /> : null}
      <img
        src={src}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`${className} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

function AsyncVideoCover({ src, className }: { src: string; className: string }) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const timer = window.setTimeout(() => setLoaded(true), 5000);
    return () => window.clearTimeout(timer);
  }, [src]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {!loaded ? <MediaSkeleton /> : null}
      <video
        src={src}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={() => setLoaded(true)}
        onLoadedData={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={className}
      />
    </div>
  );
}

function CardSkeleton({ type }: { type: 'video' | 'image' }) {
  return (
    <article className="card overflow-hidden">
      <div className={`relative ${type === 'video' ? 'aspect-video' : 'aspect-square'} w-full ${skeletonClass}`} />
      <div className="space-y-3 p-4">
        <div className={`h-4 w-11/12 ${skeletonClass}`} />
        <div className={`h-4 w-8/12 ${skeletonClass}`} />
        {type === 'video' ? <div className={`h-3 w-10/12 ${skeletonClass}`} /> : null}
      </div>
    </article>
  );
}

function ScriptSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1.2fr_1.7fr_90px_180px_110px_160px] bg-blue-50/70 px-5 py-4">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className={`h-4 w-16 ${skeletonClass}`} />)}
      </div>
      {Array.from({ length: 3 }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-[1.2fr_1.7fr_90px_180px_110px_160px] items-center gap-4 border-t border-blue-50 px-5 py-4">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className={`h-5 ${index < 2 ? 'w-full' : 'w-16'} ${skeletonClass}`} />)}
        </div>
      ))}
    </div>
  );
}

interface SelectableCardProps {
  work: Work;
  onPreview: (work: Work) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
  onDelete?: (work: Work) => void;
}

function SelectionMark({ selected }: { selected: boolean }) {
  return (
    <span className={`absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border text-white shadow-sm transition ${selected ? 'border-[#2F80FF] bg-[#2F80FF]' : 'border-white/80 bg-black/25'}`}>
      {selected ? <Check size={16} strokeWidth={3} /> : null}
    </span>
  );
}

function VideoCard({ work, onPreview, selectable = false, selected = false, onToggleSelect, onDelete }: SelectableCardProps) {
  const url = workUrl(work);
  const canPreview = isVideoReady(work);
  const reason = failureReason(work);
  const meta = videoWorkMeta(work);
  const durationLabel = meta.duration && meta.duration !== '未记录' ? meta.duration : '视频';
  const resolutionLabel = meta.resolution && meta.resolution !== '未记录' ? meta.resolution : '';
  const ratioLabel = meta.aspectRatio && meta.aspectRatio !== '未记录' ? meta.aspectRatio : '';
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <button type="button" onClick={() => (selectable ? onToggleSelect?.(work.id) : onPreview(work))} className={`card block w-full cursor-pointer overflow-hidden text-left transition hover:-translate-y-0.5 ${selected ? 'ring-2 ring-[#2F80FF]' : ''}`}>
      <div className="relative aspect-square w-full bg-blue-50">
        {selectable ? <SelectionMark selected={selected} /> : null}
        {!selectable ? (
          <>
            <span
              role="button"
              tabIndex={0}
              title="下载"
              onClick={(event) => {
                event.stopPropagation();
                handleDownload(work);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                handleDownload(work);
              }}
              className="absolute left-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[6px] bg-white/70 text-ink/70 shadow-sm backdrop-blur-[12px] transition hover:text-primary"
            >
              <Download size={16} />
            </span>
            <span
              role="button"
              tabIndex={0}
              title="删除"
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.(work);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onDelete?.(work);
              }}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[6px] bg-white/70 text-ink/70 shadow-sm backdrop-blur-[12px] transition hover:text-[#E57373]"
            >
              <Trash2 size={16} />
            </span>
          </>
        ) : null}
        {canPreview ? <AsyncVideoCover src={url} className={`h-full w-full object-cover ${coverFilterClass}`} /> : <div className="flex h-full flex-col items-center justify-center px-5 text-center text-blue-300"><PlaySquare size={56} /><span className={`mt-3 text-sm font-black ${effectiveStatusClass(work)}`}>{effectiveStatusLabel(work)}</span><span className="mt-1 text-xs font-bold text-ink/45">{work.status === 'failed' ? reason : elapsedSinceCreated(work, now)}</span></div>}
        {canPreview ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/35 text-white"><Play size={28} /></span>
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 rounded-full bg-black/55 px-3 py-1 text-xs font-bold text-white">{canPreview ? durationLabel : elapsedSinceCreated(work, now)}</div>
      </div>
      <div className="p-4">
        <div className="line-clamp-2 text-sm font-semibold leading-6 text-ink/70">{cleanVideoPrompt(work.prompt) || '暂无提示词'}</div>
        {reason ? <div className="mt-2 line-clamp-2 rounded-[8px] bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-[#E57373]">失败原因：{reason}</div> : null}
        <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-ink/50">
          <span>{formatWorkTime(work.created_at)}</span>
          <span className="flex min-w-0 items-center gap-2 text-ink/45">
            {resolutionLabel ? <span>{resolutionLabel}</span> : null}
            {ratioLabel ? <span>{ratioLabel}</span> : null}
          </span>
        </div>
      </div>
    </button>
  );
}

function ImageCard({ work, onPreview, selectable = false, selected = false, onToggleSelect }: SelectableCardProps) {
  const url = workUrl(work);
  return (
    <article className={`card overflow-hidden transition ${selected ? 'ring-2 ring-[#2F80FF]' : ''}`}>
      <div className="relative aspect-square w-full bg-blue-50">
        {selectable ? <SelectionMark selected={selected} /> : null}
        <button type="button" onClick={() => (selectable ? onToggleSelect?.(work.id) : onPreview(work))} className="block h-full w-full text-left">
          {url ? <AsyncImage src={url} className={`h-full w-full object-cover ${coverFilterClass}`} /> : <div className="flex h-full items-center justify-center text-blue-300"><ImageIcon size={44} /></div>}
        </button>
        {selectable ? null : (
          <button
            type="button"
            title="下载"
            onClick={() => handleDownload(work)}
            className={floatingDownloadClass}
          >
            <Download size={16} />
          </button>
        )}
      </div>
      <div className="p-4">
        <div className="line-clamp-3 min-h-[72px] text-sm font-semibold leading-6 text-ink/70">{work.prompt || '暂无提示词'}</div>
      </div>
    </article>
  );
}

export default function WorksPage() {
  const [works, setWorks] = useState<Work[]>([]);
  const [counts, setCounts] = useState<Record<ContentType | 'all', number>>({ all: 0, video: 0, image: 0, script: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [previewWork, setPreviewWork] = useState<Work | null>(null);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);
  const [visibleVideoCount, setVisibleVideoCount] = useState(collapsedVideoCount);
  const [isLoadingMoreVideos, setIsLoadingMoreVideos] = useState(false);
  const [visibleImageCount, setVisibleImageCount] = useState(6);
  const [isLoadingMoreImages, setIsLoadingMoreImages] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<number>>(() => new Set());
  const [isLoadingSelectionMedia, setIsLoadingSelectionMedia] = useState(false);

  const loadSummary = () => getWorksSummary().then((summary) => {
    setWorks(summary.items);
    setCounts(summary.counts);
  });

  useEffect(() => {
    let alive = true;
    void getWorksSummary()
      .then((summary) => {
        if (!alive) return;
        setWorks(summary.items);
        setCounts(summary.counts);
      })
      .catch(() => {
        if (!alive) return;
        setWorks([]);
        setCounts({ all: 0, video: 0, image: 0, script: 0 });
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!works.some(isVideoGenerating)) return;
    const timer = window.setInterval(() => {
      void loadSummary();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [works]);

  useEffect(() => {
    if (!isVideoExpanded) {
      setVisibleVideoCount(collapsedVideoCount);
      return;
    }
    setVisibleVideoCount((value) => Math.max(value, expandedVideoPageSize));
  }, [isVideoExpanded]);

  const grouped = useMemo(() => ({
    video: works.filter((work) => work.type === 'video'),
    image: works.filter((work) => work.type === 'image'),
    script: works.filter((work) => work.type === 'script'),
  }), [works]);

  const selectedWorks = useMemo(
    () => works.filter((work) => selectedWorkIds.has(work.id) && (work.type === 'video' || work.type === 'image')),
    [selectedWorkIds, works],
  );

  useEffect(() => {
    if (!isVideoExpanded) return;
    const onScroll = () => {
      const distanceToBottom = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      if (distanceToBottom > 520) return;
      setVisibleVideoCount((value) => Math.min(grouped.video.length, value + expandedVideoPageSize));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [grouped.video.length, isVideoExpanded]);

  const count = (value: ContentType | 'all') => counts[value] || 0;
  const displayedVideoWorks = grouped.video.slice(0, isSelecting ? grouped.video.length : isVideoExpanded ? visibleVideoCount : collapsedVideoCount);
  const displayedImageWorks = isSelecting ? grouped.image : grouped.image.slice(0, visibleImageCount);
  const mergeMediaWorks = (videos: Work[], images: Work[]) => {
    setWorks((items) => {
      const nonMedia = items.filter((work) => work.type !== 'video' && work.type !== 'image');
      return [...videos, ...images, ...nonMedia];
    });
  };
  const loadAllSelectableMedia = () => {
    setIsLoadingSelectionMedia(true);
    void Promise.all([getWorks('video'), getWorks('image')])
      .then(([videos, images]) => mergeMediaWorks(videos, images))
      .finally(() => setIsLoadingSelectionMedia(false));
  };
  const startSelection = () => {
    setIsSelecting(true);
    if (grouped.video.length < count('video') || grouped.image.length < count('image')) {
      loadAllSelectableMedia();
    }
  };
  const cancelSelection = () => {
    setIsSelecting(false);
    setSelectedWorkIds(new Set());
  };
  const toggleSelectedWork = (id: number) => {
    setSelectedWorkIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectedReferenceUrls = () => selectedWorks.map(workUrl).filter(Boolean);
  const selectedPromptText = () => selectedWorks
    .map((work) => (work.type === 'video' ? cleanVideoPrompt(work.prompt) : work.prompt) || work.title)
    .filter(Boolean)
    .join('\n\n');
  const batchDeleteSelected = () => {
    if (!selectedWorks.length) return;
    const removed = selectedWorks.reduce((sum, work) => {
      if (work.type === 'video' || work.type === 'image') sum[work.type] += 1;
      return sum;
    }, { video: 0, image: 0 });
    setWorks((items) => items.filter((work) => !selectedWorkIds.has(work.id)));
    setCounts((items) => ({
      ...items,
      all: Math.max(0, items.all - selectedWorks.length),
      video: Math.max(0, items.video - removed.video),
      image: Math.max(0, items.image - removed.image),
    }));
    cancelSelection();
  };
  const batchDownloadSelected = () => {
    selectedWorks.forEach((work, index) => {
      window.setTimeout(() => handleDownload(work), index * 120);
    });
  };
  const deleteSingleWork = (target: Work) => {
    setWorks((items) => items.filter((work) => work.id !== target.id));
    setCounts((items) => ({
      ...items,
      all: Math.max(0, items.all - 1),
      [target.type]: Math.max(0, items[target.type] - 1),
    }));
    setSelectedWorkIds((current) => {
      const next = new Set(current);
      next.delete(target.id);
      return next;
    });
  };
  const continueVideoWithSelected = () => {
    const referenceUrls = selectedReferenceUrls();
    if (!referenceUrls.length) return;
    localStorage.setItem('leapai:video-draft', JSON.stringify({
      prompt: selectedPromptText(),
      referenceUrls,
      aspectRatio: '16:9',
      resolution: '720p',
      mode: '全能参考',
    }));
    window.location.hash = 'video';
  };
  const editSelectedVideos = () => {
    const videoWorks = selectedWorks.filter((work) => work.type === 'video');
    const target = videoWorks[0];
    const url = target ? workUrl(target) : '';
    if (!url) return;
    localStorage.setItem('leapai:video-edit-draft', JSON.stringify({
      url,
      name: target.title || '拼接视频',
      urls: videoWorks.map(workUrl).filter(Boolean),
    }));
    window.location.hash = 'edit';
  };
  const toggleVideoExpanded = () => {
    if (isVideoExpanded) {
      setIsVideoExpanded(false);
      return;
    }
    setIsVideoExpanded(true);
    if (grouped.video.length >= count('video')) return;
    setIsLoadingMoreVideos(true);
    void getWorks('video')
      .then((videos) => {
        setWorks((items) => {
          const nonVideos = items.filter((work) => work.type !== 'video');
          return [...videos, ...nonVideos];
        });
      })
      .finally(() => setIsLoadingMoreVideos(false));
  };
  const loadMoreImages = () => {
    if (isLoadingMoreImages) return;
    const nextVisibleCount = visibleImageCount <= 6 ? 16 : visibleImageCount + 16;
    if (grouped.image.length >= count('image')) {
      setVisibleImageCount(Math.min(grouped.image.length, nextVisibleCount));
      return;
    }
    setIsLoadingMoreImages(true);
    void getWorks('image')
      .then((images) => {
        setWorks((items) => {
          const nonImages = items.filter((work) => work.type !== 'image');
          return [...images, ...nonImages];
        });
        setVisibleImageCount(Math.min(images.length, nextVisibleCount));
      })
      .finally(() => setIsLoadingMoreImages(false));
  };
  const openPreview = (work: Work) => {
    setPreviewWork(work);
    void getWork(work.id).then(setPreviewWork).catch(() => undefined);
  };

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-4">
          <button className={`flex h-11 items-center gap-3 rounded-[8px] px-5 text-sm font-black text-ink ${mutedControlClass}`}>创建时间 <CalendarDays size={16} /></button>
          <button className={`h-11 rounded-[8px] px-5 text-sm font-black text-ink ${mutedControlClass}`}>全部状态</button>
          <button className={`h-11 rounded-[8px] px-5 text-sm font-black text-ink ${mutedControlClass}`}>全部类型</button>
          <label className={`flex h-11 items-center gap-2 rounded-[8px] px-4 text-sm font-semibold text-ink/50 ${mutedControlClass}`}>
            <Search size={16} />
            <input className="w-40 bg-transparent outline-none" placeholder="搜索作品名称" />
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={isSelecting ? cancelSelection : startSelection}
            className={`flex h-11 items-center gap-2 rounded-[8px] px-5 text-sm font-black text-ink ${mutedControlClass}`}
          >
            {isSelecting ? '取消选择' : '选择操作'}
            {selectedWorks.length ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-primary">{selectedWorks.length}</span> : null}
          </button>
        </div>
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-black text-[#1F2B4D]"><PlaySquare size={20} className="text-[#1F2B4D]" /> 视频 <span className={sectionCountClass}>{count('video')}</span></h2>
          {count('video') > collapsedVideoCount && !isSelecting ? (
            <button
              type="button"
              onClick={toggleVideoExpanded}
              className="text-sm font-black text-[#2F80FF]"
            >
              {isLoadingMoreVideos ? '加载中...' : isVideoExpanded ? '收起' : '展开更多'}
            </button>
          ) : null}
        </div>
        {isLoading ? <div className="grid grid-cols-4 gap-5">{Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} type="video" />)}</div> : grouped.video.length ? <div className="grid grid-cols-4 gap-5">{displayedVideoWorks.map((work) => <VideoCard key={work.id} work={work} onPreview={openPreview} selectable={isSelecting} selected={selectedWorkIds.has(work.id)} onToggleSelect={toggleSelectedWork} onDelete={deleteSingleWork} />)}</div> : <EmptySection type="video" onGo={() => { window.location.hash = 'video'; }} />}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-black text-[#1F2B4D]"><ImageIcon size={20} className="text-[#1F2B4D]" /> 图片 <span className={sectionCountClass}>{count('image')}</span></h2>
          {count('image') > visibleImageCount && !isSelecting ? (
            <button
              type="button"
              onClick={loadMoreImages}
              disabled={isLoadingMoreImages}
              className="text-sm font-black text-[#2F80FF] disabled:opacity-50"
            >
              {isLoadingMoreImages ? '加载中...' : '查看更多'}
            </button>
          ) : null}
        </div>
        {isLoading || isLoadingSelectionMedia ? <div className="grid grid-cols-6 gap-4">{Array.from({ length: 6 }).map((_, index) => <CardSkeleton key={index} type="image" />)}</div> : grouped.image.length ? <div className="grid grid-cols-6 gap-4">{displayedImageWorks.map((work) => <ImageCard key={work.id} work={work} onPreview={openPreview} selectable={isSelecting} selected={selectedWorkIds.has(work.id)} onToggleSelect={toggleSelectedWork} />)}</div> : <EmptySection type="image" onGo={() => { window.location.hash = 'image'; }} />}
      </section>

      <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-black text-[#1F2B4D]"><FileText size={20} className="text-[#1F2B4D]" /> 剧本 <span className={sectionCountClass}>{count('script')}</span></h2>
          </div>
          {isLoading ? <ScriptSkeleton /> : grouped.script.length ? (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-[1.2fr_1.7fr_90px_180px_110px_160px] bg-blue-50/70 px-5 py-4 text-sm font-black text-ink/60">
                <div>提示词</div><div>生成结果</div><div>字数</div><div>创建时间</div><div>状态</div><div>操作</div>
              </div>
              {grouped.script.map((work) => (
                <div key={work.id} className="grid grid-cols-[1.2fr_1.7fr_90px_180px_110px_160px] items-center gap-4 border-t border-blue-50 px-5 py-4 text-sm font-semibold text-ink">
                  <div className="flex items-center gap-3 font-black">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-primary text-primary"><FileText size={16} /></span>
                    <span className="line-clamp-2">{work.prompt || work.title || '暂无提示词'}</span>
                  </div>
                  <div className="line-clamp-2 text-ink/70">{work.content || '暂无生成结果'}</div>
                  <div className="text-primary">{work.content?.length || 0} 字</div>
                  <div className="text-primary">{formatWorkTime(work.created_at)}</div>
                  <div className={statusClass(work.status)}>● {statusLabel(work.status)}</div>
                  <div className="flex gap-5 text-ink/50">
                    <button type="button" title="预览" onClick={() => openPreview(work)} className="transition hover:text-primary"><Eye size={18} /></button>
                    <button type="button" title="编辑" className="transition hover:text-primary"><PencilLine size={18} /></button>
                    <button type="button" title="下载" onClick={() => handleDownload(work)} className="transition hover:text-primary"><Download size={18} /></button>
                    <button type="button" title="更多" className="transition hover:text-primary"><MoreHorizontal size={18} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptySection type="script" onGo={() => { window.location.hash = 'script'; }} />}
      </section>

      {!isLoading && !counts.all ? <div className="pb-4 text-center text-sm font-bold text-blue-300">您还没有任何作品，快去创作属于您的精彩内容吧！</div> : null}
      {isSelecting && selectedWorks.length ? (
        <div className="fixed bottom-5 left-[280px] right-8 z-40 flex items-center gap-5 rounded-[16px] border border-blue-100 bg-white/92 p-4 shadow-[0_18px_50px_rgba(47,128,255,0.18)] backdrop-blur-[18px]">
          <div className="min-w-[220px]">
            <div className="text-base font-black text-ink">已选择 <span className="text-primary">{selectedWorks.length}</span> 项</div>
            <div className="mt-1 text-xs font-semibold text-ink/45">可对选中作品执行批量操作</div>
          </div>
          <button type="button" onClick={batchDeleteSelected} className="flex h-12 flex-1 items-center justify-center gap-3 rounded-[10px] border border-blue-100 bg-white text-sm font-black text-ink shadow-sm transition hover:text-[#E57373]">
            <Trash2 size={18} /> 批量删除
          </button>
          <button type="button" onClick={batchDownloadSelected} className="flex h-12 flex-1 items-center justify-center gap-3 rounded-[10px] border border-blue-100 bg-white text-sm font-black text-ink shadow-sm transition hover:text-primary">
            <Download size={18} /> 批量下载
          </button>
          <button type="button" onClick={continueVideoWithSelected} className="flex h-12 flex-1 items-center justify-center gap-3 rounded-[10px] border border-blue-100 bg-white text-sm font-black text-ink shadow-sm transition hover:text-primary">
            <Sparkles size={18} /> 继续生成
          </button>
          <button type="button" disabled={!selectedWorks.some((work) => work.type === 'video')} onClick={editSelectedVideos} className="flex h-12 flex-1 items-center justify-center gap-3 rounded-[10px] border border-blue-100 bg-white text-sm font-black text-ink shadow-sm transition hover:text-primary disabled:cursor-not-allowed disabled:text-ink/30">
            <Scissors size={18} /> 视频拼接
          </button>
        </div>
      ) : null}
      {previewWork ? <PreviewModal work={previewWork} onClose={() => setPreviewWork(null)} /> : null}
    </div>
  );
}

function PreviewModal({ work, onClose }: { work: Work; onClose: () => void }) {
  const url = workUrl(work);
  const reason = failureReason(work);
  const videoMeta = work.type === 'video' ? videoWorkMeta(work) : null;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  if (work.type === 'image') return <ImageDetailModal work={work} onClose={onClose} />;
  if (work.type === 'video') {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
        <aside className="h-screen w-[calc(100vw-250px)] max-w-[1280px] overflow-auto bg-white shadow-[-24px_0_60px_rgba(23,35,61,0.18)]" onClick={(event) => event.stopPropagation()}>
          <div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-blue-50 bg-white/95 px-8 backdrop-blur">
            <h2 className="text-xl font-black text-ink">视频详情</h2>
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/45 transition hover:bg-blue-50 hover:text-ink">
              <X size={22} />
            </button>
          </div>
          <div className="grid grid-cols-[420px_minmax(0,1fr)] gap-10 px-8 py-8">
            <section>
              {url && isVideoReady(work) ? (
                <video src={url} controls autoPlay className="max-h-[68vh] w-full rounded-[12px] bg-black object-contain shadow-[0_18px_48px_rgba(23,35,61,0.18)]" />
              ) : (
                <div className="flex aspect-[9/16] max-h-[68vh] flex-col items-center justify-center rounded-[12px] bg-blue-50 text-center text-ink/50">
                  <PlaySquare size={64} className="text-blue-300" />
                  <div className={`mt-5 text-xl font-black ${effectiveStatusClass(work)}`}>{effectiveStatusLabel(work)}</div>
                  <div className="mt-2 text-sm font-semibold">{elapsedSinceCreated(work, now)}</div>
                  {reason ? (
                    <div className="mt-4 mx-5 rounded-[10px] bg-red-50 px-5 py-4 text-left text-sm font-semibold leading-6 text-[#E57373]">
                      <div className="mb-1 font-black">失败原因</div>
                      {reason}
                    </div>
                  ) : null}
                </div>
              )}
            </section>
            <section className="space-y-8">
              <div>
                <div className="mb-2 text-sm font-semibold text-ink/45">生成时间</div>
                <div className="text-base font-semibold text-ink">{new Date(work.created_at).toLocaleString()}</div>
              </div>
              <div>
                <div className="mb-3 text-sm font-semibold text-ink/45">参考素材</div>
                {videoMeta?.inputUrls.length ? (
                  <div className="flex flex-wrap gap-3">
                    {videoMeta.inputUrls.map((itemUrl, index) => (
                      <a
                        key={`${itemUrl}-${index}`}
                        href={itemUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative h-20 w-20 overflow-hidden rounded-[10px] bg-blue-50 ring-1 ring-blue-100"
                      >
                        {isVideoUrl(itemUrl) ? (
                          <>
                            <video src={itemUrl} muted preload="metadata" className="h-full w-full object-cover" />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/15 text-white"><Play size={22} /></span>
                          </>
                        ) : (
                          <img src={itemUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                        )}
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[10px] bg-blue-50/60 px-4 py-3 text-sm font-semibold text-ink/45">暂无参考素材</div>
                )}
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold text-ink/45">作品文案</div>
                <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[10px] bg-blue-50/60 p-4 text-sm font-semibold leading-7 text-ink/80">{cleanVideoPrompt(videoMeta?.promptText || work.prompt) || '暂无提示词'}</pre>
              </div>
              <div>
                <div className="mb-3 text-sm font-semibold text-ink/45">生成参数</div>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div className="rounded-[12px] bg-blue-50/60 p-4"><div className="text-xs font-semibold text-ink/45">模式</div><div className="mt-2 text-lg font-black text-ink">{videoMeta?.mode}</div></div>
                  <div className="rounded-[12px] bg-blue-50/60 p-4"><div className="text-xs font-semibold text-ink/45">画质</div><div className="mt-2 text-lg font-black text-ink">{videoMeta?.resolution}</div></div>
                  <div className="rounded-[12px] bg-blue-50/60 p-4"><div className="text-xs font-semibold text-ink/45">比例</div><div className="mt-2 text-lg font-black text-ink">{videoMeta?.aspectRatio}</div></div>
                  <div className="rounded-[12px] bg-blue-50/60 p-4"><div className="text-xs font-semibold text-ink/45">时长</div><div className="mt-2 text-lg font-black text-ink">{videoMeta?.duration}</div></div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => handleDownload(work)} disabled={!isVideoReady(work)} className="gradient-button flex h-10 items-center gap-2 px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50">
                  <Download size={16} /> 下载
                </button>
                <button
                  type="button"
                  onClick={() => openVideoEditDraft(work)}
                  disabled={!isVideoReady(work)}
                  className="secondary-button flex h-10 items-center gap-2 px-4 text-sm font-black text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Scissors size={16} /> 剪辑
                </button>
                <button
                  type="button"
                  onClick={() => openVideoDraft({
                    prompt: cleanVideoPrompt(videoMeta?.promptText || work.prompt),
                    referenceUrls: videoMeta?.inputUrls || [],
                    aspectRatio: videoMeta?.aspectRatio === '未记录' ? '16:9' : videoMeta?.aspectRatio || '16:9',
                    resolution: videoMeta?.resolution === '未记录' ? '720p' : videoMeta?.resolution || '720p',
                    mode: normalizeVideoDraftMode(videoMeta?.mode),
                    duration: durationSecondsFromLabel(videoMeta?.duration),
                  })}
                  className="secondary-button flex h-10 items-center gap-2 px-4 text-sm font-black text-primary"
                >
                  重新生成
                </button>
              </div>
            </section>
          </div>
        </aside>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-[8px] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-blue-50 px-5 py-4">
          <div>
            <div className="text-lg font-black text-ink">{work.title || '未命名作品'}</div>
            <div className="mt-1 text-xs font-semibold text-ink/50">{effectiveStatusLabel(work)} ｜ 创建于 {new Date(work.created_at).toLocaleString()}</div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => handleDownload(work)} className="flex h-10 items-center gap-2 rounded-[8px] border border-blue-100 px-4 text-sm font-black text-primary">
              <Download size={16} /> 下载
            </button>
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-blue-100 text-ink/60">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="max-h-[calc(88vh-76px)] overflow-auto bg-blue-50/40 p-5">
          {work.type === 'script' ? (
            <pre className="whitespace-pre-wrap rounded-[8px] bg-white p-5 text-sm font-semibold leading-7 text-ink">{work.content || '暂无剧本内容'}</pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ImageDetailModal({ work, onClose }: { work: Work; onClose: () => void }) {
  const meta = imageWorkMeta(work);
  const isLandscape = ['16:9', '4:3'].includes(meta.aspectRatio.replace(/\s/g, ''));
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(meta.promptText || '');
  };
  const continueGenerate = () => {
    openImageDraft({
      prompt: meta.promptText,
      referenceUrls: meta.generatedUrls.slice(0, 4),
      aspectRatio: meta.aspectRatio === '未记录' ? '16:9' : meta.aspectRatio,
      resolution: meta.resolution === '未记录' ? '1K' : meta.resolution,
    });
  };
  const regenerate = () => {
    openImageDraft({
      prompt: meta.promptText,
      referenceUrls: meta.inputUrls.slice(0, 4),
      aspectRatio: meta.aspectRatio === '未记录' ? '16:9' : meta.aspectRatio,
      resolution: meta.resolution === '未记录' ? '1K' : meta.resolution,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="h-screen w-[calc(100vw-250px)] max-w-[1280px] overflow-auto bg-white shadow-[-24px_0_60px_rgba(23,35,61,0.18)]" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-blue-50 bg-white/95 px-8 backdrop-blur">
          <h2 className="text-xl font-black text-ink">图片详情</h2>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-[8px] text-ink/45 transition hover:bg-blue-50 hover:text-ink">
            <X size={22} />
          </button>
        </div>

        <div className={`${isLandscape ? 'flex flex-col' : 'grid grid-cols-[420px_minmax(0,1fr)]'} gap-10 px-8 py-8`}>
          <section className="space-y-4">
            <div className="text-sm font-semibold text-ink/45">已生成图片</div>
            {meta.generatedUrls.length ? (
              <div className={meta.generatedUrls.length > 1 ? 'grid grid-cols-2 gap-4' : ''}>
                {meta.generatedUrls.map((imageUrl) => (
                  <a key={imageUrl} href={imageUrl} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={imageUrl}
                      className={`${isLandscape ? 'h-auto w-full' : 'max-h-[68vh] w-full'} rounded-[12px] bg-blue-50 object-contain shadow-[0_18px_48px_rgba(23,35,61,0.12)] ${coverFilterClass}`}
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex aspect-[3/4] max-h-[68vh] items-center justify-center rounded-[12px] bg-blue-50 text-ink/45">
                暂无生成图片
              </div>
            )}
          </section>

          <section className="space-y-8">
            <div>
              <div className="mb-2 text-sm font-semibold text-ink/45">生成时间</div>
              <div className="text-base font-semibold text-ink">{new Date(work.created_at).toLocaleString()} ｜ {statusLabel(work.status)}</div>
            </div>
            <div>
              <div className="mb-3 text-sm font-semibold text-ink/45">参考素材</div>
              {meta.inputUrls.length ? (
                <div className="flex flex-wrap gap-3">
                  {meta.inputUrls.slice(0, 12).map((imageUrl) => (
                    <a
                      key={imageUrl}
                      href={imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group h-20 w-20 overflow-hidden rounded-[10px] bg-blue-50 ring-1 ring-blue-100"
                    >
                      <img src={imageUrl} alt="" className={`h-full w-full object-cover transition group-hover:scale-105 ${coverFilterClass}`} />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="rounded-[10px] bg-blue-50/60 px-4 py-3 text-sm font-semibold text-ink/45">暂无参考素材</div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-ink/45">完整提示词</div>
                <button type="button" onClick={copyPrompt} className="flex items-center gap-1 text-xs font-black text-primary"><Copy size={14} /> 复制</button>
              </div>
              <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[10px] bg-blue-50/60 p-4 text-sm font-semibold leading-7 text-ink/80">
                {meta.promptText || '暂无提示词'}
              </pre>
            </div>

            <div>
              <div className="mb-3 text-sm font-semibold text-ink/45">生成参数</div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="rounded-[12px] bg-blue-50/60 p-4"><div className="text-xs font-semibold text-ink/45">比例</div><div className="mt-2 text-lg font-black text-ink">{meta.aspectRatio}</div></div>
                <div className="rounded-[12px] bg-blue-50/60 p-4"><div className="text-xs font-semibold text-ink/45">分辨率</div><div className="mt-2 text-lg font-black text-ink">{meta.resolution}</div></div>
                <div className="rounded-[12px] bg-blue-50/60 p-4"><div className="text-xs font-semibold text-ink/45">数量</div><div className="mt-2 text-lg font-black text-ink">{meta.count}</div></div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => handleDownload(work)} className="gradient-button flex h-10 items-center gap-2 px-4 text-sm font-black">
                <Download size={16} /> 下载图片
              </button>
              <button type="button" title="使用参考素材及提示词重新生成" onClick={regenerate} className="secondary-button flex h-10 items-center gap-2 px-4 text-sm font-black text-primary">
                <RefreshCcw size={16} /> 重新生成
              </button>
              <button type="button" title="使用本作品作为参考图继续生成" onClick={continueGenerate} className="secondary-button flex h-10 items-center gap-2 px-4 text-sm font-black text-primary">
                <Sparkles size={16} /> 继续生成
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

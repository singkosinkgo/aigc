import { Captions, Camera, Download, Gauge, Maximize, Music2, Pause, Play, PlusCircle, SlidersHorizontal, Sparkles, Trash2, Upload, Volume2 } from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getWorks } from '../lib/api';
import { isVideoReady, workVideoUrl } from '../lib/workStatus';
import type { Work } from '../types';
import imageEmpty from '../assets/image-empty.png';

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '00:00';
  const totalCentiseconds = Math.max(0, Math.round(value * 100));
  const seconds = Math.floor(totalCentiseconds / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(seconds).padStart(2, '0')}:${String(centiseconds).padStart(2, '0')}`;
}

function ratioLabel(width: number, height: number) {
  if (!width || !height) return '16:9';
  return width >= height ? '16:9' : '9:16';
}

function WorkVideoCover({ work }: { work: Work }) {
  const url = workVideoUrl(work);
  const thumbnail = work.thumbnail_url || '';
  return (
    <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-[8px] bg-blue-50">
      {thumbnail ? (
        <img src={thumbnail} className="h-full w-full object-cover" />
      ) : (
        <video src={url} muted preload="metadata" className="h-full w-full object-cover" />
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/10 text-white">
        <Play size={20} fill="currentColor" />
      </span>
    </div>
  );
}

function TimelineVideoFrame({ src, time }: { src: string; time: number }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        video.currentTime = Math.min(Math.max(time, 0), Math.max(video.duration - 0.05, 0));
      }}
      className="aspect-square h-full w-full object-cover"
    />
  );
}

function waitForEvent(target: EventTarget, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`video ${eventName} failed`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function captureVideoThumbnails(src: string, count: number) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  await waitForEvent(video, 'loadedmetadata');
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!duration) return [];
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 135;
  const context = canvas.getContext('2d');
  if (!context) return [];
  const thumbnails: string[] = [];
  for (let index = 0; index < count; index += 1) {
    video.currentTime = Math.min(duration - 0.05, Math.max(0, ((index + 0.5) / count) * duration));
    await waitForEvent(video, 'seeked');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    thumbnails.push(canvas.toDataURL('image/jpeg', 0.72));
  }
  return thumbnails;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('无法导出截图'));
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

export default function VideoEditPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const insertMenuRef = useRef<HTMLDivElement | null>(null);
  const screenshotMenuRef = useRef<HTMLDivElement | null>(null);
  const qualityMenuRef = useRef<HTMLDivElement | null>(null);
  const subtitleMenuRef = useRef<HTMLDivElement | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoName, setVideoName] = useState('');
  const [duration, setDuration] = useState(15);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9 });
  const [range, setRange] = useState({ start: 6.2, end: 8.5 });
  const [works, setWorks] = useState<Work[]>([]);
  const [showWorks, setShowWorks] = useState(false);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [showScreenshotMenu, setShowScreenshotMenu] = useState(false);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showAudioTrack, setShowAudioTrack] = useState(false);
  const [toolTip, setToolTip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const draft = localStorage.getItem('leapai:video-edit-draft');
    if (!draft) return;
    try {
      const parsed = JSON.parse(draft) as { url?: string; name?: string };
      if (parsed.url) {
        setVideoUrl(parsed.url);
        setVideoName(parsed.name || '我的作品视频');
        setCurrentTime(0);
      }
    } catch {
      // Ignore malformed drafts from older sessions.
    } finally {
      localStorage.removeItem('leapai:video-edit-draft');
    }
  }, []);

  useEffect(() => {
    const entry = localStorage.getItem('leapai:video-edit-entry');
    if (entry === 'works') {
      setShowWorks(true);
    }
    localStorage.removeItem('leapai:video-edit-entry');
  }, []);

  useEffect(() => {
    void getWorks('video').then((items) => setWorks(items.filter(isVideoReady))).catch(() => setWorks([]));
  }, []);

  useEffect(() => {
    if (!showInsertMenu && !showScreenshotMenu && !showQualityMenu && !showSubtitleMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        insertMenuRef.current?.contains(target)
        || screenshotMenuRef.current?.contains(target)
        || qualityMenuRef.current?.contains(target)
        || subtitleMenuRef.current?.contains(target)
      ) return;
      setShowInsertMenu(false);
      setShowScreenshotMenu(false);
      setShowQualityMenu(false);
      setShowSubtitleMenu(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [showInsertMenu, showScreenshotMenu, showQualityMenu, showSubtitleMenu]);

  useEffect(() => () => {
    if (videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl) {
      setThumbnails([]);
      return;
    }
    let alive = true;
    setThumbnails([]);
    void captureVideoThumbnails(videoUrl, 8)
      .then((items) => {
        if (alive) setThumbnails(items);
      })
      .catch(() => {
        if (alive) setThumbnails([]);
      });
    return () => {
      alive = false;
    };
  }, [videoUrl, duration]);

  const tickMarks = useMemo(() => {
    const base = [0, 2, 4, 6, 8, 10, 12, duration].filter((item, index, items) => (
      item >= 0 && item <= duration && items.indexOf(item) === index
    ));
    return base.sort((a, b) => a - b);
  }, [duration]);

  const chooseLocalVideo = (file: File | undefined) => {
    if (!file) return;
    if (videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoName(file.name);
    setCurrentTime(0);
  };

  const selectWork = (work: Work) => {
    const url = workVideoUrl(work);
    if (!url) return;
    if (videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
    setVideoUrl(url);
    setVideoName(work.prompt || work.title || '我的作品视频');
    setShowWorks(false);
    setCurrentTime(0);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const downloadScreenshot = async (time: number, label: string) => {
    const video = videoRef.current;
    if (!video) return;
    const wasPlaying = !video.paused;
    const previousTime = video.currentTime;
    const targetTime = Math.min(Math.max(time, 0), Math.max(duration - 0.05, 0));
    try {
      if (wasPlaying) video.pause();
      if (Math.abs(video.currentTime - targetTime) > 0.03) {
        video.currentTime = targetTime;
        await waitForEvent(video, 'seeked');
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建截图画布');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `leapai-${label}-${formatTime(time).replace(':', '-')}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.alert('当前视频暂时无法截图下载，可能是视频源未允许浏览器读取画面。');
    } finally {
      if (Math.abs(video.currentTime - previousTime) > 0.03) {
        video.currentTime = previousTime;
      }
      if (wasPlaying) void video.play();
    }
  };

  const downloadVideo = async () => {
    if (!videoUrl) return;
    const filename = `${videoName || 'leapai-video'}.mp4`.replace(/[\\/:*?"<>|]/g, '-');
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = videoUrl;
      anchor.download = filename;
      anchor.target = '_blank';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  };

  const updateStart = (value: number) => {
    setRange((item) => ({ ...item, start: Math.min(value, item.end - 0.2) }));
  };

  const updateEnd = (value: number) => {
    setRange((item) => ({ ...item, end: Math.max(value, item.start + 0.2) }));
  };

  const timeFromPointer = (clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return percent * duration;
  };

  const seekVideo = (time: number) => {
    const nextTime = Math.min(Math.max(time, 0), duration);
    setCurrentTime(nextTime);
    if (videoRef.current) videoRef.current.currentTime = nextTime;
  };

  const toolTipEvents = (text: string) => ({
    onMouseEnter: (event: MouseEvent<HTMLElement>) => setToolTip({ text, x: event.clientX, y: event.clientY }),
    onMouseMove: (event: MouseEvent<HTMLElement>) => setToolTip({ text, x: event.clientX, y: event.clientY }),
    onMouseLeave: () => setToolTip(null),
  });

  useEffect(() => {
    if (!draggingHandle) return;
    const onMove = (event: PointerEvent) => {
      const nextTime = timeFromPointer(event.clientX);
      if (draggingHandle === 'start') updateStart(nextTime);
      else updateEnd(nextTime);
    };
    const onUp = () => setDraggingHandle(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingHandle, duration, range.end, range.start]);

  useEffect(() => {
    if (!draggingPlayhead) return;
    const onMove = (event: PointerEvent) => seekVideo(timeFromPointer(event.clientX));
    const onUp = () => setDraggingPlayhead(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingPlayhead, duration]);

  const hasVideo = Boolean(videoUrl);
  const startPercent = (range.start / duration) * 100;
  const endPercent = (range.end / duration) * 100;
  const playheadPercent = (currentTime / duration) * 100;

  return (
    <div className="space-y-6">
      <section>
        {!hasVideo ? (
          <div className="flex min-h-[620px] flex-col items-center justify-center text-center">
            <img src={imageEmpty} className="h-[260px] w-[260px] object-contain" />
            <div className="mt-5 text-2xl font-black text-ink">选择视频后开始剪辑</div>
            <div className="mt-3 text-sm font-semibold text-ink/50">从已有作品选择，或上传本地视频进行预览和时间轴编辑</div>
            <div className="relative mt-8 flex gap-4">
              <button type="button" onClick={() => setShowWorks((value) => !value)} className="gradient-button h-12 px-6 text-base font-black">
                从我的作品选择
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="secondary-button flex h-12 items-center gap-2 px-6 text-base font-black">
                <Upload size={20} /> 上传本地视频
              </button>
              {showWorks ? (
                <div className="absolute left-0 top-[calc(100%+12px)] z-20 max-h-72 w-[360px] overflow-auto rounded-[12px] bg-white p-3 text-left shadow-[0_18px_48px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                  {works.length ? works.slice(0, 8).map((work) => (
                    <button key={work.id} type="button" onClick={() => selectWork(work)} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-3 text-left text-sm font-bold text-ink hover:bg-blue-50">
                      <WorkVideoCover work={work} />
                      <span className="line-clamp-2 min-w-0 flex-1">{work.prompt || work.title || `视频 ${work.id}`}</span>
                    </button>
                  )) : <div className="px-3 py-4 text-sm font-bold text-ink/45">暂无可选择的视频作品</div>}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div>
            <div className="relative overflow-hidden rounded-[12px] bg-black">
              <video
                ref={videoRef}
                src={videoUrl}
                className="aspect-video w-full bg-black object-contain"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  const nextDuration = Number.isFinite(video.duration) ? video.duration : 15;
                  setDuration(nextDuration);
                  setRange({ start: Math.min(6.2, nextDuration * 0.4), end: Math.min(8.5, nextDuration * 0.7) });
                  setVideoSize({ width: video.videoWidth || 16, height: video.videoHeight || 9 });
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              <button
                type="button"
                onClick={() => void downloadVideo()}
                className="absolute right-4 top-4 flex items-center gap-2 rounded-[8px] bg-white/90 px-4 py-2 text-base font-black text-primary shadow-soft transition hover:bg-white"
              >
                <Download size={18} /> 导出
              </button>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-5 bg-gradient-to-t from-black/75 to-transparent px-6 py-5 text-white">
                <button type="button" onClick={togglePlay}>{isPlaying ? <Pause size={32} /> : <Play size={32} />}</button>
                <Volume2 size={30} />
                <span className="text-lg font-semibold">{formatTime(currentTime)} / {formatTime(duration)}</span>
                <div className="ml-auto flex items-center gap-5">
                  <div ref={screenshotMenuRef} className="relative">
                    <button
                      type="button"
                      {...toolTipEvents('截取当前画面')}
                      onClick={() => {
                        setToolTip(null);
                        setShowScreenshotMenu((value) => !value);
                      }}
                      className="flex items-center justify-center transition hover:text-primary"
                      aria-label="截图"
                    >
                      <Camera size={28} />
                    </button>
                    {showScreenshotMenu ? (
                      <div className="absolute bottom-[calc(100%+14px)] right-0 z-20 w-44 overflow-hidden rounded-[10px] bg-white py-2 text-left text-ink shadow-[0_14px_36px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                        <button
                          type="button"
                          onClick={() => {
                            setShowScreenshotMenu(false);
                            void downloadScreenshot(currentTime, '当前');
                          }}
                          className="flex w-full items-center px-4 py-3 text-sm font-bold hover:bg-blue-50"
                        >
                          截图保存本地
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowScreenshotMenu(false)}
                          className="flex w-full items-center px-4 py-3 text-sm font-bold hover:bg-blue-50"
                        >
                          截图重新生成
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div ref={qualityMenuRef} className="relative">
                    <button
                      type="button"
                      {...toolTipEvents('画质增强或压缩')}
                      onClick={() => {
                        setToolTip(null);
                        setShowQualityMenu((value) => !value);
                      }}
                      className="flex items-center justify-center transition hover:text-primary"
                      aria-label="画质增强"
                    >
                      <SlidersHorizontal size={28} />
                    </button>
                    {showQualityMenu ? (
                      <div className="absolute bottom-[calc(100%+14px)] right-0 z-20 w-32 overflow-hidden rounded-[10px] bg-white py-2 text-left text-ink shadow-[0_14px_36px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                        {['480p', '720p', '1080p', '2K', '4K'].map((label) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setShowQualityMenu(false)}
                            className="flex w-full items-center px-4 py-3 text-sm font-bold hover:bg-blue-50"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Maximize size={30} />
                </div>
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-5 flex justify-between text-lg font-black text-ink">
                {tickMarks.map((mark) => (
                  <span key={mark}>{formatTime(mark)}</span>
                ))}
              </div>
              <div ref={timelineRef} className="relative h-[92px] overflow-visible rounded-[10px] bg-black/90">
                <div className="grid h-full grid-cols-8 gap-px overflow-hidden rounded-[10px] bg-white/50">
                  {thumbnails.length === 8
                    ? thumbnails.map((thumbnail, index) => (
                      <div key={thumbnail} className="flex h-full items-center justify-center overflow-hidden bg-black">
                        <img src={thumbnail} className="aspect-square h-full w-full object-cover" />
                      </div>
                    ))
                    : Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className="flex h-full items-center justify-center overflow-hidden bg-black">
                        <TimelineVideoFrame src={videoUrl} time={((index + 0.5) / 8) * duration} />
                      </div>
                    ))}
                </div>
                <div
                  className="absolute inset-y-0 rounded-[6px] border-4 border-primary"
                  style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
                />
                <div className="absolute -top-8 rounded-[6px] bg-primary px-2 py-1 text-sm font-bold text-white" style={{ left: `calc(${startPercent}% - 18px)` }}>{formatTime(range.start)}</div>
                <div className="absolute -top-8 rounded-[6px] bg-primary px-2 py-1 text-sm font-bold text-white" style={{ left: `calc(${endPercent}% - 18px)` }}>{formatTime(range.end)}</div>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setDraggingPlayhead(true);
                    seekVideo(timeFromPointer(event.clientX));
                  }}
                  className="absolute -top-3 z-20 h-[116px] w-8 -translate-x-1/2 cursor-ew-resize"
                  style={{ left: `${playheadPercent}%` }}
                  aria-label="播放指针"
                >
                  <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-[6px] bg-[#A35CFF] px-2 py-1 text-sm font-bold text-white">
                    {formatTime(currentTime)}
                  </span>
                  <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-[#A35CFF] shadow-[0_0_0_3px_rgba(163,92,255,0.18)]" />
                  <span className="absolute bottom-[-2px] left-1/2 top-3 w-[3px] -translate-x-1/2 rounded-full bg-[#A35CFF]" />
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setDraggingHandle('start');
                  }}
                  className="absolute top-[-8px] h-[108px] w-6 cursor-ew-resize rounded-full bg-primary"
                  style={{ left: `calc(${startPercent}% - 12px)` }}
                >
                  <span className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setDraggingHandle('end');
                  }}
                  className="absolute top-[-8px] h-[108px] w-6 cursor-ew-resize rounded-full bg-primary"
                  style={{ left: `calc(${endPercent}% - 12px)` }}
                >
                  <span className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </button>
              </div>
            </div>

            {showAudioTrack ? (
              <div className="mt-5 flex h-16 items-center gap-3 rounded-[8px] bg-cyan-50/80 px-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] bg-teal-500 text-white">
                  <Music2 size={24} />
                </span>
                <div className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-full bg-cyan-100/80 px-2">
                  <div className="h-6 w-full bg-[repeating-linear-gradient(90deg,rgba(20,184,166,0.95)_0_2px,transparent_2px_6px,rgba(20,184,166,0.55)_6px_8px,transparent_8px_12px)]" />
                </div>
              </div>
            ) : null}

            <div className="mt-8 grid grid-cols-6 gap-3">
              {[
                { label: '修复', icon: Sparkles, tip: '重新生成蓝色框中片段' },
                { label: '删除', icon: Trash2, tip: '删除蓝色框中片段' },
                { label: '插入', icon: PlusCircle, tip: '在紫色指针位置插入片段' },
                { label: '变速', icon: Gauge, tip: '蓝色框中片段变速' },
                { label: '字幕', icon: Captions, tip: '增加或擦除字幕' },
                { label: '声音', icon: Music2, tip: '声音分离' },
              ].map((tool) => {
                const Icon = tool.icon;
                if (tool.label === '插入') {
                  return (
                    <div key={tool.label} ref={insertMenuRef} className="relative">
                      <button
                        type="button"
                        {...toolTipEvents(tool.tip)}
                        onClick={() => {
                          setToolTip(null);
                          setShowInsertMenu((value) => !value);
                        }}
                        className="secondary-button flex h-20 w-full items-center justify-center gap-2 text-lg font-black"
                      >
                        <Icon size={30} /> {tool.label}
                      </button>
                      {showInsertMenu ? (
                        <div className="absolute bottom-[calc(100%+10px)] left-0 z-20 w-full overflow-hidden rounded-[10px] bg-white py-2 text-left shadow-[0_14px_36px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                          {['从本地上传', '插入我的作品'].map((label) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setShowInsertMenu(false)}
                              className="flex w-full items-center px-4 py-3 text-base font-bold text-ink hover:bg-blue-50"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                if (tool.label === '截图') {
                  return (
                    <div key={tool.label} ref={screenshotMenuRef} className="relative">
                      <button
                        type="button"
                        {...toolTipEvents(tool.tip)}
                        onClick={() => {
                          setToolTip(null);
                          setShowScreenshotMenu((value) => !value);
                        }}
                        className="secondary-button flex h-20 w-full items-center justify-center gap-2 text-lg font-black"
                      >
                        <Icon size={30} /> {tool.label}
                      </button>
                      {showScreenshotMenu ? (
                        <div className="absolute bottom-[calc(100%+10px)] left-0 z-20 w-full overflow-hidden rounded-[10px] bg-white py-2 text-left shadow-[0_14px_36px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                          <button
                            type="button"
                            onClick={() => {
                              setShowScreenshotMenu(false);
                              void downloadScreenshot(currentTime, '当前');
                            }}
                            className="flex w-full items-center px-4 py-3 text-base font-bold text-ink hover:bg-blue-50"
                          >
                            截图保存本地
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowScreenshotMenu(false)}
                            className="flex w-full items-center px-4 py-3 text-base font-bold text-ink hover:bg-blue-50"
                          >
                            截图重新生成
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                }
                if (tool.label === '画质') {
                  return (
                    <div key={tool.label} ref={qualityMenuRef} className="relative">
                      <button
                        type="button"
                        {...toolTipEvents(tool.tip)}
                        onClick={() => {
                          setToolTip(null);
                          setShowQualityMenu((value) => !value);
                        }}
                        className="secondary-button flex h-20 w-full items-center justify-center gap-2 text-lg font-black"
                      >
                        <Icon size={30} /> {tool.label}
                      </button>
                      {showQualityMenu ? (
                        <div className="absolute bottom-[calc(100%+10px)] left-0 z-20 w-full overflow-hidden rounded-[10px] bg-white py-2 text-left shadow-[0_14px_36px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                          {['480p', '720p', '1080p', '2K', '4K'].map((label) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setShowQualityMenu(false)}
                              className="flex w-full items-center px-4 py-3 text-base font-bold text-ink hover:bg-blue-50"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                if (tool.label === '字幕') {
                  return (
                    <div key={tool.label} ref={subtitleMenuRef} className="relative">
                      <button
                        type="button"
                        {...toolTipEvents(tool.tip)}
                        onClick={() => {
                          setToolTip(null);
                          setShowSubtitleMenu((value) => !value);
                        }}
                        className="secondary-button flex h-20 w-full items-center justify-center gap-2 text-lg font-black"
                      >
                        <Icon size={26} /> {tool.label}
                      </button>
                      {showSubtitleMenu ? (
                        <div className="absolute bottom-[calc(100%+10px)] left-0 z-20 w-full overflow-hidden rounded-[10px] bg-white py-2 text-left shadow-[0_14px_36px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                          {['增加', '擦除'].map((label) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setShowSubtitleMenu(false)}
                              className="flex w-full items-center px-4 py-3 text-base font-bold text-ink hover:bg-blue-50"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                if (tool.label === '声音') {
                  return (
                    <button
                      key={tool.label}
                      type="button"
                      {...toolTipEvents(tool.tip)}
                      onClick={() => {
                        setToolTip(null);
                        setShowAudioTrack(true);
                      }}
                      className="secondary-button flex h-20 items-center justify-center gap-2 text-lg font-black"
                    >
                      <Icon size={26} /> {tool.label}
                    </button>
                  );
                }
                return (
                  <button key={tool.label} type="button" {...toolTipEvents(tool.tip)} className="secondary-button flex h-20 items-center justify-center gap-2 text-lg font-black">
                    <Icon size={26} /> {tool.label}
                  </button>
                );
              })}
            </div>
            {toolTip ? (
              <div
                className="pointer-events-none fixed z-[80] max-w-[220px] -translate-x-[calc(100%+12px)] -translate-y-[calc(100%+12px)] rounded-[8px] bg-ink px-3 py-2 text-sm font-bold leading-5 text-white shadow-[0_12px_28px_rgba(23,35,61,0.18)]"
                style={{ left: toolTip.x, top: toolTip.y }}
              >
                {toolTip.text}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(event) => chooseLocalVideo(event.target.files?.[0])} />
    </div>
  );
}

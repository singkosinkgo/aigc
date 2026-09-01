import { resultUrlsFromContent } from './shotParser';
import type { Work } from '../types';

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function nestedStatus(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const direct = record.status || record.state;
  if (typeof direct === 'string') return direct.toLowerCase();
  const data = record.data || record.content;
  if (data && typeof data === 'object') return nestedStatus(data);
  return '';
}

export function workVideoUrl(work: Work) {
  return (
    resultUrlsFromContent(work.file_url)[0]
    || resultUrlsFromContent(work.content)[0]
    || resultUrlsFromContent(work.thumbnail_url)[0]
    || ''
  );
}

export function isVideoGenerating(work: Work) {
  if (work.type !== 'video') return false;
  if (work.status === 'failed') return false;
  const modelStatus = nestedStatus(parseJson(work.content));
  if (['running', 'processing', 'pending', 'queued', 'created'].includes(modelStatus)) return true;
  return !workVideoUrl(work);
}

export function isVideoReady(work: Work) {
  return work.type === 'video' && work.status === 'completed' && Boolean(workVideoUrl(work)) && !isVideoGenerating(work);
}

export function effectiveStatusLabel(work: Work) {
  if (isVideoGenerating(work)) return '生成中';
  if (work.status === 'completed') return '已完成';
  if (work.status === 'failed') return '生成失败';
  return '生成中';
}

export function effectiveStatusClass(work: Work) {
  if (isVideoGenerating(work)) return 'text-[#2F80FF]';
  if (work.status === 'completed') return 'text-[#38A169]';
  if (work.status === 'failed') return 'text-[#E57373]';
  return 'text-[#2F80FF]';
}

export function elapsedSinceCreated(work: Work, now: number) {
  const createdAt = new Date(work.created_at).getTime();
  if (!Number.isFinite(createdAt)) return '已生成';
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (seconds < 60) return '已生成不到1分钟';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `已生成${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `已生成${hours}小时`;
  return `已生成${Math.floor(hours / 24)}天`;
}

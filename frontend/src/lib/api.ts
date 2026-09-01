import axios from 'axios';
import type { Character, ContentType, GenerateResponse, ModelConfig, User, Work, WorksSummary } from '../types';

export const api = axios.create({
  baseURL: import.meta.env.PROD ? '/aigc-api' : '/api',
  timeout: 600000,
});

export async function getMe() {
  const { data } = await api.get<User>('/me');
  return data;
}

export async function getWorks(type?: ContentType) {
  const { data } = await api.get<Work[]>('/works', { params: type ? { work_type: type } : undefined });
  return data;
}

export async function getWorksSummary() {
  try {
    const { data } = await api.get<WorksSummary>('/works/summary');
    return data;
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 404) throw error;
    const items = await getWorks();
    const counts = {
      all: items.length,
      video: items.filter((work) => work.type === 'video').length,
      image: items.filter((work) => work.type === 'image').length,
      script: items.filter((work) => work.type === 'script').length,
    };
    return {
      counts,
      items: [
        ...items.filter((work) => work.type === 'video').slice(0, 4),
        ...items.filter((work) => work.type === 'image').slice(0, 7),
        ...items.filter((work) => work.type === 'script').slice(0, 5),
      ],
    };
  }
}

export async function getWork(id: number) {
  const { data } = await api.get<Work>(`/works/${id}`);
  return data;
}

export async function getModelConfigs(type?: ContentType) {
  const { data } = await api.get<ModelConfig[]>('/model-configs', { params: type ? { config_type: type } : undefined });
  return data;
}

export async function createModelConfig(payload: Partial<ModelConfig>) {
  const { data } = await api.post<ModelConfig>('/model-configs', payload);
  return data;
}

export async function updateModelConfig(id: number, payload: Partial<ModelConfig>) {
  const { data } = await api.put<ModelConfig>(`/model-configs/${id}`, payload);
  return data;
}

export async function getModelConfigSecret(id: number) {
  const { data } = await api.get<{ api_key: string | null }>(`/model-configs/${id}/secret`);
  return data;
}

export async function copyModelConfig(id: number) {
  const { data } = await api.post<ModelConfig>(`/model-configs/${id}/copy`);
  return data;
}

export async function deleteModelConfig(id: number) {
  const { data } = await api.delete<{ ok: boolean }>(`/model-configs/${id}`);
  return data;
}

export async function getCharacters(params?: { gender?: string; query?: string }) {
  const { data } = await api.get<Character[]>('/characters', { params });
  return data;
}

export async function createCharacter(payload: Partial<Character>) {
  const { data } = await api.post<Character>('/characters', payload);
  return data;
}

export async function updateCharacter(id: number, payload: Partial<Character>) {
  const { data } = await api.put<Character>(`/characters/${id}`, payload);
  return data;
}

export async function deleteCharacter(id: number) {
  const { data } = await api.delete<{ ok: boolean }>(`/characters/${id}`);
  return data;
}

export async function generateScript(payload: { prompt: string; script_type: string; duration_seconds: number }) {
  const { data } = await api.post<GenerateResponse>('/generate/script', payload);
  return data;
}

export async function generateImages(payload: {
  aspect_ratio: string;
  resolution: string;
  shots: Array<{ title: string; duration_seconds: number; prompt: string; reference_urls: string[] }>;
}) {
  const { data } = await api.post<GenerateResponse>('/generate/images', payload);
  return data;
}

export async function generateVideo(payload: {
  aspect_ratio: string;
  resolution: string;
  segments: Array<{
    title: string;
    duration_seconds: number;
    prompt: string;
    image_urls: string[];
    image_inputs?: Array<{ type: 'image_url'; image_url: { url: string }; role: 'first_frame' | 'last_frame' }>;
    video_urls?: string[];
    audio_urls?: string[];
  }>;
}) {
  const { data } = await api.post<GenerateResponse>('/generate/video', payload);
  return data;
}

export async function uploadImage(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ url: string }>('/uploads/images', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function uploadMedia(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ url: string; type: 'image' | 'video' | 'audio' | 'file' }>('/uploads/media', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export function getErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    return String(error.response?.data?.detail || error.message);
  }
  return error instanceof Error ? error.message : '请求失败';
}

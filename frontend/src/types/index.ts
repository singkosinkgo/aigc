export type ContentType = 'script' | 'image' | 'video';
export type ModelConfigType = ContentType | 'storage';

export interface User {
  id: number;
  nickname: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  balance: string;
}

export interface Work {
  id: number;
  user_id: number;
  title: string | null;
  type: ContentType;
  prompt: string | null;
  generation_params_json?: string | null;
  reference_urls_json?: string | null;
  content: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  model_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface WorksSummary {
  counts: Record<ContentType | 'all', number>;
  items: Work[];
}

export interface ModelConfig {
  id: number;
  user_id: number;
  name: string;
  type: ModelConfigType;
  endpoint: string;
  api_key?: string | null;
  api_key_masked?: string | null;
  method: string;
  headers_json?: Record<string, unknown> | null;
  params_json?: Record<string, unknown> | null;
  portrait_url?: string | null;
  result_path?: string | null;
  task_id_path?: string | null;
  task_query_endpoint?: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type CharacterGender = '女' | '男' | '未知';
export type CharacterAssetType = 'image' | 'video' | 'audio' | 'file';

export interface CharacterAsset {
  type: CharacterAssetType;
  category?: 'three_view' | 'expression' | 'audio' | 'video' | null;
  url?: string | null;
  name?: string | null;
  mime_type?: string | null;
  size?: number | null;
}

export interface Character {
  id: number;
  user_id: number;
  name: string;
  gender: CharacterGender;
  birthplace?: string | null;
  age?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  skin_tone?: string | null;
  hairstyle?: string | null;
  clothing_style?: string | null;
  intro: string;
  tone?: string | null;
  portraits: number;
  voices: number;
  videos: number;
  memories: number;
  assets: CharacterAsset[];
  memory_files: CharacterAsset[];
  thinking_model: 'preset' | 'custom';
  model_endpoint?: string | null;
  model_format?: string | null;
  api_key?: string | null;
  api_key_masked?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Shot {
  id: string;
  title: string;
  duration_seconds: number;
  description: string;
  prompt: string;
  imageUrls: string[];
  selected: boolean;
}

export interface GenerateResponse {
  work: Work;
  raw_result?: unknown;
}

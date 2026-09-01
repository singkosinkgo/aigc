import type { Shot } from '../types';

function cleanMarkdown(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .trim();
}

function parseNumberedShots(text: string): Shot[] {
  const clean = cleanMarkdown(text);
  const headingPattern = /^\s*(?:镜头\s*)?(\d+)[、.]\s*(.+?)\s*\/\s*(\d+)\s*秒\s*$/gm;
  const matches = Array.from(clean.matchAll(headingPattern));
  if (!matches.length) return [];

  return matches.slice(0, 12).map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || clean.length : clean.length;
    const block = clean.slice(start, end).trim();
    const description = block
      .replace(/^(角色\/场景|角色|场景|分镜\/画面\/旁白\/BGM|分镜运镜、画面、旁白、BGM|分镜|画面|旁白|BGM|提示)[:：]\s*/gm, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    const promptLine = block.match(/(?:提示|prompt|画面)[:：]\s*(.+)/i);

    return {
      id: `${index + 1}`.padStart(2, '0'),
      title: match[2].trim().slice(0, 18) || `分镜 ${index + 1}`,
      duration_seconds: Number(match[3]) || 5,
      description: description.slice(0, 220),
      prompt: (promptLine?.[1] || description || match[2]).trim().slice(0, 240),
      imageUrls: [],
      selected: index < 3,
    };
  });
}

function fallbackShots(text: string): Shot[] {
  const numbered = parseNumberedShots(text);
  if (numbered.length) return numbered;

  const clean = cleanMarkdown(text);
  const dramaMatches = Array.from(clean.matchAll(/^\s*分镜\s*(\d+)\s*$/gm));
  if (dramaMatches.length) {
    return dramaMatches.slice(0, 12).map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = index + 1 < dramaMatches.length ? dramaMatches[index + 1].index || clean.length : clean.length;
      const block = clean.slice(start, end).trim();
      const image = block.match(/画面[:：]\s*([\s\S]*?)(?=\n\s*对白[:：]?|\n角色|$)/)?.[1]?.trim() || '';
      const camera = block.match(/运镜[:：]\s*([\s\S]*?)(?=\n\s*(画面|对白)[:：]?|\n角色|$)/)?.[1]?.trim() || '';
      const dialogue = block.match(/对白[:：]?\s*([\s\S]*)$/)?.[1]?.trim() || '';
      const description = [camera ? `运镜：${camera}` : '', image ? `画面：${image}` : '', dialogue ? `对白：${dialogue}` : '']
        .filter(Boolean)
        .join('\n');
      return {
        id: `${index + 1}`.padStart(2, '0'),
        title: `分镜 ${match[1] || index + 1}`,
        duration_seconds: 5,
        description: description || block.slice(0, 220),
        prompt: image || block.slice(0, 240),
        imageUrls: [],
        selected: index < 3,
      };
    });
  }

  const chunks = clean
    .split(/\n{2,}|(?=镜头\s*\d+)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const source = chunks.length > 1 ? chunks : [clean || '请在模型配置后生成剧本'];
  return source.slice(0, 8).map((chunk, index) => ({
    id: `${index + 1}`.padStart(2, '0'),
    title: chunk.split(/[：:\n]/)[0].replace(/^\d+[.、]\s*/, '').slice(0, 16) || `分镜 ${index + 1}`,
    duration_seconds: index === 0 ? 5 : 7,
    description: chunk.slice(0, 90),
    prompt: chunk.slice(0, 240),
    imageUrls: [],
    selected: index < 3,
  }));
}

export function parseShotsFromWorkContent(content: string | null): Shot[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    const array = Array.isArray(parsed) ? parsed : parsed.shots || parsed.scenes || parsed.data;
    if (Array.isArray(array)) {
      return array.slice(0, 12).map((item: Record<string, unknown>, index: number) => ({
        id: `${index + 1}`.padStart(2, '0'),
        title: String(item.title || item.name || item.scene || `分镜 ${index + 1}`).slice(0, 18),
        duration_seconds: Number(item.duration_seconds || item.duration || 5),
        description: String(item.description || item.content || item.text || item.prompt || ''),
        prompt: String(item.prompt || item.image_prompt || item.description || item.content || ''),
        imageUrls: Array.isArray(item.imageUrls) ? (item.imageUrls as string[]) : [],
        selected: index < 3,
      }));
    }
  } catch {
    return fallbackShots(content);
  }
  return fallbackShots(content);
}

export function resultUrlsFromContent(content: string | null): string[] {
  if (!content) return [];

  const collect = (value: unknown): string[] => {
    if (!value) return [];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^(https?:\/\/|data:image\/)/.test(trimmed)) return [trimmed];
      return [
        ...(value.match(/https?:\/\/[^\s"'<>）)]+/g) || []),
        ...(value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g) || []),
      ];
    }
    if (Array.isArray(value)) return value.flatMap((item) => collect(item));
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap((item) => collect(item));
    return [];
  };

  try {
    const parsed = JSON.parse(content);
    const urls = collect(parsed);
    if (urls.length) return urls;
  } catch {
    return collect(content);
  }
  return collect(content);
}

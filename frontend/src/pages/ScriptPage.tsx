import { Clapperboard, ImagePlus, Mic2, PlaySquare, Plus, Save, Sparkles, Video, Wand2, X } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { createCharacter, generateScript, getCharacters, getErrorMessage } from '../lib/api';
import { parseShotsFromWorkContent } from '../lib/shotParser';
import type { Character, CharacterGender, Shot, Work } from '../types';
import { GhostButton, PrimaryButton } from '../components/Controls';
import imageEmpty from '../assets/image-empty.png';
import roleFemale from '../assets/role-female.png';
import roleMale from '../assets/role-male.png';
import roleUnknown from '../assets/role-unknown.png';

const scriptTabs = [
  { key: '广告片', label: '通用', icon: Wand2 },
  { key: '微短剧', label: '微短剧', icon: Clapperboard },
  { key: '口播稿', label: '口播稿', icon: Mic2 },
];

const generalDurations = [5, 15, 30, 45, 60];
const dramaDurations = [15, 30, 45, 60, 90, 120, 180, 300];
const longDurations = [5, 30, 45, 60, 90, 120, 180, 300];
const durationLabels: Record<number, string> = {
  5: '5秒',
  15: '15秒',
  30: '30秒',
  45: '45秒',
  60: '1分钟',
  90: '1.5分钟',
  120: '2分钟',
  180: '3分钟',
  300: '5分钟',
};

const dramaStyles = ['通用', '喜剧', '都市', '家庭', '校园', '青春', '悬疑', '科幻', '玄幻', '武侠', '战争', '穿越'];

function requiredMark() {
  return <span className="ml-1 text-red-500">*</span>;
}

function formatDurationLabel(seconds: number) {
  return durationLabels[seconds] || `${seconds}秒`;
}

function characterMemory(role: Character) {
  const names = (role.memory_files || []).map((item) => item.name).filter(Boolean);
  return names.length ? `记忆资料：${names.join('、')}` : '暂无记忆资料';
}

function buildDramaPrompt(options: {
  type: string;
  duration: number;
  scene: string;
  roles: Character[];
  story: string;
}) {
  const roleNames = options.roles.map((role) => `【${role.name}】`).join('、');
  const roleDetails = options.roles
    .map((role) => `【${role.name}】是${role.intro || '未设置人设'}，${characterMemory(role)}。`)
    .join('');
  const lines = [
    `创作一段【${options.type}】微短剧剧本，时长为【${formatDurationLabel(options.duration)}】。`,
    options.scene ? `故事发生在【${options.scene}】。` : '',
    options.roles.length ? `角色为${roleNames}。其中${roleDetails}` : '',
    `故事剧情为【${options.story}】`,
    '请按以下格式输出：',
    '场景：xxx',
    '',
    '分镜1',
    '运镜：xxx',
    '画面：xxx',
    '对白',
    '角色1: xxx',
    '角色2: xxx',
    '',
    '分镜2',
    '运镜：xxx',
    '画面：xxx',
    '对白',
    '角色1: xxx',
    '角色2: xxx',
  ];
  return lines.filter((line) => line !== '').join('\n');
}

function parseDramaScript(content: string | null) {
  const text = (content || '').replace(/\r/g, '').trim();
  if (!text) return { scene: '', shots: [] as Array<{ title: string; camera: string; image: string; dialogue: string[] }> };
  try {
    const parsed = JSON.parse(text) as unknown;
    const array = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed
        ? ((parsed as { shots?: unknown; scenes?: unknown; data?: unknown }).shots || (parsed as { scenes?: unknown }).scenes || (parsed as { data?: unknown }).data)
        : null;
    if (Array.isArray(array)) {
      const shots = array.slice(0, 60).map((item, index) => {
        const record = item as Record<string, unknown>;
        const description = String(record.description || record.content || record.text || '');
        const camera = description.match(/运镜[:：]\s*([\s\S]*?)(?=\n\s*(画面|对白|BGM)[:：]?|$)/)?.[1]?.trim() || '';
        const image = description.match(/画面[:：]\s*([\s\S]*?)(?=\n\s*(对白|BGM)[:：]?|$)/)?.[1]?.trim() || String(record.prompt || '');
        const dialogueBlock = description.match(/对白[:：]?\s*([\s\S]*?)(?=\n\s*BGM[:：]?|$)/)?.[1]?.trim() || '';
        const dialogue = dialogueBlock.split('\n').map((line) => line.trim()).filter(Boolean);
        return {
          title: String(record.title || `分镜${index + 1}`),
          camera,
          image,
          dialogue,
        };
      });
      return { scene: '', shots };
    }
  } catch {
    // Continue with fixed text-template parsing.
  }
  const scene = text.match(/^\s*场景[:：]\s*(.+)$/m)?.[1]?.trim() || '';
  const matches = Array.from(text.matchAll(/^\s*分镜\s*(\d+)\s*$/gm));
  const shots = matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    const block = text.slice(start, end).trim();
    const camera = block.match(/运镜[:：]\s*([\s\S]*?)(?=\n\s*(画面|对白)[:：]?|\n角色|$)/)?.[1]?.trim() || '';
    const image = block.match(/画面[:：]\s*([\s\S]*?)(?=\n\s*对白[:：]?|\n角色|$)/)?.[1]?.trim() || '';
    const dialogueBlock = block.match(/对白[:：]?\s*([\s\S]*)$/)?.[1]?.trim() || '';
    const dialogue = dialogueBlock
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      title: `分镜${match[1] || index + 1}`,
      camera,
      image,
      dialogue,
    };
  });
  return { scene, shots };
}

function isDramaWork(work: Work | null) {
  if (!work) return false;
  try {
    const params = JSON.parse(work.generation_params_json || '{}') as { script_type?: string };
    return params.script_type === '微短剧';
  } catch {
    return work.prompt?.includes('微短剧剧本') || false;
  }
}

interface Props {
  scriptWork: Work | null;
  shots: Shot[];
  onScriptGenerated: (work: Work, shots: Shot[]) => void;
  onGoImage: () => void;
  onGoVideo: () => void;
}

interface AdReferenceAsset {
  id: string;
  type: 'image' | 'video';
  name: string;
  previewUrl: string;
}

function characterAvatar(role: Character) {
  const assetAvatar = role.assets?.find((asset) => asset.type === 'image' && asset.url)?.url;
  if (assetAvatar) return assetAvatar;
  if (role.gender === '女') return roleFemale;
  if (role.gender === '男') return roleMale;
  return roleUnknown;
}

function ScriptGeneratingPanel() {
  const [now, setNow] = useState(Date.now());
  const [startedAt] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const progress = Math.min(92, Math.max(18, 38 + Math.floor(elapsedSeconds * 2.2)));

  return (
    <div className="relative flex min-h-[620px] flex-1 overflow-hidden rounded-[8px] bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.98),rgba(247,251,255,0.92)_42%,rgba(240,246,255,0.72)_100%)] text-center">
      <div className="absolute inset-0">
        <div className="absolute left-[12%] top-[14%] h-32 w-32 rounded-full bg-blue-200/20 blur-3xl" />
        <div className="absolute bottom-[10%] right-[10%] h-40 w-40 rounded-full bg-violet-200/25 blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-[780px] flex-col items-center justify-center px-8 py-10">
        <div className="relative h-[260px] w-[420px]">
          <div className="absolute left-1/2 top-[46%] h-[126px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-[#7DBBFF]/45 opacity-80 orbit-spin" style={{ '--orbit-angle': '-8deg' } as CSSProperties} />
          <div className="absolute left-1/2 top-[46%] h-[154px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-[#7A6CFF]/35 opacity-75 orbit-counter-spin" style={{ '--orbit-angle': '14deg' } as CSSProperties} />
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
        <div className="mt-4 text-base font-black text-ink/45">灵感正在生成剧本，请稍候片刻...</div>
        <div className="mt-7 text-base font-black text-ink">{progress}%</div>
        <div className="mt-5 h-2 w-[330px] overflow-hidden rounded-full bg-blue-100">
          <div className="relative h-full rounded-full bg-gradient-to-r from-primary to-[#7A6CFF]" style={{ width: `${progress}%` }}>
            <span className="shimmer-slide absolute inset-y-0 w-20 bg-white/35 blur-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScriptPage({ scriptWork, shots, onScriptGenerated, onGoImage, onGoVideo }: Props) {
  const [prompt, setPrompt] = useState(scriptWork?.prompt || '');
  const [scriptType, setScriptType] = useState('广告片');
  const [duration, setDuration] = useState(15);
  const [adReferenceAssets, setAdReferenceAssets] = useState<AdReferenceAsset[]>([]);
  const [adShotCount, setAdShotCount] = useState(5);
  const [dramaStyle, setDramaStyle] = useState('通用');
  const [dramaScene, setDramaScene] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([]);
  const [roleDrawerOpen, setRoleDrawerOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState<Pick<Character, 'name' | 'gender' | 'intro'>>({
    name: '新角色',
    gender: '未知',
    intro: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const durationOptions = scriptType === '广告片' ? generalDurations : scriptType === '微短剧' ? dramaDurations : longDurations;
  const durationIndex = Math.max(0, durationOptions.indexOf(duration));
  const durationPercent = durationOptions.length > 1 ? (durationIndex / (durationOptions.length - 1)) * 100 : 0;
  const dramaScript = isDramaWork(scriptWork) ? parseDramaScript(scriptWork?.content || null) : null;

  useEffect(() => {
    let alive = true;
    void getCharacters().then((items) => {
      if (alive) setCharacters(items);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (scriptType === '广告片' && !generalDurations.includes(duration)) {
      setDuration(15);
    }
    if (scriptType === '微短剧' && !dramaDurations.includes(duration)) {
      setDuration(15);
    }
  }, [scriptType, duration]);

  const handleGenerate = async () => {
    setError('');
    setLoading(true);
    try {
      const selectedCharacters = characters.filter((role) => selectedCharacterIds.includes(role.id));
      if (scriptType === '微短剧' && !dramaStyle.trim()) {
        setError('请先选择类型');
        setLoading(false);
        return;
      }
      if (scriptType === '微短剧' && !prompt.trim()) {
        setError('请先填写剧情');
        setLoading(false);
        return;
      }
      const finalPrompt = scriptType === '广告片'
        ? `${prompt}\n\n请生成 ${adShotCount} 个分镜。`
        : scriptType === '微短剧'
          ? buildDramaPrompt({
            type: dramaStyle,
            duration,
            scene: dramaScene.trim(),
            roles: selectedCharacters,
            story: prompt.trim(),
          })
          : prompt;
      const result = await generateScript({ prompt: finalPrompt, script_type: scriptType, duration_seconds: duration });
      const parsedShots = parseShotsFromWorkContent(result.work.content);
      onScriptGenerated(result.work, parsedShots);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAddAdReferences = (files: FileList | null) => {
    if (!files?.length) return;
    const nextAssets = Array.from(files)
      .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
      .map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        type: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
      }));
    setAdReferenceAssets((items) => [...items, ...nextAssets]);
  };

  const removeAdReference = (id: string) => {
    setAdReferenceAssets((items) => {
      const target = items.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return items.filter((item) => item.id !== id);
    });
  };

  const updateAdShotCount = (value: number) => {
    setAdShotCount(Math.max(1, Math.floor(value || 1)));
  };

  const toggleCharacter = (id: number) => {
    setSelectedCharacterIds((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]));
  };

  const openNewRoleDrawer = () => {
    setRoleDraft({ name: '新角色', gender: '未知', intro: '' });
    setRoleDrawerOpen(true);
  };

  const saveNewRole = async () => {
    const created = await createCharacter({
      ...roleDraft,
      tone: 'from-slate-100 via-blue-50 to-indigo-100',
      portraits: 0,
      voices: 0,
      videos: 0,
      memories: 0,
      assets: [],
      memory_files: [],
      thinking_model: 'preset',
      status: 'active',
    });
    setCharacters((items) => [created, ...items]);
    setSelectedCharacterIds((items) => [...items, created.id]);
    setRoleDrawerOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid h-[56px] w-[420px] grid-cols-3 gap-1 rounded-[10px] bg-white/80 p-1 shadow-[0_8px_24px_rgba(31,43,77,0.04)]">
        {scriptTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setScriptType(tab.key)}
              className={`flex h-12 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] text-base font-black transition ${
                scriptType === tab.key ? 'border border-[rgba(107,140,255,0.42)] bg-[#F3F7FF] text-primary' : 'border border-transparent text-ink hover:bg-blue-50/70'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {scriptWork ? (
        <div className="flex justify-end">
          <div className="flex flex-wrap gap-4">
            <GhostButton>
              <Save size={18} /> 保存
            </GhostButton>
            <GhostButton onClick={onGoImage}>
              <ImagePlus size={18} /> 生成分镜图
            </GhostButton>
            <PrimaryButton onClick={onGoVideo}>
              <PlaySquare size={18} /> 直接生成视频
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_1.08fr] gap-6">
        <section className="glass-panel rounded-[8px] p-7">
          {scriptType === '广告片' ? (
            <div className="mb-7">
              <div className="mb-3 flex items-center justify-between text-sm font-black text-ink">
                <span className="text-xl font-black text-black">参考素材 <span className="text-sm text-ink/50">（可选）</span></span>
                <span className="font-semibold text-ink/50">{adReferenceAssets.length}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="upload-box relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden text-primary transition hover:border-primary hover:bg-blue-50">
                  <Plus size={24} />
                  <input
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                    type="file"
                    accept="image/*,video/mp4,video/quicktime,.mp4,.mov"
                    multiple
                    onChange={(event) => {
                      handleAddAdReferences(event.target.files);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {adReferenceAssets.map((asset) => (
                  <div key={asset.id} className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-[8px] bg-blue-50">
                    {asset.type === 'image' ? (
                      <img src={asset.previewUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-primary">
                        <Video size={22} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAdReference(asset.id)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/75 group-hover:opacity-100"
                      aria-label="删除素材"
                    >
                      <X size={12} />
                    </button>
                    <span className="absolute bottom-1 left-1 rounded-[4px] bg-black/65 px-1.5 py-0.5 text-[10px] font-black text-white">
                      {asset.type === 'image' ? '图片' : '视频'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {scriptType === '微短剧' ? (
            <div className="mb-7 space-y-7">
              <div>
                <div className="mb-3 text-xl font-black text-black">类型{requiredMark()}</div>
                <div className="grid grid-cols-6 gap-2">
                  {dramaStyles.map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setDramaStyle(style)}
                      className={`option-card h-10 px-2 text-sm font-black transition ${dramaStyle === style ? 'active text-primary' : 'text-ink hover:border-primary/50'}`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-3 text-xl font-black text-black">角色</div>
                <div className="flex flex-wrap gap-4">
                  {characters.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleCharacter(role.id)}
                      className="flex w-[72px] flex-col items-center gap-2 text-center text-xs font-black text-ink transition"
                    >
                      <span
                        className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border text-base font-black transition ${
                        selectedCharacterIds.includes(role.id)
                          ? 'border-primary bg-blue-50 text-primary shadow-[0_0_0_4px_rgba(47,128,255,0.10)]'
                          : 'border-blue-100 bg-white/70 text-ink hover:border-primary/50'
                      }`}
                      >
                        <img src={characterAvatar(role)} alt="" className="h-[118%] w-[118%] max-w-none object-cover" />
                      </span>
                      <span className="max-w-full truncate">{role.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={openNewRoleDrawer}
                    className="flex w-[72px] flex-col items-center gap-2 text-center text-xs font-black text-primary transition"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-blue-300 bg-white/60 hover:bg-blue-50">
                      <Plus size={22} />
                    </span>
                    <span>新增角色</span>
                  </button>
                  {!characters.length ? <div className="rounded-[10px] bg-blue-50/60 px-4 py-3 text-sm font-semibold text-ink/45">暂无角色，可新增一个角色</div> : null}
                </div>
              </div>
            </div>
          ) : null}

          {scriptType === '微短剧' ? (
            <div className="mb-6">
              <label className="mb-3 block text-xl font-black text-black">场景</label>
              <input
                value={dramaScene}
                onChange={(event) => setDramaScene(event.target.value)}
                maxLength={30}
                className="h-12 w-full rounded-[8px] border border-blue-100 bg-white/70 px-5 text-sm font-semibold text-ink outline-none focus:border-primary"
                placeholder="请输入故事发生场景"
              />
              <div className="mt-2 text-right text-sm font-bold text-ink/45">{dramaScene.length}/30</div>
            </div>
          ) : null}

          <label className="block text-xl font-black text-black">{scriptType === '微短剧' ? '剧情' : '主题'}{scriptType === '微短剧' ? requiredMark() : null}</label>
          <div className="relative mt-5">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={2000}
              className="h-[205px] w-full resize-none rounded-[8px] border border-blue-100 bg-white/70 p-5 text-sm leading-7 outline-none focus:border-primary"
              placeholder={scriptType === '微短剧' ? '请输入故事剧情...' : '请输入您的创意或主题，例如：一款智能手表的科技感宣传片...'}
            />
            <span className="absolute bottom-4 right-4 text-sm font-bold text-ink/50">{prompt.length}/2000</span>
          </div>

          {scriptType === '广告片' ? (
            <div className="mt-7">
              <div className="mb-3 text-xl font-black text-black">分镜数</div>
              <div className="flex h-11 w-[180px] items-center overflow-hidden rounded-[10px] border border-blue-100 bg-white/80">
                <button type="button" onClick={() => updateAdShotCount(adShotCount - 1)} className="h-full w-12 text-lg font-black text-primary hover:bg-blue-50">-</button>
                <input
                  value={adShotCount}
                  onChange={(event) => updateAdShotCount(Number(event.target.value))}
                  className="h-full min-w-0 flex-1 bg-transparent text-center text-base font-black text-ink outline-none"
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
                <button type="button" onClick={() => updateAdShotCount(adShotCount + 1)} className="h-full w-12 text-lg font-black text-primary hover:bg-blue-50">+</button>
              </div>
            </div>
          ) : null}

          <div className={`mt-9 rounded-[8px] ${scriptType === '广告片' ? 'bg-transparent p-0' : 'bg-white/70 p-6'}`}>
            <div className="text-xl font-black text-black">时长</div>
            <div className="mt-10">
              <div className="relative h-16">
                <div className="absolute left-0 right-0 top-5 h-2 rounded-full bg-[#E8EEF7] shadow-[inset_0_1px_2px_rgba(23,35,61,0.08)]" />
                <div className="absolute left-0 top-5 h-2 rounded-full bg-primary" style={{ width: `${durationPercent}%` }} />
                <div
                  className="absolute top-[10px] flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-white shadow-[0_8px_22px_rgba(47,128,255,0.28)] ring-2 ring-blue-100"
                  style={{ left: `${durationPercent}%` }}
                >
                  <span className="h-4 w-4 rounded-full bg-primary" />
                </div>
                <input
                  type="range"
                  min={0}
                  max={durationOptions.length - 1}
                  value={durationIndex}
                  onChange={(event) => setDuration(durationOptions[Number(event.target.value)])}
                  className="absolute inset-x-0 top-0 h-12 cursor-pointer opacity-0"
                />
                <div className="absolute inset-x-0 top-11 flex justify-between">
                  {durationOptions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setDuration(item)}
                      className={`h-2 w-2 rounded-full transition ${item === duration ? 'bg-primary' : 'bg-[#C8D1E0]'}`}
                      aria-label={durationLabels[item]}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-1 flex justify-between text-sm font-black text-ink">
                {durationOptions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setDuration(item)}
                    className={`min-w-12 rounded-full px-3 py-2 transition ${
                      item === duration ? 'bg-blue-50 text-primary shadow-[0_10px_24px_rgba(47,128,255,0.12)]' : 'text-ink hover:text-primary'
                    }`}
                  >
                    {durationLabels[item]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-8">
              <PrimaryButton disabled={!prompt.trim() || (scriptType === '微短剧' && !dramaStyle.trim()) || loading} onClick={handleGenerate}>
                {loading ? '生成中...' : '生成剧本'} <Sparkles size={18} />
              </PrimaryButton>
            </div>
            {error ? <div className="mt-4 rounded-[8px] bg-red-50 p-3 text-sm font-semibold text-red-600">{error}</div> : null}
          </div>
        </section>

        <section className="glass-panel min-h-[760px] rounded-[8px] p-7">
          {loading ? (
            <div className="flex h-full flex-col">
              <h2 className="mb-6 text-xl font-black text-black">生成结果</h2>
              <ScriptGeneratingPanel />
            </div>
          ) : !scriptWork ? (
            <div className="flex h-full flex-col">
              <h2 className="text-xl font-black text-black">生成结果</h2>
              <div className="flex flex-1 flex-col items-center justify-center text-center text-ink/60">
                <img src={imageEmpty} className="mb-6 h-[368px] w-[368px] object-contain" />
                <div className="text-xl font-black text-ink">暂无生成结果</div>
                <div className="mt-3 text-sm font-semibold">请先在左侧输入创意并生成剧本</div>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black text-black">分镜剧本 <span className="text-sm text-ink/60">（可编辑）</span></h2>
                  <div className="mt-4 text-sm font-bold text-emerald-600">已生成剧本 · 约 {shots.reduce((sum, shot) => sum + shot.duration_seconds, 0)} 秒</div>
                </div>
                <div className="text-sm font-bold text-ink/60">编辑模式</div>
              </div>
              {dramaScript ? (
                <div className="space-y-4">
                  {dramaScript.scene ? (
                    <section className="rounded-[8px] border border-blue-100 bg-blue-50/60 p-4">
                      <div className="text-sm font-black text-ink/55">场景</div>
                      <div className="mt-2 text-sm font-bold leading-7 text-ink">{dramaScript.scene}</div>
                    </section>
                  ) : null}
                  {dramaScript.shots.length ? dramaScript.shots.map((shot, index) => (
                    <article key={`${shot.title}-${index}`} className="rounded-[8px] border border-blue-100 bg-white/70 p-5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 min-w-14 items-center justify-center rounded-[6px] bg-primary px-2 text-sm font-black text-white">{shot.title}</span>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm leading-7">
                        {shot.camera ? (
                          <div>
                            <div className="font-black text-ink">运镜</div>
                            <div className="mt-1 rounded-[8px] bg-blue-50/60 px-4 py-3 font-semibold text-ink/75">{shot.camera}</div>
                          </div>
                        ) : null}
                        {shot.image ? (
                          <div>
                            <div className="font-black text-ink">画面</div>
                            <div className="mt-1 rounded-[8px] bg-blue-50/60 px-4 py-3 font-semibold text-ink/75">{shot.image}</div>
                          </div>
                        ) : null}
                        {shot.dialogue.length ? (
                          <div>
                            <div className="font-black text-ink">对白</div>
                            <div className="mt-1 space-y-2 rounded-[8px] bg-blue-50/60 px-4 py-3">
                              {shot.dialogue.map((line) => (
                                <div key={line} className="font-semibold text-ink/75">{line}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  )) : (
                    <pre className="whitespace-pre-wrap rounded-[8px] bg-blue-50/60 p-5 text-sm font-semibold leading-7 text-ink">{scriptWork.content}</pre>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-blue-100">
                  {shots.map((shot) => (
                    <article key={shot.id} className="grid grid-cols-[52px_1fr_90px] gap-4 py-5">
                      <span className="flex h-8 w-10 items-center justify-center rounded-[6px] bg-primary text-sm font-black text-white">{shot.id}</span>
                      <div>
                        <div className="text-lg font-black text-black">
                          {shot.title} / {shot.duration_seconds}秒
                        </div>
                        <div className="mt-2 text-xs font-semibold leading-6 text-ink/70">{shot.description}</div>
                        <div className="mt-1 text-xs font-bold leading-6 text-primary">提示：{shot.prompt}</div>
                      </div>
                      <div className="text-right text-xs font-bold text-ink/70">0:00</div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {roleDrawerOpen ? (
        <div className="fixed inset-0 z-50 bg-ink/18" onClick={() => setRoleDrawerOpen(false)}>
          <aside className="fixed bottom-0 right-0 top-0 flex h-screen w-[max(50vw,760px)] flex-col bg-white shadow-[0_18px_60px_rgba(23,35,61,0.18)]" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setRoleDrawerOpen(false)} className="absolute right-6 top-6 text-ink/55"><X size={24} /></button>
            <div className="min-h-0 flex-1 overflow-auto p-8 pr-12">
              <h2 className="mb-6 text-2xl font-black text-ink">角色编辑</h2>
              <div className="grid grid-cols-[1fr_180px] gap-4">
                <label className="space-y-2 text-sm font-black text-ink">
                  名称
                  <input value={roleDraft.name} onChange={(event) => setRoleDraft((current) => ({ ...current, name: event.target.value }))} className="h-11 w-full border px-4 outline-none" />
                </label>
                <label className="space-y-2 text-sm font-black text-ink">
                  性别
                  <select value={roleDraft.gender} onChange={(event) => setRoleDraft((current) => ({ ...current, gender: event.target.value as CharacterGender }))} className="h-11 w-full border px-4 outline-none">
                    <option>女</option>
                    <option>男</option>
                    <option>未知</option>
                  </select>
                </label>
              </div>
              <label className="mt-5 block space-y-2 text-sm font-black text-ink">
                <span>人设</span>
                <span className="block text-sm font-semibold text-[#8A97AD]">人物性格特征、常用语、开场白</span>
                <textarea
                  value={roleDraft.intro}
                  onChange={(event) => setRoleDraft((current) => ({ ...current, intro: event.target.value }))}
                  className="h-28 w-full resize-none border p-4 leading-7 outline-none"
                  maxLength={200}
                />
              </label>
            </div>
            <div className="flex justify-end gap-3 bg-white px-8 py-5 pr-12">
              <button type="button" onClick={() => setRoleDrawerOpen(false)} className="secondary-button h-11 px-8 text-sm font-black">取消</button>
              <button type="button" onClick={() => void saveNewRole()} disabled={!roleDraft.name.trim()} className="gradient-button h-11 px-8 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50">保存</button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

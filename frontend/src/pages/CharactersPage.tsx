import { AudioLines, ChevronDown, Clapperboard, FileText, FolderOpen, Grid2X2, ImageIcon, Images, List, Mic2, type LucideIcon, MoreHorizontal, Mountain, Package, Plus, Search, Smile, Sparkles, Upload, UserRound, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import roleFemale from '../assets/role-female.png';
import roleMale from '../assets/role-male.png';
import roleUnknown from '../assets/role-unknown.png';
import { createCharacter, deleteCharacter, getCharacters, getWorks, updateCharacter, uploadMedia } from '../lib/api';
import { resultUrlsFromContent } from '../lib/shotParser';
import type { Character, CharacterAsset, CharacterGender, Work } from '../types';

const fallbackTones = [
  'from-rose-100 via-orange-50 to-sky-100',
  'from-slate-100 via-blue-50 to-indigo-100',
  'from-amber-100 via-pink-50 to-sky-100',
  'from-pink-100 via-white to-blue-100',
  'from-cyan-100 via-white to-slate-100',
  'from-emerald-100 via-white to-violet-100',
];

function RoleAvatar({ role, large = false }: { role: Character; large?: boolean }) {
  const uploadedAvatar = (role.assets || []).find((asset) => asset.type === 'image' && asset.url)?.url;
  const avatar = uploadedAvatar || (role.gender === '女' ? roleFemale : role.gender === '男' ? roleMale : roleUnknown);
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-[12px] bg-blue-50 ${large ? 'h-24 w-24' : 'h-[150px] w-[132px]'}`}>
      <img src={avatar} alt="" className="h-full w-full object-cover" />
    </div>
  );
}

function GenderIcon({ gender }: { gender: CharacterGender }) {
  const symbol = gender === '女' ? '♀' : gender === '男' ? '♂' : '?';
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-lg font-black leading-none ${
        gender === '女' ? 'bg-pink-50 text-pink-500' : gender === '男' ? 'bg-blue-50 text-primary' : 'bg-slate-100 text-slate-500'
      }`}
      aria-label={`性别：${gender}`}
    >
      {symbol}
    </span>
  );
}

type MaterialCategory = 'three_view' | 'expression' | 'audio' | 'video';

function assetMatchesCategory(asset: CharacterAsset, category: MaterialCategory) {
  if (asset.category) return asset.category === category;
  if (category === 'three_view') return asset.type === 'image';
  return asset.type === category;
}

function MaterialCategoryCard({ icon: Icon, label, onUpload, onReference, onGenerate }: { icon: LucideIcon; label: string; onUpload: () => void; onReference: () => void; onGenerate: () => void }) {
  const actions = [
    { label: '从本地上传', icon: Upload, onClick: onUpload },
    { label: '引用我的作品', icon: FolderOpen, onClick: onReference },
    { label: 'AI生成', icon: Sparkles, onClick: onGenerate },
  ];
  return (
    <div className="flex h-[142px] w-[170px] shrink-0 flex-col rounded-[12px] border border-dashed border-blue-200 bg-white/55 p-3 text-primary transition hover:border-primary/45 hover:bg-blue-50/45">
      <div className="flex items-center gap-2 text-sm font-black text-ink"><Icon size={18} className="text-primary" />{label}</div>
      <div className="mt-auto flex items-center justify-around pb-2">
        {actions.map((action) => {
          const ActionIcon = action.icon;
          return <button key={action.label} type="button" onClick={action.onClick} className="group/action relative grid h-10 w-10 place-items-center rounded-[8px] text-primary transition hover:bg-white" aria-label={action.label}>
            <ActionIcon size={19} />
            <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 hidden -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-ink px-2.5 py-1.5 text-xs font-bold text-white shadow-lg group-hover/action:block">{action.label}</span>
          </button>;
        })}
      </div>
    </div>
  );
}

function AssetUploadBox({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex h-[118px] w-[118px] shrink-0 flex-col items-center justify-center rounded-[10px] border border-dashed border-blue-200 bg-white/50 text-primary hover:bg-blue-50"><Plus size={24} /><span className="mt-2 text-sm font-black">{label}</span></button>;
}

function assetLabel(asset: CharacterAsset, index: number) {
  if (asset.name) return asset.name;
  if (asset.type === 'file') return `记忆_${index + 1}.md`;
  if (asset.type === 'audio') return `音色_${index + 1}.mp3`;
  if (asset.type === 'video') return `视频_${index + 1}.mp4`;
  return `头像_${index + 1}`;
}

function AssetThumb({ asset, index, tone, onDelete }: { asset: CharacterAsset; index: number; tone?: string | null; onDelete: () => void }) {
  const kind = asset.type;
  const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? Video : kind === 'audio' ? Mic2 : FileText;
  return (
    <div className="relative h-[118px] w-[118px] shrink-0 overflow-hidden rounded-[10px] border border-blue-100 bg-blue-50/60">
      {kind === 'image' && asset.url ? (
        <img src={asset.url} alt="" className="h-full w-full object-cover" />
      ) : kind === 'image' ? (
        <div className={`h-full w-full bg-gradient-to-br ${tone || fallbackTones[index % fallbackTones.length]}`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-primary">
          <Icon size={30} />
        </div>
      )}
      {kind === 'video' ? <span className="absolute inset-0 flex items-center justify-center bg-black/10 text-white"><Video size={28} /></span> : null}
      <button type="button" onClick={onDelete} className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/30 text-white">
        <X size={12} />
      </button>
      <div className="absolute inset-x-0 bottom-0 truncate bg-white/80 px-2 py-1 text-[11px] font-bold text-ink/70">
        {assetLabel(asset, index)}
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="glass-panel flex min-h-[720px] flex-col items-center justify-center rounded-[18px] border border-dashed border-blue-200 p-10 text-center">
      <div className="relative h-[260px] w-[360px]">
        <div className="absolute left-1/2 top-6 h-44 w-56 -translate-x-1/2 rounded-[26px] border border-blue-100 bg-white/72 shadow-soft" />
        <div className="absolute left-1/2 top-14 h-16 w-16 -translate-x-1/2 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100" />
        <div className="absolute left-1/2 top-28 h-8 w-36 -translate-x-1/2 rounded-full bg-blue-50" />
        <div className="absolute bottom-12 left-9 grid h-24 w-24 place-items-center rounded-[12px] bg-white/80 text-primary shadow-soft"><ImageIcon size={30} /><span className="absolute bottom-4 text-xs font-black text-ink">人像图片</span></div>
        <div className="absolute bottom-7 left-1/2 grid h-24 w-24 -translate-x-1/2 place-items-center rounded-[12px] bg-white/80 text-primary shadow-soft"><Video size={30} /><span className="absolute bottom-4 text-xs font-black text-ink">口播视频</span></div>
        <div className="absolute bottom-12 right-9 grid h-24 w-24 place-items-center rounded-[12px] bg-white/80 text-primary shadow-soft"><FileText size={30} /><span className="absolute bottom-4 text-xs font-black text-ink">聊天记录</span></div>
      </div>
      <div className="mt-4 text-3xl font-black text-ink">还没有角色</div>
      <div className="mt-4 max-w-[520px] text-base font-semibold leading-7 text-ink/55">
        你可以新建一个虚拟角色，配置名称、性别、简介，并上传人像图片、口播视频和聊天记录素材。
      </div>
      <div className="mt-9 flex gap-4">
        <button type="button" onClick={onAdd} className="gradient-button h-14 px-10 text-base font-black">新建第一个角色</button>
        <button type="button" className="secondary-button flex h-14 items-center gap-2 px-10 text-base font-black"><Upload size={18} /> 批量导入角色</button>
      </div>
      <div className="mt-6 text-sm font-semibold text-ink/45">支持上传人像图片、口播视频、聊天记录（MD / JSON / PNG / JPG 等）</div>
    </section>
  );
}

export default function CharactersPage() {
  const [activeMaterialTab, setActiveMaterialTab] = useState<'role' | 'scene' | 'prop'>('role');
  const [roles, setRoles] = useState<Character[]>([]);
  const [query, setQuery] = useState('');
  const [genderFilter, setGenderFilter] = useState<'全部性别' | CharacterGender>('全部性别');
  const [selected, setSelected] = useState<Character | null>(null);
  const [draft, setDraft] = useState<Partial<Character> | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [thinkingModel, setThinkingModel] = useState<'preset' | 'custom'>('preset');
  const [loading, setLoading] = useState(true);
  const [pendingMaterialCategory, setPendingMaterialCategory] = useState<MaterialCategory>('three_view');
  const [workPickerCategory, setWorkPickerCategory] = useState<MaterialCategory | null>(null);
  const [availableWorks, setAvailableWorks] = useState<Work[]>([]);
  const [workPickerLoading, setWorkPickerLoading] = useState(false);
  const materialInputRef = useRef<HTMLInputElement | null>(null);
  const memoryInputRef = useRef<HTMLInputElement | null>(null);
  const filteredRoles = useMemo(() => roles.filter((role) => (
    role.name.toLowerCase().includes(query.trim().toLowerCase())
    && (genderFilter === '全部性别' || role.gender === genderFilter)
  )), [roles, query, genderFilter]);

  useEffect(() => {
    let alive = true;
    void getCharacters().then((items) => {
      if (alive) setRoles(items);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const openEditor = (role: Character) => {
    setOpenMenuId(null);
    setThinkingModel(role.thinking_model || 'preset');
    setDraft(role);
    setSelected(role);
  };

  const handleAddRole = async () => {
    const created = await createCharacter({
      name: '新角色',
      gender: '未知',
      birthplace: '',
      age: null,
      height_cm: null,
      weight_kg: null,
      skin_tone: '',
      hairstyle: '',
      clothing_style: '',
      intro: '',
      tone: fallbackTones[roles.length % fallbackTones.length],
      portraits: 0,
      voices: 0,
      videos: 0,
      memories: 0,
      assets: [],
      memory_files: [],
      thinking_model: 'preset',
      status: 'active',
    });
    setRoles((items) => [created, ...items]);
    openEditor(created);
  };

  const handleSaveRole = async () => {
    if (!selected || !draft) return;
    const saved = await updateCharacter(selected.id, { ...draft, thinking_model: thinkingModel });
    setRoles((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    setSelected(null);
    setDraft(null);
  };

  const handleDeleteRole = async (role: Character) => {
    await deleteCharacter(role.id);
    setRoles((items) => items.filter((item) => item.id !== role.id));
    setOpenMenuId(null);
    if (selected?.id === role.id) setSelected(null);
  };

  const persistRole = async (patch: Partial<Character>) => {
    if (!selected) return null;
    const saved = await updateCharacter(selected.id, patch);
    setRoles((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    setSelected(saved);
    setDraft((current) => (current ? {
      ...saved,
      ...current,
      assets: saved.assets,
      memory_files: saved.memory_files,
      portraits: saved.portraits,
      voices: saved.voices,
      videos: saved.videos,
      memories: saved.memories,
    } : saved));
    setThinkingModel(saved.thinking_model || 'preset');
    return saved;
  };

  const countAssets = (assets: CharacterAsset[], memoryFiles: CharacterAsset[]) => ({
    portraits: assets.filter((asset) => asset.type === 'image').length,
    voices: assets.filter((asset) => asset.type === 'audio').length,
    videos: assets.filter((asset) => asset.type === 'video').length,
    memories: memoryFiles.length,
  });

  const toAsset = (file: File, result: Awaited<ReturnType<typeof uploadMedia>>, forceType?: CharacterAsset['type'], category?: MaterialCategory): CharacterAsset => ({
    type: forceType || result.type,
    category,
    url: result.url,
    name: file.name,
    mime_type: file.type || null,
    size: file.size,
  });

  const handleUploadAssets = async (files: FileList | null) => {
    if (!selected || !files?.length) return;
    const currentAssets = selected.assets || [];
    const currentMemoryFiles = selected.memory_files || [];
    const forceType: CharacterAsset['type'] = pendingMaterialCategory === 'audio' ? 'audio' : pendingMaterialCategory === 'video' ? 'video' : 'image';
    const file = files[0];
    const uploaded = toAsset(file, await uploadMedia(file), forceType, pendingMaterialCategory);
    const assets = [...currentAssets.filter((asset) => !assetMatchesCategory(asset, pendingMaterialCategory)), uploaded];
    await persistRole({ assets, memory_files: currentMemoryFiles, ...countAssets(assets, currentMemoryFiles) });
    if (materialInputRef.current) materialInputRef.current.value = '';
  };

  const openLocalUpload = (category: MaterialCategory) => {
    setPendingMaterialCategory(category);
    window.setTimeout(() => materialInputRef.current?.click(), 0);
  };

  const workAssetUrl = (work: Work) => work.file_url || work.thumbnail_url || resultUrlsFromContent(work.content)[0] || '';

  const openWorkPicker = async (category: MaterialCategory) => {
    setWorkPickerCategory(category);
    setWorkPickerLoading(true);
    try {
      const type = category === 'video' ? 'video' : category === 'audio' ? undefined : 'image';
      const works = await getWorks(type);
      setAvailableWorks(works.filter((work) => Boolean(workAssetUrl(work))));
    } finally {
      setWorkPickerLoading(false);
    }
  };

  const referenceWork = async (work: Work) => {
    if (!selected || !workPickerCategory) return;
    const url = workAssetUrl(work);
    if (!url) return;
    const type: CharacterAsset['type'] = workPickerCategory === 'audio' ? 'audio' : workPickerCategory === 'video' ? 'video' : 'image';
    const assets = [...(selected.assets || []).filter((asset) => !assetMatchesCategory(asset, workPickerCategory)), { type, category: workPickerCategory, url, name: work.title || `作品 ${work.id}` }];
    const memoryFiles = selected.memory_files || [];
    await persistRole({ assets, memory_files: memoryFiles, ...countAssets(assets, memoryFiles) });
    setWorkPickerCategory(null);
  };

  const generateMaterial = (category: MaterialCategory) => {
    if (category === 'audio') {
      window.alert('音频直接生成功能尚未接入，当前可以使用本地上传或引用作品。');
      return;
    }
    if (category === 'video') {
      localStorage.setItem('leapai:video-draft', JSON.stringify({ prompt: `为角色${draft?.name ? `“${draft.name}”` : ''}生成角色展示视频` }));
      window.location.hash = '#video';
      return;
    }
    localStorage.setItem('leapai:image-draft', JSON.stringify({
      prompt: category === 'three_view'
        ? `为角色${draft?.name ? `“${draft.name}”` : ''}生成正面、侧面、背面三视图，纯色背景，角色设定图`
        : `为角色${draft?.name ? `“${draft.name}”` : ''}生成多种情绪表情图，保持人物形象一致`,
      referenceUrls: (selected?.assets || []).filter((asset) => asset.type === 'image' && asset.url).map((asset) => asset.url as string).slice(0, 4),
    }));
    window.location.hash = '#image';
  };

  const handleUploadMemories = async (files: FileList | null) => {
    if (!selected || !files?.length) return;
    const currentAssets = selected.assets || [];
    const currentMemoryFiles = selected.memory_files || [];
    const uploaded = await Promise.all(Array.from(files).map(async (file) => toAsset(file, await uploadMedia(file), 'file')));
    const memoryFiles = [...currentMemoryFiles, ...uploaded];
    await persistRole({ assets: currentAssets, memory_files: memoryFiles, ...countAssets(currentAssets, memoryFiles) });
    if (memoryInputRef.current) memoryInputRef.current.value = '';
  };

  const handleDeleteAsset = async (index: number) => {
    if (!selected) return;
    const assets = (selected.assets || []).filter((_, item) => item !== index);
    const memoryFiles = selected.memory_files || [];
    await persistRole({ assets, memory_files: memoryFiles, ...countAssets(assets, memoryFiles) });
  };

  const handleDeleteMemory = async (index: number) => {
    if (!selected) return;
    const assets = selected.assets || [];
    const memoryFiles = (selected.memory_files || []).filter((_, item) => item !== index);
    await persistRole({ assets, memory_files: memoryFiles, ...countAssets(assets, memoryFiles) });
  };

  const selectedTone = selected?.tone || fallbackTones[(selected?.id || 1) % fallbackTones.length];

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-[12px] bg-white/65 p-1.5 shadow-[0_8px_24px_rgba(47,128,255,0.06)]">
        {([
          { key: 'role', label: '角色', icon: UserRound },
          { key: 'scene', label: '场景', icon: Mountain },
          { key: 'prop', label: '道具', icon: Package },
        ] as const).map((tab) => {
          const Icon = tab.icon;
          const active = activeMaterialTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveMaterialTab(tab.key)}
              className={`flex h-11 min-w-[130px] items-center justify-center gap-2 rounded-[9px] border text-sm font-black transition ${
                active
                  ? 'border-primary/45 bg-blue-50/70 text-primary shadow-[0_4px_12px_rgba(47,128,255,0.08)]'
                  : 'border-transparent text-ink hover:bg-white/70'
              }`}
            >
              <Icon size={18} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <input
        ref={materialInputRef}
        type="file"
        accept={pendingMaterialCategory === 'audio' ? 'audio/*,.mp3,.wav,.m4a' : pendingMaterialCategory === 'video' ? 'video/*,.mp4,.mov' : 'image/*,.png,.jpg,.jpeg,.webp'}
        className="hidden"
        onChange={(event) => void handleUploadAssets(event.target.files)}
      />
      <input
        ref={memoryInputRef}
        type="file"
        multiple
        accept=".txt,.md,.json,.png,.jpg,.jpeg,text/plain,text/markdown,application/json,image/png,image/jpeg"
        className="hidden"
        onChange={(event) => void handleUploadMemories(event.target.files)}
      />
      {activeMaterialTab !== 'role' ? <section className="min-h-[680px]" /> : !loading && !filteredRoles.length ? <EmptyState onAdd={() => void handleAddRole()} /> : (
        <section>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4">
              <label className="relative">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/45" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 w-[280px] border py-0 pl-11 pr-4 text-sm font-semibold outline-none" placeholder="搜索角色名称" />
              </label>
              <select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value as '全部性别' | CharacterGender)} className="h-11 w-[130px] border px-4 text-sm font-black outline-none"><option>全部性别</option><option>女</option><option>男</option><option>未知</option></select>
              <select className="h-11 w-[130px] border px-4 text-sm font-black outline-none"><option>最近创建</option><option>素材最多</option></select>
              <div className="flex rounded-[12px] bg-white/60 p-1">
                <button type="button" className="grid h-9 w-9 place-items-center rounded-[9px] bg-blue-50 text-primary"><Grid2X2 size={18} /></button>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-[9px] text-ink/65"><List size={18} /></button>
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-6">
            <button
              type="button"
              onClick={() => void handleAddRole()}
              className="group flex h-[260px] flex-col items-center justify-center rounded-[16px] border-2 border-dashed border-blue-200 bg-white/55 text-primary transition hover:-translate-y-0.5 hover:border-primary/45 hover:bg-white/80 hover:shadow-[0_22px_54px_rgba(47,128,255,0.13)]"
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-blue-50 transition group-hover:bg-primary group-hover:text-white">
                <Plus size={30} strokeWidth={2.4} />
              </span>
              <span className="mt-5 text-xl font-black text-ink">添加角色</span>
              <span className="mt-2 text-sm font-semibold text-ink/45">创建一个新的虚拟角色</span>
            </button>
            {filteredRoles.map((role) => (
              <article
                key={role.id}
                onClick={() => {
                  openEditor(role);
                }}
                className={`card group relative flex h-[260px] cursor-pointer gap-6 p-5 pb-16 text-left transition hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(47,128,255,0.13)] ${selected?.id === role.id ? 'ring-2 ring-primary' : ''}`}
              >
                <RoleAvatar role={role} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div className="truncate text-xl font-black text-ink">{role.name}</div>
                    <GenderIcon gender={role.gender} />
                  </div>
                  <p className="mt-5 line-clamp-4 text-sm font-semibold leading-6 text-ink/60">{role.intro}</p>
                  <div className="absolute bottom-5 left-5 right-5 grid grid-cols-4 gap-3">
                    <span className="flex h-9 min-w-0 items-center justify-center rounded-[8px] bg-blue-50/80 px-2 text-xs font-black text-ink">头像&nbsp;{role.portraits}</span>
                    <span className="flex h-9 min-w-0 items-center justify-center rounded-[8px] bg-blue-50/80 px-2 text-xs font-black text-ink">音色&nbsp;{role.voices}</span>
                    <span className="flex h-9 min-w-0 items-center justify-center rounded-[8px] bg-blue-50/80 px-2 text-xs font-black text-ink">视频&nbsp;{role.videos}</span>
                    <span className="flex h-9 min-w-0 items-center justify-center rounded-[8px] bg-blue-50/80 px-2 text-xs font-black text-ink">记忆&nbsp;{role.memories}</span>
                  </div>
                </div>
                <div className="absolute right-5 top-5" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setOpenMenuId((current) => (current === role.id ? null : role.id))}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-blue-50"
                  >
                    <MoreHorizontal size={22} />
                  </button>
                  {openMenuId === role.id ? (
                    <div className="absolute right-0 top-9 z-20 w-28 overflow-hidden rounded-[10px] bg-white py-2 text-sm font-black text-ink shadow-[0_14px_36px_rgba(23,35,61,0.16)] ring-1 ring-blue-100">
                      <button type="button" onClick={() => openEditor(role)} className="block w-full px-4 py-2.5 text-left hover:bg-blue-50">编辑</button>
                      <button type="button" onClick={() => setOpenMenuId(null)} className="block w-full px-4 py-2.5 text-left hover:bg-blue-50">禁用</button>
                      <button type="button" onClick={() => void handleDeleteRole(role)} className="block w-full px-4 py-2.5 text-left text-red-500 hover:bg-red-50">删除</button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between text-sm font-semibold text-ink/70">
            <span>共 {filteredRoles.length} 个角色</span>
            <div className="flex items-center gap-3">
              <button type="button" className="secondary-button h-10 w-10">‹</button>
              <button type="button" className="gradient-button h-10 w-10 font-black">1</button>
              <button type="button" className="secondary-button h-10 w-10">2</button>
              <button type="button" className="secondary-button h-10 w-10">›</button>
              <select className="ml-5 h-10 w-[120px] border px-3 text-sm font-black outline-none"><option>每页 6 条</option></select>
            </div>
          </div>
        </section>
      )}

      {selected ? (
        <div className="fixed inset-0 z-50 bg-ink/18" onClick={() => setSelected(null)}>
          <aside className="fixed bottom-0 right-0 top-0 flex h-screen w-[max(50vw,760px)] flex-col bg-white shadow-[0_18px_60px_rgba(23,35,61,0.18)]" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setSelected(null)} className="absolute right-6 top-6 text-ink/55"><X size={24} /></button>
            <div className="min-h-0 flex-1 overflow-auto p-8 pr-12">
              <h2 className="mb-6 text-2xl font-black text-ink">角色编辑</h2>
              <div className="grid grid-cols-[minmax(220px,2fr)_120px_minmax(140px,1fr)_100px] gap-4">
                <label className="space-y-2 text-sm font-black text-ink">名称<input value={draft?.name || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), name: event.target.value }))} className="h-11 w-full border px-4 outline-none" /></label>
                <label className="relative space-y-2 text-sm font-black text-ink">性别<select value={draft?.gender || '未知'} onChange={(event) => setDraft((current) => ({ ...(current || {}), gender: event.target.value as CharacterGender }))} className="h-11 w-full appearance-none border bg-white px-4 pr-10 outline-none"><option>女</option><option>男</option><option>未知</option></select><ChevronDown size={16} className="pointer-events-none absolute bottom-3.5 right-3 text-ink/45" /></label>
                <label className="space-y-2 text-sm font-black text-ink">出生地<input value={draft?.birthplace || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), birthplace: event.target.value }))} className="h-11 w-full border px-4 outline-none" placeholder="请输入出生地" /></label>
                <label className="space-y-2 text-sm font-black text-ink">年龄<input type="number" min="0" max="150" value={draft?.age ?? ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), age: event.target.value ? Number(event.target.value) : null }))} className="h-11 w-full border px-4 outline-none" placeholder="岁" /></label>
              </div>
              <div className="mt-5 grid grid-cols-5 gap-4">
                <label className="space-y-2 text-sm font-black text-ink">身高<input type="number" min="0" value={draft?.height_cm ?? ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), height_cm: event.target.value ? Number(event.target.value) : null }))} className="h-11 w-full border px-4 outline-none" placeholder="cm" /></label>
                <label className="space-y-2 text-sm font-black text-ink">体重<input type="number" min="0" step="0.1" value={draft?.weight_kg ?? ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), weight_kg: event.target.value ? Number(event.target.value) : null }))} className="h-11 w-full border px-4 outline-none" placeholder="kg" /></label>
                <label className="space-y-2 text-sm font-black text-ink">肤色<input value={draft?.skin_tone || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), skin_tone: event.target.value }))} className="h-11 w-full border px-4 outline-none" placeholder="例如：白皙" /></label>
                <label className="space-y-2 text-sm font-black text-ink">发型<input value={draft?.hairstyle || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), hairstyle: event.target.value }))} className="h-11 w-full border px-4 outline-none" placeholder="例如：黑色长发" /></label>
                <label className="space-y-2 text-sm font-black text-ink">服饰风格<input value={draft?.clothing_style || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), clothing_style: event.target.value }))} className="h-11 w-full border px-4 outline-none" placeholder="例如：休闲" /></label>
              </div>
              <label className="mt-5 block space-y-2 text-sm font-black text-ink">
                <span>人设</span>
                <span className="block text-sm font-semibold text-[#8A97AD]">人物性格特征、常用语、开场白</span>
                <textarea value={draft?.intro || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), intro: event.target.value }))} className="h-28 w-full resize-none border p-4 leading-7 outline-none" maxLength={200} />
              </label>

              <div className="mt-7 pt-6">
                <div className="mb-4 text-base font-black text-ink">形象音色 <span className="ml-2 text-sm font-semibold text-[#8A97AD]">支持图片 / 视频 / 音频，用于真人视频、写真集和数字人视频生成</span></div>
                <div className="flex flex-wrap gap-3 pb-2">
                  {(selected.assets || []).map((asset, item) => (
                    <AssetThumb
                      key={`${asset.url || asset.name || asset.type}-${item}`}
                      asset={asset}
                      index={item}
                      tone={selectedTone}
                      onDelete={() => void handleDeleteAsset(item)}
                    />
                  ))}
                  {!(selected.assets || []).some((asset) => assetMatchesCategory(asset, 'three_view')) ? <MaterialCategoryCard icon={Images} label="三视图" onUpload={() => openLocalUpload('three_view')} onReference={() => void openWorkPicker('three_view')} onGenerate={() => generateMaterial('three_view')} /> : null}
                  {!(selected.assets || []).some((asset) => assetMatchesCategory(asset, 'expression')) ? <MaterialCategoryCard icon={Smile} label="表情图" onUpload={() => openLocalUpload('expression')} onReference={() => void openWorkPicker('expression')} onGenerate={() => generateMaterial('expression')} /> : null}
                  {!(selected.assets || []).some((asset) => assetMatchesCategory(asset, 'audio')) ? <MaterialCategoryCard icon={AudioLines} label="音频" onUpload={() => openLocalUpload('audio')} onReference={() => void openWorkPicker('audio')} onGenerate={() => generateMaterial('audio')} /> : null}
                  {!(selected.assets || []).some((asset) => assetMatchesCategory(asset, 'video')) ? <MaterialCategoryCard icon={Clapperboard} label="视频" onUpload={() => openLocalUpload('video')} onReference={() => void openWorkPicker('video')} onGenerate={() => generateMaterial('video')} /> : null}
                </div>
              </div>

              <div className="mt-7 pt-6">
                <div className="mb-4 text-base font-black text-ink">故事与记忆 <span className="ml-2 text-sm font-semibold text-[#8A97AD]">支持 TXT / MD / JSON / PNG / JPG 等格式</span></div>
                <div className="flex flex-wrap gap-3 pb-2">
                  {(selected.memory_files || []).map((asset, item) => (
                    <AssetThumb
                      key={`${asset.url || asset.name || asset.type}-${item}`}
                      asset={asset}
                      index={item}
                      tone={selectedTone}
                      onDelete={() => void handleDeleteMemory(item)}
                    />
                  ))}
                  <AssetUploadBox label="上传记忆" onClick={() => memoryInputRef.current?.click()} />
                </div>
              </div>

              <div className="mt-7 pt-6">
                <div className="mb-4 text-base font-black text-ink">思考模型</div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setThinkingModel('preset')}
                    className={`h-12 rounded-[12px] border text-sm font-black ${thinkingModel === 'preset' ? 'border-primary bg-blue-50 text-primary' : 'border-blue-100 bg-white text-ink'}`}
                  >
                    系统预设
                  </button>
                  <button
                    type="button"
                    onClick={() => setThinkingModel('custom')}
                    className={`h-12 rounded-[12px] border text-sm font-black ${thinkingModel === 'custom' ? 'border-primary bg-blue-50 text-primary' : 'border-blue-100 bg-white text-ink'}`}
                  >
                    自定义
                  </button>
                </div>
                {thinkingModel === 'custom' ? (
                  <div className="mt-4 grid gap-4">
                    <label className="space-y-2 text-sm font-black text-ink">模型调用地址<input value={draft?.model_endpoint || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), model_endpoint: event.target.value }))} className="h-11 w-full border px-4 outline-none" placeholder="https://api.example.com/v1/chat/completions" /></label>
                    <label className="space-y-2 text-sm font-black text-ink">调用格式<textarea value={draft?.model_format || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), model_format: event.target.value }))} className="h-24 w-full resize-none border p-4 leading-7 outline-none" placeholder="请输入请求体格式或 JSON 模板" /></label>
                    <label className="space-y-2 text-sm font-black text-ink">API Key<input value={draft?.api_key || ''} onChange={(event) => setDraft((current) => ({ ...(current || {}), api_key: event.target.value }))} className="h-11 w-full border px-4 outline-none" type="password" placeholder={selected.api_key_masked || '请输入 API Key'} /></label>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end gap-3 bg-white px-8 py-5 pr-12">
              <button type="button" onClick={() => setSelected(null)} className="secondary-button h-11 px-8 text-sm font-black">取消</button>
              <button type="button" onClick={() => void handleSaveRole()} className="gradient-button h-11 px-8 text-sm font-black">保存</button>
            </div>
          </aside>
        </div>
      ) : null}
      {workPickerCategory ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/30 p-8" onClick={() => setWorkPickerCategory(null)}>
          <section className="max-h-[76vh] w-[720px] overflow-hidden rounded-[18px] bg-white shadow-[0_24px_80px_rgba(23,35,61,0.22)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-blue-50 px-6 py-5">
              <div><h3 className="text-xl font-black text-ink">引用我的作品</h3><p className="mt-1 text-sm font-semibold text-ink/45">选择一个作品作为当前角色素材</p></div>
              <button type="button" onClick={() => setWorkPickerCategory(null)} className="grid h-9 w-9 place-items-center rounded-full text-ink/50 hover:bg-blue-50"><X size={20} /></button>
            </div>
            <div className="max-h-[58vh] overflow-auto p-6">
              {workPickerLoading ? <div className="py-20 text-center font-semibold text-ink/45">正在加载作品...</div> : availableWorks.length ? (
                <div className="grid grid-cols-3 gap-4">
                  {availableWorks.map((work) => {
                    const url = workAssetUrl(work);
                    return <button key={work.id} type="button" onClick={() => void referenceWork(work)} className="overflow-hidden rounded-[12px] border border-blue-100 bg-blue-50/30 text-left transition hover:border-primary">
                      <div className="aspect-video bg-blue-50">{work.type === 'video' ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} className="h-full w-full object-cover" />}</div>
                      <div className="truncate px-3 py-3 text-sm font-black text-ink">{work.title || `作品 ${work.id}`}</div>
                    </button>;
                  })}
                </div>
              ) : <div className="py-20 text-center font-semibold text-ink/45">暂无可引用的作品</div>}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

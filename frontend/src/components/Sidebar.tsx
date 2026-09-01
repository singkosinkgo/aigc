import { Box, FilePenLine, FolderOpen, ImageIcon, PlaySquare, UserRound } from 'lucide-react';
import logoLong from '../assets/logo-long.png';
import type { ContentType, User } from '../types';

export type PageKey = 'script' | 'image' | 'video' | 'edit' | 'characters' | 'works' | 'models';

const nav = [
  { key: 'script', title: '创作剧本', icon: FilePenLine },
  { key: 'image', title: '创作图片', icon: ImageIcon },
  { key: 'video', title: '创作视频', icon: PlaySquare },
  { key: 'characters', title: '我的素材', icon: UserRound },
  { key: 'works', title: '我的作品', icon: FolderOpen },
  { key: 'models', title: '我的模型', icon: Box },
] satisfies Array<{ key: PageKey; title: string; icon: React.ElementType }>;

interface Props {
  active: PageKey;
  user: User | null;
  onChange: (page: PageKey) => void;
}

export default function Sidebar({ active, user, onChange }: Props) {
  return (
    <aside className="fixed left-0 top-0 h-screen w-[250px] border-r border-[rgba(126,170,255,0.16)] bg-white/45 px-6 py-8 shadow-soft backdrop-blur-[24px]">
      <div className="mb-10">
        <img src={logoLong} alt="LeapAI" className="h-[42px] w-[145px] object-contain object-left" />
      </div>

      <div className="absolute left-[28px] top-[150px] bottom-[210px] w-px bg-blue-100">
        {nav.map((item, index) => (
          <span
            key={item.key}
            className={`absolute -left-[5px] h-[11px] w-[11px] rounded-full border-2 ${
              active === item.key ? 'border-primary bg-white ring-4 ring-blue-100' : 'border-blue-200 bg-white'
            }`}
            style={{ top: index * 95 }}
          />
        ))}
      </div>

      <nav className="space-y-3">
        {nav.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <a
              key={item.key}
              href={`#${item.key}`}
              className={`ml-7 flex h-[82px] w-[186px] items-center gap-4 px-4 text-left transition ${
                selected ? 'sidebar-menu-card-selected' : 'sidebar-menu-card hover:bg-white/65'
              }`}
              onClick={() => onChange(item.key)}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#EEF6FF] to-[#F4F0FF] text-primary shadow-[0_8px_20px_rgba(47,128,255,0.10)]">
                <Icon size={24} />
              </span>
              <span>
                <span className="block text-base font-bold text-ink">{item.title}</span>
              </span>
            </a>
          );
        })}
      </nav>

      <div className="sidebar-menu-card absolute bottom-8 left-5 right-5 flex items-center gap-3 p-4">
        <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-br from-blue-100 to-sky-100">
          {user?.avatar_url ? <img src={user.avatar_url} className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            {user?.nickname || '伦琴'}
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-primary">Pro</span>
          </div>
          <div className="mt-1 text-sm font-bold text-ink/80">86,436</div>
        </div>
      </div>
    </aside>
  );
}

export function typeLabel(type: ContentType) {
  return type === 'script' ? '剧本' : type === 'image' ? '图片' : '视频';
}

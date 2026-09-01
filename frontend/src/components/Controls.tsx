import type { ReactNode } from 'react';

interface Option {
  value: string;
  title: string;
  subtitle?: string;
  badge?: string;
}

export function SegmentedCards({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-8">
      <div className="w-24 text-base font-bold text-ink">{label}</div>
      <div className="flex gap-3">
        {options.map((option) => (
          <button
            key={option.value}
            className={`relative h-[72px] min-w-[128px] px-5 text-center transition ${
              value === option.value ? 'option-card-selected text-primary' : 'option-card text-ink hover:border-primary/50'
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.badge ? (
              <span className="absolute -right-2 -top-3 rounded-[6px] border border-violet bg-white px-1.5 py-0.5 text-xs font-bold text-violet">
                {option.badge}
              </span>
            ) : null}
            <span className="block text-xl font-black">{option.title}</span>
            {option.subtitle ? <span className="mt-1 block text-xs font-bold">{option.subtitle}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PrimaryButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="gradient-button flex h-14 items-center justify-center gap-2 px-8 text-base font-bold disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="secondary-button flex h-11 items-center justify-center gap-2 px-5 font-bold">
      {children}
    </button>
  );
}

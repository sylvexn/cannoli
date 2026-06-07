import { cn } from '@/lib/utils';

interface PokemonNicknameProps {
  nickname?: string | null;
  className?: string;
  prefix?: string;
}

export function PokemonNickname({ nickname, className, prefix = '"' }: PokemonNicknameProps) {
  if (!nickname || !nickname.trim()) return null;
  const text = prefix === '"' ? `"${nickname}"` : `${prefix}${nickname}`;
  return (
    <span
      className={cn('italic text-text-muted text-[11px] truncate', className)}
      title={nickname}
    >
      {text}
    </span>
  );
}

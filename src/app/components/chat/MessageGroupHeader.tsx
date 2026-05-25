interface MessageGroupHeaderProps {
  name?: string;
  align: 'start' | 'end';
}

export function MessageGroupHeader({ name, align }: MessageGroupHeaderProps) {
  if (!name) return null;

  return (
    <div
      className={`mb-1 flex items-baseline text-xs leading-none ${
        align === 'end' ? 'justify-end' : 'justify-start'
      }`}
    >
      <strong className="font-semibold text-gray-800 dark:text-[#9aa8b6]">{name}</strong>
    </div>
  );
}

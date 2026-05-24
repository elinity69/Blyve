import { motion } from 'framer-motion';

interface TypingBubbleProps {
  className?: string;
  /** When true, bubble flows in layout instead of absolute positioning above input. */
  inline?: boolean;
}

export function TypingBubble({ className, inline = false }: TypingBubbleProps) {
  const dots = [0, 1, 2];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`${
        inline ? 'relative' : 'absolute bottom-full left-4 mb-2'
      } z-30 flex items-center gap-1.5 rounded-full px-3 py-2 bg-[#1C1C1E]/75 shadow-md ${className ?? ''}`}
      style={{ width: 52, height: 32 }}
    >
      <span className="absolute -bottom-1 left-3 w-2.5 h-2.5 bg-[#1C1C1E]/75 rotate-45 rounded-sm" />
      {dots.map((index) => (
        <motion.span
          key={index}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            backgroundColor: '#0A84FF',
            boxShadow: '0 0 4px rgba(10, 132, 255, 0.55)',
            transform: 'translateZ(0)',
          }}
          animate={{
            opacity: [0.4, 1, 0.4],
            y: [0, -2.5, 0],
          }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: index * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </motion.div>
  );
}

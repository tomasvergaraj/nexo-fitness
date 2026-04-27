import { motion } from 'framer-motion';

interface BlurTextProps {
  text: string;
  className?: string;
  delay?: number;
  wordDelay?: number;
}

export default function BlurText({ text, className, delay = 0, wordDelay = 0.07 }: BlurTextProps) {
  const words = text.split(' ');
  return (
    <span className={className} aria-label={text}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: 'blur(14px)', y: 10 }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{ duration: 0.55, delay: delay + i * wordDelay, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ display: 'inline-block', marginRight: '0.26em' }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

import { motion } from 'framer-motion';

const BLOBS = [
  {
    cls: 'aurora-blob-1',
    x: [0, 50, -25, 0], y: [0, -40, 25, 0],
    scale: [1, 1.1, 0.95, 1], opacity: [1, 1, 0.85, 1],
    duration: 9, delay: 0,
  },
  {
    cls: 'aurora-blob-2',
    x: [0, -40, 25, 0], y: [0, 30, -20, 0],
    scale: [1, 1.12, 0.94, 1], opacity: [1, 1, 0.8, 1],
    duration: 11, delay: 0,
  },
  {
    cls: 'aurora-blob-3',
    x: [0, 25, -10, 0], y: [0, 35, -10, 0],
    scale: [1, 1.08, 0.97, 1], opacity: [1, 1, 0.75, 1],
    duration: 13, delay: 0,
  },
  {
    cls: 'aurora-blob-4',
    x: [0, 45, -20, 0], y: [0, -25, 30, 0],
    scale: [1, 1.09, 0.96, 1], opacity: [1, 1, 0.82, 1],
    duration: 10, delay: 2,
  },
];

export default function Aurora() {
  return (
    <div className="aurora-wrapper" aria-hidden="true">
      {BLOBS.map(({ cls, x, y, scale, opacity, duration, delay }) => (
        <motion.div
          key={cls}
          className={`aurora-blob ${cls}`}
          animate={{ x, y, scale, opacity }}
          transition={{ duration, ease: 'easeInOut', repeat: Infinity, repeatType: 'loop', delay }}
        />
      ))}
    </div>
  );
}

import { type Variants, type Transition } from 'framer-motion';

/* ─── Transitions ────────────────────────────────────────────── */

export const springTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
};

export const smoothTransition: Transition = {
  duration: 0.4,
  ease: [0.25, 0.46, 0.45, 0.94],
};

export const quickTransition: Transition = {
  duration: 0.2,
  ease: 'easeOut',
};

/* ─── Page Variants ──────────────────────────────────────────── */

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

/* ─── Stagger Container ─────────────────────────────────────── */

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
};

export const staggerContainerSlow: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

/* ─── Item Variants ──────────────────────────────────────────── */

export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: smoothTransition },
};

export const fadeInDown: Variants = {
  initial: { opacity: 0, y: -15 },
  animate: { opacity: 1, y: 0, transition: smoothTransition },
};

export const fadeInLeft: Variants = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0, transition: smoothTransition },
};

export const fadeInRight: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0, transition: smoothTransition },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1, transition: springTransition },
};

export const slideUp: Variants = {
  initial: { opacity: 0, y: 40 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
};

/* ─── Card Hover ─────────────────────────────────────────────── */

export const cardHover = {
  rest: { scale: 1, y: 0 },
  hover: {
    scale: 1.02,
    y: -4,
    transition: { type: 'spring', stiffness: 400, damping: 25 },
  },
  tap: { scale: 0.98 },
};

/* ─── Sidebar ────────────────────────────────────────────────── */

export const sidebarVariants: Variants = {
  open: {
    x: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },
  closed: {
    x: -280,
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },
};

/* ─── Modal / Dialog ─────────────────────────────────────────── */

export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalVariants: Variants = {
  initial: { opacity: 0, scale: 0.95, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: springTransition },
  exit: { opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.15 } },
};

/* ─── Notification ───────────────────────────────────────────── */

export const notificationVariants: Variants = {
  initial: { opacity: 0, x: 100, scale: 0.95 },
  animate: { opacity: 1, x: 0, scale: 1, transition: springTransition },
  exit: { opacity: 0, x: 100, scale: 0.95, transition: quickTransition },
};

/* ─── Counter animation ──────────────────────────────────────── */

export const numberVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

/* ─── Chart bar ──────────────────────────────────────────────── */

export const barVariants: Variants = {
  initial: { scaleY: 0 },
  animate: (height: number) => ({
    scaleY: 1,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: height * 0.05 },
  }),
};

/* ─── List item ──────────────────────────────────────────────── */

export const listItemVariants: Variants = {
  initial: { opacity: 0, x: -10 },
  animate: { opacity: 1, x: 0, transition: quickTransition },
  exit: { opacity: 0, x: 10, transition: quickTransition },
};

/* ─── Pulse indicator ────────────────────────────────────────── */

export const pulseVariants: Variants = {
  animate: {
    scale: [1, 1.2, 1],
    opacity: [1, 0.7, 1],
    transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
  },
};

/* ─── Floating element ───────────────────────────────────────── */

export const floatVariants: Variants = {
  animate: {
    y: [0, -8, 0],
    transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
  },
};

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Clock, Users, Wifi, ChevronDown } from 'lucide-react';
import { formatTime } from '@/utils';
import type { TenantPublicProfile } from '@/types';

type GymClass = TenantPublicProfile['upcoming_classes'][number];

interface Props {
  classes: GymClass[];
}

function capacityColor(bookings: number, capacity: number): string {
  const pct = capacity > 0 ? bookings / capacity : 0;
  if (pct >= 1) return 'sf-capacity-full';
  if (pct >= 0.8) return 'sf-capacity-high';
  return 'sf-capacity-ok';
}

function ClassRow({ cls }: { cls: GymClass }) {
  const full = cls.bookings >= cls.capacity;
  const capClass = capacityColor(cls.bookings, cls.capacity);

  return (
    <motion.div
      className="sf-class-row flex items-center gap-3 p-4 rounded-2xl"
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-20px' }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      {/* Date block */}
      <div className="sf-class-date flex-shrink-0 w-12 text-center">
        <div className="sf-brand-text text-xs font-bold uppercase leading-none">
          {new Date(cls.start_time).toLocaleDateString('es-CL', { month: 'short' })}
        </div>
        <div className="sf-heading text-2xl font-black leading-tight">
          {new Date(cls.start_time).getDate()}
        </div>
      </div>

      {/* Divider */}
      <div className="sf-divider-v w-px self-stretch" />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="sf-text-strong font-bold text-sm truncate">{cls.name}</span>
          {cls.modality === 'online' && (
            <span className="sf-chip-sm flex items-center gap-1">
              <Wifi className="w-2.5 h-2.5" />
              Online
            </span>
          )}
          {cls.modality === 'hybrid' && (
            <span className="sf-chip-sm">Híbrida</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 sf-text-muted text-xs">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTime(cls.start_time)}
          </span>
          {cls.branch_name && (
            <span className="truncate">{cls.branch_name}</span>
          )}
        </div>
      </div>

      {/* Capacity */}
      <div className={`flex-shrink-0 flex items-center gap-1 text-xs font-bold ${capClass}`}>
        <Users className="w-3.5 h-3.5" />
        {full ? 'Llena' : `${cls.bookings}/${cls.capacity}`}
      </div>
    </motion.div>
  );
}

export default function ClassSchedule({ classes }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? classes : classes.slice(0, 3);

  return (
    <section className="sf-section">
      <div className="sf-container max-w-2xl">
        <motion.div
          className="flex items-center gap-3 mb-6"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Calendar className="sf-brand-icon w-5 h-5" />
          <h2 className="sf-heading text-2xl font-black tracking-tight">Próximas clases</h2>
        </motion.div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {visible.map(cls => (
              <ClassRow key={cls.id} cls={cls} />
            ))}
          </AnimatePresence>
        </div>

        {classes.length > 3 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 sf-text-muted text-sm font-medium hover:sf-text-strong transition-colors"
          >
            {expanded ? 'Ver menos' : `Ver ${classes.length - 3} clases más`}
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.25 }}>
              <ChevronDown className="w-4 h-4" />
            </motion.span>
          </button>
        )}
      </div>
    </section>
  );
}

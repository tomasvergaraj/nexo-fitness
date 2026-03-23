import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CreditCard, Users, ArrowUpRight, Dumbbell } from 'lucide-react';
import { staggerContainer, fadeInUp } from '@/utils/animations';

const programCards = [
  {
    title: 'Programacion de clases',
    description: 'Organiza bloques semanales, horarios e instructores desde el modulo de clases.',
    path: '/classes',
    cta: 'Ir a clases',
    icon: CalendarDays,
  },
  {
    title: 'Planes y membresias',
    description: 'Ajusta duraciones, precios y estados para que tus programas comerciales esten al dia.',
    path: '/plans',
    cta: 'Ver planes',
    icon: CreditCard,
  },
  {
    title: 'Clientes activos',
    description: 'Revisa la base de alumnos y manten su estado actualizado desde clientes.',
    path: '/clients',
    cta: 'Abrir clientes',
    icon: Users,
  },
];

export default function ProgramsPage() {
  const navigate = useNavigate();

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 p-6 text-white shadow-xl shadow-brand-500/20">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
            <Dumbbell size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-display">Programas</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/80">
              Esta vista centraliza accesos a la operacion que arma tu oferta: clases, membresias y alumnos.
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {programCards.map((card, index) => (
          <motion.div
            key={card.title}
            variants={fadeInUp}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-950/40">
              <card.icon size={22} />
            </div>
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{card.title}</h2>
            <p className="mt-2 text-sm text-surface-500">{card.description}</p>
            <button
              type="button"
              onClick={() => navigate(card.path)}
              className="btn-primary mt-5 w-full justify-between text-sm"
            >
              {card.cta}
              <ArrowUpRight size={16} />
            </button>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

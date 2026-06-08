import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { mobileApi } from '@/services/api';
import { cn } from '@/utils';
import { useMemberContext } from '../MemberContext';
import { Panel } from './MemberShared';

interface PendingNps {
  checkin_id: string;
  gym_class_id: string;
  class_name: string;
  class_start_time: string;
  checked_in_at: string;
}

const SCORES = Array.from({ length: 11 }, (_, i) => i);

export default function NpsPrompt() {
  const { accentColor, brandGradient, queryClient } = useMemberContext();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');

  const pendingQuery = useQuery<PendingNps | null>({
    queryKey: ['mobile', 'nps', 'pending'],
    queryFn: async () => (await mobileApi.getPendingNps()).data ?? null,
    staleTime: 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: (vars: { checkin_id: string; score: number; comment?: string }) =>
      mobileApi.submitNps(vars),
    onSuccess: () => {
      toast.success('¡Gracias por tu opinión!');
      setScore(null);
      setComment('');
      void queryClient.invalidateQueries({ queryKey: ['mobile', 'nps', 'pending'] });
    },
    onError: () => toast.error('No pudimos registrar tu respuesta. Intenta de nuevo.'),
  });

  const pending = pendingQuery.data;
  if (!pending) return null;

  function handleSubmit() {
    if (score === null || !pending) return;
    submitMutation.mutate({
      checkin_id: pending.checkin_id,
      score,
      comment: comment.trim() || undefined,
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <Panel title="¿Cómo estuvo tu clase?">
        <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
          Asististe a <span className="font-semibold text-surface-900 dark:text-white">{pending.class_name}</span>.
          ¿Qué tan probable es que la recomiendes? (0 = nada, 10 = muchísimo)
        </p>

        <div className="mt-4 grid grid-cols-11 gap-1">
          {SCORES.map((n) => {
            const selected = score === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                aria-label={`Puntaje ${n}`}
                aria-pressed={selected}
                className={cn(
                  'flex h-10 items-center justify-center rounded-lg text-sm font-bold transition-colors',
                  selected
                    ? 'text-white'
                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-white/5 dark:text-surface-300 dark:hover:bg-white/10',
                )}
                style={selected ? { background: brandGradient } : undefined}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-surface-400 dark:text-surface-500">
          <span>Nada probable</span>
          <span>Muy probable</span>
        </div>

        {score !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="overflow-hidden"
          >
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="¿Algo que quieras contarnos? (opcional)"
              maxLength={1000}
              className="input mt-4 min-h-20 resize-y"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
              className="btn-primary mt-3 w-full"
              style={{ background: brandGradient, borderColor: accentColor }}
            >
              <Send size={16} />
              {submitMutation.isPending ? 'Enviando...' : 'Enviar mi opinión'}
            </button>
          </motion.div>
        )}
      </Panel>
    </motion.div>
  );
}

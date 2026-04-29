import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import { EmptyState, Panel, SkeletonListItems } from '../components/MemberShared';
import { cn, formatCurrency, formatDate, formatDateTime, paymentStatusColor } from '@/utils';
import { useMemberContext } from '../MemberContext';

export default function PaymentsTab() {
  const { payments, paymentsQuery } = useMemberContext();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="space-y-4"
    >
      {paymentsQuery.isLoading && !paymentsQuery.data ? (
        <SkeletonListItems count={3} />
      ) : payments.length === 0 ? (
        <EmptyState
          title="Aún no hay pagos"
          description="El historial aparecerá aquí apenas existan pagos para este miembro."
        />
      ) : (
        payments.map((payment) => {
          const title =
            payment.plan_name_snapshot ||
            payment.plan_name ||
            payment.description ||
            'Pago del miembro';

          const dateLabel = payment.paid_at
            ? `Pagado ${formatDateTime(payment.paid_at)}`
            : `Creado ${formatDateTime(payment.created_at)}`;

          const hasPeriod = Boolean(payment.membership_starts_at_snapshot);
          const periodLabel = hasPeriod
            ? `Período comprado: ${formatDate(payment.membership_starts_at_snapshot!)} · ${
                payment.membership_expires_at_snapshot
                  ? formatDate(payment.membership_expires_at_snapshot)
                  : 'Sin vencimiento'
              }`
            : null;

          return (
            <Panel key={payment.id} title={title}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('badge', paymentStatusColor(payment.status))}>
                  {payment.status}
                </span>
                <span className="badge badge-neutral">{payment.method}</span>
              </div>

              <p className="mt-3 text-2xl font-bold font-display text-surface-900 dark:text-white">
                {formatCurrency(payment.amount, payment.currency)}
              </p>

              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">{dateLabel}</p>

              {periodLabel ? (
                <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">{periodLabel}</p>
              ) : null}

              {payment.receipt_url ? (
                <a
                  href={payment.receipt_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary mt-4 inline-flex items-center gap-2"
                >
                  <ExternalLink size={16} />
                  Ver comprobante
                </a>
              ) : null}
            </Panel>
          );
        })
      )}
    </motion.div>
  );
}

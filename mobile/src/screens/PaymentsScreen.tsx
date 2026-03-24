import { Linking, Text, View } from 'react-native';

import { formatCurrency, formatDateTime, formatStatus } from '../lib/formatters';
import { ActionButton, InlineActionButton, Metric, StatusBlock } from '../ui/components';
import { styles } from '../ui/styles';
import type { MobileScreenProps } from './types';

export function PaymentsScreen({ app, accentColor }: MobileScreenProps) {
  const { isRestoringSession, isLoadingPayments, sessionUser, paymentHistory, paymentsMessage, loadPayments } = app;
  const receiptsCount = paymentHistory.filter((payment) => Boolean(payment.receipt_url)).length;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Historial de pagos</Text>
      <Text style={styles.sectionHint}>
        Los pagos quedan separados del resto para dar trazabilidad del miembro sin mezclar reservas ni checkout.
      </Text>
      <ActionButton
        label={isLoadingPayments ? 'Cargando pagos...' : 'Cargar historial'}
        accentColor={accentColor}
        disabled={isRestoringSession || isLoadingPayments}
        onPress={() => {
          void loadPayments();
        }}
      />
      <StatusBlock label="Estado pagos" message={paymentsMessage} />

      {sessionUser ? (
        <>
          <View style={styles.metricRow}>
            <Metric label="Pagos" value={String(paymentHistory.length)} />
            <Metric label="Comprobantes" value={String(receiptsCount)} />
          </View>

          {paymentHistory.length ? (
            <View style={styles.listBlock}>
              {paymentHistory.map((payment) => (
                <View key={payment.id} style={styles.listRow}>
                  <View style={styles.planHeader}>
                    <Text style={styles.listRowTitle}>
                      {payment.plan_name ?? payment.description ?? 'Pago de membresia'}
                    </Text>
                    <Text style={styles.paymentAmount}>{formatCurrency(payment.amount, payment.currency)}</Text>
                  </View>
                  <Text style={styles.listRowMeta}>
                    {formatStatus(payment.status)} - {formatStatus(payment.method)}
                  </Text>
                  <Text style={styles.description}>
                    {payment.paid_at
                      ? `Pagado el ${formatDateTime(payment.paid_at)}`
                      : `Registrado el ${formatDateTime(payment.created_at)}`}
                  </Text>
                  {payment.receipt_url ? (
                    <InlineActionButton
                      label="Abrir comprobante"
                      accentColor={accentColor}
                      tone="secondary"
                      onPress={() => {
                        void Linking.openURL(payment.receipt_url!);
                      }}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Todavia no hay pagos visibles para este cliente.</Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyText}>Inicia sesion desde Cuenta para revisar el historial de pagos.</Text>
      )}
    </View>
  );
}

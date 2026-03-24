import { Text, View } from 'react-native';

import { formatDate, formatDateTime, formatStatus } from '../lib/formatters';
import { ActionButton, Metric, StatusBlock } from '../ui/components';
import { styles } from '../ui/styles';
import type { MobileScreenProps } from './types';

export function HomeScreen({ app, accentColor, openClassDetail, openProfile }: MobileScreenProps) {
  const {
    isRestoringSession,
    isLoadingWallet,
    isCreatingCheckout,
    sessionUser,
    tenantProfile,
    plans,
    wallet,
    walletMessage,
    refreshWallet,
    renewMembership,
  } = app;
  const nextClassId = wallet?.next_class?.id ?? null;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Resumen del tenant</Text>
        <Text style={styles.sectionHint}>
          El storefront publico vive ahora como una seccion propia para que la app deje de depender de una sola pantalla larga.
        </Text>

        {tenantProfile ? (
          <>
            <View style={styles.metricRow}>
              <Metric label="Sedes" value={String(tenantProfile.branches.length)} />
              <Metric label="Planes" value={String(plans.length)} />
            </View>
            <View style={styles.metricRow}>
              <Metric label="Checkout" value={tenantProfile.checkout_enabled ? 'activo' : 'pendiente'} />
              <Metric label="Sesion" value={sessionUser ? 'activa' : 'pendiente'} />
            </View>

            <View style={[styles.brandingPanel, { borderColor: accentColor }]}>
              <Text style={styles.primaryValue}>{tenantProfile.tenant_name}</Text>
              <Text style={styles.secondaryValue}>
                {[tenantProfile.city, tenantProfile.address].filter(Boolean).join(' - ') || 'Sin direccion publica'}
              </Text>
              <Text style={styles.description}>
                {tenantProfile.branding.marketplace_description ??
                  'Storefront central listo para exponer catalogo, beneficios y checkout.'}
              </Text>
            </View>

            <View style={styles.listBlock}>
              <Text style={styles.listTitle}>Proximas clases destacadas</Text>
              {tenantProfile.upcoming_classes.length ? (
                tenantProfile.upcoming_classes.slice(0, 3).map((gymClass) => (
                  <View key={gymClass.id} style={styles.listRow}>
                    <Text style={styles.listRowTitle}>{gymClass.name}</Text>
                    <Text style={styles.listRowMeta}>
                      {formatDateTime(gymClass.start_time)} - {formatStatus(gymClass.modality)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>Todavia no hay clases publicas cargadas.</Text>
              )}
            </View>
          </>
        ) : (
          <Text style={styles.emptyText}>
            Carga el tenant desde la tab Cuenta para ver branding, planes y clases destacadas.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Wallet y acceso</Text>
        <Text style={styles.sectionHint}>
          Sigue siendo el centro del miembro, pero ahora queda separada del resto del setup para que el uso diario sea mas claro.
        </Text>
        <ActionButton
          label={isLoadingWallet ? 'Sincronizando wallet...' : 'Sincronizar wallet'}
          accentColor={accentColor}
          disabled={isRestoringSession || isLoadingWallet}
          onPress={() => {
            void refreshWallet();
          }}
        />
        <StatusBlock label="Estado wallet" message={walletMessage} />

        {wallet ? (
          <>
            <View style={styles.metricRow}>
              <Metric label="Plan" value={wallet.plan_name ?? 'Sin plan'} />
              <Metric label="Estado" value={formatStatus(wallet.membership_status)} />
            </View>
            <View style={styles.metricRow}>
              <Metric label="Vence" value={formatDate(wallet.expires_at)} />
              <Metric label="QR" value={wallet.qr_payload ? 'listo' : 'pendiente'} />
            </View>

            <View style={styles.inlinePanel}>
              <Text style={styles.primaryValue}>{wallet.tenant_name}</Text>
              <Text style={styles.secondaryValue}>{wallet.tenant_slug}</Text>
              <Text style={styles.description}>
                {wallet.next_class
                  ? `Proxima clase: ${wallet.next_class.name} - ${formatDateTime(wallet.next_class.start_time)}`
                  : 'Todavia no hay reserva vinculada en la wallet.'}
              </Text>
              <Text style={styles.description}>
                Renovacion: {wallet.auto_renew ? 'automatica' : 'manual'}
              </Text>
            </View>

            {nextClassId || sessionUser ? (
              <View style={styles.actionRow}>
                {nextClassId && openClassDetail ? (
                  <ActionButton
                    label="Abrir proxima clase"
                    accentColor="#334155"
                    tone="secondary"
                    onPress={() => {
                      openClassDetail(nextClassId);
                    }}
                  />
                ) : null}
                {sessionUser && openProfile ? (
                  <ActionButton
                    label="Abrir perfil"
                    accentColor="#334155"
                    tone="secondary"
                    onPress={openProfile}
                  />
                ) : null}
              </View>
            ) : null}

            <View style={styles.codeBlock}>
              <Text style={styles.codeLabel}>QR payload</Text>
              <Text style={styles.codeText}>{wallet.qr_payload ?? 'Sin QR disponible'}</Text>
            </View>

            <ActionButton
              label={isCreatingCheckout ? 'Preparando renovacion...' : 'Renovar plan actual'}
              accentColor={accentColor}
              disabled={
                isRestoringSession ||
                isCreatingCheckout ||
                !wallet.plan_id ||
                tenantProfile?.checkout_enabled === false
              }
              onPress={() => {
                void renewMembership();
              }}
            />
          </>
        ) : (
          <Text style={styles.emptyText}>Inicia sesion y sincroniza la wallet para ver datos reales.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Base lista para crecer</Text>
        <Text style={styles.listItem}>1. Inicio concentra tenant, wallet y el estado actual del miembro.</Text>
        <Text style={styles.listItem}>2. Agenda queda separada para reservas y cupos sin mezclar setup.</Text>
        <Text style={styles.listItem}>3. Checkout y pagos ya viven como recorridos independientes.</Text>
        <Text style={styles.listItem}>4. Cuenta agrupa configuracion, login y push notifications.</Text>
        <Text style={styles.listItem}>5. La siguiente capa puede montar navegacion real o detalle por flujo.</Text>
      </View>
    </>
  );
}

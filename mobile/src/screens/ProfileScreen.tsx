import { Text, View } from 'react-native';

import { formatDate, formatDateTime, formatStatus } from '../lib/formatters';
import { ActionButton, InlineActionButton, Metric, StatusBlock } from '../ui/components';
import { styles } from '../ui/styles';
import type { MobileScreenProps } from './types';

export function ProfileScreen({ app, accentColor, navigateToTab, openActionUrl }: MobileScreenProps) {
  const {
    sessionUser,
    wallet,
    reservations,
    paymentHistory,
    notifications,
    authMessage,
    walletMessage,
    notificationsMessage,
    isLoadingNotifications,
    activeNotificationId,
    refreshWallet,
    loadNotifications,
    markNotificationAsRead,
  } = app;

  if (!sessionUser) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Perfil</Text>
        <Text style={styles.sectionHint}>
          Esta pantalla queda preparada como destino deep-linked para notificaciones o accesos directos de cuenta.
        </Text>
        <StatusBlock label="Estado sesion" message={authMessage} />
        <Text style={styles.emptyText}>Inicia sesion desde Cuenta para ver tu perfil, wallet y actividad reciente.</Text>
      </View>
    );
  }

  const unreadCount = notifications.filter((notification) => !notification.is_read).length;
  const openedCount = notifications.filter((notification) => Boolean(notification.opened_at)).length;
  const clickedCount = notifications.filter((notification) => Boolean(notification.clicked_at)).length;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Perfil del miembro</Text>
        <Text style={styles.sectionHint}>
          Vista dedicada para datos del cliente, estado de membresia y accesos rapidos a sus recorridos frecuentes.
        </Text>

        <View style={styles.inlinePanel}>
          <Text style={styles.primaryValue}>
            {sessionUser.first_name} {sessionUser.last_name}
          </Text>
          <Text style={styles.secondaryValue}>{sessionUser.email}</Text>
          <Text style={styles.description}>Rol: {formatStatus(sessionUser.role)}</Text>
          <Text style={styles.description}>
            Telefono: {sessionUser.phone?.trim() ? sessionUser.phone : 'No informado'}
          </Text>
          <Text style={styles.description}>Alta: {formatDate(sessionUser.created_at)}</Text>
        </View>

        <View style={styles.metricRow}>
          <Metric label="Reservas" value={String(reservations.length)} />
          <Metric label="Pagos" value={String(paymentHistory.length)} />
        </View>

        <View style={styles.actionRow}>
          <ActionButton
            label="Ir a agenda"
            accentColor="#334155"
            tone="secondary"
            onPress={() => {
              navigateToTab?.('agenda');
            }}
          />
          <ActionButton
            label="Ir a pagos"
            accentColor="#334155"
            tone="secondary"
            onPress={() => {
              navigateToTab?.('payments');
            }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Resumen de wallet</Text>
        <Text style={styles.sectionHint}>
          Estado actual de la membresia y proxima actividad, ya desacoplado de la pantalla principal.
        </Text>
        <StatusBlock label="Estado wallet" message={walletMessage} />

        {wallet ? (
          <>
            <View style={styles.metricRow}>
              <Metric label="Plan" value={wallet.plan_name ?? 'Sin plan'} />
              <Metric label="Estado" value={formatStatus(wallet.membership_status)} />
            </View>
            <View style={styles.metricRow}>
              <Metric label="Vence" value={formatDate(wallet.expires_at)} />
              <Metric label="Tenant" value={wallet.tenant_name} />
            </View>
            <View style={styles.inlinePanel}>
              <Text style={styles.description}>
                {wallet.next_class
                  ? `Proxima clase: ${wallet.next_class.name} - ${formatDateTime(wallet.next_class.start_time)}`
                  : 'Todavia no hay proxima clase vinculada en la wallet.'}
              </Text>
              <Text style={styles.description}>
                Renovacion: {wallet.auto_renew ? 'automatica' : 'manual'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.emptyText}>Todavia no hay wallet cargada para esta sesion.</Text>
        )}

        <ActionButton
          label="Sincronizar wallet"
          accentColor={accentColor}
          onPress={() => {
            void refreshWallet();
          }}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Notificaciones</Text>
        <Text style={styles.sectionHint}>
          Reutiliza el `action_url` del backend para abrir la ruta correcta dentro de mobile, igual que cuando llegue una push real.
        </Text>
        <StatusBlock label="Estado notificaciones" message={notificationsMessage} />

        <View style={styles.metricRow}>
          <Metric label="Total" value={String(notifications.length)} />
          <Metric label="Sin leer" value={String(unreadCount)} />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Abiertas" value={String(openedCount)} />
          <Metric label="Clicks" value={String(clickedCount)} />
        </View>

        <ActionButton
          label={isLoadingNotifications ? 'Cargando notificaciones...' : 'Cargar notificaciones'}
          accentColor={accentColor}
          disabled={isLoadingNotifications}
          onPress={() => {
            void loadNotifications();
          }}
        />

        {notifications.length ? (
          <View style={styles.listBlock}>
            {notifications.map((notification) => {
              const isUpdating = activeNotificationId === notification.id;

              return (
                <View key={notification.id} style={styles.listRow}>
                  <View style={styles.planHeader}>
                    <Text style={styles.listRowTitle}>{notification.title}</Text>
                    <View
                      style={[
                        styles.stateBadge,
                        notification.is_read ? styles.stateBadgeMuted : { borderColor: accentColor },
                      ]}
                    >
                      <Text style={styles.stateBadgeText}>
                        {notification.is_read ? 'Leida' : 'Nueva'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.listRowMeta}>
                    {formatStatus(notification.type)} - {formatDateTime(notification.created_at)}
                  </Text>
                  {notification.opened_at || notification.clicked_at ? (
                    <Text style={styles.listRowMeta}>
                      {notification.opened_at ? `Apertura: ${formatDateTime(notification.opened_at)}` : 'Sin apertura'}
                      {notification.clicked_at ? ` - Click: ${formatDateTime(notification.clicked_at)}` : ''}
                    </Text>
                  ) : null}
                  <Text style={styles.description}>
                    {notification.message ?? 'Notificacion sin mensaje adicional.'}
                  </Text>
                  {notification.action_url ? (
                    <InlineActionButton
                      label="Abrir destino"
                      accentColor={accentColor}
                      tone="secondary"
                      disabled={isUpdating}
                      onPress={() => {
                        openActionUrl?.(notification.action_url!, notification.id);
                      }}
                    />
                  ) : null}
                  <InlineActionButton
                    label={
                      isUpdating
                        ? 'Actualizando...'
                        : notification.is_read
                          ? 'Marcar no leida'
                          : 'Marcar leida'
                    }
                    accentColor={accentColor}
                    disabled={isUpdating}
                    onPress={() => {
                      void markNotificationAsRead(notification.id, !notification.is_read);
                    }}
                  />
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptyText}>Todavia no hay notificaciones visibles para este miembro.</Text>
        )}
      </View>
    </>
  );
}

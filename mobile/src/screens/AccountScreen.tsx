import { Text, TextInput, View } from 'react-native';

import { formatDateTime, formatStatus } from '../lib/formatters';
import { ActionButton, Metric, StatusBlock } from '../ui/components';
import { styles } from '../ui/styles';
import type { MobileScreenProps } from './types';

function compactPushToken(token: string) {
  if (token.length <= 32) {
    return token;
  }

  return `${token.slice(0, 18)}...${token.slice(-10)}`;
}

export function AccountScreen({ app, accentColor, openProfile }: MobileScreenProps) {
  const {
    apiBaseUrl,
    setApiBaseUrl,
    tenantSlug,
    setTenantSlug,
    tenantProfile,
    tenantMessage,
    isRestoringSession,
    isLoadingTenant,
    loadTenantContext,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    sessionUser,
    authMessage,
    isLoggingIn,
    login,
    logout,
    pushTokenInput,
    setPushTokenInput,
    pushSubscriptions,
    lastPushDispatch,
    pushMessage,
    isRegisteringPush,
    isSendingPushPreview,
    isSendingRemotePushPreview,
    isLoadingPushSubscriptions,
    registerDevicePushToken,
    sendPushPreview,
    sendRemotePushPreview,
    registerPushToken,
    loadPushSubscriptions,
  } = app;
  const activeSubscriptions = pushSubscriptions.filter((subscription) => subscription.is_active).length;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Configuracion y tenant</Text>
        <Text style={styles.sectionHint}>
          Aqui quedan la API base y el `tenant slug` para recuperar o cambiar el storefront publico desde una sola zona de setup.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="API base URL"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          value={apiBaseUrl}
          onChangeText={setApiBaseUrl}
        />
        <TextInput
          style={styles.input}
          placeholder="Tenant slug"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          value={tenantSlug}
          onChangeText={setTenantSlug}
        />
        <ActionButton
          label={isRestoringSession ? 'Recuperando contexto...' : isLoadingTenant ? 'Cargando tenant...' : 'Cargar gimnasio'}
          accentColor={accentColor}
          disabled={isRestoringSession || isLoadingTenant}
          onPress={() => {
            void loadTenantContext();
          }}
        />
        <StatusBlock label="Estado tenant" message={tenantMessage} />

        {tenantProfile ? (
          <View style={styles.inlinePanel}>
            <Text style={styles.primaryValue}>{tenantProfile.tenant_name}</Text>
            <Text style={styles.secondaryValue}>{tenantProfile.tenant_slug}</Text>
            <Text style={styles.description}>
              Checkout {tenantProfile.checkout_enabled ? 'activo' : 'pendiente'} para {formatStatus(tenantProfile.city ?? 'ciudad no informada')}.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Acceso del cliente</Text>
        <Text style={styles.sectionHint}>
          El login queda aislado del resto para que la app pueda crecer a perfil, refresh token y settings de cuenta sin volver a mezclar todo.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#64748b"
          keyboardType="email-address"
          autoCapitalize="none"
          value={loginEmail}
          onChangeText={setLoginEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#64748b"
          secureTextEntry
          value={loginPassword}
          onChangeText={setLoginPassword}
        />
        <View style={styles.actionRow}>
          <ActionButton
            label={isRestoringSession ? 'Restaurando sesion...' : isLoggingIn ? 'Iniciando sesion...' : 'Iniciar sesion'}
            accentColor={accentColor}
            disabled={isRestoringSession || isLoggingIn}
            onPress={() => {
              void login();
            }}
          />
          <ActionButton
            label="Cerrar sesion"
            accentColor="#334155"
            tone="secondary"
            disabled={isRestoringSession}
            onPress={logout}
          />
        </View>
        <StatusBlock label="Estado sesion" message={authMessage} />

        {sessionUser ? (
          <View style={styles.inlinePanel}>
            <Text style={styles.primaryValue}>
              {sessionUser.first_name} {sessionUser.last_name}
            </Text>
            <Text style={styles.secondaryValue}>{sessionUser.email}</Text>
            <Text style={styles.description}>Rol: {formatStatus(sessionUser.role)}</Text>
            {openProfile ? (
              <ActionButton
                label="Abrir perfil"
                accentColor="#334155"
                tone="secondary"
                onPress={openProfile}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Push notifications</Text>
        <Text style={styles.sectionHint}>
          Permisos, prueba local, envio remoto via backend y estado de subscriptions quedan agrupados para facilitar pruebas reales en dispositivo.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="ExpoPushToken[...]"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          value={pushTokenInput}
          onChangeText={setPushTokenInput}
        />
        <View style={styles.actionRow}>
          <ActionButton
            label={isRegisteringPush ? 'Obteniendo token real...' : 'Usar token real'}
            accentColor={accentColor}
            disabled={isRestoringSession || isRegisteringPush || isSendingPushPreview}
            onPress={() => {
              void registerDevicePushToken();
            }}
          />
          <ActionButton
            label={isSendingPushPreview ? 'Enviando prueba...' : 'Probar local'}
            accentColor="#334155"
            tone="secondary"
            disabled={isRestoringSession || isRegisteringPush || isSendingPushPreview}
            onPress={() => {
              void sendPushPreview();
            }}
          />
        </View>
        <View style={styles.actionRow}>
          <ActionButton
            label={isSendingRemotePushPreview ? 'Enviando remota...' : 'Probar remota'}
            accentColor={accentColor}
            disabled={isRestoringSession || isRegisteringPush || isSendingPushPreview || isSendingRemotePushPreview}
            onPress={() => {
              void sendRemotePushPreview();
            }}
          />
          <ActionButton
            label={isLoadingPushSubscriptions ? 'Cargando subs...' : 'Ver subscriptions'}
            accentColor="#334155"
            tone="secondary"
            disabled={isRestoringSession || isLoadingPushSubscriptions || isSendingRemotePushPreview}
            onPress={() => {
              void loadPushSubscriptions();
            }}
          />
        </View>
        <ActionButton
          label={isRegisteringPush ? 'Registrando token...' : 'Registrar token manual'}
          accentColor={accentColor}
          disabled={
            isRestoringSession ||
            isRegisteringPush ||
            isSendingRemotePushPreview ||
            !pushTokenInput.trim()
          }
          onPress={() => {
            void registerPushToken();
          }}
        />
        <StatusBlock label="Estado push" message={pushMessage} />

        <View style={styles.metricRow}>
          <Metric label="Subscriptions" value={String(pushSubscriptions.length)} />
          <Metric label="Activas" value={String(activeSubscriptions)} />
        </View>

        {pushSubscriptions.length ? (
          <View style={styles.listBlock}>
            {pushSubscriptions.map((subscription) => (
              <View key={subscription.id} style={styles.listRow}>
                <View style={styles.planHeader}>
                  <Text style={styles.listRowTitle}>{subscription.device_name ?? 'Expo device'}</Text>
                  <View
                    style={[
                      styles.stateBadge,
                      subscription.is_active ? { borderColor: accentColor } : styles.stateBadgeMuted,
                    ]}
                  >
                    <Text style={styles.stateBadgeText}>
                      {subscription.is_active ? 'Activa' : 'Inactiva'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.listRowMeta}>
                  {formatStatus(subscription.device_type)} - {formatDateTime(subscription.updated_at)}
                </Text>
                <Text style={styles.description}>{compactPushToken(subscription.expo_push_token)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {lastPushDispatch ? (
          <View style={styles.inlinePanel}>
            <Text style={styles.primaryValue}>{lastPushDispatch.notification.title}</Text>
            <Text style={styles.secondaryValue}>
              {lastPushDispatch.push_deliveries.length
                ? `${lastPushDispatch.push_deliveries.length} delivery(s) procesadas por Expo.`
                : 'No hubo deliveries porque no existian subscriptions activas.'}
            </Text>
            {lastPushDispatch.push_deliveries.map((delivery) => (
              <Text key={delivery.subscription_id} style={styles.description}>
                {delivery.status.toUpperCase()} - {delivery.error ?? delivery.message ?? delivery.expo_push_token}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </>
  );
}

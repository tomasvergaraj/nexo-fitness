import { Linking, Text, TextInput, View } from 'react-native';

import { formatStatus } from '../lib/formatters';
import { ActionButton, Metric, PlanOption, StatusBlock } from '../ui/components';
import { styles } from '../ui/styles';
import type { MobileScreenProps } from './types';

export function StoreScreen({ app, accentColor }: MobileScreenProps) {
  const {
    isRestoringSession,
    isCreatingCheckout,
    tenantProfile,
    plans,
    selectedPlanId,
    setSelectedPlanId,
    customerName,
    setCustomerName,
    customerEmail,
    setCustomerEmail,
    customerPhone,
    setCustomerPhone,
    checkoutSession,
    commerceMessage,
    createCheckoutSession,
  } = app;

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Checkout movil</Text>
      <Text style={styles.sectionHint}>
        La compra de planes queda en una tab dedicada para preparar datos del cliente, elegir plan y abrir el checkout sin ruido extra.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Nombre del cliente"
        placeholderTextColor="#64748b"
        value={customerName}
        onChangeText={setCustomerName}
      />
      <TextInput
        style={styles.input}
        placeholder="Email del cliente"
        placeholderTextColor="#64748b"
        keyboardType="email-address"
        autoCapitalize="none"
        value={customerEmail}
        onChangeText={setCustomerEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Telefono del cliente"
        placeholderTextColor="#64748b"
        keyboardType="phone-pad"
        value={customerPhone}
        onChangeText={setCustomerPhone}
      />

      <View style={styles.metricRow}>
        <Metric label="Planes" value={String(plans.length)} />
        <Metric label="Seleccion" value={selectedPlan ? 'lista' : 'pendiente'} />
      </View>
      <View style={styles.metricRow}>
        <Metric
          label="Checkout"
          value={tenantProfile ? (tenantProfile.checkout_enabled ? 'activo' : 'bloqueado') : 'sin tenant'}
        />
        <Metric label="Tenant" value={tenantProfile ? 'listo' : 'pendiente'} />
      </View>

      <View style={styles.planGrid}>
        {plans.length ? (
          plans.map((plan) => (
            <PlanOption
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedPlanId}
              accentColor={accentColor}
              onPress={() => {
                setSelectedPlanId(plan.id);
              }}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>Carga el tenant desde Cuenta para listar sus planes publicos.</Text>
        )}
      </View>

      <ActionButton
        label={isCreatingCheckout ? 'Generando checkout...' : 'Generar checkout session'}
        accentColor={accentColor}
        disabled={
          isRestoringSession ||
          isCreatingCheckout ||
          !selectedPlan ||
          !customerName.trim() ||
          !customerEmail.trim() ||
          tenantProfile?.checkout_enabled === false
        }
        onPress={() => {
          void createCheckoutSession();
        }}
      />
      <StatusBlock label="Estado checkout" message={commerceMessage} />

      {checkoutSession ? (
        <>
          <View style={styles.metricRow}>
            <Metric label="Provider" value={checkoutSession.provider} />
            <Metric label="Estado" value={formatStatus(checkoutSession.status)} />
          </View>

          <View style={styles.codeBlock}>
            <Text style={styles.codeLabel}>Checkout URL</Text>
            <Text style={styles.codeText}>{checkoutSession.checkout_url}</Text>
          </View>
          <View style={styles.codeBlock}>
            <Text style={styles.codeLabel}>Link compartible</Text>
            <Text style={styles.codeText}>{checkoutSession.payment_link_url}</Text>
          </View>

          <ActionButton
            label="Abrir checkout"
            accentColor={accentColor}
            onPress={() => {
              void Linking.openURL(checkoutSession.checkout_url);
            }}
          />
        </>
      ) : null}
    </View>
  );
}

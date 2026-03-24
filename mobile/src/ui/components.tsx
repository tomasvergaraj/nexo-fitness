import { Pressable, ScrollView, Text, View } from 'react-native';

import { formatCurrency, formatPlanDuration } from '../lib/formatters';
import { PublicPlan } from '../types';
import { styles } from './styles';

export function ActionButton({
  label,
  accentColor,
  onPress,
  disabled = false,
  tone = 'primary',
}: {
  label: string;
  accentColor: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary';
}) {
  const secondary = tone === 'secondary';

  return (
    <Pressable
      disabled={disabled}
      style={[
        styles.button,
        secondary ? styles.buttonSecondary : { backgroundColor: accentColor },
        secondary ? { borderColor: accentColor } : null,
        disabled ? styles.buttonDisabled : null,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, secondary ? styles.buttonSecondaryText : null]}>{label}</Text>
    </Pressable>
  );
}

export function InlineActionButton({
  label,
  accentColor,
  onPress,
  disabled = false,
  tone = 'primary',
}: {
  label: string;
  accentColor: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary';
}) {
  const secondary = tone === 'secondary';

  return (
    <Pressable
      disabled={disabled}
      style={[
        styles.inlineActionButton,
        secondary ? styles.inlineActionButtonSecondary : { backgroundColor: accentColor },
        secondary ? { borderColor: accentColor } : null,
        disabled ? styles.buttonDisabled : null,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.inlineActionText, secondary ? styles.buttonSecondaryText : null]}>{label}</Text>
    </Pressable>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function Pill({ label, accentColor }: { label: string; accentColor: string }) {
  return (
    <View style={[styles.pill, { borderColor: accentColor }]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function StatusBlock({ label, message }: { label: string; message: string }) {
  return (
    <View style={styles.statusBlock}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusText}>{message}</Text>
    </View>
  );
}

export function PlanOption({
  plan,
  selected,
  accentColor,
  onPress,
}: {
  plan: PublicPlan;
  selected: boolean;
  accentColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.planCard,
        selected ? { borderColor: accentColor, backgroundColor: '#0f2131' } : null,
      ]}
      onPress={onPress}
    >
      <View style={styles.planHeader}>
        <Text style={styles.planTitle}>{plan.name}</Text>
        {plan.is_featured ? (
          <View style={[styles.planBadge, { backgroundColor: accentColor }]}>
            <Text style={styles.planBadgeText}>Destacado</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.planPrice}>{formatCurrency(plan.price, plan.currency)}</Text>
      <Text style={styles.planMeta}>{formatPlanDuration(plan.duration_type, plan.duration_days)}</Text>
      <Text style={styles.planDescription}>{plan.description ?? 'Sin descripcion comercial aun.'}</Text>
    </Pressable>
  );
}

export function TabBar({
  items,
  activeTabId,
  accentColor,
  onChange,
}: {
  items: Array<{ id: string; label: string; badge?: string }>;
  activeTabId: string;
  accentColor: string;
  onChange: (tabId: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabBar}
      contentContainerStyle={styles.tabBarContent}
    >
      {items.map((item) => {
        const active = item.id === activeTabId;

        return (
          <Pressable
            key={item.id}
            style={[
              styles.tabButton,
              active ? styles.tabButtonActive : null,
              active ? { borderColor: accentColor } : null,
            ]}
            onPress={() => {
              onChange(item.id);
            }}
          >
            <Text style={[styles.tabButtonText, active ? styles.tabButtonTextActive : null]}>{item.label}</Text>
            {item.badge !== undefined ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{item.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Linking, SafeAreaView, ScrollView, Text, View } from 'react-native';

import { parseAppDeepLink } from './src/lib/deepLinks';
import { useMobileApp } from './src/hooks/useMobileApp';
import { addNotificationResponseListener, getLastNotificationResponsePayload } from './src/lib/push';
import { getRouteTabId, MobileRoute, MobileTabId } from './src/navigation/types';
import { AccountScreen } from './src/screens/AccountScreen';
import { AgendaScreen } from './src/screens/AgendaScreen';
import { ClassDetailScreen } from './src/screens/ClassDetailScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PaymentsScreen } from './src/screens/PaymentsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { StoreScreen } from './src/screens/StoreScreen';
import { InlineActionButton, Pill, TabBar } from './src/ui/components';
import { styles } from './src/ui/styles';

const TAB_ITEMS: Array<{ id: MobileTabId; label: string; description: string }> = [
  {
    id: 'home',
    label: 'Inicio',
    description: 'Resumen del tenant, wallet del miembro y estado general para el uso diario.',
  },
  {
    id: 'agenda',
    label: 'Agenda',
    description: 'Clases, reservas activas, cupos y cancelaciones del miembro autenticado.',
  },
  {
    id: 'store',
    label: 'Checkout',
    description: 'Catalogo de planes y generacion de checkout session con deep link de regreso.',
  },
  {
    id: 'payments',
    label: 'Pagos',
    description: 'Historial del miembro y acceso directo a comprobantes cuando existen.',
  },
  {
    id: 'account',
    label: 'Cuenta',
    description: 'Configuracion de tenant, login del cliente y pruebas de push notifications.',
  },
];

export default function App() {
  const app = useMobileApp();
  const [routeStack, setRouteStack] = useState<MobileRoute[]>([
    {
      kind: 'tab',
      tabId: 'home',
    },
  ]);
  const lastHandledRouteUrlRef = useRef<string | null>(null);
  const lastHandledNotificationKeyRef = useRef<string | null>(null);

  const currentRoute = routeStack[routeStack.length - 1];
  const activeTab = getRouteTabId(currentRoute);
  const accentColor = app.tenantProfile?.branding.primary_color ?? '#06b6d4';
  const tenantHeadline =
    app.tenantProfile?.branding.marketplace_headline ??
    'Una sola app central para descubrir el gimnasio, comprar el plan y gestionar el acceso.';
  const sessionLabel = app.sessionUser
    ? `${app.sessionUser.first_name} ${app.sessionUser.last_name}`.trim()
    : 'Sesion sin iniciar';
  const activeTabItem = TAB_ITEMS.find((tab) => tab.id === activeTab) ?? TAB_ITEMS[0];
  const currentRouteInfo = getRouteInfo(currentRoute, app.classSchedule);

  const tabItems = TAB_ITEMS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    badge:
      tab.id === 'agenda'
        ? String(app.reservations.length)
        : tab.id === 'store'
          ? String(app.plans.length)
          : tab.id === 'payments'
            ? String(app.paymentHistory.length)
            : tab.id === 'account' && app.sessionUser
              ? String(app.notifications.filter((notification) => !notification.is_read).length || 'ON')
              : undefined,
  }));

  const navigateToRoute = (route: MobileRoute) => {
    setRouteStack(
      route.kind === 'tab'
        ? [route]
        : [
            {
              kind: 'tab',
              tabId: route.tabId,
            },
            route,
          ],
    );
  };

  const navigateToTab = (tabId: MobileTabId) => {
    navigateToRoute({
      kind: 'tab',
      tabId,
    });
  };

  const openClassDetail = (classId: string) => {
    navigateToRoute({
      kind: 'class-detail',
      tabId: 'agenda',
      classId,
    });
  };

  const openProfile = () => {
    navigateToRoute({
      kind: 'profile',
      tabId: 'account',
    });
  };

  const openActionUrl = (actionUrl: string, notificationId?: string) => {
    const parsedDeepLink = parseAppDeepLink(actionUrl);
    if (parsedDeepLink?.type === 'route') {
      navigateToRoute(parsedDeepLink.route);
    }

    if (notificationId) {
      void app.trackNotificationEngagement(notificationId, {
        markOpened: true,
        markClicked: true,
        isRead: true,
      });
    }
  };

  const goBack = () => {
    setRouteStack((currentStack) => (currentStack.length > 1 ? currentStack.slice(0, -1) : currentStack));
  };

  useEffect(() => {
    const handleUrl = (rawUrl: string | null) => {
      if (!rawUrl || lastHandledRouteUrlRef.current === rawUrl) {
        return;
      }

      const parsedDeepLink = parseAppDeepLink(rawUrl);
      if (!parsedDeepLink || parsedDeepLink.type !== 'route') {
        return;
      }

      lastHandledRouteUrlRef.current = rawUrl;
      navigateToRoute(parsedDeepLink.route);
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    void Linking.getInitialURL().then((initialUrl) => {
      handleUrl(initialUrl);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const handleNotificationPayload = (payload: {
      actionUrl: string | null;
      notificationId: string | null;
      responseKey: string | null;
    }) => {
      const dedupeKey = payload.responseKey ?? payload.notificationId ?? payload.actionUrl;
      if (!payload.actionUrl || !dedupeKey || lastHandledNotificationKeyRef.current === dedupeKey) {
        return;
      }

      lastHandledNotificationKeyRef.current = dedupeKey;
      openActionUrl(payload.actionUrl, payload.notificationId ?? undefined);
    };

    const subscription = addNotificationResponseListener((payload) => {
      handleNotificationPayload(payload);
    });

    void getLastNotificationResponsePayload().then((payload) => {
      if (payload) {
        handleNotificationPayload(payload);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [app.accessToken, app.notifications.length]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={[styles.kicker, { color: accentColor }]}>Fase 3 / Mobile Base</Text>
          <Text style={styles.title}>Nexo Fitness App</Text>
          <Text style={styles.subtitle}>{tenantHeadline}</Text>
          <View style={styles.pillRow}>
            <Pill
              label={app.tenantProfile ? app.tenantProfile.tenant_name : 'Tenant pendiente'}
              accentColor={accentColor}
            />
            <Pill label={sessionLabel} accentColor="#14b8a6" />
          </View>
        </View>

        <TabBar
          items={tabItems}
          activeTabId={activeTab}
          accentColor={accentColor}
          onChange={(tabId) => {
            navigateToTab(tabId as MobileTabId);
          }}
        />

        {currentRoute.kind === 'tab' ? (
          <View style={styles.tabIntroCard}>
            <Text style={styles.tabIntroTitle}>{activeTabItem.label}</Text>
            <Text style={styles.tabIntroText}>{activeTabItem.description}</Text>
          </View>
        ) : (
          <View style={styles.tabIntroCard}>
            <View style={styles.routeBar}>
              <InlineActionButton
                label="Volver"
                accentColor={accentColor}
                tone="secondary"
                onPress={goBack}
              />
              <View style={styles.routeHeaderBody}>
                <Text style={styles.tabIntroTitle}>{currentRouteInfo.title}</Text>
                <Text style={styles.tabIntroText}>{currentRouteInfo.description}</Text>
              </View>
            </View>
          </View>
        )}

        {currentRoute.kind === 'tab' && currentRoute.tabId === 'home' ? (
          <HomeScreen app={app} accentColor={accentColor} openClassDetail={openClassDetail} openProfile={openProfile} />
        ) : null}
        {currentRoute.kind === 'tab' && currentRoute.tabId === 'agenda' ? (
          <AgendaScreen app={app} accentColor={accentColor} openClassDetail={openClassDetail} />
        ) : null}
        {currentRoute.kind === 'tab' && currentRoute.tabId === 'store' ? (
          <StoreScreen app={app} accentColor={accentColor} />
        ) : null}
        {currentRoute.kind === 'tab' && currentRoute.tabId === 'payments' ? (
          <PaymentsScreen app={app} accentColor={accentColor} />
        ) : null}
        {currentRoute.kind === 'tab' && currentRoute.tabId === 'account' ? (
          <AccountScreen app={app} accentColor={accentColor} openProfile={openProfile} />
        ) : null}
        {currentRoute.kind === 'class-detail' ? (
          <ClassDetailScreen app={app} accentColor={accentColor} classId={currentRoute.classId} />
        ) : null}
        {currentRoute.kind === 'profile' ? (
          <ProfileScreen
            app={app}
            accentColor={accentColor}
            navigateToTab={navigateToTab}
            openActionUrl={openActionUrl}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function getRouteInfo(route: MobileRoute, classSchedule: ReturnType<typeof useMobileApp>['classSchedule']) {
  if (route.kind === 'tab') {
    const activeTabItem = TAB_ITEMS.find((tab) => tab.id === route.tabId) ?? TAB_ITEMS[0];
    return {
      title: activeTabItem.label,
      description: activeTabItem.description,
    };
  }

  if (route.kind === 'class-detail') {
    const gymClass = classSchedule.find((scheduleItem) => scheduleItem.id === route.classId);
    return {
      title: gymClass?.name ?? 'Detalle de clase',
      description:
        'Pantalla dedicada para reservas, acceso remoto y futuros deep links de recordatorio o cambios operativos.',
    };
  }

  return {
    title: 'Perfil',
    description: 'Vista dedicada de cuenta, wallet y actividad para seguir separando flujos dentro de mobile.',
  };
}

import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import {
  authApi,
  classesApi,
  DEFAULT_API_BASE_URL,
  mobileApi,
  notificationsApi,
  publicApi,
  reservationsApi,
} from '../lib/api';
import { parseAppDeepLink } from '../lib/deepLinks';
import { getExpoPushTokenForCurrentDevice, scheduleLocalPushPreview } from '../lib/push';
import { loadPersistedMobileState, savePersistedMobileState } from '../lib/storage';
import {
  AppNotification,
  AuthUser,
  CheckoutSession,
  GymClass,
  MobileWallet,
  NotificationDispatchResponse,
  PaymentHistoryItem,
  PublicPlan,
  PushDelivery,
  PushSubscriptionResponse,
  Reservation,
  TenantPublicProfile,
} from '../types';

const DEFAULT_TENANT_SLUG = 'nexo-gym-santiago';
const DEFAULT_PUSH_TOKEN = '';

function buildCustomerName(user: AuthUser) {
  return `${user.first_name} ${user.last_name}`.trim();
}

export function useMobileApp() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [tenantSlug, setTenantSlug] = useState(DEFAULT_TENANT_SLUG);
  const [tenantProfile, setTenantProfile] = useState<TenantPublicProfile | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  const [wallet, setWallet] = useState<MobileWallet | null>(null);
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSession | null>(null);
  const [classSchedule, setClassSchedule] = useState<GymClass[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionResponse[]>([]);
  const [lastPushDispatch, setLastPushDispatch] = useState<NotificationDispatchResponse | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pushTokenInput, setPushTokenInput] = useState(DEFAULT_PUSH_TOKEN);

  const [tenantMessage, setTenantMessage] = useState(
    'Listo para cargar un tenant publico y reflejar su branding dentro de la app.',
  );
  const [authMessage, setAuthMessage] = useState(
    'Inicia sesion con un usuario cliente para consultar la wallet y registrar push tokens.',
  );
  const [walletMessage, setWalletMessage] = useState(
    'La wallet mostrara membresia, estado, vencimiento y QR apenas exista una sesion valida.',
  );
  const [commerceMessage, setCommerceMessage] = useState(
    'Selecciona un plan publico y datos del cliente para generar la checkout session.',
  );
  const [bookingMessage, setBookingMessage] = useState(
    'Inicia sesion para ver la agenda de clases, reservar y cancelar desde la app.',
  );
  const [paymentsMessage, setPaymentsMessage] = useState(
    'Inicia sesion para consultar el historial de pagos del miembro.',
  );
  const [pushMessage, setPushMessage] = useState(
    'Solicita permisos para probar una notificacion local y registra el Expo push token real del dispositivo cuando el entorno lo permite.',
  );
  const [notificationsMessage, setNotificationsMessage] = useState(
    'Inicia sesion para cargar las notificaciones del miembro y abrir sus acciones dentro de la app.',
  );

  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [hasHydratedStorage, setHasHydratedStorage] = useState(false);
  const [isLoadingTenant, setIsLoadingTenant] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [isRegisteringPush, setIsRegisteringPush] = useState(false);
  const [isSendingPushPreview, setIsSendingPushPreview] = useState(false);
  const [isSendingRemotePushPreview, setIsSendingRemotePushPreview] = useState(false);
  const [isLoadingPushSubscriptions, setIsLoadingPushSubscriptions] = useState(false);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [activeReservationTargetId, setActiveReservationTargetId] = useState<string | null>(null);
  const lastHandledIncomingUrlRef = useRef<string | null>(null);
  const pendingIncomingUrlRef = useRef<string | null>(null);
  const hasCheckedInitialUrlRef = useRef(false);

  const resolveBaseUrl = (baseUrlOverride?: string) => {
    const normalizedBaseUrl = (baseUrlOverride ?? apiBaseUrl).trim();
    return normalizedBaseUrl || DEFAULT_API_BASE_URL;
  };

  const clearAuthenticatedContext = () => {
    setAccessToken('');
    setRefreshToken('');
    setSessionUser(null);
    setWallet(null);
    setCheckoutSession(null);
    setClassSchedule([]);
    setReservations([]);
    setPaymentHistory([]);
    setNotifications([]);
    setPushSubscriptions([]);
    setLastPushDispatch(null);
  };

  const syncPublicTenant = async (slug: string, baseUrlOverride?: string) => {
    const normalizedSlug = slug.trim().toLowerCase();
    const resolvedBaseUrl = resolveBaseUrl(baseUrlOverride);
    const [profile, publicPlans] = await Promise.all([
      publicApi.getTenantProfile(resolvedBaseUrl, normalizedSlug),
      publicApi.getTenantPlans(resolvedBaseUrl, normalizedSlug),
    ]);

    setTenantProfile(profile);
    setPlans(publicPlans);
    setSelectedPlanId((currentPlanId: string | null) => {
      if (currentPlanId && publicPlans.some((plan: PublicPlan) => plan.id === currentPlanId)) {
        return currentPlanId;
      }
      return publicPlans[0]?.id ?? null;
    });
    setTenantSlug(profile.tenant_slug);
    setTenantMessage(
      `${profile.tenant_name} listo en mobile. Branding, clases y catalogo publico ya vienen desde FastAPI.`,
    );
    return profile;
  };

  const syncWalletWithToken = async (token: string, baseUrlOverride?: string) => {
    const resolvedBaseUrl = resolveBaseUrl(baseUrlOverride);
    const nextWallet = await mobileApi.getWallet(resolvedBaseUrl, token);
    setWallet(nextWallet);
    setWalletMessage(
      `Wallet sincronizada para ${nextWallet.tenant_name}. QR y datos de membresia actualizados.`,
    );

    if (nextWallet.tenant_slug) {
      try {
        await syncPublicTenant(nextWallet.tenant_slug, resolvedBaseUrl);
      } catch (error) {
        setTenantSlug(nextWallet.tenant_slug);
        setTenantMessage(
          `La sesion conoce el tenant ${nextWallet.tenant_slug}, pero no se pudo cargar su storefront: ${String(error)}`,
        );
      }
    }

    return nextWallet;
  };

  const refreshBookingContext = async (token: string, baseUrlOverride?: string) => {
    const resolvedBaseUrl = resolveBaseUrl(baseUrlOverride);
    const [classesResponse, reservationsResponse] = await Promise.all([
      classesApi.list(resolvedBaseUrl, token, {
        status: 'scheduled',
        per_page: 20,
      }),
      reservationsApi.list(resolvedBaseUrl, token, {
        upcoming_only: true,
        per_page: 20,
      }),
    ]);

    const nextReservations = reservationsResponse.items.filter(
      (reservation: Reservation) => reservation.status !== 'cancelled',
    );

    const sortedClasses = [...classesResponse.items].sort(
      (left: GymClass, right: GymClass) =>
        new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
    );

    setClassSchedule(sortedClasses);
    setReservations(nextReservations);
    setBookingMessage(
      `${sortedClasses.length} clases cargadas y ${nextReservations.length} reservas activas en la agenda movil.`,
    );
  };

  const loadPaymentsWithToken = async (token: string, baseUrlOverride?: string) => {
    const resolvedBaseUrl = resolveBaseUrl(baseUrlOverride);
    const payments = await mobileApi.listPayments(resolvedBaseUrl, token, 12);
    setPaymentHistory(payments);
    setPaymentsMessage(
      payments.length
        ? `${payments.length} pagos cargados en el historial movil.`
        : 'Todavia no hay pagos registrados para este miembro.',
    );
  };

  const loadNotificationsWithToken = async (token: string, baseUrlOverride?: string) => {
    const resolvedBaseUrl = resolveBaseUrl(baseUrlOverride);
    const nextNotifications = await notificationsApi.list(resolvedBaseUrl, token);
    setNotifications(nextNotifications);
    setNotificationsMessage(
      nextNotifications.length
        ? `${nextNotifications.length} notificaciones cargadas para este miembro.`
        : 'Todavia no hay notificaciones registradas para este miembro.',
    );
  };

  const loadPushSubscriptionsWithToken = async (
    token: string,
    baseUrlOverride?: string,
    options?: { updateMessage?: boolean },
  ) => {
    const resolvedBaseUrl = resolveBaseUrl(baseUrlOverride);
    const nextSubscriptions = await mobileApi.listPushSubscriptions(resolvedBaseUrl, token);
    const activeSubscriptions = nextSubscriptions.filter(
      (subscription: PushSubscriptionResponse) => subscription.is_active,
    ).length;

    setPushSubscriptions(nextSubscriptions);
    if (options?.updateMessage !== false) {
      setPushMessage(
        nextSubscriptions.length
          ? `${nextSubscriptions.length} subscriptions registradas (${activeSubscriptions} activas) para este miembro.`
          : 'Todavia no hay subscriptions push registradas para este miembro.',
      );
    }
    return nextSubscriptions;
  };

  const refreshMemberContextWithToken = async (token: string, baseUrlOverride?: string) => {
    await Promise.all([
      syncWalletWithToken(token, baseUrlOverride),
      refreshBookingContext(token, baseUrlOverride),
      loadPaymentsWithToken(token, baseUrlOverride),
      loadNotificationsWithToken(token, baseUrlOverride),
    ]);

    await loadPushSubscriptionsWithToken(token, baseUrlOverride, { updateMessage: false }).catch(() => undefined);
  };

  const handleCheckoutReturn = async (status: 'success' | 'cancel') => {
    const checkoutLabel = status === 'success' ? 'exitoso' : 'cancelado';

    if (!accessToken) {
      setCommerceMessage(
        `La app volvio desde un checkout ${checkoutLabel}, pero no hay sesion disponible para refrescar wallet, reservas y pagos.`,
      );
      return;
    }

    setIsLoadingWallet(true);
    setIsLoadingSchedule(true);
    setIsLoadingPayments(true);
    setCommerceMessage(
      status === 'success'
        ? 'Volvimos desde checkout success. Resincronizando wallet, reservas y pagos...'
        : 'Volvimos desde checkout cancel. Resincronizando el estado actual del miembro...',
    );

    try {
      await refreshMemberContextWithToken(accessToken);
      if (status === 'success') {
        setCheckoutSession(null);
      }
      setCommerceMessage(
        status === 'success'
          ? 'Checkout confirmado. Wallet, reservas y pagos actualizados al volver a la app.'
          : 'Checkout cancelado. Wallet, reservas y pagos resincronizados; puedes reabrir el checkout cuando quieras.',
      );
    } catch (error) {
      setCommerceMessage(`La app volvio desde checkout ${checkoutLabel}, pero no se pudo resincronizar: ${String(error)}`);
    } finally {
      setIsLoadingWallet(false);
      setIsLoadingSchedule(false);
      setIsLoadingPayments(false);
    }
  };

  const processIncomingUrl = async (rawUrl: string | null) => {
    if (!rawUrl || lastHandledIncomingUrlRef.current === rawUrl) {
      return;
    }

    const parsedDeepLink = parseAppDeepLink(rawUrl);
    if (!parsedDeepLink || parsedDeepLink.type !== 'checkout') {
      return;
    }

    if (!hasHydratedStorage) {
      pendingIncomingUrlRef.current = rawUrl;
      return;
    }

    lastHandledIncomingUrlRef.current = rawUrl;
    pendingIncomingUrlRef.current = null;
    await handleCheckoutReturn(parsedDeepLink.status);
  };

  useEffect(() => {
    let isMounted = true;

    const hydratePersistedState = async () => {
      setIsRestoringSession(true);
      try {
        const persistedState = await loadPersistedMobileState();
        if (!persistedState || !isMounted) {
          return;
        }

        const restoredBaseUrl = persistedState.apiBaseUrl.trim() || DEFAULT_API_BASE_URL;
        const restoredTenantSlug = persistedState.tenantSlug.trim().toLowerCase() || DEFAULT_TENANT_SLUG;

        setApiBaseUrl(restoredBaseUrl);
        setTenantSlug(restoredTenantSlug);

        if (persistedState.session) {
          const restoredUser = persistedState.session.user;
          setAccessToken(persistedState.session.accessToken);
          setRefreshToken(persistedState.session.refreshToken);
          setSessionUser(restoredUser);
          setLoginEmail(restoredUser.email);
          setCustomerName((currentName: string) => currentName || buildCustomerName(restoredUser));
          setCustomerEmail((currentEmail: string) => currentEmail || restoredUser.email);
          setAuthMessage(`Restaurando sesion guardada de ${restoredUser.email}...`);

          try {
            await refreshMemberContextWithToken(persistedState.session.accessToken, restoredBaseUrl);
            if (!isMounted) {
              return;
            }
            setAuthMessage(`Sesion restaurada como ${restoredUser.email}.`);
            return;
          } catch (error) {
            if (!isMounted) {
              return;
            }
            clearAuthenticatedContext();
            setAuthMessage(`No se pudo restaurar la sesion guardada: ${String(error)}`);
            setWalletMessage('La wallet quedo limpia hasta que se inicie una nueva sesion.');
            setBookingMessage('Inicia sesion para volver a cargar reservas y clases.');
            setPaymentsMessage('Inicia sesion para volver a cargar el historial de pagos.');
            setPushMessage('Inicia sesion nuevamente para registrar otro token de notificaciones.');
            setNotificationsMessage('Inicia sesion nuevamente para volver a cargar las notificaciones.');
          }
        }

        try {
          await syncPublicTenant(restoredTenantSlug, restoredBaseUrl);
          if (!isMounted) {
            return;
          }
          setTenantMessage(`Recuperamos el tenant reciente ${restoredTenantSlug} desde el almacenamiento local.`);
        } catch (error) {
          if (!isMounted) {
            return;
          }
          setTenantProfile(null);
          setPlans([]);
          setSelectedPlanId(null);
          setTenantMessage(`No se pudo restaurar el tenant guardado: ${String(error)}`);
        }
      } finally {
        if (isMounted) {
          setIsRestoringSession(false);
          setHasHydratedStorage(true);
        }
      }
    };

    void hydratePersistedState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedStorage) {
      return;
    }

    const session =
      accessToken && refreshToken && sessionUser
        ? {
            accessToken,
            refreshToken,
            user: sessionUser,
          }
        : null;

    void savePersistedMobileState({
      apiBaseUrl: apiBaseUrl.trim() || DEFAULT_API_BASE_URL,
      tenantSlug: tenantSlug.trim() || DEFAULT_TENANT_SLUG,
      session,
    }).catch(() => undefined);
  }, [hasHydratedStorage, apiBaseUrl, tenantSlug, accessToken, refreshToken, sessionUser]);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void processIncomingUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [hasHydratedStorage, accessToken, apiBaseUrl]);

  useEffect(() => {
    if (!hasHydratedStorage || hasCheckedInitialUrlRef.current) {
      return;
    }

    hasCheckedInitialUrlRef.current = true;
    void Linking.getInitialURL().then((initialUrl) => {
      void processIncomingUrl(initialUrl);
    });
  }, [hasHydratedStorage, accessToken, apiBaseUrl]);

  useEffect(() => {
    if (!hasHydratedStorage || !pendingIncomingUrlRef.current) {
      return;
    }

    const pendingUrl = pendingIncomingUrlRef.current;
    pendingIncomingUrlRef.current = null;
    void processIncomingUrl(pendingUrl);
  }, [hasHydratedStorage, accessToken, apiBaseUrl]);

  const loadTenantContext = async () => {
    if (!tenantSlug.trim()) {
      setTenantMessage('Ingresa un tenant slug antes de cargar el storefront publico.');
      return;
    }

    setIsLoadingTenant(true);
    try {
      await syncPublicTenant(tenantSlug);
    } catch (error) {
      setTenantProfile(null);
      setPlans([]);
      setSelectedPlanId(null);
      setTenantMessage(`No se pudo cargar el tenant publico: ${String(error)}`);
    } finally {
      setIsLoadingTenant(false);
    }
  };

  const login = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setAuthMessage('Completa email y password para iniciar sesion.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const response = await authApi.login(apiBaseUrl, loginEmail.trim(), loginPassword);
      setAccessToken(response.access_token);
      setRefreshToken(response.refresh_token);
      setSessionUser(response.user);
      setAuthMessage(`Sesion iniciada como ${response.user.email}.`);

      if (!customerName.trim()) {
        setCustomerName(buildCustomerName(response.user));
      }
      if (!customerEmail.trim()) {
        setCustomerEmail(response.user.email);
      }

      await refreshMemberContextWithToken(response.access_token);
    } catch (error) {
      setAuthMessage(`No se pudo iniciar sesion: ${String(error)}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => {
    clearAuthenticatedContext();
    setAuthMessage('Sesion cerrada y snapshot local limpiado.');
    setWalletMessage('La wallet quedo limpia hasta que se inicie una nueva sesion.');
    setBookingMessage('Inicia sesion para volver a cargar reservas y clases.');
    setPaymentsMessage('Inicia sesion para volver a cargar el historial de pagos.');
    setPushMessage('Inicia sesion nuevamente para registrar otro token de notificaciones.');
    setNotificationsMessage('Inicia sesion nuevamente para volver a cargar las notificaciones.');
  };

  const refreshWallet = async () => {
    if (!accessToken) {
      setWalletMessage('Inicia sesion antes de sincronizar la wallet.');
      return;
    }

    setIsLoadingWallet(true);
    try {
      await refreshMemberContextWithToken(accessToken);
    } catch (error) {
      setWalletMessage(`No se pudo sincronizar la wallet: ${String(error)}`);
    } finally {
      setIsLoadingWallet(false);
    }
  };

  const loadSchedule = async () => {
    if (!accessToken) {
      setBookingMessage('Inicia sesion antes de cargar la agenda de clases.');
      return;
    }

    setIsLoadingSchedule(true);
    try {
      await refreshBookingContext(accessToken);
    } catch (error) {
      setBookingMessage(`No se pudo cargar la agenda movil: ${String(error)}`);
    } finally {
      setIsLoadingSchedule(false);
    }
  };

  const createCheckoutForPlan = async (planId: string, origin: 'catalog' | 'renewal') => {
    if (!tenantSlug.trim()) {
      setCommerceMessage('Carga un tenant antes de generar la checkout session.');
      return;
    }

    if (tenantProfile && !tenantProfile.checkout_enabled) {
      const message =
        'Este tenant todavia no tiene una cuenta de pago conectada, asi que el checkout publico no esta disponible.';
      setCommerceMessage(message);
      if (origin === 'renewal') {
        setWalletMessage(message);
      }
      return;
    }

    if (!customerName.trim() || !customerEmail.trim()) {
      setCommerceMessage('Completa nombre y email del cliente para generar el checkout.');
      return;
    }

    setIsCreatingCheckout(true);
    try {
      const session = await publicApi.createCheckoutSession(apiBaseUrl, tenantSlug.trim(), {
        plan_id: planId,
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim(),
        customer_phone: customerPhone.trim() || undefined,
        success_url: 'nexofitness://checkout/success',
        cancel_url: 'nexofitness://checkout/cancel',
      });
      setSelectedPlanId(planId);
      setCheckoutSession(session);
      setCommerceMessage(
        origin === 'renewal'
          ? `Checkout de renovacion creado con ${session.provider}. Ya puedes abrirlo desde la wallet o compartir el link.`
          : `Checkout session creada con ${session.provider}. Ya puedes abrir el checkout o compartir el link.`,
      );
      if (origin === 'renewal') {
        setWalletMessage('Generamos el checkout de renovacion para tu plan actual.');
      }
    } catch (error) {
      const errorText = String(error);
      const normalizedErrorText =
        errorText.includes('Tenant has no connected payment account')
          ? 'Este tenant todavia no tiene una cuenta de pago conectada, asi que el checkout publico no esta disponible.'
          : errorText;
      setCommerceMessage(
        origin === 'renewal'
          ? `No se pudo generar el checkout de renovacion: ${normalizedErrorText}`
          : `No se pudo generar la checkout session: ${normalizedErrorText}`,
      );
      if (origin === 'renewal') {
        setWalletMessage(`No se pudo preparar la renovacion desde la wallet: ${normalizedErrorText}`);
      }
    } finally {
      setIsCreatingCheckout(false);
    }
  };

  const createCheckoutSession = async () => {
    if (!selectedPlanId) {
      setCommerceMessage('Selecciona un plan publico antes de generar el checkout.');
      return;
    }

    await createCheckoutForPlan(selectedPlanId, 'catalog');
  };

  const renewMembership = async () => {
    if (!wallet?.plan_id) {
      setWalletMessage('Tu wallet todavia no tiene un plan renovable asociado.');
      return;
    }

    await createCheckoutForPlan(wallet.plan_id, 'renewal');
  };

  const loadPayments = async () => {
    if (!accessToken) {
      setPaymentsMessage('Inicia sesion antes de cargar el historial de pagos.');
      return;
    }

    setIsLoadingPayments(true);
    try {
      await loadPaymentsWithToken(accessToken);
    } catch (error) {
      setPaymentsMessage(`No se pudo cargar el historial de pagos: ${String(error)}`);
    } finally {
      setIsLoadingPayments(false);
    }
  };

  const registerExpoPushToken = async (expoPushToken: string, sourceLabel: 'manual' | 'device') => {
    const subscription = await mobileApi.registerPushSubscription(apiBaseUrl, accessToken, {
      device_type: 'mobile',
      device_name: sessionUser ? `${sessionUser.first_name} phone` : 'Expo device',
      expo_push_token: expoPushToken,
    });
    const nextSubscriptions = await loadPushSubscriptionsWithToken(accessToken, undefined, {
      updateMessage: false,
    }).catch(() => []);
    const activeSubscriptions = nextSubscriptions.filter(
      (currentSubscription: PushSubscriptionResponse) => currentSubscription.is_active,
    ).length;

    setPushTokenInput(expoPushToken);
    setLastPushDispatch(null);
    setPushMessage(
      sourceLabel === 'device'
        ? `Push token real registrado. Subscription ${subscription.id} activa para el tenant ${subscription.tenant_id}. ${activeSubscriptions || 1} dispositivo(s) listos para push remoto.`
        : `Push token manual registrado. Subscription ${subscription.id} activa para el tenant ${subscription.tenant_id}. ${activeSubscriptions || 1} dispositivo(s) listos para push remoto.`,
    );
  };

  const registerDevicePushToken = async () => {
    if (!accessToken) {
      setPushMessage('Inicia sesion antes de registrar el push token real del dispositivo.');
      return;
    }

    setIsRegisteringPush(true);
    try {
      const result = await getExpoPushTokenForCurrentDevice();
      if (result.expoPushToken) {
        await registerExpoPushToken(result.expoPushToken, 'device');
        return;
      }

      setPushMessage(result.message);
    } catch (error) {
      setPushMessage(`No se pudo registrar el push token real: ${String(error)}`);
    } finally {
      setIsRegisteringPush(false);
    }
  };

  const sendPushPreview = async () => {
    setIsSendingPushPreview(true);
    try {
      const previewActionUrl = wallet?.next_class?.id
        ? `nexofitness://agenda/class/${wallet.next_class.id}`
        : sessionUser
          ? 'nexofitness://account/profile'
          : 'nexofitness://payments';
      const previewBody = wallet?.next_class?.id
        ? `Toca para abrir el detalle de ${wallet.next_class.name} en la app.`
        : sessionUser
          ? 'Toca para abrir tu perfil del miembro en la app.'
          : 'Toca para abrir la seccion de pagos en la app.';
      const result = await scheduleLocalPushPreview({
        body: previewBody,
        actionUrl: previewActionUrl,
      });
      setPushMessage(result.message);
    } catch (error) {
      setPushMessage(`No se pudo enviar la notificacion local de prueba: ${String(error)}`);
    } finally {
      setIsSendingPushPreview(false);
    }
  };

  const sendRemotePushPreview = async () => {
    if (!accessToken) {
      setPushMessage('Inicia sesion antes de disparar una push remota desde backend.');
      return;
    }

    setIsSendingRemotePushPreview(true);
    try {
      const previewActionUrl = wallet?.next_class?.id
        ? `nexofitness://agenda/class/${wallet.next_class.id}`
        : 'nexofitness://account/profile';
      const previewMessage = wallet?.next_class?.id
        ? `Backend -> Expo -> app. Toca para abrir ${wallet.next_class.name} en mobile.`
        : 'Backend -> Expo -> app. Toca para volver al perfil del miembro dentro de mobile.';
      const dispatch = await mobileApi.createPushPreview(apiBaseUrl, accessToken, {
        title: tenantProfile?.tenant_name ?? 'Nexo Fitness',
        message: previewMessage,
        type: 'info',
        action_url: previewActionUrl,
      });
      const nextSubscriptions = await loadPushSubscriptionsWithToken(accessToken, undefined, {
        updateMessage: false,
      }).catch(() => []);
      const acceptedDeliveries = dispatch.push_deliveries.filter(
        (delivery: PushDelivery) => delivery.status === 'ok',
      ).length;
      const erroredDeliveries = dispatch.push_deliveries.filter(
        (delivery: PushDelivery) => delivery.status !== 'ok',
      );
      const activeSubscriptions = nextSubscriptions.filter(
        (subscription: PushSubscriptionResponse) => subscription.is_active,
      ).length;

      setLastPushDispatch(dispatch);
      setNotifications((currentNotifications) => [
        dispatch.notification,
        ...currentNotifications.filter(
          (notification: AppNotification) => notification.id !== dispatch.notification.id,
        ),
      ]);
      setNotificationsMessage('Nueva notificacion creada desde backend y agregada al timeline del miembro.');

      if (!dispatch.push_deliveries.length) {
        setPushMessage(
          'La notificacion remota se creo en backend, pero no habia subscriptions activas para enviarla por Expo.',
        );
        return;
      }

      if (!erroredDeliveries.length) {
        setPushMessage(
          `Push remota enviada. Expo acepto ${acceptedDeliveries}/${dispatch.push_deliveries.length} deliveries y quedaron ${activeSubscriptions} subscriptions activas.`,
        );
        return;
      }

      setPushMessage(
        `Push remota creada con ${acceptedDeliveries} delivery(s) aceptadas y ${erroredDeliveries.length} con error. Primer error: ${erroredDeliveries[0].error ?? erroredDeliveries[0].message ?? 'sin detalle'}.`,
      );
    } catch (error) {
      setPushMessage(`No se pudo enviar la push remota desde backend: ${String(error)}`);
    } finally {
      setIsSendingRemotePushPreview(false);
    }
  };

  const registerPushToken = async () => {
    if (!accessToken) {
      setPushMessage('Inicia sesion antes de registrar un push token.');
      return;
    }

    if (!pushTokenInput.trim()) {
      setPushMessage('Ingresa un Expo push token antes de registrarlo.');
      return;
    }

    setIsRegisteringPush(true);
    try {
      await registerExpoPushToken(pushTokenInput.trim(), 'manual');
    } catch (error) {
      setPushMessage(`No se pudo registrar el push token: ${String(error)}`);
    } finally {
      setIsRegisteringPush(false);
    }
  };

  const loadNotifications = async () => {
    if (!accessToken) {
      setNotificationsMessage('Inicia sesion antes de cargar las notificaciones del miembro.');
      return;
    }

    setIsLoadingNotifications(true);
    try {
      await loadNotificationsWithToken(accessToken);
    } catch (error) {
      setNotificationsMessage(`No se pudieron cargar las notificaciones: ${String(error)}`);
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  const loadPushSubscriptions = async () => {
    if (!accessToken) {
      setPushMessage('Inicia sesion antes de cargar las subscriptions push del miembro.');
      return;
    }

    setIsLoadingPushSubscriptions(true);
    try {
      await loadPushSubscriptionsWithToken(accessToken);
    } catch (error) {
      setPushMessage(`No se pudieron cargar las subscriptions push: ${String(error)}`);
    } finally {
      setIsLoadingPushSubscriptions(false);
    }
  };

  const updateNotificationState = async (
    notificationId: string,
    payload: {
      is_read?: boolean;
      mark_opened?: boolean;
      mark_clicked?: boolean;
    },
    successMessage: string,
  ) => {
    if (!accessToken) {
      setNotificationsMessage('Inicia sesion antes de actualizar una notificacion.');
      return null;
    }

    setActiveNotificationId(notificationId);
    try {
      const updatedNotification = await notificationsApi.update(
        resolveBaseUrl(),
        accessToken,
        notificationId,
        payload,
      );
      setNotifications((currentNotifications) =>
        currentNotifications.map((notification) =>
          notification.id === notificationId ? updatedNotification : notification,
        ),
      );
      setNotificationsMessage(successMessage);
      return updatedNotification;
    } catch (error) {
      setNotificationsMessage(`No se pudo actualizar la notificacion: ${String(error)}`);
      return null;
    } finally {
      setActiveNotificationId(null);
    }
  };

  const markNotificationAsRead = async (notificationId: string, isRead = true) =>
    updateNotificationState(
      notificationId,
      {
        is_read: isRead,
      },
      isRead
        ? 'Notificacion actualizada como leida.'
        : 'Notificacion actualizada como no leida.',
    );

  const trackNotificationEngagement = async (
    notificationId: string,
    options?: {
      markOpened?: boolean;
      markClicked?: boolean;
      isRead?: boolean;
    },
  ) =>
    updateNotificationState(
      notificationId,
      {
        is_read: options?.isRead,
        mark_opened: options?.markOpened,
        mark_clicked: options?.markClicked,
      },
      options?.markClicked
        ? 'Apertura y click de la notificacion registrados.'
        : options?.markOpened
          ? 'Apertura de la notificacion registrada.'
          : 'Notificacion actualizada.',
    );

  const reserveClass = async (gymClassId: string) => {
    if (!accessToken) {
      setBookingMessage('Inicia sesion antes de reservar una clase.');
      return;
    }

    setActiveReservationTargetId(gymClassId);
    try {
      const reservation = await reservationsApi.create(apiBaseUrl, accessToken, gymClassId);
      await refreshBookingContext(accessToken);
      await syncWalletWithToken(accessToken);
      setBookingMessage(
        reservation.status === 'waitlisted'
          ? 'Te agregamos a la lista de espera de la clase.'
          : 'Reserva creada correctamente y agenda actualizada.',
      );
    } catch (error) {
      setBookingMessage(`No se pudo reservar la clase: ${String(error)}`);
    } finally {
      setActiveReservationTargetId(null);
    }
  };

  const cancelReservation = async (reservationId: string) => {
    if (!accessToken) {
      setBookingMessage('Inicia sesion antes de cancelar una reserva.');
      return;
    }

    setActiveReservationTargetId(reservationId);
    try {
      await reservationsApi.cancel(apiBaseUrl, accessToken, reservationId);
      await refreshBookingContext(accessToken);
      await syncWalletWithToken(accessToken);
      setBookingMessage('Reserva cancelada correctamente.');
    } catch (error) {
      setBookingMessage(`No se pudo cancelar la reserva: ${String(error)}`);
    } finally {
      setActiveReservationTargetId(null);
    }
  };

  return {
    apiBaseUrl,
    setApiBaseUrl,
    tenantSlug,
    setTenantSlug,
    tenantProfile,
    plans,
    selectedPlanId,
    setSelectedPlanId,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    customerName,
    setCustomerName,
    customerEmail,
    setCustomerEmail,
    customerPhone,
    setCustomerPhone,
    pushTokenInput,
    setPushTokenInput,
    sessionUser,
    wallet,
    checkoutSession,
    classSchedule,
    reservations,
    paymentHistory,
    notifications,
    pushSubscriptions,
    lastPushDispatch,
    accessToken,
    refreshToken,
    tenantMessage,
    authMessage,
    walletMessage,
    commerceMessage,
    bookingMessage,
    paymentsMessage,
    pushMessage,
    notificationsMessage,
    isRestoringSession,
    isLoadingTenant,
    isLoggingIn,
    isLoadingWallet,
    isCreatingCheckout,
    isLoadingSchedule,
    isLoadingPayments,
    isRegisteringPush,
    isSendingPushPreview,
    isSendingRemotePushPreview,
    isLoadingPushSubscriptions,
    isLoadingNotifications,
    activeNotificationId,
    activeReservationTargetId,
    loadTenantContext,
    login,
    logout,
    refreshWallet,
    loadSchedule,
    loadPayments,
    createCheckoutSession,
    registerDevicePushToken,
    sendPushPreview,
    sendRemotePushPreview,
    renewMembership,
    registerPushToken,
    loadNotifications,
    loadPushSubscriptions,
    markNotificationAsRead,
    trackNotificationEngagement,
    reserveClass,
    cancelReservation,
  };
}

export type MobileAppModel = ReturnType<typeof useMobileApp>;

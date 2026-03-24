import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type PushActionStatus =
  | 'success'
  | 'unsupported'
  | 'denied'
  | 'missing_project_id'
  | 'error';

export type PushActionResult = {
  status: PushActionStatus;
  message: string;
  expoPushToken?: string;
};

export type NotificationActionPayload = {
  actionUrl: string | null;
  notificationId: string | null;
  responseKey: string | null;
};

function hasGrantedNotificationPermission(permissions: Notifications.NotificationPermissionsStatus) {
  if (permissions.status === 'granted') {
    return true;
  }

  if (Platform.OS !== 'ios') {
    return false;
  }

  const iosStatus = permissions.ios?.status;
  return (
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#06b6d4',
  });
}

async function ensureNotificationPermission() {
  await ensureAndroidNotificationChannel();

  const existingPermissions = await Notifications.getPermissionsAsync();
  if (hasGrantedNotificationPermission(existingPermissions)) {
    return existingPermissions;
  }

  return Notifications.requestPermissionsAsync();
}

function resolveExpoProjectId() {
  const easConfigProjectId =
    Constants.easConfig && 'projectId' in Constants.easConfig
      ? Constants.easConfig.projectId
      : undefined;
  const extraEasConfig =
    Constants.expoConfig?.extra && typeof Constants.expoConfig.extra === 'object'
      ? (Constants.expoConfig.extra.eas as { projectId?: string } | undefined)
      : undefined;
  const extraProjectId = extraEasConfig?.projectId;
  const projectId = easConfigProjectId ?? extraProjectId;

  return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function getUnsupportedPushMessage() {
  if (Platform.OS === 'web') {
    return 'En web no podemos obtener un Expo push token real. Usa Android o iPhone para registrar el dispositivo.';
  }

  return 'Necesitas un dispositivo fisico. En Expo SDK 53, Android requiere development build para push remoto; Expo Go solo deja probar notificaciones locales.';
}

export async function getExpoPushTokenForCurrentDevice(): Promise<PushActionResult> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    return {
      status: 'unsupported',
      message: getUnsupportedPushMessage(),
    };
  }

  try {
    const permissions = await ensureNotificationPermission();
    if (!hasGrantedNotificationPermission(permissions)) {
      return {
        status: 'denied',
        message: 'El permiso de notificaciones fue rechazado. Habilitalo en el sistema y vuelve a intentar.',
      };
    }

    const projectId = resolveExpoProjectId();
    if (!projectId) {
      return {
        status: 'missing_project_id',
        message:
          'Falta el EAS projectId de Expo para obtener el token remoto. Puedes seguir probando notificaciones locales en Expo Go y usar un development build para push remoto.',
      };
    }

    const expoPushToken = (
      await Notifications.getExpoPushTokenAsync({
        projectId,
      })
    ).data;

    return {
      status: 'success',
      expoPushToken,
      message: `Token real obtenido para este dispositivo: ${expoPushToken}.`,
    };
  } catch (error) {
    return {
      status: 'error',
      message: `No se pudo obtener el Expo push token: ${String(error)}`,
    };
  }
}

function getStringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function extractNotificationActionPayload(data: unknown): NotificationActionPayload {
  if (!data || typeof data !== 'object') {
    return {
      actionUrl: null,
      notificationId: null,
      responseKey: null,
    };
  }

  const payload = data as Record<string, unknown>;
  const actionUrl =
    getStringValue(payload.action_url) ??
    getStringValue(payload.actionUrl) ??
    getStringValue(payload.url) ??
    getStringValue(payload.deep_link) ??
    getStringValue(payload.deepLink);
  const notificationId =
    getStringValue(payload.notification_id) ?? getStringValue(payload.notificationId);

  return {
    actionUrl,
    notificationId,
    responseKey: null,
  };
}

export function getNotificationActionPayloadFromResponse(
  response: Notifications.NotificationResponse,
): NotificationActionPayload {
  const payload = extractNotificationActionPayload(response.notification.request.content.data);
  return {
    ...payload,
    responseKey:
      getStringValue(response.notification.request.identifier) ??
      payload.notificationId ??
      payload.actionUrl,
  };
}

export async function getLastNotificationResponsePayload() {
  const response = await Notifications.getLastNotificationResponseAsync();
  return response ? getNotificationActionPayloadFromResponse(response) : null;
}

export function addNotificationResponseListener(
  listener: (payload: NotificationActionPayload) => void,
) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    listener(getNotificationActionPayloadFromResponse(response));
  });
}

export async function scheduleLocalPushPreview(options?: {
  title?: string;
  body?: string;
  actionUrl?: string | null;
  notificationId?: string | null;
}): Promise<PushActionResult> {
  if (Platform.OS === 'web') {
    return {
      status: 'unsupported',
      message: 'La vista web no soporta esta prueba local de notificaciones. Usa Android o iPhone.',
    };
  }

  try {
    const permissions = await ensureNotificationPermission();
    if (!hasGrantedNotificationPermission(permissions)) {
      return {
        status: 'denied',
        message: 'No pudimos mostrar la notificacion local porque el permiso no fue concedido.',
      };
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: options?.title ?? 'Nexo Fitness',
        body: options?.body ?? 'La app ya puede mostrar notificaciones locales en este dispositivo.',
        data: {
          source: 'mobile-local-preview',
          action_url: options?.actionUrl ?? undefined,
          notification_id: options?.notificationId ?? undefined,
        },
      },
      trigger: null,
    });

    return {
      status: 'success',
      message: options?.actionUrl
        ? `Notificacion local enviada. Al tocarla, la app intentara abrir ${options.actionUrl}.`
        : 'Notificacion local enviada. Si estas en primer plano, deberias verla dentro de la app.',
    };
  } catch (error) {
    return {
      status: 'error',
      message: `No se pudo disparar la notificacion local: ${String(error)}`,
    };
  }
}

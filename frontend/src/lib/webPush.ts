export function browserSupportsWebPush() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function ensureWebPushSubscription(publicVapidKey: string) {
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  if (current) {
    return current;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
  });
}

export function subscriptionToApiPayload(subscription: PushSubscription) {
  const serialized = subscription.toJSON();
  return {
    provider: 'webpush',
    device_type: 'pwa',
    device_name: inferWebPushDeviceName(),
    user_agent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    web_endpoint: serialized.endpoint,
    web_p256dh_key: serialized.keys?.p256dh,
    web_auth_key: serialized.keys?.auth,
  };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function inferWebPushDeviceName() {
  if (typeof navigator === 'undefined') {
    return 'Member PWA';
  }

  const userAgent = navigator.userAgent;
  if (/android/i.test(userAgent)) return 'Android PWA';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS PWA';
  if (/windows/i.test(userAgent)) return 'Windows PWA';
  if (/macintosh|mac os x/i.test(userAgent)) return 'macOS PWA';
  return 'Member PWA';
}

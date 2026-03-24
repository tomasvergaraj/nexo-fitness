import { MobileRoute } from '../navigation/types';

const APP_SCHEME = 'nexofitness:';

export type CheckoutReturnStatus = 'success' | 'cancel';

export type AppDeepLink =
  | {
      type: 'checkout';
      status: CheckoutReturnStatus;
    }
  | {
      type: 'route';
      route: MobileRoute;
    };

export function parseAppDeepLink(rawUrl: string): AppDeepLink | null {
  try {
    const parsedUrl = new URL(rawUrl);
    const rawRouteSegments = [parsedUrl.hostname, ...parsedUrl.pathname.split('/').filter(Boolean)];
    const normalizedSegments = rawRouteSegments.map((segment) => segment.toLowerCase());

    if (parsedUrl.protocol !== APP_SCHEME || !normalizedSegments.length) {
      return null;
    }

    if (normalizedSegments[0] === 'checkout') {
      if (normalizedSegments[1] === 'success') {
        return {
          type: 'checkout',
          status: 'success',
        };
      }

      if (normalizedSegments[1] === 'cancel') {
        return {
          type: 'checkout',
          status: 'cancel',
        };
      }

      return null;
    }

    const routeSegments = normalizedSegments[0] === 'app' ? normalizedSegments.slice(1) : normalizedSegments;
    const rawSegments = rawRouteSegments[0]?.toLowerCase() === 'app' ? rawRouteSegments.slice(1) : rawRouteSegments;

    if (!routeSegments.length) {
      return null;
    }

    if (routeSegments[0] === 'home') {
      return {
        type: 'route',
        route: {
          kind: 'tab',
          tabId: 'home',
        },
      };
    }

    if (routeSegments[0] === 'agenda') {
      if (routeSegments[1] === 'class' && rawSegments[2]) {
        return {
          type: 'route',
          route: {
            kind: 'class-detail',
            tabId: 'agenda',
            classId: rawSegments[2],
          },
        };
      }

      return {
        type: 'route',
        route: {
          kind: 'tab',
          tabId: 'agenda',
        },
      };
    }

    if (routeSegments[0] === 'store' || routeSegments[0] === 'checkout-tab') {
      return {
        type: 'route',
        route: {
          kind: 'tab',
          tabId: 'store',
        },
      };
    }

    if (routeSegments[0] === 'payments') {
      return {
        type: 'route',
        route: {
          kind: 'tab',
          tabId: 'payments',
        },
      };
    }

    if (
      routeSegments[0] === 'profile' ||
      (routeSegments[0] === 'account' && routeSegments[1] === 'profile')
    ) {
      return {
        type: 'route',
        route: {
          kind: 'profile',
          tabId: 'account',
        },
      };
    }

    if (routeSegments[0] === 'account') {
      return {
        type: 'route',
        route: {
          kind: 'tab',
          tabId: 'account',
        },
      };
    }
  } catch {
    return null;
  }

  return null;
}

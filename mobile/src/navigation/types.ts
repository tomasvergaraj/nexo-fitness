export type MobileTabId = 'home' | 'agenda' | 'store' | 'payments' | 'account';

export type MobileRoute =
  | {
      kind: 'tab';
      tabId: MobileTabId;
    }
  | {
      kind: 'class-detail';
      tabId: 'agenda';
      classId: string;
    }
  | {
      kind: 'profile';
      tabId: 'account';
    };

export function getRouteTabId(route: MobileRoute) {
  return route.tabId;
}

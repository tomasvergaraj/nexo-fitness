import type { MobileAppModel } from '../hooks/useMobileApp';
import type { MobileTabId } from '../navigation/types';

export type MobileScreenProps = {
  app: MobileAppModel;
  accentColor: string;
  openClassDetail?: (classId: string) => void;
  openProfile?: () => void;
  openActionUrl?: (actionUrl: string, notificationId?: string) => void;
  navigateToTab?: (tabId: MobileTabId) => void;
};

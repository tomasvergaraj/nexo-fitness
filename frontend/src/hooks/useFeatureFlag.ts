/**
 * React hook para suscribirse a un feature flag de PostHog.
 *
 * Re-renderiza cuando los flags cambian (PostHog dispara onFeatureFlags
 * cada vez que los reload). Si PostHog no está inicializado (sin
 * VITE_POSTHOG_KEY en dev), siempre retorna el `defaultValue`.
 *
 * Uso:
 *   const isEnabled = useFeatureFlag('new-dashboard'); // boolean
 *   const variant = useFeatureFlag('checkout-test', 'control'); // string
 */

import { useEffect, useState } from 'react';
import posthog from 'posthog-js';
import { getFeatureFlag } from '@/utils/analytics';

export function useFeatureFlag(flagKey: string, defaultValue: boolean): boolean;
export function useFeatureFlag(flagKey: string, defaultValue: string): string;
export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean | string = false,
): boolean | string {
  const [value, setValue] = useState<boolean | string>(() => {
    const initial = getFeatureFlag(flagKey);
    return initial === undefined ? defaultValue : initial;
  });

  useEffect(() => {
    // PostHog dispara onFeatureFlags cuando los flags terminan de cargar
    // o se hace reloadFeatureFlags()
    const unsubscribe = posthog.onFeatureFlags?.(() => {
      const v = getFeatureFlag(flagKey);
      setValue(v === undefined ? defaultValue : v);
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagKey]);

  return value;
}

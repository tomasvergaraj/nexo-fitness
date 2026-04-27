import { useQuery } from '@tanstack/react-query';
import { publicApi } from '@/services/api';
import type { TenantPublicProfile } from '@/types';
import { isCustomStorefrontHost } from '@/utils';

export function useStorefront(slug: string) {
  const isCustom = isCustomStorefrontHost();

  return useQuery<TenantPublicProfile>({
    queryKey: ['storefront', isCustom ? '__custom__' : slug],
    queryFn: async () => {
      const res = isCustom
        ? await publicApi.getStorefrontProfile()
        : await publicApi.getTenantProfile(slug);
      return res.data as TenantPublicProfile;
    },
    enabled: isCustom || !!slug,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
}

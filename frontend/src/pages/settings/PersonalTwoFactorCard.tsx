import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Copy, Download, Loader2, Monitor, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { authApi } from '@/services/api';
import type { TrustedDevice, TwoFactorStatus } from '@/types';
import { formatDateTime, getApiError } from '@/utils';
import { clearTrustedDeviceToken } from '@/utils/trustedDevice';

export default function PersonalTwoFactorCard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const { data: status, isLoading } = useQuery<TwoFactorStatus>({
    queryKey: ['2fa-status'],
    queryFn: async () => (await authApi.get2faStatus()).data,
  });

  const { data: devices = [] } = useQuery<TrustedDevice[]>({
    queryKey: ['2fa-trusted-devices'],
    queryFn: async () => (await authApi.listTrustedDevices()).data,
    enabled: !!status?.enabled,
  });

  const revokeDeviceMutation = useMutation({
    mutationFn: async (id: string) => authApi.revokeTrustedDevice(id),
    onSuccess: async () => {
      toast.success('Dispositivo revocado.');
      await queryClient.invalidateQueries({ queryKey: ['2fa-trusted-devices'] });
    },
    onError: (err: any) => toast.error(getApiError(err, 'No se pudo revocar.')),
  });

  const revokeAllDevicesMutation = useMutation({
    mutationFn: async () => authApi.revokeAllTrustedDevices(),
    onSuccess: async () => {
      clearTrustedDeviceToken();
      toast.success('Se revocaron todos los dispositivos. Necesitarás 2FA en el próximo login.');
      await queryClient.invalidateQueries({ queryKey: ['2fa-trusted-devices'] });
    },
    onError: (err: any) => toast.error(getApiError(err, 'No se pudo revocar.')),
  });

  const disableMutation = useMutation({
    mutationFn: async () => authApi.disable2fa(password, code),
    onSuccess: async () => {
      toast.success('2FA desactivado.');
      setDisableOpen(false);
      setPassword('');
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (err: any) => toast.error(getApiError(err, 'No se pudo desactivar 2FA.')),
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => authApi.regenerate2faBackupCodes(code),
    onSuccess: async (res: any) => {
      const codes: string[] = res?.data?.backup_codes || [];
      setNewCodes(codes);
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (err: any) => toast.error(getApiError(err, 'No se pudo regenerar los códigos.')),
  });

  const closeRegen = () => {
    setRegenOpen(false);
    setNewCodes(null);
    setCode('');
  };

  const downloadCodes = () => {
    if (!newCodes) return;
    const blob = new Blob(
      [`NexoFitness — Códigos de respaldo 2FA\n\n${newCodes.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexofitness-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-surface-200 px-4 py-4 dark:border-surface-800">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40">
          <ShieldCheck size={16} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-surface-900 dark:text-white">Mi verificación en dos pasos</p>
          <p className="mt-0.5 text-xs text-surface-500">
            Protege tu cuenta personal con un código TOTP (Google Authenticator, Authy, 1Password).
          </p>
          {isLoading ? (
            <div className="mt-3 text-xs text-surface-400">Cargando…</div>
          ) : status?.enabled ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="badge badge-success">Activado</span>
              <span className="text-xs text-surface-500">
                {status.backup_codes_remaining} códigos de respaldo restantes
              </span>
            </div>
          ) : (
            <div className="mt-3">
              <span className="badge badge-neutral">Desactivado</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {!status?.enabled ? (
              <button
                type="button"
                onClick={() => navigate('/auth/setup-2fa')}
                className="btn-primary inline-flex items-center gap-2 text-sm"
              >
                <ShieldCheck size={14} /> Activar 2FA
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setRegenOpen(true)}
                  className="btn-secondary inline-flex items-center gap-2 text-sm"
                >
                  Regenerar códigos
                </button>
                <button
                  type="button"
                  onClick={() => setDisableOpen(true)}
                  className="btn-secondary inline-flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400"
                >
                  <ShieldOff size={14} /> Desactivar
                </button>
              </>
            )}
          </div>

          {status?.enabled && devices.length > 0 ? (
            <div className="mt-5 border-t border-surface-200 pt-4 dark:border-surface-800">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Dispositivos de confianza
                </p>
                <button
                  type="button"
                  onClick={() => revokeAllDevicesMutation.mutate()}
                  disabled={revokeAllDevicesMutation.isPending}
                  className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                >
                  Revocar todos
                </button>
              </div>
              <ul className="mt-2 space-y-2">
                {devices.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start justify-between gap-2 rounded-xl border border-surface-200 bg-surface-50/50 px-3 py-2 dark:border-surface-800 dark:bg-surface-900/30"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <Monitor size={14} className="mt-0.5 shrink-0 text-surface-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-surface-900 dark:text-white">
                          {d.label || 'Dispositivo'}
                        </p>
                        <p className="text-[11px] text-surface-500">
                          Último uso: {d.last_used_at ? formatDateTime(d.last_used_at) : '—'} ·
                          Expira: {formatDateTime(d.expires_at)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => revokeDeviceMutation.mutate(d.id)}
                      disabled={revokeDeviceMutation.isPending}
                      className="shrink-0 rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      title="Revocar"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* Disable modal */}
      <Modal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Desactivar 2FA"
      >
        <p className="text-sm text-surface-600 dark:text-surface-300">
          Para desactivar la verificación en dos pasos confirmá tu contraseña y un código actual.
        </p>
        <div className="mt-4 space-y-3">
          <input
            type="password"
            placeholder="Tu contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="Código TOTP o backup"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input w-full"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={() => setDisableOpen(false)}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!password || !code || disableMutation.isPending}
            onClick={() => disableMutation.mutate()}
            className="btn-primary inline-flex items-center gap-2 bg-rose-500 text-sm text-white hover:bg-rose-600 disabled:opacity-50"
          >
            {disableMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Desactivar 2FA
          </button>
        </div>
      </Modal>

      {/* Regenerate modal */}
      <Modal
        open={regenOpen}
        onClose={closeRegen}
        title="Regenerar códigos de respaldo"
      >
        {newCodes ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300/30 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
              Guarda estos códigos. Cada uno se usa una sola vez. Los anteriores ya no funcionan.
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-surface-200 bg-surface-50 p-3 font-mono text-sm dark:border-surface-800 dark:bg-surface-900/50">
              {newCodes.map((c, i) => <span key={i} className="text-center">{c}</span>)}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={downloadCodes}
                className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 text-sm"
              >
                <Download size={14} /> Descargar
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(newCodes.join('\n'))}
                className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 text-sm"
              >
                <Copy size={14} /> Copiar
              </button>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={closeRegen} className="btn-primary text-sm">
                <Check size={14} /> Listo
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-surface-600 dark:text-surface-300">
              Necesitamos un código actual del autenticador para confirmar.
            </p>
            <input
              type="text"
              inputMode="numeric"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input w-full"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={closeRegen}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={code.length < 6 || regenerateMutation.isPending}
                onClick={() => regenerateMutation.mutate()}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {regenerateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                Regenerar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

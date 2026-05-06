import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import NexoBrand from '@/components/branding/NexoBrand';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/services/api';
import { cn, getDefaultRouteForRole } from '@/utils';
import { saveTrustedDeviceToken } from '@/utils/trustedDevice';

export default function MfaVerifyPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { mfa_token?: string; email?: string } };
  const setAuth = useAuthStore((s) => s.setAuth);
  const mfaToken = location.state?.mfa_token;
  const email = location.state?.email;
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mfaToken) {
      navigate('/login', { replace: true });
      return;
    }
    inputRef.current?.focus();
  }, [mfaToken, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await authApi.verifyMfaLogin(mfaToken, code.trim(), useBackup, {
        remember_device: rememberDevice,
      });
      if (!data.user || !data.access_token || !data.refresh_token) {
        throw new Error('Respuesta inválida');
      }
      setAuth(data.user, data.access_token, data.refresh_token);
      if (data.trusted_device_token) {
        saveTrustedDeviceToken(data.trusted_device_token);
      }
      if (data.next_action === 'billing_required') {
        const params = new URLSearchParams({ status: data.billing_status ?? 'expired' });
        navigate(`/billing/expired?${params.toString()}`, { replace: true });
        return;
      }
      navigate(getDefaultRouteForRole(data.user.role), { replace: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(detail || 'Código incorrecto');
      if (typeof detail === 'string' && detail.includes('expirada')) {
        setTimeout(() => navigate('/login', { replace: true }), 1500);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-6 text-center">
          <NexoBrand iconSize={48} titleClassName="text-2xl" accentClassName="text-brand-400" />
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-2xl">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/20 text-brand-300">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Verificación en dos pasos</h2>
              <p className="mt-1 text-sm text-surface-400">
                {useBackup
                  ? 'Ingresa uno de tus códigos de respaldo.'
                  : `Ingresa el código de 6 dígitos${email ? ` para ${email}` : ''}.`}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              ref={inputRef}
              type="text"
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={useBackup ? 'XXXXX-XXXXX' : '000000'}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-lg tracking-[0.3em] text-white placeholder:text-surface-500 focus:border-brand-500/50 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              required
              maxLength={useBackup ? 12 : 6}
            />

            {error && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-sm text-surface-300">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/5 text-brand-500 focus:ring-brand-500/50 focus:ring-offset-0"
              />
              Recordar este dispositivo durante 30 días
            </label>

            <button
              type="submit"
              disabled={loading || code.length < (useBackup ? 8 : 6)}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3.5 font-semibold text-white shadow-xl shadow-brand-500/25 transition-all',
                (loading || code.length < (useBackup ? 8 : 6)) && 'opacity-60 cursor-not-allowed',
              )}
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : (
                <>Verificar <ArrowRight size={18} /></>
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setUseBackup(!useBackup);
              setCode('');
              setError('');
            }}
            className="mt-5 flex w-full items-center justify-center gap-2 text-sm text-surface-400 transition-colors hover:text-surface-200"
          >
            <KeyRound size={14} />
            {useBackup ? 'Usar código del autenticador' : 'Usar código de respaldo'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="mt-3 block w-full text-center text-xs text-surface-500 hover:text-surface-300"
          >
            Cancelar e iniciar sesión nuevamente
          </button>
        </div>
      </motion.div>
    </div>
  );
}

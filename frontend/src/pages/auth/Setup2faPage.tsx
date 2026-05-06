import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Copy, Download, Loader2, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import NexoBrand from '@/components/branding/NexoBrand';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/services/api';
import { cn, getDefaultRouteForRole } from '@/utils';

type SetupResult = {
  secret: string;
  provisioning_uri: string;
  issuer: string;
  account: string;
};

type Step = 'loading' | 'scan' | 'verify' | 'codes';

export default function Setup2faPage() {
  const navigate = useNavigate();
  const location = useLocation() as {
    state?: { mfa_token?: string; forced?: boolean; email?: string };
  };
  const setAuth = useAuthStore((s) => s.setAuth);
  const currentUser = useAuthStore((s) => s.user);

  const mfaToken = location.state?.mfa_token;
  const forced = !!location.state?.forced;
  const isAuthenticatedFlow = !forced && !!currentUser;
  const email = location.state?.email ?? currentUser?.email;

  const [step, setStep] = useState<Step>('loading');
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  useEffect(() => {
    if (forced && !mfaToken) {
      navigate('/login', { replace: true });
      return;
    }
    if (!forced && !currentUser) {
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = forced
          ? await authApi.loginStart2faSetup(mfaToken!)
          : await authApi.start2faSetup();
        if (!cancelled) {
          setSetup(data);
          setStep('scan');
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.response?.data?.detail || 'No se pudo iniciar la configuración.');
          setStep('scan');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [forced, mfaToken, currentUser, navigate]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (forced && mfaToken) {
        const { data } = await authApi.loginVerify2faSetup(mfaToken, code.trim());
        if (!data.user || !data.access_token || !data.refresh_token) {
          throw new Error('Respuesta inválida');
        }
        setAuth(data.user, data.access_token, data.refresh_token);
        setBackupCodes(data.backup_codes || []);
        setStep('codes');
      } else {
        const { data } = await authApi.verify2faSetup(code.trim());
        setBackupCodes(data.backup_codes || []);
        setStep('codes');
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Código incorrecto.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = () => {
    if (forced && currentUser) {
      navigate(getDefaultRouteForRole(currentUser.role), { replace: true });
    } else if (forced) {
      // safety net
      navigate('/login', { replace: true });
    } else {
      navigate('/settings');
    }
  };

  const downloadCodes = () => {
    const blob = new Blob(
      [
        `NexoFitness — Códigos de respaldo 2FA\nCuenta: ${email}\n\n` +
          backupCodes.map((c, i) => `${i + 1}. ${c}`).join('\n') +
          '\n\nGuardalos en un lugar seguro. Cada código solo puede usarse una vez.',
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexofitness-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySecret = async () => {
    if (!setup?.secret) return;
    await navigator.clipboard.writeText(setup.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1500);
  };

  const headerSubtitle = useMemo(() => {
    if (step === 'codes') return 'Guarda tus códigos de respaldo antes de continuar.';
    if (step === 'verify') return 'Ingresa el código de 6 dígitos que muestra tu app.';
    if (forced) return 'Tu organización exige configurar 2FA antes de continuar.';
    return 'Escanea el QR con Google Authenticator, Authy o 1Password.';
  }, [step, forced]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg"
      >
        <div className="mb-6 text-center">
          <NexoBrand iconSize={48} titleClassName="text-2xl" accentClassName="text-brand-400" />
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-7 shadow-2xl backdrop-blur-2xl">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/20 text-brand-300">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Configurar 2FA</h2>
              <p className="mt-1 text-sm text-surface-400">{headerSubtitle}</p>
            </div>
          </div>

          {step === 'loading' && (
            <div className="flex justify-center py-12">
              <Loader2 size={24} className="animate-spin text-surface-400" />
            </div>
          )}

          {step === 'scan' && setup && (
            <div className="space-y-5">
              <div className="flex justify-center rounded-2xl bg-white p-4">
                <QRCodeSVG value={setup.provisioning_uri} size={200} level="M" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-surface-400">Clave secreta (manual)</p>
                <button
                  type="button"
                  onClick={copySecret}
                  className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-surface-200 transition-colors hover:border-white/20"
                >
                  <span className="truncate">{setup.secret}</span>
                  {copiedSecret ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} className="text-surface-400" />}
                </button>
              </div>
              {error && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={() => setStep('verify')}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3 font-semibold text-white shadow-xl shadow-brand-500/25"
              >
                Ya escaneé el QR <ArrowRight size={18} />
              </button>
            </div>
          )}

          {step === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-lg tracking-[0.3em] text-white placeholder:text-surface-500 focus:border-brand-500/50 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                required
                maxLength={6}
                autoFocus
              />
              {error && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3.5 font-semibold text-white shadow-xl shadow-brand-500/25 transition-all',
                  (loading || code.length !== 6) && 'opacity-60 cursor-not-allowed',
                )}
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : (
                  <>Activar 2FA <ArrowRight size={18} /></>
                )}
              </button>
              <button
                type="button"
                onClick={() => setStep('scan')}
                className="block w-full text-center text-xs text-surface-500 hover:text-surface-300"
              >
                Volver al QR
              </button>
            </form>
          )}

          {step === 'codes' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                <strong>Guarda estos códigos.</strong> Cada uno se usa una sola vez y son tu única forma de
                entrar si pierdes el dispositivo. No te los volveremos a mostrar.
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-surface-900/40 p-4 font-mono text-sm text-surface-100">
                {backupCodes.map((c, i) => (
                  <span key={i} className="text-center">{c}</span>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={downloadCodes}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-surface-200 hover:border-white/20"
                >
                  <Download size={14} /> Descargar .txt
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(backupCodes.join('\n'))}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-surface-200 hover:border-white/20"
                >
                  <Copy size={14} /> Copiar todos
                </button>
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-surface-300">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 text-brand-500 focus:ring-brand-500/50 focus:ring-offset-0"
                />
                Guardé los códigos en un lugar seguro.
              </label>
              <button
                type="button"
                disabled={!acknowledged}
                onClick={handleFinish}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3.5 font-semibold text-white shadow-xl shadow-emerald-500/25 transition-all',
                  !acknowledged && 'opacity-60 cursor-not-allowed',
                )}
              >
                Continuar <ArrowRight size={18} />
              </button>
            </div>
          )}

          {!forced && isAuthenticatedFlow && step !== 'codes' && (
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="mt-4 block w-full text-center text-xs text-surface-500 hover:text-surface-300"
            >
              Cancelar
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

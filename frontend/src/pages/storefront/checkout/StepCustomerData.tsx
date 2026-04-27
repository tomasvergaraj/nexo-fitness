import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { useCheckout } from '../hooks/useCheckout';

type CheckoutHook = ReturnType<typeof useCheckout>;

interface Props {
  checkout: CheckoutHook;
}

export default function StepCustomerData({ checkout }: Props) {
  const { state, set, proceedToSummary } = checkout;
  const [showPwd, setShowPwd] = useState(false);
  const isNew = state.accountMode === 'create';

  const pwdStrength = (() => {
    const p = state.password;
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-Z]/.test(p)) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return s;
  })();

  const pwdColor = pwdStrength <= 1 ? 'bg-red-500' : pwdStrength === 2 ? 'bg-amber-400' : 'bg-emerald-500';
  const pwdLabel = pwdStrength <= 1 ? 'Débil' : pwdStrength === 2 ? 'Regular' : 'Fuerte';

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      {/* Name */}
      <div>
        <label className="sf-label text-xs font-semibold mb-1.5 block">Nombre completo *</label>
        <input
          type="text"
          autoFocus
          value={state.name}
          onChange={e => set({ name: e.target.value, error: '' })}
          placeholder="Juan Pérez"
          className="sf-input w-full"
        />
      </div>

      {/* Phone */}
      <div>
        <label className="sf-label text-xs font-semibold mb-1.5 block">
          Teléfono <span className="sf-text-subtle font-normal">(opcional)</span>
        </label>
        <input
          type="tel"
          value={state.phone}
          onChange={e => set({ phone: e.target.value })}
          placeholder="+56 9 1234 5678"
          className="sf-input w-full"
        />
      </div>

      {/* DOB */}
      <div>
        <label className="sf-label text-xs font-semibold mb-1.5 block">
          Fecha de nacimiento <span className="sf-text-subtle font-normal">(opcional)</span>
        </label>
        <input
          type="date"
          value={state.dob}
          onChange={e => set({ dob: e.target.value })}
          className="sf-input w-full"
        />
      </div>

      {/* Password (only for new accounts) */}
      {isNew && (
        <div>
          <label className="sf-label text-xs font-semibold mb-1.5 block">Contraseña *</label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={state.password}
              onChange={e => set({ password: e.target.value, error: '' })}
              placeholder="Mínimo 8 caracteres"
              className="sf-input w-full pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPwd(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 sf-text-muted hover:sf-text-strong transition-colors"
            >
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {state.password.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${pwdColor}`}
                  style={{ width: `${(pwdStrength / 4) * 100}%` }}
                />
              </div>
              <span className="sf-text-muted text-xs">{pwdLabel}</span>
            </div>
          )}
        </div>
      )}

      {state.error && <p className="sf-error text-sm">{state.error}</p>}

      <button
        onClick={proceedToSummary}
        disabled={state.loading}
        className="sf-btn-brand w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {state.loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <>Continuar <ArrowRight className="w-4 h-4" /></>
        }
      </button>
    </motion.div>
  );
}

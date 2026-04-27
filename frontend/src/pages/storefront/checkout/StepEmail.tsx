import { useRef } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight, Loader2, KeyRound } from 'lucide-react';
import type { useCheckout } from '../hooks/useCheckout';

type CheckoutHook = ReturnType<typeof useCheckout>;

interface Props {
  checkout: CheckoutHook;
}

export default function StepEmail({ checkout }: Props) {
  const { state, set, sendOtp, confirmOtp, proceedExisting } = checkout;
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const handleOtpInput = (i: number, val: string) => {
    const chars = val.replace(/\D/g, '').slice(-1);
    const arr = state.otpCode.split('');
    arr[i] = chars;
    set({ otpCode: arr.join(''), error: '' });
    if (chars && i < 5) inputRefs.current[i + 1]?.focus();
  };

  const handleOtpKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !state.otpCode[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  };

  // Existing account: email + password directly
  if (state.accountMode === 'existing') {
    return (
      <motion.div
        key="existing"
        className="space-y-5"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25 }}
      >
        <div className="sf-info-box rounded-2xl p-4 text-sm">
          <p className="sf-text-strong font-semibold">Ya tienes una cuenta</p>
          <p className="sf-text-muted mt-1">Ingresa tu contraseña para continuar con <strong>{state.email}</strong>.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="sf-label text-xs font-semibold mb-1.5 block">Contraseña</label>
            <input
              type="password"
              autoFocus
              value={state.existingPassword}
              onChange={e => set({ existingPassword: e.target.value, error: '' })}
              placeholder="Tu contraseña"
              className="sf-input w-full"
              onKeyDown={e => e.key === 'Enter' && proceedExisting()}
            />
          </div>
        </div>

        {state.error && <p className="sf-error text-sm">{state.error}</p>}

        <button
          onClick={proceedExisting}
          disabled={!state.existingPassword}
          className="sf-btn-brand w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          Continuar
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          onClick={() => set({ accountMode: 'create', otpSent: false, error: '' })}
          className="w-full text-center sf-text-muted text-xs hover:sf-text-strong transition-colors py-1"
        >
          Usar otro correo
        </button>
      </motion.div>
    );
  }

  // OTP sent: show digit inputs
  if (state.otpSent) {
    return (
      <motion.div
        key="otp"
        className="space-y-5"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.25 }}
      >
        <div className="text-center space-y-1">
          <KeyRound className="w-8 h-8 sf-brand-icon mx-auto" />
          <p className="sf-text-strong font-semibold text-sm">Revisa tu correo</p>
          <p className="sf-text-muted text-xs">Enviamos un código de 6 dígitos a <strong>{state.email}</strong></p>
        </div>

        <div className="flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={state.otpCode[i] ?? ''}
              onChange={e => handleOtpInput(i, e.target.value)}
              onKeyDown={e => handleOtpKey(i, e)}
              className="sf-otp-input w-10 h-12 text-center text-lg font-bold rounded-xl border sf-border focus:outline-none focus:sf-border-brand"
            />
          ))}
        </div>

        {state.error && <p className="sf-error text-sm text-center">{state.error}</p>}

        <button
          onClick={confirmOtp}
          disabled={state.otpCode.length < 6 || state.loading}
          className="sf-btn-brand w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {state.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Verificar <ArrowRight className="w-4 h-4" /></>}
        </button>

        <button
          onClick={() => set({ otpSent: false, otpCode: '', error: '' })}
          className="w-full text-center sf-text-muted text-xs hover:sf-text-strong transition-colors py-1"
        >
          Cambiar correo · Reenviar código
        </button>
      </motion.div>
    );
  }

  // Initial: email input
  return (
    <motion.div
      key="email"
      className="space-y-5"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.25 }}
    >
      <div>
        <label className="sf-label text-xs font-semibold mb-1.5 flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" />
          Tu correo electrónico
        </label>
        <input
          type="email"
          autoFocus
          value={state.email}
          onChange={e => set({ email: e.target.value, error: '' })}
          placeholder="hola@ejemplo.com"
          className="sf-input w-full"
          onKeyDown={e => e.key === 'Enter' && sendOtp()}
        />
      </div>

      {state.error && <p className="sf-error text-sm">{state.error}</p>}

      <button
        onClick={sendOtp}
        disabled={!state.email.includes('@') || state.loading}
        className="sf-btn-brand w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {state.loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <>Continuar <ArrowRight className="w-4 h-4" /></>
        }
      </button>

      <p className="sf-text-subtle text-xs text-center">
        Si no tienes cuenta, la crearemos para que accedas al gimnasio.
      </p>
    </motion.div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { getApiError } from '@/utils';

interface ProfileSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type ProfileFormState = {
  first_name: string;
  last_name: string;
  phone: string;
};

type PasswordFormState = {
  current_password: string;
  new_password: string;
  confirm_new_password: string;
};

const emptyPasswordForm: PasswordFormState = {
  current_password: '',
  new_password: '',
  confirm_new_password: '',
};

function buildInitialProfileForm(user: ReturnType<typeof useAuthStore.getState>['user']): ProfileFormState {
  return {
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    phone: user?.phone ?? '',
  };
}

function getPasswordValidationMessage(form: PasswordFormState) {
  if (!form.new_password) {
    return '';
  }
  if (form.new_password.length < 8) {
    return 'La nueva contraseña debe tener al menos 8 caracteres.';
  }
  if (!/[A-Z]/.test(form.new_password)) {
    return 'La nueva contraseña debe incluir al menos una mayúscula.';
  }
  if (!/\d/.test(form.new_password)) {
    return 'La nueva contraseña debe incluir al menos un número.';
  }
  if (form.confirm_new_password && form.new_password !== form.confirm_new_password) {
    return 'La confirmación no coincide con la nueva contraseña.';
  }
  if (form.current_password && form.current_password === form.new_password) {
    return 'La nueva contraseña debe ser distinta a la actual.';
  }
  return '';
}

export default function ProfileSettingsModal({ open, onClose }: ProfileSettingsModalProps) {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setTokens = useAuthStore((state) => state.setTokens);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(() => buildInitialProfileForm(user));
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(emptyPasswordForm);

  useEffect(() => {
    if (!open) {
      return;
    }

    setProfileForm(buildInitialProfileForm(user));
    setPasswordForm(emptyPasswordForm);
  }, [open, user]);

  const profileDirty = useMemo(() => {
    const initial = buildInitialProfileForm(user);
    return (
      profileForm.first_name.trim() !== initial.first_name.trim()
      || profileForm.last_name.trim() !== initial.last_name.trim()
      || profileForm.phone.trim() !== initial.phone.trim()
    );
  }, [profileForm, user]);
  const profileValidationMessage = useMemo(() => {
    if (!profileForm.first_name.trim()) {
      return 'El nombre no puede quedar vacío.';
    }
    if (!profileForm.last_name.trim()) {
      return 'El apellido no puede quedar vacío.';
    }
    return '';
  }, [profileForm.first_name, profileForm.last_name]);

  const passwordValidationMessage = useMemo(
    () => getPasswordValidationMessage(passwordForm),
    [passwordForm],
  );

  const updateProfile = useMutation({
    mutationFn: async () => {
      const response = await authApi.updateMe({
        first_name: profileForm.first_name.trim(),
        last_name: profileForm.last_name.trim(),
        phone: profileForm.phone.trim() || undefined,
      });
      return response.data;
    },
    onSuccess: (nextUser) => {
      setUser(nextUser);
      toast.success('Datos de la cuenta actualizados.');
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudieron guardar los datos de la cuenta.'));
    },
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const response = await authApi.changePassword({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      return response.data as {
        detail: string;
        access_token: string;
        refresh_token: string;
      };
    },
    onSuccess: (payload) => {
      setTokens(payload.access_token, payload.refresh_token);
      setPasswordForm(emptyPasswordForm);
      toast.success(payload.detail || 'Contraseña actualizada correctamente.');
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo cambiar la contraseña.'));
    },
  });

  if (!user) {
    return null;
  }

  const canSubmitPassword = Boolean(
    passwordForm.current_password
    && passwordForm.new_password
    && passwordForm.confirm_new_password
    && !passwordValidationMessage,
  );
  const canSubmitProfile = profileDirty && !profileValidationMessage;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mi perfil"
      description="Administra los datos de tu cuenta y la seguridad de acceso."
      size="lg"
    >
      <div className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
        <section className="rounded-2xl border border-surface-200/70 bg-white p-5 dark:border-surface-800/70 dark:bg-surface-900/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
              <UserRound size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-surface-900 dark:text-white">Datos de la cuenta</h3>
              <p className="text-sm text-surface-500">Actualiza la información visible de tu usuario.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Nombre</span>
              <input
                type="text"
                className="input"
                value={profileForm.first_name}
                onChange={(event) => setProfileForm((current) => ({ ...current, first_name: event.target.value }))}
                autoComplete="given-name"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Apellido</span>
              <input
                type="text"
                className="input"
                value={profileForm.last_name}
                onChange={(event) => setProfileForm((current) => ({ ...current, last_name: event.target.value }))}
                autoComplete="family-name"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Teléfono</span>
              <div className="relative">
                <Phone size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  type="tel"
                  className="input pl-10"
                  value={profileForm.phone}
                  onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))}
                  autoComplete="tel"
                />
              </div>
            </label>

            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Correo</span>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  type="email"
                  className="input pl-10 opacity-80"
                  value={user.email}
                  readOnly
                  disabled
                />
              </div>
              <p className="mt-1 text-xs text-surface-500">El correo se mantiene como identificador de acceso.</p>
            </div>
          </div>

          {profileValidationMessage ? (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{profileValidationMessage}</p>
          ) : null}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              className="btn-primary"
              onClick={() => updateProfile.mutate()}
              disabled={updateProfile.isPending || !canSubmitProfile}
            >
              {updateProfile.isPending ? 'Guardando...' : 'Guardar datos'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-surface-200/70 bg-white p-5 dark:border-surface-800/70 dark:bg-surface-900/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-surface-900 dark:text-white">Seguridad</h3>
              <p className="text-sm text-surface-500">Cambia tu contraseña validando la actual.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Contraseña actual</span>
              <input
                type="password"
                className="input"
                value={passwordForm.current_password}
                onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
                autoComplete="current-password"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Nueva contraseña</span>
              <div className="relative">
                <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  type="password"
                  className="input pl-10"
                  value={passwordForm.new_password}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                  autoComplete="new-password"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">Repetir nueva contraseña</span>
              <input
                type="password"
                className="input"
                value={passwordForm.confirm_new_password}
                onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_new_password: event.target.value }))}
                autoComplete="new-password"
              />
            </label>

            <div className="rounded-xl bg-surface-50 px-4 py-3 text-xs leading-5 text-surface-500 dark:bg-surface-800/60 dark:text-surface-400">
              Debe tener al menos 8 caracteres, una mayúscula y un número.
            </div>

            {passwordValidationMessage ? (
              <p className="text-sm text-red-600 dark:text-red-400">{passwordValidationMessage}</p>
            ) : null}
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              className="btn-primary"
              onClick={() => changePassword.mutate()}
              disabled={changePassword.isPending || !canSubmitPassword}
            >
              {changePassword.isPending ? 'Actualizando...' : 'Cambiar contraseña'}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

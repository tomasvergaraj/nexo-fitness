import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound, Plus, Trash2, ToggleLeft, ToggleRight,
  Copy, CheckCheck, Eye, EyeOff, AlertCircle, ShieldCheck,
} from 'lucide-react';
import { apiClientsApi } from '@/services/api';
import type { ApiClient, ApiClientScope, ApiClientWithSecret } from '@/types';
import { cn, getApiError } from '@/utils';
import toast from 'react-hot-toast';

/* ─── constants ─────────────────────────────────────────────────── */

const ALL_SCOPES: { value: ApiClientScope; label: string; description: string }[] = [
  { value: 'measurements:read', label: 'Medidas (lectura)', description: 'Leer medidas corporales del miembro' },
  { value: 'measurements:write', label: 'Medidas (escritura)', description: 'Enviar medidas desde wearable' },
  { value: 'records:read', label: 'Récords (lectura)', description: 'Leer marcas personales del miembro' },
  { value: 'records:write', label: 'Récords (escritura)', description: 'Enviar marcas personales desde app externa' },
];

/* ─── helpers ───────────────────────────────────────────────────── */

function ScopeBadge({ scope }: { scope: string }) {
  const write = scope.endsWith(':write');
  return (
    <span className={cn(
      'inline-block rounded-md px-2 py-0.5 text-xs font-medium',
      write
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
    )}>
      {scope}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-900 dark:hover:text-white transition-colors"
    >
      {copied ? <CheckCheck size={13} className="text-emerald-500" /> : <Copy size={13} />}
      {label ?? (copied ? 'Copiado' : 'Copiar')}
    </button>
  );
}

/* ─── Create form ───────────────────────────────────────────────── */

interface CreateFormState {
  name: string;
  scopes: ApiClientScope[];
  rate_limit_per_minute: number;
}

function CreateModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: ApiClientWithSecret) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateFormState>({
    name: '',
    scopes: ['measurements:read'],
    rate_limit_per_minute: 60,
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClientsApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['api-clients'] });
      onCreated(res.data as ApiClientWithSecret);
    },
    onError: () => toast.error('No se pudo crear el cliente API.'),
  });

  const toggleScope = (s: ApiClientScope) => {
    setForm((f) => ({
      ...f,
      scopes: f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s],
    }));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-surface-900 shadow-2xl p-6 space-y-5">
        <h2 className="text-xl font-bold text-surface-900 dark:text-white flex items-center gap-2">
          <KeyRound size={20} className="text-primary-500" />
          Nuevo cliente API
        </h2>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim() || form.scopes.length === 0) return;
            mutation.mutate({
              name: form.name.trim(),
              scopes: form.scopes,
              rate_limit_per_minute: form.rate_limit_per_minute,
            });
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Nombre de la integración *
            </label>
            <input
              type="text"
              className="input"
              placeholder="Ej: Mi wearable, App de análisis…"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              maxLength={200}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Permisos (scopes) *
            </label>
            <div className="space-y-2">
              {ALL_SCOPES.map((s) => (
                <label key={s.value} className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                  form.scopes.includes(s.value)
                    ? 'border-primary-400 bg-primary-50 dark:bg-primary-500/10'
                    : 'border-surface-200 dark:border-surface-700 hover:border-surface-300',
                )}>
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded"
                    checked={form.scopes.includes(s.value)}
                    onChange={() => toggleScope(s.value)}
                  />
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">{s.label}</p>
                    <p className="text-xs text-surface-500">{s.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
              Límite de solicitudes / minuto
            </label>
            <input
              type="number"
              className="input"
              min={1}
              max={1000}
              value={form.rate_limit_per_minute}
              onChange={(e) => setForm((f) => ({ ...f, rate_limit_per_minute: parseInt(e.target.value) || 60 }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button
              type="submit"
              className="btn-primary"
              disabled={mutation.isPending || !form.name.trim() || form.scopes.length === 0}
            >
              {mutation.isPending ? 'Creando…' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Secret reveal modal ───────────────────────────────────────── */

function SecretModal({ client, onClose }: { client: ApiClientWithSecret; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-surface-900 shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-emerald-500" />
          <h2 className="text-xl font-bold text-surface-900 dark:text-white">Cliente API creado</h2>
        </div>

        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Guarda el <strong>Client Secret</strong> ahora. No podrás verlo de nuevo.
          </p>
        </div>

        <div className="space-y-3">
          {[
            { label: 'Client ID', value: client.client_id },
            { label: 'Client Secret', value: client.client_secret, secret: true },
          ].map(({ label, value, secret }) => (
            <div key={label}>
              <p className="mb-1 text-xs font-medium text-surface-500 uppercase tracking-wider">{label}</p>
              <div className="flex items-center gap-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-2">
                <code className={cn('flex-1 text-sm font-mono break-all', secret && !visible ? 'blur-sm select-none' : '')}>
                  {value}
                </code>
                {secret && (
                  <button type="button" onClick={() => setVisible((v) => !v)} className="text-surface-400 hover:text-surface-700 dark:hover:text-white shrink-0">
                    {visible ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                )}
                <CopyButton text={value} />
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-surface-500 space-y-1 border-t border-surface-100 dark:border-surface-800 pt-3">
          <p className="font-medium">Cómo usar:</p>
          <code className="block bg-surface-100 dark:bg-surface-800 rounded-xl p-3 text-xs whitespace-pre-wrap break-all">
{`POST /api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=${client.client_id}
&client_secret=<tu_secret>

→ Usar el access_token como Bearer en cada petición`}
          </code>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={onClose}>Entendido</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────── */

export default function ApiClientsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createdClient, setCreatedClient] = useState<ApiClientWithSecret | null>(null);

  const { data: clients = [], isLoading, isError, error, refetch } = useQuery<ApiClient[]>({
    queryKey: ['api-clients'],
    queryFn: async () => (await apiClientsApi.list()).data,
  });

  const queryErrorStatus = (error as any)?.response?.status;
  const queryErrorMessage = queryErrorStatus === 404
    ? 'Este entorno todavía no expone el módulo de integraciones API en el backend. Si ya debería estar disponible, falta desplegar esa parte del servidor.'
    : getApiError(error, 'No se pudieron cargar las integraciones API.');

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      apiClientsApi.update(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-clients'] }),
    onError: () => toast.error('No se pudo actualizar.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClientsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-clients'] });
      toast.success('Cliente eliminado.');
    },
    onError: () => toast.error('No se pudo eliminar.'),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white flex items-center gap-2">
            <KeyRound size={24} />
            Integraciones API
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Credenciales OAuth2 para wearables y apps externas. Es una herramienta técnica para owner/admin, no una pantalla para miembros.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={16} />
          Nuevo cliente
        </button>
      </div>

      {/* Docs hint */}
      <div className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 p-4 text-sm text-surface-600 dark:text-surface-300 space-y-1">
        <p className="font-medium text-surface-900 dark:text-white">Endpoint de autenticación</p>
        <code className="block text-xs font-mono bg-surface-100 dark:bg-surface-800 rounded-lg px-3 py-2 mt-1">
          POST /api/v1/oauth/token (grant_type=client_credentials)
        </code>
        <p className="text-xs">El token resultante tiene duración de 1 hora. Scopes disponibles: <code>measurements:read</code>, <code>measurements:write</code>, <code>records:read</code>, <code>records:write</code>.</p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-100 dark:bg-surface-800" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-5 dark:border-rose-900/40 dark:bg-rose-950/20">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">No pudimos cargar las integraciones API</p>
          <p className="mt-2 text-sm leading-6 text-rose-700/90 dark:text-rose-200/90">
            {queryErrorMessage}
          </p>
          <div className="mt-4">
            <button type="button" className="btn-secondary" onClick={() => void refetch()}>
              Reintentar
            </button>
          </div>
        </div>
      ) : clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-surface-400">
          <KeyRound size={48} strokeWidth={1.5} />
          <p className="font-medium">Sin clientes API</p>
          <p className="text-sm text-center">Crea tu primer cliente para integrar wearables o apps externas.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-200 dark:border-surface-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
                {['Nombre', 'Client ID', 'Scopes', 'Límite/min', 'Estado', 'Acciones'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-surface-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-surface-900 dark:text-white">{c.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-surface-600 dark:text-surface-300">{c.client_id}</code>
                      <CopyButton text={c.client_id} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.scopes.map((s) => <ScopeBadge key={s} scope={s} />)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-surface-600 dark:text-surface-300">{c.rate_limit_per_minute} req/min</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleMutation.mutate({ id: c.id, is_active: !c.is_active })}
                      className={cn('flex items-center gap-1.5 text-xs font-medium transition-colors', c.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-surface-400')}
                    >
                      {c.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      {c.is_active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`¿Revocar cliente "${c.name}"? Las integraciones que lo usen dejarán de funcionar.`)) {
                          deleteMutation.mutate(c.id);
                        }
                      }}
                      className="text-red-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setShowCreate(false);
            setCreatedClient(c);
          }}
        />
      )}

      {createdClient && (
        <SecretModal
          client={createdClient}
          onClose={() => setCreatedClient(null)}
        />
      )}
    </div>
  );
}

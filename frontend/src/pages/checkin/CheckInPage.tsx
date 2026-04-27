import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Keyboard,
  Loader2,
  QrCode,
  Search,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import Modal from '@/components/ui/Modal';
import { checkinsApi, clientsApi, dashboardApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type {
  CheckIn,
  CheckInContext,
  CheckInHistoryItem,
  CheckInInvestigationCase,
  CheckInInvestigationCaseDetail,
  DashboardMetrics,
  PaginatedResponse,
  User,
} from '@/types';
import {
  cn,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  getApiError,
  getInitials,
  normalizeHexColor,
  withAlpha,
} from '@/utils';
import { fadeInUp, staggerContainer } from '@/utils/animations';

type BarcodeDetection = {
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetection[]>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: BarcodeDetectorConstructor;
};

type WindowWithAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type CaseFilter = 'open' | 'dismissed' | 'confirmed' | 'all';
type ReviewStatus = 'open' | 'dismissed' | 'confirmed';

const SCANNER_HINT = 'Apunta la cámara al QR del cliente para registrar su ingreso.';
const SCANNER_COOLDOWN_MS = 2500;
const BRANCH_STORAGE_KEY = 'nexo:checkin:branch';

function getBarcodeDetectorCtor(): BarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as WindowWithBarcodeDetector).BarcodeDetector ?? null;
}

function formatDateTimeInZone(value: string, timeZone?: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeZone || undefined,
  }).format(date);
}

function formatTimeInZone(value: string, timeZone?: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone || undefined,
  }).format(date);
}

function getRuleLabel(ruleCode: string) {
  if (ruleCode === 'qr_frequency') {
    return 'Frecuencia inusual de QR';
  }
  return ruleCode;
}

function getCaseStatusLabel(status: ReviewStatus) {
  if (status === 'confirmed') return 'Confirmado';
  if (status === 'dismissed') return 'Descartado';
  return 'Abierto';
}

function getCaseStatusBadgeClass(status: ReviewStatus) {
  if (status === 'confirmed') return 'badge-danger';
  if (status === 'dismissed') return 'badge-neutral';
  return 'badge-warning';
}

export default function CheckInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isManager = user?.role === 'owner' || user?.role === 'admin';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(BRANCH_STORAGE_KEY) ?? '';
  });
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [manualQrValue, setManualQrValue] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannerHint, setScannerHint] = useState(SCANNER_HINT);
  const [scannerCooldownRemaining, setScannerCooldownRemaining] = useState(0);
  const [scannerSuccessName, setScannerSuccessName] = useState<string | null>(null);
  const [caseFilter, setCaseFilter] = useState<CaseFilter>('open');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseDraftStatus, setCaseDraftStatus] = useState<ReviewStatus>('open');
  const [caseDraftNotes, setCaseDraftNotes] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const scanLockRef = useRef(false);
  const cooldownTimeoutRef = useRef<number | null>(null);
  const cooldownIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const scannerSupported = useMemo(() => (
    typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && Boolean(getBarcodeDetectorCtor())
  ), []);

  const contextQuery = useQuery<CheckInContext>({
    queryKey: ['checkin-context'],
    queryFn: async () => (await checkinsApi.context()).data,
  });
  const timeZone = contextQuery.data?.timezone;
  const activeBranches = contextQuery.data?.branches ?? [];
  const primaryColor = normalizeHexColor(contextQuery.data?.primary_color, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(contextQuery.data?.secondary_color, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;

  useEffect(() => {
    if (!selectedBranchId || activeBranches.some((branch) => branch.id === selectedBranchId)) {
      return;
    }
    const fallbackBranch = activeBranches[0]?.id ?? '';
    setSelectedBranchId(fallbackBranch);
  }, [activeBranches, selectedBranchId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BRANCH_STORAGE_KEY, selectedBranchId);
  }, [selectedBranchId]);

  const { data: metrics } = useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => (await dashboardApi.getMetrics()).data,
  });

  const { data: candidates, isLoading: candidatesLoading } = useQuery<PaginatedResponse<User>>({
    queryKey: ['clients-checkin-search', deferredSearch],
    queryFn: async () => {
      const response = await clientsApi.list({
        per_page: 8,
        ...(deferredSearch ? { search: deferredSearch } : {}),
        status: 'active',
      });
      return response.data;
    },
  });

  const historyQuery = useQuery<PaginatedResponse<CheckInHistoryItem>>({
    queryKey: ['checkins-history', selectedBranchId],
    queryFn: async () => {
      const response = await checkinsApi.list({
        per_page: 12,
        ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
      });
      return response.data;
    },
  });

  const suspiciousCasesQuery = useQuery<PaginatedResponse<CheckInInvestigationCase>>({
    queryKey: ['checkins-suspicious-cases', caseFilter],
    queryFn: async () => {
      const response = await checkinsApi.listSuspiciousCases({ per_page: 8, status: caseFilter });
      return response.data;
    },
    enabled: isManager,
  });

  const caseDetailQuery = useQuery<CheckInInvestigationCaseDetail>({
    queryKey: ['checkins-suspicious-case', selectedCaseId],
    queryFn: async () => (await checkinsApi.getSuspiciousCase(selectedCaseId!)).data,
    enabled: Boolean(selectedCaseId),
  });

  useEffect(() => {
    if (!caseDetailQuery.data) {
      return;
    }
    setCaseDraftStatus(caseDetailQuery.data.status);
    setCaseDraftNotes(caseDetailQuery.data.review_notes ?? '');
  }, [caseDetailQuery.data]);

  const clearScannerCooldown = () => {
    if (cooldownTimeoutRef.current) {
      window.clearTimeout(cooldownTimeoutRef.current);
      cooldownTimeoutRef.current = null;
    }
    if (cooldownIntervalRef.current) {
      window.clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }
    setScannerCooldownRemaining(0);
    setScannerSuccessName(null);
  };

  const warmupCheckinAudio = async () => {
    if (typeof window === 'undefined') {
      return null;
    }

    const AudioContextCtor = window.AudioContext ?? (window as WindowWithAudioContext).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }

    if (audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
      } catch {
        return null;
      }
    }

    return audioContextRef.current;
  };

  const playCheckinConfirmation = async () => {
    const audioContext = await warmupCheckinAudio();
    if (!audioContext) {
      return;
    }

    const startedAt = audioContext.currentTime;
    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    gainNode.gain.setValueAtTime(0.0001, startedAt);
    gainNode.gain.exponentialRampToValueAtTime(0.12, startedAt + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.4);

    const primaryOscillator = audioContext.createOscillator();
    primaryOscillator.type = 'sine';
    primaryOscillator.frequency.setValueAtTime(880, startedAt);
    primaryOscillator.frequency.exponentialRampToValueAtTime(1320, startedAt + 0.16);
    primaryOscillator.connect(gainNode);

    primaryOscillator.start(startedAt);
    primaryOscillator.stop(startedAt + 0.22);
  };

  const invalidateOperationalData = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    queryClient.invalidateQueries({ queryKey: ['checkins-history'] });
    queryClient.invalidateQueries({ queryKey: ['checkins-suspicious-cases'] });
    if (selectedCaseId) {
      queryClient.invalidateQueries({ queryKey: ['checkins-suspicious-case', selectedCaseId] });
    }
  };

  const registerCheckinSuccess = async (response: CheckIn, name: string) => {
    setSearchQuery('');
    invalidateOperationalData();
    const resolution = response.attendance_resolution ?? 'none';
    const title = resolution === 'already_attended' ? 'Asistencia ya registrada' : 'Ingreso confirmado';
    const subtitle = resolution === 'linked' && response.resolved_gym_class_name
      ? `${name} · Clase: ${response.resolved_gym_class_name}`
      : name;
    toast.success(`${title}\n${subtitle}`, { duration: 3000 });
    await playCheckinConfirmation();
  };

  const startScannerCooldown = (name: string) => {
    clearScannerCooldown();
    scanLockRef.current = true;
    setScannerSuccessName(name);
    setScannerCooldownRemaining(Math.ceil(SCANNER_COOLDOWN_MS / 1000));
    setScannerHint(`Check-in generado para ${name}. Espera un momento antes del próximo escaneo.`);

    const cooldownEndsAt = Date.now() + SCANNER_COOLDOWN_MS;
    cooldownIntervalRef.current = window.setInterval(() => {
      const remainingMs = Math.max(cooldownEndsAt - Date.now(), 0);
      setScannerCooldownRemaining(Math.max(Math.ceil(remainingMs / 1000), 0));
    }, 200);

    cooldownTimeoutRef.current = window.setTimeout(() => {
      clearScannerCooldown();
      scanLockRef.current = false;
      setManualQrValue('');
      setScannerHint(SCANNER_HINT);
    }, SCANNER_COOLDOWN_MS);
  };

  const stopScanner = () => {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  };

  const closeScannerModal = () => {
    if (scanCheckin.isPending) return;
    clearScannerCooldown();
    scanLockRef.current = false;
    stopScanner();
    setShowScannerModal(false);
    setManualQrValue('');
    setCameraError(null);
    setScannerHint(SCANNER_HINT);
  };

  const createCheckin = useMutation({
    mutationFn: async ({ user: client }: { user: User }) => {
      const response = await checkinsApi.create({
        user_id: client.id,
        check_type: 'manual',
        ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
      });
      return { response: response.data as CheckIn, client };
    },
    onSuccess: async ({ response, client }) => {
      await registerCheckinSuccess(response, `${client.first_name} ${client.last_name}`);
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo registrar el check-in'));
    },
  });

  const scanCheckin = useMutation({
    mutationFn: async (qrPayload: string) => {
      const response = await checkinsApi.scan({
        qr_payload: qrPayload,
        ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
      });
      return response.data as CheckIn;
    },
    onSuccess: async (response) => {
      const clientName = response.user_name || 'Cliente';
      await registerCheckinSuccess(response, clientName);
      startScannerCooldown(clientName);
    },
    onError: (error: unknown) => {
      scanLockRef.current = false;
      setScannerHint(SCANNER_HINT);
      toast.error(getApiError(error, 'No se pudo registrar el check-in con el código QR'));
    },
  });

  const updateCaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCaseId) {
        throw new Error('No hay caso seleccionado');
      }
      const response = await checkinsApi.updateSuspiciousCase(selectedCaseId, {
        status: caseDraftStatus,
        review_notes: caseDraftNotes,
      });
      return response.data as CheckInInvestigationCaseDetail;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['checkins-suspicious-case', selectedCaseId], data);
      invalidateOperationalData();
      toast.success('Caso actualizado');
    },
    onError: (error: unknown) => {
      toast.error(getApiError(error, 'No se pudo actualizar el caso'));
    },
  });

  useEffect(() => () => {
    clearScannerCooldown();
  }, []);

  useEffect(() => {
    if (!showScannerModal) {
      stopScanner();
      return undefined;
    }

    setCameraError(null);
    setScannerHint(
      scannerSupported
        ? SCANNER_HINT
        : 'Tu navegador no permite usar la cámara aquí. Puedes pegar el código manualmente.',
    );

    if (!scannerSupported) {
      return undefined;
    }

    let cancelled = false;
    const Detector = getBarcodeDetectorCtor();

    const startScanner = async () => {
      if (!Detector) {
        setCameraError('Este navegador no permite usar la cámara para escanear QR.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (!videoRef.current) {
          setCameraError('No pudimos abrir la vista previa de la cámara.');
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if (cancelled) return;

        setCameraReady(true);
        const detector = new Detector({ formats: ['qr_code'] });

        const scanFrame = async () => {
          if (cancelled || !videoRef.current) {
            return;
          }

          if (videoRef.current.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA && !scanLockRef.current) {
            try {
              const matches = await detector.detect(videoRef.current);
              const qrValue = matches.find((item) => item.rawValue?.trim())?.rawValue?.trim();
              if (qrValue) {
                scanLockRef.current = true;
                setManualQrValue(qrValue);
                setScannerHint('Código detectado. Validando ingreso...');
                void scanCheckin.mutateAsync(qrValue);
              }
            } catch {
              // Ignorar errores intermitentes del detector mientras la cámara se estabiliza.
            }
          }

          frameRef.current = window.requestAnimationFrame(() => {
            void scanFrame();
          });
        };

        frameRef.current = window.requestAnimationFrame(() => {
          void scanFrame();
        });
      } catch (error: any) {
        const message = error?.name === 'NotAllowedError'
          ? 'Necesitas permitir el acceso a la cámara para escanear el QR.'
          : 'No pudimos acceder a la cámara. Puedes pegar el código manualmente.';
        setCameraError(message);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scannerSupported, showScannerModal]);

  const clientResults = candidates?.items ?? [];
  const historyItems = historyQuery.data?.items ?? [];
  const suspiciousCases = suspiciousCasesQuery.data?.items ?? [];
  const openCasesCount = suspiciousCasesQuery.data?.items.filter((item) => item.status === 'open').length ?? 0;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp} className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-500">Operación</p>
          <h1 className="mt-2 text-3xl font-bold font-display text-surface-900 dark:text-white">Check-in</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-500">
            Registra ingresos manuales o por QR, revisa historial con fecha y hora exacta, y gestiona casos sospechosos para investigación.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => navigate('/reception/checkin')}>
            <QrCode size={16} />
            Escanear QR
          </button>
        </div>
      </motion.div>

      <motion.section
        variants={fadeInUp}
        className="overflow-hidden rounded-[2rem] border border-brand-200/40 bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 p-6 text-white shadow-2xl shadow-brand-500/20"
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-white/80">
              <UserCheck size={18} />
              <span className="text-sm font-medium">
                {contextQuery.data?.tenant_name || 'Gimnasio actual'}
                {timeZone ? ` · ${timeZone}` : ''}
              </span>
            </div>
            <div className="relative mt-4">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/55" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Busca por nombre, email o teléfono..."
                className="w-full rounded-2xl border border-white/15 bg-white/10 py-4 pl-12 pr-4 text-base text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/30 sm:text-lg"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm text-white/80">
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                {metrics?.checkins_today ?? historyItems.length} check-ins hoy
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                {metrics?.active_members ?? 0} membresías activas
              </span>
              {isManager ? (
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                  {openCasesCount} casos abiertos
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {activeBranches.length > 1 ? (
              <label className="flex w-full items-center justify-between gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/90 sm:w-auto sm:justify-start">
                <span className="font-medium">Sucursal</span>
                <select
                  value={selectedBranchId}
                  onChange={(event) => setSelectedBranchId(event.target.value)}
                  className="bg-transparent text-sm text-white focus:outline-none"
                >
                  <option value="" className="text-surface-900">Todas</option>
                  {activeBranches.map((branch) => (
                    <option key={branch.id} value={branch.id} className="text-surface-900">
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>
      </motion.section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr_1fr]">
        <motion.section variants={fadeInUp} className="rounded-3xl border border-surface-200/60 bg-white p-5 dark:border-surface-800/60 dark:bg-surface-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Resultados para ingreso</h2>
              <p className="mt-1 text-sm text-surface-500">Clientes activos listos para check-in manual.</p>
            </div>
            {candidatesLoading ? <Loader2 size={18} className="animate-spin text-surface-400" /> : null}
          </div>

          <div className="mt-5 space-y-3">
            {clientResults.map((client) => (
              <div
                key={client.id}
                className="flex flex-col items-stretch gap-3 rounded-2xl border border-surface-200/70 p-3 transition-colors hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/60 sm:flex-row sm:items-center"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
                  {getInitials(client.first_name, client.last_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-surface-900 dark:text-white">{client.first_name} {client.last_name}</p>
                  <p className="truncate text-xs text-surface-500">{client.email}</p>
                </div>
                <button
                  type="button"
                  className="btn-primary w-full px-3 py-2 text-sm sm:w-auto"
                  disabled={createCheckin.isPending}
                  onClick={() => {
                    void warmupCheckinAudio();
                    createCheckin.mutate({ user: client });
                  }}
                >
                  Ingresar
                </button>
              </div>
            ))}

            {!candidatesLoading && clientResults.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
                <p className="font-medium text-surface-700 dark:text-surface-200">No encontramos clientes activos</p>
                <p className="mt-1 text-sm text-surface-500">Prueba con otro criterio o usa el escáner QR.</p>
              </div>
            ) : null}
          </div>
        </motion.section>

        <motion.section variants={fadeInUp} className="rounded-3xl border border-surface-200/60 bg-white p-5 dark:border-surface-800/60 dark:bg-surface-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Historial reciente</h2>
              <p className="mt-1 text-sm text-surface-500">Fecha, hora, método, sucursal y operador.</p>
            </div>
            {historyQuery.isFetching ? <Loader2 size={18} className="animate-spin text-surface-400" /> : null}
          </div>

          <div className="mt-5 space-y-3">
            {historyItems.map((item) => (
              <div key={item.id} className="rounded-2xl border border-surface-200/70 p-4 dark:border-surface-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-surface-900 dark:text-white">{item.user_name || 'Cliente sin nombre'}</p>
                    <p className="mt-1 text-xs text-surface-500">
                      {formatDateTimeInZone(item.checked_in_at, timeZone)}
                    </p>
                  </div>
                  <span className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
                    item.check_type === 'qr'
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
                  )}>
                    {item.check_type === 'qr' ? 'QR' : 'Manual'}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-surface-500 sm:grid-cols-2">
                  <p>Sucursal: <span className="font-medium text-surface-700 dark:text-surface-200">{item.branch_name || 'General'}</span></p>
                  <p>Operador: <span className="font-medium text-surface-700 dark:text-surface-200">{item.checked_in_by_name || 'Sistema'}</span></p>
                </div>
              </div>
            ))}

            {!historyQuery.isFetching && historyItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
                <p className="font-medium text-surface-700 dark:text-surface-200">Aún no hay historial</p>
                <p className="mt-1 text-sm text-surface-500">Los próximos ingresos aparecerán aquí con hora y fecha exacta.</p>
              </div>
            ) : null}
          </div>
        </motion.section>

        <motion.section variants={fadeInUp} className="rounded-3xl border border-surface-200/60 bg-white p-5 dark:border-surface-800/60 dark:bg-surface-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Casos sospechosos</h2>
              <p className="mt-1 text-sm text-surface-500">Detección automática por frecuencia anómala de QR.</p>
            </div>
            {!isManager ? (
              <span className="badge badge-neutral">
                Solo owner/admin
              </span>
            ) : suspiciousCasesQuery.isFetching ? (
              <Loader2 size={18} className="animate-spin text-surface-400" />
            ) : null}
          </div>

          {isManager ? (
            <>
              <div className="mt-4 inline-flex flex-wrap rounded-full border border-surface-200 bg-surface-50 p-1 dark:border-surface-700 dark:bg-surface-900">
                {(['open', 'dismissed', 'confirmed', 'all'] as CaseFilter[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setCaseFilter(status)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                      caseFilter === status
                        ? 'bg-white text-brand-700 shadow-sm dark:bg-surface-800 dark:text-brand-300'
                        : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200',
                    )}
                  >
                    {status === 'all' ? 'Todos' : status === 'open' ? 'Abiertos' : status === 'dismissed' ? 'Descartados' : 'Confirmados'}
                  </button>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                {suspiciousCases.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedCaseId(item.id)}
                    className="w-full rounded-2xl border border-surface-200/70 p-4 text-left transition-colors hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-surface-900 dark:text-white">{item.user_name || 'Cliente'}</p>
                        <p className="mt-1 text-xs text-surface-500">{getRuleLabel(item.rule_code)}</p>
                      </div>
                      <span className={cn('badge shrink-0', getCaseStatusBadgeClass(item.status))}>
                        {getCaseStatusLabel(item.status)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-surface-500 sm:grid-cols-2">
                      <p>Ventana 2h: <span className="font-semibold text-surface-700 dark:text-surface-200">{item.window_qr_count}</span></p>
                      <p>Día local: <span className="font-semibold text-surface-700 dark:text-surface-200">{item.daily_qr_count}</span></p>
                    </div>
                    <p className="mt-3 text-xs text-surface-500">
                      Último disparo: {formatDateTimeInZone(item.last_triggered_at, timeZone)}
                    </p>
                  </button>
                ))}

                {!suspiciousCasesQuery.isFetching && suspiciousCases.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
                    <p className="font-medium text-surface-700 dark:text-surface-200">Sin casos en este filtro</p>
                    <p className="mt-1 text-sm text-surface-500">Los casos QR sospechosos aparecerán aquí para revisión.</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
              <p className="font-medium text-surface-700 dark:text-surface-200">La investigación queda en owner/admin</p>
              <p className="mt-1 text-sm text-surface-500">Recepción puede seguir operando check-ins desde esta pantalla o desde el modo recepción.</p>
            </div>
          )}
        </motion.section>
      </div>

      <Modal
        open={showScannerModal}
        title="Escanear QR del cliente"
        description="Usa la cámara o pega el código manualmente para registrar el ingreso."
        onClose={closeScannerModal}
        size="lg"
      >
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div
            className="rounded-[1.75rem] border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-950/30"
            style={{
              border: `1px solid ${withAlpha(primaryColor, 0.16)}`,
              backgroundImage: `linear-gradient(180deg, ${withAlpha(primaryColor, 0.08)} 0%, transparent 100%)`,
            }}
          >
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
              <Camera size={16} />
              Cámara
            </div>
            <div
              className="relative overflow-hidden rounded-[1.5rem] bg-surface-950"
              style={{
                border: `1px solid ${withAlpha(secondaryColor, 0.22)}`,
                boxShadow: `0 18px 45px ${withAlpha(primaryColor, 0.16)}`,
              }}
            >
              <video ref={videoRef} autoPlay muted playsInline className="aspect-[4/3] w-full object-cover" />
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/55 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/65 to-transparent" />
                <div
                  className="absolute left-1/2 top-1/2 h-[58%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-[1.25rem]"
                  style={{ boxShadow: '0 0 0 9999px rgba(3, 7, 18, 0.22)' }}
                >
                  <div
                    className="absolute inset-0 rounded-[1.25rem] border-2"
                    style={{
                      borderColor: withAlpha(primaryColor, 0.84),
                      boxShadow: `0 0 0 1px ${withAlpha(primaryColor, 0.16)} inset, 0 0 24px ${withAlpha(primaryColor, 0.22)}`,
                    }}
                  />
                  <motion.div
                    className="absolute inset-x-[8%] h-[3px] rounded-full"
                    style={{
                      background: `linear-gradient(90deg, transparent 0%, ${withAlpha(primaryColor, 0.2)} 18%, ${withAlpha(primaryColor, 0.96)} 50%, ${withAlpha(secondaryColor, 0.5)} 72%, transparent 100%)`,
                      boxShadow: `0 0 16px ${withAlpha(primaryColor, 0.5)}`,
                    }}
                    animate={{ top: ['10%', '82%', '10%'], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
              </div>
              {scannerCooldownRemaining > 0 && scannerSuccessName ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-emerald-950/78 px-6 text-center text-white">
                  <CheckCircle2 size={30} className="text-emerald-300" />
                  <div>
                    <p className="font-semibold">Check-in generado</p>
                    <p className="mt-1 text-sm text-emerald-100">{scannerSuccessName}</p>
                  </div>
                  <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
                    Nuevo escaneo en {scannerCooldownRemaining}s
                  </div>
                </div>
              ) : null}
              {!cameraReady && scannerSupported && !cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-950/70 text-white">
                  <Loader2 size={24} className="animate-spin" />
                  <p className="text-sm text-white/80">Preparando cámara...</p>
                </div>
              ) : null}
              {!scannerSupported ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-950/80 px-6 text-center text-white">
                  <QrCode size={28} className="text-brand-300" />
                  <p className="text-sm leading-6 text-white/80">
                    Este navegador no permite escanear desde la cámara aquí. Puedes pegar el código manualmente.
                  </p>
                </div>
              ) : null}
              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-950/80 px-6 text-center text-white">
                  <AlertTriangle size={28} className="text-amber-300" />
                  <p className="text-sm leading-6 text-white/85">{cameraError}</p>
                </div>
              ) : null}
            </div>
            <p className="mt-3 text-sm leading-6 text-surface-500 dark:text-surface-400">{scannerHint}</p>
          </div>

          <form
            className="space-y-4 rounded-[1.75rem] border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-950/30"
            style={{
              border: `1px solid ${withAlpha(secondaryColor, 0.16)}`,
              backgroundImage: `linear-gradient(180deg, ${withAlpha(secondaryColor, 0.06)} 0%, transparent 100%)`,
            }}
            onSubmit={(event) => {
              event.preventDefault();
              const payload = manualQrValue.trim();
              if (!payload) {
                toast.error('Pega o escanea un código QR válido.');
                return;
              }
              void warmupCheckinAudio();
              setScannerHint('Validando ingreso...');
              scanCheckin.mutate(payload);
            }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
              <Keyboard size={16} />
              Código manual
            </div>
            <p className="text-sm leading-6 text-surface-500 dark:text-surface-400">
              También sirve si usas un lector externo que pega el código automáticamente.
            </p>
            <textarea
              value={manualQrValue}
              onChange={(event) => setManualQrValue(event.target.value)}
              className="input min-h-36 resize-y font-mono text-sm"
              placeholder="nexo:slug-del-gimnasio:id-del-cliente:id-de-la-membresía"
              disabled={scanCheckin.isPending || scannerCooldownRemaining > 0}
            />
            <div
              className="rounded-2xl px-4 py-3 text-sm"
              style={{
                border: `1px solid ${withAlpha(primaryColor, 0.22)}`,
                background: withAlpha(primaryColor, 0.08),
                color: primaryColor,
              }}
            >
              Los ingresos QR también alimentan el análisis de casos sospechosos para investigación.
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={closeScannerModal}>
                Cerrar
              </button>
              <button type="submit" className="btn-primary" disabled={scanCheckin.isPending || scannerCooldownRemaining > 0}>
                {scanCheckin.isPending ? 'Registrando...' : scannerCooldownRemaining > 0 ? `Listo en ${scannerCooldownRemaining}s` : 'Registrar ingreso'}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedCaseId)}
        title="Investigación de check-in sospechoso"
        description="Revisa el historial relacionado y documenta tu decisión sin afectar el flujo operativo."
        onClose={() => setSelectedCaseId(null)}
        size="lg"
      >
        {caseDetailQuery.isLoading || !caseDetailQuery.data ? (
          <div className="flex items-center justify-center py-16 text-surface-500">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-surface-200/70 p-4 dark:border-surface-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
                  <ShieldAlert size={16} />
                  Resumen del caso
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="text-surface-500">Cliente</p>
                    <p className="font-medium text-surface-900 dark:text-white">{caseDetailQuery.data.user_name || 'Cliente'}</p>
                    <p className="text-xs text-surface-500">{caseDetailQuery.data.user_email || 'Sin correo'}</p>
                  </div>
                  <p className="text-surface-600 dark:text-surface-300">
                    Regla: <span className="font-medium">{getRuleLabel(caseDetailQuery.data.rule_code)}</span>
                  </p>
                  <p className="text-surface-600 dark:text-surface-300">
                    Umbral reciente: <span className="font-medium">{caseDetailQuery.data.window_qr_count}</span> ingresos QR en 2 horas
                  </p>
                  <p className="text-surface-600 dark:text-surface-300">
                    Umbral diario: <span className="font-medium">{caseDetailQuery.data.daily_qr_count}</span> ingresos QR en el día local
                  </p>
                  <p className="text-surface-600 dark:text-surface-300">
                    Último disparo: <span className="font-medium">{formatDateTimeInZone(caseDetailQuery.data.last_triggered_at, timeZone)}</span>
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-surface-200/70 p-4 dark:border-surface-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
                  <AlertTriangle size={16} />
                  Resolución
                </div>
                <div className="mt-4 space-y-4">
                  <div className="inline-flex flex-wrap rounded-full border border-surface-200 bg-surface-50 p-1 dark:border-surface-700 dark:bg-surface-900">
                    {(['open', 'dismissed', 'confirmed'] as ReviewStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setCaseDraftStatus(status)}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                          caseDraftStatus === status
                            ? 'bg-white text-brand-700 shadow-sm dark:bg-surface-800 dark:text-brand-300'
                            : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200',
                        )}
                      >
                        {status === 'open' ? 'Abierto' : status === 'dismissed' ? 'Descartar' : 'Confirmar'}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={caseDraftNotes}
                    onChange={(event) => setCaseDraftNotes(event.target.value)}
                    className="input min-h-32 resize-y"
                    placeholder="Notas internas para seguimiento e investigación."
                  />
                  <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 text-xs text-surface-500 dark:border-surface-800 dark:bg-surface-950/30">
                    {caseDetailQuery.data.reviewed_at
                      ? `Última revisión: ${formatDateTimeInZone(caseDetailQuery.data.reviewed_at, timeZone)}${caseDetailQuery.data.reviewed_by_name ? ` por ${caseDetailQuery.data.reviewed_by_name}` : ''}`
                      : 'Aún no se registra una revisión manual.'}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-surface-200/70 p-4 dark:border-surface-800">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Check-ins QR relacionados</h3>
              <div className="mt-4 space-y-3">
                {caseDetailQuery.data.related_checkins.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-surface-200/70 p-3 dark:border-surface-800">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-surface-900 dark:text-white">{formatTimeInZone(item.checked_in_at, timeZone)}</p>
                        <p className="mt-1 text-xs text-surface-500">{formatDateTimeInZone(item.checked_in_at, timeZone)}</p>
                      </div>
                      <span className="badge badge-info">
                        QR
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-surface-500 sm:grid-cols-2">
                      <p>Sucursal: <span className="font-medium text-surface-700 dark:text-surface-200">{item.branch_name || 'General'}</span></p>
                      <p>Operador: <span className="font-medium text-surface-700 dark:text-surface-200">{item.checked_in_by_name || 'Sistema'}</span></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => setSelectedCaseId(null)}>
                Cerrar
              </button>
              <button type="button" className="btn-primary" onClick={() => updateCaseMutation.mutate()} disabled={updateCaseMutation.isPending}>
                {updateCaseMutation.isPending ? 'Guardando...' : 'Guardar revisión'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
}

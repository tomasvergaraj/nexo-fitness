import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Camera,
  CheckCircle2,
  Clock,
  Keyboard,
  Loader2,
  QrCode,
  Search,
  UserCheck,
  Zap,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { branchesApi, checkinsApi, clientsApi, dashboardApi } from '@/services/api';
import { staggerContainer, fadeInUp } from '@/utils/animations';
import { cn, formatRelative, getApiError, getInitials } from '@/utils';
import type { Branch, CheckIn, DashboardMetrics, PaginatedResponse, User } from '@/types';

type RecentCheckin = {
  id: string;
  name: string;
  checkedInAt: string;
};

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

const SCANNER_HINT = 'Apunta la cámara al QR del cliente para registrar su ingreso.';
const SCANNER_COOLDOWN_MS = 2500;

function getBarcodeDetectorCtor(): BarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as WindowWithBarcodeDetector).BarcodeDetector ?? null;
}

export default function CheckInPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedIn, setCheckedIn] = useState<string | null>(null);
  const [recentCheckins, setRecentCheckins] = useState<RecentCheckin[]>([]);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [manualQrValue, setManualQrValue] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannerHint, setScannerHint] = useState(SCANNER_HINT);
  const [scannerCooldownRemaining, setScannerCooldownRemaining] = useState(0);
  const [scannerSuccessName, setScannerSuccessName] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
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

    const secondaryOscillator = audioContext.createOscillator();
    secondaryOscillator.type = 'triangle';
    secondaryOscillator.frequency.setValueAtTime(660, startedAt + 0.05);
    secondaryOscillator.frequency.exponentialRampToValueAtTime(990, startedAt + 0.22);
    secondaryOscillator.connect(gainNode);

    primaryOscillator.start(startedAt);
    primaryOscillator.stop(startedAt + 0.22);
    secondaryOscillator.start(startedAt + 0.05);
    secondaryOscillator.stop(startedAt + 0.4);
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

  const registerCheckinSuccess = (response: CheckIn, name: string) => {
    setCheckedIn(name);
    setRecentCheckins((current) => [
      { id: response.id, name, checkedInAt: response.checked_in_at },
      ...current,
    ].slice(0, 6));
    setSearchQuery('');
    queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    toast.success(`Check-in registrado para ${name}`);
    void playCheckinConfirmation();
    window.setTimeout(() => setCheckedIn(null), 3000);
  };

  const closeScannerModal = (force = false) => {
    if (!force && scanCheckin.isPending) {
      return;
    }
    clearScannerCooldown();
    scanLockRef.current = false;
    stopScanner();
    setShowScannerModal(false);
    setManualQrValue('');
    setCameraError(null);
    setScannerHint(SCANNER_HINT);
  };

  const { data: metrics } = useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const response = await dashboardApi.getMetrics();
      return response.data;
    },
  });

  const { data: branchesData } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await branchesApi.list();
      return (response.data?.items ?? response.data ?? []).filter((b: Branch) => b.is_active);
    },
  });
  const activeBranches = branchesData ?? [];

  const { data: candidates, isLoading } = useQuery<PaginatedResponse<User>>({
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

  const createCheckin = useMutation({
    mutationFn: async ({ user }: { user: User }) => {
      const response = await checkinsApi.create({
        user_id: user.id,
        check_type: 'manual',
        ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
      });
      return { response: response.data as CheckIn, user };
    },
    onSuccess: ({ response, user }) => {
      registerCheckinSuccess(response, `${user.first_name} ${user.last_name}`);
    },
    onError: (error: any) => {
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
    onSuccess: (response) => {
      const clientName = response.user_name || 'Cliente';
      registerCheckinSuccess(response, clientName);
      startScannerCooldown(clientName);
    },
    onError: (error: any) => {
      scanLockRef.current = false;
      setScannerHint(SCANNER_HINT);
      toast.error(getApiError(error, 'No se pudo registrar el check-in con el código QR'));
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

        if (cancelled) {
          return;
        }

        setCameraReady(true);
        const detector = new Detector({ formats: ['qr_code'] });

        const scanFrame = async () => {
          if (cancelled || !videoRef.current) {
            return;
          }

          if (
            videoRef.current.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA
            && !scanLockRef.current
          ) {
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
              // Algunos navegadores lanzan errores intermitentes mientras la cámara se estabiliza.
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
  const quickStats = useMemo(
    () => [
      { label: 'Check-ins hoy', value: String(metrics?.checkins_today ?? recentCheckins.length), icon: UserCheck, color: 'brand' },
      { label: 'Membresías activas', value: String(metrics?.active_members ?? 0), icon: Clock, color: 'amber' },
      { label: 'Reservas hoy', value: String(metrics?.reservations_today ?? 0), icon: CheckCircle2, color: 'emerald' },
    ],
    [metrics?.active_members, metrics?.checkins_today, metrics?.reservations_today, recentCheckins.length],
  );

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-6">
      <motion.div variants={fadeInUp}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Check-in</h1>
            <p className="mt-1 text-sm text-surface-500">Busca un cliente real, o escanea su QR, y registra su ingreso al gimnasio.</p>
          </div>
          {activeBranches.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-surface-500 whitespace-nowrap">Sucursal:</label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-800 dark:text-surface-100 text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Todas las sucursales</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </motion.div>

      <motion.div
        variants={fadeInUp}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-6 text-white shadow-xl shadow-brand-500/20"
      >
        <div className="absolute right-0 top-0 h-64 w-64 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-3xl" />
        <div className="relative">
          <div className="mb-4 flex items-center gap-3">
            <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}>
              <Zap size={24} />
            </motion.div>
            <h2 className="text-xl font-bold font-display">Check-in rápido</h2>
          </div>
          <div className="relative max-w-lg">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Nombre, email o teléfono del cliente..."
              className="w-full rounded-xl border border-white/20 bg-white/10 py-4 pl-12 pr-4 text-lg text-white placeholder:text-white/40 transition-all duration-200 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/30"
              autoFocus
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/70">
            <button
              type="button"
              onClick={() => {
                void warmupCheckinAudio();
                setShowScannerModal(true);
              }}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 transition-colors hover:bg-white/15 hover:text-white"
            >
              <QrCode size={14} /> Escanear QR
            </button>
            <span>·</span>
            <span>{metrics?.checkins_today ?? recentCheckins.length} check-ins hoy</span>
            {selectedBranchId && activeBranches.length > 1 && (
              <>
                <span>·</span>
                <span className="text-white/90 font-medium">
                  {activeBranches.find((b) => b.id === selectedBranchId)?.name}
                </span>
              </>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {checkedIn ? (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed right-4 top-4 z-50 flex items-center gap-3 rounded-2xl bg-emerald-500 px-5 py-4 text-white shadow-2xl shadow-emerald-500/30"
          >
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.5 }}>
              <CheckCircle2 size={24} />
            </motion.div>
            <div>
              <p className="font-bold">Check-in exitoso</p>
              <p className="text-sm text-emerald-100">{checkedIn}</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div
          variants={fadeInUp}
          className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-surface-900 dark:text-white">Resultados para check-in</h3>
            {isLoading ? <span className="text-xs text-surface-400">Buscando...</span> : null}
          </div>

          <div className="space-y-2">
            {clientResults.map((client, index) => (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + index * 0.05 }}
                className="flex items-center gap-3 rounded-xl border border-surface-100 p-3 transition-colors duration-150 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
                  {getInitials(client.first_name, client.last_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-surface-900 dark:text-white">
                    {client.first_name} {client.last_name}
                  </p>
                  <p className="truncate text-xs text-surface-500">{client.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void warmupCheckinAudio();
                    createCheckin.mutate({ user: client });
                  }}
                  disabled={createCheckin.isPending}
                  className="btn-primary px-3 py-2 text-sm"
                >
                  Ingresar
                </button>
              </motion.div>
            ))}

            {!isLoading && !clientResults.length ? (
              <div className="rounded-xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
                <p className="font-medium text-surface-700 dark:text-surface-200">No encontramos clientes</p>
                <p className="mt-1 text-sm text-surface-500">Prueba con otro nombre, email o teléfono.</p>
              </div>
            ) : null}
          </div>
        </motion.div>

        <div className="space-y-4">
          <motion.div
            variants={fadeInUp}
            className="rounded-2xl border border-surface-200/50 bg-white p-5 dark:border-surface-800/50 dark:bg-surface-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-surface-900 dark:text-white">Check-ins recientes</h3>
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <div className="space-y-2">
              {recentCheckins.length ? recentCheckins.map((entry, index) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="flex items-center gap-3 rounded-xl p-3 transition-colors duration-150 hover:bg-surface-50 dark:hover:bg-surface-800/50"
                >
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white')}>
                    {getInitials(entry.name.split(' ')[0], entry.name.split(' ').slice(-1)[0])}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-surface-900 dark:text-white">{entry.name}</p>
                    <p className="text-xs text-surface-500">Acceso general</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-surface-400">{formatRelative(entry.checkedInAt)}</p>
                    <CheckCircle2 size={14} className="ml-auto mt-0.5 text-emerald-500" />
                  </div>
                </motion.div>
              )) : (
                <div className="rounded-xl border border-dashed border-surface-300 px-4 py-8 text-center dark:border-surface-700">
                  <p className="font-medium text-surface-700 dark:text-surface-200">Aún no hay check-ins en esta sesión</p>
                  <p className="mt-1 text-sm text-surface-500">Usa el buscador superior o el lector QR para registrar el primero.</p>
                </div>
              )}
            </div>
          </motion.div>

          {quickStats.map((stat, index) => (
            <motion.div
              key={stat.label}
              variants={fadeInUp}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + index * 0.08 }}
              className="flex items-center gap-4 rounded-2xl border border-surface-200/50 bg-white p-4 dark:border-surface-800/50 dark:bg-surface-900"
            >
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl',
                stat.color === 'brand' ? 'bg-brand-50 dark:bg-brand-950/40' :
                stat.color === 'amber' ? 'bg-amber-50 dark:bg-amber-950/40' :
                'bg-emerald-50 dark:bg-emerald-950/40',
              )}>
                <stat.icon
                  size={22}
                  className={cn(
                    stat.color === 'brand' ? 'text-brand-500' :
                    stat.color === 'amber' ? 'text-amber-500' : 'text-emerald-500',
                  )}
                />
              </div>
              <div>
                <p className="text-sm text-surface-500">{stat.label}</p>
                <p className="text-xl font-bold font-display text-surface-900 dark:text-white">{stat.value}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <Modal
        open={showScannerModal}
        title="Escanear QR del cliente"
        description="Usa la cámara del dispositivo o pega el código manualmente para registrar el ingreso."
        onClose={closeScannerModal}
        size="lg"
      >
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[1.75rem] border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-950/30">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
                <Camera size={16} />
                Cámara
              </div>
              <div className="relative overflow-hidden rounded-[1.5rem] bg-surface-950">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="aspect-[4/3] w-full object-cover"
                />
                {scannerCooldownRemaining > 0 && scannerSuccessName ? (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-emerald-950/78 px-6 text-center text-white backdrop-blur-[2px]">
                    <CheckCircle2 size={30} className="text-emerald-300" />
                    <div className="space-y-1">
                      <p className="text-base font-semibold">Check-in generado</p>
                      <p className="text-sm leading-6 text-emerald-100">{scannerSuccessName}</p>
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
                      Este navegador no permite escanear desde la cámara aquí. Puedes pegar el código en el formulario de la derecha.
                    </p>
                  </div>
                ) : null}
                {cameraError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-950/80 px-6 text-center text-white">
                    <QrCode size={28} className="text-amber-300" />
                    <p className="text-sm leading-6 text-white/85">{cameraError}</p>
                  </div>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-surface-500 dark:text-surface-400">
                {scannerHint}
              </p>
            </div>

            <form
              className="space-y-4 rounded-[1.75rem] border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-950/30"
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
                Esto también sirve si usas un lector externo que pega el código automáticamente.
              </p>
              <textarea
                value={manualQrValue}
                onChange={(event) => setManualQrValue(event.target.value)}
                className="input min-h-36 resize-y font-mono text-sm"
                placeholder="nexo:slug-del-gimnasio:id-del-cliente:id-de-la-membresía"
                disabled={scanCheckin.isPending || scannerCooldownRemaining > 0}
              />
              <div className="rounded-2xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-200">
                Si el cliente muestra su QR en la app, también puedes escanearlo directamente con la cámara.
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => closeScannerModal()}>
                  Cerrar
                </button>
                <button type="submit" className="btn-primary" disabled={scanCheckin.isPending || scannerCooldownRemaining > 0}>
                  {scanCheckin.isPending ? 'Registrando...' : scannerCooldownRemaining > 0 ? `Listo en ${scannerCooldownRemaining}s` : 'Registrar ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}

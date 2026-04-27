import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  CameraOff,
  ChevronLeft,
  Clock3,
  Loader2,
  QrCode,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { checkinsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { CheckIn, CheckInContext, CheckInHistoryItem, PaginatedResponse } from '@/types';
import {
  cn,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  getInitials,
  normalizeHexColor,
  withAlpha,
} from '@/utils';

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

type CameraOption = {
  deviceId: string;
  label: string;
};

const BRANCH_STORAGE_KEY = 'nexo:reception:branch';
const CAMERA_STORAGE_KEY = 'nexo:reception:camera';
const FACING_STORAGE_KEY = 'nexo:reception:facing';
const SCANNER_COOLDOWN_MS = 2500;

function getBarcodeDetectorCtor(): BarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as WindowWithBarcodeDetector).BarcodeDetector ?? null;
}

function formatTimeInZone(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone || undefined,
  }).format(new Date(value));
}

export default function ReceptionCheckInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isMobileDevice = useMemo(
    () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
    [],
  );
  const scannerSupported = useMemo(() => (
    typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && Boolean(getBarcodeDetectorCtor())
  ), []);

  const [selectedBranchId, setSelectedBranchId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(BRANCH_STORAGE_KEY) ?? '';
  });
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(CAMERA_STORAGE_KEY) ?? '';
  });
  const [selectedFacing, setSelectedFacing] = useState<'environment' | 'user'>(() => {
    if (typeof window === 'undefined') return 'environment';
    const stored = window.localStorage.getItem(FACING_STORAGE_KEY);
    return stored === 'user' ? 'user' : 'environment';
  });
  const [cameraDevices, setCameraDevices] = useState<CameraOption[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualQrValue, setManualQrValue] = useState('');
  const [scannerHint, setScannerHint] = useState('Apunta al QR del cliente para registrar el ingreso.');
  const [scannerCooldownRemaining, setScannerCooldownRemaining] = useState(0);
  const [now, setNow] = useState(() => new Date());

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const cooldownTimeoutRef = useRef<number | null>(null);
  const cooldownIntervalRef = useRef<number | null>(null);
  const scanLockRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const contextQuery = useQuery<CheckInContext>({
    queryKey: ['checkin-context'],
    queryFn: async () => (await checkinsApi.context()).data,
  });

  const timeZone = contextQuery.data?.timezone;
  const activeBranches = contextQuery.data?.branches ?? [];
  const primaryColor = normalizeHexColor(contextQuery.data?.primary_color, DEFAULT_PRIMARY_COLOR) ?? DEFAULT_PRIMARY_COLOR;
  const secondaryColor = normalizeHexColor(contextQuery.data?.secondary_color, DEFAULT_SECONDARY_COLOR) ?? DEFAULT_SECONDARY_COLOR;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedBranchId && activeBranches.length) {
      setSelectedBranchId(activeBranches[0].id);
      return;
    }
    if (selectedBranchId && !activeBranches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(activeBranches[0]?.id ?? '');
    }
  }, [activeBranches, selectedBranchId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BRANCH_STORAGE_KEY, selectedBranchId);
  }, [selectedBranchId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CAMERA_STORAGE_KEY, selectedDeviceId);
  }, [selectedDeviceId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(FACING_STORAGE_KEY, selectedFacing);
  }, [selectedFacing]);

  const historyQuery = useQuery<PaginatedResponse<CheckInHistoryItem>>({
    queryKey: ['reception-checkins-history', selectedBranchId],
    queryFn: async () => {
      const response = await checkinsApi.list({
        per_page: 6,
        ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
      });
      return response.data;
    },
    refetchInterval: 15000,
  });

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
    if (!audioContext) return;

    const startedAt = audioContext.currentTime;
    const gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
    gainNode.gain.setValueAtTime(0.0001, startedAt);
    gainNode.gain.exponentialRampToValueAtTime(0.14, startedAt + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.45);

    const oscillator = audioContext.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(740, startedAt);
    oscillator.frequency.exponentialRampToValueAtTime(1180, startedAt + 0.18);
    oscillator.connect(gainNode);
    oscillator.start(startedAt);
    oscillator.stop(startedAt + 0.28);
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

  const loadCameraDevices = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const nextDevices = devices
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Cámara ${index + 1}`,
      }));
    setCameraDevices(nextDevices);
  };

  const startScannerCooldown = () => {
    clearScannerCooldown();
    scanLockRef.current = true;
    setScannerCooldownRemaining(Math.ceil(SCANNER_COOLDOWN_MS / 1000));
    const cooldownEndsAt = Date.now() + SCANNER_COOLDOWN_MS;

    cooldownIntervalRef.current = window.setInterval(() => {
      const remainingMs = Math.max(cooldownEndsAt - Date.now(), 0);
      setScannerCooldownRemaining(Math.max(Math.ceil(remainingMs / 1000), 0));
    }, 200);

    cooldownTimeoutRef.current = window.setTimeout(() => {
      clearScannerCooldown();
      scanLockRef.current = false;
      setManualQrValue('');
      setScannerHint('Apunta al QR del cliente para registrar el ingreso.');
    }, SCANNER_COOLDOWN_MS);
  };

  const scanMutation = useMutation({
    mutationFn: async (qrPayload: string) => {
      const response = await checkinsApi.scan({
        qr_payload: qrPayload,
        ...(selectedBranchId ? { branch_id: selectedBranchId } : {}),
      });
      return response.data as CheckIn;
    },
    onSuccess: async (response) => {
      const clientName = response.user_name || 'Cliente';
      const resolution = response.attendance_resolution ?? 'none';
      const hint = resolution === 'already_attended'
        ? `Asistencia ya registrada para ${clientName}.`
        : `Ingreso confirmado para ${clientName}.`;
      setScannerHint(hint);
      queryClient.invalidateQueries({ queryKey: ['reception-checkins-history'] });
      await playCheckinConfirmation();
      const title = resolution === 'already_attended' ? 'Asistencia ya registrada' : 'Ingreso confirmado';
      const subtitle = resolution === 'linked' && response.resolved_gym_class_name
        ? `${clientName} · Clase: ${response.resolved_gym_class_name}`
        : clientName;
      toast.success(`${title}\n${subtitle}`, { duration: 3000 });
      startScannerCooldown();
    },
    onError: (error: unknown) => {
      scanLockRef.current = false;
      setScannerHint('Apunta al QR del cliente para registrar el ingreso.');
      toast.error((error as any)?.response?.data?.detail || 'No se pudo registrar el check-in');
    },
  });

  useEffect(() => () => {
    clearScannerCooldown();
    stopScanner();
  }, []);

  useEffect(() => {
    if (!scannerSupported) {
      setCameraError('Este navegador no permite escanear QR desde la cámara.');
      return undefined;
    }

    let cancelled = false;
    const Detector = getBarcodeDetectorCtor();

    const run = async () => {
      setCameraError(null);
      setScannerHint('Apunta al QR del cliente para registrar el ingreso.');

      if (!Detector) {
        setCameraError('El navegador no soporta detección QR en esta vista.');
        return;
      }

      try {
        const constraints = selectedDeviceId
          ? { video: { deviceId: { exact: selectedDeviceId } }, audio: false }
          : { video: { facingMode: { ideal: selectedFacing } }, audio: false };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        await loadCameraDevices();

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
                void scanMutation.mutateAsync(qrValue);
              }
            } catch {
              // Ignorar errores intermitentes del detector.
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
          ? 'Debes permitir el acceso a la cámara para operar el check-in.'
          : 'No pudimos acceder a la cámara seleccionada.';
        setCameraError(message);
      }
    };

    stopScanner();
    void run();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scannerSupported, selectedDeviceId, selectedFacing]);

  const currentBranchName = activeBranches.find((branch) => branch.id === selectedBranchId)?.name;
  const recentCheckins = historyQuery.data?.items ?? [];

  return (
    <div
      className="min-h-screen"
      style={{
        background: `radial-gradient(circle at top left, ${primaryColor}33, transparent 28%), radial-gradient(circle at 85% 12%, ${secondaryColor}3d, transparent 22%), linear-gradient(145deg, #071018 0%, #08131f 45%, #050b12 100%)`,
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col px-4 py-4 text-white lg:px-6">
        <header
          className="rounded-2xl px-4 py-2.5 backdrop-blur-xl"
          style={{
            border: `1px solid ${withAlpha(primaryColor, 0.2)}`,
            background: `linear-gradient(180deg, ${withAlpha(primaryColor, 0.12)} 0%, rgba(8, 19, 31, 0.72) 100%)`,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(user?.role === 'reception' ? '/classes' : '/checkin')}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/80 transition-colors hover:text-white"
                style={{
                  border: `1px solid ${withAlpha(primaryColor, 0.2)}`,
                  background: withAlpha(primaryColor, 0.12),
                }}
              >
                <ChevronLeft size={15} />
              </button>
              {contextQuery.data?.logo_url ? (
                <img src={contextQuery.data.logo_url} alt={contextQuery.data.tenant_name} className="h-8 w-8 rounded-xl object-cover shadow-lg shadow-black/30" />
              ) : (
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                  style={{
                    background: `linear-gradient(135deg, ${withAlpha(primaryColor, 0.92)} 0%, ${withAlpha(secondaryColor, 0.88)} 100%)`,
                  }}
                >
                  {getInitials(contextQuery.data?.tenant_name || 'Gym', '')}
                </div>
              )}
              <div className="flex items-baseline gap-2">
                <h1 className="text-base font-bold font-display leading-none">{contextQuery.data?.tenant_name || 'Check-in'}</h1>
                {currentBranchName ? (
                  <span className="text-xs text-white/50">{currentBranchName}</span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeBranches.length > 1 ? (
                <label
                  className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs text-white/90"
                  style={{
                    border: `1px solid ${withAlpha(primaryColor, 0.18)}`,
                    background: withAlpha(primaryColor, 0.12),
                  }}
                >
                  <ShieldCheck size={13} className="text-white/60" />
                  <select
                    value={selectedBranchId}
                    onChange={(event) => setSelectedBranchId(event.target.value)}
                    className="bg-transparent text-xs text-white focus:outline-none"
                  >
                    {activeBranches.map((branch) => (
                      <option key={branch.id} value={branch.id} className="text-surface-900">
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div
                className="rounded-xl px-3 py-1.5 text-sm font-semibold tabular-nums"
                style={{
                  border: `1px solid ${withAlpha(secondaryColor, 0.18)}`,
                  background: withAlpha(secondaryColor, 0.12),
                }}
              >
                {new Intl.DateTimeFormat('es-CL', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZone: timeZone || undefined,
                }).format(now)}
              </div>
            </div>
          </div>
        </header>

        <main className="mt-2 grid flex-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
          <section
            className="rounded-[2rem] p-3 backdrop-blur-xl"
            style={{
              border: `1px solid ${withAlpha(primaryColor, 0.18)}`,
              background: `linear-gradient(180deg, ${withAlpha(primaryColor, 0.09)} 0%, rgba(7, 16, 24, 0.7) 100%)`,
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/50">Muestra tu QR a la cámara</p>
              <div className="flex flex-wrap gap-2">
                {isMobileDevice ? (
                  <div
                    className="flex items-center gap-2 rounded-2xl p-1"
                    style={{
                      border: `1px solid ${withAlpha(primaryColor, 0.18)}`,
                      background: withAlpha(primaryColor, 0.1),
                    }}
                  >
                    {(['environment', 'user'] as const).map((facing) => (
                      <button
                        key={facing}
                        type="button"
                        onClick={() => {
                          setSelectedDeviceId('');
                          setSelectedFacing(facing);
                        }}
                        className={cn(
                          'rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em]',
                          selectedFacing === facing && !selectedDeviceId ? 'text-surface-950' : 'text-white/70',
                        )}
                        style={selectedFacing === facing && !selectedDeviceId
                          ? {
                            background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                            boxShadow: `0 10px 30px ${withAlpha(primaryColor, 0.28)}`,
                          }
                          : undefined}
                      >
                        {facing === 'environment' ? 'Trasera' : 'Frontal'}
                      </button>
                    ))}
                  </div>
                ) : null}

                {cameraDevices.length > 0 ? (
                  <label
                    className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm text-white/85"
                    style={{
                      border: `1px solid ${withAlpha(primaryColor, 0.18)}`,
                      background: withAlpha(primaryColor, 0.1),
                    }}
                  >
                    <Camera size={15} className="text-white/60" />
                    <select
                      value={selectedDeviceId}
                      onChange={(event) => setSelectedDeviceId(event.target.value)}
                      className="bg-transparent text-sm text-white focus:outline-none"
                    >
                      <option value="" className="text-surface-900">Automática</option>
                      {cameraDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId} className="text-surface-900">
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </div>

            <div
              className="relative overflow-hidden rounded-[2rem] bg-surface-950"
              style={{
                border: `1px solid ${withAlpha(secondaryColor, 0.26)}`,
                boxShadow: `0 24px 80px ${withAlpha(primaryColor, 0.18)}`,
              }}
            >
              <video ref={videoRef} autoPlay muted playsInline className="aspect-square w-full object-cover" />

              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/60 to-transparent" />
                <div
                  className="absolute left-1/2 top-1/2 h-[58%] w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-[2rem]"
                  style={{
                    boxShadow: '0 0 0 9999px rgba(3, 7, 18, 0.26)',
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-[2rem] border-2"
                    style={{
                      borderColor: withAlpha(primaryColor, 0.88),
                      boxShadow: `0 0 0 1px ${withAlpha(primaryColor, 0.15)} inset, 0 0 30px ${withAlpha(primaryColor, 0.24)}`,
                    }}
                  />
                  <div
                    className="absolute left-5 top-5 h-6 w-6 rounded-tl-2xl border-l-[3px] border-t-[3px]"
                    style={{ borderColor: secondaryColor }}
                  />
                  <div
                    className="absolute right-5 top-5 h-6 w-6 rounded-tr-2xl border-r-[3px] border-t-[3px]"
                    style={{ borderColor: secondaryColor }}
                  />
                  <div
                    className="absolute bottom-5 left-5 h-6 w-6 rounded-bl-2xl border-b-[3px] border-l-[3px]"
                    style={{ borderColor: secondaryColor }}
                  />
                  <div
                    className="absolute bottom-5 right-5 h-6 w-6 rounded-br-2xl border-b-[3px] border-r-[3px]"
                    style={{ borderColor: secondaryColor }}
                  />
                  <motion.div
                    className="absolute inset-x-[8%] h-[3px] rounded-full"
                    style={{
                      background: `linear-gradient(90deg, transparent 0%, ${withAlpha(primaryColor, 0.22)} 18%, ${withAlpha(primaryColor, 0.98)} 50%, ${withAlpha(secondaryColor, 0.52)} 72%, transparent 100%)`,
                      boxShadow: `0 0 18px ${withAlpha(primaryColor, 0.58)}`,
                    }}
                    animate={{ top: ['10%', '82%', '10%'], opacity: [0.45, 1, 0.45] }}
                    transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
              </div>

              {!cameraReady && scannerSupported && !cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-950/78 text-white">
                  <Loader2 size={28} className="animate-spin" />
                  <p className="text-sm text-white/80">Preparando cámara...</p>
                </div>
              ) : null}

              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-950/82 px-6 text-center text-white">
                  <CameraOff size={30} className="text-amber-300" />
                  <p className="max-w-md text-sm leading-6 text-white/85">{cameraError}</p>
                </div>
              ) : null}

              {!scannerSupported ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-950/82 px-6 text-center text-white">
                  <Smartphone size={30} className="text-brand-300" />
                  <p className="max-w-md text-sm leading-6 text-white/85">
                    Este navegador no soporta escaneo con cámara. Puedes seguir operando con lector externo o ingreso manual.
                  </p>
                </div>
              ) : null}

              <AnimatePresence>
              </AnimatePresence>
            </div>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-white/75">{scannerHint}</p>
              {scannerCooldownRemaining > 0 ? (
                <div
                  className="rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/80"
                  style={{
                    border: `1px solid ${withAlpha(primaryColor, 0.18)}`,
                    background: withAlpha(primaryColor, 0.12),
                  }}
                >
                  Nuevo escaneo en {scannerCooldownRemaining}s
                </div>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4">
            <div
              className="rounded-[2rem] p-5 backdrop-blur-xl"
              style={{
                border: `1px solid ${withAlpha(primaryColor, 0.18)}`,
                background: `linear-gradient(180deg, ${withAlpha(primaryColor, 0.08)} 0%, rgba(7, 16, 24, 0.68) 100%)`,
              }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <QrCode size={16} />
                Ingreso manual
              </div>
              <p className="mt-2 text-sm leading-6 text-white/70">
                Úsalo si el lector externo pega el código automáticamente o si necesitas recuperar un escaneo fallido.
              </p>
              <form
                className="mt-4 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const payload = manualQrValue.trim();
                  if (!payload) {
                    toast.error('Pega un código QR válido.');
                    return;
                  }
                  setScannerHint('Validando ingreso...');
                  void scanMutation.mutateAsync(payload);
                }}
              >
                <textarea
                  value={manualQrValue}
                  onChange={(event) => setManualQrValue(event.target.value)}
                  className="min-h-32 w-full rounded-[1.5rem] bg-surface-950/80 px-4 py-4 font-mono text-sm text-white placeholder:text-white/35 focus:outline-none"
                  style={{
                    border: `1px solid ${withAlpha(primaryColor, 0.16)}`,
                    boxShadow: `0 0 0 1px ${withAlpha(primaryColor, 0.06)} inset`,
                  }}
                  placeholder="nexo:slug-del-gimnasio:id-del-cliente:id-de-la-membresía"
                  disabled={scanMutation.isPending || scannerCooldownRemaining > 0}
                />
                <button type="submit" className="btn-primary w-full justify-center" disabled={scanMutation.isPending || scannerCooldownRemaining > 0}>
                  {scanMutation.isPending ? 'Registrando...' : 'Registrar ingreso'}
                </button>
              </form>
            </div>

            <div
              className="rounded-[2rem] p-5 backdrop-blur-xl"
              style={{
                border: `1px solid ${withAlpha(secondaryColor, 0.18)}`,
                background: `linear-gradient(180deg, ${withAlpha(secondaryColor, 0.07)} 0%, rgba(7, 16, 24, 0.68) 100%)`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Últimos ingresos</p>
                  <p className="mt-1 text-sm text-white/65">Vista rápida para validar flujo de recepción.</p>
                </div>
                {historyQuery.isFetching ? <Loader2 size={18} className="animate-spin text-white/50" /> : null}
              </div>
              <div className="mt-4 space-y-3">
                {recentCheckins.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[1.5rem] px-4 py-3"
                    style={{
                      border: `1px solid ${withAlpha(secondaryColor, 0.14)}`,
                      background: withAlpha(secondaryColor, 0.08),
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{item.user_name || 'Cliente'}</p>
                        <p className="mt-1 text-xs text-white/55">{item.branch_name || currentBranchName || 'Sucursal actual'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">{formatTimeInZone(item.checked_in_at, timeZone)}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/45">{item.check_type}</p>
                      </div>
                    </div>
                  </div>
                ))}

                {!historyQuery.isFetching && recentCheckins.length === 0 ? (
                  <div className="rounded-[1.5rem] border border-dashed border-white/15 px-4 py-8 text-center text-white/65">
                    Aún no hay ingresos registrados en esta vista.
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className="rounded-[2rem] p-5 backdrop-blur-xl"
              style={{
                border: `1px solid ${withAlpha(primaryColor, 0.18)}`,
                background: `linear-gradient(180deg, ${withAlpha(primaryColor, 0.08)} 0%, rgba(7, 16, 24, 0.68) 100%)`,
              }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Clock3 size={16} />
                Estado operativo
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div
                  className="rounded-[1.5rem] px-4 py-4"
                  style={{
                    border: `1px solid ${withAlpha(primaryColor, 0.14)}`,
                    background: withAlpha(primaryColor, 0.08),
                  }}
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-white/45">Cámara</p>
                  <p className="mt-2 text-sm font-semibold text-white">{cameraReady ? 'Lista para escanear' : 'Preparando o sin permiso'}</p>
                </div>
                <div
                  className="rounded-[1.5rem] px-4 py-4"
                  style={{
                    border: `1px solid ${withAlpha(secondaryColor, 0.14)}`,
                    background: withAlpha(secondaryColor, 0.08),
                  }}
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-white/45">Operador</p>
                  <p className="mt-2 text-sm font-semibold text-white">{user?.first_name || user?.email || 'Recepción'}</p>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Camera, ImageOff, Plus, Search, Trash2, TrendingUp, Trophy, Upload } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { EmptyState, Panel, SkeletonListItems } from '../components/MemberShared';
import { cn, formatDate } from '@/utils';
import { mobileApi } from '@/services/api';
import toast from 'react-hot-toast';
import type { BodyMeasurement, PersonalRecord, ProgressPhoto } from '@/types';
import { useMemberContext } from '../MemberContext';

export default function ProgressTab() {
  const { brandGradient, queryClient } = useMemberContext();

  const [progressSubTab, setProgressSubTab] = useState<'measurements' | 'photos' | 'records'>('measurements');

  const [showAddMeasurement, setShowAddMeasurement] = useState(false);
  const [measurementForm, setMeasurementForm] = useState({
    recorded_at: new Date().toISOString().slice(0, 10),
    weight_kg: '',
    body_fat_pct: '',
    muscle_mass_kg: '',
    chest_cm: '',
    waist_cm: '',
    hip_cm: '',
    arm_cm: '',
    thigh_cm: '',
    notes: '',
  });

  const [showAddPR, setShowAddPR] = useState(false);
  const [prForm, setPrForm] = useState({
    exercise_name: '',
    record_value: '',
    unit: 'kg',
    recorded_at: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [prExerciseFilter, setPrExerciseFilter] = useState('');

  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoNotes, setPhotoNotes] = useState('');
  const [photoRecordedAt, setPhotoRecordedAt] = useState(new Date().toISOString().slice(0, 10));

  // ── Queries ──────────────────────────────────────────────────────────────────

  const measurementsQuery = useQuery<BodyMeasurement[]>({
    queryKey: ['member-measurements'],
    queryFn: async () => (await mobileApi.listMeasurements()).data,
  });

  const personalRecordsQuery = useQuery<PersonalRecord[]>({
    queryKey: ['member-personal-records', prExerciseFilter],
    queryFn: async () => (await mobileApi.listPersonalRecords(prExerciseFilter || undefined)).data,
  });

  const progressPhotosQuery = useQuery<ProgressPhoto[]>({
    queryKey: ['member-progress-photos'],
    queryFn: async () => (await mobileApi.listProgressPhotos()).data,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const addMeasurementMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => mobileApi.createMeasurement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-measurements'] });
      setShowAddMeasurement(false);
      setMeasurementForm({
        recorded_at: new Date().toISOString().slice(0, 10),
        weight_kg: '',
        body_fat_pct: '',
        muscle_mass_kg: '',
        chest_cm: '',
        waist_cm: '',
        hip_cm: '',
        arm_cm: '',
        thigh_cm: '',
        notes: '',
      });
      toast.success('Medición registrada.');
    },
    onError: () => toast.error('No se pudo guardar la medición.'),
  });

  const deleteMeasurementMutation = useMutation({
    mutationFn: (id: string) => mobileApi.deleteMeasurement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member-measurements'] }),
    onError: () => toast.error('No se pudo eliminar.'),
  });

  const addPRMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => mobileApi.createPersonalRecord(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-personal-records'] });
      setShowAddPR(false);
      setPrForm({
        exercise_name: '',
        record_value: '',
        unit: 'kg',
        recorded_at: new Date().toISOString().slice(0, 10),
        notes: '',
      });
      toast.success('Récord guardado.');
    },
    onError: () => toast.error('No se pudo guardar el récord.'),
  });

  const deletePRMutation = useMutation({
    mutationFn: (id: string) => mobileApi.deletePersonalRecord(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member-personal-records'] }),
    onError: () => toast.error('No se pudo eliminar el récord.'),
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: (formData: FormData) => mobileApi.uploadProgressPhoto(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-progress-photos'] });
      setShowPhotoUpload(false);
      setPhotoFile(null);
      setPhotoNotes('');
      setPhotoRecordedAt(new Date().toISOString().slice(0, 10));
      toast.success('Foto guardada.');
    },
    onError: () => toast.error('No se pudo subir la foto.'),
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (id: string) => mobileApi.deleteProgressPhoto(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member-progress-photos'] }),
    onError: () => toast.error('No se pudo eliminar la foto.'),
  });

  // ── Derived ──────────────────────────────────────────────────────────────────

  const measurements = measurementsQuery.data ?? [];
  const personalRecords = personalRecordsQuery.data ?? [];
  const progressPhotos = progressPhotosQuery.data ?? [];

  const weightMeasurements = measurements.filter((m) => m.weight_kg != null);
  const showWeightTrend = weightMeasurements.length >= 2;
  const firstWeight = showWeightTrend ? weightMeasurements[weightMeasurements.length - 1].weight_kg! : null;
  const lastWeight = showWeightTrend ? weightMeasurements[0].weight_kg! : null;
  const weightChange = showWeightTrend ? lastWeight! - firstWeight! : null;

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleMeasurementSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { recorded_at: measurementForm.recorded_at };
    if (measurementForm.weight_kg) payload.weight_kg = parseFloat(measurementForm.weight_kg);
    if (measurementForm.body_fat_pct) payload.body_fat_pct = parseFloat(measurementForm.body_fat_pct);
    if (measurementForm.muscle_mass_kg) payload.muscle_mass_kg = parseFloat(measurementForm.muscle_mass_kg);
    if (measurementForm.chest_cm) payload.chest_cm = parseFloat(measurementForm.chest_cm);
    if (measurementForm.waist_cm) payload.waist_cm = parseFloat(measurementForm.waist_cm);
    if (measurementForm.hip_cm) payload.hip_cm = parseFloat(measurementForm.hip_cm);
    if (measurementForm.arm_cm) payload.arm_cm = parseFloat(measurementForm.arm_cm);
    if (measurementForm.thigh_cm) payload.thigh_cm = parseFloat(measurementForm.thigh_cm);
    if (measurementForm.notes.trim()) payload.notes = measurementForm.notes.trim();
    addMeasurementMutation.mutate(payload);
  }

  function handlePRSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      exercise_name: prForm.exercise_name.trim(),
      record_value: parseFloat(prForm.record_value),
      unit: prForm.unit,
      recorded_at: prForm.recorded_at,
    };
    if (prForm.notes.trim()) payload.notes = prForm.notes.trim();
    addPRMutation.mutate(payload);
  }

  function handlePhotoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!photoFile) {
      toast.error('Selecciona una foto.');
      return;
    }
    const formData = new FormData();
    formData.append('photo', photoFile);
    formData.append('recorded_at', photoRecordedAt);
    if (photoNotes.trim()) formData.append('notes', photoNotes.trim());
    uploadPhotoMutation.mutate(formData);
  }

  const subTabConfig = [
    { id: 'measurements' as const, label: 'Medidas', Icon: TrendingUp },
    { id: 'photos' as const, label: 'Fotos', Icon: Camera },
    { id: 'records' as const, label: 'Récords', Icon: Trophy },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      className="space-y-4"
    >
      {/* ── Sub-tab nav ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-2xl bg-surface-100 p-1 dark:bg-surface-800">
        {subTabConfig.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setProgressSubTab(id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all duration-200',
              progressSubTab === id
                ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200',
            )}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* ══ Measurements sub-tab ══════════════════════════════════════════════ */}
      {progressSubTab === 'measurements' && (
        <div className="space-y-4">
          <Panel title="Medidas corporales">
            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              Registra tu peso, composición corporal y medidas para seguir tu evolución.
            </p>
            <button
              type="button"
              onClick={() => setShowAddMeasurement(true)}
              className="btn-primary mt-3 inline-flex items-center gap-2"
            >
              <Plus size={15} />
              Nueva medición
            </button>
          </Panel>

          {/* Weight trend */}
          {showWeightTrend && (
            <div className="rounded-[1.4rem] border border-surface-200/80 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Tendencia de peso</h2>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Inicial</p>
                  <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">{firstWeight} kg</p>
                </div>
                <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Actual</p>
                  <p className="mt-2 text-sm font-semibold text-surface-900 dark:text-white">{lastWeight} kg</p>
                </div>
                <div className="rounded-2xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-surface-950/35">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-surface-500">Cambio</p>
                  <p
                    className={cn(
                      'mt-2 text-sm font-semibold',
                      weightChange! < 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : weightChange! > 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-surface-900 dark:text-white',
                    )}
                  >
                    {weightChange! > 0 ? '+' : ''}{weightChange!.toFixed(1)} kg
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Measurements list */}
          {measurementsQuery.isLoading && !measurementsQuery.data ? (
            <SkeletonListItems count={3} />
          ) : measurements.length === 0 ? (
            <EmptyState
              title="Sin mediciones aún"
              description="Registra tu primera medición corporal para comenzar a seguir tu progreso."
            />
          ) : (
            <div className="space-y-3">
              {measurements.map((m) => (
                <Panel key={m.id} title={formatDate(m.recorded_at, { dateStyle: 'long' })}>
                  <div className="flex flex-wrap gap-2">
                    {m.weight_kg != null && (
                      <span className="badge badge-info">Peso: {m.weight_kg} kg</span>
                    )}
                    {m.body_fat_pct != null && (
                      <span className="badge badge-neutral">Grasa: {m.body_fat_pct}%</span>
                    )}
                    {m.muscle_mass_kg != null && (
                      <span className="badge badge-success">Músculo: {m.muscle_mass_kg} kg</span>
                    )}
                    {m.waist_cm != null && (
                      <span className="badge badge-neutral">Cintura: {m.waist_cm} cm</span>
                    )}
                    {m.chest_cm != null && (
                      <span className="badge badge-neutral">Pecho: {m.chest_cm} cm</span>
                    )}
                    {m.hip_cm != null && (
                      <span className="badge badge-neutral">Cadera: {m.hip_cm} cm</span>
                    )}
                    {m.arm_cm != null && (
                      <span className="badge badge-neutral">Brazo: {m.arm_cm} cm</span>
                    )}
                    {m.thigh_cm != null && (
                      <span className="badge badge-neutral">Muslo: {m.thigh_cm} cm</span>
                    )}
                  </div>
                  {m.notes ? (
                    <p className="mt-2 text-sm italic text-surface-500 dark:text-surface-400">{m.notes}</p>
                  ) : null}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => deleteMeasurementMutation.mutate(m.id)}
                      disabled={deleteMeasurementMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />
                      Eliminar
                    </button>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ Photos sub-tab ════════════════════════════════════════════════════ */}
      {progressSubTab === 'photos' && (
        <div className="space-y-4">
          <Panel title="Fotos de progreso">
            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              Sube fotos para visualizar tu transformación física a lo largo del tiempo.
            </p>
            <button
              type="button"
              onClick={() => setShowPhotoUpload(true)}
              className="btn-primary mt-3 inline-flex items-center gap-2"
            >
              <Upload size={15} />
              Subir foto
            </button>
          </Panel>

          {progressPhotosQuery.isLoading && !progressPhotosQuery.data ? (
            <SkeletonListItems count={4} />
          ) : progressPhotos.length === 0 ? (
            <EmptyState
              title="Sin fotos aún"
              description="Sube tu primera foto de progreso para comparar tu evolución visual."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {progressPhotos.map((photo) => (
                <div key={photo.id} className="group relative overflow-hidden rounded-2xl border border-surface-200 bg-surface-100 dark:border-white/10 dark:bg-surface-900">
                  <img
                    src={photo.photo_url}
                    alt={photo.notes || formatDate(photo.recorded_at)}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-surface-950/80 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <p className="text-xs font-semibold text-white">{formatDate(photo.recorded_at)}</p>
                    {photo.notes ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-white/80">{photo.notes}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => deletePhotoMutation.mutate(photo.id)}
                      disabled={deletePhotoMutation.isPending}
                      className="mt-2 inline-flex items-center gap-1 self-start rounded-lg bg-red-500/80 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-600"
                    >
                      <Trash2 size={11} />
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {progressPhotos.length === 0 && !progressPhotosQuery.isLoading && (
            <div className="flex flex-col items-center gap-3 py-6 text-surface-400 dark:text-surface-600">
              <ImageOff size={40} strokeWidth={1.5} />
            </div>
          )}
        </div>
      )}

      {/* ══ Records sub-tab ═══════════════════════════════════════════════════ */}
      {progressSubTab === 'records' && (
        <div className="space-y-4">
          <Panel title="Marcas personales">
            <p className="text-sm leading-6 text-surface-600 dark:text-surface-300">
              Guarda tus mejores marcas en ejercicios y sigue tu progreso de rendimiento.
            </p>
            <button
              type="button"
              onClick={() => setShowAddPR(true)}
              className="btn-primary mt-3 inline-flex items-center gap-2"
            >
              <Plus size={15} />
              Nuevo récord
            </button>
          </Panel>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              type="text"
              placeholder="Buscar ejercicio..."
              value={prExerciseFilter}
              onChange={(e) => setPrExerciseFilter(e.target.value)}
              className="input w-full pl-10"
            />
          </div>

          {personalRecordsQuery.isLoading && !personalRecordsQuery.data ? (
            <SkeletonListItems count={3} />
          ) : personalRecords.length === 0 ? (
            <EmptyState
              title="Sin récords aún"
              description={prExerciseFilter ? 'No hay récords que coincidan con la búsqueda.' : 'Registra tu primera marca personal.'}
            />
          ) : (
            <div className="space-y-3">
              {personalRecords.map((pr) => (
                <Panel key={pr.id} title={pr.exercise_name}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold text-white"
                      style={{ background: brandGradient }}
                    >
                      <Trophy size={13} />
                      {pr.record_value} {pr.unit}
                    </span>
                    <span className="badge badge-neutral">{formatDate(pr.recorded_at)}</span>
                  </div>
                  {pr.notes ? (
                    <p className="mt-2 text-sm italic text-surface-500 dark:text-surface-400">{pr.notes}</p>
                  ) : null}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => deletePRMutation.mutate(pr.id)}
                      disabled={deletePRMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />
                      Eliminar
                    </button>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ Modal: Nueva medición ═════════════════════════════════════════════ */}
      <Modal
        open={showAddMeasurement}
        title="Nueva medición"
        description="Ingresa tus medidas corporales actuales."
        onClose={() => setShowAddMeasurement(false)}
      >
        <form onSubmit={handleMeasurementSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="meas-date">Fecha</label>
            <input
              id="meas-date"
              type="date"
              className="input w-full"
              value={measurementForm.recorded_at}
              onChange={(e) => setMeasurementForm((f) => ({ ...f, recorded_at: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { key: 'weight_kg', label: 'Peso (kg)' },
              { key: 'body_fat_pct', label: 'Grasa (%)' },
              { key: 'muscle_mass_kg', label: 'Músculo (kg)' },
              { key: 'chest_cm', label: 'Pecho (cm)' },
              { key: 'waist_cm', label: 'Cintura (cm)' },
              { key: 'hip_cm', label: 'Cadera (cm)' },
              { key: 'arm_cm', label: 'Brazo (cm)' },
              { key: 'thigh_cm', label: 'Muslo (cm)' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="label" htmlFor={`meas-${key}`}>{label}</label>
                <input
                  id={`meas-${key}`}
                  type="number"
                  step="0.01"
                  min="0"
                  className="input w-full"
                  placeholder="—"
                  value={measurementForm[key as keyof typeof measurementForm]}
                  onChange={(e) => setMeasurementForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="meas-notes">Notas (opcional)</label>
            <textarea
              id="meas-notes"
              rows={2}
              className="input w-full resize-none"
              placeholder="Observaciones..."
              value={measurementForm.notes}
              onChange={(e) => setMeasurementForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={addMeasurementMutation.isPending}
              className="btn-primary flex-1"
            >
              {addMeasurementMutation.isPending ? 'Guardando...' : 'Guardar medición'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddMeasurement(false)}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
          </div>
        </form>
      </Modal>

      {/* ══ Modal: Subir foto ═════════════════════════════════════════════════ */}
      <Modal
        open={showPhotoUpload}
        title="Subir foto de progreso"
        description="Agrega una foto para registrar tu evolución visual."
        onClose={() => setShowPhotoUpload(false)}
      >
        <form onSubmit={handlePhotoSubmit} className="space-y-4">
          {/* Dropzone */}
          <div>
            <label className="label">Foto</label>
            <label
              htmlFor="photo-file"
              className={cn(
                'flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
                photoFile
                  ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/5'
                  : 'border-surface-300 bg-surface-50 hover:border-surface-400 dark:border-white/15 dark:bg-white/[0.03] dark:hover:border-white/25',
              )}
            >
              <Upload size={24} className="text-surface-400 dark:text-surface-500" />
              {photoFile ? (
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{photoFile.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-surface-700 dark:text-surface-300">
                    Haz clic para seleccionar una foto
                  </p>
                  <p className="text-xs text-surface-500">JPG, PNG, WEBP — máx. 10 MB</p>
                </>
              )}
            </label>
            <input
              id="photo-file"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div>
            <label className="label" htmlFor="photo-date">Fecha</label>
            <input
              id="photo-date"
              type="date"
              className="input w-full"
              value={photoRecordedAt}
              onChange={(e) => setPhotoRecordedAt(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="photo-notes">Notas (opcional)</label>
            <input
              id="photo-notes"
              type="text"
              className="input w-full"
              placeholder="Ej: Semana 4 del programa..."
              value={photoNotes}
              onChange={(e) => setPhotoNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={uploadPhotoMutation.isPending || !photoFile}
              className="btn-primary flex-1"
            >
              {uploadPhotoMutation.isPending ? 'Subiendo...' : 'Subir foto'}
            </button>
            <button
              type="button"
              onClick={() => setShowPhotoUpload(false)}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
          </div>
        </form>
      </Modal>

      {/* ══ Modal: Nuevo récord ════════════════════════════════════════════════ */}
      <Modal
        open={showAddPR}
        title="Nuevo récord personal"
        description="Registra tu mejor marca en un ejercicio."
        onClose={() => setShowAddPR(false)}
      >
        <form onSubmit={handlePRSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="pr-exercise">Ejercicio</label>
            <input
              id="pr-exercise"
              type="text"
              className="input w-full"
              placeholder="Ej: Sentadilla, Press banca..."
              value={prForm.exercise_name}
              onChange={(e) => setPrForm((f) => ({ ...f, exercise_name: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="pr-value">Valor</label>
              <input
                id="pr-value"
                type="number"
                step="0.01"
                min="0"
                className="input w-full"
                placeholder="100"
                value={prForm.record_value}
                onChange={(e) => setPrForm((f) => ({ ...f, record_value: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="pr-unit">Unidad</label>
              <select
                id="pr-unit"
                className="input w-full"
                value={prForm.unit}
                onChange={(e) => setPrForm((f) => ({ ...f, unit: e.target.value }))}
              >
                <option value="kg">kg</option>
                <option value="reps">reps</option>
                <option value="seg">seg</option>
                <option value="min">min</option>
                <option value="metros">metros</option>
                <option value="km">km</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pr-date">Fecha</label>
            <input
              id="pr-date"
              type="date"
              className="input w-full"
              value={prForm.recorded_at}
              onChange={(e) => setPrForm((f) => ({ ...f, recorded_at: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="pr-notes">Notas (opcional)</label>
            <input
              id="pr-notes"
              type="text"
              className="input w-full"
              placeholder="Observaciones..."
              value={prForm.notes}
              onChange={(e) => setPrForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={addPRMutation.isPending}
              className="btn-primary flex-1"
            >
              {addPRMutation.isPending ? 'Guardando...' : 'Guardar récord'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddPR(false)}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}

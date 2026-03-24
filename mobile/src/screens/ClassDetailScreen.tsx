import { Linking, Text, View } from 'react-native';

import { formatDateTime, formatStatus } from '../lib/formatters';
import { ActionButton, InlineActionButton, Metric, StatusBlock } from '../ui/components';
import { styles } from '../ui/styles';
import type { GymClass } from '../types';
import type { MobileScreenProps } from './types';

export function ClassDetailScreen({
  app,
  accentColor,
  classId,
}: MobileScreenProps & { classId: string }) {
  const {
    isRestoringSession,
    isLoadingSchedule,
    activeReservationTargetId,
    sessionUser,
    tenantProfile,
    classSchedule,
    reservations,
    bookingMessage,
    loadSchedule,
    reserveClass,
    cancelReservation,
  } = app;

  const gymClass = classSchedule.find((scheduleItem) => scheduleItem.id === classId) ?? null;
  const reservation = reservations.find((reservationItem) => reservationItem.gym_class_id === classId) ?? null;
  const branchNameById = new Map((tenantProfile?.branches ?? []).map((branch) => [branch.id, branch.name]));

  if (!sessionUser) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Detalle de clase</Text>
        <Text style={styles.emptyText}>Inicia sesion para abrir el detalle completo de una clase.</Text>
      </View>
    );
  }

  if (!gymClass) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Detalle de clase</Text>
        <Text style={styles.sectionHint}>
          Esta vista puede venir desde un deep link o desde Agenda, pero la clase no esta en el snapshot actual.
        </Text>
        <StatusBlock label="Estado agenda" message={bookingMessage} />
        <ActionButton
          label={isLoadingSchedule ? 'Actualizando agenda...' : 'Recargar agenda'}
          accentColor={accentColor}
          disabled={isRestoringSession || isLoadingSchedule}
          onPress={() => {
            void loadSchedule();
          }}
        />
      </View>
    );
  }

  const branchName = gymClass.branch_id
    ? branchNameById.get(gymClass.branch_id) ?? 'Sede sin nombre'
    : 'Sede no informada';
  const canCancel = reservation && (reservation.status === 'confirmed' || reservation.status === 'waitlisted');
  const isProcessing =
    activeReservationTargetId === gymClass.id || activeReservationTargetId === reservation?.id;
  const spotsLeft = Math.max(gymClass.max_capacity - gymClass.current_bookings, 0);

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Detalle de clase</Text>
      <Text style={styles.sectionHint}>
        Esta pantalla dedicada ya sirve como base para deep links de notificaciones, recordatorios o cambios de reserva.
      </Text>
      <StatusBlock label="Estado reservas" message={bookingMessage} />

      <View style={styles.inlinePanel}>
        <Text style={styles.primaryValue}>{gymClass.name}</Text>
        <Text style={styles.secondaryValue}>
          {branchName} - {formatStatus(gymClass.modality)}
        </Text>
        <Text style={styles.description}>
          {gymClass.description ?? 'Sin descripcion comercial para esta clase.'}
        </Text>
      </View>

      <View style={styles.metricRow}>
        <Metric label="Estado" value={reservation ? formatStatus(reservation.status) : 'Disponible'} />
        <Metric label="Cupos" value={`${spotsLeft}/${gymClass.max_capacity}`} />
      </View>
      <View style={styles.metricRow}>
        <Metric label="Inicio" value={formatDateTime(gymClass.start_time)} />
        <Metric label="Fin" value={formatDateTime(gymClass.end_time)} />
      </View>

      <View style={styles.detailPanel}>
        <DetailRow label="Tipo" value={gymClass.class_type ? formatStatus(gymClass.class_type) : 'No informado'} />
        <DetailRow label="Espera" value={gymClass.waitlist_enabled ? 'Habilitada' : 'No disponible'} />
        <DetailRow label="Color" value={gymClass.color ?? 'No definido'} />
        {reservation?.waitlist_position ? (
          <DetailRow label="Posicion" value={`Lista de espera #${reservation.waitlist_position}`} />
        ) : null}
      </View>

      {gymClass.online_link ? (
        <InlineActionButton
          label="Abrir link online"
          accentColor={accentColor}
          tone="secondary"
          onPress={() => {
            void Linking.openURL(gymClass.online_link!);
          }}
        />
      ) : null}

      {canCancel ? (
        <ActionButton
          label={isProcessing ? 'Cancelando...' : 'Cancelar reserva'}
          accentColor={accentColor}
          tone="secondary"
          disabled={isProcessing}
          onPress={() => {
            void cancelReservation(reservation.id);
          }}
        />
      ) : (
        <ActionButton
          label={isProcessing ? 'Reservando...' : 'Reservar clase'}
          accentColor={accentColor}
          disabled={Boolean(reservation) || isProcessing}
          onPress={() => {
            void reserveClass(gymClass.id);
          }}
        />
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.description}>{value}</Text>
    </View>
  );
}

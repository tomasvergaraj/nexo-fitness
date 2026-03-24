import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { formatDateTime, formatStatus } from '../lib/formatters';
import { ActionButton, InlineActionButton, Metric, StatusBlock } from '../ui/components';
import { styles } from '../ui/styles';
import type { MobileScreenProps } from './types';

const ALL_BRANCHES = 'all-branches';
const ALL_MODALITIES = 'all-modalities';

export function AgendaScreen({ app, accentColor, openClassDetail }: MobileScreenProps) {
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

  const [selectedBranchId, setSelectedBranchId] = useState(ALL_BRANCHES);
  const [selectedModality, setSelectedModality] = useState(ALL_MODALITIES);

  const reservationsByClassId = new Map(reservations.map((reservation) => [reservation.gym_class_id, reservation]));
  const branchNameById = new Map((tenantProfile?.branches ?? []).map((branch) => [branch.id, branch.name]));
  const branchOptions = [
    { id: ALL_BRANCHES, label: 'Todas' },
    ...Array.from(new Set(classSchedule.map((gymClass) => gymClass.branch_id).filter((value): value is string => Boolean(value)))).map(
      (branchId) => ({
        id: branchId,
        label: branchNameById.get(branchId) ?? 'Sede sin nombre',
      }),
    ),
  ];
  const modalityOptions = [
    { id: ALL_MODALITIES, label: 'Todas' },
    ...Array.from(new Set(classSchedule.map((gymClass) => gymClass.modality))).map((modality) => ({
      id: modality,
      label: formatStatus(modality),
    })),
  ];

  const filteredClasses = classSchedule.filter(
    (gymClass) =>
      (selectedBranchId === ALL_BRANCHES || gymClass.branch_id === selectedBranchId) &&
      (selectedModality === ALL_MODALITIES || gymClass.modality === selectedModality),
  );

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Reservas y agenda</Text>
      <Text style={styles.sectionHint}>
        La agenda autenticada ahora se puede recorrer por sede y modalidad, y cada clase abre una vista dedicada para profundizar el detalle.
      </Text>
      <ActionButton
        label={isLoadingSchedule ? 'Actualizando agenda...' : 'Cargar agenda de clases'}
        accentColor={accentColor}
        disabled={isRestoringSession || isLoadingSchedule}
        onPress={() => {
          void loadSchedule();
        }}
      />
      <StatusBlock label="Estado reservas" message={bookingMessage} />

      {sessionUser ? (
        <>
          <View style={styles.metricRow}>
            <Metric label="Mostrando" value={`${filteredClasses.length}/${classSchedule.length}`} />
            <Metric label="Reservas" value={String(reservations.length)} />
          </View>

          {classSchedule.length ? (
            <>
              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Filtrar por sede</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {branchOptions.map((option) => (
                    <FilterChip
                      key={option.id}
                      label={option.label}
                      active={selectedBranchId === option.id}
                      accentColor={accentColor}
                      onPress={() => {
                        setSelectedBranchId(option.id);
                      }}
                    />
                  ))}
                </ScrollView>
              </View>

              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Filtrar por modalidad</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {modalityOptions.map((option) => (
                    <FilterChip
                      key={option.id}
                      label={option.label}
                      active={selectedModality === option.id}
                      accentColor={accentColor}
                      onPress={() => {
                        setSelectedModality(option.id);
                      }}
                    />
                  ))}
                </ScrollView>
              </View>

              {filteredClasses.length ? (
                <View style={styles.listBlock}>
                  {filteredClasses.map((gymClass) => {
                    const reservation = reservationsByClassId.get(gymClass.id);
                    const canCancel =
                      reservation &&
                      (reservation.status === 'confirmed' || reservation.status === 'waitlisted');
                    const isProcessing =
                      activeReservationTargetId === gymClass.id ||
                      activeReservationTargetId === reservation?.id;
                    const spotsLeft = Math.max(gymClass.max_capacity - gymClass.current_bookings, 0);
                    const branchName = gymClass.branch_id
                      ? branchNameById.get(gymClass.branch_id) ?? 'Sede sin nombre'
                      : 'Sede no informada';

                    return (
                      <View key={gymClass.id} style={styles.scheduleCard}>
                        <View style={styles.planHeader}>
                          <Text style={styles.listRowTitle}>{gymClass.name}</Text>
                          <View
                            style={[
                              styles.stateBadge,
                              reservation ? { borderColor: accentColor } : styles.stateBadgeMuted,
                            ]}
                          >
                            <Text style={styles.stateBadgeText}>
                              {reservation ? formatStatus(reservation.status) : 'Disponible'}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.listRowMeta}>{branchName}</Text>
                        <Text style={styles.listRowMeta}>
                          {formatDateTime(gymClass.start_time)} - {formatStatus(gymClass.modality)}
                        </Text>
                        <Text style={styles.description}>
                          Cupos libres: {spotsLeft} / {gymClass.max_capacity}
                          {reservation?.waitlist_position ? ` - Lista de espera #${reservation.waitlist_position}` : ''}
                        </Text>

                        {openClassDetail ? (
                          <InlineActionButton
                            label="Abrir detalle"
                            accentColor={accentColor}
                            tone="secondary"
                            onPress={() => {
                              openClassDetail(gymClass.id);
                            }}
                          />
                        ) : null}

                        {canCancel ? (
                          <InlineActionButton
                            label={isProcessing ? 'Cancelando...' : 'Cancelar reserva'}
                            accentColor={accentColor}
                            tone="secondary"
                            disabled={isProcessing}
                            onPress={() => {
                              void cancelReservation(reservation.id);
                            }}
                          />
                        ) : (
                          <InlineActionButton
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
                  })}
                </View>
              ) : (
                <Text style={styles.emptyText}>
                  No encontramos clases para este cruce de filtros. Cambia sede o modalidad para ampliar la agenda.
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.emptyText}>Aun no se cargo la agenda del miembro autenticado.</Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyText}>Inicia sesion desde Cuenta para ver clases disponibles y reservar.</Text>
      )}
    </View>
  );
}

function FilterChip({
  label,
  active,
  accentColor,
  onPress,
}: {
  label: string;
  active: boolean;
  accentColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.filterChip,
        active ? styles.filterChipActive : null,
        active ? { borderColor: accentColor } : null,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

export interface ProgramExerciseLibraryItem {
  id: string;
  name: string;
  group: string;
}

export interface ProgramScheduleExercise {
  exercise_id: string;
  name: string;
  group?: string;
}

export type ProgramClassModality = 'in_person' | 'online' | 'hybrid';
export type ProgramScheduleConfigMode = 'inherit' | 'custom';

export type ProgramScheduleDayConfigValueMap = {
  branch_id: string | null;
  instructor_id: string | null;
  modality: ProgramClassModality;
  max_capacity: number;
  online_link: string | null;
  cancellation_deadline_hours: number;
  restricted_plan_id: string | null;
  color: string | null;
  class_type: string | null;
};

export type ProgramScheduleDayConfigField<
  Key extends keyof ProgramScheduleDayConfigValueMap = keyof ProgramScheduleDayConfigValueMap,
> = {
  mode: ProgramScheduleConfigMode;
  value?: ProgramScheduleDayConfigValueMap[Key];
};

export type ProgramScheduleDayConfig = {
  [Key in keyof ProgramScheduleDayConfigValueMap]?: ProgramScheduleDayConfigField<Key>;
};

export interface ProgramScheduleDay {
  day: string;
  focus: string;
  exercises: ProgramScheduleExercise[];
  class_config?: ProgramScheduleDayConfig | null;
}

export interface TrainingProgram {
  id: string;
  name: string;
  description?: string;
  trainer_id?: string;
  trainer_name?: string;
  program_type?: string;
  duration_weeks: number; // 0 = indefinido (sin límite)
  schedule: ProgramScheduleDay[];
  is_active: boolean;
  enrolled_count: number;
  linked_class_count: number;
  is_enrolled: boolean;
  enrollment_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramBooking {
  id: string;
  user_id: string;
  program_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  user_phone?: string | null;
  program_name?: string | null;
  recurrence_group_id: string;
  status: 'active' | 'cancelled';
  total_classes: number;
  reserved_classes: number;
  waitlisted_classes: number;
  failed_classes: number;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  created_at: string;
}

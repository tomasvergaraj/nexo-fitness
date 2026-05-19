export interface BodyMeasurement {
  id: string;
  user_id: string;
  tenant_id: string;
  recorded_at: string;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_kg?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  arm_cm?: number | null;
  thigh_cm?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface PersonalRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  exercise_name: string;
  record_value: number;
  unit: string;
  recorded_at: string;
  notes?: string | null;
  created_at: string;
}

export interface ProgressPhoto {
  id: string;
  user_id: string;
  tenant_id: string;
  recorded_at: string;
  photo_url: string;
  notes?: string | null;
  created_at: string;
}

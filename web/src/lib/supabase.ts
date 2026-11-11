import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './env';

/** Row shapes the browser depends on. Generated types should replace this once
 *  the schema is stable enough to run supabase gen types in CI. */
export interface Profile {
  user_id: string;
  display_name: string | null;
  student_no: string | null;
  role: 'student' | 'teacher' | 'admin';
}

export interface Course {
  id: string;
  name: string;
  code: string | null;
}

export interface Assignment {
  id: string;
  course_id: string;
  problem_id: string;
  pass_score: number;
  n_instances: number;
  due_at: string | null;
  score_policy?: 'highest_before_due' | 'latest' | 'highest';
  integrity_policy: 'standard' | 'exam_warn' | 'exam_block';
}

export interface Submission {
  id: string;
  assignment_id: string;
  attempt_no: number;
  created_at: string;
  public_code: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Grading {
  id: string;
  submission_id: string;
  status: 'queued' | 'running' | 'done' | 'system_error';
  score: number | null;
  passed: boolean | null;
  report_json: Record<string, unknown> | null;
  error_message?: string | null;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

let client: SupabaseClient | null = null;

/** The single Supabase instance. Never import a second client anywhere else. */
export function supabase(): SupabaseClient {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = getConfig();
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

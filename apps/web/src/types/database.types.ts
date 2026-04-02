// Manually maintained until `supabase gen types typescript` is run against the live project.
// Run: supabase gen types typescript --project-id mgyivfyaubefpouxnwad > src/types/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      orgs: {
        Row: { id: string; name: string; slug: string; plan: string; created_at: string }
        Insert: { id?: string; name: string; slug: string; plan?: string; created_at?: string }
        Update: { id?: string; name?: string; slug?: string; plan?: string; created_at?: string }
        Relationships: []
      }
      org_members: {
        Row: { id: string; org_id: string; user_id: string; role: 'owner' | 'admin' | 'viewer'; created_at: string }
        Insert: { id?: string; org_id: string; user_id: string; role?: 'owner' | 'admin' | 'viewer'; created_at?: string }
        Update: { id?: string; org_id?: string; user_id?: string; role?: 'owner' | 'admin' | 'viewer'; created_at?: string }
        Relationships: [
          { foreignKeyName: 'org_members_org_id_fkey'; columns: ['org_id']; isOneToOne: false; referencedRelation: 'orgs'; referencedColumns: ['id'] }
        ]
      }
      org_settings: {
        Row: {
          org_id: string; sms_enabled: boolean; sms_threshold_score: number
          agent_phone: string | null; agent_email: string | null
          scoring_config: Json; weekly_briefing_day: number
          snippet_domains: string[]; created_at: string; updated_at: string
        }
        Insert: {
          org_id: string; sms_enabled?: boolean; sms_threshold_score?: number
          agent_phone?: string | null; agent_email?: string | null
          scoring_config?: Json; weekly_briefing_day?: number
          snippet_domains?: string[]; created_at?: string; updated_at?: string
        }
        Update: {
          org_id?: string; sms_enabled?: boolean; sms_threshold_score?: number
          agent_phone?: string | null; agent_email?: string | null
          scoring_config?: Json; weekly_briefing_day?: number
          snippet_domains?: string[]; created_at?: string; updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'org_settings_org_id_fkey'; columns: ['org_id']; isOneToOne: true; referencedRelation: 'orgs'; referencedColumns: ['id'] }
        ]
      }
      contacts: {
        Row: {
          id: string; org_id: string; email: string | null; phone: string | null
          first_name: string | null; last_name: string | null; score: number
          crm_source: 'rex' | 'agentbox' | 'manual' | null; crm_external_id: string | null
          identified_at: string | null; last_seen_at: string | null
          metadata: Json; created_at: string
        }
        Insert: {
          id?: string; org_id: string; email?: string | null; phone?: string | null
          first_name?: string | null; last_name?: string | null; score?: number
          crm_source?: 'rex' | 'agentbox' | 'manual' | null; crm_external_id?: string | null
          identified_at?: string | null; last_seen_at?: string | null
          metadata?: Json; created_at?: string
        }
        Update: {
          id?: string; org_id?: string; email?: string | null; phone?: string | null
          first_name?: string | null; last_name?: string | null; score?: number
          crm_source?: 'rex' | 'agentbox' | 'manual' | null; crm_external_id?: string | null
          identified_at?: string | null; last_seen_at?: string | null
          metadata?: Json; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'contacts_org_id_fkey'; columns: ['org_id']; isOneToOne: false; referencedRelation: 'orgs'; referencedColumns: ['id'] }
        ]
      }
      sessions: {
        Row: {
          id: string; org_id: string; anonymous_id: string; contact_id: string | null
          first_seen_at: string; last_seen_at: string; campaign_token: string | null
          utm_source: string | null; utm_medium: string | null; utm_campaign: string | null
          utm_content: string | null; referrer: string | null; ip_country: string | null; user_agent: string | null
        }
        Insert: {
          id?: string; org_id: string; anonymous_id: string; contact_id?: string | null
          first_seen_at?: string; last_seen_at?: string; campaign_token?: string | null
          utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null
          utm_content?: string | null; referrer?: string | null; ip_country?: string | null; user_agent?: string | null
        }
        Update: {
          id?: string; org_id?: string; anonymous_id?: string; contact_id?: string | null
          first_seen_at?: string; last_seen_at?: string; campaign_token?: string | null
          utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null
          utm_content?: string | null; referrer?: string | null; ip_country?: string | null; user_agent?: string | null
        }
        Relationships: [
          { foreignKeyName: 'sessions_org_id_fkey'; columns: ['org_id']; isOneToOne: false; referencedRelation: 'orgs'; referencedColumns: ['id'] },
          { foreignKeyName: 'sessions_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      events: {
        Row: {
          id: string; org_id: string; session_id: string; contact_id: string | null
          event_type: 'page_view' | 'property_view' | 'form_submit' | 'scroll_depth' | 'return_visit' | 'campaign_click'
          properties: Json; score_delta: number; occurred_at: string
        }
        Insert: {
          id?: string; org_id: string; session_id: string; contact_id?: string | null
          event_type: 'page_view' | 'property_view' | 'form_submit' | 'scroll_depth' | 'return_visit' | 'campaign_click'
          properties?: Json; score_delta?: number; occurred_at?: string
        }
        Update: {
          id?: string; org_id?: string; session_id?: string; contact_id?: string | null
          event_type?: 'page_view' | 'property_view' | 'form_submit' | 'scroll_depth' | 'return_visit' | 'campaign_click'
          properties?: Json; score_delta?: number; occurred_at?: string
        }
        Relationships: [
          { foreignKeyName: 'events_org_id_fkey'; columns: ['org_id']; isOneToOne: false; referencedRelation: 'orgs'; referencedColumns: ['id'] },
          { foreignKeyName: 'events_session_id_fkey'; columns: ['session_id']; isOneToOne: false; referencedRelation: 'sessions'; referencedColumns: ['id'] },
          { foreignKeyName: 'events_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      score_history: {
        Row: {
          id: string; org_id: string; contact_id: string; delta: number; reason: string
          event_id: string | null; score_before: number; score_after: number; occurred_at: string
        }
        Insert: {
          id?: string; org_id: string; contact_id: string; delta: number; reason: string
          event_id?: string | null; score_before: number; score_after: number; occurred_at?: string
        }
        Update: {
          id?: string; org_id?: string; contact_id?: string; delta?: number; reason?: string
          event_id?: string | null; score_before?: number; score_after?: number; occurred_at?: string
        }
        Relationships: [
          { foreignKeyName: 'score_history_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      campaigns: {
        Row: { id: string; org_id: string; name: string; description: string | null; created_at: string }
        Insert: { id?: string; org_id: string; name: string; description?: string | null; created_at?: string }
        Update: { id?: string; org_id?: string; name?: string; description?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'campaigns_org_id_fkey'; columns: ['org_id']; isOneToOne: false; referencedRelation: 'orgs'; referencedColumns: ['id'] }
        ]
      }
      campaign_tokens: {
        Row: { id: string; org_id: string; campaign_id: string; contact_id: string; token: string; clicked_at: string | null; created_at: string }
        Insert: { id?: string; org_id: string; campaign_id: string; contact_id: string; token: string; clicked_at?: string | null; created_at?: string }
        Update: { id?: string; org_id?: string; campaign_id?: string; contact_id?: string; token?: string; clicked_at?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'campaign_tokens_campaign_id_fkey'; columns: ['campaign_id']; isOneToOne: false; referencedRelation: 'campaigns'; referencedColumns: ['id'] },
          { foreignKeyName: 'campaign_tokens_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      crm_imports: {
        Row: {
          id: string; org_id: string; source: string; filename: string | null
          row_count: number | null; created_count: number | null; matched_count: number | null; skipped_count: number | null
          status: 'pending' | 'processing' | 'done' | 'failed'; error_message: string | null; created_at: string
        }
        Insert: {
          id?: string; org_id: string; source?: string; filename?: string | null
          row_count?: number | null; created_count?: number | null; matched_count?: number | null; skipped_count?: number | null
          status?: 'pending' | 'processing' | 'done' | 'failed'; error_message?: string | null; created_at?: string
        }
        Update: {
          id?: string; org_id?: string; source?: string; filename?: string | null
          row_count?: number | null; created_count?: number | null; matched_count?: number | null; skipped_count?: number | null
          status?: 'pending' | 'processing' | 'done' | 'failed'; error_message?: string | null; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'crm_imports_org_id_fkey'; columns: ['org_id']; isOneToOne: false; referencedRelation: 'orgs'; referencedColumns: ['id'] }
        ]
      }
      notification_log: {
        Row: { id: string; org_id: string; contact_id: string | null; type: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing'; sent_at: string }
        Insert: { id?: string; org_id: string; contact_id?: string | null; type: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing'; sent_at?: string }
        Update: { id?: string; org_id?: string; contact_id?: string | null; type?: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing'; sent_at?: string }
        Relationships: [
          { foreignKeyName: 'notification_log_org_id_fkey'; columns: ['org_id']; isOneToOne: false; referencedRelation: 'orgs'; referencedColumns: ['id'] }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_org_with_owner: {
        Args: { p_user_id: string; p_name: string; p_slug: string; p_email: string }
        Returns: string
      }
      get_weekly_briefing_data: {
        Args: { p_org_id: string }
        Returns: Array<{
          contact_id: string; first_name: string | null; last_name: string | null
          email: string | null; score: number; score_change: number
          event_count: number; last_seen_at: string | null
        }>
      }
      resolve_campaign_token: {
        Args: { p_org_id: string; p_token: string }
        Returns: string | null
      }
      user_org_ids: {
        Args: Record<string, never>
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

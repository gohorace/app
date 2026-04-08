// Manually maintained until `supabase gen types typescript` is run against the live project.
// Run: supabase gen types typescript --project-id mgyivfyaubefpouxnwad > src/types/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string; name: string; slug: string; snippet_key: string; plan: string
          default_agent_id: string | null; created_at: string
        }
        Insert: {
          id?: string; name: string; slug: string; snippet_key?: string; plan?: string
          default_agent_id?: string | null; created_at?: string
        }
        Update: {
          id?: string; name?: string; slug?: string; snippet_key?: string; plan?: string
          default_agent_id?: string | null; created_at?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: { id: string; workspace_id: string; user_id: string; role: 'owner' | 'admin' | 'viewer'; created_at: string }
        Insert: { id?: string; workspace_id: string; user_id: string; role?: 'owner' | 'admin' | 'viewer'; created_at?: string }
        Update: { id?: string; workspace_id?: string; user_id?: string; role?: 'owner' | 'admin' | 'viewer'; created_at?: string }
        Relationships: [
          { foreignKeyName: 'workspace_members_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] }
        ]
      }
      workspace_settings: {
        Row: { workspace_id: string; snippet_domains: string[]; created_at: string; updated_at: string }
        Insert: { workspace_id: string; snippet_domains?: string[]; created_at?: string; updated_at?: string }
        Update: { workspace_id?: string; snippet_domains?: string[]; created_at?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: 'workspace_settings_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: true; referencedRelation: 'workspaces'; referencedColumns: ['id'] }
        ]
      }
      agents: {
        Row: {
          id: string; workspace_id: string | null; user_id: string
          first_name: string | null; last_name: string | null
          email: string | null; phone: string | null
          rex_agent_id: string | null; created_at: string
        }
        Insert: {
          id?: string; workspace_id?: string | null; user_id: string
          first_name?: string | null; last_name?: string | null
          email?: string | null; phone?: string | null
          rex_agent_id?: string | null; created_at?: string
        }
        Update: {
          id?: string; workspace_id?: string | null; user_id?: string
          first_name?: string | null; last_name?: string | null
          email?: string | null; phone?: string | null
          rex_agent_id?: string | null; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'agents_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] }
        ]
      }
      agent_settings: {
        Row: {
          agent_id: string; sms_enabled: boolean; sms_threshold_score: number
          agent_phone: string | null; agent_email: string | null
          scoring_config: Json; weekly_briefing_day: number
          created_at: string; updated_at: string
        }
        Insert: {
          agent_id: string; sms_enabled?: boolean; sms_threshold_score?: number
          agent_phone?: string | null; agent_email?: string | null
          scoring_config?: Json; weekly_briefing_day?: number
          created_at?: string; updated_at?: string
        }
        Update: {
          agent_id?: string; sms_enabled?: boolean; sms_threshold_score?: number
          agent_phone?: string | null; agent_email?: string | null
          scoring_config?: Json; weekly_briefing_day?: number
          created_at?: string; updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'agent_settings_agent_id_fkey'; columns: ['agent_id']; isOneToOne: true; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      contacts: {
        Row: {
          id: string; agent_id: string; email: string | null; phone: string | null
          first_name: string | null; last_name: string | null; score: number
          crm_source: 'rex' | 'agentbox' | 'manual' | null; crm_external_id: string | null
          identified_at: string | null; last_seen_at: string | null
          metadata: Json; created_at: string
        }
        Insert: {
          id?: string; agent_id: string; email?: string | null; phone?: string | null
          first_name?: string | null; last_name?: string | null; score?: number
          crm_source?: 'rex' | 'agentbox' | 'manual' | null; crm_external_id?: string | null
          identified_at?: string | null; last_seen_at?: string | null
          metadata?: Json; created_at?: string
        }
        Update: {
          id?: string; agent_id?: string; email?: string | null; phone?: string | null
          first_name?: string | null; last_name?: string | null; score?: number
          crm_source?: 'rex' | 'agentbox' | 'manual' | null; crm_external_id?: string | null
          identified_at?: string | null; last_seen_at?: string | null
          metadata?: Json; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'contacts_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      sessions: {
        Row: {
          id: string; workspace_id: string; anonymous_id: string
          first_seen_at: string; last_seen_at: string; campaign_token: string | null
          utm_source: string | null; utm_medium: string | null; utm_campaign: string | null
          utm_content: string | null; referrer: string | null; ip_country: string | null; user_agent: string | null
        }
        Insert: {
          id?: string; workspace_id: string; anonymous_id: string
          first_seen_at?: string; last_seen_at?: string; campaign_token?: string | null
          utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null
          utm_content?: string | null; referrer?: string | null; ip_country?: string | null; user_agent?: string | null
        }
        Update: {
          id?: string; workspace_id?: string; anonymous_id?: string
          first_seen_at?: string; last_seen_at?: string; campaign_token?: string | null
          utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null
          utm_content?: string | null; referrer?: string | null; ip_country?: string | null; user_agent?: string | null
        }
        Relationships: [
          { foreignKeyName: 'sessions_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] }
        ]
      }
      events: {
        Row: {
          id: string; workspace_id: string; session_id: string
          event_type: 'page_view' | 'property_view' | 'form_submit' | 'scroll_depth' | 'return_visit' | 'campaign_click'
          properties: Json; score_delta: number; occurred_at: string
        }
        Insert: {
          id?: string; workspace_id: string; session_id: string
          event_type: 'page_view' | 'property_view' | 'form_submit' | 'scroll_depth' | 'return_visit' | 'campaign_click'
          properties?: Json; score_delta?: number; occurred_at?: string
        }
        Update: {
          id?: string; workspace_id?: string; session_id?: string
          event_type?: 'page_view' | 'property_view' | 'form_submit' | 'scroll_depth' | 'return_visit' | 'campaign_click'
          properties?: Json; score_delta?: number; occurred_at?: string
        }
        Relationships: [
          { foreignKeyName: 'events_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] },
          { foreignKeyName: 'events_session_id_fkey'; columns: ['session_id']; isOneToOne: false; referencedRelation: 'sessions'; referencedColumns: ['id'] }
        ]
      }
      identity_map: {
        Row: {
          id: string; workspace_id: string; agent_id: string; anonymous_id: string
          contact_id: string; stitch_method: 'form' | 'email_click' | 'manual'
          confidence: 'high' | 'medium' | 'low'; created_at: string
        }
        Insert: {
          id?: string; workspace_id: string; agent_id: string; anonymous_id: string
          contact_id: string; stitch_method: 'form' | 'email_click' | 'manual'
          confidence?: 'high' | 'medium' | 'low'; created_at?: string
        }
        Update: {
          id?: string; workspace_id?: string; agent_id?: string; anonymous_id?: string
          contact_id?: string; stitch_method?: 'form' | 'email_click' | 'manual'
          confidence?: 'high' | 'medium' | 'low'; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'identity_map_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] },
          { foreignKeyName: 'identity_map_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'identity_map_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      score_history: {
        Row: {
          id: string; agent_id: string; contact_id: string; delta: number; reason: string
          event_id: string | null; score_before: number; score_after: number; occurred_at: string
        }
        Insert: {
          id?: string; agent_id: string; contact_id: string; delta: number; reason: string
          event_id?: string | null; score_before: number; score_after: number; occurred_at?: string
        }
        Update: {
          id?: string; agent_id?: string; contact_id?: string; delta?: number; reason?: string
          event_id?: string | null; score_before?: number; score_after?: number; occurred_at?: string
        }
        Relationships: [
          { foreignKeyName: 'score_history_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'score_history_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      campaigns: {
        Row: { id: string; agent_id: string; name: string; description: string | null; created_at: string }
        Insert: { id?: string; agent_id: string; name: string; description?: string | null; created_at?: string }
        Update: { id?: string; agent_id?: string; name?: string; description?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'campaigns_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      campaign_tokens: {
        Row: { id: string; agent_id: string; campaign_id: string; contact_id: string; token: string; clicked_at: string | null; created_at: string }
        Insert: { id?: string; agent_id: string; campaign_id: string; contact_id: string; token: string; clicked_at?: string | null; created_at?: string }
        Update: { id?: string; agent_id?: string; campaign_id?: string; contact_id?: string; token?: string; clicked_at?: string | null; created_at?: string }
        Relationships: [
          { foreignKeyName: 'campaign_tokens_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'campaign_tokens_campaign_id_fkey'; columns: ['campaign_id']; isOneToOne: false; referencedRelation: 'campaigns'; referencedColumns: ['id'] },
          { foreignKeyName: 'campaign_tokens_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      crm_imports: {
        Row: {
          id: string; agent_id: string; source: string; filename: string | null
          row_count: number | null; created_count: number | null; matched_count: number | null; skipped_count: number | null
          status: 'pending' | 'processing' | 'done' | 'failed'; error_message: string | null; created_at: string
        }
        Insert: {
          id?: string; agent_id: string; source?: string; filename?: string | null
          row_count?: number | null; created_count?: number | null; matched_count?: number | null; skipped_count?: number | null
          status?: 'pending' | 'processing' | 'done' | 'failed'; error_message?: string | null; created_at?: string
        }
        Update: {
          id?: string; agent_id?: string; source?: string; filename?: string | null
          row_count?: number | null; created_count?: number | null; matched_count?: number | null; skipped_count?: number | null
          status?: 'pending' | 'processing' | 'done' | 'failed'; error_message?: string | null; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'crm_imports_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      notification_log: {
        Row: { id: string; agent_id: string; contact_id: string | null; type: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing'; sent_at: string }
        Insert: { id?: string; agent_id: string; contact_id?: string | null; type: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing'; sent_at?: string }
        Update: { id?: string; agent_id?: string; contact_id?: string | null; type?: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing'; sent_at?: string }
        Relationships: [
          { foreignKeyName: 'notification_log_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace_with_agent: {
        Args: { p_user_id: string; p_name: string; p_slug: string; p_email: string; p_first_name?: string | null; p_last_name?: string | null }
        Returns: Array<{ workspace_id: string; agent_id: string }>
      }
      get_weekly_briefing_data: {
        Args: { p_agent_id: string }
        Returns: Array<{
          contact_id: string; first_name: string | null; last_name: string | null
          email: string | null; score: number; score_change: number
          event_count: number; last_seen_at: string | null
        }>
      }
      get_contact_events: {
        Args: { p_contact_id: string }
        Returns: Array<{
          event_id: string; event_type: string; properties: Json
          score_delta: number; occurred_at: string; anonymous_id: string
        }>
      }
      resolve_campaign_token: {
        Args: { p_workspace_id: string; p_agent_id: string; p_token: string; p_anonymous_id: string }
        Returns: string | null
      }
      generate_campaign_tokens: {
        Args: { p_agent_id: string; p_campaign_id: string; p_contact_ids: string[] }
        Returns: number
      }
      user_workspace_ids: {
        Args: Record<never, never>
        Returns: string[]
      }
      user_agent_ids: {
        Args: Record<never, never>
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

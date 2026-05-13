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
          stripe_customer_id: string | null; stripe_subscription_id: string | null
          subscription_status: string; current_period_end: string | null
        }
        Insert: {
          id?: string; name: string; slug: string; snippet_key?: string; plan?: string
          default_agent_id?: string | null; created_at?: string
          stripe_customer_id?: string | null; stripe_subscription_id?: string | null
          subscription_status?: string; current_period_end?: string | null
        }
        Update: {
          id?: string; name?: string; slug?: string; snippet_key?: string; plan?: string
          default_agent_id?: string | null; created_at?: string
          stripe_customer_id?: string | null; stripe_subscription_id?: string | null
          subscription_status?: string; current_period_end?: string | null
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
          last_completed_step: 'profile' | 'script' | 'contacts' | 'notify' | 'done' | null
          avatar_url: string | null
        }
        Insert: {
          id?: string; workspace_id?: string | null; user_id: string
          first_name?: string | null; last_name?: string | null
          email?: string | null; phone?: string | null
          rex_agent_id?: string | null; created_at?: string
          last_completed_step?: 'profile' | 'script' | 'contacts' | 'notify' | 'done' | null
          avatar_url?: string | null
        }
        Update: {
          id?: string; workspace_id?: string | null; user_id?: string
          first_name?: string | null; last_name?: string | null
          email?: string | null; phone?: string | null
          rex_agent_id?: string | null; created_at?: string
          last_completed_step?: 'profile' | 'script' | 'contacts' | 'notify' | 'done' | null
          avatar_url?: string | null
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
          brand_voice: string | null; email_signature: string | null
          website_url: string | null; market_positioning: string | null
          push_alert_mode: string; briefing_emails: string[]
          timezone: string; daily_briefing_hour: number
          created_at: string; updated_at: string
        }
        Insert: {
          agent_id: string; sms_enabled?: boolean; sms_threshold_score?: number
          agent_phone?: string | null; agent_email?: string | null
          scoring_config?: Json; weekly_briefing_day?: number
          brand_voice?: string | null; email_signature?: string | null
          website_url?: string | null; market_positioning?: string | null
          push_alert_mode?: string; briefing_emails?: string[]
          timezone?: string; daily_briefing_hour?: number
          created_at?: string; updated_at?: string
        }
        Update: {
          agent_id?: string; sms_enabled?: boolean; sms_threshold_score?: number
          agent_phone?: string | null; agent_email?: string | null
          scoring_config?: Json; weekly_briefing_day?: number
          brand_voice?: string | null; email_signature?: string | null
          website_url?: string | null; market_positioning?: string | null
          push_alert_mode?: string; briefing_emails?: string[]
          timezone?: string; daily_briefing_hour?: number
          created_at?: string; updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'agent_settings_agent_id_fkey'; columns: ['agent_id']; isOneToOne: true; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      contacts: {
        Row: {
          id: string; agent_id: string; email: string | null; phone: string | null
          first_name: string | null; last_name: string | null
          full_name_raw: string | null
          score: number
          source: 'portal' | 'crm' | 'website' | 'manual'
          medium: string | null
          crm_external_id: string | null
          ingestion_method:
            | 'csv_import' | 'crm_sync_rex' | 'crm_sync_agentbox' | 'crm_sync_vaultre'
            | 'manual' | 'identified_visitor' | 'form_submit' | 'portal_enquiry'
            | null
          identified_at: string | null; last_seen_at: string | null
          unsubscribed_at: string | null
          metadata: Json; created_at: string; updated_at: string
          deleted_at: string | null
          property_address: string | null; suburb: string | null; notes: string | null
          residence_property_id: string | null
          workspace_id: string | null
          owner_agent_id: string | null
          created_by_agent_id: string | null
        }
        Insert: {
          id?: string; agent_id: string; email?: string | null; phone?: string | null
          first_name?: string | null; last_name?: string | null
          full_name_raw?: string | null
          score?: number
          source?: 'portal' | 'crm' | 'website' | 'manual'
          medium?: string | null
          crm_external_id?: string | null
          ingestion_method?:
            | 'csv_import' | 'crm_sync_rex' | 'crm_sync_agentbox' | 'crm_sync_vaultre'
            | 'manual' | 'identified_visitor' | 'form_submit' | 'portal_enquiry'
            | null
          identified_at?: string | null; last_seen_at?: string | null
          unsubscribed_at?: string | null
          metadata?: Json; created_at?: string; updated_at?: string
          deleted_at?: string | null
          property_address?: string | null; suburb?: string | null; notes?: string | null
          residence_property_id?: string | null
          workspace_id?: string | null
          owner_agent_id?: string | null
          created_by_agent_id?: string | null
        }
        Update: {
          id?: string; agent_id?: string; email?: string | null; phone?: string | null
          first_name?: string | null; last_name?: string | null
          full_name_raw?: string | null
          score?: number
          source?: 'portal' | 'crm' | 'website' | 'manual'
          medium?: string | null
          crm_external_id?: string | null
          ingestion_method?:
            | 'csv_import' | 'crm_sync_rex' | 'crm_sync_agentbox' | 'crm_sync_vaultre'
            | 'manual' | 'identified_visitor' | 'form_submit' | 'portal_enquiry'
            | null
          identified_at?: string | null; last_seen_at?: string | null
          unsubscribed_at?: string | null
          metadata?: Json; created_at?: string; updated_at?: string
          deleted_at?: string | null
          property_address?: string | null; suburb?: string | null; notes?: string | null
          residence_property_id?: string | null
          workspace_id?: string | null
          owner_agent_id?: string | null
          created_by_agent_id?: string | null
        }
        Relationships: [
          { foreignKeyName: 'contacts_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'contacts_residence_property_id_fkey'; columns: ['residence_property_id']; isOneToOne: false; referencedRelation: 'properties'; referencedColumns: ['id'] }
        ]
      }
      properties: {
        Row: {
          id: string; workspace_id: string
          street_number: string | null; street_name: string
          suburb: string | null; state: string | null; postcode: string | null
          address_hash: string
          property_type: 'house' | 'unit' | 'townhouse' | 'land' | 'commercial' | 'unknown' | null
          status: 'listed' | 'under_offer' | 'sold' | 'withdrawn' | 'off_market' | 'residence_only' | 'unknown' | null
          listing_agent_id: string | null
          external_ids: Json
          first_seen_at: string; last_activity_at: string
          created_at: string; updated_at: string; deleted_at: string | null
        }
        Insert: {
          id?: string; workspace_id: string
          street_number?: string | null; street_name: string
          suburb?: string | null; state?: string | null; postcode?: string | null
          address_hash: string
          property_type?: 'house' | 'unit' | 'townhouse' | 'land' | 'commercial' | 'unknown' | null
          status?: 'listed' | 'under_offer' | 'sold' | 'withdrawn' | 'off_market' | 'residence_only' | 'unknown' | null
          listing_agent_id?: string | null
          external_ids?: Json
          first_seen_at?: string; last_activity_at?: string
          created_at?: string; updated_at?: string; deleted_at?: string | null
        }
        Update: {
          id?: string; workspace_id?: string
          street_number?: string | null; street_name?: string
          suburb?: string | null; state?: string | null; postcode?: string | null
          address_hash?: string
          property_type?: 'house' | 'unit' | 'townhouse' | 'land' | 'commercial' | 'unknown' | null
          status?: 'listed' | 'under_offer' | 'sold' | 'withdrawn' | 'off_market' | 'residence_only' | 'unknown' | null
          listing_agent_id?: string | null
          external_ids?: Json
          first_seen_at?: string; last_activity_at?: string
          created_at?: string; updated_at?: string; deleted_at?: string | null
        }
        Relationships: [
          { foreignKeyName: 'properties_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] },
          { foreignKeyName: 'properties_listing_agent_id_fkey'; columns: ['listing_agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      sessions: {
        Row: {
          id: string; workspace_id: string; anonymous_id: string
          tracker_session_id: string
          first_seen_at: string; last_seen_at: string; campaign_token: string | null
          utm_source: string | null; utm_medium: string | null; utm_campaign: string | null
          utm_content: string | null; referrer: string | null; ip_country: string | null; user_agent: string | null
        }
        Insert: {
          id?: string; workspace_id: string; anonymous_id: string
          tracker_session_id: string
          first_seen_at?: string; last_seen_at?: string; campaign_token?: string | null
          utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null
          utm_content?: string | null; referrer?: string | null; ip_country?: string | null; user_agent?: string | null
        }
        Update: {
          id?: string; workspace_id?: string; anonymous_id?: string
          tracker_session_id?: string
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
        Row: { id: string; agent_id: string; contact_id: string | null; type: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing' | 'email_daily_brief' | 'alert_threshold' | 'alert_form' | 'alert_return' | 'alert_score_threshold' | 'alert_form_submit' | 'alert_return_visit' | 'volume_review'; sent_at: string; title: string | null; body: string | null; url: string | null; read_at: string | null; workspace_id: string | null }
        Insert: { id?: string; agent_id: string; contact_id?: string | null; type: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing' | 'email_daily_brief' | 'alert_threshold' | 'alert_form' | 'alert_return' | 'alert_score_threshold' | 'alert_form_submit' | 'alert_return_visit' | 'volume_review'; sent_at?: string; title?: string | null; body?: string | null; url?: string | null; read_at?: string | null; workspace_id?: string | null }
        Update: { id?: string; agent_id?: string; contact_id?: string | null; type?: 'sms_threshold' | 'sms_form' | 'sms_return' | 'email_briefing' | 'email_daily_brief' | 'alert_threshold' | 'alert_form' | 'alert_return' | 'alert_score_threshold' | 'alert_form_submit' | 'alert_return_visit' | 'volume_review'; sent_at?: string; title?: string | null; body?: string | null; url?: string | null; read_at?: string | null; workspace_id?: string | null }
        Relationships: [
          { foreignKeyName: 'notification_log_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      push_subscriptions: {
        Row: { id: string; agent_id: string; endpoint: string; p256dh: string; auth: string; created_at: string }
        Insert: { id?: string; agent_id: string; endpoint: string; p256dh: string; auth: string; created_at?: string }
        Update: { id?: string; agent_id?: string; endpoint?: string; p256dh?: string; auth?: string; created_at?: string }
        Relationships: [
          { foreignKeyName: 'push_subscriptions_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      outreach_log: {
        Row: {
          id: string; agent_id: string; contact_id: string; campaign_id: string | null
          channel: 'email' | 'sms'; subject: string | null; message_preview: string | null
          external_id: string | null; source: 'mcp' | 'ui' | 'auto'; sent_at: string
        }
        Insert: {
          id?: string; agent_id: string; contact_id: string; campaign_id?: string | null
          channel: 'email' | 'sms'; subject?: string | null; message_preview?: string | null
          external_id?: string | null; source?: 'mcp' | 'ui' | 'auto'; sent_at?: string
        }
        Update: {
          id?: string; agent_id?: string; contact_id?: string; campaign_id?: string | null
          channel?: 'email' | 'sms'; subject?: string | null; message_preview?: string | null
          external_id?: string | null; source?: 'mcp' | 'ui' | 'auto'; sent_at?: string
        }
        Relationships: [
          { foreignKeyName: 'outreach_log_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'outreach_log_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      short_links: {
        Row: {
          id: string; agent_id: string; contact_id: string | null; campaign_id: string | null
          code: string; target_url: string
          click_count: number; last_clicked_at: string | null; created_at: string
        }
        Insert: {
          id?: string; agent_id: string; contact_id?: string | null; campaign_id?: string | null
          code: string; target_url: string
          click_count?: number; last_clicked_at?: string | null; created_at?: string
        }
        Update: {
          id?: string; agent_id?: string; contact_id?: string | null; campaign_id?: string | null
          code?: string; target_url?: string
          click_count?: number; last_clicked_at?: string | null; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'short_links_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      contact_notes: {
        Row: {
          id: string; agent_id: string; contact_id: string
          body: string; source: 'mcp' | 'ui' | 'import'; created_at: string
        }
        Insert: {
          id?: string; agent_id: string; contact_id: string
          body: string; source?: 'mcp' | 'ui' | 'import'; created_at?: string
        }
        Update: {
          id?: string; agent_id?: string; contact_id?: string
          body?: string; source?: 'mcp' | 'ui' | 'import'; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'contact_notes_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'contact_notes_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      workspace_api_tokens: {
        Row: {
          id: string; workspace_id: string; agent_id: string; user_id: string
          name: string; token_hash: string
          client_id: string | null; expires_at: string | null; scope: string | null
          last_used_at: string | null; revoked_at: string | null; created_at: string
        }
        Insert: {
          id?: string; workspace_id: string; agent_id: string; user_id: string
          name: string; token_hash: string
          client_id?: string | null; expires_at?: string | null; scope?: string | null
          last_used_at?: string | null; revoked_at?: string | null; created_at?: string
        }
        Update: {
          id?: string; workspace_id?: string; agent_id?: string; user_id?: string
          name?: string; token_hash?: string
          client_id?: string | null; expires_at?: string | null; scope?: string | null
          last_used_at?: string | null; revoked_at?: string | null; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'workspace_api_tokens_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] },
          { foreignKeyName: 'workspace_api_tokens_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      oauth_clients: {
        Row: {
          id: string; client_id: string; client_secret_hash: string | null
          client_name: string | null; redirect_uris: string[]; scope: string
          metadata: Json; created_at: string
        }
        Insert: {
          id?: string; client_id: string; client_secret_hash?: string | null
          client_name?: string | null; redirect_uris: string[]; scope?: string
          metadata?: Json; created_at?: string
        }
        Update: {
          id?: string; client_id?: string; client_secret_hash?: string | null
          client_name?: string | null; redirect_uris?: string[]; scope?: string
          metadata?: Json; created_at?: string
        }
        Relationships: []
      }
      oauth_authorization_codes: {
        Row: {
          id: string; code: string; client_id: string; user_id: string
          agent_id: string; workspace_id: string; redirect_uri: string
          code_challenge: string; code_challenge_method: 'S256'
          scope: string; expires_at: string; used_at: string | null; created_at: string
        }
        Insert: {
          id?: string; code: string; client_id: string; user_id: string
          agent_id: string; workspace_id: string; redirect_uri: string
          code_challenge: string; code_challenge_method?: 'S256'
          scope: string; expires_at: string; used_at?: string | null; created_at?: string
        }
        Update: {
          id?: string; code?: string; client_id?: string; user_id?: string
          agent_id?: string; workspace_id?: string; redirect_uri?: string
          code_challenge?: string; code_challenge_method?: 'S256'
          scope?: string; expires_at?: string; used_at?: string | null; created_at?: string
        }
        Relationships: []
      }
      identified_devices: {
        Row: {
          id: string; workspace_id: string; contact_id: string
          device_fingerprint: string | null; cookie_id: string
          first_identified_at: string; last_seen_at: string
          identification_method: 'email_link_click' | 'form_submit' | 'login' | 'manual_merge'
          identified_by_agent_id: string | null
          user_agent_summary: string | null; cookie_expires_at: string | null
          created_at: string; updated_at: string
        }
        Insert: {
          id?: string; workspace_id: string; contact_id: string
          device_fingerprint?: string | null; cookie_id: string
          first_identified_at?: string; last_seen_at?: string
          identification_method: 'email_link_click' | 'form_submit' | 'login' | 'manual_merge'
          identified_by_agent_id?: string | null
          user_agent_summary?: string | null; cookie_expires_at?: string | null
          created_at?: string; updated_at?: string
        }
        Update: {
          id?: string; workspace_id?: string; contact_id?: string
          device_fingerprint?: string | null; cookie_id?: string
          first_identified_at?: string; last_seen_at?: string
          identification_method?: 'email_link_click' | 'form_submit' | 'login' | 'manual_merge'
          identified_by_agent_id?: string | null
          user_agent_summary?: string | null; cookie_expires_at?: string | null
          created_at?: string; updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'identified_devices_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] },
          { foreignKeyName: 'identified_devices_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] },
          { foreignKeyName: 'identified_devices_identified_by_agent_id_fkey'; columns: ['identified_by_agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      contact_tracked_links: {
        Row: {
          id: string; workspace_id: string; agent_id: string; contact_id: string
          token: string; destination_url: string | null
          click_count: number; last_clicked_at: string | null; created_at: string
        }
        Insert: {
          id?: string; workspace_id: string; agent_id: string; contact_id: string
          token: string; destination_url?: string | null
          click_count?: number; last_clicked_at?: string | null; created_at?: string
        }
        Update: {
          id?: string; workspace_id?: string; agent_id?: string; contact_id?: string
          token?: string; destination_url?: string | null
          click_count?: number; last_clicked_at?: string | null; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'contact_tracked_links_workspace_id_fkey'; columns: ['workspace_id']; isOneToOne: false; referencedRelation: 'workspaces'; referencedColumns: ['id'] },
          { foreignKeyName: 'contact_tracked_links_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'contact_tracked_links_contact_id_fkey'; columns: ['contact_id']; isOneToOne: true; referencedRelation: 'contacts'; referencedColumns: ['id'] }
        ]
      }
      identity_stitch_history: {
        Row: {
          id: string; workspace_id: string; agent_id: string; anonymous_id: string
          prev_contact_id: string | null; new_contact_id: string
          stitch_method: string; stitched_at: string
        }
        Insert: {
          id?: string; workspace_id: string; agent_id: string; anonymous_id: string
          prev_contact_id?: string | null; new_contact_id: string
          stitch_method: string; stitched_at?: string
        }
        Update: {
          id?: string; workspace_id?: string; agent_id?: string; anonymous_id?: string
          prev_contact_id?: string | null; new_contact_id?: string
          stitch_method?: string; stitched_at?: string
        }
        Relationships: []
      }
      agent_inbound_addresses: {
        Row: {
          id: string; agent_id: string; local_part: string
          is_active: boolean; created_at: string
        }
        Insert: {
          id?: string; agent_id: string; local_part: string
          is_active?: boolean; created_at?: string
        }
        Update: {
          id?: string; agent_id?: string; local_part?: string
          is_active?: boolean; created_at?: string
        }
        Relationships: [
          { foreignKeyName: 'agent_inbound_addresses_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      inbound_emails: {
        Row: {
          id: string; agent_id: string | null; received_at: string
          source_portal: string | null; message_id: string | null
          webhook_payload: Json; fetched_payload: Json | null
          parse_status: 'pending_body' | 'parsed' | 'parse_failed' | 'no_match'
          parse_error: string | null
        }
        Insert: {
          id?: string; agent_id?: string | null; received_at?: string
          source_portal?: string | null; message_id?: string | null
          webhook_payload: Json; fetched_payload?: Json | null
          parse_status?: 'pending_body' | 'parsed' | 'parse_failed' | 'no_match'
          parse_error?: string | null
        }
        Update: {
          id?: string; agent_id?: string | null; received_at?: string
          source_portal?: string | null; message_id?: string | null
          webhook_payload?: Json; fetched_payload?: Json | null
          parse_status?: 'pending_body' | 'parsed' | 'parse_failed' | 'no_match'
          parse_error?: string | null
        }
        Relationships: [
          { foreignKeyName: 'inbound_emails_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] }
        ]
      }
      enquiries: {
        Row: {
          id: string; inbound_email_id: string; agent_id: string; contact_id: string | null
          listing_external_id: string | null; listing_address: string | null
          listing_url: string | null; listing_agent_name: string | null
          enquirer_name: string | null; enquirer_email: string | null; enquirer_phone: string | null
          message: string | null; intent: string | null; requested_actions: string[]
          parsed_at: string
        }
        Insert: {
          id?: string; inbound_email_id: string; agent_id: string; contact_id?: string | null
          listing_external_id?: string | null; listing_address?: string | null
          listing_url?: string | null; listing_agent_name?: string | null
          enquirer_name?: string | null; enquirer_email?: string | null; enquirer_phone?: string | null
          message?: string | null; intent?: string | null; requested_actions?: string[]
          parsed_at?: string
        }
        Update: {
          id?: string; inbound_email_id?: string; agent_id?: string; contact_id?: string | null
          listing_external_id?: string | null; listing_address?: string | null
          listing_url?: string | null; listing_agent_name?: string | null
          enquirer_name?: string | null; enquirer_email?: string | null; enquirer_phone?: string | null
          message?: string | null; intent?: string | null; requested_actions?: string[]
          parsed_at?: string
        }
        Relationships: [
          { foreignKeyName: 'enquiries_inbound_email_id_fkey'; columns: ['inbound_email_id']; isOneToOne: true; referencedRelation: 'inbound_emails'; referencedColumns: ['id'] },
          { foreignKeyName: 'enquiries_agent_id_fkey'; columns: ['agent_id']; isOneToOne: false; referencedRelation: 'agents'; referencedColumns: ['id'] },
          { foreignKeyName: 'enquiries_contact_id_fkey'; columns: ['contact_id']; isOneToOne: false; referencedRelation: 'contacts'; referencedColumns: ['id'] }
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
      get_daily_briefing_data: {
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
      get_contacts_list: {
        Args: { p_agent_id: string }
        Returns: Array<{
          id: string; first_name: string | null; last_name: string | null
          email: string | null; phone: string | null; score: number
          score_change_7d: number; last_seen_at: string | null
          property_address: string | null; suburb: string | null
          source: string; medium: string | null; session_count: number
          last_event_type: string | null; last_page_title: string | null
          tracked_link_token: string | null
          tracked_link_last_clicked_at: string | null
          tracked_link_destination_url: string | null
          is_stitched: boolean
        }>
      }
      resolve_campaign_token: {
        Args: { p_workspace_id: string; p_agent_id: string; p_token: string; p_anonymous_id: string }
        Returns: string | null
      }
      resolve_contact_link_click: {
        Args: { p_token: string }
        Returns: Array<{
          contact_id: string
          agent_id: string
          workspace_id: string
          destination_url: string | null
          default_url: string | null
        }>
      }
      stitch_contact_from_token: {
        Args: {
          p_token: string
          p_workspace_id: string
          p_anonymous_id: string
          p_user_agent?: string | null
        }
        Returns: string | null
      }
      resolve_residence_property: {
        Args: {
          p_workspace_id: string
          p_street_number?: string | null
          p_street_name?: string | null
          p_suburb?: string | null
          p_state?: string | null
          p_postcode?: string | null
          p_raw?: string | null
        }
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
      resolve_api_token: {
        Args: { p_token_hash: string }
        Returns: Array<{ workspace_id: string; agent_id: string }>
      }
      click_short_link: {
        Args: { p_code: string }
        Returns: Array<{
          agent_id: string
          contact_id: string | null
          campaign_id: string | null
          target_url: string
        }>
      }
      consume_oauth_code: {
        Args: { p_code: string }
        Returns: Array<{
          client_id: string
          user_id: string
          agent_id: string
          workspace_id: string
          redirect_uri: string
          code_challenge: string
          code_challenge_method: string
          scope: string
        }>
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

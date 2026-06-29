export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_notifications: {
        Row: {
          body: string | null
          created_at: string
          deep_link: string | null
          id: string
          kind: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          deep_link?: string | null
          id?: string
          kind: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          deep_link?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      ban_signals: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          signal_type: string
          signal_value: string
          source_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          signal_type: string
          signal_value: string
          source_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          signal_type?: string
          signal_value?: string
          source_user_id?: string | null
        }
        Relationships: []
      }
      bans: {
        Row: {
          banned_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          reason: string
          type: Database["public"]["Enums"]["ban_type"]
          user_id: string
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          reason: string
          type?: Database["public"]["Enums"]["ban_type"]
          user_id: string
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          reason?: string
          type?: Database["public"]["Enums"]["ban_type"]
          user_id?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      call_invites: {
        Row: {
          accepted_at: string | null
          call_log_id: string | null
          callee_id: string
          caller_id: string
          cancelled_at: string | null
          client_attempt_id: string | null
          created_at: string
          delivered_at: string | null
          expires_at: string
          id: string
          kind: string
          rejected_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          call_log_id?: string | null
          callee_id: string
          caller_id: string
          cancelled_at?: string | null
          client_attempt_id?: string | null
          created_at?: string
          delivered_at?: string | null
          expires_at?: string
          id?: string
          kind: string
          rejected_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          call_log_id?: string | null
          callee_id?: string
          caller_id?: string
          cancelled_at?: string | null
          client_attempt_id?: string | null
          created_at?: string
          delivered_at?: string | null
          expires_at?: string
          id?: string
          kind?: string
          rejected_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_invites_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_invites_callee_id_fkey"
            columns: ["callee_id"]
            isOneToOne: false
            referencedRelation: "creator_earnings_30d"
            referencedColumns: ["creator_id"]
          },
          {
            foreignKeyName: "call_invites_callee_id_fkey"
            columns: ["callee_id"]
            isOneToOne: false
            referencedRelation: "creator_leaderboard_7d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "call_invites_callee_id_fkey"
            columns: ["callee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_invites_callee_id_fkey"
            columns: ["callee_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_invites_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "creator_earnings_30d"
            referencedColumns: ["creator_id"]
          },
          {
            foreignKeyName: "call_invites_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "creator_leaderboard_7d"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "call_invites_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_invites_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          callee_id: string
          caller_id: string
          channel_name: string | null
          coins_spent: number
          created_at: string
          credential_id: string | null
          disconnects: number
          duration_seconds: number
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          failover_chain: Json | null
          free_seconds_used: number
          id: string
          kind: string
          last_flushed_at: string | null
          missed_reason: string | null
          provider: string | null
          quality_avg: number | null
          started_at: string
          status: string
        }
        Insert: {
          callee_id: string
          caller_id: string
          channel_name?: string | null
          coins_spent?: number
          created_at?: string
          credential_id?: string | null
          disconnects?: number
          duration_seconds?: number
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          failover_chain?: Json | null
          free_seconds_used?: number
          id?: string
          kind: string
          last_flushed_at?: string | null
          missed_reason?: string | null
          provider?: string | null
          quality_avg?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          callee_id?: string
          caller_id?: string
          channel_name?: string | null
          coins_spent?: number
          created_at?: string
          credential_id?: string | null
          disconnects?: number
          duration_seconds?: number
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          failover_chain?: Json | null
          free_seconds_used?: number
          id?: string
          kind?: string
          last_flushed_at?: string | null
          missed_reason?: string | null
          provider?: string | null
          quality_avg?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "calling_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      call_usage_flushes: {
        Row: {
          applied_coins_delta: number
          applied_free_delta: number
          call_log_id: string
          created_at: string
          elapsed_seconds: number
          id: string
          idempotency_key: string
          total_coins: number
          total_free_seconds: number
        }
        Insert: {
          applied_coins_delta?: number
          applied_free_delta?: number
          call_log_id: string
          created_at?: string
          elapsed_seconds?: number
          id?: string
          idempotency_key: string
          total_coins?: number
          total_free_seconds?: number
        }
        Update: {
          applied_coins_delta?: number
          applied_free_delta?: number
          call_log_id?: string
          created_at?: string
          elapsed_seconds?: number
          id?: string
          idempotency_key?: string
          total_coins?: number
          total_free_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_usage_flushes_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      calling_credentials: {
        Row: {
          consecutive_failures: number
          created_at: string
          credentials: Json
          id: string
          is_active: boolean
          label: string
          last_error: string | null
          last_error_at: string | null
          last_used_at: string | null
          minutes_used_current_month: number
          monthly_quota_minutes: number | null
          priority: number
          provider: string
          quota_reset_at: string
          status: string
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          label: string
          last_error?: string | null
          last_error_at?: string | null
          last_used_at?: string | null
          minutes_used_current_month?: number
          monthly_quota_minutes?: number | null
          priority?: number
          provider: string
          quota_reset_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          label?: string
          last_error?: string | null
          last_error_at?: string | null
          last_used_at?: string | null
          minutes_used_current_month?: number
          monthly_quota_minutes?: number | null
          priority?: number
          provider?: string
          quota_reset_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      case_guesses: {
        Row: {
          case_id: string
          created_at: string
          guessed_person_id: string
          id: string
          is_correct: boolean
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          guessed_person_id: string
          id?: string
          is_correct: boolean
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          guessed_person_id?: string
          id?: string
          is_correct?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_guesses_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "mystery_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          coins_spent: number
          conversation_id: string
          ended_at: string | null
          free_seconds_used: number
          id: string
          is_active: boolean
          last_tick_at: string
          seconds_billed: number
          started_at: string
          user_id: string
        }
        Insert: {
          coins_spent?: number
          conversation_id: string
          ended_at?: string | null
          free_seconds_used?: number
          id?: string
          is_active?: boolean
          last_tick_at?: string
          seconds_billed?: number
          started_at?: string
          user_id: string
        }
        Update: {
          coins_spent?: number
          conversation_id?: string
          ended_at?: string | null
          free_seconds_used?: number
          id?: string
          is_active?: boolean
          last_tick_at?: string
          seconds_billed?: number
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_plans: {
        Row: {
          coins: number
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          price_inr: number
          sort_order: number
        }
        Insert: {
          coins: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          price_inr: number
          sort_order?: number
        }
        Update: {
          coins?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          price_inr?: number
          sort_order?: number
        }
        Relationships: []
      }
      community_guidelines_acceptance: {
        Row: {
          accepted_at: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          user_id: string
          version?: string
        }
        Update: {
          accepted_at?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      creator_availability: {
        Row: {
          accepting_calls: boolean
          slots: Json
          tz: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accepting_calls?: boolean
          slots?: Json
          tz?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accepting_calls?: boolean
          slots?: Json
          tz?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      csam_reports: {
        Row: {
          call_log_id: string | null
          case_ref: string | null
          created_at: string
          escalated_at: string | null
          evidence_hash: string | null
          id: string
          narrative: string
          reported_by_admin: string
          status: string
          target_user_id: string
        }
        Insert: {
          call_log_id?: string | null
          case_ref?: string | null
          created_at?: string
          escalated_at?: string | null
          evidence_hash?: string | null
          id?: string
          narrative: string
          reported_by_admin: string
          status?: string
          target_user_id: string
        }
        Update: {
          call_log_id?: string | null
          case_ref?: string | null
          created_at?: string
          escalated_at?: string | null
          evidence_hash?: string | null
          id?: string
          narrative?: string
          reported_by_admin?: string
          status?: string
          target_user_id?: string
        }
        Relationships: []
      }
      daily_checkins: {
        Row: {
          checkin_date: string
          coins_awarded: number
          created_at: string
          day_index: number
          id: string
          user_id: string
        }
        Insert: {
          checkin_date: string
          coins_awarded: number
          created_at?: string
          day_index: number
          id?: string
          user_id: string
        }
        Update: {
          checkin_date?: string
          coins_awarded?: number
          created_at?: string
          day_index?: number
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      fan_club_members: {
        Row: {
          coins_paid: number
          creator_id: string
          expires_at: string
          fan_id: string
          joined_at: string
        }
        Insert: {
          coins_paid: number
          creator_id: string
          expires_at: string
          fan_id: string
          joined_at?: string
        }
        Update: {
          coins_paid?: number
          creator_id?: string
          expires_at?: string
          fan_id?: string
          joined_at?: string
        }
        Relationships: []
      }
      fan_clubs: {
        Row: {
          created_at: string
          creator_id: string
          is_open: boolean
          monthly_coins: number
          name: string
          perks: Json
          tagline: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          is_open?: boolean
          monthly_coins?: number
          name?: string
          perks?: Json
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          is_open?: boolean
          monthly_coins?: number
          name?: string
          perks?: Json
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
          status: Database["public"]["Enums"]["follow_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
          status?: Database["public"]["Enums"]["follow_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
          status?: Database["public"]["Enums"]["follow_status"]
          updated_at?: string
        }
        Relationships: []
      }
      gift_sends: {
        Row: {
          call_log_id: string | null
          coins_spent: number
          created_at: string
          gift_id: string
          id: string
          receiver_id: string
          sender_id: string
        }
        Insert: {
          call_log_id?: string | null
          coins_spent: number
          created_at?: string
          gift_id: string
          id?: string
          receiver_id: string
          sender_id: string
        }
        Update: {
          call_log_id?: string | null
          coins_spent?: number
          created_at?: string
          gift_id?: string
          id?: string
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_sends_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_sends_gift_id_fkey"
            columns: ["gift_id"]
            isOneToOne: false
            referencedRelation: "gifts"
            referencedColumns: ["id"]
          },
        ]
      }
      gifts: {
        Row: {
          code: string
          coin_cost: number
          created_at: string
          emoji: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          coin_cost: number
          created_at?: string
          emoji: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          coin_cost?: number
          created_at?: string
          emoji?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      kyc_doc_purge_log: {
        Row: {
          cron_run_id: string
          deleted_at: string
          doc_kind: string
          error_message: string | null
          id: string
          kyc_request_id: string
          kyc_status: string
          storage_path: string
          success: boolean
          user_id: string
        }
        Insert: {
          cron_run_id: string
          deleted_at?: string
          doc_kind: string
          error_message?: string | null
          id?: string
          kyc_request_id: string
          kyc_status: string
          storage_path: string
          success?: boolean
          user_id: string
        }
        Update: {
          cron_run_id?: string
          deleted_at?: string
          doc_kind?: string
          error_message?: string | null
          id?: string
          kyc_request_id?: string
          kyc_status?: string
          storage_path?: string
          success?: boolean
          user_id?: string
        }
        Relationships: []
      }
      kyc_requests: {
        Row: {
          aadhaar_back_path: string
          aadhaar_front_path: string
          aadhaar_last4: string
          bank_account_name: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          created_at: string
          dob: string
          docs_deleted_at: string | null
          docs_retention_until: string | null
          full_name: string
          id: string
          pan_doc_path: string
          pan_number: string
          payout_method: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_path: string
          status: string
          updated_at: string
          upi_id: string | null
          user_id: string
        }
        Insert: {
          aadhaar_back_path: string
          aadhaar_front_path: string
          aadhaar_last4: string
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          created_at?: string
          dob: string
          docs_deleted_at?: string | null
          docs_retention_until?: string | null
          full_name: string
          id?: string
          pan_doc_path: string
          pan_number: string
          payout_method: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path: string
          status?: string
          updated_at?: string
          upi_id?: string | null
          user_id: string
        }
        Update: {
          aadhaar_back_path?: string
          aadhaar_front_path?: string
          aadhaar_last4?: string
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          created_at?: string
          dob?: string
          docs_deleted_at?: string | null
          docs_retention_until?: string | null
          full_name?: string
          id?: string
          pan_doc_path?: string
          pan_number?: string
          payout_method?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path?: string
          status?: string
          updated_at?: string
          upi_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      matchmaker_candidates: {
        Row: {
          gift_score: number
          id: string
          joined_at: string
          room_id: string
          seat: number
          user_id: string
          vote_score: number
        }
        Insert: {
          gift_score?: number
          id?: string
          joined_at?: string
          room_id: string
          seat: number
          user_id: string
          vote_score?: number
        }
        Update: {
          gift_score?: number
          id?: string
          joined_at?: string
          room_id?: string
          seat?: number
          user_id?: string
          vote_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "matchmaker_candidates_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "matchmaker_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      matchmaker_rooms: {
        Row: {
          agora_channel: string
          candidate_count: number
          created_at: string
          ended_at: string | null
          host_id: string
          id: string
          listener_count: number
          started_at: string
          status: string
          title: string
          topic: string | null
          winner_user_id: string | null
        }
        Insert: {
          agora_channel: string
          candidate_count?: number
          created_at?: string
          ended_at?: string | null
          host_id: string
          id?: string
          listener_count?: number
          started_at?: string
          status?: string
          title: string
          topic?: string | null
          winner_user_id?: string | null
        }
        Update: {
          agora_channel?: string
          candidate_count?: number
          created_at?: string
          ended_at?: string | null
          host_id?: string
          id?: string
          listener_count?: number
          started_at?: string
          status?: string
          title?: string
          topic?: string | null
          winner_user_id?: string | null
        }
        Relationships: []
      }
      matchmaker_votes: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          room_id: string
          voter_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          room_id: string
          voter_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          room_id?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matchmaker_votes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "matchmaker_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchmaker_votes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "matchmaker_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          is_deleted: boolean
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_events: {
        Row: {
          ai_label: string | null
          ai_model: string | null
          ai_score: number | null
          call_log_id: string | null
          category: string
          created_at: string
          evidence: Json
          id: string
          kind: string
          reporter_user_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: number
          status: string
          user_id: string
        }
        Insert: {
          ai_label?: string | null
          ai_model?: string | null
          ai_score?: number | null
          call_log_id?: string | null
          category: string
          created_at?: string
          evidence?: Json
          id?: string
          kind: string
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity: number
          status?: string
          user_id: string
        }
        Update: {
          ai_label?: string | null
          ai_model?: string | null
          ai_score?: number | null
          call_log_id?: string | null
          category?: string
          created_at?: string
          evidence?: Json
          id?: string
          kind?: string
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      mystery_cases: {
        Row: {
          brief: string
          call_log_id: string | null
          coins_spent: number
          created_at: string
          created_by: string
          culprit_id: string
          evidence: Json
          id: string
          partner_id: string
          persons: Json
          setting: string | null
          solution_explanation: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          brief: string
          call_log_id?: string | null
          coins_spent?: number
          created_at?: string
          created_by: string
          culprit_id: string
          evidence?: Json
          id?: string
          partner_id: string
          persons?: Json
          setting?: string | null
          solution_explanation: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          brief?: string
          call_log_id?: string | null
          coins_spent?: number
          created_at?: string
          created_by?: string
          culprit_id?: string
          evidence?: Json
          id?: string
          partner_id?: string
          persons?: Json
          setting?: string | null
          solution_explanation?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mystery_cases_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          calls: boolean
          chat: boolean
          follows: boolean
          gifts: boolean
          marketing: boolean
          system: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          calls?: boolean
          chat?: boolean
          follows?: boolean
          gifts?: boolean
          marketing?: boolean
          system?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          calls?: boolean
          chat?: boolean
          follows?: boolean
          gifts?: boolean
          marketing?: boolean
          system?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      perf_events: {
        Row: {
          created_at: string
          duration_ms: number | null
          event_type: string
          id: number
          label: string | null
          meta: Json | null
          ok: boolean | null
          route: string | null
          status: number | null
          trace_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          event_type: string
          id?: number
          label?: string | null
          meta?: Json | null
          ok?: boolean | null
          route?: string | null
          status?: number | null
          trace_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          event_type?: string
          id?: number
          label?: string | null
          meta?: Json | null
          ok?: boolean | null
          route?: string | null
          status?: number | null
          trace_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_avatar_style: string | null
          availability: string
          avatar_path: string | null
          avatar_url: string | null
          ban_reason: string | null
          bio: string | null
          blocked_countries: string[]
          blocked_states: string[]
          country: string | null
          created_at: string
          deleted_at: string | null
          device_fp: string | null
          dob: string | null
          free_seconds_remaining: number
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
          ip_hash: string | null
          is_banned: boolean
          is_creator: boolean
          language: string | null
          last_checkin_date: string | null
          last_seen_at: string | null
          onboarded: boolean
          push_platform: string | null
          push_token: string | null
          referral_code: string | null
          referred_by: string | null
          state: string | null
          streak_days: number
          strike_count: number
          updated_at: string
          username: string | null
        }
        Insert: {
          ai_avatar_style?: string | null
          availability?: string
          avatar_path?: string | null
          avatar_url?: string | null
          ban_reason?: string | null
          bio?: string | null
          blocked_countries?: string[]
          blocked_states?: string[]
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          device_fp?: string | null
          dob?: string | null
          free_seconds_remaining?: number
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id: string
          ip_hash?: string | null
          is_banned?: boolean
          is_creator?: boolean
          language?: string | null
          last_checkin_date?: string | null
          last_seen_at?: string | null
          onboarded?: boolean
          push_platform?: string | null
          push_token?: string | null
          referral_code?: string | null
          referred_by?: string | null
          state?: string | null
          streak_days?: number
          strike_count?: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          ai_avatar_style?: string | null
          availability?: string
          avatar_path?: string | null
          avatar_url?: string | null
          ban_reason?: string | null
          bio?: string | null
          blocked_countries?: string[]
          blocked_states?: string[]
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          device_fp?: string | null
          dob?: string | null
          free_seconds_remaining?: number
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          ip_hash?: string | null
          is_banned?: boolean
          is_creator?: boolean
          language?: string | null
          last_checkin_date?: string | null
          last_seen_at?: string | null
          onboarded?: boolean
          push_platform?: string | null
          push_token?: string | null
          referral_code?: string | null
          referred_by?: string | null
          state?: string | null
          streak_days?: number
          strike_count?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      push_broadcasts: {
        Row: {
          audience: string
          body: string | null
          created_at: string
          deep_link: string | null
          id: string
          push_sent_count: number
          recipients_count: number
          sender_id: string
          title: string
        }
        Insert: {
          audience?: string
          body?: string | null
          created_at?: string
          deep_link?: string | null
          id?: string
          push_sent_count?: number
          recipients_count?: number
          sender_id: string
          title: string
        }
        Update: {
          audience?: string
          body?: string | null
          created_at?: string
          deep_link?: string | null
          id?: string
          push_sent_count?: number
          recipients_count?: number
          sender_id?: string
          title?: string
        }
        Relationships: []
      }
      razorpay_orders: {
        Row: {
          amount_paise: number
          bonus_credited: number | null
          coins_credited: number | null
          created_at: string
          credited_at: string | null
          currency: string
          id: string
          notes: Json | null
          paid_at: string | null
          plan_id: string
          razorpay_order_id: string
          razorpay_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
          webhook_payload: Json | null
        }
        Insert: {
          amount_paise: number
          bonus_credited?: number | null
          coins_credited?: number | null
          created_at?: string
          credited_at?: string | null
          currency?: string
          id?: string
          notes?: Json | null
          paid_at?: string | null
          plan_id: string
          razorpay_order_id: string
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          webhook_payload?: Json | null
        }
        Update: {
          amount_paise?: number
          bonus_credited?: number | null
          coins_credited?: number | null
          created_at?: string
          credited_at?: string | null
          currency?: string
          id?: string
          notes?: Json | null
          paid_at?: string | null
          plan_id?: string
          razorpay_order_id?: string
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          webhook_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "razorpay_orders_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "coin_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          code_used: string
          created_at: string
          first_recharge_at: string | null
          id: string
          recharge_bonus_coins: number
          referee_id: string
          referrer_id: string
          signup_bonus_coins: number
        }
        Insert: {
          code_used: string
          created_at?: string
          first_recharge_at?: string | null
          id?: string
          recharge_bonus_coins?: number
          referee_id: string
          referrer_id: string
          signup_bonus_coins?: number
        }
        Update: {
          code_used?: string
          created_at?: string
          first_recharge_at?: string | null
          id?: string
          recharge_bonus_coins?: number
          referee_id?: string
          referrer_id?: string
          signup_bonus_coins?: number
        }
        Relationships: []
      }
      reports: {
        Row: {
          admin_notes: string | null
          context: string | null
          conversation_id: string | null
          created_at: string
          id: string
          message_excerpt: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          reviewed_at: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_user_id: string
        }
        Insert: {
          admin_notes?: string | null
          context?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_excerpt?: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_user_id: string
        }
        Update: {
          admin_notes?: string | null
          context?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_excerpt?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      room_participants: {
        Row: {
          id: string
          joined_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          cover_url: string | null
          created_at: string
          gender_gate: string
          host_id: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["room_kind"]
          max_seats: number
          title: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          gender_gate?: string
          host_id: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["room_kind"]
          max_seats?: number
          title: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          gender_gate?: string
          host_id?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["room_kind"]
          max_seats?: number
          title?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          coins_delta: number
          created_at: string
          id: string
          inr_amount: number | null
          metadata: Json
          plan_id: string | null
          type: Database["public"]["Enums"]["txn_type"]
          user_id: string
        }
        Insert: {
          coins_delta: number
          created_at?: string
          id?: string
          inr_amount?: number | null
          metadata?: Json
          plan_id?: string | null
          type: Database["public"]["Enums"]["txn_type"]
          user_id: string
        }
        Update: {
          coins_delta?: number
          created_at?: string
          id?: string
          inr_amount?: number | null
          metadata?: Json
          plan_id?: string | null
          type?: Database["public"]["Enums"]["txn_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "coin_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          coin_balance: number
          deposit_count: number
          earned_coins: number
          total_recharged_inr: number
          updated_at: string
          user_id: string
        }
        Insert: {
          coin_balance?: number
          deposit_count?: number
          earned_coins?: number
          total_recharged_inr?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          coin_balance?: number
          deposit_count?: number
          earned_coins?: number
          total_recharged_inr?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          admin_notes: string | null
          coins: number
          created_at: string
          id: string
          inr_amount: number
          payout_method: string
          payout_snapshot: Json
          processed_at: string | null
          processed_by: string | null
          status: string
          updated_at: string
          user_id: string
          utr_reference: string | null
        }
        Insert: {
          admin_notes?: string | null
          coins: number
          created_at?: string
          id?: string
          inr_amount: number
          payout_method: string
          payout_snapshot: Json
          processed_at?: string | null
          processed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
          utr_reference?: string | null
        }
        Update: {
          admin_notes?: string | null
          coins?: number
          created_at?: string
          id?: string
          inr_amount?: number
          payout_method?: string
          payout_snapshot?: Json
          processed_at?: string | null
          processed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          utr_reference?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      creator_earnings_30d: {
        Row: {
          call_count_30d: number | null
          call_seconds_30d: number | null
          creator_id: string | null
          fan_club_coins_30d: number | null
          fan_club_signups_30d: number | null
          gift_coins_30d: number | null
          gift_count_30d: number | null
          total_coins_30d: number | null
          unique_senders_30d: number | null
        }
        Relationships: []
      }
      creator_earnings_daily: {
        Row: {
          coins: number | null
          creator_id: string | null
          day: string | null
        }
        Relationships: []
      }
      creator_leaderboard_7d: {
        Row: {
          avatar_url: string | null
          coins_received: number | null
          country: string | null
          gifts_count: number | null
          is_creator: boolean | null
          language: string | null
          user_id: string | null
          username: string | null
        }
        Relationships: []
      }
      profiles_public: {
        Row: {
          ai_avatar_style: string | null
          availability: string | null
          avatar_path: string | null
          avatar_url: string | null
          bio: string | null
          country: string | null
          created_at: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string | null
          is_creator: boolean | null
          language: string | null
          last_seen_at: string | null
          referral_code: string | null
          state: string | null
          username: string | null
        }
        Insert: {
          ai_avatar_style?: string | null
          availability?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string | null
          is_creator?: boolean | null
          language?: string | null
          last_seen_at?: string | null
          referral_code?: string | null
          state?: string | null
          username?: string | null
        }
        Update: {
          ai_avatar_style?: string | null
          availability?: string | null
          avatar_path?: string | null
          avatar_url?: string | null
          bio?: string | null
          country?: string | null
          created_at?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string | null
          is_creator?: boolean | null
          language?: string | null
          last_seen_at?: string | null
          referral_code?: string | null
          state?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_credential_minutes: {
        Args: { _id: string; _minutes: number }
        Returns: undefined
      }
      credit_razorpay_payment: {
        Args: { _order_id: string; _payload: Json; _payment_id: string }
        Returns: Json
      }
      generate_referral_code: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_signal_banned: {
        Args: { _type: string; _value: string }
        Returns: boolean
      }
      pick_calling_credential: {
        Args: { _provider?: string }
        Returns: {
          consecutive_failures: number
          created_at: string
          credentials: Json
          id: string
          is_active: boolean
          label: string
          last_error: string | null
          last_error_at: string | null
          last_used_at: string | null
          minutes_used_current_month: number
          monthly_quota_minutes: number | null
          priority: number
          provider: string
          quota_reset_at: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calling_credentials"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      purge_old_perf_events: { Args: never; Returns: number }
      report_credential_failure: {
        Args: { _error: string; _id: string }
        Returns: undefined
      }
      report_credential_success: { Args: { _id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "creator"
      ban_type: "temp" | "perm"
      follow_status: "pending" | "accepted"
      gender_type: "male" | "female" | "other"
      report_reason:
        | "harassment"
        | "nudity"
        | "fake_profile"
        | "spam"
        | "threat"
        | "violence"
        | "scam"
        | "underage"
        | "other"
      report_status: "open" | "reviewed" | "actioned" | "dismissed"
      room_kind: "voice" | "video" | "game" | "live"
      txn_type:
        | "recharge"
        | "bonus"
        | "chat_spend"
        | "refund"
        | "signup_bonus"
        | "gift_spend"
        | "gift_received"
        | "withdrawal_hold"
        | "withdrawal_refund"
        | "withdrawal_paid"
        | "daily_checkin"
        | "referral_bonus"
        | "fan_club_spend"
        | "fan_club_income"
        | "admin_credit"
        | "admin_debit"
        | "call_earning"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "creator"],
      ban_type: ["temp", "perm"],
      follow_status: ["pending", "accepted"],
      gender_type: ["male", "female", "other"],
      report_reason: [
        "harassment",
        "nudity",
        "fake_profile",
        "spam",
        "threat",
        "violence",
        "scam",
        "underage",
        "other",
      ],
      report_status: ["open", "reviewed", "actioned", "dismissed"],
      room_kind: ["voice", "video", "game", "live"],
      txn_type: [
        "recharge",
        "bonus",
        "chat_spend",
        "refund",
        "signup_bonus",
        "gift_spend",
        "gift_received",
        "withdrawal_hold",
        "withdrawal_refund",
        "withdrawal_paid",
        "daily_checkin",
        "referral_bonus",
        "fan_club_spend",
        "fan_club_income",
        "admin_credit",
        "admin_debit",
        "call_earning",
      ],
    },
  },
} as const

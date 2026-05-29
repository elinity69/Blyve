export interface User {
  id: string;
  name: string;
  bio?: string;
  avatar_url?: string;
  images?: string[];
  verified?: boolean;
  email?: string;
  createdAt?: string;
  gender?: 'male' | 'female' | 'diverse';
  onboarding_complete?: boolean;
  username?: string;
  display_name?: string;
  pronouns?: string;
  dark_mode?: boolean;
  theme_mode?: 'light' | 'dark' | 'oled';
  ghost_mode?: boolean;
}

// Supabase Database Definitions (manually maintained; subset used by the app)
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          name: string | null;
          display_name: string | null;
          username: string | null;
          bio: string | null;
          pronouns: string | null;
          gender: 'male' | 'female' | 'diverse' | null;
          avatar_url: string | null;
          images: string[] | null;
          verified: boolean | null;
          ghost_mode: boolean | null;
          dark_mode: boolean | null;
          theme_mode: string | null;
          onboarding_complete: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          email?: string | null;
          name?: string | null;
          display_name?: string | null;
          username?: string | null;
          bio?: string | null;
          pronouns?: string | null;
          gender?: 'male' | 'female' | 'diverse' | null;
          avatar_url?: string | null;
          images?: string[] | null;
          verified?: boolean | null;
          ghost_mode?: boolean | null;
          dark_mode?: boolean | null;
          theme_mode?: string | null;
          onboarding_complete?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string | null;
          name?: string | null;
          display_name?: string | null;
          username?: string | null;
          bio?: string | null;
          pronouns?: string | null;
          gender?: 'male' | 'female' | 'diverse' | null;
          avatar_url?: string | null;
          images?: string[] | null;
          verified?: boolean | null;
          ghost_mode?: boolean | null;
          dark_mode?: boolean | null;
          theme_mode?: string | null;
          onboarding_complete?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_id: string;
          reason: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          reported_id: string;
          reason: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          reported_id?: string;
          reason?: string;
          created_at?: string;
        };
      };
    };
    Functions: {
      get_user_count: {
        Args: Record<string, never>;
        Returns: number;
      };
      delete_user: {
        Args: Record<string, never>;
        Returns: void;
      };
      send_message_safe: {
        Args: {
          p_conversation_id: string;
          p_content: string;
          p_reply_to_message_id?: string | null;
          p_attachment_ids?: string[] | null;
        };
        Returns: unknown;
      };
      block_user_safe: {
        Args: { target_id: string };
        Returns: unknown;
      };
    };
  };
};

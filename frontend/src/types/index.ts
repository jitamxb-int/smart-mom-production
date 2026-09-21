export interface TranscriptSegment {
  speaker: string;
  speaker_name: string;  // Optional display name for the speaker
  start:   number;
  end:     number;
  text:    string;
}

export interface TranscriptData {
  text:       string;  // Always a string - joined from segments
  segments:   TranscriptSegment[];
  word_count: number;
  language:   string;
  received_at?: string;
}

export interface DiagramData {
  status:         string; // pending | not_applicable | ready | failed
  type?:          string | null;
  mermaid_syntax?: string | null;
  generated_at?:  string | null;
  error?:         string | null;
}

export interface Meeting {
  meeting_id:      string;
  user_id:         string;
  attendees:       string[];
  context:         string;
  no_of_persons:   number;
  date_time:       string;
  status:          string;
  transcript?:     TranscriptData | null;
  diagram?:        DiagramData | null;
  rag_indexed:     boolean;
  rag_indexed_at?: string | null;
  audio_s3_key:    string;
  storage_backend?: string | null;
  audio_state?:    string | null;
  mom?:            string | null;
  summary?:        string | null;
  key_points?:     string | null;
  created_at:      string;
  updated_at:      string;
  meet_link?:      string | null;
  bot_session_id?: string | null;
}

export interface ChatMessage {
  role:    "user" | "assistant";
  content: string;
}

export interface ChatSource {
  meeting_id:    string;
  chunk_index:   number;
  meeting_title: string;
  user_id:       string;
}

export interface Session {
  user?: {
    name?:  string | null;
    email?: string | null;
    image?: string | null;
  };
  accessToken?:   string;
  role?:          string;
  user_id?:       string;
  auth_provider?: string;
}

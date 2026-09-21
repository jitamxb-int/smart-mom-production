import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Meeting } from "@/types";

interface MeetingsMeta {
  total: number;
  page:  number;
  limit: number;
}

interface MeetingsState {
  byId:          Record<string, Meeting>;
  pages:         Record<number, Meeting[]>;
  meta:          MeetingsMeta | null;
  stats:         { total: number; transcribed: number; indexed: number; with_diagram: number } | null;
  listLoading:   boolean;
  statsLoading:  boolean;
}

const initialState: MeetingsState = {
  byId:         {},
  pages:        {},
  meta:         null,
  stats:        null,
  listLoading:  false,
  statsLoading: false,
};

const meetingsSlice = createSlice({
  name: "meetings",
  initialState,
  reducers: {
    setMeetingsPage(state, action: PayloadAction<{
      page:     number;
      meetings: Meeting[];
      meta:     MeetingsMeta;
    }>) {
      const { page, meetings, meta } = action.payload;
      state.pages[page] = meetings;
      state.meta        = meta;
      // Also populate byId for fast single-meeting lookup
      for (const m of meetings) {
        state.byId[m.meeting_id] = m;
      }
    },
    setMeeting(state, action: PayloadAction<Meeting>) {
      state.byId[action.payload.meeting_id] = action.payload;
    },
    updateMeeting(state, action: PayloadAction<Partial<Meeting> & { meeting_id: string }>) {
      const { meeting_id, ...patch } = action.payload;
      if (state.byId[meeting_id]) {
        state.byId[meeting_id] = { ...state.byId[meeting_id], ...patch };
      }
      // Also patch in pages
      for (const page of Object.values(state.pages)) {
        const idx = page.findIndex(m => m.meeting_id === meeting_id);
        if (idx >= 0) {
          page[idx] = { ...page[idx], ...patch };
        }
      }
    },
    removeMeeting(state, action: PayloadAction<string>) {
      delete state.byId[action.payload];
      for (const page of Object.values(state.pages)) {
        const idx = page.findIndex(m => m.meeting_id === action.payload);
        if (idx >= 0) page.splice(idx, 1);
      }
    },
    setStats(state, action: PayloadAction<MeetingsState["stats"]>) {
      state.stats = action.payload;
    },
    setListLoading(state, action: PayloadAction<boolean>) {
      state.listLoading = action.payload;
    },
    setStatsLoading(state, action: PayloadAction<boolean>) {
      state.statsLoading = action.payload;
    },
    invalidatePages(state) {
      state.pages = {};
    },
  },
});

export const meetingsActions = meetingsSlice.actions;
export default meetingsSlice.reducer;

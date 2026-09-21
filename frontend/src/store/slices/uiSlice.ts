import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface UiState {
  navigating:     boolean;
  visitedRoutes:  Record<string, boolean>;
}

const initialState: UiState = {
  navigating:    false,
  visitedRoutes: {},
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setNavigating(state, action: PayloadAction<boolean>) {
      state.navigating = action.payload;
    },
    markRouteVisited(state, action: PayloadAction<string>) {
      state.visitedRoutes[action.payload] = true;
    },
  },
});

export const uiActions = uiSlice.actions;
export default uiSlice.reducer;

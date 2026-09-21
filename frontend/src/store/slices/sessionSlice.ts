import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface SessionUser {
  name:  string;
  email: string;
  image: string;
}

interface SessionState {
  accessToken:   string;
  role:          string;
  user_id:       string;
  auth_provider: string;
  user:          SessionUser | null;
}

const initialState: SessionState = {
  accessToken:   "",
  role:          "user",
  user_id:       "",
  auth_provider: "email",
  user:          null,
};

const sessionSlice = createSlice({
  name: "session",
  initialState,
  reducers: {
    setSession(state, action: PayloadAction<{
      accessToken:   string;
      role:          string;
      user_id:       string;
      auth_provider: string;
      user:          SessionUser;
    }>) {
      state.accessToken   = action.payload.accessToken;
      state.role          = action.payload.role;
      state.user_id       = action.payload.user_id;
      state.auth_provider = action.payload.auth_provider;
      state.user          = action.payload.user;
    },
    clearSession(state) {
      state.accessToken   = "";
      state.role          = "user";
      state.user_id       = "";
      state.auth_provider = "email";
      state.user          = null;
    },
  },
});

export const sessionActions = sessionSlice.actions;
export default sessionSlice.reducer;

# Redux State Management System

This document describes the comprehensive Redux state management system implemented for the Smart MoM application.

## Overview

The application uses **Redux Toolkit** for global state management combined with **TanStack Query** for server state caching and synchronization. This hybrid approach provides:

- **Optimistic UI updates** through Redux reducers
- **Automatic background refetching** via TanStack Query
- **Type-safe state access** with TypeScript
- **Centralized business logic** in async thunks

## Store Structure

```
store/
├── index.ts              # Store configuration
├── hooks.ts              # Custom React hooks
└── slices/
    ├── index.ts          # Barrel exports
    ├── sessionSlice.ts   # Authentication state
    ├── meetingsSlice.ts  # Meetings data & caching
    ├── uiSlice.ts        # UI state (navigation, etc.)
    ├── adminSlice.ts     # Admin panel state
    ├── chatSlice.ts      # Chat functionality
    ├── recordingSlice.ts # Meeting recording
    └── notificationsSlice.ts # Toast notifications & errors
```

## Slices

### 1. Session Slice (`sessionSlice.ts`)

Manages user authentication and session data.

**State:**
```typescript
interface SessionState {
  accessToken:   string;
  role:          "user" | "admin";
  user_id:       string;
  auth_provider: string;
  user:          SessionUser | null;
}
```

**Actions:**
- `setSession(data)` - Set session data
- `clearSession()` - Clear session on logout

**Hooks:**
- `useSession()` - Get full session state
- `useUser()` - Get current user
- `useUserRole()` - Get user role
- `useIsAdmin()` - Check if admin
- `useAuthToken()` - Get access token

### 2. Meetings Slice (`meetingsSlice.ts`)

Manages meetings data with normalized caching.

**State:**
```typescript
interface MeetingsState {
  byId:   Record<string, Meeting>;  // Normalized by ID
  pages:  Record<number, Meeting[]> // Paginated lists
  meta:   MeetingsMeta | null;
  stats:  Stats | null;
  listLoading:  boolean;
  statsLoading: boolean;
}
```

**Actions:**
- `setMeetingsPage({page, meetings, meta})` - Cache a page
- `setMeeting(meeting)` - Cache single meeting
- `updateMeeting(patch)` - Optimistic update
- `removeMeeting(id)` - Remove from cache
- `setStats(stats)` - Cache dashboard stats

**Hooks:**
- `useMeetingsState()` - Get full meetings state
- `useMeeting(meetingId)` - Get specific meeting
- `useMeetingsList(page)` - Get paginated list
- `useStats()` - Get dashboard stats

### 3. Admin Slice (`adminSlice.ts`)

Manages admin panel state and operations.

**State:**
```typescript
interface AdminState {
  // Users
  users:         AdminUser[];
  usersMeta:     UsersMeta | null;
  usersLoading:  boolean;

  // Stats
  stats:         AdminStats | null;
  statsLoading:  boolean;

  // Meetings
  adminMeetings:      AdminMeeting[];
  adminMeetingsMeta:  AdminMeetingsMeta | null;
  adminMeetingsLoading: boolean;

  // Chunked meetings
  chunkedMeetings:    AdminMeeting[];
  chunkedMeetingsLoading: boolean;

  // Storage
  storageConfig:  StorageConfig | null;
  storageLoading: boolean;
}
```

**Async Thunks:**
- `fetchAdminUsers({page, limit})`
- `fetchAdminStats()`
- `fetchAdminMeetings({page, limit, userId})`
- `fetchChunkedMeetings({page, limit})`
- `fetchStorageConfig()`
- `updateUserRole({userId, role})`
- `deleteUser(userId)`
- `switchStorageBackend(backend)`
- `indexUnindexedMeetings()`

**Hooks:**
- `useAdminUsers(page, limit)` - Get users with pagination
- `useAdminStatsData()` - Get admin statistics
- `useAdminMeetingsData(page, limit, userId)` - Get admin meetings
- `useChunkedMeetingsData(page, limit)` - Get chunked meetings
- `useStorageConfigData()` - Get storage configuration
- `useUpdateUserRole()` - Role update mutation
- `useDeleteUserMutation()` - Delete user mutation
- `useSwitchStorageBackend()` - Storage backend mutation
- `useIndexUnindexed()` - Index meetings mutation

### 4. Chat Slice (`chatSlice.ts`)

Manages chat functionality including streaming responses.

**State:**
```typescript
interface ChatState {
  messages:          ChatMessage[];
  sources:           ChatSource[];
  isStreaming:       boolean;
  error:             string | null;
  availableMeetings: Meeting[];
  sessions:          ChatSession[];
  activeMeetingId:   string | null;
  activeMeetingIds:  string[];
  indexingStatus:    Record<string, {indexed: boolean; status: string}>;
}
```

**Async Thunks:**
- `fetchChatMeetings()`
- `fetchChatMeetingsByUser(userId)`
- `fetchChatHistory(meetingId)`
- `fetchChatStatus(meetingId)`
- `deleteChatSession(sessionId)`
- `sendMessage({message, meetingId, meetingIds})` - Streaming chat

**Actions:**
- `addMessage(message)` - Add to conversation
- `appendToLastMessage(text)` - Stream token
- `setMessages(messages)` - Replace all messages
- `clearMessages()` - Clear conversation
- `setSources(sources)` - Set RAG sources
- `setActiveMeetingId(id)` - Set context meeting
- `setError(error)` - Set chat error

**Hooks:**
- `useChatState()` - Full chat state
- `useChatMessages()` - Messages and streaming status
- `useChatSources()` - RAG sources
- `useChatMeetings(userId)` - Available meetings
- `useChatStatus(meetingId)` - Indexing status with polling
- `useSendMessage()` - Send message mutation
- `useChat(userId)` - Combined hook

### 5. Recording Slice (`recordingSlice.ts`)

Manages meeting recording state.

**State:**
```typescript
interface RecordingState {
  status:              RecordingStatus;
  meetingId:           string | null;
  meetingTitle:        string;
  uploadProgress:      number;
  uploadSpeed:         number;
  uploadTimeRemaining: number;
  recordingDuration:   number;
  audioBlob:           Blob | null;
  audioUrl:            string | null;
  chunkCount:          number;
  error:               string | null;
  presignedUrl:        string | null;
  isCreatingMeeting:   boolean;
}
```

**Recording Status:**
- `"idle"` - No active recording
- `"requesting"` - Creating meeting
- `"recording"` - Actively recording
- `"paused"` - Recording paused
- `"uploading"` - Uploading audio
- `"processing"` - Merging chunks/transcribing
- `"completed"` - Finished successfully
- `"error"` - Error occurred

**Async Thunks:**
- `createRecordingMeeting({title, context})`
- `getPresignedUploadUrl(meetingId)`
- `uploadChunk({meetingId, blob, chunkId, isFinal, mimeType})`
- `mergeChunks(meetingId)`
- `uploadAudioDirect({meetingId, formData, onProgress})`

**Actions:**
- `startRecording({meetingId, title})`
- `pauseRecording()`
- `resumeRecording()`
- `stopRecording()`
- `setMeetingTitle(title)`
- `setUploadProgress(value)`
- `setAudioBlob(blob)`
- `resetRecording()`

**Hooks:**
- `useRecordingState()` - Full recording state
- `useRecordingControls()` - Recording actions
- `useRecordingDuration()` - Duration with auto-increment
- `useUploadProgress()` - Upload progress tracking
- `useRecording()` - Combined hook

### 6. Notifications Slice (`notificationsSlice.ts`)

Manages toast notifications and global errors.

**State:**
```typescript
interface NotificationsState {
  notifications: Notification[];
  errors:        GlobalError[];
  isLoading:     boolean;
  loadingMessage?: string;
  confirmation:  ConfirmationDialog | null;
}
```

**Actions:**
- `addNotification(notification)` - Add custom notification
- `removeNotification(id)` - Remove specific notification
- `showSuccess({message, title, duration})`
- `showError({message, title, duration})`
- `showInfo({message, title, duration})`
- `showWarning({message, title, duration})`
- `showLoading({message, id})` - Persistent loading notification
- `clearNotifications()`
- `showConfirmation({title, message, onConfirm, onCancel})`
- `hideConfirmation()`
- `setLoading({isLoading, message})`

**Hooks:**
- `useNotifications()` - Full notifications state
- `useNotificationsList()` - Active notifications
- `useErrors()` - Global errors
- `useGlobalLoading()` - Loading overlay state
- `useConfirmation()` - Confirmation dialog
- `useNotify()` - Notification actions

## Usage Examples

### Example 1: Using Admin Hooks

```tsx
"use client";

import { useAdminUsers, useUpdateUserRole, useDeleteUserMutation } from "@/hooks/useAdmin";

export function UsersTable() {
  const { users, meta, isLoading, refetch } = useAdminUsers(1, 50);
  const updateRole = useUpdateUserRole();
  const deleteUser = useDeleteUserMutation();

  const handleRoleChange = (userId: string, newRole: string) => {
    updateRole.mutate(
      { userId, role: newRole },
      {
        onSuccess: () => {
          toast.success("Role updated");
          refetch();
        },
      }
    );
  };

  if (isLoading) return <Loader />;

  return (
    <table>
      {users.map(user => (
        <tr key={user.user_id}>
          <td>{user.email}</td>
          <td>{user.role}</td>
          <td>
            <button onClick={() => handleRoleChange(user.user_id, "admin")}>
              Make Admin
            </button>
          </td>
        </tr>
      ))}
    </table>
  );
}
```

### Example 2: Using Chat Hooks

```tsx
"use client";

import { useChatState, useSendMessage } from "@/hooks/useChatRedux";

export function ChatInterface() {
  const { messages, sources, isStreaming, error, activeMeetingId } = useChatState();
  const { sendMessage } = useSendMessage();

  const handleSend = (text: string) => {
    sendMessage({
      message: text,
      meetingId: activeMeetingId ?? undefined,
    });
  };

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>{msg.content}</div>
      ))}
      {sources.map(source => (
        <div key={source.meeting_id}>{source.meeting_title}</div>
      ))}
      <input onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
```

### Example 3: Using Recording Hooks

```tsx
"use client";

import { useRecording } from "@/hooks/useRecordingRedux";

export function RecordingControls() {
  const {
    status,
    meetingTitle,
    recordingDuration,
    uploadProgress,
    isRecording,
    isPaused,
    isUploading,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    setMeetingTitle,
  } = useRecording();

  const handleStart = async () => {
    await startRecording("My Meeting", "Team standup");
  };

  return (
    <div>
      <input
        value={meetingTitle}
        onChange={e => setMeetingTitle(e.target.value)}
      />
      {isRecording && <div>{recordingDuration}s</div>}
      {isUploading && <progress value={uploadProgress} />}

      <button onClick={handleStart} disabled={isRecording || isUploading}>
        Start Recording
      </button>
      <button onClick={pauseRecording} disabled={!isRecording || isPaused}>
        Pause
      </button>
      <button onClick={resumeRecording} disabled={!isPaused}>
        Resume
      </button>
      <button onClick={stopRecording} disabled={!isRecording}>
        Stop
      </button>
    </div>
  );
}
```

### Example 4: Using Notifications

```tsx
"use client";

import { useNotify } from "@/store/hooks";

export function MyComponent() {
  const notify = useNotify();

  const handleSuccess = () => {
    notify.success("Operation completed successfully!");
  };

  const handleError = () => {
    notify.error("Something went wrong", "Error Title");
  };

  const handleConfirm = () => {
    notify.showConfirmation({
      title: "Delete item?",
      message: "This action cannot be undone",
      onConfirm: () => {
        // Perform deletion
      },
      onCancel: () => {
        // Cancel
      },
      danger: true,
    });
  };

  return (
    <div>
      <button onClick={handleSuccess}>Show Success</button>
      <button onClick={handleError}>Show Error</button>
      <button onClick={handleConfirm}>Show Confirmation</button>
    </div>
  );
}
```

## Best Practices

1. **Use the typed hooks** - Always use the provided hooks instead of raw `useAppSelector` when available
2. **Combine with TanStack Query** - Use `useQuery` for server state and Redux for optimistic updates
3. **Handle loading states** - Check both Redux loading flags and query isLoading
4. **Invalidate queries after mutations** - Call `queryClient.invalidateQueries` to refresh data
5. **Use async thunks for complex actions** - Keep component logic simple by moving complex operations to thunks
6. **Leverage optimistic updates** - Update Redux state immediately for better UX
7. **Handle errors gracefully** - Use the notifications slice for user-facing errors

## Page-Specific Implementations

### User-Facing Pages

| Page | Redux Hooks | Description |
|------|-------------|-------------|
| `/dashboard` | `useStats()` | Dashboard statistics |
| `/dashboard/meetings` | `useMeetingsList()` | Paginated meetings list |
| `/dashboard/meetings/[id]` | `useMeeting(id)`, `useDiagramStatus(id)` | Meeting details |
| `/dashboard/chat` | `useChatState()`, `useSendMessage()` | Chat functionality |
| `/dashboard/record` | `useRecording()` | Recording controls |

### Admin Pages

| Page | Redux Hooks | Description |
|------|-------------|-------------|
| `/dashboard/admin` | `useAdminUsers()`, `useAdminStatsData()`, `useStorageConfigData()` | Full admin panel |

## Migration Guide

To migrate existing components to use the new Redux state:

1. **Identify state used** - List all useState and useQuery calls
2. **Import appropriate hooks** - Use the hooks from `@/store/hooks` or feature-specific hooks
3. **Replace local state** - Swap useState for Redux selectors
4. **Replace mutations** - Use Redux async thunks or combined hooks
5. **Remove unnecessary code** - Delete redundant state management

Example migration:
```tsx
// Before
const [users, setUsers] = useState<AdminUser[]>([]);
const [loading, setLoading] = useState(false);
const { data } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
useEffect(() => { if (data) setUsers(data); }, [data]);

// After
const { users, loading, refetch } = useAdminUsers(1, 50);
```

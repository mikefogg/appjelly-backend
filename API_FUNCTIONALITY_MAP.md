# Ghost API - Functionality Map

This document maps the current API functionality against the required user flows.

## ✅ 1. Authentication with Clerk

**Status**: ✅ IMPLEMENTED

**How it works**:
- Authentication is handled via `requireAuth` middleware (`src/middleware/auth.js:5`)
- Client sends request with Clerk JWT token in Authorization header
- Middleware validates token using `@clerk/express` SDK
- Account is auto-created if doesn't exist (fetches user data from Clerk API)
- Account is stored in `res.locals.account` for downstream use

**Required headers**:
```
Authorization: Bearer <clerk_jwt_token>
X-App-Slug: ghost
```

**Middleware chain**: `requireAppContext` → `requireAuth`

---

## ✅ 2. Add a New Network (Twitter, etc.)

**Status**: ✅ IMPLEMENTED

**Endpoint**: `POST /oauth/:platform/connect`

**Implementation**: `src/routes/public/oauth.js`

**Supported Platforms**:
- ✅ Twitter/X
- ✅ Facebook (Instagram/Threads)
- ✅ LinkedIn

**How it works**:
```
POST /oauth/twitter/connect
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "access_token": "user_oauth_token",
  "refresh_token": "refresh_token", // optional
  "expires_in": 7200 // optional
}

→ Validates access token with platform API
→ Fetches user profile (username, display name, etc.)
→ Encrypts tokens with AES-256-GCM
→ Creates ConnectedAccount record
→ Triggers background sync job
→ Returns connection details
```

**Response** (201 Created):
```json
{
  "code": 201,
  "status": "Success",
  "message": "Successfully connected account",
  "data": {
    "connection": {
      "id": "uuid",
      "platform": "twitter",
      "username": "yourusername",
      "display_name": "Your Name",
      "sync_status": "pending"
    }
  }
}
```

**Security Features**:
- ✅ Tokens encrypted with AES-256-GCM before storage
- ✅ Duplicate connection prevention
- ✅ User ownership validation
- ✅ Platform API verification

**Database fields** (`connected_accounts` table):
- `platform`: "twitter" | "facebook" | "linkedin"
- `platform_user_id`: Platform user ID
- `username`: @handle or display name
- `access_token`: OAuth token (encrypted)
- `refresh_token`: OAuth refresh token (encrypted)
- `token_expires_at`: Token expiration timestamp
- `sync_status`: "pending" | "syncing" | "ready" | "error"
- `is_active`: true | false (for soft deletes)

**React Native Integration**: See `REACT_NATIVE_OAUTH_GUIDE.md` for complete expo-auth-session examples

---

## ✅ 3. Remove a Network (Twitter, etc.)

**Status**: ✅ IMPLEMENTED

**Endpoint**: `DELETE /connections/:id`

**Implementation**: `src/routes/public/connections.js:176`

**How it works**:
```
DELETE /connections/{connection_id}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Soft deletes by setting is_active = false
→ Does not delete historical data
```

**Response**:
```json
{
  "code": 200,
  "status": "Success",
  "message": "Connection disconnected successfully",
  "data": {
    "message": "Connection disconnected successfully"
  }
}
```

**Security**:
- Validates connection belongs to authenticated user
- Validates connection belongs to current app

---

## ✅ 4. Fetch Most Recent Suggested Content for Twitter

**Status**: ✅ IMPLEMENTED

**Endpoint**: `GET /suggestions`

**Implementation**: `src/routes/public/suggestions.js:16`

**How it works**:
```
GET /suggestions?connected_account_id={uuid}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns active (non-expired, pending) suggestions
→ Ordered by created_at DESC (most recent first)
→ Includes source post and author info
```

**Response**:
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "suggestion_type": "original_post" | "reply" | "thread",
      "content": "Generated tweet content...",
      "reasoning": "Why this suggestion was made",
      "character_count": 280,
      "topics": ["tech", "ai"],
      "source_post": {
        "id": "uuid",
        "content": "Original tweet text",
        "posted_at": "2025-10-14T10:00:00Z",
        "engagement_score": 150,
        "author": {
          "username": "elonmusk",
          "display_name": "Elon Musk"
        }
      },
      "created_at": "2025-10-14T10:00:00Z",
      "expires_at": "2025-10-15T10:00:00Z"
    }
  ]
}
```

**Filters applied**:
- `status = "pending"` (not used/dismissed)
- `expires_at > NOW()` (not expired)
- Connected account belongs to user

**Additional suggestion endpoints**:
- `GET /suggestions/:id` - Get specific suggestion details
- `POST /suggestions/:id/use` - Mark suggestion as used
- `POST /suggestions/:id/dismiss` - Mark suggestion as dismissed
- `POST /suggestions/generate` - Manually trigger generation (202 queued response)
- `POST /suggestions/:id/regenerate` - ❌ Not implemented (501 status)

---

## ✅ 5. Submit a Prompt and Get Back a Tweet

**Status**: ✅ IMPLEMENTED

**Endpoint**: `POST /posts/generate`

**Implementation**: `src/routes/public/posts.js:15`

**How it works**:
```
POST /posts/generate
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "prompt": "Write a tweet about AI safety",
  "connected_account_id": "uuid"
}

→ Creates Input record
→ Creates Artifact record (status: "pending")
→ Queues background job (generate-post)
→ AI generates tweet using writing style
→ Returns 202 Accepted immediately
```

**Request validation**:
- `prompt`: 1-500 characters, required
- `connected_account_id`: UUID, required
- Connection must have `sync_status = "ready"`

**Response** (202 Accepted):
```json
{
  "code": 202,
  "status": "Success",
  "data": {
    "id": "artifact_uuid",
    "status": "pending",
    "message": "Post generation queued",
    "input": {
      "id": "input_uuid",
      "prompt": "Write a tweet about AI safety"
    }
  }
}
```

**Polling for completion**:
```
GET /posts/{artifact_id}

→ Returns artifact with status: "pending" | "completed" | "failed"
→ Once completed, includes generated content
```

**Complete post response**:
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "id": "uuid",
    "status": "completed",
    "content": "AI safety is crucial because... #AI #safety",
    "character_count": 280,
    "input": {
      "id": "uuid",
      "prompt": "Write a tweet about AI safety"
    },
    "connected_account": {
      "id": "uuid",
      "platform": "twitter",
      "username": "yourusername"
    },
    "generation_info": {
      "total_tokens": 150,
      "cost_usd": 0.0015,
      "generation_time_seconds": 2.5,
      "ai_model": "gpt-4"
    },
    "created_at": "2025-10-14T10:00:00Z",
    "updated_at": "2025-10-14T10:00:02Z"
  }
}
```

**Additional post endpoints**:
- `GET /posts` - List all generated posts (paginated)
- `GET /posts?type=draft|generated|all` - Filter posts by type
- `GET /posts/:id` - Get specific post
- `PATCH /posts/:id` - Edit post content
- `POST /posts/:id/improve` - Get AI improvement suggestions (preview-only)
- `POST /posts/:id/copy` - Mark post as copied to clipboard
- `DELETE /posts/:id` - Delete post

---

## ✅ 6. Create and Manage Drafts

**Status**: ✅ IMPLEMENTED

**Overview**: Users can write their own content without AI generation, save it as drafts, and optionally get AI suggestions to improve it.

### Create a Draft

**Endpoint**: `POST /posts/drafts`

**Implementation**: `src/routes/public/posts.js:17`

**How it works**:
```
POST /posts/drafts
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "content": "I just launched my new project! Check it out...",
  "connected_account_id": "uuid"
}

→ Creates Artifact record (status: "draft", no input_id)
→ Returns 201 Created immediately
```

**Request validation**:
- `content`: 1-5000 characters, required
- `connected_account_id`: UUID, required

**Response** (201 Created):
```json
{
  "code": 201,
  "status": "Success",
  "data": {
    "id": "artifact_uuid",
    "status": "draft",
    "content": "I just launched my new project! Check it out...",
    "character_count": 48,
    "connected_account": {
      "id": "uuid",
      "platform": "twitter",
      "username": "yourusername"
    },
    "created_at": "2025-10-14T10:00:00Z"
  }
}
```

### Get AI Improvement Suggestions (Preview-Only)

**Endpoint**: `POST /posts/:id/improve`

**Implementation**: `src/routes/public/posts.js:333`

**How it works**:
```
POST /posts/{post_id}/improve
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "instructions": "Make it more engaging and add emojis" // optional
}

→ Calls AI to improve content with optional instructions
→ Returns BOTH original and improved versions
→ Does NOT modify the database
→ User can then PATCH if they like the improvement
```

**Request validation**:
- `instructions`: 1-200 characters, optional

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "original": {
      "content": "I just launched my new project!",
      "character_count": 31
    },
    "improved": {
      "content": "🚀 Just launched my new project! So excited to share this with you all! Check it out 👇",
      "character_count": 85
    },
    "instructions": "Make it more engaging and add emojis",
    "generation_info": {
      "total_tokens": 150,
      "cost_usd": 0.0002,
      "generation_time_seconds": 1.2,
      "ai_model": "gpt-4o-mini"
    },
    "message": "AI improvement generated. Use PATCH /posts/:id to save if you like it."
  }
}
```

**Key Features**:
- ✅ Preview-only - doesn't overwrite database
- ✅ Returns both original and improved
- ✅ Optional improvement instructions
- ✅ Frontend decides whether to accept
- ✅ Works with both drafts AND generated posts

### Filter Posts by Type

**Endpoint**: `GET /posts?type=draft|generated|all`

**Implementation**: `src/routes/public/posts.js:165`

**How it works**:
```
GET /posts?type=draft
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns only user-written drafts (no input_id)
→ Excludes AI-generated posts
```

**Query parameters**:
- `type`: "draft" | "generated" | "all" (default: "all")
- `connected_account_id`: UUID, optional filter
- `page`: Page number (default: 1)
- `per_page`: Results per page (default: 20, max: 50)

**Response**:
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "status": "draft",
      "content": "User-written content",
      "character_count": 21,
      "is_draft": true,
      "input": null,
      "connected_account": {
        "id": "uuid",
        "platform": "twitter",
        "username": "yourusername"
      },
      "created_at": "2025-10-14T10:00:00Z",
      "updated_at": "2025-10-14T10:00:00Z"
    }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "per_page": 20,
      "has_more": false
    },
    "total": 1
  }
}
```

**Draft vs Generated**:
- **Drafts**: `input_id` is null, `status` is "draft", user-written
- **Generated**: `input_id` exists, created from AI prompt
- Both can be edited with `PATCH /posts/:id`
- Both can be improved with `POST /posts/:id/improve`

---

## 📋 Summary Status

| Requirement | Status | Endpoint | Notes |
|------------|--------|----------|-------|
| Authenticate with Clerk | ✅ | Middleware | Auto-creates accounts |
| Add network | ✅ | `POST /oauth/:platform/connect` | Direct token connection for React Native |
| Remove network | ✅ | `DELETE /connections/:id` | Soft delete |
| Fetch suggestions | ✅ | `GET /suggestions` | Includes filters |
| Generate tweet from prompt | ✅ | `POST /posts/generate` | Async with polling |
| Create drafts | ✅ | `POST /posts/drafts` | User-written content |
| AI improve drafts | ✅ | `POST /posts/:id/improve` | Preview-only, doesn't save |
| Filter posts by type | ✅ | `GET /posts?type=draft\|generated` | Draft/generated filtering |

---

## ✅ OAuth Implementation (React Native)

**Status**: ✅ IMPLEMENTED

**Overview**: Full OAuth 2.0 implementation for Twitter, Facebook, and LinkedIn with React Native (expo-auth-session) support.

**Implementation**: `src/routes/public/oauth.js`

### Supported Platforms
- ✅ Twitter/X (OAuth 2.0 with PKCE)
- ✅ Facebook (for Instagram/Threads)
- ✅ LinkedIn

### Connect Account Flow

**Endpoint**: `POST /oauth/:platform/connect`

**Platforms**: `twitter`, `facebook`, `linkedin`

**How it works**:
```
POST /oauth/twitter/connect
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "access_token": "token_from_expo_auth_session",
  "refresh_token": "refresh_token", // optional
  "expires_in": 7200 // optional, seconds
}

→ Fetches user profile from platform API
→ Encrypts tokens with AES-256-GCM
→ Creates/updates ConnectedAccount
→ Triggers background sync job
→ Returns connection details
```

**Features**:
- ✅ Token encryption (AES-256-GCM)
- ✅ Duplicate prevention
- ✅ Automatic profile fetching
- ✅ Background sync triggering
- ✅ Token refresh handling
- ✅ Comprehensive test coverage (105 tests passing)

**React Native Integration Guide**: See `REACT_NATIVE_OAUTH_GUIDE.md`

---

## 🔄 Complete User Flow

### First Time User:
1. ✅ Authenticate with Clerk → Auto-creates account
2. ✅ Connect Twitter (OAuth) → `POST /oauth/twitter/connect`
3. ✅ Wait for sync (polling `GET /connections/:id/status`)
4. ✅ Get suggestions → `GET /suggestions?connected_account_id=...`
5. ✅ Generate custom tweet → `POST /posts/generate`
6. ✅ Poll for completion → `GET /posts/:id`

### Daily User:
1. ✅ Open app → Authenticate
2. ✅ Get suggestions → `GET /suggestions?connected_account_id=...`
3. ✅ Generate custom tweet → `POST /posts/generate`
4. ✅ Mark suggestion as used → `POST /suggestions/:id/use`

### Draft-First User:
1. ✅ Open app → Authenticate
2. ✅ Write draft → `POST /posts/drafts`
3. ✅ Get AI improvement → `POST /posts/:id/improve`
4. ✅ Accept improvement → `PATCH /posts/:id` (if user likes it)
5. ✅ View all drafts → `GET /posts?type=draft`

---

## 📝 Notes

- All endpoints require `X-App-Slug: ghost` header
- All endpoints require Clerk JWT in `Authorization: Bearer` header
- Timestamps are ISO 8601 format
- UUIDs are used for all IDs
- Background jobs use BullMQ (ghostQueue)
- Writing style analysis happens automatically after sync
- Suggestions expire after 24 hours by default

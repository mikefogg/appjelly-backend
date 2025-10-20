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
- `POST /suggestions/:id/generate-response` - Generate AI reply to source post ✅
- `POST /suggestions/generate` - Manually trigger generation (202 queued response)
- `POST /suggestions/:id/regenerate` - ❌ Not implemented (501 status)

---

## ✅ 6a. Generate Response to Tweet

**Status**: ✅ IMPLEMENTED

**Endpoint**: `POST /suggestions/:id/generate-response`

**Implementation**: `src/routes/public/suggestions.js:203`

**How it works**:
```
POST /suggestions/{suggestion_id}/generate-response
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "additional_instructions": "Make it funny and engaging" // optional
}

→ Fetches the suggestion's source post
→ Creates Input with reply prompt
→ Creates Artifact (status: "pending", is_reply: true)
→ Queues background job for AI generation
→ Returns 202 Accepted immediately
```

**Request validation**:
- `additional_instructions`: 1-200 characters, optional
- Suggestion must have a source post
- Connected account must have `sync_status = "ready"`

**Response** (202 Accepted):
```json
{
  "code": 202,
  "status": "Success",
  "data": {
    "id": "artifact_uuid",
    "status": "pending",
    "message": "Response generation queued",
    "input": {
      "id": "input_uuid",
      "prompt": "Generate a reply to this post from @author: '...'"
    },
    "reply_to": {
      "post_id": "source_post_uuid",
      "author": "original_author",
      "content": "Original tweet text"
    }
  }
}
```

**Polling for completion**: Use `GET /posts/{artifact_id}` to check status

**Key Features**:
- ✅ Generates AI replies to suggested posts
- ✅ Optional custom instructions for tone/style
- ✅ Includes context of original post
- ✅ Async generation with polling
- ✅ Respects user's writing style

---

## ✅ 5. Submit a Prompt and Get Back a Tweet

**Status**: ✅ IMPLEMENTED

**Endpoint**: `POST /posts/generate`

**Implementation**: `src/routes/public/posts.js:98`

**How it works**:
```
POST /posts/generate
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "prompt": "Write a tweet about AI safety",
  "angle": "hot_take",
  "length": "medium",
  "connected_account_id": "uuid"
}

→ Creates Input record with angle/length metadata
→ Creates Artifact record (status: "pending")
→ Queues background job (generate-post)
→ AI generates post using voice, sample posts, and writing style
→ Platform-specific character limits applied automatically
→ Returns 202 Accepted immediately
```

**Request validation**:
- `prompt`: 1-500 characters, required
- `angle`: enum, required - How to approach the topic
  - `"hot_take"` - Bold, controversial opinion
  - `"roast"` - Playful, witty criticism
  - `"hype"` - Enthusiastic excitement and promotion
  - `"story"` - Compelling narrative or experience
  - `"teach"` - Explain or teach something valuable
  - `"question"` - Thought-provoking question
- `length`: enum, required - Post length target
  - `"short"` - Quick hits, memes, CTAs (high engagement)
  - `"medium"` - Insights, questions (peak engagement)
  - `"long"` - Deep dives, thought leadership
- `connected_account_id`: UUID, **optional** (uses ghost account if omitted)
- If provided, connection must have `sync_status = "ready"`

**Platform-Specific Character Limits**:
- **Twitter**: short=100, medium=280, long=5000 (Premium)
- **LinkedIn**: short=150, medium=600, long=2000
- **Threads**: short=100, medium=300, long=500
- **Facebook**: short=80, medium=400, long=2000
- **Ghost** (default): short=100, medium=300, long=2000

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

**Generation Customization with Voice & Sample Posts**:

The AI generation uses the following data to personalize content:
1. **Voice** (optional): Custom writing voice description from the connected account
2. **Sample Posts** (optional): Example posts that demonstrate the user's tone and style
3. **Writing Style** (optional): Auto-analyzed style from synced posts (tone, emoji frequency, etc.)

When a `connected_account_id` is provided, the AI will:
- Use the account's custom `voice` field in the system prompt if set
- Include `sample_posts` as examples to match tone and style
- Apply auto-detected `writing_style` preferences
- Apply platform-specific character limits based on the account's platform

See "Customize Writing Voice & Sample Posts" section below for managing these settings.

**Additional post endpoints**:
- `GET /posts` - List all generated posts (paginated)
- `GET /posts?type=draft|generated|all` - Filter posts by type
- `GET /posts/:id` - Get specific post
- `PATCH /posts/:id` - Edit post content
- `POST /posts/:id/improve` - Get AI improvement suggestions (preview-only)
- `POST /posts/:id/copy` - Mark post as copied to clipboard
- `DELETE /posts/:id` - Delete post

---

## ✅ 8. Customize Writing Voice & Sample Posts

**Status**: ✅ IMPLEMENTED

**Overview**: Users can customize how the AI generates content by setting a custom writing voice and providing sample posts. These are stored per connected account.

### Update Writing Voice

**Endpoint**: `PATCH /connections/:id`

**Implementation**: `src/routes/public/connections.js:181`

**How it works**:
```
PATCH /connections/{connection_id}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "voice": "Write like a tech entrepreneur. Be concise, inspiring, and forward-thinking. Use metaphors from startups and innovation."
}

→ Updates the voice field on the connected account
→ AI will use this voice description in future generations
→ Maximum 2000 characters
```

**Request validation**:
- `voice`: String, 1-2000 characters, optional
- Connection must belong to authenticated user
- Connection must belong to current app

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "id": "uuid",
    "platform": "twitter",
    "username": "yourusername",
    "voice": "Write like a tech entrepreneur. Be concise, inspiring, and forward-thinking. Use metaphors from startups and innovation.",
    "updated_at": "2025-10-19T10:00:00Z"
  }
}
```

**Clear voice**: Send `{"voice": null}` or `{"voice": ""}` to clear the custom voice

---

### Create Sample Post

**Endpoint**: `POST /connections/:id/samples`

**Implementation**: `src/routes/public/connections.js:227`

**How it works**:
```
POST /connections/{connection_id}/samples
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "content": "Just shipped a new feature! 🚀 Our users are going to love this.",
  "notes": "Excited tone with emoji, short and punchy"
}

→ Creates a sample post for this connected account
→ AI will use these examples to match your tone and style
→ Maximum 10 sample posts per connection
```

**Request validation**:
- `content`: String, 1-5000 characters, required
- `notes`: String, 1-500 characters, optional (notes about why this is a good example)
- Connection must belong to authenticated user
- Connection must belong to current app
- Maximum 10 sample posts per connection

**Response** (201 Created):
```json
{
  "code": 201,
  "status": "Success",
  "data": {
    "id": "uuid",
    "connected_account_id": "connection_uuid",
    "content": "Just shipped a new feature! 🚀 Our users are going to love this.",
    "notes": "Excited tone with emoji, short and punchy",
    "sort_order": 0,
    "created_at": "2025-10-19T10:00:00Z"
  }
}
```

---

### List Sample Posts

**Endpoint**: `GET /connections/:id/samples`

**Implementation**: `src/routes/public/connections.js:279`

**How it works**:
```
GET /connections/{connection_id}/samples
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns all sample posts for this connection
→ Ordered by sort_order ASC
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "connected_account_id": "connection_uuid",
      "content": "Just shipped a new feature! 🚀 Our users are going to love this.",
      "notes": "Excited tone with emoji, short and punchy",
      "sort_order": 0,
      "created_at": "2025-10-19T10:00:00Z"
    },
    {
      "id": "uuid",
      "content": "Hot take: Most productivity advice is just procrastination in disguise.",
      "notes": "Controversial opinion, no emoji, thought-provoking",
      "sort_order": 1,
      "created_at": "2025-10-19T10:05:00Z"
    }
  ]
}
```

---

### Update Sample Post

**Endpoint**: `PATCH /connections/:id/samples/:sampleId`

**Implementation**: `src/routes/public/connections.js:321`

**How it works**:
```
PATCH /connections/{connection_id}/samples/{sample_id}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "content": "Just shipped a new feature! Our users are loving it! 🔥",
  "notes": "Updated to use fire emoji instead",
  "sort_order": 2
}

→ Updates the sample post
→ All fields are optional
→ Can reorder by changing sort_order
```

**Request validation**:
- `content`: String, 1-5000 characters, optional
- `notes`: String, 1-500 characters, optional
- `sort_order`: Integer, optional
- Sample post must belong to the connection
- Connection must belong to authenticated user

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "id": "uuid",
    "connected_account_id": "connection_uuid",
    "content": "Just shipped a new feature! Our users are loving it! 🔥",
    "notes": "Updated to use fire emoji instead",
    "sort_order": 2,
    "updated_at": "2025-10-19T10:15:00Z"
  }
}
```

---

### Delete Sample Post

**Endpoint**: `DELETE /connections/:id/samples/:sampleId`

**Implementation**: `src/routes/public/connections.js:395`

**How it works**:
```
DELETE /connections/{connection_id}/samples/{sample_id}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Permanently deletes the sample post
→ Cannot be undone
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "message": "Sample post deleted successfully"
  }
}
```

**Security**:
- Sample post must belong to the specified connection
- Connection must belong to authenticated user
- Connection must belong to current app

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
- `connected_account_id`: UUID, **optional** (can be omitted for standalone drafts)

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
- `connected_account_id`: UUID or "none", optional filter
  - **If UUID**: Returns posts for that specific connected account
  - **If "none"**: Returns only standalone posts (no connected account)
  - **If omitted**: Returns all posts for the user
- `sort`: "created_at" | "updated_at" (default: "created_at")
- `order`: "asc" | "desc" (default: "desc")
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

**Standalone vs Connected Posts**:
- **Standalone**: `connected_account_id` is null - created before connecting any social accounts
- **Connected**: `connected_account_id` links to a specific platform account
- Both types support drafts AND generated posts
- Use `GET /posts?connected_account_id=none` to fetch only standalone posts
- Useful for onboarding flow where users start writing before connecting accounts

---

## 📋 Summary Status

| Requirement | Status | Endpoint | Notes |
|------------|--------|----------|-------|
| Authenticate with Clerk | ✅ | Middleware | Auto-creates accounts |
| Add network | ✅ | `POST /oauth/:platform/connect` | Direct token connection for React Native |
| Remove network | ✅ | `DELETE /connections/:id` | Soft delete |
| Fetch suggestions | ✅ | `GET /suggestions` | Includes filters |
| Generate tweet from prompt | ✅ | `POST /posts/generate` | Async with angle, length, voice, samples |
| Create drafts | ✅ | `POST /posts/drafts` | User-written content |
| AI improve drafts | ✅ | `POST /posts/:id/improve` | Preview-only, doesn't save |
| Filter posts by type | ✅ | `GET /posts?type=draft\|generated` | Draft/generated filtering |
| Generate response to tweet | ✅ | `POST /suggestions/:id/generate-response` | AI reply with optional instructions |
| Delete account | ✅ | `DELETE /accounts/me` | Soft delete with subscription notice |
| Update writing voice | ✅ | `PATCH /connections/:id` | Custom voice description (max 2000 chars) |
| Create sample post | ✅ | `POST /connections/:id/samples` | Add example posts (max 10 per connection) |
| List sample posts | ✅ | `GET /connections/:id/samples` | View all sample posts |
| Update sample post | ✅ | `PATCH /connections/:id/samples/:sampleId` | Edit content, notes, or sort order |
| Delete sample post | ✅ | `DELETE /connections/:id/samples/:sampleId` | Remove sample post |

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

## ✅ 7. Account Management & Deletion

**Status**: ✅ IMPLEMENTED

**Endpoint**: `DELETE /accounts/me`

**Implementation**: `src/routes/public/accounts.js:157`

**How it works**:
```
DELETE /accounts/me
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Soft deletes account (sets metadata.deleted_at)
→ Disconnects all connected social accounts
→ Returns subscription notice
→ Data retained for compliance/audit purposes
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "message": "Account deleted successfully",
    "disconnected_platforms": 2,
    "subscription_notice": "Please note: We cannot automatically cancel your subscription. Please manage your subscription through your payment provider (App Store, Google Play, or Stripe)."
  }
}
```

**What happens on deletion**:
- ✅ Account soft deleted (metadata.deleted_at timestamp added)
- ✅ All connected accounts deactivated (is_active = false)
- ✅ Disconnection timestamps added to each platform
- ✅ Data retained for compliance (no hard delete)
- ✅ User notified to manually cancel subscription

**Additional account endpoints**:
- `GET /accounts/me` - Get current account details
- `PATCH /accounts/me` - Update account metadata
- `POST /accounts/me/regenerate-display-name` - Regenerate display name

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

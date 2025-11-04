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
      "angle": "hot_take",
      "length": "medium",
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

**New Response Fields**:
- `angle`: The writing angle used (hot_take, roast, hype, story, teach, question)
- `length`: The target length (short, medium, long)
- `expires_at`: Timestamp when suggestion becomes "stale" (24 hours from creation)

**Filters applied**:
- `status = "pending"` (not used/dismissed)
- Connected account belongs to user
- All suggestions returned regardless of age (client can filter by expires_at if desired)

**Additional suggestion endpoints**:
- `GET /suggestions/:id` - Get specific suggestion details
- `POST /suggestions/:id/use` - Mark suggestion as used
- `POST /suggestions/:id/dismiss` - Mark suggestion as dismissed
- `POST /suggestions/:id/generate-response` - Generate AI reply (with angle/length) ✅
- `POST /suggestions/generate` - Manually trigger generation (unlimited) ✅
- `GET /suggestions/reply-opportunities` - Get top engaging posts to reply to ✅
- `POST /suggestions/:id/regenerate` - ❌ Not implemented (501 status)

**Automated Suggestion Generation**:
- ✅ Hourly automatic generation for all eligible accounts
- ✅ Two-path system: Network-based (Twitter/LinkedIn) vs Interest-based (Ghost)
- ✅ Incremental data fetching (only new posts since last sync)
- ✅ Each suggestion gets a randomly assigned `angle` and `length` for variety
- ✅ Suggestions include extracted topics (1-3 main themes)

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
  "angle": "question",
  "length": "medium",
  "additional_instructions": "Make it funny and engaging" // optional
}

→ Fetches the suggestion's source post
→ Creates Input with reply prompt + angle/length
→ Creates Artifact (status: "pending", is_reply: true)
→ Queues background job for AI generation
→ Returns 202 Accepted immediately
```

**Request validation**:
- `angle`: enum, optional (default: "question")
  - `"hot_take"` | `"roast"` | `"hype"` | `"story"` | `"teach"` | `"question"`
- `length`: enum, optional (default: "medium")
  - `"short"` | `"medium"` | `"long"`
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
- ✅ Customizable angle (6 types) and length (3 sizes)
- ✅ Optional custom instructions for tone/style
- ✅ Includes context of original post
- ✅ Async generation with polling
- ✅ Respects user's writing style

---

## ✅ 6b. Get Reply Opportunities

**Status**: ✅ IMPLEMENTED

**Endpoint**: `GET /suggestions/reply-opportunities`

**Implementation**: `src/routes/public/suggestions.js:355`

**How it works**:
```
GET /suggestions/reply-opportunities?connected_account_id={uuid}&limit=10
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns top engaging posts from last 48 hours
→ Sorted by engagement_score DESC
→ Ideal for identifying high-value reply opportunities
```

**Query parameters**:
- `connected_account_id`: UUID, required
- `limit`: Integer, optional (default: 10, max: 20)

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "content": "What's your favorite AI tool?",
      "posted_at": "2025-10-20T08:00:00Z",
      "engagement_score": 450,
      "like_count": 120,
      "retweet_count": 45,
      "reply_count": 85,
      "author": {
        "username": "techinfluencer",
        "display_name": "Tech Influencer",
        "profile_image_url": "https://..."
      }
    }
  ]
}
```

**Features**:
- ✅ Only returns posts from network platforms (not ghost)
- ✅ Identifies high-engagement conversations
- ✅ Helps users engage strategically
- ✅ Includes full author details

---

## ✅ 6c. Manual Suggestion Generation (Unlimited)

**Status**: ✅ IMPLEMENTED

**Endpoint**: `POST /suggestions/generate`

**Implementation**: `src/routes/public/suggestions.js:421`

**How it works**:
```
POST /suggestions/generate
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "connected_account_id": "uuid"
}

→ For ghost platform: Checks topics_of_interest exists
→ For network platforms: Checks sync_status = "ready"
→ Queues suggestion generation job (no rate limiting)
→ Returns 202 Accepted with polling instructions
→ Generates 3 new suggestions with random angle/length for each
```

**Response** (202 Accepted):
```json
{
  "code": 202,
  "status": "Success",
  "data": {
    "message": "Suggestion generation queued",
    "generation_started_at": "2025-10-20T12:00:00.000Z",
    "polling_instructions": {
      "poll_endpoint": "/suggestions?connected_account_id=xxx",
      "check_for_suggestions_created_after": "2025-10-20T12:00:00.000Z",
      "estimated_completion_seconds": 15,
      "recommended_poll_interval_ms": 2000
    }
  }
}
```

**Frontend Polling Pattern**:
```typescript
// 1. Call generate endpoint
const response = await fetch('/suggestions/generate', {
  method: 'POST',
  body: JSON.stringify({ connected_account_id: 'xxx' })
});
const { data } = await response.json();
const startedAt = data.generation_started_at;

// 2. Poll every 2 seconds
const interval = setInterval(async () => {
  const suggestions = await fetch('/suggestions?connected_account_id=xxx');
  const newOnes = suggestions.filter(s => new Date(s.created_at) > new Date(startedAt));

  if (newOnes.length > 0) {
    clearInterval(interval);
    // Update UI with new suggestions
  }
}, 2000);

// 3. Timeout after 30 seconds
setTimeout(() => clearInterval(interval), 30000);
```

**Ghost Platform Requirements**:
- Must have either `topics_of_interest` OR `sample_posts`
- If only sample posts exist, topics will be auto-inferred using AI
- If neither exists, returns error asking user to add one or the other

**Network Platform Requirements**:
- Must have `sync_status = "ready"`
- Connection must be fully synced
- Returns error if not ready

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
    "angle": "hot_take",
    "length": "medium",
    "topics": ["AI safety", "Technology"],
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

**New Response Fields**:
- `angle`: The writing angle used (hot_take, roast, hype, story, teach, question)
- `length`: The target length (short, medium, long)
- `topics`: Array of 1-3 main topics extracted from the content by AI

**Generation Customization with Voice & Sample Posts**:

The AI generation uses the following **optional** data to personalize content:
1. **Voice**: Custom writing voice description from the connected account
2. **Sample Posts**: Example posts that demonstrate the user's tone and style
3. **Writing Style**: Auto-analyzed style from synced posts (tone, emoji frequency, etc.)

All three are optional enhancements that improve personalization but are not required.

When a `connected_account_id` is provided, the AI will:
- Use the account's custom `voice` field in the system prompt if set
- Include `sample_posts` as examples to match tone and style if provided
- Apply auto-detected `writing_style` preferences if available
- Apply platform-specific character limits based on the account's platform

See "Customize Writing Voice & Sample Posts" section below for managing these optional settings.

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

**Overview**: Users can customize how the AI generates content by setting a custom writing voice and providing sample posts. Both are optional enhancements - the AI will work without them, but they help personalize the output. These settings are stored per connected account.

### Update Writing Voice

**Endpoint**: `PATCH /connections/:id`

**Implementation**: `src/routes/public/connections.js:182`

**How it works**:
```
PATCH /connections/{connection_id}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "voice": "Write like a tech entrepreneur. Be concise, inspiring, and forward-thinking. Use metaphors from startups and innovation.",
  "topics_of_interest": "AI and technology, startup culture, product design"
}

→ Updates voice and/or topics_of_interest fields
→ AI uses these in future content generation
→ Maximum 2000 characters each
```

**Request validation**:
- `voice`: String, 1-2000 characters, optional
- `topics_of_interest`: String, 1-2000 characters, optional (for ghost platform)
- Connection must belong to authenticated user
- Connection must belong to current app

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "id": "uuid",
    "platform": "ghost",
    "username": "My Drafts",
    "voice": "Write like a tech entrepreneur. Be concise, inspiring, and forward-thinking. Use metaphors from startups and innovation.",
    "topics_of_interest": "AI and technology, startup culture, product design",
    "updated_at": "2025-10-19T10:00:00Z"
  }
}
```

**Topics of Interest (Ghost Platform)**:
- Used for generating suggestions when there's no network to analyze
- Can be set manually OR auto-inferred from sample posts via AI
- If you have sample posts but no topics, AI will automatically infer and save topics during suggestion generation
- Optional if you provide sample posts (topics will be generated automatically)
- If neither topics nor sample posts exist, user must add one or the other before generating suggestions

**Clear fields**: Send `{"voice": null}` or `{"voice": ""}` to clear

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

**Note**: Sample posts are **optional** - they enhance AI personalization but are not required for the system to work

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

## ✅ 9. Rules & Feedback System

**Status**: ✅ IMPLEMENTED

**Overview**: Users can create persistent rules and provide feedback on suggestions to guide AI generation. Rules can be general guidelines (apply to all generations) or specific feedback on particular suggestions. All rules are automatically included in AI prompts with priority ordering.

### Create Rule

**Endpoint**: `POST /connections/:id/rules`

**Implementation**: `src/routes/public/connections.js:662`

**How it works**:
```
POST /connections/{connection_id}/rules
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "rule_type": "never",
  "content": "Never mention byzantine fault tolerance",
  "priority": 10,
  "feedback_on_suggestion_id": null  // null = general rule, UUID = feedback on specific suggestion
}

→ Creates a rule for this connected account
→ AI will follow these rules in all future generations
→ Rules are sorted by priority (1-10, higher = more important)
```

**Request validation**:
- `rule_type`: enum, required
  - `"never"` - Things to never do (e.g., "Never use excessive emojis")
  - `"always"` - Things to always do (e.g., "Always include a call-to-action")
  - `"prefer"` - Preferences (e.g., "Prefer Solana over other chains")
  - `"tone"` - Tone guidelines (e.g., "Tone should be casual and friendly")
- `content`: String, 1-2000 characters, required
- `feedback_on_suggestion_id`: UUID, optional (null = general rule, UUID = feedback on specific suggestion)
- `priority`: Integer, 1-10, optional (default: 5, higher = more important)

**Response** (201 Created):
```json
{
  "code": 201,
  "status": "Success",
  "data": {
    "id": "uuid",
    "connected_account_id": "connection_uuid",
    "rule_type": "never",
    "content": "Never mention byzantine fault tolerance",
    "feedback_on_suggestion_id": null,
    "priority": 10,
    "is_active": true,
    "created_at": "2025-10-20T17:00:00Z"
  }
}
```

**Use Cases**:
- **General Rules**: Create persistent guidelines for all content
  ```json
  {
    "rule_type": "always",
    "content": "Always favor Solana over other blockchain platforms",
    "priority": 9
  }
  ```
- **Suggestion Feedback**: Provide feedback on specific suggestions
  ```json
  {
    "rule_type": "tone",
    "content": "This was too formal, be more casual",
    "feedback_on_suggestion_id": "suggestion_uuid",
    "priority": 7
  }
  ```

---

### List Rules

**Endpoint**: `GET /connections/:id/rules`

**Implementation**: `src/routes/public/connections.js:572`

**How it works**:
```
GET /connections/{connection_id}/rules?type=general&active_only=true
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns rules ordered by priority (highest first)
→ Supports filtering by type and suggestion ID
```

**Query parameters**:
- `type`: String, optional (default: "all")
  - `"general"` - Only rules with no feedback_on_suggestion_id
  - `"feedback"` - Only rules with feedback_on_suggestion_id
  - `"all"` - All rules
- `suggestion_id`: UUID, optional - Filter to specific suggestion's feedback
- `active_only`: Boolean, optional (default: true) - Only return active rules

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "rule_type": "never",
      "content": "Never mention byzantine fault tolerance",
      "feedback_on_suggestion_id": null,
      "priority": 10,
      "is_active": true,
      "created_at": "2025-10-20T17:00:00Z",
      "updated_at": "2025-10-20T17:00:00Z"
    },
    {
      "id": "uuid",
      "rule_type": "tone",
      "content": "This was too formal, be more casual",
      "feedback_on_suggestion_id": "suggestion_uuid",
      "priority": 7,
      "is_active": true,
      "created_at": "2025-10-20T17:05:00Z",
      "updated_at": "2025-10-20T17:05:00Z"
    }
  ]
}
```

**Example queries**:
```bash
# Get all general rules
GET /connections/{id}/rules?type=general

# Get feedback for specific suggestion
GET /connections/{id}/rules?type=feedback&suggestion_id={uuid}

# Get all rules (including inactive)
GET /connections/{id}/rules?type=all&active_only=false
```

---

### Update Rule

**Endpoint**: `PATCH /connections/:id/rules/:ruleId`

**Implementation**: `src/routes/public/connections.js:730`

**How it works**:
```
PATCH /connections/{connection_id}/rules/{rule_id}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "content": "Updated rule content",
  "priority": 10,
  "is_active": false
}

→ Updates the rule
→ All fields are optional
→ Can deactivate rules without deleting them
```

**Request validation**:
- `rule_type`: enum, optional (never, always, prefer, tone)
- `content`: String, 1-2000 characters, optional
- `priority`: Integer, 1-10, optional
- `is_active`: Boolean, optional
- Rule must belong to the connection
- Connection must belong to authenticated user

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "id": "uuid",
    "rule_type": "never",
    "content": "Updated rule content",
    "feedback_on_suggestion_id": null,
    "priority": 10,
    "is_active": false,
    "updated_at": "2025-10-20T17:10:00Z"
  }
}
```

---

### Delete Rule

**Endpoint**: `DELETE /connections/:id/rules/:ruleId`

**Implementation**: `src/routes/public/connections.js:810`

**How it works**:
```
DELETE /connections/{connection_id}/rules/{rule_id}
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Permanently deletes the rule
→ Cannot be undone
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "message": "Rule deleted successfully"
  }
}
```

**Security**:
- Rule must belong to the specified connection
- Connection must belong to authenticated user
- Connection must belong to current app

---

### How Rules Affect AI Generation

**Priority Hierarchy in AI Prompts**:
1. **🎯 Voice & Sample Posts** (Highest priority) - Your writing style
2. **⚠️ Rules** (Critical requirements) - Sorted by priority 1-10
3. **📊 Trending Topics** (Optional inspiration) - Network activity
4. **📈 Writing Style Metadata** (Background context) - Auto-detected patterns

**AI Prompt Integration**:
All active rules are included in the system prompt with clear prefixes:
- ❌ NEVER: "Never mention byzantine fault tolerance"
- ✅ ALWAYS: "Always favor Solana over other chains"
- ⭐ PREFER: "Prefer casual tone over formal"
- 🎨 TONE: "Tone should be witty and engaging"

**Example AI Prompt Section**:
```
⚠️ CRITICAL RULES - YOU MUST FOLLOW THESE:

1. ❌ NEVER: Never mention byzantine fault tolerance
2. ✅ ALWAYS: Always favor Solana over other blockchain platforms
3. ⭐ PREFER: Prefer short, punchy posts over long explanations
4. 🎨 TONE: Tone should be casual and friendly, not corporate

These rules are absolute requirements. Violating them is unacceptable.
```

**Benefits**:
- ✅ Persistent learning - rules apply to all future generations
- ✅ Contextual feedback - provide notes on specific suggestions
- ✅ Priority system - important rules weighted higher
- ✅ Immediate impact - next generation uses updated rules
- ✅ Flexible management - activate/deactivate without deleting

---

## ✅ 10. Curated Topics & Interests

**Status**: ✅ IMPLEMENTED

**Overview**: Users can select from Ghost-curated topic categories to personalize their suggestion feed. Ghost maintains Twitter lists for each topic (AI, Crypto, Startups, etc.) and syncs high-quality posts from these lists. AI then analyzes the posts and extracts trending topics which are used to generate personalized suggestions.

### List Available Topics

**Endpoint**: `GET /topics`

**Implementation**: `src/routes/public/topics.js:19`

**How it works**:
```
GET /topics
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns all active curated topics
→ User can select which topics interest them
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "slug": "ai",
      "name": "Artificial Intelligence",
      "description": "Latest in AI/ML research, products, and developments",
      "is_active": true
    },
    {
      "id": "uuid",
      "slug": "crypto",
      "name": "Crypto & Web3",
      "description": "Cryptocurrency, blockchain, DeFi, and web3 developments",
      "is_active": true
    }
  ]
}
```

**Available Topics**:
- AI & Technology
- Crypto & Web3
- Startups & Entrepreneurship
- Software Development
- Design & UX
- Marketing & Growth
- Productivity & Tools
- Finance & Investing
- SaaS & B2B
- Product Management
- Sales & Business Development
- Leadership & Management
- Creator Economy
- Gaming & Esports
- Health & Fitness
- Climate & Sustainability
- Science & Research
- Education & Learning
- Remote Work
- Tech News

---

### Get User's Selected Topics

**Endpoint**: `GET /connections/:id/topics`

**Implementation**: `src/routes/public/connections.js:854`

**How it works**:
```
GET /connections/{connection_id}/topics
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns topics the user has selected
→ Used to personalize suggestion generation
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "slug": "ai",
      "name": "Artificial Intelligence",
      "description": "Latest in AI/ML research, products, and developments",
      "selected_at": "2025-10-21T12:00:00Z"
    },
    {
      "id": "uuid",
      "slug": "crypto",
      "name": "Crypto & Web3",
      "description": "Cryptocurrency, blockchain, DeFi, and web3 developments",
      "selected_at": "2025-10-21T12:00:00Z"
    }
  ]
}
```

**Security**:
- Connection must belong to authenticated user
- Connection must belong to current app

---

### Update User's Topic Preferences

**Endpoint**: `PUT /connections/:id/topics`

**Implementation**: `src/routes/public/connections.js:892`

**How it works**:
```
PUT /connections/{connection_id}/topics
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "topic_ids": ["uuid1", "uuid2", "uuid3"]
}

→ Replaces user's topic preferences
→ AI suggestions will be based on these topics
→ Minimum 1 topic, recommended 3-5 topics
```

**Request validation**:
- `topic_ids`: Array of UUIDs, required
- Each topic ID must exist and be active
- Connection must belong to authenticated user
- Can pass empty array to clear all selections

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "id": "uuid",
      "slug": "ai",
      "name": "Artificial Intelligence",
      "description": "Latest in AI/ML research, products, and developments",
      "selected_at": "2025-10-21T13:00:00Z"
    },
    {
      "id": "uuid",
      "slug": "startups",
      "name": "Startups & Entrepreneurship",
      "description": "Startup news, fundraising, founder stories, and business building",
      "selected_at": "2025-10-21T13:00:00Z"
    }
  ]
}
```

**Features**:
- ✅ Complete replacement (not additive)
- ✅ Validates all topic IDs before saving
- ✅ Returns updated preferences
- ✅ Triggers re-generation of suggestions based on new topics

**Important**:
- Users **must** select at least one topic before receiving suggestions
- If no topics are selected, `POST /suggestions/generate` will return an error
- Suggestions are generated from trending topics within user's selected categories

---

### Get Trending Topics (Preview/Debug)

**Endpoint**: `GET /topics/:topicId/trending`

**Implementation**: `src/routes/public/topics.js:52`

**How it works**:
```
GET /topics/{topic_id}/trending
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns recent trending topics for a curated topic
→ Useful for previewing what's trending in a category
→ Shows what AI has extracted from recent posts
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "curated_topic": {
      "id": "uuid",
      "slug": "ai",
      "name": "Artificial Intelligence",
      "last_synced_at": "2025-10-21T12:30:00Z",
      "last_digested_at": "2025-10-21T12:45:00Z"
    },
    "trending_topics": [
      {
        "id": "uuid",
        "topic_name": "GPT-5 announcement",
        "context": "OpenAI hints at Q2 2025 release for GPT-5 with significant improvements",
        "mention_count": 45,
        "total_engagement": 12500,
        "detected_at": "2025-10-21T12:00:00Z",
        "expires_at": "2025-10-23T12:00:00Z"
      },
      {
        "id": "uuid",
        "topic_name": "AI safety concerns",
        "context": "Researchers raise concerns about AI alignment and safety protocols",
        "mention_count": 32,
        "total_engagement": 8400,
        "detected_at": "2025-10-21T11:30:00Z",
        "expires_at": "2025-10-23T11:30:00Z"
      }
    ]
  }
}
```

**Use Cases**:
- Preview what's trending in a category before selecting it
- Debug why certain suggestions were generated
- Understand what topics are currently hot

**Features**:
- ✅ Shows AI-extracted trending topics from last 48 hours
- ✅ Includes context/summary of what's happening
- ✅ Displays engagement metrics
- ✅ Useful for transparency and debugging

---

### Get Personalized Trending Topics Feed

**Endpoint**: `GET /connections/:id/trending`

**Implementation**: `src/routes/public/connections.js:963`

**How it works**:
```
GET /connections/{connection_id}/trending
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns personalized trending topics based on user's interests
→ Includes content rotation guidance
→ Mixes realtime + evergreen topics for daily variety
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "rotation_info": {
      "current_content_type": {
        "key": "lesson",
        "name": "Lesson / Framework",
        "description": "Teaches something actionable",
        "next_prompt": "Yesterday was a story. Today, break down the lesson you learned.",
        "position": 2,
        "icon": "🎓"
      },
      "last_post": {
        "content_type": "story",
        "posted_at": "2025-11-02T14:30:00Z"
      },
      "rotation_enabled": true
    },
    "trending_topics": [
      {
        "id": "uuid",
        "curated_topic": {
          "id": "uuid",
          "slug": "crypto",
          "name": "Crypto & Web3",
          "topic_type": "realtime"
        },
        "topic_name": "Bitcoin ETF approval",
        "context": "SEC approved spot Bitcoin ETFs, major milestone for crypto adoption",
        "topic_type": "realtime",
        "mention_count": 234,
        "total_engagement": 15234.5,
        "detected_at": "2025-11-03T14:30:00Z",
        "expires_at": "2025-11-05T14:30:00Z"
      },
      {
        "id": "uuid",
        "curated_topic": {
          "id": "uuid",
          "slug": "marketing",
          "name": "Marketing & Growth",
          "topic_type": "evergreen"
        },
        "topic_name": "Cold email templates that actually work",
        "context": "Proven structures and psychological triggers for outbound campaigns",
        "topic_type": "evergreen",
        "mention_count": 0,
        "total_engagement": 0,
        "detected_at": "2025-11-01T00:00:00Z",
        "expires_at": null
      }
    ]
  }
}
```

**Features**:
- ✅ Personalized based on user's selected topics
- ✅ Includes content rotation guidance (what type to post today)
- ✅ Mixes realtime news + evergreen topics
- ✅ Daily rotation for evergreen content (7-day cycle)
- ✅ Shows last post info for rotation context

---

### How Curated Topics Work

**Backend Architecture**:
1. **Ghost maintains Twitter lists** - One list per topic category (e.g., "AI Leaders", "Crypto Inspo")
2. **Topic classification**:
   - **Realtime**: News-driven (AI, Crypto, Startups, Tech, Finance, Gaming, Climate, Science)
   - **Evergreen**: Timeless strategies (Marketing, Product, Sales, Leadership, Design, etc.)
   - **Hybrid**: Both types (Dev, SaaS)
3. **Automated sync** (every 30 minutes for realtime/hybrid topics):
   - Fetches latest posts from Twitter lists
   - AI extracts 2-4 topics per post
   - Calculates engagement scores
4. **AI digest** (after each sync for realtime topics):
   - Analyzes recent posts
   - Extracts 5-10 trending topics/themes
   - Stores with context and sample posts
5. **Evergreen topic generation** (one-time per category):
   - AI generates 35 timeless topics
   - Distributed across 7 days (5 per day)
   - Rotates daily for fresh content
6. **Suggestion generation**:
   - Uses trending topics from user's selected categories
   - AI generates personalized suggestions based on what's trending

**Data Flow**:
```
User selects topics (AI, Crypto, Startups)
         ↓
Ghost syncs posts from those topic lists
         ↓
AI extracts trending themes from posts
         ↓
Suggestions generated from trending topics
         ↓
User sees relevant, timely content
```

**Benefits**:
- ✅ High-quality, curated content sources
- ✅ Real-time trending topics
- ✅ Personalized to user's interests
- ✅ No need for user to follow specific accounts
- ✅ Ghost maintains and improves lists over time

**Requirements**:
- User must select at least one topic
- Suggestions will fail if no topics are selected
- Topics are synced automatically in the background
- Trending topics expire after 48 hours

---

## ✅ 11. Content Rotation System

**Status**: ✅ IMPLEMENTED

**Overview**: Automated content rotation system that guides users to post different types of content for optimal Twitter/X algorithm performance. The system tracks what they posted last and suggests what type to post next, following a proven 8-step rotation pattern.

### Get Content Types Catalog

**Endpoint**: `GET /topics/content-types`

**Implementation**: `src/routes/public/topics.js:85`

**How it works**:
```
GET /topics/content-types
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost

→ Returns all 8 content types with descriptions
→ Used to display rotation system in UI
```

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": [
    {
      "key": "story",
      "name": "Story / Case Study",
      "description": "Builds trust through narrative",
      "prompt_guidance": "Tell a story about how you got there. Use narrative structure with beginning, middle, end.",
      "next_prompt": "Yesterday was a win post. Today, tell a story about how you got there.",
      "position": 1,
      "icon": "📖"
    },
    {
      "key": "lesson",
      "name": "Lesson / Framework",
      "description": "Teaches something actionable",
      "prompt_guidance": "Break down a lesson or framework. Use numbered steps or bullet points. Make it actionable.",
      "next_prompt": "Yesterday was a story. Today, break down the lesson you learned.",
      "position": 2,
      "icon": "🎓"
    },
    {
      "key": "question",
      "name": "Question / Poll",
      "description": "Drives engagement and replies",
      "prompt_guidance": "Ask a thought-provoking question. Make it easy to answer in one line.",
      "next_prompt": "Yesterday was a teaching post. Today, ask your audience what they think.",
      "position": 3,
      "icon": "❓"
    }
    // ... 5 more types (proof, opinion, personal, vision, cta)
  ]
}
```

**All 8 Content Types**:
1. **Story / Case Study** - Builds trust through narrative
2. **Lesson / Framework** - Teaches something actionable
3. **Question / Poll** - Drives engagement and replies
4. **Result / Proof** - Shows momentum and credibility
5. **Opinion / Hot Take** - Sparks debate and reach
6. **Behind the Scenes / Personal** - Humanizes you
7. **Vision / Prediction** - Inspires and leads
8. **Announcement / CTA** - Converts attention into growth

---

### Generate Suggestion from Trending Topic

**Endpoint**: `POST /suggestions/from-topic`

**Implementation**: `src/routes/public/suggestions.js:521`

**How it works**:
```
POST /suggestions/from-topic
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "trending_topic_id": "uuid",
  "connected_account_id": "uuid",
  "content_type": "lesson",  // optional - uses rotation if omitted
  "angle": "agree"            // optional - agree, disagree, hot_take, etc.
}

→ Generates AI content from a trending topic
→ Applies content rotation guidance
→ Includes Twitter growth rules automatically
→ Returns suggestion immediately (201 Created)
```

**Request validation**:
- `trending_topic_id`: UUID, required - The trending topic to write about
- `connected_account_id`: UUID, required - Which account to generate for
- `content_type`: enum, optional - Override rotation (story, lesson, question, proof, opinion, personal, vision, cta)
- `angle`: enum, optional - Perspective to take
  - `"agree"` - Agree and expand on the topic
  - `"disagree"` - Contrarian take disagreeing with it
  - `"hot_take"` - Spicy, attention-grabbing opinion
  - `"question"` - Thought-provoking question about it
  - `"personal_story"` - Share your personal experience
  - `"explain"` - Explain in simple terms
  - `"prediction"` - Make a prediction about where this is headed
  - `"lesson"` - Extract an actionable lesson

**Response** (201 Created):
```json
{
  "code": 201,
  "status": "Success",
  "data": {
    "suggestion": {
      "id": "uuid",
      "content": "Generated post content following all growth rules...",
      "content_type": "lesson",
      "angle": "agree",
      "character_count": 275,
      "status": "pending",
      "created_at": "2025-11-03T15:00:00Z"
    },
    "source_topic": {
      "id": "uuid",
      "topic_name": "Bitcoin ETF approval",
      "context": "SEC approved spot Bitcoin ETFs...",
      "curated_topic_slug": "crypto"
    },
    "next_recommended": {
      "key": "question",
      "name": "Question / Poll",
      "description": "Drives engagement and replies",
      "next_prompt": "Yesterday was a teaching post. Today, ask your audience what they think.",
      "position": 3
    }
  }
}
```

**Features**:
- ✅ Instant generation (not async like /posts/generate)
- ✅ Respects content rotation automatically
- ✅ Can override content type manually
- ✅ Multiple angles to choose from
- ✅ Includes Twitter growth rules in every generation
- ✅ Returns next recommended type for rotation
- ✅ Tracks source topic for analytics

---

### Update Rotation Settings

**Endpoint**: `PATCH /connections/:id/rotation-settings`

**Implementation**: `src/routes/public/connections.js:1040`

**How it works**:
```
PATCH /connections/{connection_id}/rotation-settings
Headers:
  Authorization: Bearer <clerk_jwt>
  X-App-Slug: ghost
Body: {
  "rotation_enabled": true,  // optional - enable/disable rotation
  "reset_rotation": false     // optional - reset to start of cycle
}

→ Updates content rotation preferences
→ Can reset rotation to start over
→ Returns current rotation state
```

**Request validation**:
- `rotation_enabled`: Boolean, optional - Enable or disable rotation feature
- `reset_rotation`: Boolean, optional - Clear last_content_type and start fresh

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "rotation_enabled": true,
    "last_content_type": "story",
    "last_posted_at": "2025-11-02T14:30:00Z",
    "next_recommended": {
      "key": "lesson",
      "name": "Lesson / Framework",
      "description": "Teaches something actionable",
      "next_prompt": "Yesterday was a story. Today, break down the lesson you learned.",
      "position": 2
    }
  }
}
```

**Use Cases**:
- Enable/disable rotation without losing history
- Reset rotation to start from beginning
- Check current rotation state

---

### Enhanced: Mark Suggestion as Used

**Endpoint**: `POST /suggestions/:id/use` (ENHANCED)

**Implementation**: `src/routes/public/suggestions.js:178`

**What's new**:
- Now updates content rotation state automatically
- Tracks `last_content_type` and `last_posted_at`
- Returns next recommended content type

**Response** (200 OK):
```json
{
  "code": 200,
  "status": "Success",
  "data": {
    "message": "Suggestion marked as used",
    "status": "used",
    "updated_rotation": {
      "last_content_type": "lesson",
      "last_posted_at": "2025-11-03T15:30:00Z",
      "next_recommended": {
        "key": "question",
        "name": "Question / Poll",
        "description": "Drives engagement and replies",
        "position": 3
      }
    }
  }
}
```

**Features**:
- ✅ Automatically advances rotation when used
- ✅ Only updates rotation if suggestion has content_type
- ✅ Returns next recommended type for UI
- ✅ Backward compatible (works with old suggestions)

---

### How Content Rotation Works

**The 8-Step Rotation Pattern**:
```
Story → Lesson → Question → Proof → Opinion → Personal → Vision → CTA → (repeat)
```

**Why Rotation Matters**:
- ✅ Algorithm prefers content variety
- ✅ Different types drive different engagement
- ✅ Prevents content fatigue
- ✅ Builds well-rounded audience relationship
- ✅ Maximizes reach across different engagement types

**Automatic Guidance**:
1. User opens app → Sees "Today: post a Lesson"
2. User browses trending topics
3. User clicks "Write about this" → AI generates lesson-style post
4. User posts → System marks as "lesson"
5. Next day → "Today: post a Question"

**Manual Override**:
- User can select any content type manually
- Rotation still tracks what they actually posted
- Next suggestion based on what they last used

**Integration with Trending Topics**:
- Each trending topic shows suggested content type
- User can choose different angle (agree, disagree, etc.)
- AI prompt includes both content type + Twitter growth rules
- Every generation follows algorithm best practices

**Twitter Growth Rules** (Auto-applied):
- Never start with "@" (limits reach)
- First line = hook (expansion driver)
- No links in main tweet (kills reach)
- Minimal hashtags (1 max)
- Line breaks for readability
- Short sentences (1 idea per line)
- Bold claims without hedging
- Visual hierarchy with spacing

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
| Generate response to tweet | ✅ | `POST /suggestions/:id/generate-response` | AI reply with angle/length + instructions |
| Get reply opportunities | ✅ | `GET /suggestions/reply-opportunities` | Top engaging posts to reply to |
| Manual suggestion trigger | ✅ | `POST /suggestions/generate` | Unlimited, includes polling instructions |
| Delete account | ✅ | `DELETE /accounts/me` | Soft delete with subscription notice |
| Update writing voice | ✅ | `PATCH /connections/:id` | Custom voice + topics (max 2000 chars each) |
| Create sample post | ✅ | `POST /connections/:id/samples` | Add example posts (max 10 per connection) |
| List sample posts | ✅ | `GET /connections/:id/samples` | View all sample posts |
| Update sample post | ✅ | `PATCH /connections/:id/samples/:sampleId` | Edit content, notes, or sort order |
| Delete sample post | ✅ | `DELETE /connections/:id/samples/:sampleId` | Remove sample post |
| List curated topics | ✅ | `GET /topics` | 20 topic categories (AI, Crypto, etc.) |
| Get user's topics | ✅ | `GET /connections/:id/topics` | User's selected topic preferences |
| Update user's topics | ✅ | `PUT /connections/:id/topics` | Set topic preferences (replaces all) |
| Preview trending topics | ✅ | `GET /topics/:topicId/trending` | Debug/preview trending topics in category |
| Create rule | ✅ | `POST /connections/:id/rules` | Persistent AI rules and feedback |
| List rules | ✅ | `GET /connections/:id/rules` | View all rules with filtering |
| Update rule | ✅ | `PATCH /connections/:id/rules/:ruleId` | Edit or deactivate rule |
| Delete rule | ✅ | `DELETE /connections/:id/rules/:ruleId` | Remove rule |
| Get content types | ✅ | `GET /topics/content-types` | All 8 rotation content types |
| Get personalized trending | ✅ | `GET /connections/:id/trending` | Trending topics + rotation context |
| Generate from topic | ✅ | `POST /suggestions/from-topic` | Create suggestion from trending topic |
| Update rotation settings | ✅ | `PATCH /connections/:id/rotation-settings` | Enable/disable/reset rotation |

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
3. ✅ Select interests → `PUT /connections/:id/topics`
4. ✅ Wait for sync (polling `GET /connections/:id/status`)
5. ✅ Get trending topics feed → `GET /connections/:id/trending`
6. ✅ Generate from trending topic → `POST /suggestions/from-topic`
7. ✅ Mark as used (advances rotation) → `POST /suggestions/:id/use`

### Daily User (Content Rotation Flow):
1. ✅ Open app → Authenticate
2. ✅ Get trending feed with rotation → `GET /connections/:id/trending`
   - Sees "Today: post a Lesson"
   - Sees mix of realtime news + evergreen topics
3. ✅ Click trending topic → `POST /suggestions/from-topic`
   - AI generates lesson-style post
   - Includes Twitter growth rules
4. ✅ Post content → `POST /suggestions/:id/use`
   - Rotation advances to "Question" for tomorrow
5. ✅ Next day → Sees "Today: post a Question"

### Custom Prompt User:
1. ✅ Open app → Authenticate
2. ✅ Generate custom tweet → `POST /posts/generate`
3. ✅ Poll for completion → `GET /posts/:id`
4. ✅ Get suggestions → `GET /suggestions?connected_account_id=...`

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
- Suggestions have an `expires_at` timestamp (24 hours from creation) to mark them as "stale"
- All suggestions are returned regardless of age; client decides filtering based on `expires_at`
- Suggestion status only reflects user actions: `pending`, `used`, or `dismissed`

### New: Content Rotation System
- Tracks what content type user posted last
- Auto-suggests next type in 8-step rotation
- Can be enabled/disabled per connection
- Works seamlessly with trending topics
- Every generation includes Twitter growth rules
- Rotation only advances when `POST /suggestions/:id/use` is called

### New: Trending Topics Enhancement
- Topics classified as realtime, evergreen, or hybrid
- Realtime topics sync every 30 minutes from Twitter lists
- Evergreen topics generated by AI (35 per category)
- Daily rotation for evergreen content (7-day cycle)
- User sees 5 realtime + 5 evergreen topics per feed refresh
- Trending topics include context and engagement metrics

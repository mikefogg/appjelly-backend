# MVP Frontend API Mapping

This document maps each page in the SnuggleBug Stories app flow to specific backend endpoints and the data required for each screen.

---

## 📱 Page-by-Page API Mapping

### 1. **Welcome Screen**
**Purpose:** Branded intro with "Create Your Story" CTA

**API Calls:**
- `GET /app/config` - Get app configuration and branding
- `GET /accounts/me` - Check if user has account (optional, for returning users)

**Data Sent:** 
- App slug in X-App-Slug header

**Data Received:**
```json
{
  "data": {
    "id": "uuid",
    "slug": "snugglebug", 
    "name": "SnuggleBug Stories",
    "config": {
      "branding": {
        "primary_color": "#FF6B6B",
        "logo_url": "https://...",
        "welcome_text": "Create magical stories..."
      },
      "features": ["stories", "sharing", "images"]
    }
  }
}
```

---

### 2. **Sample Story**
**Purpose:** Preview experience with example story

**API Calls:**
- `GET /app/sample-content` - Get sample story for onboarding

**Data Sent:**
- App slug in X-App-Slug header

**Data Received:**
```json
{
  "data": {
    "sample_stories": [
      {
        "title": "The Magic Forest Adventure",
        "preview": "Once upon a time, a brave child discovered a hidden path in their backyard that led to an enchanted forest...",
        "characters": ["Brave Explorer", "Wise Owl", "Friendly Fox"]
      }
    ],
    "sample_characters": [
      { "name": "Emma", "type": "child", "traits": ["brave", "curious"] },
      { "name": "Max", "type": "pet", "traits": ["loyal", "playful"] }
    ],
    "sample_prompts": [
      "A magical adventure in the backyard",
      "Meeting a friendly dragon"
    ]
  }
}
```

---

### 3. **Your Kids** (Character Management)
**Purpose:** Manage multiple kid profiles

**API Calls:**
- `GET /actors?type=child` - Get user's children
- `GET /account-links/actors` - Get linked family children
- `POST /actors` - Create new child (when adding)
- `DELETE /actors/:id` - Remove child

**Data Sent (for POST):**
```json
{
  "name": "Emma",
  "type": "child",
  "metadata": {
    "interests": ["dinosaurs", "art"],
    "age": 5
  }
}
```

**Data Received:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Emma", 
      "nickname": "Emma (My Daughter)",
      "type": "child",
      "is_owned": true,
      "is_linked": false,
      "media": [
        {
          "id": "uuid",
          "image_key": "cloudflare_key",
          "metadata": {"pose": "smiling"}
        }
      ],
      "metadata": {
        "interests": ["dinosaurs", "art"],
        "age": 5
      }
    }
  ]
}
```

---

### 4. **Kid Details** (Add/Edit Child)
**Purpose:** Add new child with photos and interests

**API Calls:**
- `POST /actors` - Create new child
- `POST /actors/:id/media` - Upload child photos (up to 10)
- `PATCH /actors/:id` - Update child details

**Data Sent (Create Child):**
```json
{
  "name": "Ava",
  "type": "child", 
  "metadata": {
    "age": 3,
    "interests": ["princesses", "horses"],
    "personality_traits": ["curious", "brave"]
  }
}
```

**Data Sent (Upload Photos):**
```json
{
  "media": [
    {
      "image_data": "base64_or_file",
      "metadata": {"pose": "playing", "description": "At the park"}
    }
  ]
}
```

**Data Received:**
```json
{
  "data": {
    "id": "uuid",
    "name": "Ava",
    "type": "child",
    "media": [...],
    "metadata": {...}
  }
}
```

---

### 5. **Additional Characters**
**Purpose:** Add friends, family, pets for story inclusion

**API Calls:**
- `GET /actors?type=adult,pet,imaginary` - Get non-child characters
- `POST /actors` - Create new character

**Data Sent:**
```json
{
  "name": "Grandma Betty",
  "type": "adult",
  "metadata": {
    "relationship": "grandmother",
    "traits": ["wise", "caring"]
  }
}
```

**Data Received:**
```json
{
  "data": [
    {
      "id": "uuid", 
      "name": "Josh",
      "nickname": "Josh (Soccer Friend)",
      "type": "child",
      "is_owned": false,
      "is_linked": true,
      "metadata": {"relationship": "friend"}
    },
    {
      "id": "uuid",
      "name": "Max",
      "type": "pet", 
      "is_owned": true,
      "metadata": {"species": "dog", "breed": "golden retriever"}
    }
  ]
}
```

---

### 6. **Story Library**
**Purpose:** Main hub showing saved stories

**API Calls:**
- `GET /artifacts?filter=owned` - Get user's own stories
- `GET /artifacts?filter=shared` - Get stories user appears in
- `GET /artifacts` - Get all accessible stories

**Data Sent:**
- Query parameters for filtering and pagination

**Data Received:**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Emma's Space Adventure", 
      "artifact_type": "story",
      "thumbnail_key": "cloudflare_key",
      "created_at": "2024-01-15T10:30:00Z",
      "is_owned": true,
      "main_character": "Emma",
      "characters": ["Emma", "Josh", "Alien Friend"],
      "metadata": {
        "length": "medium",
        "status": "complete",
        "has_images": true
      }
    }
  ],
  "meta": {
    "total": 15,
    "page": 1,
    "per_page": 10
  }
}
```

---

### 7. **Create Story** (Bottom Sheet Flow)
**Purpose:** Story creation with prompt and character selection

#### Screen 1: Prompt + Length
**API Calls:** None initially

**Data Captured:**
```json
{
  "prompt": "Emma and Josh explore a magical forest",
  "length": "medium",
  "metadata": {
    "tone": "adventurous",
    "setting": "fantasy"
  }
}
```

#### Screen 2: Character Inference
**API Calls:**
- `POST /inputs/:id/inference` - Detect characters in prompt

**Data Sent:**
```json
{
  "prompt": "Emma and Josh explore a magical forest"
}
```

**Data Received:**
```json
{
  "data": {
    "suggestions": [
      {
        "name": "Emma",
        "type": "child",
        "confidence": 0.95,
        "matched_actor_id": "uuid_emma"
      },
      {
        "name": "Josh", 
        "type": "child",
        "confidence": 0.85,
        "matched_actor_id": null,
        "create_suggestion": true
      }
    ],
    "existing_matches": [
      {
        "id": "uuid_emma",
        "name": "Emma",
        "is_owned": true
      }
    ],
    "ambiguous_matches": [
      {
        "name": "Josh",
        "candidates": [
          {"id": "uuid1", "nickname": "Josh (Soccer)"},
          {"id": "uuid2", "nickname": "Josh (Cousin)"}
        ]
      }
    ]
  }
}
```

#### Screen 3: Final Character Confirmation & Story Generation
**API Calls:**
- `POST /inputs` - Create story input and queue generation

**Data Sent:**
```json
{
  "prompt": "Emma and Josh explore a magical forest",
  "actor_ids": ["uuid_emma", "uuid_josh"],
  "metadata": {
    "length": "medium",
    "tone": "adventurous"
  },
  "generate_immediately": true
}
```

**Data Received:**
```json
{
  "data": {
    "id": "uuid",
    "prompt": "Emma and Josh explore a magical forest",
    "artifact": {
      "id": "uuid",
      "title": "Emma and Josh's Forest Adventure",
      "status": "generating"
    }
  }
}
```

---

### 8. **Story Page 1** (Preview)
**Purpose:** Show first page for free with paywall CTA

**API Calls:**
- `GET /artifacts/:id/pages/1` - Get first page only

**Data Received:**
```json
{
  "data": {
    "page_number": 1,
    "text": "Emma and Josh stepped into the magical forest...",
    "image_key": null,
    "layout_data": {},
    "is_preview": true,
    "total_pages": 8
  }
}
```

---

### 9. **Paywall**
**Purpose:** Subscribe to unlock full story

**API Calls:**
- `GET /subscriptions/products` - Get available subscription options
- `POST /subscriptions/paywall` - Log paywall interaction

**Data Sent:**
```json
{
  "artifact_id": "uuid",
  "action": "viewed",
  "source": "story_page_1"
}
```

**Data Received:**
```json
{
  "data": {
    "products": [
      {
        "id": "weekly_199",
        "name": "Weekly",
        "price": "$1.99",
        "period": "week",
        "trial_days": 0
      },
      {
        "id": "yearly_2999",
        "name": "Yearly", 
        "price": "$29.99",
        "period": "year",
        "trial_days": 3,
        "badge": "Best Value"
      }
    ]
  }
}
```

---

### 10. **Story Complete** (Full Text View)
**Purpose:** Full story view after subscription

**API Calls:**
- `GET /artifacts/:id/pages` - Get all story pages
- `GET /subscriptions/status` - Verify subscription access

**Data Received:**
```json
{
  "data": [
    {
      "page_number": 1,
      "text": "Emma and Josh stepped into the magical forest...",
      "image_key": "page1_image",
      "layout_data": {"text_position": "bottom"}
    },
    {
      "page_number": 2, 
      "text": "They discovered a talking owl...",
      "image_key": null,
      "layout_data": {}
    }
  ]
}
```

---

### 11. **Image Ready** (Illustrated Version)
**Purpose:** View fully illustrated story when images complete

**API Calls:**
- `GET /artifacts/:id/pages` - Refresh to get updated image_keys
- WebSocket or polling for real-time updates

**Data Received:**
```json
{
  "data": [
    {
      "page_number": 1,
      "text": "Emma and Josh stepped...",
      "image_key": "cf_image_key_1",
      "image_status": "ready"
    }
  ]
}
```

---

### 12. **Invite Friend** (Share Story)
**Purpose:** Share story with another parent

**API Calls:**
- `POST /shared-views` - Create shareable link
- `GET /artifacts/:id` - Get story details for sharing

**Data Sent:**
```json
{
  "artifact_id": "uuid",
  "permissions": {
    "can_view": true,
    "can_repersonalize": true,
    "can_claim_characters": true
  },
  "options": {
    "includeQR": true,
    "message": "Check out this story starring Emma!"
  }
}
```

**Data Received:**
```json
{
  "data": {
    "url": "https://snugglebug.com/shared/share_abc123",
    "token": "share_abc123",
    "short_url": "https://sbug.link/xyz",
    "qr_code": "data:image/png;base64,iVBOR...",
    "message": "Check out this amazing story: \"Emma's Adventure\"! Your child can be part of the adventure too! 🌟"
  }
}
```

---

### 13. **Shared Story View**
**Purpose:** Parent views story starring someone else's child

**API Calls:**
- `GET /shared-views/:token` - Access shared content

**Data Sent:**
- Token in URL path

**Data Received:**
```json
{
  "data": {
    "artifact": {
      "id": "uuid",
      "title": "Emma's Magical Adventure",
      "pages": [...],
      "characters": ["Emma", "Josh", "Max"]
    },
    "permissions": {
      "can_view": true,
      "can_repersonalize": true,
      "can_claim_characters": true
    },
    "characters": [
      {
        "id": "uuid",
        "name": "Emma", 
        "type": "child",
        "is_claimed": true,
        "claimed_by": {"id": "uuid", "name": "Sarah"}
      },
      {
        "id": "uuid",
        "name": "Josh",
        "type": "child", 
        "is_claimed": false
      }
    ]
  }
}
```

---

### 14. **Repersonalize** (Claim Character & Regenerate)
**Purpose:** Claim character and regenerate story

**API Calls:**
- `POST /shared-views/:token/claim` - Claim character in shared story
- `POST /artifacts/:id/regenerate` - Regenerate story with new perspective

**Data Sent (Claim):**
```json
{
  "character_name": "Josh",
  "actor_id": "my_josh_uuid"
}
```

**Data Sent (Regenerate):**
```json
{
  "main_character_id": "my_josh_uuid",
  "preserve_plot": true,
  "new_perspective": true
}
```

**Data Received:**
```json
{
  "data": {
    "claimed_character": {
      "id": "uuid",
      "name": "Josh",
      "linked_to_actor": "my_josh_uuid"
    },
    "new_artifact": {
      "id": "new_uuid", 
      "title": "Josh's Magical Adventure",
      "status": "generating"
    },
    "auto_linked_families": [
      {
        "id": "uuid",
        "display_name": "Sarah's Family"
      }
    ]
  }
}
```

---

## 🔧 Supporting API Endpoints

### **Settings & Account Management**
- `GET /accounts/me` - Current account details
- `PATCH /accounts/me` - Update account preferences  
- `GET /account-links` - List trusted families
- `DELETE /account-links/:id` - Remove family link
- `GET /subscriptions/status` - Current subscription status

### **Authentication**
- `POST /auth/account` - Create/get account for app
- Clerk webhooks handle user lifecycle

### **Media Management**  
- `GET /media` - List user's media with pagination
- `POST /media/upload` - Upload images with signed URLs
- `POST /media/batch-upload` - Upload multiple images
- `DELETE /media/:id` - Remove media
- `POST /media/webhook/processing-complete` - Media processing webhook

### **Content Safety**
- `POST /content-safety/report` - Report inappropriate content
- `GET /content-safety/guidelines` - Get content guidelines
- `POST /content-safety/check` - Check content safety score
- `GET /content-safety/tips` - Get safety tips for content creation

### **Enhanced Input Management**
- `PATCH /inputs/:id` - Update input prompt and metadata
- `DELETE /inputs/:id` - Delete input and related artifacts

### **Enhanced Subscription Management**
- `GET /subscriptions/entitlements/:entitlement` - Check specific entitlement
- `GET /subscriptions/usage` - Get subscription usage statistics

### **Enhanced Onboarding**
- `GET /onboarding/status` - Get onboarding status for current user

### **System Health**
- `GET /health` - Health check endpoint

---

## 🔄 Real-time Updates

### **WebSocket/Polling Events**
- Story generation progress
- Image generation completion  
- New shared stories from linked families
- Character claim notifications

### **Background Sync**
- Auto-sync stories between trusted families
- Character linking updates
- Subscription status changes

---

## 📊 Analytics Tracking

### **User Events to Track**
- `POST /subscriptions/events` - Track paywall interactions, conversions
- Story creation attempts
- Character creation and linking
- Sharing and claim events
- Time spent reading stories

This mapping ensures every screen has the necessary data to function and provides a clear contract between frontend and backend teams.
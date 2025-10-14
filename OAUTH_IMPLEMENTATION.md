# OAuth Implementation Summary

## ✅ What's Implemented

### 1. OAuth Services
Created platform-specific OAuth services for:
- **Twitter/X** (`TwitterOAuthService.js`)
- **Facebook** (for Instagram/Threads/Facebook) (`FacebookOAuthService.js`)
- **LinkedIn** (`LinkedInOAuthService.js`)

All extend `BaseOAuthService` which handles:
- Authorization URL generation with CSRF state tokens
- Code-to-token exchange
- Token refresh (where supported)
- User profile fetching

### 2. OAuth Routes (`/oauth`)

#### `GET /oauth/:platform/authorize`
- Requires authentication
- Generates authorization URL with state token
- Returns URL for client to open

**Response**:
```json
{
  "code": 200,
  "data": {
    "authorization_url": "https://twitter.com/i/oauth2/authorize?...",
    "state": "csrf_token_here"
  }
}
```

#### `GET /oauth/:platform/callback`
- Handles OAuth callback from platform
- Validates state token (CSRF protection)
- Exchanges authorization code for tokens
- Creates or updates ConnectedAccount
- Encrypts and stores tokens
- Triggers background sync jobs

**Success Response**:
```json
{
  "code": 200,
  "data": {
    "message": "Successfully connected account",
    "connection": {
      "id": "uuid",
      "platform": "twitter",
      "username": "handle",
      "display_name": "Name",
      "sync_status": "pending"
    }
  }
}
```

#### `GET /oauth/connections`
- Lists all active OAuth connections for authenticated user
- Does not expose access tokens

### 3. Token Encryption
- Created `encryption.js` helper using AES-256-GCM
- Tokens are encrypted before storing in database
- `ConnectedAccount` model has `getDecryptedAccessToken()` and `getDecryptedRefreshToken()` methods

### 4. Security Features
- CSRF protection via state tokens (10-minute expiration)
- Tokens encrypted at rest
- Token expiration tracking
- Automatic token refresh (where platform supports it)

### 5. Platform-Specific Features

**Twitter**:
- OAuth 2.0 with PKCE
- Scopes: `tweet.read`, `users.read`, `follows.read`, `offline.access`
- Supports refresh tokens

**Facebook**:
- OAuth 2.0
- Automatically exchanges short-lived tokens for long-lived tokens (60 days)
- Scopes: `public_profile`, `email`, Instagram, Threads support
- No refresh token (re-auth required after expiration)

**LinkedIn**:
- OAuth 2.0
- Scopes: `r_liteprofile`, `r_emailaddress`, `w_member_social`
- No refresh token support (re-auth required after expiration)

---

## 🔧 Configuration Required

Add to `.env`:
```bash
# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=your_64_char_hex_string

# Twitter OAuth
TWITTER_CLIENT_ID=your_client_id
TWITTER_CLIENT_SECRET=your_client_secret
TWITTER_CALLBACK_URL=http://localhost:4001/oauth/twitter/callback

# Facebook OAuth
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_CALLBACK_URL=http://localhost:4001/oauth/facebook/callback

# LinkedIn OAuth
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
LINKEDIN_CALLBACK_URL=http://localhost:4001/oauth/linkedin/callback
```

---

## 📱 React Native Integration

### Option 1: Standard OAuth Flow (Web Browser)

```javascript
// 1. Get authorization URL
const response = await fetch('https://api.ghost.com/oauth/twitter/authorize', {
  headers: {
    'Authorization': `Bearer ${clerkToken}`,
    'X-App-Slug': 'ghost'
  }
});
const { authorization_url, state } = await response.json();

// 2. Open browser
await Linking.openURL(authorization_url);

// 3. Handle deep link callback
Linking.addEventListener('url', ({ url }) => {
  // url = ghostapp://oauth/callback?code=...&state=...
  const params = parseQueryString(url);

  // 4. Send to callback endpoint
  fetch(`https://api.ghost.com/oauth/twitter/callback?code=${params.code}&state=${params.state}`)
    .then(res => res.json())
    .then(data => {
      // Connection created!
      console.log(data.connection);
    });
});
```

**Setup Required**:
1. Configure deep links in `app.json`:
```json
{
  "expo": {
    "scheme": "ghostapp"
  }
}
```

2. Update callback URLs to: `ghostapp://oauth/callback`

### Option 2: Native OAuth Libraries (Recommended)

Use `expo-auth-session` or `react-native-app-auth`:

```javascript
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint: 'https://twitter.com/i/oauth2/authorize',
  tokenEndpoint: 'https://api.twitter.com/2/oauth2/token',
};

const [request, response, promptAsync] = AuthSession.useAuthRequest(
  {
    clientId: 'YOUR_TWITTER_CLIENT_ID',
    scopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access'],
    redirectUri: AuthSession.makeRedirectUri({ scheme: 'ghostapp' }),
  },
  discovery
);

// After getting tokens from OAuth
if (response?.type === 'success') {
  const { access_token, refresh_token } = response.params;

  // TODO: Create endpoint to accept tokens directly
  // POST /oauth/twitter/connect
  // Body: { access_token, refresh_token }
}
```

**NOTE**: This requires a new endpoint (see "Future Enhancements" below).

---

## ⚠️ Current Limitations

1. **State storage is in-memory**: In production, use Redis or database for state tokens
2. **No direct token submission endpoint**: Native OAuth libs need a `/connect` endpoint that accepts tokens directly (without authorize/callback flow)
3. **PKCE uses 'plain' method**: Should upgrade to 'S256' for production
4. **No token refresh scheduling**: Should implement automatic token refresh before expiration
5. **No webhook support**: Platforms should notify us when tokens are revoked

---

## 🚀 Future Enhancements

### 1. Add Direct Token Connection Endpoint

For native mobile OAuth libraries:

```javascript
POST /oauth/:platform/connect
Body: {
  access_token: "...",
  refresh_token: "...",
  expires_in: 7200
}
```

This bypasses the authorize/callback flow when the client handles OAuth natively.

### 2. Token Refresh Worker

Background job that:
- Checks for expiring tokens (7 days before expiration)
- Automatically refreshes using refresh token
- Sends push notification if refresh fails

### 3. Webhook Handlers

Handle platform webhooks for:
- Token revocation
- Account deletion
- Permission changes

### 4. Multi-Account Support

Allow multiple connections per platform (e.g., 3 Twitter accounts).

### 5. Connection Health Dashboard

Show:
- Token expiration dates
- Last successful sync
- Connection errors

---

## 🧪 Testing

### Unit Tests
```bash
npm test tests/routes/public/oauth.test.js
```

**Coverage**: 16 tests covering:
- Authorization URL generation
- Error handling (missing params, invalid state, unsupported platforms)
- Connection listing and filtering
- Authentication requirements

### Manual Testing

1. **Start server**: `npm run dev`

2. **Get authorization URL**:
```bash
curl -X GET http://localhost:4001/oauth/twitter/authorize \
  -H "X-Test-User-Id: user_123" \
  -H "X-App-Slug: ghost"
```

3. **Open URL** in browser and authorize

4. **Browser redirects** to callback (will fail if callback URL not configured correctly)

5. **Check connection created**:
```bash
curl -X GET http://localhost:4001/oauth/connections \
  -H "X-Test-User-Id: user_123" \
  -H "X-App-Slug: ghost"
```

---

## 📊 Database Schema

Tokens are stored encrypted in `connected_accounts` table:

```sql
CREATE TABLE connected_accounts (
  id UUID PRIMARY KEY,
  account_id UUID REFERENCES accounts(id),
  app_id UUID REFERENCES apps(id),
  platform VARCHAR NOT NULL CHECK (platform IN ('twitter', 'facebook', 'linkedin')),
  platform_user_id VARCHAR NOT NULL,
  username VARCHAR NOT NULL,
  display_name VARCHAR,

  -- Encrypted tokens
  access_token TEXT NOT NULL, -- Encrypted with AES-256-GCM
  refresh_token TEXT, -- Encrypted (if platform supports)
  token_expires_at TIMESTAMP,

  profile_data JSONB,
  sync_status VARCHAR DEFAULT 'pending',
  last_synced_at TIMESTAMP,
  last_analyzed_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(account_id, platform, platform_user_id)
);
```

---

## 🔒 Security Checklist

- ✅ CSRF protection (state tokens)
- ✅ Token encryption at rest (AES-256-GCM)
- ✅ Tokens not exposed in API responses
- ✅ HTTPS only (enforce in production)
- ✅ State token expiration (10 minutes)
- ✅ Unique constraints prevent duplicate connections
- ⚠️ PKCE uses 'plain' (should upgrade to 'S256')
- ⚠️ State tokens in memory (should use Redis)

---

## 📚 Documentation

- Twitter OAuth: https://docs.x.com/fundamentals/authentication/oauth-2-0/overview
- Facebook OAuth: https://developers.facebook.com/docs/facebook-login
- LinkedIn OAuth: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication

---

## ✅ Ready for MVP

The OAuth implementation is production-ready for MVP with these caveats:
1. Configure callback URLs with your production domain
2. Generate secure ENCRYPTION_KEY
3. Set up deep links in React Native app
4. Test with real OAuth credentials
5. Consider adding direct token endpoint for native OAuth

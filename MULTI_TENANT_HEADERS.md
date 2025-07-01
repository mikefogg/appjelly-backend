# Multi-Tenant Header-Based Authentication

## Overview

The SnuggleBug Platform uses **header-based multi-tenancy** where the app context is passed via HTTP headers instead of URL parameters or request body fields. This approach provides a cleaner API design and better separation of concerns.

## Required Headers

### `X-App-Slug` (Required for most endpoints)

All API requests (except health checks) must include the app slug in the header:

```http
X-App-Slug: snugglebug
```

**Supported values:**
- `snugglebug` - SnuggleBug Stories app
- `puptales` - PupTales Adventures app
- Any other configured app slug

### `Authorization` (Required for protected endpoints)

Standard Bearer token from Clerk:

```http
Authorization: Bearer <clerk_session_token>
```

## Updated API Endpoints

### Before (URL-based)
```http
GET /apps/snugglebug
POST /auth/account
Body: { "app_slug": "snugglebug", "email": "..." }
```

### After (Header-based)
```http
GET /app/config
Headers: X-App-Slug: snugglebug

POST /auth/account
Headers: 
  X-App-Slug: snugglebug
  Authorization: Bearer <token>
Body: { "email": "..." }
```

## Middleware Chain

1. **ClerkExpressWithAuth** - Adds `req.auth` with user info
2. **requireAppContext** - Reads `X-App-Slug` header, loads app into `res.locals.app`
3. **requireAuth** - Ensures user is authenticated via Clerk
4. **requireAccount** - Loads user's account for the specific app into `res.locals.account`

## Client Implementation Examples

### React Native / JavaScript

```javascript
const apiClient = axios.create({
  baseURL: 'https://api.snugglebug.com',
  headers: {
    'X-App-Slug': 'snugglebug',
    'Content-Type': 'application/json'
  }
});

// Add auth token dynamically
apiClient.interceptors.request.use((config) => {
  const token = getClerkToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

### Swift (iOS)

```swift
var request = URLRequest(url: url)
request.setValue("snugglebug", forHTTPHeaderField: "X-App-Slug")
request.setValue("Bearer \(clerkToken)", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
```

### Kotlin (Android)

```kotlin
val request = Request.Builder()
    .url(url)
    .addHeader("X-App-Slug", "snugglebug")
    .addHeader("Authorization", "Bearer $clerkToken")
    .addHeader("Content-Type", "application/json")
    .build()
```

## Benefits

1. **Clean URLs** - No app slug cluttering the URL structure
2. **Consistent API** - Same endpoints work for all apps
3. **Better Security** - App context is always validated
4. **Easier Client Code** - Set header once, works for all requests
5. **Multi-tenant Ready** - Easy to add new apps without URL changes

## Route Structure

```
POST /auth/account              # Create/get account
GET  /app/config               # Get app configuration  
GET  /app/sample-content       # Get sample content for onboarding
GET  /accounts/me              # Get current account
PATCH /accounts/me             # Update account
DELETE /accounts/me            # Delete account
GET  /actors                   # List actors
POST /actors                   # Create actor
GET  /actors/:id               # Get actor
PATCH /actors/:id              # Update actor
DELETE /actors/:id             # Delete actor
POST /actors/:id/media         # Upload actor media
DELETE /actors/:id/media/:mid  # Delete actor media
```

All protected routes require both `X-App-Slug` header and `Authorization` header.

## Error Responses

### Missing App Header
```json
{
  "code": 400,
  "status": "Error", 
  "message": "App context required - please include X-App-Slug header",
  "data": null
}
```

### Invalid App Slug
```json
{
  "code": 404,
  "status": "Error",
  "message": "App 'invalid-slug' not found", 
  "data": null
}
```

### Missing Authentication
```json
{
  "code": 401,
  "status": "Error",
  "message": "Authentication failed",
  "data": null
}
```
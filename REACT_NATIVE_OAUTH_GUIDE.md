# React Native OAuth Integration Guide

Complete guide for integrating Ghost OAuth with React Native using `expo-auth-session`.

## Installation

```bash
npm install expo-auth-session expo-web-browser
```

## Twitter/X OAuth

```javascript
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';

// Required for web to complete the auth session
WebBrowser.maybeCompleteAuthSession();

function TwitterConnectButton() {
  const [isConnecting, setIsConnecting] = useState(false);

  // Define discovery endpoints
  const discovery = {
    authorizationEndpoint: 'https://twitter.com/i/oauth2/authorize',
    tokenEndpoint: 'https://api.twitter.com/2/oauth2/token',
  };

  // Create auth request
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: 'YOUR_TWITTER_CLIENT_ID',
      scopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access'],
      redirectUri: AuthSession.makeRedirectUri({
        scheme: 'ghostapp', // Your app scheme
      }),
      // Twitter requires PKCE
      usePKCE: true,
      codeChallenge: AuthSession.generateCodeChallenge(
        await AuthSession.generateRandomAsync(43)
      ),
    },
    discovery
  );

  // Handle OAuth response
  React.useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      connectTwitterAccount(code);
    }
  }, [response]);

  const connectTwitterAccount = async (authCode) => {
    try {
      setIsConnecting(true);

      // Exchange code for tokens
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: 'YOUR_TWITTER_CLIENT_ID',
          code: authCode,
          redirectUri: AuthSession.makeRedirectUri({ scheme: 'ghostapp' }),
          extraParams: {
            code_verifier: request.codeVerifier,
          },
        },
        discovery
      );

      const { accessToken, refreshToken, expiresIn } = tokenResponse;

      // Send tokens to your API
      const response = await fetch('https://your-api.com/oauth/twitter/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clerkToken}`, // Your Clerk session token
          'X-App-Slug': 'ghost',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('Twitter connected!', data.data.connection);
        // Navigate to success screen or update UI
      } else {
        console.error('Failed to connect:', data.error);
      }
    } catch (error) {
      console.error('OAuth error:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Button
      disabled={!request || isConnecting}
      title={isConnecting ? 'Connecting...' : 'Connect Twitter'}
      onPress={() => promptAsync()}
    />
  );
}
```

---

## Facebook OAuth (for Instagram/Threads)

```javascript
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

function FacebookConnectButton() {
  const [isConnecting, setIsConnecting] = useState(false);

  const discovery = {
    authorizationEndpoint: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenEndpoint: 'https://graph.facebook.com/v18.0/oauth/access_token',
  };

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: 'YOUR_FACEBOOK_APP_ID',
      scopes: [
        'public_profile',
        'email',
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_content_publish',
      ],
      redirectUri: AuthSession.makeRedirectUri({ scheme: 'ghostapp' }),
    },
    discovery
  );

  React.useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      connectFacebookAccount(code);
    }
  }, [response]);

  const connectFacebookAccount = async (authCode) => {
    try {
      setIsConnecting(true);

      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: 'YOUR_FACEBOOK_APP_ID',
          code: authCode,
          redirectUri: AuthSession.makeRedirectUri({ scheme: 'ghostapp' }),
        },
        discovery
      );

      const { accessToken, expiresIn } = tokenResponse;

      // Send to API (Facebook doesn't provide refresh tokens via OAuth 2.0)
      const response = await fetch('https://your-api.com/oauth/facebook/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clerkToken}`,
          'X-App-Slug': 'ghost',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          access_token: accessToken,
          expires_in: expiresIn,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('Facebook connected!', data.data.connection);
      }
    } catch (error) {
      console.error('OAuth error:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Button
      disabled={!request || isConnecting}
      title={isConnecting ? 'Connecting...' : 'Connect Facebook'}
      onPress={() => promptAsync()}
    />
  );
}
```

---

## LinkedIn OAuth

```javascript
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

function LinkedInConnectButton() {
  const [isConnecting, setIsConnecting] = useState(false);

  const discovery = {
    authorizationEndpoint: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenEndpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
  };

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: 'YOUR_LINKEDIN_CLIENT_ID',
      scopes: ['r_liteprofile', 'r_emailaddress', 'w_member_social'],
      redirectUri: AuthSession.makeRedirectUri({ scheme: 'ghostapp' }),
    },
    discovery
  );

  React.useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      connectLinkedInAccount(code);
    }
  }, [response]);

  const connectLinkedInAccount = async (authCode) => {
    try {
      setIsConnecting(true);

      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: 'YOUR_LINKEDIN_CLIENT_ID',
          code: authCode,
          redirectUri: AuthSession.makeRedirectUri({ scheme: 'ghostapp' }),
        },
        discovery
      );

      const { accessToken, expiresIn } = tokenResponse;

      // Note: LinkedIn doesn't provide refresh tokens
      const response = await fetch('https://your-api.com/oauth/linkedin/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clerkToken}`,
          'X-App-Slug': 'ghost',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          access_token: accessToken,
          expires_in: expiresIn,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('LinkedIn connected!', data.data.connection);
      }
    } catch (error) {
      console.error('OAuth error:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Button
      disabled={!request || isConnecting}
      title={isConnecting ? 'Connecting...' : 'Connect LinkedIn'}
      onPress={() => promptAsync()}
    />
  );
}
```

---

## App Configuration

### 1. Configure Deep Links

**`app.json` (Expo)**:
```json
{
  "expo": {
    "scheme": "ghostapp",
    "name": "Ghost",
    "slug": "ghost"
  }
}
```

**Bare React Native** - See [React Native Deep Linking docs](https://reactnative.dev/docs/linking)

### 2. Update OAuth App Redirect URIs

For each platform, configure the redirect URI:

**Format**: `ghostapp://`

- **Twitter**: Add to "Callback URI / Redirect URL" in Twitter Developer Portal
- **Facebook**: Add to "Valid OAuth Redirect URIs" in Facebook App Settings
- **LinkedIn**: Add to "Authorized redirect URLs" in LinkedIn App Settings

---

## Complete Integration Example

```javascript
import React, { useState, useEffect } from 'react';
import { View, Button, Text, ActivityIndicator } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/clerk-expo'; // Or your auth provider

WebBrowser.maybeCompleteAuthSession();

const API_URL = 'https://your-api.com';

function ConnectAccountsScreen() {
  const { getToken } = useAuth(); // Clerk token
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_URL}/oauth/connections`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-App-Slug': 'ghost',
        },
      });

      const data = await response.json();
      if (response.ok) {
        setConnections(data.data);
      }
    } catch (error) {
      console.error('Failed to load connections:', error);
    } finally {
      setLoading(false);
    }
  };

  const connectPlatform = async (platform, accessToken, refreshToken, expiresIn) => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_URL}/oauth/${platform}/connect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-App-Slug': 'ghost',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log(`${platform} connected!`);
        loadConnections(); // Refresh list
        return data.data.connection;
      } else {
        throw new Error(data.error?.message || 'Connection failed');
      }
    } catch (error) {
      console.error(`Failed to connect ${platform}:`, error);
      throw error;
    }
  };

  const disconnectPlatform = async (connectionId) => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_URL}/connections/${connectionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-App-Slug': 'ghost',
        },
      });

      if (response.ok) {
        loadConnections(); // Refresh list
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  if (loading) {
    return <ActivityIndicator />;
  }

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>Connected Accounts</Text>

      {connections.map((conn) => (
        <View key={conn.id} style={{ marginBottom: 10 }}>
          <Text>{conn.platform}: @{conn.username}</Text>
          <Text>Status: {conn.sync_status}</Text>
          <Button
            title="Disconnect"
            onPress={() => disconnectPlatform(conn.id)}
          />
        </View>
      ))}

      <View style={{ marginTop: 20 }}>
        <TwitterConnectButton onConnect={(tokens) => connectPlatform('twitter', ...tokens)} />
        <FacebookConnectButton onConnect={(tokens) => connectPlatform('facebook', ...tokens)} />
        <LinkedInConnectButton onConnect={(tokens) => connectPlatform('linkedin', ...tokens)} />
      </View>
    </View>
  );
}

export default ConnectAccountsScreen;
```

---

## Error Handling

```javascript
const connectWithErrorHandling = async (platform, tokens) => {
  try {
    await connectPlatform(platform, ...tokens);
  } catch (error) {
    if (error.message.includes('must be synced')) {
      // Show message: "Please wait while we sync your account"
    } else if (error.message.includes('not found')) {
      // Token invalid or account not found
      Alert.alert('Connection Failed', 'Please try connecting again');
    } else {
      // Generic error
      Alert.alert('Error', error.message);
    }
  }
};
```

---

## Testing

### 1. Test on Device/Simulator

```bash
npx expo start
# Scan QR code on phone or press 'i' for iOS simulator
```

### 2. Test Deep Links

```bash
# iOS
xcrun simctl openurl booted "ghostapp://"

# Android
adb shell am start -W -a android.intent.action.VIEW -d "ghostapp://"
```

### 3. Monitor Connection Status

```javascript
// Poll connection status after connecting
const pollConnectionStatus = async (connectionId) => {
  const interval = setInterval(async () => {
    const response = await fetch(`${API_URL}/connections/${connectionId}/status`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-App-Slug': 'ghost',
      },
    });

    const data = await response.json();

    if (data.data.sync_status === 'ready') {
      clearInterval(interval);
      console.log('Connection ready!');
    }
  }, 3000); // Check every 3 seconds
};
```

---

## Security Notes

1. **Never hardcode OAuth client secrets in your app** - only client IDs
2. **Always use HTTPS** for API calls
3. **Store Clerk tokens securely** using `expo-secure-store`
4. **Validate redirect URIs** match exactly in OAuth app settings
5. **Handle token expiration** - show re-connect UI when needed

---

## Troubleshooting

### "Invalid redirect_uri"
- Ensure `ghostapp://` is added to OAuth app settings
- Check `scheme` in `app.json` matches
- Verify `makeRedirectUri({ scheme: 'ghostapp' })` matches

### "Token exchange failed"
- Check client ID is correct
- Ensure code verifier is passed for PKCE (Twitter)
- Verify token endpoint URL is correct

### "Connection not found"
- Ensure Clerk token is valid
- Check `X-App-Slug` header is set to 'ghost'
- Verify account exists in database

### Deep links not working
- Run `npx expo prebuild` to regenerate native code
- Check native project configuration (iOS Info.plist, Android AndroidManifest.xml)
- Test with `npx uri-scheme open ghostapp:// --ios` or `--android`

---

## API Reference

### POST /oauth/:platform/connect

**Platforms**: `twitter`, `facebook`, `linkedin`

**Request**:
```json
{
  "access_token": "string (required)",
  "refresh_token": "string (optional)",
  "expires_in": "number (optional, seconds)"
}
```

**Response** (201):
```json
{
  "code": 201,
  "status": "Success",
  "message": "Successfully connected account",
  "data": {
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

**Errors**:
- `400`: Missing access_token or unsupported platform
- `401`: Unauthorized (invalid Clerk token)
- `500`: Server error (token invalid, API error, etc.)

---

## Next Steps

1. ✅ Connect accounts
2. ✅ Wait for sync to complete (`sync_status: "ready"`)
3. ✅ Fetch suggestions: `GET /suggestions?connected_account_id={id}`
4. ✅ Generate posts: `POST /posts/generate { prompt, connected_account_id }`
5. ✅ Mark suggestions as used: `POST /suggestions/:id/use`

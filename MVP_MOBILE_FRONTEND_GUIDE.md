# Universal Multi-App Mobile Platform Frontend Guide 

This guide provides everything needed to build a universal mobile app platform that supports any type of app (stories, workouts, photos, content generation, etc.) with shared components and configurable theming.

**Based on Existing Setup**: This guide updates the existing Expo app at `/Users/mfogg/sites/mobile/blockview`

---

## 🏗️ Universal Platform Architecture

### Technology Stack (Current Setup)
- **Framework**: React Native 0.79.2 with Expo SDK 53
- **Navigation**: Expo Router (file-based routing)
- **State Management**: React Context API + TanStack Query
- **Styling**: NativeWind v4 (Tailwind CSS for React Native)
- **API Client**: Fetch API with TanStack Query
- **Authentication**: Clerk Expo SDK
- **Subscriptions**: RevenueCat React Native SDK
- **Image Handling**: Expo Image
- **Local Storage**: Expo SecureStore + AsyncStorage

### Clone and Customize Workflow
Each new app is created by:

1. **Clone the base repository**
2. **Hardcode app-specific text directly in screens**
3. **Change app colors in tailwind.config.js**
4. **Change app metadata and deploy**

**Files that change per app:**
- **Screen files** - Hardcode text like "Create Workout" directly in JSX
- **tailwind.config.js** - App-specific colors
- **app.json** - App metadata, bundle ID, etc.
- **package.json** - App name and version

**Files that NEVER change:**
- All components in `src/components/`
- All hooks (they all use the same backend API)
- All utilities and helpers
- Storyboard and development tools

### Universal Backend API Integration
All apps use the SAME backend API with the SAME hooks:

```javascript
// src/config/queryKeys.js - IDENTICAL IN ALL APPS
import { compact } from 'lodash';

//
// Actors (Characters/Profiles)
//
export const actorKeys = {
  all: ['actors'],
  allLists: () => [...actorKeys.all, 'list'],
  list: (filters, pagination) => compact([...actorKeys.allLists(), filters, pagination]),
  detail: (id) => [...actorKeys.all, 'detail', id],
  media: (id) => [...actorKeys.all, 'media', id],
};

//
// Artifacts (Generated Content)
//
export const artifactKeys = {
  all: ['artifacts'],
  allLists: () => [...artifactKeys.all, 'list'],
  list: (filters, pagination, sorting) => compact([...artifactKeys.allLists(), filters, pagination, sorting]),
  detail: (id) => [...artifactKeys.all, 'detail', id],
  pages: (id) => [...artifactKeys.all, 'pages', id],
  sharedView: (token) => [...artifactKeys.all, 'shared', token],
};

//
// Inputs (Creation Prompts)
//
export const inputKeys = {
  all: ['inputs'],
  allLists: () => [...inputKeys.all, 'list'],
  list: (filters, pagination) => compact([...inputKeys.allLists(), filters, pagination]),
  detail: (id) => [...inputKeys.all, 'detail', id],
  inference: (id) => [...inputKeys.all, 'inference', id],
};

//
// Account & Subscriptions
//
export const accountKeys = {
  all: ['account'],
  current: () => [...accountKeys.all, 'current'],
  subscription: () => [...accountKeys.all, 'subscription'],
  accountLinks: () => [...accountKeys.all, 'links'],
};

//
// App Configuration
//
export const appKeys = {
  all: ['app'],
  config: () => [...appKeys.all, 'config'],
  sampleContent: () => [...appKeys.all, 'sample'],
};

// src/hooks/api/useActors.js - IDENTICAL IN ALL APPS
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../utils/api';
import { actorKeys } from '../../config/queryKeys';

export function useActors(filters, pagination) {
  return useQuery({
    queryKey: actorKeys.list(filters, pagination),
    queryFn: () => apiClient.get('/actors', { params: { ...filters, ...pagination } })
  });
}

export function useActor(id) {
  return useQuery({
    queryKey: actorKeys.detail(id),
    queryFn: () => apiClient.get(`/actors/${id}`),
    enabled: !!id
  });
}

export function useCreateActor() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => apiClient.post('/actors', data),
    onSuccess: () => {
      // Invalidate all actor lists
      queryClient.invalidateQueries({ queryKey: actorKeys.allLists() });
    }
  });
}

// src/hooks/api/useArtifacts.js - IDENTICAL IN ALL APPS  
import { artifactKeys } from '../../config/queryKeys';

export function useArtifacts(filters, pagination, sorting) {
  return useQuery({
    queryKey: artifactKeys.list(filters, pagination, sorting),
    queryFn: () => apiClient.get('/artifacts', { params: { ...filters, ...pagination, ...sorting } })
  });
}

export function useArtifact(id) {
  return useQuery({
    queryKey: artifactKeys.detail(id),
    queryFn: () => apiClient.get(`/artifacts/${id}`),
    enabled: !!id
  });
}

export function useCreateInput() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => apiClient.post('/inputs', data),
    onSuccess: () => {
      // Invalidate all artifact lists since new content was created
      queryClient.invalidateQueries({ queryKey: artifactKeys.allLists() });
    }
  });
}

// Easy cache invalidation examples:
// queryClient.invalidateQueries({ queryKey: actorKeys.all }); // All actor data
// queryClient.invalidateQueries({ queryKey: actorKeys.allLists() }); // Just actor lists
// queryClient.invalidateQueries({ queryKey: artifactKeys.detail(id) }); // Specific artifact

// ALL apps use the same hooks, same endpoints, same query keys
// The backend handles multi-tenancy via X-App-Slug header
```

### App Customization Examples

#### SnuggleBug App (Stories)
```javascript
// app/(tabs)/index.jsx - SNUGGLEBUG REPO
import { useArtifacts } from '../../src/hooks/api/useArtifacts';
import { Button } from '../../src/components/core/Button';

export default function LibraryScreen() {
  const { data: stories } = useArtifacts();
  
  return (
    <View className="flex-1 p-4">
      <Text className="text-2xl font-bold text-foreground mb-4">
        Story Library
      </Text>
      
      <Button onPress={handleCreate}>
        Generate Story
      </Button>
      
      {/* Same ContentCard component, different data */}
      {stories?.map(story => (
        <ContentCard key={story.id} content={story} />
      ))}
    </View>
  );
}
```

#### FitTrack App (Workouts) 
```javascript
// app/(tabs)/index.jsx - FITTRACK REPO (different git repo)
import { useArtifacts } from '../../src/hooks/api/useArtifacts'; // SAME HOOK
import { Button } from '../../src/components/core/Button'; // SAME COMPONENT

export default function WorkoutsScreen() {
  const { data: workouts } = useArtifacts(); // SAME API CALL
  
  return (
    <View className="flex-1 p-4">
      <Text className="text-2xl font-bold text-foreground mb-4">
        My Workouts
      </Text>
      
      <Button onPress={handleCreate}>
        Create Workout
      </Button>
      
      {/* Same ContentCard component, different data */}
      {workouts?.map(workout => (
        <ContentCard key={workout.id} content={workout} />
      ))}
    </View>
  );
}
```

**Key Points:**
- Same `useArtifacts()` hook in both apps
- Same `Button` and `ContentCard` components  
- Same backend API endpoints
- Only difference: hardcoded text ("Story Library" vs "My Workouts")
- Backend returns different data based on `X-App-Slug` header

### API Configuration (Identical in ALL Apps)
```javascript
// src/utils/api.js - NEVER CHANGES ACROSS APPS
import { QueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.platform.com';
const APP_SLUG = process.env.EXPO_PUBLIC_APP_SLUG; // Set in .env per app

export const apiClient = {
  async request(url, options = {}) {
    const token = await SecureStore.getItemAsync('auth_token');
    
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        'X-App-Slug': APP_SLUG, // Same header, different value per app
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    return response.json();
  },
  
  get: (url) => apiClient.request(url),
  post: (url, data) => apiClient.request(url, { method: 'POST', body: JSON.stringify(data) }),
  patch: (url, data) => apiClient.request(url, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (url) => apiClient.request(url, { method: 'DELETE' })
};

// Query client for TanStack Query
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

// Environment setup per app:
// SnuggleBug: EXPO_PUBLIC_APP_SLUG=snugglebug
// FitTrack: EXPO_PUBLIC_APP_SLUG=fittrack
// PupPics: EXPO_PUBLIC_APP_SLUG=puppics
```

---

## 🎨 Component Library & Storyboard System

### Component Architecture
All UI components are built to be theme-agnostic and reusable across different app variants:

```
src/components/
├── core/                 # Base components
│   ├── Button/
│   ├── Input/
│   ├── Card/
│   ├── Modal/
│   └── Sheet/
├── compound/            # Complex reusable components
│   ├── CharacterCard/
│   ├── StoryCard/
│   ├── PageViewer/
│   └── ShareModal/
├── layout/              # Layout components
│   ├── Screen/
│   ├── Header/
│   └── TabBar/
└── storybook/           # Storyboard showcase components
    ├── ComponentDemo/
    ├── ThemePreview/
    └── StyleGuide/
```

### Storyboard Settings Page
**Purpose**: A comprehensive showcase of all components, themes, and UI patterns for development and QA.

**Location**: `app/modal/storyboard.jsx`

```javascript
// app/modal/storyboard.jsx
import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useAppConfig } from '../src/hooks/useAppConfig';
import { ComponentShowcase } from '../src/components/storybook/ComponentShowcase';

const COMPONENT_CATEGORIES = [
  'Core Components',
  'Form Elements', 
  'Cards & Lists',
  'Modals & Sheets',
  'Navigation',
  'Media Components',
  'Themed Elements'
];

export default function StoryboardScreen() {
  const [selectedCategory, setSelectedCategory] = useState('Core Components');
  const { currentTheme } = useAppConfig();
  
  return (
    <View className="flex-1 bg-background">
      {/* Header with app switcher */}
      <View className="p-4 border-b border-border">
        <Text className="text-2xl font-bold text-foreground">
          Component Storyboard
        </Text>
        <Text className="text-sm text-muted-foreground">
          Theme: {currentTheme.name}
        </Text>
      </View>
      
      {/* Category tabs */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        className="flex-grow-0 border-b border-border"
      >
        <View className="flex-row p-2 gap-2">
          {COMPONENT_CATEGORIES.map(category => (
            <TouchableOpacity
              key={category}
              onPress={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-full ${
                selectedCategory === category 
                  ? 'bg-primary' 
                  : 'bg-secondary/20'
              }`}
            >
              <Text className={`font-medium ${
                selectedCategory === category 
                  ? 'text-primary-foreground' 
                  : 'text-foreground'
              }`}>
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      
      {/* Component showcase */}
      <ScrollView className="flex-1">
        <ComponentShowcase category={selectedCategory} />
      </ScrollView>
    </View>
  );
}
```

### Component Showcase Implementation
```javascript
// src/components/storybook/ComponentShowcase.jsx
import { ComponentDemo } from './ComponentDemo';
import { Button } from '../core/Button';
import { Card } from '../core/Card';
import { Modal } from '../core/Modal';
import { Sheet } from '../core/Sheet';
import { StoryCard } from '../compound/StoryCard';

const COMPONENT_DEMOS = {
  'Core Components': [
    {
      name: 'Button',
      component: Button,
      variants: [
        { props: { variant: 'primary', children: 'Primary Button' } },
        { props: { variant: 'secondary', children: 'Secondary Button' } },
        { props: { variant: 'outline', children: 'Outline Button' } },
        { props: { variant: 'ghost', children: 'Ghost Button' } },
        { props: { variant: 'primary', size: 'sm', children: 'Small' } },
        { props: { variant: 'primary', size: 'lg', children: 'Large' } },
        { props: { variant: 'primary', disabled: true, children: 'Disabled' } },
      ]
    },
    {
      name: 'Card',
      component: Card,
      variants: [
        { 
          props: { 
            children: <Text className="p-4">Basic Card Content</Text> 
          } 
        },
        { 
          props: { 
            variant: 'elevated',
            children: <Text className="p-4">Elevated Card</Text> 
          } 
        },
      ]
    }
  ],
  
  'Form Elements': [
    // Input, TextArea, Select, etc.
  ],
  
  'Cards & Lists': [
    {
      name: 'ContentCard',
      component: ContentCard,
      variants: [
        {
          props: {
            content: {
              id: '1',
              title: 'Sample Content Item',
              thumbnail_key: 'sample_thumb',
              created_at: '2024-01-15T10:00:00Z',
              metadata: { type: 'generated', status: 'complete' },
              is_owned: true
            },
            contentType: 'story'
          }
        },
        {
          props: {
            content: {
              id: '2',
              title: 'Morning Workout',
              thumbnail_key: 'workout_thumb',
              created_at: '2024-01-15T09:00:00Z',
              metadata: { duration: '45 mins', difficulty: 'medium' },
              is_owned: true
            },
            contentType: 'workout'
          }
        },
        {
          props: {
            content: {
              id: '3',
              title: 'Max at the Park',
              thumbnail_key: 'dog_photo',
              created_at: '2024-01-15T14:00:00Z',
              metadata: { location: 'Central Park', likes: 24 },
              is_owned: true
            },
            contentType: 'photo'
          }
        }
      ]
    }
  ],
  
  'Modals & Sheets': [
    // Modal, Sheet, Drawer examples
  ],
  
  'Themed Elements': [
    // Typography, Colors, Spacing examples
  ]
};

export function ComponentShowcase({ category }) {
  const demos = COMPONENT_DEMOS[category] || [];
  
  return (
    <View className="p-4 gap-6">
      {demos.map(demo => (
        <ComponentDemo
          key={demo.name}
          name={demo.name}
          component={demo.component}
          variants={demo.variants}
        />
      ))}
    </View>
  );
}
```

### Component Demo Widget
```javascript
// src/components/storybook/ComponentDemo.jsx
import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

export function ComponentDemo({ name, component: Component, variants }) {
  const [selectedVariant, setSelectedVariant] = useState(0);
  
  return (
    <View className="border border-border rounded-lg p-4 bg-card">
      {/* Component name */}
      <Text className="text-lg font-semibold text-foreground mb-3">
        {name}
      </Text>
      
      {/* Variant selector */}
      {variants.length > 1 && (
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          className="mb-4"
        >
          <View className="flex-row gap-2">
            {variants.map((variant, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => setSelectedVariant(index)}
                className={`px-3 py-1 rounded ${
                  selectedVariant === index 
                    ? 'bg-primary/20' 
                    : 'bg-secondary/10'
                }`}
              >
                <Text className="text-xs">
                  Variant {index + 1}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
      
      {/* Component preview */}
      <View className="border border-dashed border-border rounded p-4 bg-background/50">
        <Component {...variants[selectedVariant].props} />
      </View>
      
      {/* Props display */}
      <View className="mt-3 p-2 bg-muted rounded">
        <Text className="text-xs font-mono text-muted-foreground">
          {JSON.stringify(variants[selectedVariant].props, null, 2)}
        </Text>
      </View>
    </View>
  );
}
```

---

## 🎭 Multi-App Theming System

### Theme Configuration (Extends Existing ThemeContext)
```javascript
// src/config/themes.js
export const BASE_THEME = {
  // Base semantic colors (stay consistent)
  background: '#FFFFFF',
  foreground: '#000000',
  card: '#FFFFFF',
  'card-foreground': '#000000',
  popover: '#FFFFFF',
  'popover-foreground': '#000000',
  muted: '#F1F5F9',
  'muted-foreground': '#64748B',
  border: '#E2E8F0',
  input: '#E2E8F0',
  ring: '#3B82F6',
  // Spacing, typography, etc.
  spacing: {
    xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48
  },
  borderRadius: {
    sm: 4, md: 8, lg: 12, xl: 16, '2xl': 24, full: 9999
  }
};

export const APP_THEMES = {
  snugglebug: {
    ...BASE_THEME,
    primary: '#FF6B6B',
    'primary-foreground': '#FFFFFF',
    secondary: '#4ECDC4',
    'secondary-foreground': '#FFFFFF',
    accent: '#FFE66D',
    'accent-foreground': '#000000',
    destructive: '#EF4444',
    'destructive-foreground': '#FFFFFF',
    // App-specific overrides
    gradients: {
      primary: 'from-pink-400 to-red-400',
      secondary: 'from-teal-400 to-cyan-400'
    }
  },
  
  puptales: {
    ...BASE_THEME,
    primary: '#8B5A3C',
    'primary-foreground': '#FFFFFF',
    secondary: '#F4A261',
    'secondary-foreground': '#000000',
    accent: '#E76F51',
    'accent-foreground': '#FFFFFF',
    destructive: '#DC2626',
    'destructive-foreground': '#FFFFFF',
    gradients: {
      primary: 'from-amber-600 to-orange-600',
      secondary: 'from-yellow-400 to-orange-400'
    }
  }
};

// Get current theme based on app config
export function getCurrentTheme() {
  const { CURRENT_APP } = require('./apps');
  return APP_THEMES[CURRENT_APP.slug] || APP_THEMES.snugglebug;
}
```

### Enhanced Theme Context (Updates existing)
```javascript
// src/context/ThemeContext.jsx (Update existing file)
import { getCurrentTheme, APP_THEMES } from '../config/themes';
import { CURRENT_APP } from '../config/apps';

export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useAsyncStorage('theme', 'system');
  const colorScheme = useColorScheme();
  
  // Get app-specific theme
  const appTheme = getCurrentTheme();
  
  // Determine active theme (light/dark variants)
  const activeTheme = useMemo(() => {
    const isDark = themeName === 'dark' || (themeName === 'system' && colorScheme === 'dark');
    
    return {
      ...appTheme,
      ...(isDark && {
        // Dark mode overrides
        background: '#0F172A',
        foreground: '#F8FAFC',
        card: '#1E293B',
        'card-foreground': '#F8FAFC',
        muted: '#334155',
        'muted-foreground': '#94A3B8',
        border: '#334155'
      })
    };
  }, [themeName, colorScheme, appTheme]);
  
  // Register theme with NativeWind
  useEffect(() => {
    registerThemeWithTailwind(activeTheme);
  }, [activeTheme]);
  
  return (
    <ThemeContext.Provider value={{
      theme: activeTheme,
      themeName,
      setTheme: setThemeName,
      appConfig: CURRENT_APP,
      availableThemes: Object.keys(APP_THEMES)
    }}>
      {children}
    </ThemeContext.Provider>
  );
};
```

### Only Environment Variable Changes Per App
```javascript
// .env - ONLY FILE THAT CHANGES PER APP (besides screens)
EXPO_PUBLIC_APP_SLUG=snugglebug    # SnuggleBug repo
# EXPO_PUBLIC_APP_SLUG=fittrack    # FitTrack repo  
# EXPO_PUBLIC_APP_SLUG=puppics     # PupPics repo

// That's it! No other configuration needed.
// All API calls, hooks, and components are identical.
```

### Core Component Examples

#### Pure Button Component (NEVER changes)
```javascript
// src/components/core/Button/Button.jsx
// THIS COMPONENT IS IDENTICAL IN ALL APPS - NO CONDITIONAL LOGIC
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { cn } from '../../../utils/cn';

const buttonVariants = {
  primary: 'bg-primary',
  secondary: 'bg-secondary', 
  outline: 'border-2 border-primary bg-transparent',
  ghost: 'bg-transparent',
  destructive: 'bg-destructive'
};

const buttonSizes = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-6 text-base',
  lg: 'h-13 px-8 text-lg'
};

export function Button({ 
  variant = 'primary', 
  size = 'md',
  disabled = false,
  loading = false,
  className,
  textClassName,
  children,
  onPress,
  ...props 
}) {
  const baseClass = cn(
    'flex-row items-center justify-center rounded-lg',
    buttonVariants[variant],
    buttonSizes[size],
    disabled && 'opacity-50',
    className
  );
  
  const textClass = cn(
    'font-semibold text-center',
    variant === 'primary' && 'text-primary-foreground',
    variant === 'secondary' && 'text-secondary-foreground',
    variant === 'outline' && 'text-primary',
    variant === 'ghost' && 'text-foreground',
    variant === 'destructive' && 'text-destructive-foreground',
    textClassName
  );
  
  return (
    <TouchableOpacity
      className={baseClass}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      {...props}
    >
      {loading && <ActivityIndicator size="small" className="mr-2" />}
      <Text className={textClass}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}
```

#### Usage in App-Specific Screens (Hardcoded Text)
```javascript
// app/(tabs)/index.jsx - SNUGGLEBUG REPO
import { Button } from '../src/components/core/Button';

export default function LibraryScreen() {
  return (
    <View className="flex-1 p-4">
      <Button onPress={handleCreate}>
        Generate Story
      </Button>
    </View>
  );
}

// app/(tabs)/index.jsx - FITTRACK REPO (different git repo)  
import { Button } from '../src/components/core/Button'; // SAME COMPONENT

export default function WorkoutScreen() {
  return (
    <View className="flex-1 p-4">
      <Button onPress={handleCreate}>
        Create Workout
      </Button>
    </View>
  );
}

// Same Button component, different hardcoded text per app
```

---

## 🔧 Core Component Design Principles

### 1. **Zero Conditional Logic**
Components should NEVER contain `if (app === 'snugglebug')` or similar logic:

```javascript
// ❌ WRONG - Contains app-specific logic
export function CreateButton() {
  const { config } = useAppConfig();
  
  if (config.slug === 'fittrack') {
    return <Button>Create Workout</Button>;
  } else if (config.slug === 'snugglebug') {
    return <Button>Generate Story</Button>;
  }
  return <Button>Create</Button>;
}

// ✅ CORRECT - Pure component, configured externally
export function CreateButton({ children, ...props }) {
  return <Button {...props}>{children}</Button>;
}

// Usage in screen (configuration-driven)
<CreateButton onPress={handleCreate}>
  {getText('create_button')}
</CreateButton>
```

### 2. **Configuration-Only Customization**
All customization happens through props and configuration files:

```javascript
// ❌ WRONG - Theme logic in component
export function ContentCard({ item }) {
  const { config } = useAppConfig();
  const bgColor = config.slug === 'fittrack' ? 'bg-green-100' : 'bg-pink-100';
  
  return (
    <View className={`p-4 ${bgColor}`}>
      <Text>{item.title}</Text>
    </View>
  );
}

// ✅ CORRECT - Theme comes from NativeWind classes
export function ContentCard({ item, className, ...props }) {
  return (
    <Card className={cn('p-4', className)} {...props}>
      <Text className="text-foreground font-semibold">{item.title}</Text>
      <Text className="text-muted-foreground">{item.description}</Text>
    </Card>
  );
}

// Theme colors defined in tailwind.config.js per app
```

### 3. **Pure Feature Detection**
Features are detected through boolean flags, not app identification:

```javascript
// ❌ WRONG - App-specific feature detection
const showSharing = config.slug === 'snugglebug' || config.slug === 'puppics';

// ✅ CORRECT - Feature flag detection
const showSharing = hasFeature('social_sharing');

// Usage
{hasFeature('social_sharing') && (
  <ShareButton onPress={handleShare} />
)}
```

---

## 📋 New App Creation Checklist

### Clone and Setup Process
```bash
# 1. Clone the base repository
git clone https://github.com/company/mobile-platform-base.git my-new-app
cd my-new-app

# 2. Update package.json
# Change name, bundle ID, version

# 3. Update app.json  
# Change name, slug, bundle identifier

# 4. Customize configuration
# Edit src/config/app-config.js
# Edit src/config/theme.js

# 5. Update environment
# Set EXPO_PUBLIC_APP_SLUG=mynewapp

# 6. Test and deploy
npm install
npm run dev
```

### Configuration Files to Customize

#### 1. App Configuration (`src/config/app-config.js`)
```javascript
export const APP_CONFIG = {
  name: 'My New App',
  slug: 'mynewapp',
  
  text: {
    main_tab_title: 'Home',
    create_button: 'Create',
    content_item_name: 'Item',
    profile_item_name: 'Profile',
    // Add any app-specific text
  },
  
  features: [
    'feature1',
    'feature2'
    // Only include features this app needs
  ],
  
  api: {
    endpoints: {
      content: '/my-content-endpoint',
      profiles: '/my-profile-endpoint',
      generation: '/my-generation-endpoint'
    }
  }
};
```

#### 2. Theme Configuration (`src/config/theme.js`)
```javascript
export const APP_THEME = {
  primary: '#your-primary-color',
  secondary: '#your-secondary-color',
  accent: '#your-accent-color',
  // Additional brand colors
};
```

#### 3. App Metadata (`app.json`)
```json
{
  "expo": {
    "name": "My New App",
    "slug": "mynewapp",
    "scheme": "mynewapp",
    "ios": {
      "bundleIdentifier": "com.company.mynewapp"
    },
    "android": {
      "package": "com.company.mynewapp"
    }
  }
}
```

### Core Component Updates Policy
If a core component needs modification that affects ALL apps:

1. **Update the base repository first**
2. **Copy the updated component to ALL existing app repositories**
3. **Ensure the change is purely additive or bug fix**
4. **Never break existing API contracts**

This maintains consistency across all apps while allowing each to evolve independently.

---

## 🔄 Component Synchronization Strategy

### When Core Components Change
Since each app is a separate git clone, core component updates must be manually synced:

```bash
# In each app repository
cp ../base-repo/src/components/core/Button/* ./src/components/core/Button/
cp ../base-repo/src/components/core/Card/* ./src/components/core/Card/
# etc.
```

### Automated Sync Script (Optional)
```bash
#!/bin/bash
# sync-components.sh
BASE_REPO="../mobile-platform-base"
COMPONENTS_DIR="src/components"

# Copy core components
rsync -av "$BASE_REPO/$COMPONENTS_DIR/core/" "./$COMPONENTS_DIR/core/"
rsync -av "$BASE_REPO/$COMPONENTS_DIR/layout/" "./$COMPONENTS_DIR/layout/"

echo "Core components synced from base repository"
```

This approach ensures each app can:
- **Customize freely** through configuration
- **Deploy independently** 
- **Maintain consistency** in core UI components
- **Evolve separately** without affecting other apps

#### Platform Card Component
```javascript
// src/components/core/Card/Card.jsx
import { View } from 'react-native';
import { cn } from '../../../utils/cn';

export function Card({ 
  variant = 'default',
  className,
  children,
  ...props 
}) {
  const baseClass = cn(
    'bg-card border border-border rounded-lg',
    variant === 'elevated' && 'shadow-lg shadow-black/10',
    variant === 'outlined' && 'border-2',
    className
  );
  
  return (
    <View className={baseClass} {...props}>
      {children}
    </View>
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <View className={cn('p-6 pb-0', className)} {...props}>
      {children}
    </View>
  );
}

export function CardContent({ className, children, ...props }) {
  return (
    <View className={cn('p-6', className)} {...props}>
      {children}
    </View>
  );
}
```

---

## 📱 Universal Page Structure & Components

### File-Based Routing Structure (Expo Router)
```
app/
├── (tabs)/              # Main app navigation
│   ├── _layout.jsx      # Tab navigator
│   ├── index.jsx        # Home/Content library
│   ├── create.jsx       # Creation/Input screen
│   ├── profile.jsx      # User profile/actors
│   └── settings.jsx     # App settings
├── (auth)/              # Authentication flow
│   ├── _layout.jsx      # Auth stack navigator
│   ├── welcome.jsx      # Welcome/onboarding
│   ├── signin.jsx       # Sign in
│   └── sample.jsx       # Sample content preview
├── content/             # Content viewing
│   ├── [id].jsx         # Content detail viewer
│   └── share/[token].jsx # Shared content view
├── modal/               # Modal screens
│   ├── storyboard.jsx   # Component showcase
│   ├── paywall.jsx      # Subscription modal
│   ├── add-actor.jsx    # Add profile/character
│   ├── share.jsx        # Share content modal
│   └── settings.jsx     # App settings modal
└── _layout.jsx          # Root layout with providers
```

### Generic Page Templates

### 1. **App Initialization** (Splash/Welcome)
**Purpose**: App loading, configuration, and onboarding

**Technical Requirements**:
- Check authentication status
- Verify subscription status
- Load app configuration
- Determine initial route

**API Calls**:
```javascript
// On app launch
await apiClient.get('/app/config');
await apiClient.get('/accounts/me'); // If authenticated
await apiClient.get('/subscriptions/status'); // If authenticated
```

**Navigation Logic**:
- No auth → Welcome Screen
- Auth + No onboarding → Sample Story
- Auth + Onboarding complete → Story Library
- Auth + Active story generation → Story Loading

---

### 2. **Welcome Screen** (WelcomeScreen.js)
**Purpose**: First-time user introduction with branding

**UI Components**:
- App logo and branding
- Animated illustrations
- "Create Your Story" primary CTA
- "Sign In" secondary option

**State Management**:
```javascript
const [appConfig, setAppConfig] = useState(null);
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  loadAppConfig();
}, []);
```

**Key Features**:
- Animated entrance transitions
- Preload sample story data
- Handle deep links for shared stories

---

### 3. **Sample Story Preview** (SampleStoryScreen.js)
**Purpose**: Show example story to demonstrate value

**UI Components**:
- Page viewer with swipe gestures
- Character avatars display
- "Create Your Own Story" floating CTA
- Skip option

**Implementation**:
```javascript
const [sampleContent, setSampleContent] = useState(null);
const [currentPage, setCurrentPage] = useState(0);

// Gesture handling for page swipes
const panResponder = useRef(
  PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      return Math.abs(gestureState.dx) > 5;
    },
    onPanResponderRelease: (evt, gestureState) => {
      if (gestureState.dx > 50) {
        previousPage();
      } else if (gestureState.dx < -50) {
        nextPage();
      }
    }
  })
).current;
```

**Caching Strategy**:
- Cache sample content locally
- Preload images for smooth transitions

---

### 4. **Authentication Flow** (AuthFlow/)
**Purpose**: Clerk-based authentication

**Screens**:
- SignInScreen.js
- SignUpScreen.js  
- VerifyEmailScreen.js

**Implementation**:
```javascript
import { useSignIn, useSignUp } from '@clerk/clerk-react-native';

const SignInScreen = () => {
  const { signIn, setActive, isLoaded } = useSignIn();
  
  const handleSignIn = async (email, password) => {
    try {
      const result = await signIn.create({
        identifier: email,
        password
      });
      
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        // Create/get account
        await apiClient.post('/auth/account');
        navigation.navigate('KidsSetup');
      }
    } catch (error) {
      handleAuthError(error);
    }
  };
};
```

---

### 5. **Kids Management** (KidsManagement/)

#### 5a. **Your Kids Screen** (YourKidsScreen.js)
**Purpose**: Central hub for managing child profiles

**UI Components**:
- Grid/List view of kid cards
- Add kid floating action button
- Edit/Delete options per kid
- Visual indicators for linked vs owned kids

**State Structure**:
```javascript
const kidsState = {
  ownedKids: [], // Kids created by this user
  linkedKids: [], // Kids from trusted families
  isLoading: false,
  error: null
};
```

**API Integration**:
```javascript
const loadKids = async () => {
  const [owned, linked] = await Promise.all([
    apiClient.get('/actors?type=child'),
    apiClient.get('/account-links/actors')
  ]);
  
  dispatch(setKids({
    owned: owned.data.data,
    linked: linked.data.data
  }));
};
```

#### 5b. **Add/Edit Kid Screen** (AddEditKidScreen.js)
**Purpose**: Create or edit child profile with photos

**UI Components**:
- Name input with validation
- Age selector
- Interest chips (selectable)
- Photo gallery (up to 10 photos)
- Camera/gallery picker
- Personality traits selector

**Photo Upload Flow**:
```javascript
const uploadPhotos = async (kidId, photos) => {
  const uploadPromises = photos.map(photo => {
    const formData = new FormData();
    formData.append('image', {
      uri: photo.uri,
      type: 'image/jpeg',
      name: 'photo.jpg'
    });
    formData.append('metadata', JSON.stringify({
      pose: photo.pose,
      description: photo.description
    }));
    
    return apiClient.post(`/actors/${kidId}/media`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  });
  
  await Promise.all(uploadPromises);
};
```

**Validation Rules**:
- Name: 2-50 characters
- Age: 0-18
- At least 1 interest selected
- Photos: Optional but recommended

---

### 6. **Additional Characters** (AdditionalCharactersScreen.js)
**Purpose**: Add non-child characters (adults, pets, imaginary)

**UI Components**:
- Character type selector (tabs/segments)
- Quick-add templates (Grandma, Dog, etc.)
- Custom character form
- Relationship selector
- Linked characters from trusted families

**Character Types**:
```javascript
const characterTypes = {
  adult: {
    templates: ['Mom', 'Dad', 'Grandma', 'Grandpa', 'Teacher'],
    icon: 'person',
    fields: ['name', 'relationship', 'traits']
  },
  pet: {
    templates: ['Dog', 'Cat', 'Rabbit', 'Fish'],
    icon: 'pets',
    fields: ['name', 'species', 'breed', 'traits']
  },
  imaginary: {
    templates: ['Dragon', 'Unicorn', 'Robot', 'Alien'],
    icon: 'stars',
    fields: ['name', 'type', 'powers', 'traits']
  }
};
```

---

### 7. **Story Library** (StoryLibrary/)

#### 7a. **Library Home** (LibraryHomeScreen.js)
**Purpose**: Browse all stories with filtering

**UI Components**:
- Tab bar: "My Stories" | "Stories I'm In"
- Story cards with thumbnails
- Search/filter options
- Sort by date/title
- Create story FAB

**Infinite Scroll Implementation**:
```javascript
const [stories, setStories] = useState([]);
const [page, setPage] = useState(1);
const [hasMore, setHasMore] = useState(true);

const loadMoreStories = async () => {
  if (!hasMore) return;
  
  const response = await apiClient.get('/artifacts', {
    params: {
      page,
      per_page: 20,
      filter: activeFilter
    }
  });
  
  setStories([...stories, ...response.data.data]);
  setHasMore(response.data.meta.has_more);
  setPage(page + 1);
};
```

#### 7b. **Story Details** (StoryDetailsScreen.js)
**Purpose**: View complete story with pages

**UI Components**:
- Page viewer with transitions
- Progress indicator
- Character bar showing who's in story
- Share button
- Image loading states
- Text-only fallback mode

**Page Navigation**:
```javascript
const StoryPageViewer = ({ artifact }) => {
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [imagesLoaded, setImagesLoaded] = useState({});
  
  // Preload next/previous page images
  useEffect(() => {
    preloadImages([
      pages[currentPage - 1]?.image_key,
      pages[currentPage + 1]?.image_key
    ].filter(Boolean));
  }, [currentPage]);
  
  return (
    <View style={styles.pageContainer}>
      <AnimatedPage 
        page={pages[currentPage]}
        imageLoaded={imagesLoaded[currentPage]}
      />
      <PageIndicator 
        total={pages.length} 
        current={currentPage}
      />
    </View>
  );
};
```

---

### 8. **Story Creation Flow** (StoryCreation/)

#### 8a. **Create Story Modal** (CreateStoryModal.js)
**Purpose**: Multi-step story creation bottom sheet

**Step 1 - Prompt & Settings**:
```javascript
const PromptStep = ({ onNext }) => {
  const [prompt, setPrompt] = useState('');
  const [length, setLength] = useState('medium');
  const [tone, setTone] = useState('adventurous');
  
  return (
    <View>
      <TextInput
        placeholder="What should the story be about? (optional)"
        value={prompt}
        onChangeText={setPrompt}
        multiline
        maxLength={500}
      />
      
      <SegmentedControl
        values={['Short', 'Medium', 'Long']}
        selectedIndex={lengthIndex}
        onChange={setLength}
      />
      
      <ToneSelector
        selected={tone}
        options={['adventurous', 'funny', 'educational', 'bedtime']}
        onChange={setTone}
      />
      
      <Button title="Next" onPress={() => onNext({ prompt, length, tone })} />
    </View>
  );
};
```

**Step 2 - Character Selection**:
```javascript
const CharacterStep = ({ prompt, onNext }) => {
  const [inferredCharacters, setInferredCharacters] = useState([]);
  const [selectedCharacters, setSelectedCharacters] = useState([]);
  const [isInferring, setIsInferring] = useState(true);
  
  useEffect(() => {
    inferCharacters();
  }, []);
  
  const inferCharacters = async () => {
    try {
      const response = await apiClient.post('/inputs/inference', { prompt });
      handleInferenceResults(response.data.data);
    } catch (error) {
      // Fallback to manual selection
    }
    setIsInferring(false);
  };
  
  const handleAmbiguousMatch = (name, candidates) => {
    // Show disambiguation modal
    showDisambiguationModal(name, candidates);
  };
};
```

**Step 3 - Generation**:
```javascript
const GenerationStep = ({ inputData }) => {
  const [progress, setProgress] = useState(0);
  const [artifact, setArtifact] = useState(null);
  
  useEffect(() => {
    generateStory();
  }, []);
  
  const generateStory = async () => {
    const response = await apiClient.post('/inputs', {
      ...inputData,
      generate_immediately: true
    });
    
    // Start polling for completion
    pollForCompletion(response.data.data.artifact.id);
  };
  
  const pollForCompletion = (artifactId) => {
    const interval = setInterval(async () => {
      const response = await apiClient.get(`/artifacts/${artifactId}`);
      
      if (response.data.data.status === 'complete') {
        clearInterval(interval);
        navigation.navigate('StoryPage1', { artifactId });
      }
      
      setProgress(response.data.data.progress || 0);
    }, 2000);
  };
};
```

---

### 9. **Paywall & Subscriptions** (Subscriptions/)

#### 9a. **Paywall Screen** (PaywallScreen.js)
**Purpose**: Convert free users to paid subscribers

**UI Components**:
- Hero illustration
- Value proposition bullets
- Subscription options with pricing
- "Best Value" badge on yearly
- Restore purchases option
- Terms and privacy links

**RevenueCat Integration**:
```javascript
import Purchases from 'react-native-purchases';

const PaywallScreen = ({ onSuccess }) => {
  const [offerings, setOfferings] = useState(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  
  useEffect(() => {
    loadOfferings();
  }, []);
  
  const loadOfferings = async () => {
    const offerings = await Purchases.getOfferings();
    setOfferings(offerings.current);
  };
  
  const purchase = async (package) => {
    setIsPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(package);
      
      // Log conversion
      await apiClient.post('/subscriptions/paywall', {
        action: 'converted',
        product_id: package.product.identifier
      });
      
      if (customerInfo.entitlements.active['premium']) {
        onSuccess();
      }
    } catch (error) {
      if (!error.userCancelled) {
        showError('Purchase failed');
      }
    }
    setIsPurchasing(false);
  };
};
```

---

### 10. **Sharing & Social Features** (Sharing/)

#### 10a. **Share Story** (ShareStoryScreen.js)
**Purpose**: Create shareable link for story

**UI Components**:
- Preview of what will be shared
- Share method selector (Link, QR, Social)
- Custom message input
- Copy link button
- Native share sheet

**Implementation**:
```javascript
const ShareStoryScreen = ({ artifactId }) => {
  const [shareData, setShareData] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const generateShareLink = async () => {
    setIsGenerating(true);
    const response = await apiClient.post('/shared-views', {
      artifact_id: artifactId,
      permissions: {
        can_view: true,
        can_repersonalize: true,
        can_claim_characters: true
      }
    });
    
    setShareData(response.data.data);
    setIsGenerating(false);
  };
  
  const shareViaSystem = async () => {
    await Share.share({
      message: shareData.message,
      url: shareData.short_url,
      title: 'Check out this story!'
    });
  };
};
```

#### 10b. **View Shared Story** (SharedStoryViewScreen.js)
**Purpose**: View story shared by another parent

**Deep Link Handling**:
```javascript
// App.js deep link configuration
const linking = {
  prefixes: ['https://snugglebug.com', 'snugglebug://'],
  config: {
    screens: {
      SharedStory: 'shared/:token'
    }
  }
};

// Screen implementation
const SharedStoryViewScreen = ({ route }) => {
  const { token } = route.params;
  const [storyData, setStoryData] = useState(null);
  const [canClaim, setCanClaim] = useState([]);
  
  const loadSharedStory = async () => {
    const response = await apiClient.get(`/shared-views/${token}`);
    setStoryData(response.data.data);
    
    // Identify claimable characters
    const claimable = response.data.data.characters.filter(
      char => !char.is_claimed && char.type === 'child'
    );
    setCanClaim(claimable);
  };
  
  const claimCharacter = async (characterName) => {
    // Navigate to claim flow
    navigation.navigate('ClaimCharacter', { 
      token, 
      characterName,
      storyData 
    });
  };
};
```

---

## 🔄 State Management Patterns

### Redux Toolkit Setup
```javascript
// store/slices/userSlice.js
const userSlice = createSlice({
  name: 'user',
  initialState: {
    account: null,
    subscription: null,
    kids: [],
    linkedFamilies: [],
    isLoading: false
  },
  reducers: {
    setAccount: (state, action) => {
      state.account = action.payload;
    },
    setSubscription: (state, action) => {
      state.subscription = action.payload;
    },
    addKid: (state, action) => {
      state.kids.push(action.payload);
    },
    updateKid: (state, action) => {
      const index = state.kids.findIndex(k => k.id === action.payload.id);
      if (index !== -1) {
        state.kids[index] = action.payload;
      }
    }
  }
});

// store/slices/storiesSlice.js
const storiesSlice = createSlice({
  name: 'stories',
  initialState: {
    myStories: [],
    sharedStories: [],
    activeGeneration: null,
    cache: {} // Keyed by story ID
  },
  reducers: {
    setStories: (state, action) => {
      state.myStories = action.payload.owned;
      state.sharedStories = action.payload.shared;
    },
    cacheStory: (state, action) => {
      state.cache[action.payload.id] = action.payload;
    }
  }
});
```

### Caching Strategy
```javascript
// utils/cache.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

export const CacheManager = {
  // Fast memory cache for active session
  memory: new Map(),
  
  // Persistent cache for offline support
  async cacheStory(story) {
    // Memory cache
    this.memory.set(`story_${story.id}`, story);
    
    // Disk cache
    await AsyncStorage.setItem(
      `story_${story.id}`,
      JSON.stringify(story)
    );
    
    // Image cache
    story.pages?.forEach(page => {
      if (page.image_key) {
        FastImage.preload([{
          uri: getImageUrl(page.image_key)
        }]);
      }
    });
  },
  
  async getCachedStory(storyId) {
    // Check memory first
    if (this.memory.has(`story_${storyId}`)) {
      return this.memory.get(`story_${storyId}`);
    }
    
    // Check disk
    const cached = await AsyncStorage.getItem(`story_${storyId}`);
    if (cached) {
      const story = JSON.parse(cached);
      this.memory.set(`story_${storyId}`, story);
      return story;
    }
    
    return null;
  }
};
```

---

## 🚨 Error Handling Patterns

### Global Error Boundary
```javascript
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    // Log to crash reporting
    crashlytics().recordError(error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    
    return this.props.children;
  }
}
```

### API Error Handling
```javascript
// utils/errorHandler.js
export const handleApiError = (error, context) => {
  const { response } = error;
  
  if (!response) {
    // Network error
    showToast('No internet connection', 'error');
    return;
  }
  
  switch (response.status) {
    case 401:
      // Auth error - handled by interceptor
      break;
      
    case 403:
      showToast('Subscription required', 'info');
      NavigationService.navigate('Paywall');
      break;
      
    case 422:
      // Validation errors
      const errors = response.data.errors;
      showValidationErrors(errors);
      break;
      
    case 429:
      showToast('Too many requests. Please try again later.', 'warning');
      break;
      
    default:
      showToast('Something went wrong. Please try again.', 'error');
      captureException(error, { context });
  }
};
```

---

## 📱 Platform-Specific Considerations

### iOS Specific
```javascript
// ios/Info.plist additions
<key>NSPhotoLibraryUsageDescription</key>
<string>SnuggleBug needs access to your photos to add pictures of your children</string>
<key>NSCameraUsageDescription</key>
<string>SnuggleBug needs camera access to take photos of your children</string>

// Deep linking
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>snugglebug</string>
    </array>
  </dict>
</array>
```

### Android Specific
```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />

<!-- Deep linking -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="snugglebug" />
  <data android:scheme="https" android:host="snugglebug.com" />
</intent-filter>
```

---

## 🎨 UI/UX Guidelines

### Design System
```javascript
// theme/index.js
export const theme = {
  colors: {
    primary: '#FF6B6B',
    secondary: '#4ECDC4',
    background: '#F7F9FC',
    surface: '#FFFFFF',
    text: '#2D3436',
    textSecondary: '#636E72',
    error: '#FF4757',
    success: '#00D2A0'
  },
  
  typography: {
    h1: {
      fontSize: 32,
      fontWeight: '700',
      lineHeight: 40
    },
    h2: {
      fontSize: 24,
      fontWeight: '600',
      lineHeight: 32
    },
    body: {
      fontSize: 16,
      fontWeight: '400',
      lineHeight: 24
    },
    caption: {
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 20
    }
  },
  
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32
  },
  
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 16,
    full: 9999
  }
};
```

### Animation Patterns
```javascript
// components/AnimatedStoryCard.js
const AnimatedStoryCard = ({ story, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  
  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true
    }).start();
  };
  
  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true
    }).start();
  };
  
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <StoryCard story={story} />
      </TouchableOpacity>
    </Animated.View>
  );
};
```

---

## 🔐 Security Considerations

### Secure Storage
```javascript
// utils/secureStorage.js
import * as Keychain from 'react-native-keychain';

export const SecureStorage = {
  async setToken(token) {
    await Keychain.setInternetCredentials(
      'snugglebug.com',
      'auth_token',
      token
    );
  },
  
  async getToken() {
    const credentials = await Keychain.getInternetCredentials('snugglebug.com');
    return credentials ? credentials.password : null;
  },
  
  async clearToken() {
    await Keychain.resetInternetCredentials('snugglebug.com');
  }
};
```

### Content Safety
```javascript
// utils/contentSafety.js
export const ContentSafety = {
  // Client-side validation before sending to API
  validatePrompt(prompt) {
    const blocked = ['inappropriate', 'violent', 'scary'];
    const lower = prompt.toLowerCase();
    
    for (const word of blocked) {
      if (lower.includes(word)) {
        return {
          valid: false,
          message: 'Please keep story prompts child-friendly'
        };
      }
    }
    
    return { valid: true };
  },
  
  // Report inappropriate content
  async reportContent(artifactId, reason) {
    await apiClient.post('/content-safety/report', {
      artifact_id: artifactId,
      reason,
      reported_at: new Date().toISOString()
    });
  }
};
```

---

## 📊 Analytics Integration

### Event Tracking
```javascript
// utils/analytics.js
import analytics from '@react-native-firebase/analytics';

export const Analytics = {
  // Screen tracking
  trackScreen(screenName, params = {}) {
    analytics().logScreenView({
      screen_name: screenName,
      screen_class: screenName,
      ...params
    });
  },
  
  // User actions
  trackEvent(eventName, params = {}) {
    analytics().logEvent(eventName, params);
  },
  
  // Conversion events
  trackConversion(product, price) {
    analytics().logPurchase({
      value: price,
      currency: 'USD',
      items: [{
        item_id: product.id,
        item_name: product.name,
        price: price
      }]
    });
  },
  
  // Story creation funnel
  trackStoryCreation(step, data) {
    const events = {
      started: 'story_creation_started',
      prompt_entered: 'story_prompt_entered',
      characters_selected: 'story_characters_selected',
      generation_started: 'story_generation_started',
      generation_completed: 'story_generation_completed',
      generation_failed: 'story_generation_failed'
    };
    
    this.trackEvent(events[step], data);
  }
};
```

---

## 🚀 Performance Optimization

### Image Optimization
```javascript
// utils/imageUtils.js
export const getOptimizedImageUrl = (imageKey, options = {}) => {
  const { width = 800, quality = 85, format = 'webp' } = options;
  
  // Cloudflare Images URL with transforms
  return `https://images.snugglebug.com/${imageKey}/w=${width},q=${quality},f=${format}`;
};

// Preload images for smooth transitions
export const preloadStoryImages = async (pages) => {
  const imageUrls = pages
    .filter(page => page.image_key)
    .map(page => ({
      uri: getOptimizedImageUrl(page.image_key),
      priority: FastImage.priority.high
    }));
    
  await FastImage.preload(imageUrls);
};
```

### List Performance
```javascript
// components/OptimizedStoryList.js
const OptimizedStoryList = ({ stories }) => {
  const renderStory = useCallback(({ item }) => (
    <StoryCard story={item} />
  ), []);
  
  const keyExtractor = useCallback((item) => item.id, []);
  
  const getItemLayout = useCallback((data, index) => ({
    length: STORY_CARD_HEIGHT,
    offset: STORY_CARD_HEIGHT * index,
    index
  }), []);
  
  return (
    <FlatList
      data={stories}
      renderItem={renderStory}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={10}
      initialNumToRender={5}
      ItemSeparatorComponent={Separator}
    />
  );
};
```

---

## 🧪 Testing Strategy

### Component Testing
```javascript
// __tests__/StoryCard.test.js
import { render, fireEvent } from '@testing-library/react-native';

describe('StoryCard', () => {
  const mockStory = {
    id: '123',
    title: 'Test Story',
    thumbnail_key: 'test_thumb',
    created_at: '2024-01-15T10:00:00Z'
  };
  
  it('renders story title', () => {
    const { getByText } = render(<StoryCard story={mockStory} />);
    expect(getByText('Test Story')).toBeTruthy();
  });
  
  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <StoryCard story={mockStory} onPress={onPress} />
    );
    
    fireEvent.press(getByTestId('story-card'));
    expect(onPress).toHaveBeenCalledWith(mockStory);
  });
});
```

### API Mocking
```javascript
// __mocks__/api.js
export const mockApiClient = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn()
};

// Usage in tests
beforeEach(() => {
  mockApiClient.get.mockClear();
  mockApiClient.get.mockImplementation((url) => {
    if (url === '/actors') {
      return Promise.resolve({
        data: { data: mockActors }
      });
    }
  });
});
```

---

## 📋 Launch Checklist

### Pre-Launch Requirements
- [ ] Clerk authentication configured
- [ ] RevenueCat products set up
- [ ] Deep linking configured
- [ ] Push notification certificates
- [ ] App Store/Play Store assets
- [ ] Privacy policy and terms
- [ ] Content moderation guidelines
- [ ] Error tracking (Sentry/Crashlytics)
- [ ] Analytics tracking verified
- [ ] Performance monitoring set up

### MVP Feature Completeness
- [ ] User can create account
- [ ] User can add multiple kids with photos
- [ ] User can create stories with prompts
- [ ] Stories generate with AI content
- [ ] Paywall blocks after page 1
- [ ] Subscription purchase works
- [ ] Stories can be shared via link
- [ ] Shared stories can be viewed
- [ ] Characters can be claimed
- [ ] Family linking works
- [ ] Offline viewing of cached stories

This guide provides the complete blueprint for building the SnuggleBug mobile app MVP. The focus is on core features that deliver value quickly while maintaining quality and performance.
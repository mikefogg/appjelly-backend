# 🏗️ **SnuggleBug Platform Architecture Outline**

This document outlines the complete SnuggleBug platform service structure using Express, Knex, Objection.js, and PostgreSQL. The platform powers AI-generated story and content creation apps with multi-tenant architecture.

---

## 📁 **1. Folder Structure**

```
snugglebug-platform/
├── src/
│   ├── models/                    # Objection.js models
│   │   ├── App.js                # Multi-tenant app configuration
│   │   ├── Account.js            # User accounts per app
│   │   ├── AccountLink.js        # Family/trusted user relationships
│   │   ├── Actor.js              # Story characters (kids, pets, etc.)
│   │   ├── Media.js              # Image uploads and assets
│   │   ├── Input.js              # User story prompts
│   │   ├── Artifact.js           # Generated stories/content
│   │   ├── ArtifactPage.js       # Individual story pages
│   │   ├── SharedView.js         # Secure sharing tokens
│   │   ├── Subscription.js       # RevenueCat integration
│   │   └── BaseModel.js          # Base model with common functionality
│   ├── routes/                    # Express route handlers
│   │   ├── public/               # Public API endpoints
│   │   │   ├── auth.js           # Authentication routes
│   │   │   ├── apps/             # App configuration & discovery
│   │   │   ├── accounts/         # Account management per app
│   │   │   ├── actors/           # Character creation/management
│   │   │   ├── account-links/    # Family network management
│   │   │   ├── media/            # Image upload & management
│   │   │   ├── inputs/           # Story prompt creation
│   │   │   ├── artifacts/        # Generated story access
│   │   │   ├── artifact-pages/   # Individual story page content
│   │   │   ├── shared-views/     # Secure sharing via tokens
│   │   │   ├── subscriptions/    # RevenueCat integration
│   │   │   ├── onboarding/       # First-time user flows
│   │   │   └── content-safety/   # Content moderation
│   │   ├── internal/             # Internal service endpoints
│   │   │   ├── admin.js          # Platform administration
│   │   │   ├── analytics.js      # Usage analytics & metrics
│   │   │   ├── app-management.js # Multi-tenant app configuration
│   │   │   ├── content-moderation.js # AI safety & content review
│   │   │   └── billing.js        # Revenue tracking & reporting
│   │   └── webhooks/             # External webhook handlers
│   │       ├── clerk.js          # Clerk authentication webhooks
│   │       ├── revenuecat.js     # Subscription webhooks
│   │       ├── media.js          # Media processing webhooks
│   │       └── content-safety.js # Content moderation webhooks
│   ├── background/               # Background job system
│   │   ├── jobs/                 # Individual job definitions
│   │   │   ├── content/          # AI story & content generation
│   │   │   ├── images/           # Image generation & processing
│   │   │   ├── subscriptions/    # Subscription sync jobs
│   │   │   ├── safety/           # Content moderation & safety
│   │   │   ├── notifications/    # Push notifications & emails
│   │   │   └── cleanup/          # Data cleanup tasks
│   │   ├── managers/             # Job queue managers
│   │   │   ├── content.js        # Content generation worker
│   │   │   ├── image.js          # Image processing worker
│   │   │   ├── subscription.js   # Subscription sync worker
│   │   │   ├── safety.js         # Content safety worker
│   │   │   ├── notification.js   # Notification worker
│   │   │   └── cleanup.js        # Cleanup worker
│   │   ├── queues/               # Queue configurations
│   │   └── repeatables/          # Scheduled/recurring jobs
│   ├── middleware/               # Express middleware
│   ├── helpers/                  # Business logic helpers
│   │   ├── ai-service.js         # Langchain LLM integration (OpenAI, Anthropic, etc.)
│   │   ├── media-service.js      # Cloudflare Images integration
│   │   └── subscription-service.js # RevenueCat integration
│   ├── utils/                    # Pure utility functions
│   ├── serializers/              # Data serialization
│   └── index.js                  # Main server entry
├── db/
│   ├── migrations/               # Knex database migrations
│   └── seeds/                    # Database seed files
├── tests/                        # Test suites
├── lib/                          # External libraries/configs
├── scripts/                      # Utility scripts
├── knexfile.js                   # Knex configuration
└── package.json                  # Dependencies & scripts
```

---

## 🗄️ **2. Database Setup (Knex + Objection.js + PostgreSQL)**

### **knexfile.js Pattern:**

```javascript
import pg from "pg";
import mockKnexConfig from "#root/__mocks__/knexfile.js";

const isTest = process.env.NODE_ENV?.toLowerCase().includes("test");
const useSsl =
  process.env.NODE_ENV === "production" || process.env.USE_DB_SSL === "true";

const knexConfig = isTest
  ? mockKnexConfig
  : {
      client: "pg",
      connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: useSsl ? { rejectUnauthorized: false } : null,
      },
      pool: {
        min: 5,
        max: parseInt(process.env.MAX_DB_POOL_SIZE || "10"),
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        idleTimeoutMillis: 60000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 100,
      },
      migrations: {
        directory: "db/migrations",
        loadExtensions: [".js"],
      },
      seeds: {
        directory: "db/seeds",
      },
      debug: process.env.KNEX_DEBUG === "true",
    };

export default knexConfig;
```

### **Database Connection Setup:**

```javascript
// src/models/index.js
import Knex from "knex";
import connection from "#root/knexfile.js";
import { Model } from "objection";

const knexConnection = Knex(connection);
Model.knex(knexConnection);
```

---

## 🏛️ **3. Model Structure (Objection.js Pattern)**

### **BaseModel Pattern:**

```javascript
// src/models/BaseModel.js
import { Model } from "objection";

class BaseModel extends Model {
  // Shared pagination logic
  static getBasePaginationQuery(query, pagination = {}, options = {}) {
    const sortDirection = pagination?.sort?.direction
      ? pagination.sort.direction
      : options.defaultSortDirection || "desc";
    const pageSize = Math.min(Number(pagination?.per_page || "50"), 50);

    if (pagination.before) {
      const operator = sortDirection === "desc" ? ">" : "<";
      const field =
        pagination?.sort?.field ||
        (isArray(options.sort) ? options.sort[0] : "created_at");
      const fullField = (options.sortPrefix || "") + field;
      query = query.where(fullField, operator, pagination.before);
    }

    if (pagination?.sort?.field) {
      query = query
        .whereNotNull((options.sortPrefix || "") + pagination.sort.field)
        .orderBy(
          (options.sortPrefix || "") + pagination.sort.field,
          sortDirection,
          "last"
        );
    } else {
      query = query.orderBy(
        (options.sortPrefix || "") + "created_at",
        sortDirection,
        "last"
      );
    }

    return query.limit(pageSize);
  }

  // Automatic timestamps
  $beforeInsert() {
    this.created_at = this.created_at || new Date().toISOString();
  }

  $beforeUpdate() {
    this.updated_at = new Date().toISOString();
  }
}

export default BaseModel;
```

### **Individual Model Pattern:**

```javascript
// src/models/Account.js
import {
  BaseModel,
  App,
  Actor,
  Input,
  Artifact,
  AccountLink,
  Subscription,
} from "#root/src/models/index.js";

class Account extends BaseModel {
  static get tableName() {
    return "accounts";
  }

  // Static query methods
  static async findByClerkId(clerkId, appId) {
    return this.query()
      .findOne({ clerk_id: clerkId, app_id: appId })
      .withGraphFetched("[app, actors, subscriptions]");
  }

  // Complex query builders
  static getBaseAccountQuery() {
    return this.query()
      .withGraphFetched(
        "[app, actors(activeActors), subscription(activeSubscription), account_links(trustedLinks)]"
      )
      .modifiers({
        activeActors: (builder) => {
          builder.select(["id", "name", "type", "metadata"]);
        },
        activeSubscription: (builder) => {
          builder
            .where("rc_renewal_status", "active")
            .orderBy("created_at", "desc")
            .first();
        },
        trustedLinks: (builder) => {
          builder
            .where("status", "accepted")
            .withGraphFetched("[linked_account]");
        },
      });
  }

  // Relationship mappings - NO predefined JSON schema
  static get relationMappings() {
    return {
      app: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: App,
        join: {
          from: "accounts.app_id",
          to: "apps.id",
        },
      },
      actors: {
        relation: BaseModel.HasManyRelation,
        modelClass: Actor,
        join: {
          from: "accounts.id",
          to: "actors.account_id",
        },
      },
      inputs: {
        relation: BaseModel.HasManyRelation,
        modelClass: Input,
        join: {
          from: "accounts.id",
          to: "inputs.account_id",
        },
      },
      artifacts: {
        relation: BaseModel.HasManyRelation,
        modelClass: Artifact,
        join: {
          from: "accounts.id",
          to: "artifacts.account_id",
        },
      },
      account_links: {
        relation: BaseModel.HasManyRelation,
        modelClass: AccountLink,
        join: {
          from: "accounts.id",
          to: "account_links.account_id",
        },
      },
      subscriptions: {
        relation: BaseModel.HasManyRelation,
        modelClass: Subscription,
        join: {
          from: "accounts.id",
          to: "subscriptions.account_id",
        },
      },
      // ... more relationships
    };
  }

  // Query modifiers for reusable selection patterns
  static get modifiers() {
    return {
      simpleSelects(builder) {
        builder.select(
          "id",
          "name",
          "username",
          "avatar_key",
          "metric_x_followers_count"
        );
      },
    };
  }
}

export default Account;
```

### **Model Export Pattern:**

```javascript
// src/models/index.js - Central export point
import Knex from "knex";
import connection from "#root/knexfile.js";
import { Model } from "objection";

const knexConnection = Knex(connection);
Model.knex(knexConnection);

// Export all models individually
export { default as BaseModel } from "#root/src/models/BaseModel.js";
export { default as App } from "#root/src/models/App.js";
export { default as Account } from "#root/src/models/Account.js";
export { default as AccountLink } from "#root/src/models/AccountLink.js";
export { default as Actor } from "#root/src/models/Actor.js";
export { default as Media } from "#root/src/models/Media.js";
export { default as Input } from "#root/src/models/Input.js";
export { default as Artifact } from "#root/src/models/Artifact.js";
export { default as ArtifactPage } from "#root/src/models/ArtifactPage.js";
export { default as SharedView } from "#root/src/models/SharedView.js";
export { default as Subscription } from "#root/src/models/Subscription.js";
// ... all other models

export { knexConnection as knex };
```

---

## 🛣️ **4. Route Structure**

### **Route Organization:**

```
src/routes/
├── public/           # Public endpoints (auth required/optional)
│   ├── index.js     # Route aggregator
│   ├── auth.js      # Authentication routes
│   ├── accounts/    # Account management routes
│   ├── actors/      # Character creation/management
│   ├── stories/     # Story generation & retrieval
│   ├── artifacts/   # Generated content access
│   ├── sharing/     # Secure sharing functionality
│   └── subscriptions/ # Subscription management
├── internal/        # Internal service endpoints
│   ├── index.js
│   ├── admin.js     # Platform administration
│   └── analytics.js # Usage analytics
└── webhooks/        # External webhook handlers
    ├── index.js
    ├── clerk.js     # Clerk authentication webhooks
    ├── revenuecat.js # Subscription webhooks
    └── media.js     # Media processing webhooks
```

### **Route File Pattern:**

```javascript
// src/routes/public/auth.js
import express from "express";
import { requireAuth } from "#src/middleware/index.js";
import { body, validationResult } from "express-validator";
import { raw } from "objection";
import { Account, App } from "#src/models/index.js";
import { currentAccountSerializer } from "#src/serializers/index.js";
import formatError, {
  formatExpressValidatorError,
} from "#src/helpers/format-error.js";

const router = express.Router({ mergeParams: true });

// Validation middleware
const createStoryValidators = [
  body("prompt")
    .isLength({ min: 10, max: 500 })
    .withMessage("Story prompt must be 10-500 characters"),
  body("actor_ids")
    .isArray({ min: 1, max: 5 })
    .withMessage("Must include 1-5 characters"),
  body("app_slug").notEmpty().withMessage("App slug is required"),
];

// Route handler with validation, auth, and error handling
router.post(
  "/stories",
  requireAuth,
  createStoryValidators,
  async (req, res) => {
    try {
      // Validation check
      let errors = validationResult(req).formatWith(
        formatExpressValidatorError
      );
      if (!errors.isEmpty()) {
        return res.status(422).json(errors);
      }

      const { prompt, actor_ids, app_slug, metadata } = req.body;

      // Find the app and account
      const app = await App.query().findOne({ slug: app_slug });
      if (!app) {
        return res.status(404).json(formatError("App not found"));
      }

      const account = await Account.query().findOne({
        clerk_id: res.locals.auth.userId,
        app_id: app.id,
      });
      if (!account) {
        return res.status(404).json(formatError("Account not found"));
      }

      // Business logic with database transactions
      const { input, artifact } = await Account.transaction(async (trx) => {
        // Create the input record
        const newInput = await Input.query(trx).insert({
          account_id: account.id,
          app_id: app.id,
          prompt,
          actor_ids,
          metadata: metadata || {},
        });

        // Create the artifact placeholder
        const newArtifact = await Artifact.query(trx).insert({
          input_id: newInput.id,
          account_id: account.id,
          app_id: app.id,
          artifact_type: "story",
          title: `Story - ${new Date().toLocaleDateString()}`,
          metadata: { status: "generating" },
        });

        return { input: newInput, artifact: newArtifact };
      });

      // Queue background job for story generation
      await storyGenerationQueue.add("generate-story", {
        inputId: input.id,
        artifactId: artifact.id,
      });

      // Serialized response
      const data = await artifactSerializer({ artifact });
      return res.status(201).json(data);
    } catch (error) {
      console.log({ error });
      return res.status(500).json(formatError("Failed to create story"));
    }
  }
);

export default router;
```

### **Main Route Assembly:**

```javascript
// src/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import publicRoutes from "#src/routes/public/index.js";
import internalRoutes from "#src/routes/internal/index.js";
import webhookRoutes from "#src/routes/webhooks/index.js";
import formatError from "#src/helpers/format-error.js";

const app = express();

// Middleware setup
app.use(cors());
app.use(helmet());
app.use(cookieParser());
app.disable("x-powered-by");
app.enable("trust proxy");

// Add routes
app.use("/internal", internalRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/", publicRoutes); // Public routes as default

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    code: 404,
    status: "Error",
    message: "Route not found.",
    data: null,
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  res.status(500).send(formatError("Unable to process request"));
});

const PORT = process.env.PORT ?? 4001;
app.listen(PORT, () => {
  console.log(`Service is running on port ${PORT}`);
});
```

---

## ⚙️ **5. Background Jobs Architecture**

### **Structure:**

```
src/background/
├── jobs/          # Individual job definitions by domain
│   ├── stories/   # AI story generation jobs
│   ├── images/    # Image generation & processing
│   ├── subscriptions/ # Subscription sync jobs
│   ├── cleanup/   # Data cleanup and maintenance
│   └── ...
├── managers/      # Queue managers (one per worker type)
│   ├── story.js   # Story generation worker
│   ├── image.js   # Image processing worker
│   ├── subscription.js # Subscription sync worker
│   ├── cleanup.js # Cleanup worker
│   └── ...
├── queues/        # Queue configuration
└── repeatables/   # Scheduled jobs
```

### **Package.json Scripts Pattern:**

```json
{
  "scripts": {
    "start": "node src/index.js",
    "story-worker": "node src/background/managers/story.js",
    "image-worker": "node src/background/managers/image.js",
    "subscription-worker": "node src/background/managers/subscription.js",
    "cleanup-worker": "node src/background/managers/cleanup.js",

    // Dev versions with nodemon and dotenvx
    "dev": "dotenvx run -f .env.development.local -f .env.development -f .env -- nodemon src/index.js",
    "story-worker-dev": "dotenvx run -f .env.development.local -f .env.development -f .env -- nodemon src/background/managers/story.js",
    "image-worker-dev": "dotenvx run -f .env.development.local -f .env.development -f .env -- nodemon src/background/managers/image.js"
  }
}
```

---

## 🎯 **6. Key Architecture Principles**

### **Import Pattern:**

```javascript
// Uses # paths for clean imports defined in package.json
"imports": {
  "#src/*.js": "./src/*.js",
  "#root/*.js": "./*.js"
}

// Usage:
import { Account, Actor, Artifact } from '#src/models/index.js'
import formatError from '#src/helpers/format-error.js'
```

### **Error Handling:**

- Consistent error formatting via `formatError` helper
- Express validator integration with `formatExpressValidatorError`
- Try/catch blocks in all route handlers
- Transaction-based operations for data consistency
- Structured JSON error responses

### **Authentication:**

- Middleware-based auth (`requireAuth`)
- Uses Clerk for user authentication and session management
- Auth context available via `res.locals.user`
- JWT-based authentication with Clerk

### **Data Flow:**

1. **Request** → **Middleware** (auth, validation) → **Route Handler**
2. **Route Handler** → **Model queries** (with transactions) → **Serializer** → **Response**
3. **Background Jobs** → **Queue Managers** → **Individual Job Processors**

### **Key Dependencies:**

```json
{
  "dependencies": {
    "express": "^4.21.1",
    "objection": "^3.1.4",
    "knex": "^3.1.0",
    "pg": "^8.11.5",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "cookie-parser": "^1.4.6",
    "express-validator": "^7.1.0",
    "@clerk/clerk-sdk-node": "^5.0.0",
    "@taskforcesh/bullmq-pro": "^7.8.2",
    "redis": "^4.7.0",
    "jsonwebtoken": "^9.0.2",
    "lodash-es": "^4.17.21",
    "date-fns": "^3.6.0",
    "@langchain/openai": "^0.4.0",
    "@langchain/anthropic": "^0.3.0",
    "@langchain/core": "^0.3.0",
    "langchain": "^0.3.0",
    "aws-sdk": "^2.1500.0",
    "sharp": "^0.33.0",
    "node-cron": "^3.0.0"
  }
}
```

---

## 🛠️ **Setup Instructions for Another Agent**

To recreate this structure:

### **1. Initialize Project:**

```bash
mkdir new-service && cd new-service
npm init -y
```

### **2. Install Dependencies:**

```bash
# Core dependencies
npm install express objection knex pg cors helmet cookie-parser
npm install express-validator jsonwebtoken lodash-es date-fns
npm install @dotenvx/dotenvx redis @taskforcesh/bullmq-pro

# Development dependencies
npm install -D nodemon jest supertest @faker-js/faker
```

### **3. Setup Package.json:**

```json
{
  "type": "module",
  "imports": {
    "#src/*.js": "./src/*.js",
    "#root/*.js": "./*.js"
  },
  "scripts": {
    "dev": "dotenvx run -f .env.development.local -f .env.development -f .env -- nodemon src/index.js",
    "start": "node src/index.js",
    "test": "NODE_ENV=TEST dotenvx run -f .env.test.local -f .env.test -- npx jest --runInBand"
  }
}
```

### **4. Create Directory Structure:**

```bash
mkdir -p src/{models,routes/{public,internal,webhooks},background/{jobs,managers,queues,repeatables},middleware,helpers,utils,serializers}
mkdir -p db/{migrations,seeds}
mkdir -p tests
```

### **5. Create Core Files:**

**knexfile.js:**

- Environment-aware configuration
- SSL handling for production
- Migration and seed paths

**src/models/BaseModel.js:**

- Extend Objection Model
- Add pagination helpers
- Automatic timestamps

**src/models/index.js:**

- Initialize Knex connection
- Export all models
- Central import point

**src/index.js:**

- Express app setup
- Middleware configuration
- Route mounting
- Error handling

### **6. Database Setup:**

```bash
# Create initial migration
npx knex migrate:make create_initial_tables

# Run migrations
npx knex migrate:latest

# Create seeds
npx knex seed:make initial_data
```

### **7. Development Patterns:**

**Models:**

- Extend BaseModel
- Define relationships in `relationMappings`
- No JSON schema required
- Use static methods for complex queries
- Implement modifiers for reusable selections

**Routes:**

- Use express.Router with mergeParams
- Implement validation middleware
- Consistent error handling with try/catch
- Transaction-based operations
- Serialized responses

**Background Jobs:**

- Domain-based job organization
- Manager scripts for queue processing
- Separate dev/prod configurations

This structure prioritizes **modularity**, **consistency**, and **scalability** while maintaining clean separation between concerns and following established Node.js/Express patterns.

---

## 🛣️ **Complete MVP Route Coverage**

### **Public API Routes (Mobile App)**

#### **App Configuration & Discovery**

```
GET    /apps/:slug                    # Get app config by slug
GET    /apps/:slug/sample-content     # Sample stories for onboarding
```

#### **Authentication & Account Management**

```
POST   /auth/account                  # Create/get account for app
GET    /accounts/me                   # Current account details
PATCH  /accounts/me                   # Update account metadata
DELETE /accounts/me                   # Delete account
```

#### **Actor (Character) Management**

```
GET    /actors                        # List user's actors in app
POST   /actors                        # Create new actor
GET    /actors/:id                    # Get actor details
PATCH  /actors/:id                    # Update actor
DELETE /actors/:id                    # Delete actor
POST   /actors/:id/media              # Upload actor photos
DELETE /actors/:id/media/:mediaId     # Remove actor photo
```

#### **Family Network & Account Links**

```
GET    /account-links                 # List trusted families
POST   /account-links                 # Create family link request
PATCH  /account-links/:id             # Accept/reject link
DELETE /account-links/:id             # Remove family link
GET    /account-links/actors          # List all linked family actors
```

#### **Content Creation (Inputs)**

```
POST   /inputs                        # Create story prompt
GET    /inputs                        # List user's prompts
GET    /inputs/:id                    # Get prompt details
POST   /inputs/:id/inference          # Auto-detect actors in prompt
```

#### **Generated Content (Artifacts)**

```
GET    /artifacts                     # List user's stories
GET    /artifacts/:id                 # Get story details
GET    /artifacts/:id/pages           # Get story pages
GET    /artifacts/:id/pages/:pageNum  # Get specific page content
POST   /artifacts/:id/regenerate      # Regenerate story content
DELETE /artifacts/:id                 # Delete story
```

#### **Secure Sharing**

```
POST   /shared-views                  # Create sharing token
GET    /shared-views/:token           # Access shared content
POST   /shared-views/:token/claim     # Claim character in shared story
GET    /shared-views/:token/actors    # List actors in shared story
```

#### **Media Management**

```
POST   /media/upload                  # Upload image with signed URL
GET    /media/:id                     # Get media details
DELETE /media/:id                     # Delete media
POST   /media/batch-upload            # Upload multiple images
```

#### **Subscription Management**

```
GET    /subscriptions/status          # Check subscription status
POST   /subscriptions/paywall         # Log paywall interaction
GET    /subscriptions/products        # Get available products
POST   /subscriptions/events          # Track subscription events
```

#### **Onboarding & User Experience**

```
GET    /onboarding/sample-story       # Get sample story for preview
POST   /onboarding/complete           # Mark onboarding complete
GET    /onboarding/suggestions        # Get character/prompt suggestions
```

#### **Content Safety**

```
POST   /content-safety/report         # Report inappropriate content
GET    /content-safety/guidelines     # Get content guidelines
```

### **Internal API Routes (Admin & Platform)**

#### **Platform Administration**

```
GET    /internal/apps                 # List all platform apps
POST   /internal/apps                 # Create new app
PATCH  /internal/apps/:id             # Update app configuration
GET    /internal/apps/:id/stats       # App usage statistics
```

#### **Analytics & Metrics**

```
GET    /internal/analytics/overview   # Platform-wide metrics
GET    /internal/analytics/apps/:id   # App-specific metrics
GET    /internal/analytics/conversion # Subscription conversion rates
POST   /internal/analytics/events     # Track custom events
```

#### **Content Moderation**

```
GET    /internal/moderation/queue     # Content awaiting review
POST   /internal/moderation/approve   # Approve content
POST   /internal/moderation/reject    # Reject content
GET    /internal/moderation/reports   # User-reported content
```

#### **Billing & Revenue**

```
GET    /internal/billing/revenue      # Revenue reporting
GET    /internal/billing/subscriptions # Subscription analytics
GET    /internal/billing/churn        # Churn analysis
```

### **Webhook Routes (External Services)**

#### **Authentication Webhooks**

```
POST   /webhooks/clerk/user-created   # New user signup
POST   /webhooks/clerk/user-updated   # User profile changes
POST   /webhooks/clerk/user-deleted   # Account deletion
```

#### **Subscription Webhooks**

```
POST   /webhooks/revenuecat           # All subscription events (purchase, renewal, cancel, etc.)
```

#### **Media Processing Webhooks**

```
POST   /webhooks/media                # Media processing events (complete, failed, etc.)
```

#### **Content Safety Webhooks**

```
POST   /webhooks/safety/scan-complete # Content safety scan results
POST   /webhooks/safety/violation     # Content policy violation
```

---

## 🧪 **Testing Strategy - Route-Only Testing with Vitest**

### **Philosophy: API Contract Testing**

For MVP, we focus **exclusively on route testing** - if the API endpoints work correctly, we assume the underlying models and services work too. This approach prioritizes shipping speed while maintaining confidence in the public interface.

### **Test Structure**

```
tests/
├── routes/
│   ├── public/
│   │   ├── auth.test.js
│   │   ├── apps.test.js
│   │   ├── accounts.test.js
│   │   ├── actors.test.js
│   │   ├── account-links.test.js
│   │   ├── artifacts.test.js
│   │   ├── shared-views.test.js
│   │   └── subscriptions.test.js
│   ├── internal/
│   │   ├── admin.test.js
│   │   ├── analytics.test.js
│   │   └── content-moderation.test.js
│   └── webhooks/
│       ├── clerk.test.js
│       ├── revenuecat.test.js
│       └── media.test.js
├── helpers/
│   ├── setup.js           # Test database & app setup
│   ├── auth-helpers.js    # Mock Clerk authentication
│   ├── mock-data.js       # Test fixtures & factories
│   └── assertions.js      # Custom assertion helpers
└── vitest.config.js       # Vitest configuration
```

### **What Each Route Test Should Cover**

#### **1. Authentication & Authorization**

```javascript
// Test that protected routes require auth
test("requires authentication", async () => {
  const response = await request(app).get("/actors");
  expect(response.status).toBe(401);
});

// Test that routes respect app-scoping
test("only returns data for current app", async () => {
  const user = await createAuthenticatedUser({ appSlug: "snugglebug" });
  const response = await request(app)
    .get("/actors")
    .set("Authorization", `Bearer ${user.token}`);

  expect(
    response.body.data.every((actor) => actor.app_id === user.app.id)
  ).toBe(true);
});
```

#### **2. Input Validation**

```javascript
// Test required fields
test("validates required fields", async () => {
  const user = await createAuthenticatedUser();
  const response = await request(app)
    .post("/actors")
    .set("Authorization", `Bearer ${user.token}`)
    .send({}); // Missing required name field

  expect(response.status).toBe(422);
  expect(response.body.errors).toContain("Name is required");
});

// Test field formats and constraints
test("validates actor name length", async () => {
  const user = await createAuthenticatedUser();
  const response = await request(app)
    .post("/actors")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ name: "A".repeat(101) }); // Too long

  expect(response.status).toBe(422);
});
```

#### **3. Response Format & Status Codes**

```javascript
// Test successful response format
test("returns correct response format", async () => {
  const user = await createAuthenticatedUser();
  const response = await request(app)
    .get("/actors")
    .set("Authorization", `Bearer ${user.token}`);

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty("data");
  expect(response.body).toHaveProperty("meta");
  expect(Array.isArray(response.body.data)).toBe(true);
});

// Test error response format
test("returns consistent error format", async () => {
  const response = await request(app).get("/actors"); // No auth

  expect(response.status).toBe(401);
  expect(response.body).toHaveProperty("error");
  expect(response.body.error).toHaveProperty("message");
  expect(response.body.error).toHaveProperty("code");
});
```

#### **4. Business Logic Integration**

```javascript
// Test multi-tenant isolation
test("creates actor scoped to correct app", async () => {
  const user = await createAuthenticatedUser({ appSlug: "snugglebug" });
  const response = await request(app)
    .post("/actors")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ name: "Test Child", type: "child" });

  expect(response.status).toBe(201);
  expect(response.body.data.app_id).toBe(user.app.id);
  expect(response.body.data.account_id).toBe(user.account.id);
});

// Test family link permissions
test("allows access to linked family actors", async () => {
  const { userA, userB } = await createLinkedFamilies();
  const actorB = await createActor({ accountId: userB.account.id });

  const response = await request(app)
    .get("/account-links/actors")
    .set("Authorization", `Bearer ${userA.token}`);

  expect(response.body.data).toContainEqual(
    expect.objectContaining({ id: actorB.id })
  );
});
```

### **Mocking Strategy**

#### **Mock External Services (Not Internal Models)**

```javascript
// Mock Clerk authentication
vi.mock("@clerk/clerk-sdk-node", () => ({
  verifyToken: vi.fn().mockResolvedValue({ userId: "test-user-123" }),
}));

// Mock RevenueCat webhooks
vi.mock("../src/helpers/subscription-service.js", () => ({
  processRevenueCatWebhook: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock AI content generation
vi.mock("../src/helpers/ai-service.js", () => ({
  generateStory: vi.fn().mockResolvedValue({
    pages: [{ text: "Once upon a time...", pageNumber: 1 }],
  }),
}));

// Mock media processing
vi.mock("../src/helpers/media-service.js", () => ({
  uploadImage: vi.fn().mockResolvedValue({ imageKey: "test-image-key" }),
}));
```

### **Test Data Factories**

```javascript
// helpers/mock-data.js
export const createApp = async (overrides = {}) => {
  return await App.query().insert({
    slug: "test-app",
    name: "Test App",
    config: { features: ["stories"] },
    ...overrides,
  });
};

export const createAccount = async (app, overrides = {}) => {
  return await Account.query().insert({
    clerk_id: `clerk_${Math.random()}`,
    email: "test@example.com",
    app_id: app.id,
    metadata: {},
    ...overrides,
  });
};

export const createAuthenticatedUser = async (options = {}) => {
  const app = await createApp({ slug: options.appSlug || "test-app" });
  const account = await createAccount(app);
  const token = generateTestJWT({ userId: account.clerk_id, appId: app.id });

  return { app, account, token };
};
```

### **Vitest Configuration**

```javascript
// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/setup.js"],
    testTimeout: 10000,
    hookTimeout: 10000,
    globals: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
```

### **Test Database Setup**

```javascript
// tests/helpers/setup.js
import { beforeAll, afterAll, beforeEach } from "vitest";
import { knex } from "../../src/models/index.js";

beforeAll(async () => {
  // Run migrations on test database
  await knex.migrate.latest();
});

beforeEach(async () => {
  // Clean all tables before each test
  await knex.raw(
    "TRUNCATE TABLE apps, accounts, actors, artifacts, inputs, media, subscriptions CASCADE"
  );
});

afterAll(async () => {
  // Close database connection
  await knex.destroy();
});
```

### **Key Testing Principles**

1. **Test the Contract, Not Implementation**: Focus on HTTP status codes, response formats, and data correctness
2. **Mock External Dependencies**: Clerk, RevenueCat, AI services, media processing
3. **Use Real Database**: Test actual SQL queries and transactions with a test database
4. **App-Scoped Testing**: Always test multi-tenant isolation
5. **Authentication Helpers**: Create utilities for testing with different user contexts
6. **Fast Feedback**: Route tests should run quickly (< 30 seconds for full suite)

### **Test Command Structure**

```json
{
  "scripts": {
    "test": "vitest",
    "test:routes": "vitest tests/routes/",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage"
  }
}
```

This route-focused testing approach ensures the API works correctly while keeping tests fast and maintainable for MVP development.

---

## 📦 **SnuggleBug Platform – Data Model Schema**

The platform uses the following database models with multi-tenant architecture. All models include timestamps and support per-app configuration.

### **1. `apps` Table**

**Purpose:** Represents a distinct app instance (e.g. `snugglebug`, `puptales`), and stores global configuration for that app.

| Field      | Type      | Description                          |
| ---------- | --------- | ------------------------------------ |
| id         | uuid      | Primary key                          |
| slug       | string    | Unique identifier used across models |
| name       | string    | Display name                         |
| config     | jsonb     | Feature flags, UI text, layout, etc. |
| created_at | timestamp | Auto-managed                         |
| updated_at | timestamp | Auto-managed                         |

### **2. `accounts` Table**

**Purpose:** Represents an authenticated end-user (typically a parent), scoped to a specific app.

| Field      | Type      | Description            |
| ---------- | --------- | ---------------------- |
| id         | uuid      | Primary key            |
| clerk_id   | string    | Clerk auth ID          |
| email      | string    | User email             |
| app_id     | uuid      | FK → apps.id           |
| metadata   | jsonb     | App-specific user data |
| created_at | timestamp | Auto-managed           |
| updated_at | timestamp | Auto-managed           |

### **3. `account_links` Table**

**Purpose:** Stores trusted relationships between accounts for story sharing and family linking.

| Field             | Type      | Description                              |
| ----------------- | --------- | ---------------------------------------- |
| id                | uuid      | Primary key                              |
| account_id        | uuid      | FK → accounts.id (requesting user)       |
| linked_account_id | uuid      | FK → accounts.id (linked user)           |
| app_id            | uuid      | FK → apps.id                             |
| status            | string    | `'pending'`, `'accepted'`, `'revoked'`   |
| created_by_id     | uuid      | FK → accounts.id (initiator of the link) |
| metadata          | jsonb     | Optional notes, labels, etc.             |
| created_at        | timestamp | Auto-managed                             |
| updated_at        | timestamp | Auto-managed                             |

### **4. `actors` Table**

**Purpose:** Represents a character in a story (e.g. child, parent, pet, or imaginary character).

| Field      | Type      | Description                         |
| ---------- | --------- | ----------------------------------- |
| id         | uuid      | Primary key                         |
| account_id | uuid      | FK → accounts.id                    |
| app_id     | uuid      | FK → apps.id                        |
| name       | string    | Public-facing character name        |
| type       | string    | `'child'`, `'pet'`, `'adult'`, etc. |
| metadata   | jsonb     | Traits, tags, or custom roles       |
| created_at | timestamp | Auto-managed                        |
| updated_at | timestamp | Auto-managed                        |

### **5. `media` Table**

**Purpose:** Stores uploaded images linked to actors or story inputs.

| Field      | Type      | Description                          |
| ---------- | --------- | ------------------------------------ |
| id         | uuid      | Primary key                          |
| owner_type | string    | `'actor'` or `'input'`               |
| owner_id   | uuid      | FK to the related record             |
| image_key  | string    | Cloudflare Images key                |
| metadata   | jsonb     | Pose, style, or other image metadata |
| created_at | timestamp | Auto-managed                         |
| updated_at | timestamp | Auto-managed                         |

### **6. `inputs` Table**

**Purpose:** Represents a user-submitted prompt and character selection used to generate artifacts (e.g. stories).

| Field      | Type      | Description                    |
| ---------- | --------- | ------------------------------ |
| id         | uuid      | Primary key                    |
| account_id | uuid      | FK → accounts.id               |
| app_id     | uuid      | FK → apps.id                   |
| prompt     | text      | Raw user input                 |
| actor_ids  | uuid[]    | List of character IDs involved |
| metadata   | jsonb     | Length, tone, and style info   |
| created_at | timestamp | Auto-managed                   |
| updated_at | timestamp | Auto-managed                   |

### **7. `artifacts` Table**

**Purpose:** Stores the AI-generated output, such as a story or image, linked to the original input.

| Field         | Type      | Description                      |
| ------------- | --------- | -------------------------------- |
| id            | uuid      | Primary key                      |
| input_id      | uuid      | FK → inputs.id                   |
| account_id    | uuid      | FK → accounts.id                 |
| app_id        | uuid      | FK → apps.id                     |
| artifact_type | string    | `'story'`, `'image'`, etc.       |
| title         | string    | Optional display title           |
| metadata      | jsonb     | Output configuration and context |
| created_at    | timestamp | Auto-managed                     |
| updated_at    | timestamp | Auto-managed                     |

### **8. `artifact_pages` Table**

**Purpose:** Stores paginated content for multi-page artifacts (e.g. illustrated storybooks).

| Field       | Type      | Description                             |
| ----------- | --------- | --------------------------------------- |
| id          | uuid      | Primary key                             |
| artifact_id | uuid      | FK → artifacts.id                       |
| page_number | integer   | Index (starting at 1)                   |
| text        | text      | Text content of the page                |
| image_key   | string    | Cloudflare image key for the page image |
| layout_data | jsonb     | Layout info (positions, layers, etc.)   |
| created_at  | timestamp | Auto-managed                            |
| updated_at  | timestamp | Auto-managed                            |

### **9. `shared_views` Table**

**Purpose:** Grants access to shared artifacts via secure token-based links.

| Field       | Type      | Description                      |
| ----------- | --------- | -------------------------------- |
| id          | uuid      | Primary key                      |
| artifact_id | uuid      | FK → artifacts.id                |
| token       | string    | Unique access token              |
| permissions | jsonb     | View or repersonalize options    |
| metadata    | jsonb     | Expiration or additional context |
| created_at  | timestamp | Auto-managed                     |
| updated_at  | timestamp | Auto-managed                     |

### **10. `subscriptions` Table**

**Purpose:** Tracks RevenueCat subscription status and entitlement for each account.

| Field             | Type      | Description                                      |
| ----------------- | --------- | ------------------------------------------------ |
| id                | uuid      | Primary key                                      |
| account_id        | uuid      | FK → accounts.id                                 |
| rc_user_id        | string    | RevenueCat user ID                               |
| rc_entitlement    | string    | Entitlement name (e.g. `'pro_access'`)           |
| rc_product_id     | string    | Product ID or SKU                                |
| rc_period_type    | string    | `'normal'`, `'trial'`, `'intro'`                 |
| rc_renewal_status | string    | `'active'`, `'expired'`, `'billing_issue'`, etc. |
| rc_platform       | string    | `'ios'`, `'android'`, `'web'`                    |
| rc_expiration     | timestamp | Expiration datetime for access                   |
| metadata          | jsonb     | Webhook data or debug information                |
| created_at        | timestamp | Auto-managed                                     |
| updated_at        | timestamp | Auto-managed                                     |

import BaseModel from "#src/models/BaseModel.js";
import App from "#src/models/App.js";
import Actor from "#src/models/Actor.js";
import Input from "#src/models/Input.js";
import Artifact from "#src/models/Artifact.js";
import AccountLink from "#src/models/AccountLink.js";
import Subscription from "#src/models/Subscription.js";

class Account extends BaseModel {
  static get tableName() {
    return "accounts";
  }

  static get jsonSchema() {
    return {
      type: "object",
      required: ["clerk_id", "email", "app_id"],
      properties: {
        ...super.jsonSchema.properties,
        clerk_id: { type: "string", minLength: 1 },
        email: { type: "string", format: "email" },
        app_id: { type: "string", format: "uuid" },
        name: { type: ["string", "null"], minLength: 1, maxLength: 100 },
        metadata: { type: "object" },
      },
    };
  }

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
      linked_accounts: {
        relation: BaseModel.HasManyRelation,
        modelClass: AccountLink,
        join: {
          from: "accounts.id",
          to: "account_links.linked_account_id",
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
    };
  }

  static async findByClerkId(clerkId, appId) {
    return this.query()
      .findOne({ clerk_id: clerkId, app_id: appId })
      .withGraphFetched("[app, actors, subscriptions]");
  }

  static async findWithSubscriptionData(clerkId, appId) {
    return this.query()
      .findOne({ clerk_id: clerkId, app_id: appId })
      .withGraphFetched("[app, subscriptions(active)]")
      .modifiers({
        active: (builder) => {
          builder
            .where("rc_renewal_status", "active")
            .where("rc_expiration", ">", new Date().toISOString())
            .orderBy("rc_expiration", "desc");
        },
      });
  }

  static getBaseAccountQuery() {
    return this.query()
      .withGraphFetched(
        "[app, actors(activeActors), subscriptions(activeSubscription), account_links(trustedLinks)]"
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

  static get modifiers() {
    return {
      publicProfile(builder) {
        builder.select("id", "email", "name", "metadata", "created_at");
      },
    };
  }

  /**
   * Generate a display name for the account based on name or children
   * @returns {Promise<string>}
   */
  async generateDisplayName() {
    // If account has a name set, use it with "Family" suffix
    if (this.name) {
      return `The ${this.name} Family`;
    }

    // Otherwise, generate from children names (only non-claimable = actual family kids)
    const children = await Actor.query()
      .where("account_id", this.id)
      .where("type", "child")
      .where("is_claimable", false) // Only verified ownership children
      .orderBy("created_at", "asc")
      .limit(3); // Max 3 names to avoid too long display names

    if (children.length === 0) {
      // Fallback to generic name
      return "My Family";
    }

    const childNames = children.map(child => child.name);
    
    if (childNames.length === 1) {
      return `${childNames[0]}'s Family`;
    } else if (childNames.length === 2) {
      return `${childNames[0]} & ${childNames[1]}'s Family`;
    } else {
      // 3+ children: "Ava, Ella & Mason's Family"
      const firstNames = childNames.slice(0, -1).join(", ");
      const lastName = childNames[childNames.length - 1];
      return `${firstNames} & ${lastName}'s Family`;
    }
  }

  /**
   * Get the current display name (from metadata or generate new one)
   * @returns {Promise<string>}
   */
  async getDisplayName() {
    // Check if we have a cached display name in metadata
    if (this.metadata?.display_name) {
      return this.metadata.display_name;
    }

    // Generate and cache the display name
    const displayName = await this.generateDisplayName();
    
    // Update metadata with the generated display name
    await this.$query().patch({
      metadata: {
        ...this.metadata,
        display_name: displayName,
        display_name_generated_at: new Date().toISOString()
      }
    });

    return displayName;
  }

  /**
   * Update the account name and regenerate display name
   * @param {string|null} newName - New account name (e.g. "Fogg")
   * @returns {Promise<Account>}
   */
  async updateAccountName(newName) {
    // Temporarily update the name to generate correct display name
    this.name = newName;
    const displayName = await this.generateDisplayName();

    // Update both name and display name
    return await this.$query().patchAndFetch({
      name: newName,
      metadata: {
        ...this.metadata,
        display_name: displayName,
        display_name_updated_at: new Date().toISOString(),
        display_name_source: newName ? "account_name" : "children_names"
      }
    });
  }

  // Instance methods for subscription management
  getActiveSubscription() {
    // Use pre-loaded subscription data if available, otherwise query
    if (this.subscriptions && Array.isArray(this.subscriptions)) {
      return this.subscriptions.find(sub => 
        sub.rc_renewal_status === "active" && 
        new Date(sub.rc_expiration) > new Date()
      ) || null;
    }
    
    // Fallback to querying if subscriptions not loaded
    return this.constructor.query()
      .joinRelated("subscriptions")
      .where("account_id", this.id)
      .where("subscriptions.rc_renewal_status", "active")
      .where("subscriptions.rc_expiration", ">", new Date().toISOString())
      .orderBy("subscriptions.rc_expiration", "desc")
      .first();
  }

  hasActiveSubscription() {
    const subscription = this.getActiveSubscription();
    return !!subscription;
  }

  hasEntitlement(entitlementName) {
    const subscription = this.getActiveSubscription();
    return subscription?.rc_entitlement === entitlementName;
  }

  getSubscriptionInfo() {
    const subscription = this.getActiveSubscription();
    if (!subscription) {
      return {
        is_active: false,
        entitlement: null,
        expires_at: null,
        renewal_status: null,
      };
    }

    return {
      is_active: true,
      entitlement: subscription.rc_entitlement,
      expires_at: subscription.rc_expiration,
      renewal_status: subscription.rc_renewal_status,
      platform: subscription.rc_platform,
    };
  }
}

export default Account;
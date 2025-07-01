import express from "express";
import { body, param } from "express-validator";
import { requireAuth, requireAppContext, handleValidationErrors, rateLimitByAccount } from "#src/middleware/index.js";
import { AccountLink, Actor, Account } from "#src/models/index.js";
import { successResponse, createdResponse, paginatedResponse, accountLinkSerializer, actorWithAccessSerializer } from "#src/serializers/index.js";
import { formatError } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const createLinkValidators = [
  body("linked_account_email").optional().isEmail().withMessage("Valid email is required"),
  body("linked_account_clerk_id").optional().isString().withMessage("Valid clerk ID is required"),
  body().custom((value) => {
    if (!value.linked_account_email && !value.linked_account_clerk_id) {
      throw new Error("Either linked_account_email or linked_account_clerk_id is required");
    }
    return true;
  }),
  body("metadata").optional().isObject().withMessage("Metadata must be an object"),
];

const updateLinkValidators = [
  param("id").isUUID().withMessage("Invalid link ID"),
  body("status").isIn(["accepted", "rejected"]).withMessage("Status must be accepted or rejected"),
];

router.get(
  "/",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {

      const outgoingLinks = await AccountLink.query()
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[linked_account(publicProfile)]")
        .modifiers({
          publicProfile: (builder) => {
            builder.select("id", "metadata");
          },
        });

      const incomingLinks = await AccountLink.query()
        .where("linked_account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .withGraphFetched("[account(publicProfile), created_by(publicProfile)]")
        .modifiers({
          publicProfile: (builder) => {
            builder.select("id", "metadata");
          },
        });

      const allLinks = [
        ...outgoingLinks.map(link => ({
          id: link.id,
          status: link.status,
          direction: "outgoing",
          app_id: link.app_id,
          linked_account: {
            id: link.linked_account.id,
            display_name: link.linked_account.metadata?.display_name || "Family Member",
          },
          created_at: link.created_at,
          metadata: link.metadata,
        })),
        ...incomingLinks.map(link => ({
          id: link.id,
          status: link.status,
          direction: "incoming",
          app_id: link.app_id,
          from_account: {
            id: link.account.id,
            display_name: link.account.metadata?.display_name || "Family Member",
          },
          created_at: link.created_at,
          metadata: link.metadata,
        })),
      ];

      const { status } = req.query;
      const filteredLinks = status ? allLinks.filter(link => link.status === status) : allLinks;

      return res.status(200).json(paginatedResponse(filteredLinks, { total: filteredLinks.length, per_page: 50 }, "Account links retrieved successfully"));
    } catch (error) {
      console.error("Get account links error:", error);
      return res.status(500).json(formatError("Failed to retrieve account links"));
    }
  }
);

router.post(
  "/",
  requireAppContext,
  requireAuth,
  rateLimitByAccount(10, 3600000), // 10 link requests per hour
  createLinkValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { linked_account_email, linked_account_clerk_id, metadata = {} } = req.body;

      // Validate that at least one identifier is provided
      if (!linked_account_email && !linked_account_clerk_id) {
        return res.status(422).json(formatError("Either linked_account_email or linked_account_clerk_id is required", 422));
      }

      // Find the account to link with
      let linkedAccount;
      if (linked_account_email) {
        linkedAccount = await Account.query()
          .findOne({ email: linked_account_email, app_id: res.locals.app.id });
      } else if (linked_account_clerk_id) {
        linkedAccount = await Account.query()
          .findOne({ clerk_id: linked_account_clerk_id, app_id: res.locals.app.id });
      }

      if (!linkedAccount) {
        return res.status(404).json(formatError("Target account not found", 404));
      }

      if (linkedAccount.id === res.locals.account.id) {
        return res.status(400).json(formatError("Cannot link to yourself", 400));
      }

      // Check if link already exists
      const existingLink = await AccountLink.query()
        .findOne({
          account_id: res.locals.account.id,
          linked_account_id: linkedAccount.id,
          app_id: res.locals.app.id,
        });

      if (existingLink) {
        return res.status(409).json(formatError("Link already exists", 409));
      }

      const accountLink = await AccountLink.query()
        .insert({
          account_id: res.locals.account.id,
          linked_account_id: linkedAccount.id,
          app_id: res.locals.app.id,
          status: "pending",
          created_by_id: res.locals.account.id,
          metadata,
        })
        .withGraphFetched("[linked_account(publicProfile)]")
        .modifiers({
          publicProfile: (builder) => {
            builder.select("id", "metadata");
          },
        });

      const data = accountLinkSerializer(accountLink);

      return res.status(201).json(createdResponse(data, "Link request sent successfully"));
    } catch (error) {
      console.error("Create account link error:", error);
      return res.status(500).json(formatError("Failed to create account link"));
    }
  }
);

router.patch(
  "/:id",
  requireAppContext,
  requireAuth,
  updateLinkValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const accountLink = await AccountLink.query()
        .findById(id)
        .where("linked_account_id", res.locals.account.id) // Only the receiving account can accept/reject
        .where("app_id", res.locals.app.id)
        .where("status", "pending");

      if (!accountLink) {
        return res.status(404).json(formatError("Account link not found", 404));
      }

      const finalStatus = status === "accepted" ? "accepted" : "revoked";
      
      const updatedLink = await accountLink
        .$query()
        .patchAndFetch({
          status: finalStatus,
          metadata: {
            ...accountLink.metadata,
            ...req.body.metadata,
            responded_at: new Date().toISOString(),
          },
        })
        .withGraphFetched("[account(publicProfile)]")
        .modifiers({
          publicProfile: (builder) => {
            builder.select("id", "metadata");
          },
        });

      const data = accountLinkSerializer(updatedLink);

      return res.status(200).json(successResponse(data, `Link request ${status} successfully`));
    } catch (error) {
      console.error("Update account link error:", error);
      return res.status(500).json(formatError("Failed to update account link"));
    }
  }
);

router.delete(
  "/:id",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      const accountLink = await AccountLink.query()
        .findById(id)
        .where((builder) => {
          builder
            .where("account_id", res.locals.account.id)
            .orWhere("linked_account_id", res.locals.account.id);
        })
        .where("app_id", res.locals.app.id);

      if (!accountLink) {
        return res.status(404).json(formatError("Account link not found", 404));
      }

      // Delete both directions of the bidirectional link
      await AccountLink.transaction(async (trx) => {
        const accountId = accountLink.account_id;
        const linkedAccountId = accountLink.linked_account_id;

        // Delete both directions: A->B and B->A
        await AccountLink.query(trx)
          .where((builder) => {
            builder
              .where({
                account_id: accountId,
                linked_account_id: linkedAccountId,
                app_id: res.locals.app.id
              })
              .orWhere({
                account_id: linkedAccountId,
                linked_account_id: accountId,
                app_id: res.locals.app.id
              });
          })
          .delete();
      });

      return res.status(200).json(successResponse(null, "Account link removed successfully"));
    } catch (error) {
      console.error("Delete account link error:", error);
      return res.status(500).json(formatError("Failed to remove account link"));
    }
  }
);

router.get(
  "/actors",
  requireAppContext,
  requireAuth,
  async (req, res) => {
    try {
      const { type } = req.query;

      // Get all accessible actors for tagging in stories
      // OUR actors (all) + linked account actors (only non-claimable)
      const actors = await Actor.query()
        .where((builder) => {
          builder
            // All our own actors (regardless of claimable status)
            .where("actors.account_id", res.locals.account.id)
            // Only non-claimable actors from linked accounts
            .orWhereExists((subquery) => {
              subquery
                .select("*")
                .from("account_links")
                .whereRaw("account_links.linked_account_id = actors.account_id")
                .where("account_links.account_id", res.locals.account.id)
                .where("account_links.app_id", res.locals.app.id)
                .where("account_links.status", "accepted")
                .whereRaw("actors.is_claimable = false"); // Only verified ownership
            });
        })
        .where("actors.app_id", res.locals.app.id)
        .withGraphFetched("[account(publicProfile), media]")
        .orderBy("actors.created_at", "desc");
      
      // Filter by type if specified
      const filteredActors = type 
        ? actors.filter(actor => actor.type === type)
        : actors;

      // Enhance actors with access information
      const enhancedActors = filteredActors.map(actor => ({
        ...actor,
        access_type: actor.account?.id === res.locals.account.id ? "owned" : "linked",
        permissions: {
          view: true,
          use_in_stories: true,
          edit: actor.account?.id === res.locals.account.id,
        }
      }));

      const data = await Promise.all(enhancedActors.map(actor => actorWithAccessSerializer(actor)));

      return res.status(200).json(successResponse(data, "Taggable actors retrieved successfully"));
    } catch (error) {
      console.error("Get linked actors error:", error);
      return res.status(500).json(formatError("Failed to retrieve actors"));
    }
  }
);

// Get actors for a specific account link by link ID
router.get(
  "/:linkId/actors",
  requireAppContext,
  requireAuth,
  [param("linkId").isUUID().withMessage("Invalid link ID")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { linkId } = req.params;
      const { type } = req.query;

      // Verify the link exists and belongs to user
      const link = await AccountLink.query()
        .findById(linkId)
        .where("account_id", res.locals.account.id)
        .where("app_id", res.locals.app.id)
        .where("status", "accepted")
        .withGraphFetched("[linked_account(publicProfile)]")
        .modifiers({
          publicProfile: (builder) => {
            builder.select("id", "metadata");
          },
        });
      
      if (!link) {
        return res.status(404).json(formatError("Account link not found or not accepted", 404));
      }

      // Get actors from the linked account (only non-claimable ones)
      let actors = await Actor.query()
        .where("account_id", link.linked_account_id)
        .where("app_id", res.locals.app.id)
        .where("is_claimable", false) // Only verified ownership actors
        .withGraphFetched("[account(publicProfile), media]")
        .orderBy("created_at", "desc");
      
      if (type) {
        actors = actors.filter(actor => actor.type === type);
      }

      // Enhance actors with access information
      const enhancedActors = actors.map(actor => ({
        ...actor,
        access_type: "linked",
        link_info: {
          link_id: link.id,
          account_name: link.linked_account?.metadata?.display_name || "Unknown Account"
        },
        permissions: {
          view: true,
          use_in_stories: true,
          edit: false, // Can't edit linked account actors
        }
      }));

      const data = await Promise.all(enhancedActors.map(actor => actorWithAccessSerializer(actor)));

      return res.status(200).json(successResponse(data, "Linked account actors retrieved successfully"));
    } catch (error) {
      console.error("Get link actors error:", error);
      return res.status(500).json(formatError("Failed to retrieve linked account actors"));
    }
  }
);

export default router;
# Backend Scripts

This directory contains utility scripts for managing the Ghost platform.

## Generate Suggestions for a Specific Account

Manually trigger suggestion generation for a specific connected account.

### Usage

```bash
npm run generate-suggestions <connected_account_id>
```

### Example

```bash
npm run generate-suggestions 123e4567-e89b-12d3-a456-426614174000
```

### What it does

1. Validates the connected account exists and is active
2. Checks eligibility:
   - **Ghost platform**: Verifies either `topics_of_interest` OR `sample_posts` exist
   - **Network platforms**: Verifies `sync_status = "ready"`
3. If ghost account has sample posts but no topics, AI will infer topics automatically
4. Queues a suggestion generation job
5. Generates 3 suggestions for the account

### How to find a connected account ID

**Via API:**
```bash
GET /connections
Authorization: Bearer <clerk_jwt>
X-App-Slug: ghost
```

**Via Database:**
```sql
SELECT id, platform, username, sync_status, topics_of_interest
FROM connected_accounts
WHERE is_active = true;
```

### Platform-Specific Requirements

#### Ghost Platform
- Must have either `topics_of_interest` OR `sample_posts`
- **Option 1**: Add topics manually via:
  ```bash
  PATCH /connections/{id}
  Body: { "topics_of_interest": "AI, startups, product design" }
  ```
- **Option 2**: Add sample posts and topics will be auto-generated:
  ```bash
  POST /connections/{id}/samples
  Body: { "content": "Your example post content..." }
  ```
- If you have sample posts but no topics, the script will automatically infer topics using AI during suggestion generation

#### Network Platforms (Twitter, LinkedIn, etc.)
- Must have `sync_status = "ready"`
- If not ready, trigger sync:
  ```bash
  POST /connections/{id}/sync
  ```

### Output Example

**Network Platform (Twitter, LinkedIn, etc.):**
```
🔍 Looking up connected account: 123e4567-e89b-12d3-a456-426614174000...
✅ Found account: myusername (twitter)
🌐 Network platform detected - checking sync status...
✅ Account is synced and ready

🚀 Queueing suggestion generation job...
✅ Job queued successfully!
   Job ID: 12345
   Connected Account: myusername
   Platform: twitter
   Generation Type: Network-based

📊 Job will generate 3 suggestions for this account
⏳ Processing time: 10-30 seconds depending on complexity

💡 To check job status:
   - View queue in BullMQ dashboard
   - Check suggestions: GET /suggestions?connected_account_id=123e4567-e89b-12d3-a456-426614174000
```

**Ghost Platform (with sample posts, no topics):**
```
🔍 Looking up connected account: abc12345-e89b-12d3-a456-426614174000...
✅ Found account: My Drafts (ghost)
📝 Ghost platform detected - checking eligibility...
✅ Sample posts: 3 found
💡 Topics will be inferred from sample posts

🚀 Queueing suggestion generation job...
✅ Job queued successfully!
   Job ID: 12346
   Connected Account: My Drafts
   Platform: ghost
   Generation Type: Interest-based

📊 Job will generate 3 suggestions for this account
⏳ Processing time: 10-30 seconds depending on complexity
```

### Error Scenarios

**Account not found:**
```
❌ Error: Connected account not found or is inactive
```

**Ghost account missing topics and sample posts:**
```
❌ Error: Ghost account requires either topics_of_interest or sample posts
```

**Network account not synced:**
```
❌ Error: Account sync_status is 'pending' (must be 'ready')
```

---

## Other Scripts

### Backfill Ghost Accounts

Creates default ghost accounts for all existing users:

```bash
npm run backfill:ghost-accounts
```

This script:
- Finds all accounts without a ghost connection
- Creates a default "My Drafts" ghost account for each
- Uses the `findOrCreateGhostAccount` method (race-condition safe)

---

## Notes

- All scripts load environment variables from `.env.development.local`, `.env.development`, and `.env`
- Scripts use the same database and Redis connection as the main application
- Requires background workers to be running to process queued jobs
- Check BullMQ dashboard to monitor job progress

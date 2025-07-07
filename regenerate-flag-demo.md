# Regenerate Flag Implementation

## ✅ What We Added

### 1. Queue Script Updates (`scripts/queue-story-generation.js`)

**New Command Line Interface:**
```bash
# Initial generation (default)
dev node scripts/queue-story-generation.js <artifact-id>

# Regeneration mode
dev node scripts/queue-story-generation.js <artifact-id> --regenerate
dev node scripts/queue-story-generation.js <artifact-id> -r
```

**Smart Warnings:**
- Warns if generating for already completed artifact without `--regenerate`
- Warns if regenerating artifact that isn't completed
- Shows clear mode indicators: "✨ INITIAL GENERATION" vs "🔄 REGENERATION"

### 2. Job Data Enhancement

**Job Queue Data Now Includes:**
```javascript
{
  inputId: "uuid",
  artifactId: "uuid",
  regenerate: true/false  // New flag!
}
```

### 3. Background Job Logic (`src/background/jobs/content/generate-story.js`)

**Enhanced Processing:**
- Reads `regenerate` flag from job data
- Logs appropriate mode: "INITIAL GENERATION" vs "REGENERATION"
- Validates regeneration requests
- Tracks generation count in metadata
- Different success messages for regeneration

**Metadata Tracking:**
```javascript
metadata: {
  regenerate: true/false,
  generation_count: 1, 2, 3...
  processing_started_at: "timestamp",
  // ... other metadata
}
```

## 🔍 How It Works

### Initial Generation Flow
```bash
dev node scripts/queue-story-generation.js dc9e3e19-de92-4ea9-85d0-4107adefab8d
```

**Queue Script:**
- Checks artifact status
- Shows "✨ Mode: INITIAL GENERATION"
- Queues job with `regenerate: false`

**Background Job:**
- Logs "Processing INITIAL GENERATION job"
- Sets `generation_count: 1`
- Sets `regenerate: false` in metadata
- Success: "Successfully generated [title] (generation #1)"

### Regeneration Flow
```bash
dev node scripts/queue-story-generation.js dc9e3e19-de92-4ea9-85d0-4107adefab8d --regenerate
```

**Queue Script:**
- Checks artifact status (should be "completed")
- Shows "🔄 Mode: REGENERATION"
- Queues job with `regenerate: true`

**Background Job:**
- Logs "Processing REGENERATION job"
- Increments `generation_count`
- Sets `regenerate: true` in metadata
- Success: "Successfully regenerated [title] (generation #2)"

## 🎯 Benefits

### 1. **Clear Intent Distinction**
- API consumers can distinguish between initial vs regeneration requests
- Useful for analytics, billing, user messaging

### 2. **Better User Experience**
- Apps can show "Generating your story..." vs "Creating new version..."
- Can track how many times users regenerate stories

### 3. **Debugging & Analytics**
- Easy to identify regeneration issues vs initial generation issues
- Track regeneration patterns and success rates

### 4. **Safety Warnings**
- Prevents accidental operations
- Clear feedback about appropriate usage

## 📊 Example Usage Scenarios

**Mobile App Integration:**
```javascript
// Initial story creation
await queueStoryGeneration(artifactId, { regenerate: false });

// User clicks "Generate New Version" 
await queueStoryGeneration(artifactId, { regenerate: true });
```

**Analytics Queries:**
```sql
-- How many stories are regenerated?
SELECT COUNT(*) FROM artifacts WHERE metadata->>'regenerate' = 'true';

-- Average regeneration count
SELECT AVG((metadata->>'generation_count')::int) FROM artifacts WHERE status = 'completed';
```

The regenerate flag now provides clear separation between initial generation and story regeneration workflows!
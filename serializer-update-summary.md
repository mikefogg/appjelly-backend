# Serializer Updates - Mobile App Data Summary

## ✅ Updated Artifact Serializer

The `artifactSerializer` now returns all the essential fields for the mobile app:

### **Story Content**
```json
{
  "id": "dc9e3e19-de92-4ea9-85d0-4107adefab8d",
  "artifact_type": "story",
  "title": "Ava's Donut Adventure",
  "subtitle": "A magical journey for the perfect donut.",
  "description": "Join Ava as she embarks on a delightful adventure...",
  "status": "completed",
  "page_count": 11
}
```

### **Generation Metrics** (for analytics/debugging)
```json
{
  "total_tokens": 3778,
  "plotline_tokens": 1118,
  "story_tokens": 2660,
  "plotline_prompt_tokens": 805,
  "plotline_completion_tokens": 313,
  "story_prompt_tokens": 1683,
  "story_completion_tokens": 977,
  "cost_usd": "0.001147",
  "generation_time_seconds": "25.400",
  "ai_model": "gpt-4o-mini",
  "ai_provider": "openai"
}
```

### **Relationships**
```json
{
  "input": { /* input details */ },
  "owner": {
    "id": "5c5ca241-3bd5-4059-b10b-ecd7d0d164a2",
    "display_name": "John Doe"
  },
  "metadata": { /* generation details, plotline, character_json */ }
}
```

## ✅ Updated Page Serializer

The `pageSerializer` now includes all image-related fields:

```json
{
  "id": "page-uuid",
  "page_number": 1,
  "text": null,
  "image_key": null,
  "image_url": null,
  "image_prompt": "A sunny scene of Ava and her dad joyfully skipping...",
  "image_status": "pending",
  "layout_data": {
    "text": [
      "Ava and her Dad skip along the sidewalk, their hearts bubbling with excitement.",
      "We're going to the coffee shop for a special donut treat!"
    ]
  },
  "created_at": "2025-07-06T22:11:40.565Z"
}
```

## 🔒 Safe Serializers (for sharing)

Updated `safeArtifactSerializer` includes story content but excludes sensitive data:

**Includes:**
- ✅ `title`, `subtitle`, `description`
- ✅ `status`, `page_count`
- ✅ Basic timestamps

**Excludes for privacy:**
- ❌ Token counts and costs
- ❌ AI model information
- ❌ Owner/account details

## 📱 Mobile App Usage

### **Story List Screen**
```javascript
// GET /artifacts
{
  "data": [
    {
      "id": "...",
      "title": "Ava's Donut Adventure",
      "subtitle": "A magical journey for the perfect donut.",
      "status": "completed",
      "page_count": 11,
      "created_at": "...",
      // ... other fields
    }
  ]
}
```

### **Story Detail Screen**
```javascript
// GET /artifacts/:id
{
  "id": "...",
  "title": "Ava's Donut Adventure",
  "subtitle": "A magical journey for the perfect donut.",
  "description": "Join Ava as she embarks...",
  "status": "completed",
  "pages": [
    {
      "page_number": 1,
      "image_prompt": "A sunny scene of Ava...",
      "image_status": "pending",
      "layout_data": {
        "text": ["Paragraph 1", "Paragraph 2"]
      }
    }
  ],
  "total_tokens": 3778,
  "cost_usd": "0.001147"
}
```

### **Story Reading Screen**
```javascript
// Access page text
story.pages.forEach(page => {
  const textSegments = page.layout_data.text;
  textSegments.forEach(segment => {
    // Display each text segment
  });
  
  // Handle image
  if (page.image_url) {
    // Show generated image
  } else if (page.image_status === "generating") {
    // Show loading spinner
  } else {
    // Show placeholder or generate image
  }
});
```

## 🎯 Key Benefits

1. **Complete Story Data**: Title, subtitle, description all available
2. **Page Structure**: Text arrays in layout_data, image prompts ready
3. **Generation Tracking**: Full token/cost visibility for analytics
4. **Image Pipeline**: Status tracking for image generation workflow
5. **Privacy-Aware**: Safe serializers exclude sensitive data for sharing

The mobile app now has access to all the data it needs to display stories, track generation metrics, and handle the image generation pipeline!
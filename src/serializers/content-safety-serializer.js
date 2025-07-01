export const contentReportSerializer = (report) => {
  return {
    report_id: report.id,
    status: report.status,
    message: report.status === "flagged" 
      ? "Content has been flagged and will be reviewed immediately"
      : "Report submitted successfully and will be reviewed within 24 hours",
  };
};

export const contentGuidelinesSerializer = (app, guidelines) => {
  return {
    app_name: app.name,
    last_updated: app.config?.content_safety?.guidelines_updated || "2024-01-01",
    guidelines,
    contact: {
      support_email: app.config?.support?.email || "support@snugglebug.com",
      safety_email: app.config?.safety?.email || "safety@snugglebug.com",
    },
  };
};

export const contentModerationSerializer = (moderation) => {
  return {
    safety_score: moderation.score,
    approved: moderation.approved,
    reasoning: moderation.reasoning,
    suggestions: moderation.suggestions,
    categories: {
      child_appropriate: moderation.score <= 3,
      educational_value: moderation.score <= 4,
      positive_messaging: moderation.score <= 3,
    },
  };
};

export const safetyTipsSerializer = (app, tips) => {
  return {
    app_name: app.name,
    tips,
    additional_resources: [
      {
        title: "Common Sense Media",
        url: "https://www.commonsensemedia.org/",
        description: "Age-appropriate media guidance for families",
      },
      {
        title: "Digital Wellness Institute", 
        url: "https://www.digitalwellnessinstitute.org/",
        description: "Resources for healthy digital habits",
      },
    ],
  };
};
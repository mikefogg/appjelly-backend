import { Artifact } from "../src/models/index.js";

async function monitorArtifactStatus(artifactId, intervalMs = 2000, maxChecks = 30) {
  try {
    console.log(`🔍 Monitoring artifact ${artifactId}...`);
    console.log(`Checking every ${intervalMs}ms for up to ${maxChecks} checks\n`);

    let checks = 0;
    let lastStatus = null;

    const checkStatus = async () => {
      checks++;
      
      const artifact = await Artifact.query()
        .findById(artifactId)
        .withGraphFetched("[pages]");

      if (!artifact) {
        console.error("❌ Artifact not found");
        return false;
      }

      const currentStatus = artifact.status || "unknown";
      
      // Only log if status changed or it's the first check
      if (currentStatus !== lastStatus || checks === 1) {
        console.log(`[${new Date().toLocaleTimeString()}] Status: ${currentStatus}`);
        
        if (currentStatus === "completed") {
          console.log(`✅ Story generation completed!`);
          console.log(`- Title: ${artifact.title}`);
          console.log(`- Subtitle: ${artifact.subtitle}`);
          console.log(`- Pages: ${artifact.pages.length}`);
          console.log(`- Total tokens: ${artifact.total_tokens}`);
          console.log(`- Cost: $${parseFloat(artifact.cost_usd || 0).toFixed(4)}`);
          console.log(`- Generation time: ${parseFloat(artifact.generation_time_seconds || 0).toFixed(2)}s`);
          return false; // Stop monitoring
        }
        
        if (currentStatus === "failed") {
          console.log(`❌ Story generation failed!`);
          console.log(`- Error: ${artifact.metadata?.error || "Unknown error"}`);
          return false; // Stop monitoring
        }
        
        lastStatus = currentStatus;
      }

      if (checks >= maxChecks) {
        console.log(`⏰ Max checks (${maxChecks}) reached. Stopping monitor.`);
        console.log(`Final status: ${currentStatus}`);
        return false;
      }

      return true; // Continue monitoring
    };

    // Initial check
    if (!(await checkStatus())) {
      return;
    }

    // Set up interval
    const interval = setInterval(async () => {
      const shouldContinue = await checkStatus();
      if (!shouldContinue) {
        clearInterval(interval);
      }
    }, intervalMs);

  } catch (error) {
    console.error("Error monitoring artifact:", error);
    throw error;
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactId = process.argv[2];
  const intervalMs = parseInt(process.argv[3]) || 2000;
  const maxChecks = parseInt(process.argv[4]) || 30;
  
  if (!artifactId) {
    console.error("Usage: dev node scripts/monitor-artifact-status.js <artifact-id> [interval-ms] [max-checks]");
    console.error("Example: dev node scripts/monitor-artifact-status.js 123e4567-e89b-12d3-a456-426614174000 2000 30");
    process.exit(1);
  }

  monitorArtifactStatus(artifactId, intervalMs, maxChecks)
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}

export { monitorArtifactStatus };
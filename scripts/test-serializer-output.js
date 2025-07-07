import { Artifact } from "../src/models/index.js";
import { artifactSerializer, artifactWithPagesSerializer, pageSerializer, adminArtifactSerializer, adminPageSerializer } from "../src/serializers/artifact-serializer.js";

async function testSerializerOutput() {
  try {
    console.log("🔍 Testing updated serializer output...\n");

    // Fetch an artifact with all relationships
    const artifact = await Artifact.query()
      .findById("dc9e3e19-de92-4ea9-85d0-4107adefab8d")
      .withGraphFetched("[input, account, pages]");

    if (!artifact) {
      throw new Error("Artifact not found");
    }

    console.log("📋 Testing artifactSerializer...");
    const artifactData = await artifactSerializer(artifact);
    console.log("✅ Artifact fields returned:");
    Object.keys(artifactData).forEach(key => {
      const value = artifactData[key];
      const type = value === null ? "null" : typeof value;
      console.log(`  - ${key}: ${type} ${value !== null && type === 'object' ? `(${Object.keys(value).length} props)` : ''}`);
    });

    console.log("\n📄 Testing pageSerializer...");
    if (artifact.pages && artifact.pages.length > 0) {
      const pageData = pageSerializer(artifact.pages[0]);
      console.log("✅ Page fields returned:");
      Object.keys(pageData).forEach(key => {
        const value = pageData[key];
        const type = value === null ? "null" : typeof value;
        console.log(`  - ${key}: ${type} ${value !== null && type === 'object' ? `(${Object.keys(value).length} props)` : ''}`);
      });

      console.log("\n📚 Sample page data:");
      console.log(`  - Page ${pageData.page_number}`);
      console.log(`  - Text: ${pageData.text ? "from layout_data" : "from text field"}`);
      console.log(`  - Image prompt: ${pageData.image_prompt ? "yes" : "no"}`);
      console.log(`  - Image status: ${pageData.image_status}`);
      if (pageData.layout_data?.text) {
        console.log(`  - Layout text segments: ${pageData.layout_data.text.length}`);
      }
    }

    console.log("\n🎯 Mobile App User Fields (Clean):");
    console.log("Story Info:");
    console.log(`  ✅ title: "${artifactData.title}"`);
    console.log(`  ✅ subtitle: "${artifactData.subtitle}"`);
    console.log(`  ✅ description: "${artifactData.description}"`);
    console.log(`  ✅ status: "${artifactData.status}"`);
    console.log(`  ✅ page_count: ${artifactData.page_count}`);
    
    console.log("\nNo Technical Data Exposed:");
    console.log(`  ❌ total_tokens: ${artifactData.total_tokens ? "exposed" : "hidden"}`);
    console.log(`  ❌ cost_usd: ${artifactData.cost_usd ? "exposed" : "hidden"}`);
    console.log(`  ❌ ai_model: ${artifactData.ai_model ? "exposed" : "hidden"}`);

    if (artifact.pages && artifact.pages.length > 0) {
      const pageData = pageSerializer(artifact.pages[0]);
      console.log("\nPage Fields (User):");
      console.log(`  ✅ image_status: "${pageData.image_status}"`);
      console.log(`  ✅ layout_data: ${pageData.layout_data ? "yes" : "no"}`);
      console.log(`  ❌ image_prompt: ${pageData.image_prompt ? "exposed" : "hidden"}`);
    }

    console.log("\n🔧 Admin Serializer (Technical Data):");
    const adminData = await adminArtifactSerializer(artifact);
    console.log(`  ✅ total_tokens: ${adminData.total_tokens}`);
    console.log(`  ✅ cost_usd: ${adminData.cost_usd}`);
    console.log(`  ✅ ai_model: "${adminData.ai_model}"`);
    
    if (artifact.pages && artifact.pages.length > 0) {
      const adminPageData = adminPageSerializer(artifact.pages[0]);
      console.log(`  ✅ image_prompt: ${adminPageData.image_prompt ? "yes" : "no"}`);
    }

  } catch (error) {
    console.error("Error testing serializers:", error);
    throw error;
  }
}

// Allow running from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  testSerializerOutput()
    .then(() => {
      console.log("\n✅ Serializer test completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exit(1);
    });
}

export { testSerializerOutput };
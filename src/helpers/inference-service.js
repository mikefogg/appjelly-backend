import OpenAI from "openai";
import { Actor } from "#src/models/index.js";

class InferenceService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async extractCharactersFromPrompt(prompt, accountId, appId) {
    // Get existing actors for this account and linked families
    const existingActors = await this.getAvailableActors(accountId, appId);

    // Check if AI bypass is enabled for development
    if (process.env.BYPASS_AI === "true") {
      return this._dev_getMockCharacterExtraction(prompt, existingActors);
    }

    try {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

      const systemPrompt = `You are a character extraction AI for a children's story app. Extract character names from the user's prompt and match them to existing characters when possible.

      Existing characters:
      ${existingActors
        .map(
          (a) =>
            `- ${a.name}${a.nickname ? ` (${a.nickname})` : ""} - ${a.type}`
        )
        .join("\n")}

      Rules:
      1. Extract all character names mentioned in the prompt
      2. Match to existing characters by name (case-insensitive)
      3. For ambiguous matches (same name), include all possibilities
      4. Identify character types: child, adult, pet, imaginary
      5. Extract any mentioned relationships

      Return JSON format:
      {
        "characters": [
          {
            "name": "string",
            "matchedActorIds": ["uuid"] or [],
            "type": "child|adult|pet|imaginary",
            "isNew": boolean,
            "relationships": { "otherCharacterName": "relationship" }
          }
        ],
        "ambiguousMatches": [
          {
            "name": "string",
            "candidates": [{ "id": "uuid", "nickname": "string" }]
          }
        ]
      }`;

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract characters from: "${prompt}"` },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No inference response");
      }

      const result = JSON.parse(content);

      // Enhance with actor details
      return this.enhanceInferenceResult(result, existingActors);
    } catch (error) {
      console.error("Character extraction error:", error);
      // Fallback to simple name extraction
      return this.fallbackExtraction(prompt, existingActors);
    }
  }

  async getAvailableActors(accountId, appId) {
    // Get own actors and linked family actors
    const ownActors = await Actor.query()
      .where("account_id", accountId)
      .where("app_id", appId);

    const linkedActors = await Actor.query()
      .joinRelated("account.account_links")
      .where("account:account_links.linked_account_id", accountId)
      .where("actors.app_id", appId)
      .where("account:account_links.status", "accepted");

    return [...ownActors, ...linkedActors];
  }

  enhanceInferenceResult(result, existingActors) {
    const actorMap = new Map(existingActors.map((a) => [a.id, a]));

    // Enhance matched characters with full actor data
    result.characters = result.characters.map((char) => {
      if (char.matchedActorIds?.length > 0) {
        const actors = char.matchedActorIds
          .map((id) => actorMap.get(id))
          .filter(Boolean);

        return {
          ...char,
          matchedActors: actors.map((a) => ({
            id: a.id,
            name: a.name,
            nickname: a.nickname,
            type: a.type,
            metadata: a.metadata,
          })),
        };
      }
      return char;
    });

    return result;
  }

  fallbackExtraction(prompt, existingActors) {
    // Simple regex-based name extraction as fallback
    const words = prompt.split(/\s+/);
    const capitalizedWords = words.filter((w) => /^[A-Z]/.test(w));

    const characters = [];
    const actorsByName = new Map();

    existingActors.forEach((actor) => {
      const key = actor.name.toLowerCase();
      if (!actorsByName.has(key)) {
        actorsByName.set(key, []);
      }
      actorsByName.get(key).push(actor);
    });

    capitalizedWords.forEach((word) => {
      const cleanWord = word.replace(/[.,!?]/g, "");
      const matches = actorsByName.get(cleanWord.toLowerCase()) || [];

      characters.push({
        name: cleanWord,
        matchedActorIds: matches.map((a) => a.id),
        type: "child", // Default assumption
        isNew: matches.length === 0,
        relationships: {},
      });
    });

    // Check for ambiguous matches
    const ambiguousMatches = characters
      .filter((c) => c.matchedActorIds.length > 1)
      .map((c) => ({
        name: c.name,
        candidates: c.matchedActorIds.map((id) => {
          const actor = existingActors.find((a) => a.id === id);
          return { id, nickname: actor.nickname };
        }),
      }));

    return { characters, ambiguousMatches };
  }

  async resolveAmbiguousMatch(
    characterName,
    selectedActorId,
    accountId,
    appId
  ) {
    // Verify the actor exists and is accessible
    const actor = await Actor.query()
      .findById(selectedActorId)
      .where("app_id", appId)
      .whereIn("account_id", function () {
        this.select("account_id")
          .from("actors")
          .where("account_id", accountId)
          .union(function () {
            this.select("linked_account_id as account_id")
              .from("account_links")
              .where("account_id", accountId)
              .where("status", "accepted");
          });
      });

    if (!actor) {
      throw new Error("Selected actor not found or not accessible");
    }

    return actor;
  }

  //
  // Development Bypass Methods
  //

  _dev_getMockCharacterExtraction(prompt, existingActors) {
    // Simple mock that tries to match capitalized words to existing actors
    const words = prompt.split(/\s+/);
    const capitalizedWords = words.filter(
      (w) => /^[A-Z][a-z]+/.test(w) && w.length > 2
    );

    const characters = [];
    const ambiguousMatches = [];

    capitalizedWords.forEach((word) => {
      const matches = existingActors.filter(
        (actor) => actor.name.toLowerCase() === word.toLowerCase()
      );

      if (matches.length === 1) {
        characters.push({
          name: word,
          matchedActorIds: [matches[0].id],
          matchedActors: matches.map((a) => ({
            id: a.id,
            name: a.name,
            nickname: a.nickname,
            type: a.type,
            metadata: a.metadata,
          })),
          type: matches[0].type,
          isNew: false,
          relationships: {},
        });
      } else if (matches.length > 1) {
        ambiguousMatches.push({
          name: word,
          candidates: matches.map((a) => ({ id: a.id, nickname: a.nickname })),
        });
      } else {
        characters.push({
          name: word,
          matchedActorIds: [],
          type: "child",
          isNew: true,
          relationships: {},
        });
      }
    });

    return { characters, ambiguousMatches };
  }
}

export default new InferenceService();

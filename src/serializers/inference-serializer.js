export const inferenceSerializer = (inferenceResult, actors, input) => {
  const { characters, ambiguousMatches } = inferenceResult;

  return {
    characters: characters,
    ambiguous_matches: ambiguousMatches,
    suggestions: characters.map((char) => ({
      name: char.name,
      type: char.type,
      matched_actor_ids: char.matchedActorIds || [],
      is_new: char.isNew,
      relationships: char.relationships || {},
      confidence: char.matchedActorIds?.length > 0 ? 0.9 : 0.7,
    })),
    create_suggestions: characters
      .filter((char) => char.isNew)
      .map((char) => ({
        name: char.name,
        type: char.type,
        suggested_traits: char.relationships || {},
      })),
    existing_matches: actors.filter((actor) => input.actor_ids?.includes(actor.id)) || [],
  };
};
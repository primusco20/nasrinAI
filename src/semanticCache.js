// The cache itself: embed once, search, and store with the same embedding.
export function createSemanticCache({
  supabase, embed, modelName,
  threshold = Number(process.env.CACHE_THRESHOLD ?? 0.92),
  ttlDays = Number(process.env.CACHE_TTL_DAYS ?? 30)
}) {
  return {
    // Resolves { embedding, hit }. `hit` is null on a miss. The embedding is
    // returned so a miss can be stored later without embedding the prompt twice.
    async lookup(prompt, scope) {
      const embedding = await embed(prompt);
      const { data, error } = await supabase.rpc('match_semantic_cache', {
        query_embedding: embedding,
        match_scope: scope,
        match_model: modelName,
        match_threshold: threshold,
        match_count: 1
      });
      if (error) throw Object.assign(new Error('cache search failed: ' + error.message), { embedding });
      return { embedding, hit: data?.[0] ?? null };
    },

    async store({ scope, prompt, response, embedding }) {
      const { error } = await supabase.from('semantic_cache').insert({
        scope, prompt, response, embedding,
        embedding_model: modelName,
        expires_at: new Date(Date.now() + ttlDays * 86_400_000).toISOString()
      });
      if (error) throw new Error('cache save failed: ' + error.message);
    },

    async touch(id) {
      const { error } = await supabase.rpc('touch_semantic_cache', { cache_id: id });
      if (error) throw new Error('cache touch failed: ' + error.message);
    }
  };
}

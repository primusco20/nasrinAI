import { pipeline } from '@huggingface/transformers';

// Local embeddings: no data leaves the server and there is no per-call cost.
export const EMBEDDING_MODEL = process.env.EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';

let extractor = null;   // one shared pipeline: loading the model is the slow part

function load() {
  if (!extractor) {
    extractor = pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
      .catch((err) => { extractor = null; throw err; });   // a failed download can be retried
  }
  return extractor;
}

// Returns a normalized vector (plain number[]), so cosine distance in pgvector works as intended.
export async function embed(text) {
  const run = await load();
  const out = await run(String(text).slice(0, 2000), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

// Call at start-up so the first user does not wait for the model to load.
export const warmUp = () => embed('warm up');

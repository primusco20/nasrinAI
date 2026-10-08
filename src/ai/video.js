import { HttpError } from '../http/errors.js';

const MAX_SECONDS = 60;
const STEP_SECONDS = 8;
const EXTEND_SECONDS = 7;

const safePrompt = (v) => {
  const s = String(v ?? '').trim();
  if (!s || s.length > 8000) throw new HttpError(400, 'invalid_video_prompt', 'Describe the video you want (up to 8,000 characters).');
  return s;
};

export function createVideoProvider({ apiKey, model = 'veo-3.1-fast-generate-preview', fetchImpl = fetch, timeoutMs = 25_000 }) {
  if (!apiKey) return null;

  async function call(url, init = {}) {
    let resp;
    try {
      resp = await fetchImpl(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, ...(init.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      throw Object.assign(new Error('The video service could not be reached.'), { code: err?.name === 'TimeoutError' ? 'video_timeout' : 'video_unavailable' });
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = String(data?.error?.message || data?.error?.status || '').replace(/\s+/g, ' ').slice(0, 300);
      throw Object.assign(new Error('The video service rejected the request.'), { code: resp.status === 429 ? 'video_busy' : 'video_provider_error', providerMessage: msg });
    }
    return data;
  }

  return {
    id: 'gemini-veo',
    model,
    async create({ prompt, aspectRatio = '16:9' }) {
      const data = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`, {
        method: 'POST',
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { aspectRatio, resolution: '720p', durationSeconds: String(STEP_SECONDS) }
        })
      });
      const name = data?.name;
      if (typeof name !== 'string' || !name.startsWith('models/')) throw new Error('The video service did not return a job.');
      return name;
    },
    async status(name) {
      return call('https://generativelanguage.googleapis.com/v1beta/' + name, { method: 'GET' });
    },
    async download(uri) {
      if (typeof uri !== 'string' || !uri.startsWith('https://')) throw new Error('The video service returned an invalid video location.');
      let resp;
      try {
        resp = await fetchImpl(uri, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new Error('The generated video could not be downloaded.');
      }
      if (!resp.ok) throw new Error('The generated video could not be downloaded.');
      const ab = await resp.arrayBuffer();
      const bytes = Buffer.from(ab);
      if (!bytes.length || bytes.length > 60 * 1024 * 1024) throw new Error('The generated video is too large to store.');
      return bytes;
    },
    async extend({ prompt, videoBytes }) {
      const data = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`, {
        method: 'POST',
        body: JSON.stringify({
          instances: [{ prompt, video: { inlineData: { mimeType: 'video/mp4', data: Buffer.from(videoBytes).toString('base64') } } }],
          parameters: { resolution: '720p' }
        })
      });
      const name = data?.name;
      if (typeof name !== 'string' || !name.startsWith('models/')) throw new Error('The video extension job was not created.');
      return name;
    },
    extract(data) {
      const err = data?.error;
      const video = data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video
        || data?.response?.generatedVideos?.[0]?.video
        || data?.response?.generated_videos?.[0]?.video;
      return {
        done: data?.done === true,
        failed: Boolean(err),
        error: err ? String(err.message || err.status || 'Video generation failed').slice(0, 300) : null,
        uri: typeof video?.uri === 'string' ? video.uri : null
      };
    }
  };
}

export function videoStepSeconds(targetSeconds) {
  const target = Math.max(1, Math.min(MAX_SECONDS, Number(targetSeconds) || MAX_SECONDS));
  return target <= STEP_SECONDS ? STEP_SECONDS : STEP_SECONDS + Math.floor((target - STEP_SECONDS) / EXTEND_SECONDS) * EXTEND_SECONDS;
}

export { MAX_SECONDS, STEP_SECONDS, EXTEND_SECONDS, safePrompt };

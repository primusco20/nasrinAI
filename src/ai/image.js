import { ProviderError } from './provider.js';

// The image-provider interface (Phase 4.2), so the image service can change:
//   imageProvider.id, imageProvider.model
//   imageProvider.generate({ prompt, images: [{ mime, data(base64) }], aspectRatio })
//       -> { bytes: Buffer, mime }
//
// Gemini image models through Google's Interactions API
// (POST https://generativelanguage.googleapis.com/v1beta/interactions,
// x-goog-api-key header), as shown in Google's image-generation guide. The
// key stays on the server.

const sniff = (b) => {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
};

// Finds the image in a response, whatever the exact nesting.
function findImage(data) {
  const direct = data?.output_image?.data || data?.interaction?.output_image?.data;
  if (typeof direct === 'string') return direct;
  const stack = [data];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if ((v.type === 'image' || v.mime_type || v.mimeType) && typeof v.data === 'string' && v.data.length > 100) return v.data;
    if (v.inlineData?.data) return v.inlineData.data;
    if (v.inline_data?.data) return v.inline_data.data;
    for (const x of Object.values(v)) if (x && typeof x === 'object') stack.push(x);
  }
  return null;
}

export function createGeminiImage({ apiKey, model, fetchImpl = fetch, timeoutMs = 90_000, totalMs = 105_000, retryWaitsMs = [2_000, 5_000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for images');

  // One attempt. Throws ProviderError; `retry` says whether trying again may help.
  async function attempt(body, ms) {
    let resp;
    try {
      resp = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(ms)
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError';
      throw Object.assign(new ProviderError(timeout ? 'timeout' : 'unavailable', 'image service could not be reached'), { retry: !timeout });
    }
    if (!resp.ok) {
      const s = resp.status;
      // Google's own reason (e.g. quota, key not allowed), for the server log.
      // It never contains the key; capped and kept to one line.
      const data = await resp.json().catch(() => null);
      const reason = String(data?.error?.message || data?.error?.status || '').replace(/\s+/g, ' ').slice(0, 300);
      // 5xx (e.g. 503 "model overloaded") is often gone a few seconds later.
      throw Object.assign(new ProviderError(s === 429 ? 'busy' : s >= 500 ? 'unavailable' : 'config', `image service answered ${s}${reason ? ': ' + reason : ''}`, s), { retry: s >= 500 });
    }
    return resp;
  }

  return {
    id: 'gemini',
    model,
    async generate({ prompt, images = [], aspectRatio = '1:1' }) {
      const body = JSON.stringify({
        model,
        input: [{ type: 'text', text: prompt }, ...images.map((i) => ({ type: 'image', mime_type: i.mime, data: i.data }))],
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspectRatio, image_size: '1K' }
      });
      // Retries with short waits, all within totalMs (the function's time limit).
      const deadline = now() + totalMs;
      let resp;
      for (let i = 0; ; i++) {
        try {
          resp = await attempt(body, Math.min(timeoutMs, deadline - now()));
          break;
        } catch (err) {
          const wait = retryWaitsMs[i];
          if (!err.retry || wait === undefined || deadline - now() - wait < 15_000) throw err;
          await sleep(wait);
        }
      }
      const data = await resp.json().catch(() => null);
      const b64 = findImage(data);
      const bytes = b64 ? Buffer.from(b64, 'base64') : null;
      const mime = bytes && sniff(bytes);
      // No image: most often the request was refused by the service's safety rules.
      if (!mime) throw new ProviderError('refused', 'the image service returned no image', 200);
      return { bytes, mime };
    }
  };
}

// OpenAI GPT Image, the backup (IMAGE_FALLBACK_MODEL). Same interface.
// No photo: POST /v1/images/generations (JSON). With a photo: POST
// /v1/images/edits (multipart). The picture comes back as data[0].b64_json.
// GPT Image has three sizes, so the aspect ratio picks the nearest one; the
// prompt also names the exact ratio.
const OPENAI_SIZE = { '1:1': '1024x1024', '4:5': '1024x1536', '3:4': '1024x1536', '9:16': '1024x1536', '4:3': '1536x1024', '16:9': '1536x1024' };

export function createOpenAIImage({ apiKey, model, fetchImpl = fetch, timeoutMs = 100_000 }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the picture backup');
  return {
    id: 'openai',
    model,
    async generate({ prompt, images = [], aspectRatio = '1:1' }) {
      const size = OPENAI_SIZE[aspectRatio] || '1024x1024';
      let request;
      if (images.length) {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        form.append('size', size);
        form.append('n', '1');
        images.forEach((i, n) => form.append('image', new Blob([Buffer.from(i.data, 'base64')], { type: i.mime }), `photo-${n + 1}.${i.mime.split('/')[1]}`));
        request = { url: 'https://api.openai.com/v1/images/edits', body: form, headers: {} };
      } else {
        request = { url: 'https://api.openai.com/v1/images/generations', body: JSON.stringify({ model, prompt, size, n: 1 }), headers: { 'Content-Type': 'application/json' } };
      }
      let resp;
      try {
        resp = await fetchImpl(request.url, { method: 'POST', headers: { ...request.headers, Authorization: 'Bearer ' + apiKey }, body: request.body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'picture backup could not be reached');
      }
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const s = resp.status;
        const reason = String(data?.error?.message || '').replace(/\s+/g, ' ').slice(0, 300);
        // OpenAI's safety system answers 400 with code moderation_blocked.
        const kind = data?.error?.code === 'moderation_blocked' ? 'refused' : s === 429 ? 'busy' : s >= 500 ? 'unavailable' : 'config';
        throw new ProviderError(kind, `picture backup answered ${s}${reason ? ': ' + reason : ''}`, s);
      }
      const b64 = data?.data?.[0]?.b64_json;
      const bytes = typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null;
      const mime = bytes && sniff(bytes);
      if (!mime) throw new ProviderError('refused', 'the picture backup returned no image', 200);
      return { bytes, mime };
    }
  };
}

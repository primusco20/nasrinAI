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

export function createGeminiImage({ apiKey, model, fetchImpl = fetch, timeoutMs = 90_000 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for images');
  return {
    id: 'gemini',
    model,
    async generate({ prompt, images = [], aspectRatio = '1:1' }) {
      let resp;
      try {
        resp = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            model,
            input: [{ type: 'text', text: prompt }, ...images.map((i) => ({ type: 'image', mime_type: i.mime, data: i.data }))],
            response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspectRatio, image_size: '1K' }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (err) {
        throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'image service could not be reached');
      }
      if (!resp.ok) {
        const s = resp.status;
        throw new ProviderError(s === 429 ? 'busy' : s >= 500 ? 'unavailable' : 'config', `image service answered ${s}`, s);
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

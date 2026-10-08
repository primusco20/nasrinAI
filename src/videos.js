import { HttpError } from './http/errors.js';
import { safePrompt, MAX_SECONDS, STEP_SECONDS, EXTEND_SECONDS, videoStepSeconds } from './ai/video.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createVideos({ store, plans, provider, limiter, config, logger, now = () => Date.now() }) {
  const unavailable = () => new HttpError(503, 'videos_unavailable', 'Video creation is not available right now.');

  async function ultra(caller) {
    if (caller.actor.type !== 'user') throw new HttpError(403, 'video_ultra_required', 'Video creation is available on the Ultra plan.');
    if (!plans) throw unavailable();
    const p = await plans.current(caller);
    if (p.open || p.plan !== 'ultra') throw new HttpError(403, 'video_ultra_required', 'Video creation is available on the Ultra plan. Upgrade to Ultra to create videos.');
  }

  async function create(caller, body) {
    await ultra(caller);
    if (!provider) throw unavailable();
    await limiter.signIn('video:' + caller.actor.id, config.video.perHour);
    const b = body && typeof body === 'object' ? body : {};
    const prompt = safePrompt(b.prompt);
    const targetSeconds = Math.max(1, Math.min(MAX_SECONDS, Number(b.seconds) || MAX_SECONDS));
    const aspectRatio = b.aspect_ratio === '9:16' ? '9:16' : '16:9';
    const operation = await provider.create({ prompt, aspectRatio });
    const id = await store.addVideo({
      tenantId: caller.tenantId, conversationId: b.conversation_id || null,
      ownerType: caller.actor.type, ownerId: caller.actor.id, prompt,
      targetSeconds, producedSeconds: 0, status: 'in_progress',
      provider: provider.id, providerOperation: operation
    });
    logger.info('video job created', { id, targetSeconds, provider: provider.id });
    return { video_id: id, status: 'in_progress', progress: 0, target_seconds: targetSeconds };
  }

  async function advance(caller, id) {
    await ultra(caller);
    if (!UUID.test(String(id))) throw new HttpError(404, 'not_found', 'Video not found.');
    const v = await store.getVideo({ tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id, id });
    if (!v) throw new HttpError(404, 'not_found', 'Video not found.');
    if (v.status === 'completed' || v.status === 'failed') return v;

    let state;
    try { state = provider.extract(await provider.status(v.providerOperation)); }
    catch (err) {
      logger.warn('video provider poll failed', { id, error: err.message });
      return { ...v, progress: Math.min(95, Math.max(1, Math.floor((v.producedSeconds / Math.max(1, v.targetSeconds)) * 100))) };
    }
    if (!state.done) return { ...v, progress: Math.min(95, Math.max(1, Math.floor((v.producedSeconds / Math.max(1, v.targetSeconds)) * 100))) };
    if (state.failed || !state.uri) {
      await store.updateVideo(v.id, { status:'failed', errorCode:'provider_failed', errorMessage:state.error || 'Video generation failed.' });
      return await store.getVideo({ tenantId:v.tenantId, ownerType:v.ownerType, ownerId:v.ownerId, id:v.id });
    }

    const bytes = await provider.download(state.uri);
    const produced = v.producedSeconds ? v.producedSeconds + EXTEND_SECONDS : STEP_SECONDS;
    const reached = produced >= Math.min(v.targetSeconds, MAX_SECONDS);
    if (reached) {
      await store.updateVideo(v.id, { status:'completed', producedSeconds: Math.min(produced, MAX_SECONDS), providerVideoUri: state.uri, mime:'video/mp4', bytes });
    } else {
      const nextOperation = await provider.extend({ prompt: v.prompt, videoBytes: bytes });
      await store.updateVideo(v.id, {
        status:'in_progress',
        producedSeconds: produced,
        providerOperation: nextOperation,
        providerVideoUri: state.uri,
        mime:'video/mp4'
      });
    }
    return await store.getVideo({ tenantId:v.tenantId, ownerType:v.ownerType, ownerId:v.ownerId, id:v.id });
  }

  async function status(caller, id) {
    const v = await advance(caller, id);
    return {
      video_id: v.id, status: v.status,
      progress: v.status === 'completed' ? 100 : Math.min(99, Math.floor((v.producedSeconds / Math.max(1, v.targetSeconds)) * 100)),
      produced_seconds: v.producedSeconds, target_seconds: v.targetSeconds,
      error: v.status === 'failed' ? { code: v.errorCode, message: v.errorMessage } : null,
      download: v.status === 'completed' ? '/v1/videos/' + v.id + '/content' : null
    };
  }

  async function read(caller, id) {
    await ultra(caller);
    if (!UUID.test(String(id))) throw new HttpError(404, 'not_found', 'Video not found.');
    const v = await store.getVideo({ tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id, id });
    if (!v || v.status !== 'completed' || !v.bytes) throw new HttpError(404, 'not_found', 'Video is not ready.');
    return v;
  }

  return { available: Boolean(provider), create, status, read };
}

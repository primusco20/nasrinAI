// A provider must supply real authorized install, verify and rollback operations.
// This registry intentionally fails closed when an adapter is unavailable.
import { HttpError } from '../http/errors.js';

export function createInstallRegistry(adapters = {}) {
  const registry = new Map(Object.entries(adapters));
  return {
    methods() { return [...registry.keys()]; },
    async preview(method, context) {
      const adapter = registry.get(method);
      if (!adapter?.preview) throw new HttpError(409, 'provider_unavailable', 'This website needs a supported installation provider.');
      if (!context?.authorized) throw new HttpError(403, 'authorization_required', 'Authorize this website before previewing changes.');
      return adapter.preview(context);
    },
    async install(method, context) {
      const adapter = registry.get(method);
      if (!adapter?.install || !adapter?.verify || !adapter?.rollback) {
        throw new HttpError(409, 'provider_unavailable', 'This installation method is not ready.');
      }
      if (!context?.authorized || !context?.approved) {
        throw new HttpError(403, 'approval_required', 'Website authorization and explicit installation approval are required.');
      }
      const receipt = await adapter.install(context);
      try {
        const verified = await adapter.verify({ ...context, receipt });
        if (!verified?.ok || !verified?.version) throw new Error('Live installation verification failed');
        return { ok: true, version: verified.version, receipt };
      } catch (error) {
        try { await adapter.rollback({ ...context, receipt }); }
        catch { throw new HttpError(502, 'rollback_failed', 'Installation verification failed and automatic rollback could not complete. Manual recovery is required.'); }
        throw new HttpError(502, 'verification_failed', 'Installation could not be verified; changes were rolled back.');
      }
    }
  };
}

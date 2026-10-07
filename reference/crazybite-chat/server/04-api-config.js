// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM server.js:698-722 | GET /api/config (sends chatEnabled / ttsEnabled to the browser)
app.get('/api/config', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const deskBase = settings.support_peer_id || DEFAULT_SETTINGS.support_peer_id;
    // One call desk per branch: the app rings the desk of the branch the
    // customer picked, and the console answers for its own branch.
    const { data: deskBranches } = await db.from('branches').select('id, name').eq('active', true).order('sort_order');
    res.set('Cache-Control', 'no-store');
    res.json({
      supportDesks: (deskBranches || []).map((b) => ({ branch_id: b.id, name: b.name, peer_id: supportDeskId(deskBase, b.id) })),
      supabaseUrl: SUPABASE_BASE,
      supabaseAnonKey: SUPABASE_PUBLISHABLE_KEY,
      appUrl: APP_ORIGIN,
      ttsEnabled: !!OPENAI_API_KEY,
      chatEnabled: !!OPENAI_API_KEY,
      vapidPublicKey: (await ensurePush()) ? VAPID_PUBLIC : null,
      supportPeerId: settings.support_peer_id || DEFAULT_SETTINGS.support_peer_id,
      iceServers: await iceServers(),
      // Vercel cannot hold the broker's websockets: without PEER_HOST the
      // public PeerJS broker is used there (the desk ID is random, see support.html).
      peer: PEER_HOST ? { host: PEER_HOST, port: Number(PEER_PORT) || 443, path: PEER_PATH || '/', secure: true }
        : (process.env.VERCEL ? { host: '0.peerjs.com', port: 443, path: '/', secure: true } : null)
    });
  } catch (err) { next(err); }
});
// @@ END VERBATIM

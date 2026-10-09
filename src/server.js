import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { embed, warmUp, EMBEDDING_MODEL } from './embedder.js';
import { createSemanticCache } from './semanticCache.js';
import { createChatController } from './chatController.js';
import { askAI } from './aiClient.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const cache = createSemanticCache({ supabase, embed, modelName: EMBEDDING_MODEL });

const app = express();
app.use(express.json({ limit: '32kb' }));

// Replace with your real auth; it must set req.user.id.
const requireAuth = (req, _res, next) => { req.user = { id: 'demo-user' }; next(); };

app.post('/api/chat', requireAuth, createChatController({ cache, askAI }));

await warmUp();   // load the local model before taking traffic
app.listen(process.env.PORT || 3000);

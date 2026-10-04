// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/index.html:8599-9094 | Voice out (OpenAI TTS + browser fallback) and voice in (speech recognition, hands-free mode)

    // ---- voice replies ----
    let chatVoice = null;
    function pickChatVoice() {
      if (!window.speechSynthesis) return null;
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) return null;
      const english = voices.filter(v => /^en/i.test(v.lang));
      const wantMale = window.cbVoiceGender !== 'female';
      const maleRe = /(daniel|alex|fred|aaron|arthur|gordon|guy|david|mark|james|george|ryan|liam|thomas|rishi|oliver|male)/i;
      const femaleRe = /(samantha|ava|allison|serena|karen|moira|tessa|nicky|aria|jenny|libby|sonia|susan|zira|hazel|female)/i;
      const byGender = english.filter(v => wantMale ? (maleRe.test(v.name) && !/female/i.test(v.name)) : femaleRe.test(v.name));
      if (byGender.length) {
        return byGender.find(v => /natural|neural|premium|enhanced/i.test(v.name)) || byGender.find(v => v.localService) || byGender[0];
      }
      // Most human first: the neural voices, then the named voices that ship
      // with iOS, macOS and Android and sound like people rather than a
      // read-aloud machine, then anything local, then anything English.
      const warm = /natural|neural|premium|enhanced|siri/i;
      const named = /(samantha|ava|allison|serena|karen|moira|tessa|nicky|aria|jenny|guy|libby|sonia|female)/i;
      return english.find(v => warm.test(v.name))
          || english.find(v => named.test(v.name))
          || english.find(v => v.localService)
          || english[0] || voices[0];
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => { chatVoice = pickChatVoice(); };
      chatVoice = pickChatVoice();
    }

    let speechPrimed = false;
    // iOS only unlocks speech inside a real tap, so this has to run in the
    // handler itself - before any await - or the first reply is silent.
    function primeSpeech() {
      primeTtsAudio();
      if (speechPrimed || !window.speechSynthesis) return;
      try {
        const u = new SpeechSynthesisUtterance('a');   // a real word: iOS ignores a blank one
        u.volume = 0;
        window.speechSynthesis.speak(u);
        speechPrimed = true;
      } catch (e) {}
    }

    function speechFriendly(text) {
      return String(text || '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')   // emoji read as noise
        // "₱49.00" is said as "49 pesos", not "49 pesos. 00" — and the stray
        // ".00" was also splitting the sentence in two when spoken.
        .replace(/₱\s?([\d,]+)(?:\.(\d{1,2}))?/g, (m, whole, cents) => whole + (cents && Number(cents) ? ' pesos ' + cents : ' pesos'))
        .replace(/·/g, ',')
        .replace(/(\d+)\s*×/g, '$1')          // "2× burger" reads as "2 burger", not "2 ex"
        .replace(/\n+/g, '. ')                // a line break is a pause, not silence
        .replace(/([.!?])\s*\./g, '$1')      // without doubling up the full stop
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Chrome stops speaking after roughly 15 seconds unless it is nudged, so a
    // keepalive runs for as long as anything is queued.
    let speechKeepAlive = null;
    function startSpeechKeepAlive() {
      clearInterval(speechKeepAlive);
      speechKeepAlive = setInterval(() => {
        if (!window.speechSynthesis) return clearInterval(speechKeepAlive);
        if (!window.speechSynthesis.speaking) { clearInterval(speechKeepAlive); speechKeepAlive = null; return; }
        try { window.speechSynthesis.pause(); window.speechSynthesis.resume(); } catch (e) {}
      }, 7000);
    }

    const CHAT_GREETING = 'Hi, I\'m Nasrin. What can I get you?';
    const CHAT_IDLE_MS = 3 * 60 * 1000;     // no reply for 3 minutes: the chat starts over
    const MIC_AFTER_VOICE_MS = 450;         // a phone needs a moment after speaking before the mic hears anything

    // ---- OpenAI voice ------------------------------------------------------
    // Replies are spoken by /api/tts (OpenAI) for a natural voice. Any failure —
    // no key on the server, offline, a rate limit, autoplay refused — drops
    // straight back to the browser's own voice below, so a reply is never silent.
    let ttsAvailable = true;
    const ttsAudio = new Audio();          // one element, unlocked once by a real tap
    ttsAudio.preload = 'auto';
    const ttsCache = new Map();            // sentence chunk -> blob URL (greeting, repeats)
    let speakBusy = false, ttsToken = 0, ttsPlaying = false, ttsAbort = null, ttsHalt = null, ttsUnlocked = false;

    function isSpeaking() {
      return speakBusy || ttsPlaying || !!(window.speechSynthesis && window.speechSynthesis.speaking);
    }

    // iOS only lets an audio element play later if it was started inside a tap.
    // A blob URL is used for the silent clip because the CSP allows blob: but
    // not data: for media.
    function primeTtsAudio() {
      if (!ttsAvailable || ttsUnlocked || ttsPlaying) return;
      try {
        const b = new Uint8Array(46), v = new DataView(b.buffer);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
        w(0, 'RIFF'); v.setUint32(4, 38, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
        v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
        v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, 2, true);
        ttsUnlocked = true;
        ttsAudio.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
        const p = ttsAudio.play();
        if (p && p.catch) p.catch(() => { ttsUnlocked = false; });
      } catch (e) { ttsUnlocked = false; }
    }

    // Short chunks: the first one starts playing while the rest are still being
    // generated, so a long reply doesn't wait for all of its audio.
    function ttsChunks(clean) {
      const sentences = (clean.match(/[^.!?。！？؟।]+[.!?。！？؟।]*/g) || [clean])
        .map(s => s.trim()).filter(s => /[\p{L}\p{N}]/u.test(s))
        .flatMap(s => s.length > 450 ? (s.match(/.{1,450}(\s|$)/g) || [s]).map(x => x.trim()) : [s]);
      // The first sentence goes out alone: a short request comes back fastest,
      // so speech starts sooner while the rest is generated in parallel.
      const out = sentences.length ? [sentences.shift()] : [];
      let cur = '';
      sentences.forEach(s => {
        if (cur && (cur + ' ' + s).length > 280) { out.push(cur); cur = s; }
        else cur = cur ? cur + ' ' + s : s;
      });
      if (cur) out.push(cur);
      return out;
    }

    async function ttsFetch(chunk, signal) {
      const gender = window.cbVoiceGender === 'female' ? 'female' : 'male';
      const ckey = gender + '|' + chunk;
      if (ttsCache.has(ckey)) return ttsCache.get(ckey);
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ text: chunk, gender })
      });
      // Any failure (no key, no billing, rate limit) switches OpenAI off for the
      // session. Otherwise every reply pays a network round trip first and the
      // browser voice then starts too late for iOS, which only allows speech
      // that begins straight after a tap.
      if (!resp.ok) { ttsAvailable = false; throw new Error('tts ' + resp.status); }
      const url = URL.createObjectURL(await resp.blob());
      ttsCache.set(ckey, url);
      if (ttsCache.size > 24) {
        const oldest = ttsCache.keys().next().value;
        URL.revokeObjectURL(ttsCache.get(oldest));
        ttsCache.delete(oldest);
      }
      return url;
    }

    function ttsPlay(url) {
      return new Promise(resolve => {
        const done = ok => { ttsAudio.onended = ttsAudio.onerror = null; ttsHalt = null; resolve(ok); };
        ttsHalt = () => done(false);
        ttsAudio.onended = () => done(true);
        ttsAudio.onerror = () => done(false);
        ttsAudio.src = url;
        const p = ttsAudio.play();
        if (p && p.catch) p.catch(() => done(false));
      });
    }

    // Stops any audio and abandons any reply still being fetched. Called at the
    // start of every speakText(), so a fast new reply (or a flow that calls
    // chatSay twice in a row) cannot end up with two voices talking over each
    // other: the OpenAI audio element AND a still-running browser-voice
    // fallback both have to be silenced here, not just the audio element.
    function haltTts() {
      ttsToken++;
      if (ttsAbort) { try { ttsAbort.abort(); } catch (e) {} ttsAbort = null; }
      if (ttsHalt) ttsHalt();
      try { ttsAudio.pause(); } catch (e) {}
      // Only cancel when something is actually queued — cancelling an idle
      // synth is what leaves Safari refusing to speak on the next attempt.
      try {
        if (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
          window.speechSynthesis.cancel();
        }
      } catch (e) {}
      ttsPlaying = false;
      speakBusy = false;
    }

    function speakText(text, onDone, lang) {
      speakLang = lang || '';
      haltTts();
      const token = ttsToken;
      speakBusy = true;                                // true until this reply has finished, even between OpenAI and the fallback
      // A reply that was cut off (stopped, or replaced by a newer one) must not
      // reopen the mic; one that finished, or could not be spoken, must.
      let finished = false;
      const done = () => {
        if (finished || token !== ttsToken) return;
        finished = true; speakBusy = false; ttsPlaying = false;
        clearTimeout(watchdog);
        if (onDone) onDone();
      };
      // Some phones never report that speech ended (the audio's "ended" or the
      // voice's onend is lost), which left the mic waiting forever. A reply is
      // over after roughly the time it takes to say it, whatever the phone says.
      const watchdog = setTimeout(() => {
        if (finished || token !== ttsToken) return;
        haltTts();
        finished = true;
        if (onDone) onDone();
      }, Math.min(90000, 4000 + String(text || '').length * 95));
      if (!ttsAvailable) { speakWithBrowser(text, done); return; }
      const clean = speechFriendly(text);
      const chunks = clean ? ttsChunks(clean) : [];
      if (!chunks.length) { done(); return; }          // nothing to say aloud: carry on

      ttsAbort = new AbortController();
      const jobs = chunks.map(c => ttsFetch(c, ttsAbort.signal));
      jobs.forEach(j => j.catch(() => {}));            // handled in the loop below
      ttsPlaying = true;

      (async () => {
        for (let i = 0; i < chunks.length; i++) {
          let ok = false;
          try { ok = await ttsPlay(await jobs[i]); } catch (e) { ok = false; }
          if (token !== ttsToken) return;              // stopped, or replaced by a newer reply
          if (!ok) {                                   // say what is left in the browser's voice
            ttsPlaying = false;
            speakWithBrowser(chunks.slice(i).join(' '), done);
            return;
          }
        }
        done();
      })();
    }

    // ---- browser voice (fallback) ----
    function speakWithBrowser(text, onDone) {
      if (!window.speechSynthesis) { if (onDone) onDone(); return; }   // no voice: carry on regardless
      try {
        // Only cancel when something is actually queued: a cancel() on an idle
        // synth is what leaves Safari refusing to speak afterwards.
        const wasBusy = window.speechSynthesis.speaking || window.speechSynthesis.pending;
        if (wasBusy) window.speechSynthesis.cancel();
        const clean = speechFriendly(text);
        if (!clean) { if (onDone) onDone(); return; }
        // The voice list loads asynchronously; on the first reply it is often
        // still empty, which is what leaves a browser reading in its flattest
        // default voice.
        if (!chatVoice) chatVoice = pickChatVoice();
        const finish = () => { if (onDone) { const cb = onDone; onDone = null; cb(); } };
        // Split by sentence: a single long utterance gets truncated on iOS.
        const chunks = (clean.match(/[^.!?。！？؟।]+[.!?。！？؟।]*/g) || [clean])
          .map(s => s.trim())
          .filter(s => /[\p{L}\p{N}]/u.test(s));      // drop leftovers from stripped emoji
        if (!chunks.length) { finish(); return; }
        const say = () => {
          chunks.forEach((chunk, i) => {
            const u = new SpeechSynthesisUtterance(chunk);
            const lv = speakLang && !/^en/i.test(speakLang) ? voiceForLang(speakLang) : null;
            if (speakLang && !/^en/i.test(speakLang)) { u.lang = speakLang; if (lv) u.voice = lv; }
            else if (chatVoice) u.voice = chatVoice;
            u.rate = 1.15;                        // a little quicker than default
            u.pitch = 1;
            if (i === chunks.length - 1) {        // the mic reopens when this one ends
              u.onend = finish;
              u.onerror = finish;
            }
            window.speechSynthesis.speak(u);
          });
          startSpeechKeepAlive();
          // If nothing is speaking shortly after, the browser refused it — carry
          // on rather than leaving a conversation waiting on a reply that never
          // finishes.
          setTimeout(() => { if (!window.speechSynthesis.speaking) finish(); }, 900);
        };
        // Chrome drops an utterance queued in the same tick as a cancel().
        if (wasBusy) setTimeout(say, 90); else say();
      } catch (e) { if (onDone) onDone(); }
    }

    // A browser voice that matches the reply's language (the default pick is always English).
    function voiceForLang(lang) {
      try {
        const base = String(lang).toLowerCase().split('-')[0];
        const list = (window.speechSynthesis.getVoices() || []).filter(v => String(v.lang).toLowerCase().split(/[-_]/)[0] === base);
        return list.find(v => /natural|neural|premium|enhanced/i.test(v.name)) || list.find(v => v.localService) || list[0] || null;
      } catch (e) { return null; }
    }

    function stopSpeaking() {
      haltTts();
      clearInterval(speechKeepAlive);
      speechKeepAlive = null;
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }

    // ---- voice input ----
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    let chatRecognizer = null;
    let chatIdleSince = Date.now();      // last time anyone said anything in a hands-free chat

    // Voice typing fails for three reasons that look identical from the
    // outside, so each one says what it is instead of quietly doing nothing.
    // A couple of the failures (a "network" blip, or the engine going quiet
    // and never firing a single event) are transient on some phones, so those
    // get one silent retry before bothering the person with a message.
    // Lets go of the speaker before the mic opens: a paused-but-loaded audio
    // element or a queued voice keeps some phones in "playback" mode, and the
    // mic then records silence.
    function releaseSpeaker() {
      if (isSpeaking()) return;
      try { ttsAudio.pause(); ttsAudio.removeAttribute('src'); ttsAudio.load(); } catch (e) {}
      try { if (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) window.speechSynthesis.cancel(); } catch (e) {}
    }

    // auto: opened by the conversation loop rather than a tap. delay: wait
    // that long first (the phone was talking a moment ago).
    function startListening(scope, attempt, auto, delay) {
      attempt = attempt || 0;
      if (delay > 0) {
        scope.chatListening = true;          // show "listening" straight away
        setTimeout(() => {
          if (!scope.showChat || !scope.chatConvo) { scope.chatListening = false; return; }
          scope.chatListening = false;
          startListening(scope, attempt, auto, 0);
        }, delay);
        return;
      }
      const framed = window.self !== window.top;
      if (!SpeechRec) {
        // In-app browsers (including previews inside another app) and iOS
        // WebViews have no Web Speech recognition at all. The keyboard's own
        // dictation key still works, so point at that and open the keyboard.
        scope.showToast('This browser has no voice typing — use the mic key on your keyboard');
        const box = document.getElementById('chatInput');
        if (box) box.focus();
        return;
      }
      if (window.isSecureContext === false) {
        scope.showToast('Voice typing needs the page served over https');
        return;
      }

      stopListening();                       // never leave an old session running
      releaseSpeaker();
      const rec = new SpeechRec();
      chatRecognizer = rec;
      // Events from a session that has already been replaced must be ignored —
      // a stale onend was what switched listening off again after the chat was
      // closed and reopened.
      const current = () => chatRecognizer === rec;
      let gotEvent = false;                  // any result or error at all, for the watchdog below

      // Filipino English by default; Tagalog when the phone is set to it.
      rec.lang = /^(fil|tl)/i.test(navigator.language || '') ? 'fil-PH' : 'en-PH';
      if (CHAT_MULTI) {
        // Browsers cannot detect the spoken language, so listen in the language the chat is
        // currently using (the last AI reply), else the phone's own language.
        const map = { tl: 'fil-PH', fil: 'fil-PH', ceb: 'fil-PH', en: 'en-PH' };
        const pick = (chatLang || '').toLowerCase().split('-')[0];
        rec.lang = map[pick] || (chatLang || navigator.language || rec.lang);
      }
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      // Continuous, not one-shot: with continuous=false the engine ends its
      // session the instant it detects a pause, and everything said in the gap
      // between that end and the next start() is lost — the "drops off and
      // misses input" symptom. Continuous keeps one session open across pauses;
      // it is stopped explicitly (below, and in chatSend) only when we actually
      // want the mic off, not by the engine's own silence timer.
      // Android Chrome repeats phrases and iOS Safari never finalises in
      // continuous mode, so phones use one phrase per session (the
      // conversation loop below reopens it); desktops keep continuous.
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      rec.continuous = !mobile;
      let interimTimer = null, sent = false;
      const sendOnce = (text) => {
        if (sent || !text) return;
        sent = true;
        clearTimeout(interimTimer);
        scope.chatSilence = 0;
        scope.chatListening = false;
        stopListening();
        // words heard while a reply is still on its way go out right after it
        let waited = 0;
        const go = () => {
          if (scope.chatTyping && waited < 20000) { waited += 250; setTimeout(go, 250); return; }
          scope.chatSend(text);
        };
        go();
      };

      rec.onresult = (e) => {
        gotEvent = true;
        if (!current()) return;
        let final = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
        }
        scope.chatHeard = (final || interim).trim();
        chatIdleSince = Date.now();
        if (final.trim()) { sendOnce(final.trim()); return; }
        // Some engines (iOS especially) leave a phrase "interim" forever: a
        // short pause after the last word counts as the end of it.
        clearTimeout(interimTimer);
        const heard = interim.trim();
        if (heard) interimTimer = setTimeout(() => { if (current()) sendOnce(heard); }, 1400);
      };

      rec.onerror = (e) => {
        gotEvent = true;
        if (!current()) return;
        scope.chatListening = false;
        const err = (e && e.error) || '';
        if (err === 'aborted') return;                      // the person stopped it
        if (err === 'no-speech') {
          if (!scope.chatConvo) scope.showToast('I didn\'t catch that — try again');
          return;                                  // in conversation, onend listens again
        }
        // "network" and "audio-capture" are sometimes a one-off hiccup on
        // mobile rather than a real problem, so try once more before giving up.
        if (err === 'audio-capture' || err === 'network') {
          if (attempt < 1) { setTimeout(() => { if (current()) startListening(scope, attempt + 1, auto); }, 600); return; }
          scope.chatConvo = false;
          scope.showToast(err === 'network' ? 'Voice typing could not reach the speech service' : 'No microphone found on this device');
          return;
        }
        if ((err === 'not-allowed' || err === 'service-not-allowed') && auto) {
          // the phone only opens the mic after a tap: ask for one
          scope.chatConvo = false;
          scope.showToast('Tap the mic to answer');
          return;
        }
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          scope.chatConvo = false;
          scope.showToast(framed
            ? 'The microphone is blocked in this preview — open the page in its own browser tab'
            : 'Microphone permission is blocked — allow it for this site in your browser settings');
          return;
        }
        scope.showToast('Voice typing stopped (' + (err || 'unknown') + ')');
      };

      rec.onend = () => {
        gotEvent = true;
        if (!current()) return;
        // the session closed with words heard but never finalised: use them
        if (!sent && scope.chatHeard) { sendOnce(scope.chatHeard); return; }
        scope.chatListening = false;
        // A silent gap shouldn't end the conversation — reopen the mic unless
        // a reply is on its way or currently being spoken.
        if (!scope.chatConvo || !scope.showChat) return;
        if (Date.now() - chatIdleSince > CHAT_IDLE_MS) {  // three quiet minutes: stop, so the mic is never left open unattended
          scope.chatConvo = false;
          scope.showToast('Stopped listening — tap the mic to talk again');
          return;
        }
        scope.chatSilence++;
        setTimeout(() => {
          const busy = scope.chatTyping || scope.chatListening || isSpeaking();
          if (scope.chatConvo && scope.showChat && !busy) startListening(scope, 0, true);
        }, 250);
      };

      const begin = (retry) => {
        try {
          rec.start();
          scope.chatHeard = '';
          scope.chatListening = true;
          // Some engines occasionally start and then go completely silent —
          // no result, no error, no end. If nothing has happened at all after
          // a few seconds, restart once rather than leaving the mic looking
          // "on" while it does nothing.
          setTimeout(() => {
            if (current() && !gotEvent && scope.chatListening) {
              try { rec.abort(); } catch (e) {}
              if (attempt < 1) startListening(scope, attempt + 1, auto, 300);
              else { scope.chatListening = false; scope.chatConvo = false; scope.showToast('Voice typing didn\'t pick up — tap the mic again'); }
            }
          }, 6000);
        } catch (err) {
          // Safari throws if the previous session is still closing. One retry
          // covers reopening the chat quickly after closing it.
          if (!retry) { setTimeout(() => { if (current()) begin(true); }, 400); return; }
          scope.chatListening = false;
          scope.chatConvo = false;
          scope.showToast('Voice typing could not start — tap the mic again');
        }
      };
      begin(false);
    }

    function stopListening() {
      const rec = chatRecognizer;
      chatRecognizer = null;               // cleared first, so its events are ignored
      if (!rec) return;
      rec.onresult = rec.onerror = rec.onend = null;
      try { if (rec.abort) rec.abort(); else rec.stop(); } catch (e) {}
    }
// @@ END VERBATIM

// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/index.html:8432-8452 | CHAT_AI, CHAT_MULTI, chatLang, CHAT_HOME_WORDS, chatLooksForeign()
    let CHAT_AI = false;
    // Smart chat language (owner setting, arrives with the store settings).
    let CHAT_MULTI = false;
    let chatLang = '';         // language of the last AI reply, e.g. 'es'
    let speakLang = '';        // language of the reply being spoken
    // Common English / Filipino / Bisaya words. A message made mostly of these is handled by the
    // built-in assistant; anything else is passed to the AI when multi-language is on.
    const CHAT_HOME_WORDS = new Set(('a an the i me my we you your it is are am was be to of in on at for and or but not no yes ok okay hi hello hey please thanks thank ' +
      'what when where who how why can could do does did have has want need like order menu price cost much many any some this that there here with from ' +
      'burger burgers chicken fries drink drinks rice meal combo cart track pay payment delivery pickup pick up dine branch open close hours promo ' +
      'ako ko ka mo ikaw siya kami tayo kayo sila ang ng nang sa na ay at o pero hindi wala meron mayroon may po opo oo hindi gusto gustong bili bumili ' +
      'magkano ilan ano saan kailan paano bakit pwede puwede pa ba ko naman lang din rin kasi salamat mag pakiusap paki ' +
      'unsa pila naa asa kanus-a nganong ngano pwede gusto palit palihug lami kaayo nimo imo akong ni kini kana tan-aw').split(' '));
    function chatLooksForeign(text) {
      const s = String(text || '');
      if (/[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF]/.test(s)) return true;      // another script (Thai, Arabic, CJK, ...)
      const words = s.toLowerCase().match(/[a-zà-ÿ'-]+/g) || [];
      if (words.length < 3) return false;                                             // "menu", "order pls": keep the fast local answer
      const home = words.filter(w => CHAT_HOME_WORDS.has(w)).length;
      return home / words.length < 0.25;
    }
// @@ END VERBATIM

// @@ VERBATIM public/index.html:5552-5552 | Where CHAT_MULTI is set from store settings
          if ('chat_multilang_enabled' in row) CHAT_MULTI = row.chat_multilang_enabled === true;
// @@ END VERBATIM

// @@ VERBATIM public/index.html:8562-8568 | Where CHAT_AI is set from /api/config + greeting audio prefetch
          CHAT_AI = !!cfg.chatEnabled;
          // Fetch the greeting's audio in the background so the first thing the
          // chat says starts without any wait.
          if (ttsAvailable) setTimeout(() => {
            const ctrl = new AbortController();
            ttsChunks(speechFriendly(CHAT_GREETING)).forEach(c => ttsFetch(c, ctrl.signal).catch(() => {}));
          }, 1500);
// @@ END VERBATIM

// @@ VERBATIM public/index.html:8593-8598 | authHeader() (sends the signed-in user's token to /api/chat)
    async function authHeader() {
      if (!sb) return {};
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      return token ? { Authorization: 'Bearer ' + token } : {};
    }
// @@ END VERBATIM

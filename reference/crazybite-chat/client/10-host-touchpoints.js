// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/index.html:6020-6025 | clearLocalData(): sign-out wipes the saved chat (cb_chat) and chatLog
        clearLocalData() {
          ['cb_cart_v1', 'cb_chat', 'cb_notif', 'cb_guest_reads', 'cb_addr_v1'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
          this.cart = [];
          this.chatLog = [];
          this.deliveryAddress = null;
        },
// @@ END VERBATIM

// @@ VERBATIM public/index.html:7471-7475 | addToCart: the "added to cart" pop-up is hidden while the chat is open
          if (!this.showChat) {
            this.cartNotice = { image: it.image, label: qty + '× ' + it.name };
            clearTimeout(this.cartNoticeTimer);
            this.cartNoticeTimer = setTimeout(() => { this.cartNotice = null; }, 4000);
          }
// @@ END VERBATIM

// @@ VERBATIM public/index.html:8346-8354 | Original design notes for the AI upgrade (/api/chat)
    // SMART CHAT — optional AI upgrade. Empty means the built-in assistant
    // answers everything on its own. Point this at your own endpoint that
    // accepts { message, history, knowledgeBase } and replies { reply }, with
    // the provider key read from a server environment variable. Never put an
    // AI key in this file: anyone who opens the page can read it and spend it.
    // The server should answer from its own copy of the menu rather than
    // trusting the knowledgeBase this sends, which a caller could forge.
    // Smart Chat asks the server (/api/chat, which holds the OpenAI key and reads
    // the live menu itself) whenever the built-in assistant has no exact answer.
// @@ END VERBATIM

// @@ VERBATIM public/index.html:8555-8555 | initSupabase: voice off when the server says TTS is not configured
          if (cfg.ttsEnabled === false) ttsAvailable = false;
// @@ END VERBATIM

// @@ VERBATIM public/index.html:8584-8584 | initSupabase: voice off when the API is unreachable
          ttsAvailable = false;                // the API is unreachable, so is /api/tts
// @@ END VERBATIM

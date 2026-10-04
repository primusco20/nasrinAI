// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/index.html:4679-5220 | Chat methods part 1: open/send/reply/remote AI/built-in brain/order flow/actions
        // =====================================================================
        // SMART CHAT — ported from the Primus Smart Chat, with its knowledge
        // base swapped for this app's own menu, orders, branches and rewards.
        // Messages are stored as data and rendered as text (never innerHTML),
        // so nothing in a saved conversation can execute.
        // =====================================================================
        openChat() {
          primeSpeech();
          this.showChat = true;
          if (!this.chatLog.length) {
            this.chatSay({ text: CHAT_GREETING, actions: [
              { label: 'See the menu', act: 'menu' },
              { label: 'Where is my order?', act: 'orders' }
            ] });
          } else if (this.chatResumePending) {
            // They left mid-conversation without clearing it — pick up rather
            // than silently reprinting the old log or wiping it.
            this.chatResumePending = false;
            // shown, not spoken: it is a question for the screen, and a voice
            // playing here is what stopped the mic hearing a quick reply
            this.chatPush('bot', 'Welcome back — want to continue where we left off, or start something new?', [
              { label: 'Continue', act: 'resume:continue' },
              { label: 'Start fresh', act: 'resume:restart' }
            ]);
          }
        },

        chatPush(role, text, actions) {
          this.chatLastActivity = Date.now();
          this.chatLog.push({ id: ++this.chatSeq, role, text, actions: actions || [] });
          if (this.chatLog.length > 60) this.chatLog = this.chatLog.slice(-60);
          this.chatSave();
          this.$nextTick(() => {
            const el = this.$refs.chatScroll;
            if (el) el.scrollTop = el.scrollHeight;
          });
        },

        chatSay(reply) {
          if (!reply) return;
          this.chatPush('bot', reply.text, reply.actions);
          if (this.chatSpeech) speakText(reply.text, () => this.chatAfterSpeaking(), reply.lang);
          else this.chatAfterSpeaking();
        },

        // In conversation mode the mic opens again the moment the reply
        // finishes — never while it is still speaking, or it would hear itself.
        chatAfterSpeaking() {
          chatIdleSince = Date.now();
          this.chatLastActivity = Date.now();
          if (!this.chatConvo || !this.showChat) return;
          if (this.chatTyping || this.chatListening) return;
          // Phones hold on to the speaker for a moment after a voice stops;
          // opening the mic in that moment is what made it hear nothing.
          setTimeout(() => {
            if (this.chatConvo && this.showChat && !this.chatTyping && !this.chatListening && !isSpeaking()) startListening(this, 0, true);
          }, MIC_AFTER_VOICE_MS);
        },

        async chatSend(preset) {
          const text = String(preset || this.chatDraft || '').trim();
          if (!text || this.chatTyping) return;
          primeSpeech();                       // still inside the tap
          if (isSpeaking()) stopSpeaking();    // talking over the reply cuts it off at once
          this.chatDraft = '';
          this.chatPush('user', text);
          this.chatTyping = true;
          let reply;
          try {
            reply = await this.chatReply(text);
          } catch (e) {
            reply = { text: 'Sorry, something went wrong on my end. Mind asking again?' };
          }
          this.chatTyping = false;
          this.chatSay(reply);
        },

        // Exact intents (ordering, tracking, fees, the menu) are answered here,
        // instantly and with tappable buttons. Anything else goes to the
        // server's AI, which reads the live menu, prices and this person's
        // orders itself — so it can never quote a stale price.
        async chatReply(text) {
          if (this.chatFlow.step) return this.chatFlowReply(text);
          const local = this.chatAnswer(text);
          // With multi-language on, a message that is not English/Filipino goes to the AI even if a
          // keyword ("menu", "order") made the built-in assistant think it understood.
          if (CHAT_AI && (local.fallback || (CHAT_MULTI && chatLooksForeign(text)))) {
            const remote = await this.chatRemoteReply(text);
            if (remote) return remote;
          }
          await new Promise(r => setTimeout(r, 120));
          return local;
        },

        async chatRemoteReply(text) {
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 13000);
            const resp = await fetch('/api/chat', {
              method: 'POST',
              headers: Object.assign({ 'Content-Type': 'application/json' }, await authHeader()),
              signal: ctrl.signal,
              body: JSON.stringify({
                message: text.slice(0, 500),
                history: this.chatLog.slice(-8, -1).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text).slice(0, 600) }))
              })
            });
            clearTimeout(timer);
            if (!resp.ok) return null;
            const data = await resp.json();
            if (!data || typeof data.reply !== 'string' || !data.reply.trim()) return null;
            const actions = (Array.isArray(data.actions) ? data.actions : []).filter(a => a && a.label && a.act).slice(0, 4);
            if (CHAT_MULTI && typeof data.lang === 'string') chatLang = data.lang;
            return { text: data.reply.slice(0, 1200), actions, lang: CHAT_MULTI && typeof data.lang === 'string' ? data.lang : '' };
          } catch (e) {
            console.warn('[chat] AI unavailable, using the built-in assistant:', e.message);
            return null;
          }
        },

        // ---------- the built-in assistant ----------
        chatFindItem(lower) {
          const byLength = [...this.menuItems].sort((a, b) => b.name.length - a.name.length);
          return byLength.find(m => lower.includes(m.name.toLowerCase()))
              || byLength.find(m => m.name.toLowerCase().split(' ').some(w => w.length > 4 && lower.includes(w)));
        },

        // Direct signal words for wanting a human — kept separate from the
        // sentiment check below so a calm "can I talk to someone" still routes
        // to support even with no negative feeling attached to it.
        chatWantsPerson(lower) {
          return /\b(human|agent|operator|representative|rep|staff|manager|cashier|crew|someone|somebody|anyone)\b/.test(lower)
            || /\b(call|phone|ring|hotline|dial|speak|talk|chat)\b/.test(lower)
            || /\b(support|helpline|customer service|customer care|live chat|livechat)\b/.test(lower)
            || /\b(tao|kausap|tawag|kausapin)\b/.test(lower)          // Tagalog / Bisaya
            || /(real person|live person|talk to a|speak to a|chat to a|connect me|put me through|get me a|escalate|need help now|need help asap)/.test(lower)
            || /(complain|complaint|refund|wrong order|missing item|cancel my order|not working|problem with my)/.test(lower)
            // a complaint about the food or the order is a person's job too
            || (/\b(wrong|missing|damaged|late|cold|burnt|spoiled|bad|never arrived)\b/.test(lower)
                && /\b(order|food|item|delivery|burger|fries|drink|rider)\b/.test(lower));
        },

        // A light read on tone, so a frustrated message gets acknowledged
        // before anything else, and a happy one gets matched in kind — rather
        // than answering every message in exactly the same flat voice.
        chatSentiment(lower) {
          const negative = /\b(angry|annoyed|frustrat\w*|upset|mad|furious|disappointed|terrible|horrible|awful|worst|hate|sucks|ridiculous|unacceptable|useless|annoying|pissed|sad|worried|stressed|ugh|not happy|so slow|taking forever|waited (so |too )?long)\b/;
          const positive = /\b(love|great|awesome|amazing|excellent|fantastic|yummy|delicious|perfect|happy|excited|best (ever|food)|thank you so much|thanks so much|you'?re the best)\b/;
          if (negative.test(lower)) return 'negative';
          if (positive.test(lower)) return 'positive';
          return 'neutral';
        },

        chatAnswer(raw) {
          const lower = ' ' + String(raw).toLowerCase().trim() + ' ';
          const sentiment = this.chatSentiment(lower);
          const reply = this.chatAnswerCore(raw, lower);
          if (reply.noTone) return reply;
          if (sentiment === 'negative') {
            reply.text = 'I hear you, and I\'m sorry about that. ' + reply.text;
            if (!(reply.actions || []).some(a => a.act === 'callsupport')) {
              reply.actions = (reply.actions || []).concat([{ label: 'Talk to support', act: 'callsupport' }]);
            }
          } else if (sentiment === 'positive') {
            reply.text = 'Glad to hear it! ' + reply.text;
          }
          return reply;
        },

        chatAnswerCore(raw, lower) {
          const hit = (...words) => words.some(w => lower.includes(w));
          const P = n => this.peso(n);
          const item = this.chatFindItem(lower);

          // a person, please
          // Asking for a person, however it is phrased, ends with a call button.
          const wantsPerson = this.chatWantsPerson(lower);
          if (wantsPerson) {
            const line = /\b(complain|complaint|refund|wrong|missing|damaged|late|cold|burnt|spoiled|problem|not working|never arrived)\b/.test(lower)
              ? 'Sorry about that — let me get you to the team. They can fix it fastest on a call.'
              : 'Of course. I can put you straight through to our support desk.';
            return { text: line, noTone: true, actions: [{ label: 'Call support', act: 'callsupport' }, { label: 'Other ways to reach us', act: 'contact' }] };
          }
          // greetings and manners
          if (lower.length < 22 && hit('hello', 'hi ', 'hey', 'kumusta', 'good morning', 'good afternoon', 'good evening')) {
            return { text: 'Hey! What can I get you today?', actions: [{ label: 'See the menu', act: 'menu' }, { label: 'Order something', act: 'order' }] };
          }
          if (hit('thank', 'salamat')) return { text: 'Anytime. Anything else?' };
          if (hit('bye', 'goodbye', 'see you')) return { text: 'Enjoy your food! See you soon.' };

          // where is my order
          if (hit('where is my order', 'my order', 'track', 'order status', 'rider', 'how long will', 'arriving', 'ready yet')) {
            if (!this.orders.length) {
              return { text: 'You\'ve got nothing on the way right now.', actions: [{ label: 'See the menu', act: 'menu' }] };
            }
            const lines = this.orders.map(o => (o.mode === 'delivery' ? 'Delivery ' : 'Pick-up ') + o.id + ' — ' + o.status + ', ' + this.orderTiming(o));
            return { text: 'Here\'s where your orders are. ' + lines.join('\n'), actions: [{ label: 'Track it', act: 'track' }, { label: 'All orders', act: 'orders' }] };
          }

          // What is good here? Checked before the ordering trigger, since
          // "most ordered" contains "order".
          if (hit('popular', 'best seller', 'bestseller', 'most ordered', 'recommend', 'what is good', 'favourite', 'favorite')) {
            const pop = this.menuItems.filter(m => m.popular);
            return { text: 'These are going out the most today. ' + pop.map(m => '· ' + m.name + ' — ' + P(m.price)).join('\n'), actions: pop.map(m => ({ label: m.name, act: 'pick:' + m.id })) };
          }

          // Fees, before the menu: "how much is delivery" is a fee question,
          // not a request for the price list.
          if (hit('delivery fee', 'shipping', 'free delivery', 'service fee', 'charge')
              || (hit('delivery', 'deliver') && hit('how much', 'cost', 'fee', 'price'))) {
            const exact = this.quote && this.quote.delivery && this.quote.delivery.km != null
              ? ' For your pinned address it comes to ' + P(this.quote.delivery.fee_cents / 100) + ' (' + this.quote.delivery.km.toFixed(1) + ' km).' : '';
            return { text: 'Delivery is ' + P(this.deliveryFeeAmount) + ' plus ' + P(this.deliveryPerKm) + ' per km from the branch, and there is a ' + P(this.serviceFeeAmount) + ' service fee.' + exact + ' Pick-up and dine-in have no delivery fee.', actions: [{ label: 'View cart', act: 'cart' }] };
          }

          // ordering — "order" as a whole word only, so "most ordered" and
          // "order status" don't start a new one
          if (/\border\b/.test(lower) || hit('i want', 'i would like', 'can i get', 'give me', 'buy', 'add to cart', 'gusto ko')) {
            return this.chatStartOrder(lower);      // the whole sentence, so size/flavour/quantity come with it
          }

          // one dish
          if (item && this.isSoldOut(item.id)) {
            const alt = this.menuItems.filter(m => m.category === item.category && !this.isSoldOut(m.id) && m.id !== item.id).slice(0, 3);
            return { text: 'Sorry, ' + item.name + ' is sold out right now.' + (alt.length ? ' How about one of these?' : ''), actions: alt.map(m => ({ label: m.name, act: 'pick:' + m.id })).concat([{ label: 'See the menu', act: 'menu' }]) };
          }
          if (item) {
            return {
              text: item.name + ' is ' + (this.sizesOf(item).length > 1 ? 'from ' : '') + P(this.fromPrice(item)) + '. ' + item.desc
                + (this.sizesOf(item).length ? '\nSizes: ' + this.sizesOf(item).map(z => z.name + ' ' + P(z.price)).join(', ') + '.' : '')
                + ((item.flavours || []).length ? '\nFlavours: ' + item.flavours.join(', ') + '.' : ''),
              actions: [{ label: 'Add to cart', act: 'pick:' + item.id }, { label: 'See the menu', act: 'menu' }]
            };
          }

          // the menu, and what is good — each item is tappable, so a name in
          // the chat starts an order instead of only sitting there as text
          if (hit('menu', 'price', 'how much', 'cost', 'what do you have', 'what do you sell', 'food', 'drink')) {
            const byCat = this.categories.filter(c => c !== 'All')
              .map(c => c + ': ' + this.menuItems.filter(m => m.category === c).map(m => m.name + ' ' + P(m.price)).join(', '));
            const picks = this.menuItems.slice(0, 10).map(m => ({ label: m.name, act: 'pick:' + m.id }));
            return { text: 'Here\'s what we\'ve got — tap anything to order it.\n' + byCat.join('\n'), actions: picks.concat([{ label: 'Open the full menu', act: 'menu' }]) };
          }

          // fees, delivery, pick-up
          if (hit('pick up', 'pickup', 'take out', 'takeout', 'collect')) {
            return { text: 'Choose Pick-up in your cart and we\'ll have it waiting at ' + this.selectedBranch + '. Show the pickup code at the counter — it\'s usually ready in about fifteen minutes.', actions: [{ label: 'View cart', act: 'cart' }, { label: 'Change branch', act: 'branch' }] };
          }
          if (hit('deliver', 'how long', 'delivery time', 'eta')) {
            return { text: 'It\'s usually about thirty five minutes door to door, and you can watch your rider on the map once it\'s on the way.', actions: [{ label: 'Track it', act: 'track' }] };
          }

          // where you are, when you are open
          if (hit('branch', 'location', 'where are you', 'store', 'nearest', 'address of')) {
            return { text: 'We\'ve got ' + this.branches.length + ' branches — ' + this.branches.join(', ') + '. You\'re set to ' + this.selectedBranch + ' right now.', actions: [{ label: 'Change branch', act: 'branch' }] };
          }
          if (hit('open', 'close', 'hours', 'what time')) {
            return { text: 'Our hours: ' + this.businessHours + '.', actions: [{ label: 'Contact us', act: 'contact' }] };
          }

          // paying
          if (hit('pay', 'payment', 'gcash', 'maya', 'card', 'cash')) {
            const m = this.checkoutMethods.map(x => x.key === 'wallet' ? 'your Crazy Bite Wallet' : x.label);
            return { text: m.length ? 'You can pay with ' + m.join(', ').replace(/, ([^,]*)$/, ' or $1') + ' — it is paid online when you place the order, and your details are filled in for you.' + (this.walletOn ? ' Wallet payments go through instantly (your balance is ' + this.walletBalanceReadable + ').' : '') : 'Online payment is paused for a moment. Please try again shortly.', actions: [{ label: 'View cart', act: 'cart' }] };
          }

          // rewards
          if (hit('reward', 'tier', 'loyalty', 'discount', 'points', 'platinum', 'gold', 'silver', 'bronze')) {
            const next = this.nextTier ? ' ' + this.ordersToNext + ' more this month and you\'re ' + this.nextTier.name + '.' : ' You\'re at the top already.';
            const bpo = this.bpoRule.enabled ? ' BPO employees can also get ' + this.bpoWindowLabel + ' once their company ID is approved.' : '';
            return { text: 'You\'re ' + this.tier.name + ' with ' + this.ordersThisMonth + ' completed orders this month.' + next + ' Platinum gets you 20% off the food on every order.' + bpo + ' Discounts don\'t stack — the biggest one applies.', actions: [{ label: 'My rewards', act: 'rewards' }] };
          }

          // address
          if (hit('address', 'deliver to', 'change my address', 'pin', 'location of my house')) {
            return { text: 'In your cart, tap Deliver to and drag the map until the pin sits on your door. Add a unit, floor or landmark so your rider finds you.', actions: [{ label: 'Set my address', act: 'address' }] };
          }

          // cart and account
          if (hit('cart', 'basket', 'checkout')) {
            if (!this.cartCount) return { text: 'Your cart\'s empty at the moment.', actions: [{ label: 'See the menu', act: 'menu' }] };
            return { text: 'You\'ve got ' + this.cartCount + ' item' + (this.cartCount > 1 ? 's' : '') + ' in there, ' + P(this.cartSubtotal) + ' before fees.', actions: [{ label: 'View cart', act: 'cart' }] };
          }
          if (hit('promo', 'coupon', 'voucher', 'code')) {
            return { text: this.livePromos.length ? this.livePromos.map(p => p.title + (p.subtitle ? ' — ' + p.subtitle : '')).join('; ') + '. If you have a promo code, enter it in your cart and your total updates right away.' : 'If you have a promo code, enter it in your cart — your total updates right away. New codes show up in your notifications.', actions: [{ label: 'View cart', act: 'cart' }] };
          }
          if (hit('account', 'sign in', 'log in', 'login', 'password', 'my profile')) {
            return { text: this.isLoggedIn ? 'You\'re signed in as ' + this.user.name + '. Change your details, email or password in Settings, then Account — email and password changes are confirmed with a code.' : 'Open the Profile tab to sign in or create an account with your email.', actions: [{ label: 'Go to profile', act: 'rewards' }] };
          }

          // nothing matched — this is the one case the AI is asked about
          return {
            fallback: true,
            text: 'Hmm, I\'m not sure about that one. I can help with the menu and prices, where your order is, delivery and pick-up, your rewards, or I can just order for you.',
            actions: [{ label: 'See the menu', act: 'menu' }, { label: 'Call support', act: 'callsupport' }]
          };
        },

        // ---------- ordering inside the chat ----------
        // "two large spicy cheese burgers" is one sentence, not four questions:
        // whatever it can pick out is filled in, and only the gaps are asked about.
        chatParseOrder(lower) {
          const item = this.chatFindItem(lower);
          // sizes are the item's own (the one named now, or the one being ordered)
          const sizeItem = item || (this.chatFlow && this.chatFlow.item) || null;
          const names = sizeItem ? this.sizesOf(sizeItem).map(z => z.name) : ['Regular', 'Large', 'XL'];
          const has = (n) => names.find(x => x.toLowerCase() === n.toLowerCase()) || '';
          let size = names.slice().sort((a, b) => b.length - a.length).find(x => lower.includes(x.toLowerCase())) || '';
          if (!size && /\b(extra large|extra-large)\b/.test(lower)) size = has('XL');
          if (!size && /\b(big|bigger|upsize)\b/.test(lower)) size = has('Large') || (names.length > 1 ? names[names.length - 1] : '');
          if (!size && /\b(small|normal|standard)\b/.test(lower)) size = has('Regular') || (names.length > 1 ? names[0] : '');
          const flavour = item ? (item.flavours || []).find(f => lower.includes(f.toLowerCase())) || '' : '';
          const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, couple: 2, dozen: 12 };
          let qty = 0;
          const digits = lower.match(/\b(\d{1,2})\b/);
          if (digits) qty = parseInt(digits[1], 10);
          else {
            for (const w of Object.keys(words)) {
              if (new RegExp('\\b' + w + '\\b').test(lower)) { qty = words[w]; break; }
            }
          }
          if (!(qty >= 1 && qty <= 20)) qty = 0;
          return { item: item || null, size, flavour, qty };
        },

        chatStartOrder(seed) {
          const parsed = typeof seed === 'string' ? this.chatParseOrder(seed)
                       : (seed ? { item: seed, size: '', flavour: '', qty: 0 } : {});
          this.chatFlow = { step: '', item: parsed.item || null, size: parsed.size || '', flavour: parsed.flavour || '', qty: parsed.qty || 0 };
          return this.chatNextQuestion();
        },

        // Asks for the first thing still missing, and goes straight to the
        // confirmation when the sentence already said everything.
        chatNextQuestion() {
          const f = this.chatFlow;
          if (!f.item) {
            f.step = 'item';
            return { text: 'Sure — what are you after?', actions: this.menuItems.filter(m => !this.isSoldOut(m.id)).slice(0, 12).map(m => ({ label: m.name, act: 'pick:' + m.id })) };
          }
          if (this.isSoldOut(f.item.id)) {
            const gone = f.item;
            this.chatFlow = { step: 'item', item: null, size: '', flavour: '', qty: 0 };
            return { text: 'Sorry, ' + gone.name + ' is sold out right now. Want something else?', actions: this.menuItems.filter(m => !this.isSoldOut(m.id)).slice(0, 8).map(m => ({ label: m.name, act: 'pick:' + m.id })) };
          }
          if (f.size && this.unitPrice(f.item, f.size) == null) f.size = '';
          if (!f.size && this.sizesOf(f.item).length <= 1) f.size = this.defaultSize(f.item);
          if (!f.size) { f.step = 'size'; return this.chatAskSize(); }
          if (!f.flavour) {
            const flavours = f.item.flavours || [];
            if (!flavours.length) { f.flavour = 'Classic'; return this.chatNextQuestion(); }
            f.step = 'flavour';
            return { text: 'Which flavour?', actions: flavours.map(x => ({ label: x, act: 'flav:' + x })) };
          }
          if (!f.qty) { f.step = 'qty'; return this.chatAskQty(); }
          f.step = 'confirm';
          return this.chatConfirm();
        },

        chatAskSize() {
          const it = this.chatFlow.item;
          return { text: it.name + ' — which size?', actions: this.sizesOf(it).map(z => ({ label: z.name + ' ' + this.peso(z.price), act: 'size:' + z.name })) };
        },

        chatAskFlavour() {
          this.chatFlow.flavour = '';
          return this.chatNextQuestion();
        },

        chatAskQty() {
          return { text: 'How many?', actions: [1, 2, 3, 4].map(n => ({ label: String(n), act: 'qty:' + n })) };
        },

        chatConfirm() {
          const f = this.chatFlow;
          const unit = this.unitPrice(f.item, f.size);
          const bits = [this.sizesOf(f.item).length ? f.size : '', f.flavour].filter(Boolean).join(', ');
          return {
            text: f.qty + '× ' + f.item.name + (bits ? ' (' + bits + ')' : '') + ' — ' + this.peso((unit == null ? this.fromPrice(f.item) : unit) * f.qty) + '. Shall I add it?',
            actions: [{ label: 'Add to cart', act: 'flowadd' }, { label: 'Start over', act: 'flowcancel' }]
          };
        },

        chatFlowAdd() {
          const f = this.chatFlow;
          // the same path the product sheet uses, so pricing can't drift
          this.selectedItem = f.item;
          this.modalSize = f.size;
          this.modalFlavour = f.flavour;
          this.modalQty = f.qty || 1;
          if (!this.addToCart()) {
            this.chatFlow = { step: '', item: null, size: '', flavour: '', qty: 0 };
            return { text: 'I couldn\'t add that — ' + (this.isSoldOut(f.item.id) ? f.item.name + ' just sold out.' : 'you already have all we have left.'), actions: [{ label: 'See the menu', act: 'menu' }, { label: 'View cart', act: 'cart' }] };
          }
          this.chatLastPick = { item: f.item, size: f.size, flavour: f.flavour };
          // Stays open for the next item instead of ending — this is what makes
          // ordering out loud, one thing after another, work.
          this.chatFlow = { step: 'more', item: null, size: '', flavour: '', qty: 0 };
          const alsoPopular = this.menuItems.filter(m => m.popular && m.id !== f.item.id).slice(0, 2);
          return {
            text: 'Done — ' + (f.qty || 1) + '\u00d7 ' + f.item.name + ' added. That\'s ' + this.cartCount + ' item' + (this.cartCount > 1 ? 's' : '') + ' now, ' + this.peso(this.cartSubtotal) + ' before fees. Anything else?',
            actions: alsoPopular.map(m => ({ label: m.name, act: 'pick:' + m.id })).concat([{ label: 'That is all', act: 'flowdone' }])
          };
        },

        chatFlowDone() {
          this.chatFlow = { step: '', item: null, size: '', flavour: '', qty: 0 };
          if (!this.cartCount) return { text: 'No worries — nothing in your cart.' };
          return {
            text: 'Nice — ' + this.cartCount + ' item' + (this.cartCount > 1 ? 's' : '') + ', ' + this.peso(this.cartSubtotal) + ' before fees. Check out whenever you\'re ready.',
            actions: [{ label: 'View cart', act: 'cart' }]
          };
        },

        chatFlowCancel() {
          this.chatFlow = { step: '', item: null, size: 'Regular', flavour: '', qty: 1 };
          return { text: 'No worries, cancelled. Ask me anything else.' };
        },

        chatFlowReply(text) {
          const lower = ' ' + String(text).toLowerCase().trim() + ' ';
          const f = this.chatFlow;
          if (/\b(cancel|stop|forget it)\b/.test(lower) || /never ?mind/.test(lower)) return this.chatFlowCancel();
          // "that is all" has to work mid-question too, not only when asked
          if (/(that is all|thats all|that's all|nothing else|no thanks|check ?out|i am done|im done)/.test(lower)) return this.chatFlowDone();

          // "Anything else?" — the answer can be no, yes, or simply the next order
          if (f.step === 'more') {
            if (/\b(no|nope|nothing|done|finished|pay)\b/.test(lower) || /(that is all|thats all|that's all|check ?out)/.test(lower)) return this.chatFlowDone();
            const next = this.chatParseOrder(lower);
            const repeat = /\b(another|same again|one more|same)\b/.test(lower);
            if (next.item || next.qty || repeat) {
              // "another one" means the same thing again, size and flavour included
              if (repeat && !next.item && this.chatLastPick) {
                next.item = this.chatLastPick.item;
                if (!next.size) next.size = this.chatLastPick.size;
                if (!next.flavour) next.flavour = this.chatLastPick.flavour;
                if (!next.qty) next.qty = 1;
              }
              this.chatFlow = { step: '', item: next.item || null, size: next.size || '', flavour: next.flavour || '', qty: next.qty || 0 };
              return this.chatNextQuestion();
            }
            if (/\b(yes|yeah|yep|sure|please)\b/.test(lower)) { this.chatFlow.step = 'item'; return this.chatNextQuestion(); }
            return this.chatFlowDone();
          }

          // Every answer is read in full and whatever it contains is kept, even
          // if it answers a different question than the one asked — "one" while
          // being asked the size is a quantity, not a lost message.
          const said = this.chatParseOrder(lower);
          if (['item', 'size', 'flavour', 'qty'].includes(f.step)) {
            if (said.item && !f.item) f.item = said.item;
            if (said.size) f.size = said.size;
            if (said.qty) f.qty = said.qty;
            let flavour = '';
            if (f.item) {
              flavour = (f.item.flavours || []).find(x => lower.includes(x.toLowerCase())) || '';
              if (flavour) f.flavour = flavour;
            }
            // Something was said that made sense, even if it answered a
            // different question or repeated what was already known.
            const nothingUnderstood = !(said.item || said.size || said.qty || flavour);
            const next = this.chatNextQuestion();
            // Don't repeat the same question word for word when nothing landed.
            if (nothingUnderstood) next.text = 'Sorry, I missed that — ' + next.text;
            return next;
          }
          if (f.step === 'confirm') {
            if (/\b(yes|yeah|yep|sure|ok|okay|add|sige|please|go ahead)\b/.test(lower)) return this.chatFlowAdd();
            if (/\b(no|nope|change|wait)\b/.test(lower)) return this.chatFlowCancel();
            return this.chatConfirm();
          }
          return this.chatFlowCancel();
        },

        // ---------- taps on the reply buttons ----------
        chatAction(a) {
          const act = (a && a.act) || '';
          const leave = (tab) => { this.showChat = false; stopSpeaking(); this.currentTab = tab; };
          if (act === 'menu') return leave('menu');
          if (act === 'orders') return leave('orders');
          if (act === 'rewards') return leave('profile');
          if (act === 'cart') { this.showChat = false; stopSpeaking(); this.viewCart(); return; }
          if (act === 'track') {
            this.showChat = false; stopSpeaking();
            if (this.orders.length) this.trackOrder(this.orders[0]); else this.currentTab = 'orders';
            return;
          }
          if (act === 'contact') { this.showChat = false; stopSpeaking(); this.currentTab = 'profile'; this.showContact = true; return; }
          if (act === 'callsupport') { this.startSupportCall(); return; }
          if (act === 'address') { this.showChat = false; stopSpeaking(); this.currentTab = 'cart'; this.openAddressPicker(); return; }
          if (act === 'branch') { this.showChat = false; stopSpeaking(); this.currentTab = 'home'; this.showLocationPicker = true; return; }

          // the guided flow — the tap is echoed as if it had been typed
          if (act === 'order') { this.chatPush('user', 'Order something'); this.chatSay(this.chatStartOrder(null)); return; }
          if (act.startsWith('pick:')) {
            const it = this.menuItems.find(m => String(m.id) === act.slice(5));
            if (!it) { this.chatSay({ text: 'That item is no longer on the menu.', actions: [{ label: 'See the menu', act: 'menu' }] }); return; }
            this.chatPush('user', it.name);
            if (this.isSoldOut(it.id)) { this.chatSay(this.chatStartOrder(it)); return; }
            this.chatFlow = { step: 'size', item: it, size: 'Regular', flavour: '', qty: 1 };
            this.chatSay(this.chatAskSize());
            return;
          }
          if (act.startsWith('size:')) {
            this.chatPush('user', act.slice(5));
            this.chatFlow.size = act.slice(5);
            this.chatFlow.step = 'flavour';
            this.chatSay(this.chatAskFlavour());
            return;
          }
          if (act.startsWith('flav:')) {
            this.chatPush('user', act.slice(5));
            this.chatFlow.flavour = act.slice(5);
            this.chatFlow.step = 'qty';
            this.chatSay(this.chatAskQty());
            return;
          }
          if (act.startsWith('qty:')) {
            this.chatPush('user', act.slice(4));
            this.chatFlow.qty = parseInt(act.slice(4), 10) || 1;
            this.chatFlow.step = 'confirm';
            this.chatSay(this.chatConfirm());
            return;
          }
          if (act === 'flowadd') { this.chatPush('user', 'Add to cart'); this.chatSay(this.chatFlowAdd()); return; }
          if (act === 'flowcancel') { this.chatPush('user', 'Start over'); this.chatSay(this.chatFlowCancel()); return; }
          if (act === 'flowdone') { this.chatPush('user', 'That is all'); this.chatSay(this.chatFlowDone()); return; }

          if (act === 'resume:continue') { this.chatPush('user', 'Continue'); this.chatSay({ text: 'Sure — go ahead.' }); return; }
          if (act === 'resume:restart') { this.chatPush('user', 'Start fresh'); this.chatClear(); return; }
          // an action the assistant does not know yet still does something useful
          this.chatSay({ text: 'Here is the menu to get you started.', actions: [{ label: 'Open the menu', act: 'menu' }] });
        },

        // ---------- voice + housekeeping ----------
        // Settings windows sit above the chat, so they step aside for it.
        chatFromSheet() {
          ['showHelp', 'showContact', 'showSettings'].forEach(k => { this[k] = false; });
          this.openChat();
        },

// @@ END VERBATIM

// @@ VERBATIM public/index.html:5287-5386 | Chat methods part 2: voice/mic toggles, idle reset, clear, save/restore
        chatToggleGender() {
          this.chatGender = this.chatGender === 'male' ? 'female' : 'male';
          window.cbVoiceGender = this.chatGender;
          try { localStorage.setItem('cb_chat_gender', this.chatGender); } catch (e) {}
          stopSpeaking(); chatVoice = pickChatVoice();
          this.showToast(this.chatGender === 'male' ? 'Male voice' : 'Female voice');
        },

        chatToggleSpeech() {
          this.chatSpeech = !this.chatSpeech;
          if (!this.chatSpeech) { stopSpeaking(); this.chatAfterSpeaking(); }   // no voice: the mic can reopen right away
          try { localStorage.setItem('cb_chat_voice', this.chatSpeech ? '1' : '0'); } catch (e) {}
        },

        chatToggleMic() {
          // Whatever is being said (a reply, the greeting, "welcome back") is
          // cut off first: a phone cannot listen while it is still talking,
          // which is why the mic heard nothing when a chat already had messages.
          const talking = isSpeaking();
          if (talking) stopSpeaking();
          if (!talking && (this.chatConvo || this.chatListening)) { this.chatStopListening(); return; }
          chatIdleSince = Date.now();
          this.chatLastActivity = Date.now();
          this.chatConvo = true;              // stays on until you tap it again
          this.chatSilence = 0;
          this.chatSpeech = true;             // a spoken conversation needs the replies out loud
          this.chatHeard = '';
          startListening(this, 0, false, talking ? MIC_AFTER_VOICE_MS : 0);
        },

        // Three quiet minutes (no message, no typing, nothing heard) and the
        // chat starts over — also the next time it opens after a long break.
        chatIdleCheck() {
          if (!this.chatLog.some(m => m.role === 'user')) return;
          if (this.chatTyping || isSpeaking()) { this.chatLastActivity = Date.now(); return; }
          if (Date.now() - this.chatLastActivity < CHAT_IDLE_MS) return;
          this.chatReset(true);
        },
        chatReset(idle) {
          stopListening();
          stopSpeaking();
          this.chatConvo = false;
          this.chatListening = false;
          this.chatSilence = 0;
          this.chatHeard = '';
          this.chatDraft = '';
          this.chatLog = [];
          this.chatFlow = { step: '', item: null, size: 'Regular', flavour: '', qty: 1 };
          this.chatResumePending = false;
          this.chatLastActivity = Date.now();
          try { localStorage.removeItem('cb_chat'); } catch (e) {}
          if (this.showChat) {
            // a fresh start, shown quietly rather than spoken out of nowhere
            this.chatPush('bot', CHAT_GREETING, [{ label: 'See the menu', act: 'menu' }, { label: 'Where is my order?', act: 'orders' }]);
            if (idle) this.showToast('Chat cleared after 3 minutes with no reply');
          }
        },

        chatStopListening() {
          this.chatConvo = false;
          this.chatListening = false;
          this.chatSilence = 0;
          stopListening();
        },

        chatClear() {
          stopSpeaking();
          this.chatLog = [];
          this.chatFlow = { step: '', item: null, size: 'Regular', flavour: '', qty: 1 };
          try { localStorage.removeItem('cb_chat'); } catch (e) {}
          this.openChat();
        },

        chatSave() {
          try {
            localStorage.setItem('cb_chat', JSON.stringify({ at: this.chatLastActivity || Date.now(), log: this.chatLog.slice(-40) }));
          } catch (e) {}
        },

        chatRestore() {
          try {
            const box = JSON.parse(localStorage.getItem('cb_chat') || 'null');
            // older saves had no time: treat them as stale, like anything over 3 minutes
            const saved = box && Array.isArray(box.log) && Date.now() - Number(box.at || 0) < CHAT_IDLE_MS ? box.log : null;
            if (!saved) { localStorage.removeItem('cb_chat'); return; }
            // Rebuilt field by field: whatever is in storage is treated as
            // data, and it is rendered as text, never as markup.
            this.chatLog = saved.filter(m => m && typeof m.text === 'string').slice(-40).map((m, i) => ({
              id: i + 1,
              role: m.role === 'user' ? 'user' : 'bot',
              text: String(m.text).slice(0, 1200),
              actions: Array.isArray(m.actions) ? m.actions.filter(a => a && typeof a.label === 'string' && typeof a.act === 'string').slice(0, 8) : []
            }));
            this.chatSeq = this.chatLog.length;
            // A conversation carried over from a previous visit — offer to
            // pick it back up the next time the chat is opened.
            this.chatResumePending = this.chatLog.length > 0;
            this.chatLastActivity = Number(box.at) || Date.now();
          } catch (e) {}
        },
// @@ END VERBATIM

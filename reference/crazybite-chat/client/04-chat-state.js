// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/index.html:4162-4179 | Alpine state fields for the chat
        // ---- smart chat ----
        showChat: false,
        chatExpanded: false,           // docked above the nav, or covering it
        chatLog: [],
        chatDraft: '',
        chatTyping: false,
        chatSpeech: true,
        chatGender: 'male',
        chatListening: false,
        chatConvo: false,              // hands-free: the mic reopens after each reply
        chatSilence: 0,
        chatHeard: '',
        chatLastActivity: Date.now(),  // last message, keystroke or word heard; 3 quiet minutes clear the chat
        chatSeq: 0,
        chatFlow: { step: '', item: null, size: 'Regular', flavour: '', qty: 1 },
        chatSuggestions: ['See the menu', 'Where is my order?', 'How much is delivery?', 'Order a burger', 'My rewards'],
        chatLastPick: null,            // so "another one" repeats the whole choice
        chatResumePending: false,      // set by chatRestore when there's a conversation to pick back up
// @@ END VERBATIM

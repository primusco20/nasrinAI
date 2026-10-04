// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/owner.html:3594-3594 | Legacy chatApiUrl default (not wired to anything)
          chatApiUrl: '',
// @@ END VERBATIM

// @@ VERBATIM public/owner.html:3723-3723 | Legacy chatApiUrl field (not wired to anything)
          { key: 'chatApiUrl', label: 'Smart chat AI endpoint', hint: 'https://your-server/api/ai-chat — leave empty to use the built-in assistant' },
// @@ END VERBATIM

// @@ VERBATIM public/owner.html:6571-6571 | Load: settings -> draft
              chat: { multilang: st.chat_multilang_enabled === true },
// @@ END VERBATIM

// @@ VERBATIM public/owner.html:6950-6950 | Save: draft -> store_settings
            ...(('chat_multilang_enabled' in st) ? { chat_multilang_enabled: !!(d.chat && d.chat.multilang) } : {}),
// @@ END VERBATIM

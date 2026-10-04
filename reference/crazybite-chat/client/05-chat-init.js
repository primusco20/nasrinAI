// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/index.html:4554-4566 | Init: restore chat, voice prefs, idle timer, watchers
          this.chatRestore();
          try { this.chatSpeech = localStorage.getItem('cb_chat_voice') !== '0'; } catch (e) {}
          try { this.chatGender = localStorage.getItem('cb_chat_gender') === 'female' ? 'female' : 'male'; } catch (e) {}
          window.cbVoiceGender = this.chatGender;
          // A chat nobody has answered for 3 minutes starts over.
          this.$watch('chatDraft', v => { if (v) this.chatLastActivity = Date.now(); });
          this.$watch('chatHeard', v => { if (v) this.chatLastActivity = Date.now(); });
          setInterval(() => this.chatIdleCheck(), 10000);
          this.$watch('showChat', v => {
            if (v) { this.resetDrag(); return; }
            stopSpeaking();
            this.chatStopListening();          // also switches conversation mode off
          });
// @@ END VERBATIM

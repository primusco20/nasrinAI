// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM public/index.html:5221-5286 | Live support call methods (the "callsupport" chat action hands off here)
        startSupportCall() {
          if (this.callState === 'dialing' || this.callState === 'connected') { this.callMinimized = false; return; }
          stopSpeaking();
          this.showChat = false;
          this.showContact = false;
          this.callError = '';
          this.callMuted = false;
          this.callMinimized = false;
          this.callSeconds = 0;
          this.callTarget = this.selectedBranch || 'Crazy Bite';
          this.callState = 'dialing';
          this.callNeedsTap = false; this.callWarn = '';
          CallMedia.unlock(document.getElementById('supportAudio'));     // inside the tap: the voice can play later
          placeSupportCall(this);
        },

        // The branch the customer has picked is rung first; if nobody there is
        // taking calls, the main support desk is tried next.
        callDesks() {
          const branch = this.branchList.find(b => b.name === this.selectedBranch);
          const list = [];
          if (branch) {
            const desk = SUPPORT_DESKS.find(d => d.branch_id === branch.id);
            list.push({ id: desk ? desk.peer_id : supportDeskId(SUPPORT_PEER_ID, branch.id), label: branch.name });
          }
          list.push({ id: SUPPORT_PEER_ID, label: 'Crazy Bite support' });
          return list;
        },

        async callTapToHear() {
          const a = document.getElementById('supportAudio');
          try { if (CallMedia.ctx && CallMedia.ctx.state === 'suspended') CallMedia.ctx.resume(); } catch (e) {}
          a.muted = false;
          this.callNeedsTap = false;
          if (!(await CallMedia.play(a))) { this.callNeedsTap = true; this.showToast('Turn the volume up and tap again'); }
        },

        endSupportCall() {
          const wasTalking = this.callState === 'connected';
          callTeardown();
          this.callMinimized = false;
          this.callState = wasTalking ? 'ended' : '';
          if (wasTalking) setTimeout(() => { if (this.callState === 'ended') this.callState = ''; }, 1400);
        },

        async toggleCallSpeaker() {
          this.callSpeaker = !this.callSpeaker;
          const how = await CallAudio.apply(document.getElementById('supportAudio'), this.callSpeaker);
          if (how === 'fixed') this.showToast('This phone picks the speaker itself — use the volume buttons');
          else this.showToast(this.callSpeaker ? 'Loudspeaker' : 'Earpiece — hold the phone to your ear');
        },

        toggleCallMute() {
          this.callMuted = !this.callMuted;
          try { if (callStream) callStream.getAudioTracks().forEach(t => { t.enabled = !this.callMuted; }); } catch (e) {}
        },

        get callClock() {
          const s = this.callSeconds;
          return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        },

        get callHeadline() {
          return { dialing: 'Calling ' + (this.callTarget || 'the support desk') + '…', connected: 'Connected to ' + (this.callTarget || 'support'), ended: 'Call ended', failed: 'Call not connected' }[this.callState] || '';
        },

// @@ END VERBATIM

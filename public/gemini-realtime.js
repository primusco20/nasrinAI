// Browser-side Gemini Live transport. Uses a server-minted ephemeral token.
// Audio in: PCM16 mono 16kHz. Audio out: PCM16 mono 24kHz.
(() => {
  'use strict';
  const b64bytes = (s) => { const b = atob(s), out = new Uint8Array(b.length); for (let i=0;i<b.length;i++) out[i]=b.charCodeAt(i); return out; };
  const b64 = (bytes) => { let s=''; for(let i=0;i<bytes.length;i+=0x8000) s += String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length))); return btoa(s); };
  const downsample = (input, rate) => {
    const ratio=rate/16000, n=Math.max(1,Math.floor(input.length/ratio)), out=new Int16Array(n);
    for(let i=0;i<n;i++){const v=Math.max(-1,Math.min(1,input[Math.min(input.length-1,Math.floor(i*ratio))]));out[i]=v<0?v*32768:v*32767;}
    return new Uint8Array(out.buffer);
  };
  const play = (state, data) => {
    if(!state.ctx||!data)return;
    const bytes=b64bytes(data), n=Math.floor(bytes.byteLength/2), view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), f=new Float32Array(n);
    for(let i=0;i<n;i++)f[i]=view.getInt16(i*2,true)/32768;
    const buf=state.ctx.createBuffer(1,n,24000);buf.copyToChannel(f,0);
    const src=state.ctx.createBufferSource();src.buffer=buf;src.connect(state.ctx.destination);
    const now=state.ctx.currentTime;state.next=Math.max(state.next||now,now+0.02);src.start(state.next);state.next+=buf.duration;state.sources.push(src);
    src.onended=()=>{const i=state.sources.indexOf(src);if(i>=0)state.sources.splice(i,1);};
  };
  const stop = (state) => { for(const s of state.sources.splice(0)){try{s.stop();}catch{}try{s.disconnect();}catch{}} if(state.ctx)state.next=state.ctx.currentTime; };
  window.NasrinGeminiRealtime = {
    async start(session, hooks) {
      if(!window.WebSocket||!window.AudioContext||!navigator.mediaDevices?.getUserMedia) throw new Error('Gemini realtime voice is not supported in this browser.');
      const state={ws:null,ctx:null,processor:null,stream:null,sources:[],next:0,buffer:[]};
      const ws=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='+encodeURIComponent(session.value));
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
      const ctx=new AudioContext();await ctx.resume();
      const processor=ctx.createScriptProcessor(4096,1,1),source=ctx.createMediaStreamSource(stream);
      Object.assign(state,{ws,ctx,processor,stream}); hooks.state(state);
      const flush=()=>{if(ws.readyState!==WebSocket.OPEN||!state.buffer.length)return;let n=0;for(const x of state.buffer)n+=x.length;const m=new Uint8Array(n);let o=0;for(const x of state.buffer){m.set(x,o);o+=x.length;}state.buffer=[];ws.send(JSON.stringify({realtimeInput:{audio:{data:b64(m),mimeType:'audio/pcm;rate=16000'}}}));};
      processor.onaudioprocess=e=>{if(!hooks.active()||hooks.muted())return;state.buffer.push(downsample(e.inputBuffer.getChannelData(0),ctx.sampleRate));let n=0;for(const x of state.buffer)n+=x.length;if(n>=1600)flush();};
      source.connect(processor);processor.connect(ctx.destination);
      ws.onopen=()=>{ws.send(JSON.stringify({setup:{model:'models/'+session.model,generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:session.gemini_voice||'Kore'}}}},inputAudioTranscription:{},outputAudioTranscription:{},sessionResumption:{},systemInstruction:{parts:[{text:session.instructions||'You are NasrinAI. Be natural, concise, accurate, and interruptible.'}]}}}));hooks.open();};
      ws.onmessage=e=>{let msg;try{msg=JSON.parse(e.data);}catch{return;}const c=msg.serverContent;if(!c)return;if(c.inputTranscription?.text)hooks.input(c.inputTranscription.text);if(c.outputTranscription?.text)hooks.output(c.outputTranscription.text);if(c.modelTurn?.parts)for(const p of c.modelTurn.parts)if(p.inlineData?.data)play(state,p.inlineData.data);if(c.interrupted){stop(state);hooks.interrupted();}if(c.turnComplete)hooks.complete();};
      ws.onerror=()=>hooks.error(); ws.onclose=()=>hooks.close();
      return state;
    },
    stop
  };
})();
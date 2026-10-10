// Shared creative-intent detection for the browser app and regression tests.
(() => {
  'use strict';

  const informational = /^(how|what|why|when|where|who|can you explain|tell me about|define)\b/i;
  const action = /\b(create|generate|make|design|draw|render|produce|animate|build|turn|need|want)\b/i;
  const imageTarget = /\b(image|images|picture|pictures|photo|photos|photograph|photographs|portrait|poster|thumbnail|logo|illustration|artwork|graphic|visual|banner|cover|wallpaper|icon)\b/i;
  const videoTarget = /\b(video|videos|clip|clips|short film|reel|reels|advertisement|commercial|promo|promotional video|video ad)\b/i;

  function detect(text) {
    const s = String(text || '').trim().toLowerCase();
    if (!s || informational.test(s)) return null;

    // "Turn this picture into a video" is a video request even though it names
    // the source image. A thumbnail/poster/cover is still an image deliverable.
    if (/\b(turn|animate|convert|make)\b[\s\S]*\b(into|as)\b[\s\S]*\b(video|clip|reel)\b/.test(s)) return 'video';
    if (imageTarget.test(s) && /\b(video thumbnail|thumbnail|poster|cover|banner|logo|icon|wallpaper|photo|photograph|picture|image)\b/.test(s)
        && action.test(s)) return 'image';

    const hasAction = action.test(s) || /\b(i'd like|i would like|can you|could you|please)\b/.test(s);
    if (!hasAction) return null;
    if (videoTarget.test(s)) return 'video';
    if (imageTarget.test(s)) return 'image';
    return null;
  }

  globalThis.NasrinCreativeIntent = Object.freeze({ detect });
})();

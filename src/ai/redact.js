// Removes contact and payment details from text before it is sent to a model
// outside the server (audit finding M3). The conversation stored for the user
// keeps their original words; only the copy sent out is changed.

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Philippine mobile numbers: 09xx xxx xxxx, +63 9xx xxx xxxx, 639xxxxxxxxx
const PH_MOBILE = /(?<![\d+])(?:\+?63|0)9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
// Other international numbers written with a leading +
const INTL_PHONE = /(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/g;
// 13 to 19 digits, optionally grouped by spaces or dashes
const CARD_LIKE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

function luhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactForProvider(text) {
  return String(text)
    .replace(CARD_LIKE, (m) => (luhn(m.replace(/\D/g, '')) ? '[card number]' : m))
    .replace(EMAIL, '[email]')
    .replace(PH_MOBILE, '[phone]')
    .replace(INTL_PHONE, '[phone]');
}

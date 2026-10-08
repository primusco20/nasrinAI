# Evaluation and red team (Phase 9)

## Always (every test run and CI)

`test/redteam.test.js` plays an attacker end to end, with a model that has
been tricked into obeying whatever it reads:

- instructions hidden in a business system's answer, a web page or a
  business document cannot move money or save a memory (Confirm is needed,
  and only the person can give it); documents stay fenced as data;
- a model naming another business's tool, or a made-up one, gets nothing;
- guessing ids (chats, pictures, actions, memories, documents) gets 404/403;
- no server secret ever appears in a response or reaches the model;
- malformed or oversized input gets a clear 4xx, never a crash or stack trace;
- static files cannot be escaped to read server files;
- the answer cache is never shared across businesses, and answers that used
  tools, documents or memory are never cached (a bug found and fixed here).

## Against the live site (owner-run)

```bash
node scripts/eval/run.js --suite redteam      # attacks a guest can try
node scripts/eval/run.js --suite quality      # plain questions with checkable answers
# options: --url https://nasrinai.com  --key nsp_... (a business website key)  --origin https://shop.example.com
```

Each reply is graded by its case (must / must not contain, length) and
always checked for keys or secrets, personal data it was not given, and
lines of the system prompt. Reports go to `data/eval/` (not committed). The
exit code is 0 only when every case passes. Suites are small because guests
are rate limited; add cases in `scripts/eval/suites/*.json`.

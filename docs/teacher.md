# Teacher / dataset pipeline (Phase 8)

Builds training data for NasrinAI's own model from a stronger "teacher"
model, with a person approving every example. Owner-run (or run by Claude
Code for you), offline; not part of the website.

**No customer data.** Nothing reads conversations. Seeds with emails, phone
or card numbers, keys or passwords are refused, so are answers containing
them, and every dataset manifest says `customer_data: false`. Using real
conversations would need the people's explicit permission and a separate,
reviewed change.

## Steps

```bash
# 1. Write seeds: one JSON per line, your own questions (no personal data)
#    {"id": "budget-1", "prompt": "How do I make a simple monthly budget?", "tags": ["money"]}
#    saved as data/teacher/seeds.jsonl

# 2. The teacher answers (OPENAI_API_KEY in the environment; stops at --max-usd)
node scripts/teacher/cli.js generate --seeds data/teacher/seeds.jsonl --model <teacher model id>

# 3. Rules: length, refusals, personal details, secrets, repeated prompts
node scripts/teacher/cli.js filter

# 4. A person reads and decides (decisions are appended, never edited)
node scripts/teacher/cli.js review --list
node scripts/teacher/cli.js review --reviewer <your name> --approve id1,id2 --reject id3

# 5. A new numbered dataset (v1, v2, ...; never overwritten)
node scripts/teacher/cli.js build --name nasrin-sft

# 6. Score a model on the held-out part (about 10%, fixed by id)
node scripts/teacher/cli.js eval --dataset datasets/nasrin-sft/v1 --provider local --model <local model> [--judge <openai model>]
```

The teacher model id must have a price in `config/model-prices.json` (or
`MODEL_PRICES_JSON`); an unknown price stops the run. `data/` and
`datasets/` are not committed.

Each dataset folder has `train.jsonl` and `eval.jsonl` (chat format:
`{"messages": [{"role": "user", ...}, {"role": "assistant", ...}]}`) and
`manifest.json` (counts, file hashes, teacher models, reviewers, filter
version, seeds hash, `customer_data: false`). Training the local model with
`train.jsonl` happens in the training tool you choose; compare `eval`
reports before and after to see whether it improved.

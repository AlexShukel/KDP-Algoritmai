# KDP-Algoritmai

## Būtinos sąlygos

Prieš pradedant, įsitikinkite, kad jūsų sistemoje įdiegtos šios versijos:

- **node**: `~24.11.0`
- **pnpm**: `~10.20.0`
- **Latest rust**

## Paleidimo instrukcijos

- `git clone https://github.com/AlexShukel/KDP-Algoritmai.git`
- `cd KDP-Algoritmai`
- `cd crates/napi-bridge`
- `pnpm i && pnpm build`
- `cd ../.. && pnpm i`
- Unzip `./sample_problems.zip` to `./problems` dir
- `pnpm start`

## p-SA parity benchmark (JS oracle vs Rust port)

The bachelor's-thesis Phase 1.1 (PLAN.md) calls for a distributional-parity
check between the original NodeJS p-SA and the new Rust p-SA. The harness
already runs every registered algorithm × every problem × 3 objectives ×
`HEURISTIC_REPETITIONS` reps, so producing the two result files is just
`pnpm start`.

1. **Smoke check the Rust solver is reachable** (a few seconds):
   `pnpm parity:smoke`
2. **Run the full benchmark** (slow — hours on the 490-problem set):
   `pnpm start`
   This writes `dist/benchmark-results-p-sa-js.json` and
   `dist/benchmark-results-p-sa-rust.json`.
3. **Generate the parity report**:
   `pnpm parity:compare dist/benchmark-results-p-sa-js.json dist/benchmark-results-p-sa-rust.json --out parity-report.md`

The report shows per-objective mean RPD (paired against the better of the
two implementations), per-(size, objective) breakdowns, and the runtime
speedup of the Rust port.

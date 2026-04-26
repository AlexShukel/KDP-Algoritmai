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

## Long-running benchmarks

See [BENCHMARKS.md](./BENCHMARKS.md) for full step-by-step instructions on
running the p-SA parity benchmark, generating problem instances at small
and large scales, and the runtime expectations for each.

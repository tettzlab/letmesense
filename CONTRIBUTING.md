# Contributing to letmesense

Thanks for your interest in contributing! This guide will help you get started.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Getting Started

### Prerequisites

- **Node.js** >= 24
- **pnpm** >= 10.27
- **System libraries** (Linux): `libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`

### Setup

```bash
git clone https://github.com/tettzlab/letmesense.git
cd letmesense
pnpm install
```

### Verify your setup

```bash
pnpm validate        # typecheck + lint + tests
```

## Development Workflow

1. **Fork** the repository and create a branch from `main`.
2. **Make your changes** — keep commits focused and atomic.
3. **Run validation** before pushing:
   ```bash
   pnpm validate      # typecheck + lint + test (fast)
   pnpm validate:full # includes CLI and vision tests
   ```
4. **Open a pull request** against `main`.

### Useful Commands

```bash
pnpm typecheck       # TypeScript type checking only
pnpm lint            # Biome linter
pnpm lint:fix        # Auto-fix lint issues
pnpm test            # Fast tests (excludes CLI/vision)
pnpm test:full       # All tests (requires LibreOffice + API keys)
pnpm build           # Compile to dist/
```

## Code Style

- **Formatter/linter**: [Biome](https://biomejs.dev/) — run `pnpm lint:fix` before committing.
- 2-space indent, single quotes, semicolons as needed, trailing commas, 100 char line width.
- ESM only — all imports use `.js` extensions.
- Strict TypeScript: no unused locals/parameters, no implicit returns.

## Testing

- We use [Vitest](https://vitest.dev/) with `globals: true` (no need to import `describe`/`it`/`expect`).
- Tests use inline data and mock helpers — no fixture files.
- Run a single test file: `pnpm test lib/pdf/classify.test.ts`
- Coverage thresholds: 60% lines, 60% functions, 50% branches, 60% statements.

## Pull Request Guidelines

- Keep PRs small and focused on a single change.
- Include a clear description of **what** and **why**.
- Add or update tests for new functionality or bug fixes.
- Make sure CI passes (`pnpm validate`).
- Reference related issues with `Fixes #123` or `Closes #123`.

## Reporting Bugs

Open an [issue](https://github.com/tettzlab/letmesense/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant logs or error output

## Requesting Features

Open an [issue](https://github.com/tettzlab/letmesense/issues) describing:

- The problem you're trying to solve
- Your proposed solution (if any)
- Alternatives you've considered

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for an overview of the codebase, pipeline flow, and plugin system.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).

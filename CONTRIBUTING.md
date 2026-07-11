# Contributing to Nexa

Thanks for helping improve Nexa.

## Development Setup

```bash
npm install
npm run dev
```

For browser-only development:

```bash
npm run dev:bridge
npm run dev:renderer
```

## Useful Commands

```bash
npm run build:main
npm run build:renderer
npm run build
npm run pack
```

## Repository Guidelines

- Keep secrets out of the repository. Never commit API keys, `.env` files, packaged apps, logs, or local runtime state.
- Prefer TypeScript source files under `src/`. Do not commit generated JavaScript files from local builds.
- Keep UI changes consistent with the existing lightweight desktop app style.
- Keep agent runtime changes focused: agent loop, tools, context, and UI state should remain separated.
- Document non-trivial agent-loop, context, or tool changes in `docs/`.

## Pull Request Checklist

- Explain the user-facing behavior change.
- Mention any new tool, setting, IPC channel, or storage key.
- Include manual verification steps.
- Update README or docs when behavior changes.
- Avoid unrelated formatting churn.

## Local Storage Notes

Nexa stores local application data under `.nexa` paths and browser localStorage keys prefixed with `nexa.`. These are runtime state, not source artifacts.

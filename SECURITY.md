# Security Policy

## Reporting Security Issues

Please report security issues privately through the repository owner or maintainer contact listed on GitHub. Do not open a public issue for secrets, arbitrary command execution risks, or credential handling problems.

## Secret Handling

Nexa can store model API keys locally. Contributors must not commit:

- API keys
- `.env` files
- local databases
- transcripts containing secrets
- packaged apps containing local state

## Local Tool Execution

Nexa includes tools that can read files, write files, apply patches, run shell commands, and open web pages. Treat tool permissions carefully when changing the agent loop or adding new tools.

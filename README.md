# AMC Assistant

A full-stack movie showtime app with a live AI assistant integration — built to answer "what's
playing tonight?" with real, current data instead of guesses.

**Live app:** https://amc-assistant.vercel.app

## What this project demonstrates

- **Full-stack web development** — TypeScript, React, Next.js, Node.js
- **AI / LLM integration** — a Model Context Protocol (MCP) server that lets AI assistants like
  Claude pull real-time, factual data instead of hallucinating, with OAuth 2.0 authentication
- **API design** — public REST endpoints, rate limiting, caching, geolocation search across 500+
  locations nationwide
- **Database & security** — PostgreSQL (Supabase), Row-Level Security, authentication,
  invite-gated signup
- **Cloud deployment & CI/CD** — deployed on Vercel, automated linting/type-checking/testing on
  every push via GitHub Actions
- **Automated testing** — 240+ unit and integration tests
- **Third-party API integration** — live theatre data, Telegram bot notifications

## Tech stack

TypeScript, React, Next.js, Node.js, PostgreSQL, Supabase, Model Context Protocol (MCP),
OAuth 2.0, Vercel, GitHub Actions, Vitest

## How it started

The first version was a single-user Python/Flask prototype. It was rebuilt as a production,
multi-user web application — the original Python files are kept in this repo for reference.
Setup and deployment details are in [web/README.md](web/README.md).

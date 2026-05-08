# EU Figma Layout Translation App

Internal tool for translating US Figma layouts into German, French, Italian, and Spanish variants with an approved terminology library.

## What Is Included

- `apps/web`: Next.js app with a Home page for source input/translation generation and a Library page for saved categorized translation.
- `apps/figma-plugin`: Figma plugin that captures selected frames and applies approved jobs by duplicating localized frames.
- `packages/shared`: shared TypeScript contracts and validation utilities for locales, translation, Figma text nodes, warnings, and translation jobs.
- `supabase/001_initial_schema.sql`: Postgres/Supabase-style schema for projects, URL/PDF/Word sources, categorized translation, evidence, jobs, text nodes, translations, and warnings.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the web app at `http://localhost:3000`.

## Environment

- `OPENAI_API_KEY`: optional env fallback for AI translation extraction through the OpenAI Responses API. You can also enter a runtime key in `Setting`.
- `OPENAI_MODEL`: model string used for extraction and translation. Defaults to `gpt-4.1`.
- `OPENAI_VECTOR_STORE_ID`: attaches uploaded PDFs to an OpenAI vector store for File Search retrieval.
- `FIGMA_ACCESS_TOKEN`: reserved for link-based Figma read access.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: reserved for replacing the in-memory store with Supabase.
- **App version** (top bar): the dev server calls GitHub to compare your local `git` HEAD with `main` on the configured repo (defaults to this project’s public repo). Requires network access and a normal git clone (with a `.git` folder). After `git pull`, focus the browser tab or wait a few minutes for the check to refresh. Optional: `GITHUB_REPO=owner/name`, `NEXT_PUBLIC_APP_GIT_SHA` when `.git` is not present.

Without an OpenAI key in `Setting` or `.env`, source translation generation is blocked.

## Home And Library

Home is where users enter a product URL or upload a PDF/Word file. AI generates translation first, and the translation is only stored after the user clicks `Save to Library`.

Library is the saved terminology table. Users do not enter a project ID; the MVP uses one internal team library by default.

Setting lets users enter a runtime OpenAI API key. The key is used by the server process and is not returned to the browser after saving.

Supported source inputs:

- Product website URL, for example `https://de.eureka.com/products/eureka-j15-max-ultra`
- Optional localized product URLs for DE/FR/IT/ES when `Automatically sync translations from different language source` is enabled
- PDF upload
- Word upload: `.doc` or `.docx`

AI extraction categorizes translation into:

- Product Names
- Features
- Specific Feature Naming
- Specifications
- Specification Titles
- Accessories
- Descriptions

Each saved translation keeps the source text, DE/FR/IT/ES translations, confidence, and evidence snippet.

## Figma Plugin

Build the plugin:

```bash
npm run plugin:build
```

In Figma, import `apps/figma-plugin/dist/manifest.json`.

Workflow:

1. Select the US source frame in Figma.
2. Click `Capture selected frame` in the plugin and copy the frame JSON into the web app API/client flow.
3. Generate and review the translation job in the web app.
4. Paste the approved job JSON back into the plugin.
5. Click `Apply approved job`; the plugin creates `DE`, `FR`, `IT`, and `ES` frame copies.

## API Endpoints

- `GET /api/projects`: list projects.
- `POST /api/projects`: create or update a project.
- `POST /api/sources`: ingest a website URL JSON body, optional localized URL map, or a multipart PDF/Word upload and return generated translation without saving it.
- `GET /api/settings/openai`: return OpenAI key configured status without exposing the key.
- `POST /api/settings/openai`: save a runtime OpenAI API key.
- `DELETE /api/settings/openai`: clear the runtime OpenAI API key.
- `GET /api/library`: list saved Library translation.
- `POST /api/library`: save generated translation into the Library.
- `POST /api/figma/parse-link`: parse file key and node ID from a Figma frame URL.
- `POST /api/translation-jobs`: create a review-required translation job from a frame snapshot.

## Verification

```bash
npm run test
npm run typecheck
npm run build
```

The initial tests cover Figma URL parsing, locale output validation, approved glossary matching, and spec preservation warnings.

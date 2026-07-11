# Deploying gMAS to Hugging Face Spaces

## Quick Start

1. **Create a new Space on HF**:
   - Go to https://huggingface.co/spaces
   - Click "Create new Space"
   - Name: `gmas-demo` (or similar)
   - Space type: **Docker**
   - Visibility: Public
   - Create

2. **Clone the Space repo**:
   ```bash
   git clone https://huggingface.co/spaces/<your-username>/gmas-demo
   cd gmas-demo
   ```

3. **Copy files from this repo**:
   ```bash
   # From the gMAS root directory:
   cp Dockerfile hf_space/
   cp docker-compose.yml hf_space/
   cp -r apps/ hf_space/
   cp -r src/ hf_space/
   cp pyproject.toml hf_space/
   cp .dockerignore hf_space/
   ```

4. **Create README.md** (HF will display this):
   ```markdown
   # gMAS — Graph Multi-Agent System Demo
   
   A dynamic graph-based multi-agent system framework with a browser-based UI.
   
   ## Features
   - Visual graph editor for designing agent systems
   - Real-time execution monitoring
   - Web UI on React 19 + Tailwind
   - FastAPI backend with WebSocket streaming
   
   ## Setup
   
   Set environment variables in HF Spaces settings:
   - `OPENAI_API_KEY` — for OpenAI models
   - `ANTHROPIC_API_KEY` — for Claude
   
   The demo will auto-start on port 7860.
   
   ## Local Development
   
   ```bash
   ./scripts/dev-up.sh
   # API: http://localhost:8000
   # Web: http://localhost:3000
   ```
   ```

5. **Push to HF**:
   ```bash
   cd hf_space
   git add -A
   git commit -m "Initial gMAS demo setup"
   git push
   ```

6. **Set secrets in HF Spaces UI**:
   - Go to Space settings → "Repository secrets"
   - Add `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`
   - HF will inject them as env vars automatically

## Environment Variables

- `OPENAI_API_KEY` — OpenAI API key (optional)
- `ANTHROPIC_API_KEY` — Anthropic (Claude) API key (optional)
- `GMAS_DATA_DIR` — Data directory (default: `/app/apps/api/data`)
- `GMAS_GMAS_SRC_PATH` — Path to src/ (default: `/app/src`)

## Ports

- **7860** — Main app (nginx reverse proxy)
- **8000** — FastAPI backend (internal)
- **3000+** — Frontend dev (not exposed in production)

## Troubleshooting

**"Virtual environment" error in publish:**
- Make sure `.venv` is in `.gitignore` and `.dockerignore`

**Timeout on install:**
- Dockerfile uses `pip install ".[webui]"` which only installs webui extras
- Full `--all-extras` is too heavy for HF Spaces resources

**API not responding:**
- Check FastAPI logs: `docker logs <container>`
- Ensure `GMAS_GMAS_SRC_PATH` points to correct src/ location

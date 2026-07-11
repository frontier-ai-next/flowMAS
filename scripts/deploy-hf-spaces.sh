#!/bin/bash
set -e

# Deploy gMAS to Hugging Face Spaces
# Usage: ./scripts/deploy-hf-spaces.sh <hf-username> <space-name>

if [ $# -lt 2 ]; then
    echo "Usage: $0 <hf-username> <space-name>"
    echo "Example: $0 myusername gmas-demo"
    exit 1
fi

HF_USERNAME=$1
SPACE_NAME=$2
REPO_URL="https://huggingface.co/spaces/$HF_USERNAME/$SPACE_NAME"
WORK_DIR="/tmp/gmas-hf-deploy"

echo "🚀 Deploying gMAS to HF Spaces"
echo "   URL: $REPO_URL"
echo ""

# Clone HF Space repo
if [ -d "$WORK_DIR" ]; then
    echo "📁 Updating existing checkout..."
    cd "$WORK_DIR"
    git pull
else
    echo "📥 Cloning HF Space repo..."
    git clone "$REPO_URL" "$WORK_DIR"
    cd "$WORK_DIR"
fi

# Copy files from gMAS repo
GMAS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "📋 Copying gMAS files..."
cp "$GMAS_ROOT/Dockerfile" .
cp "$GMAS_ROOT/docker-compose.yml" .
cp "$GMAS_ROOT/.dockerignore" .
cp "$GMAS_ROOT/pyproject.toml" .
cp -r "$GMAS_ROOT/apps" .
cp -r "$GMAS_ROOT/src" .

# Create README if not exists
if [ ! -f "README.md" ]; then
    cat > README.md <<'EOF'
# gMAS — Graph Multi-Agent System Demo

A dynamic graph-based multi-agent system framework with a browser-based UI.

## Features
- Visual graph editor for designing agent systems
- Real-time execution monitoring
- Web UI on React 19 + Tailwind
- FastAPI backend with WebSocket streaming

## Setup

Set environment variables in **Space settings → Repository secrets**:
- `OPENAI_API_KEY` — for OpenAI models
- `ANTHROPIC_API_KEY` — for Claude

The demo will auto-start on port 7860.

## How to Use

1. Create agents in the **Design** tab
2. Configure LLM providers in **Configure**
3. Run executions in **Run**
4. View history and metrics in **Observe**

## Local Development

```bash
./scripts/dev-up.sh
# API: http://localhost:8000
# Web: http://localhost:3000
```
EOF
fi

echo "✅ Files copied"
echo ""
echo "📝 Staging changes..."
git add -A

echo "💾 Committing..."
git commit -m "Update gMAS demo from upstream" --allow-empty

echo "🚀 Pushing to HF Spaces..."
git push

echo ""
echo "✨ Done! Your Space is updating at: $REPO_URL"
echo ""
echo "📌 Don't forget to set secrets:"
echo "   - Go to Space settings → Repository secrets"
echo "   - Add OPENAI_API_KEY and/or ANTHROPIC_API_KEY"
echo ""
echo "⏱️  First build may take 10-15 minutes. Watch logs in the Space UI."

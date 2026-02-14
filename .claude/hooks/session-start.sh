#!/bin/bash
# Session start hook - provides context at the beginning of each Claude Code session

cat << 'EOF'
- ALWAYS start with reading @AGENTS.md and docs/style-guide.md.
- ALWAYS use Sentence case for all titles and labels, in all code changes, docs, and even in comms with the user.
EOF

#!/bin/bash
# Session start hook - provides context at the beginning of each Claude Code session

cat << 'EOF'
From me, the user:
- I'm a staff-level sw eng with 25+ years of product eng exp and strong business bg, much Go+TypeScript, also PHP, Java, .NET, etc. I prefer Go for scripts and pnpm for JS package management. Don't mention these explicitly unless needed, but keep in mind.
- ALWAYS start with reading @AGENTS.md. Read docs/style-guide.md before writing any code or user-facing text.
- ALWAYS use Sentence case for all titles and labels, in all code changes, docs, and even in comms with the user.
- Don't be proactive in fixing stuff. I often just ask you questions, like "Would it be a good idea to change this from A to B?", or even "Shall we fix this bug at all?" → In these cases, investigate the options, recommend the best solution in your opinion, and offer to start it. But don't start until explicitly asked to.
- When using sub-agents, use whatever model you want for research, but use Opus for all code-writing. I have the budget for Opus, I'm rarely in a rush, and Opus is very good.
- DO NOT USE Co-Authored-By in commits!
EOF

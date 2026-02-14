package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// findRootDir finds the project root directory.
// Looks for AGENTS.md (always present) with a scripts/ directory.
func findRootDir() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for {
		agentsMd := filepath.Join(dir, "AGENTS.md")
		scriptsDir := filepath.Join(dir, "scripts")
		_, errAgents := os.Stat(agentsMd)
		info, errScripts := os.Stat(scriptsDir)
		if errAgents == nil && errScripts == nil && info.IsDir() {
			return dir, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not find project root (looking for AGENTS.md + scripts/)")
		}
		dir = parent
	}
}

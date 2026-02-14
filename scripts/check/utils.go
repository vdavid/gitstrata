package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// findRootDir finds the project root directory.
// Looks for package.json + svelte.config.js together.
func findRootDir() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for {
		packageJSON := filepath.Join(dir, "package.json")
		svelteConfig := filepath.Join(dir, "svelte.config.js")
		_, errPkg := os.Stat(packageJSON)
		_, errSvelte := os.Stat(svelteConfig)
		if errPkg == nil && errSvelte == nil {
			return dir, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not find project root (looking for package.json + svelte.config.js)")
		}
		dir = parent
	}
}

package checks

import "fmt"

// AllChecks contains all check definitions with their metadata.
// Dependencies define which checks must complete before this one runs.
var AllChecks = []CheckDefinition{
	// Frontend - SvelteKit checks
	{
		ID:          "frontend-prettier",
		Nickname:    "prettier",
		DisplayName: "prettier",
		App:         AppFrontend,
		Tech:        "SvelteKit",
		DependsOn:   nil,
		Run:         RunPrettier,
	},
	{
		ID:          "frontend-eslint",
		Nickname:    "eslint",
		DisplayName: "eslint",
		App:         AppFrontend,
		Tech:        "SvelteKit",
		DependsOn:   []string{"frontend-prettier"},
		Run:         RunESLint,
	},
	{
		ID:          "frontend-knip",
		Nickname:    "knip",
		DisplayName: "knip",
		App:         AppFrontend,
		Tech:        "SvelteKit",
		DependsOn:   []string{"frontend-prettier"},
		Run:         RunKnip,
	},
	{
		ID:          "frontend-svelte-check",
		Nickname:    "svelte-check",
		DisplayName: "svelte-check",
		App:         AppFrontend,
		Tech:        "SvelteKit",
		DependsOn:   []string{"frontend-knip"},
		Run:         RunSvelteCheck,
	},
	{
		ID:          "frontend-vitest",
		Nickname:    "vitest",
		DisplayName: "vitest",
		App:         AppFrontend,
		Tech:        "SvelteKit",
		DependsOn:   []string{"frontend-svelte-check"},
		Run:         RunVitest,
	},
	{
		ID:          "frontend-pnpm-audit",
		Nickname:    "pnpm-audit",
		DisplayName: "pnpm audit",
		App:         AppFrontend,
		Tech:        "pnpm",
		DependsOn:   nil,
		Run:         RunPnpmAudit,
	},

	// Scripts - Go checks
	{
		ID:          "scripts-go-gofmt",
		Nickname:    "gofmt",
		DisplayName: "gofmt",
		App:         AppScripts,
		Tech:        "Go",
		DependsOn:   nil,
		Run:         RunGoFmt,
	},
	{
		ID:          "scripts-go-vet",
		Nickname:    "go-vet",
		DisplayName: "go vet",
		App:         AppScripts,
		Tech:        "Go",
		DependsOn:   []string{"scripts-go-gofmt"},
		Run:         RunGoVet,
	},
	{
		ID:          "scripts-go-staticcheck",
		Nickname:    "staticcheck",
		DisplayName: "staticcheck",
		App:         AppScripts,
		Tech:        "Go",
		DependsOn:   []string{"scripts-go-gofmt"},
		Run:         RunStaticcheck,
	},
	{
		ID:          "scripts-go-tests",
		Nickname:    "go-tests",
		DisplayName: "tests",
		App:         AppScripts,
		Tech:        "Go",
		DependsOn:   []string{"scripts-go-vet"},
		Run:         RunGoTests,
	},
}

// CLIName returns the name to display/accept in CLI (nickname if set, else ID).
func (c *CheckDefinition) CLIName() string {
	if c.Nickname != "" {
		return c.Nickname
	}
	return c.ID
}

// GetCheckByID returns a check definition by its ID or nickname.
func GetCheckByID(id string) *CheckDefinition {
	for i := range AllChecks {
		if AllChecks[i].ID == id || AllChecks[i].Nickname == id {
			return &AllChecks[i]
		}
	}
	return nil
}

// ValidateCheckNames checks for duplicate IDs/nicknames and returns an error if any are found.
func ValidateCheckNames() error {
	seen := make(map[string]string)

	for _, check := range AllChecks {
		if ownerID, exists := seen[check.ID]; exists {
			return fmt.Errorf("duplicate check name '%s': used by both '%s' and '%s'", check.ID, ownerID, check.ID)
		}
		seen[check.ID] = check.ID

		if check.Nickname != "" {
			if ownerID, exists := seen[check.Nickname]; exists {
				return fmt.Errorf("duplicate check name '%s': nickname for '%s' conflicts with '%s'", check.Nickname, check.ID, ownerID)
			}
			seen[check.Nickname] = check.ID
		}
	}
	return nil
}

// GetChecksByApp returns all checks for a specific app.
func GetChecksByApp(app App) []CheckDefinition {
	var result []CheckDefinition
	for _, check := range AllChecks {
		if check.App == app {
			result = append(result, check)
		}
	}
	return result
}

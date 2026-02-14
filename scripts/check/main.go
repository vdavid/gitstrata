package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"gitstrata/scripts/check/checks"
)

// stringSlice implements flag.Value for accumulating multiple flag values.
type stringSlice []string

func (s *stringSlice) String() string {
	return strings.Join(*s, ",")
}

func (s *stringSlice) Set(value string) error {
	for _, v := range strings.Split(value, ",") {
		v = strings.TrimSpace(v)
		if v != "" {
			*s = append(*s, v)
		}
	}
	return nil
}

// cliFlags holds the parsed command-line flags.
type cliFlags struct {
	checkNames []string
	ciMode     bool
	verbose    bool
	failFast   bool
}

func main() {
	if err := checks.ValidateCheckNames(); err != nil {
		printError("Bad check configuration: %v", err)
		os.Exit(1)
	}

	flags := parseFlags()
	if flags == nil {
		return // Help was shown
	}

	rootDir, err := findRootDir()
	if err != nil {
		printError("Error: %v", err)
		os.Exit(1)
	}

	ctx := &checks.CheckContext{
		CI:      flags.ciMode,
		Verbose: flags.verbose,
		RootDir: rootDir,
	}

	checksToRun, err := selectChecks(flags)
	if err != nil {
		printError("Error: %v", err)
		os.Exit(1)
	}

	if len(checksToRun) == 0 {
		fmt.Println("No checks to run.")
		os.Exit(0)
	}

	// Ensure pnpm dependencies are installed before running checks
	if needsPnpmInstall(checksToRun) {
		if err := ensurePnpmDependencies(ctx); err != nil {
			printError("Error: %v", err)
			os.Exit(1)
		}
	}

	runChecks(ctx, checksToRun, flags.failFast)
}

// parseFlags parses command-line flags and returns nil if help was shown.
func parseFlags() *cliFlags {
	var (
		checkNames stringSlice
		ciMode     = flag.Bool("ci", false, "Disable auto-fixing (for CI)")
		verbose    = flag.Bool("verbose", false, "Show detailed output")
		failFast   = flag.Bool("fail-fast", false, "Stop on first failure")
		help       = flag.Bool("help", false, "Show help message")
		h          = flag.Bool("h", false, "Show help message")
	)
	flag.Var(&checkNames, "check", "Run specific checks by ID (can be repeated or comma-separated)")
	flag.Parse()

	if *help || *h {
		showUsage()
		return nil
	}

	return &cliFlags{
		checkNames: checkNames,
		ciMode:     *ciMode,
		verbose:    *verbose,
		failFast:   *failFast,
	}
}

// selectChecks determines which checks to run based on flags.
func selectChecks(flags *cliFlags) ([]checks.CheckDefinition, error) {
	if len(flags.checkNames) > 0 {
		return selectChecksByID(flags.checkNames)
	}
	return checks.AllChecks, nil
}

// selectChecksByID returns checks matching the given IDs.
func selectChecksByID(names []string) ([]checks.CheckDefinition, error) {
	var result []checks.CheckDefinition
	for _, name := range names {
		check := checks.GetCheckByID(name)
		if check == nil {
			return nil, fmt.Errorf("unknown check ID: %s\nRun with --help to see available checks", name)
		}
		result = append(result, *check)
	}
	return result, nil
}

// runChecks executes the checks and prints results.
func runChecks(ctx *checks.CheckContext, checksToRun []checks.CheckDefinition, failFast bool) {
	fmt.Printf("Running %d checks...\n\n", len(checksToRun))

	startTime := time.Now()
	runner := NewRunner(ctx, checksToRun, failFast)
	failed, failedChecks := runner.Run()

	totalDuration := time.Since(startTime)
	fmt.Println()
	fmt.Printf("%sTotal runtime: %s%s\n", colorYellow, formatDuration(totalDuration), colorReset)

	if failed {
		printFailure(failedChecks)
		os.Exit(1)
	}

	fmt.Printf("%sAll checks passed!%s\n", colorGreen, colorReset)
}

// printFailure prints the failure message with rerun instructions.
func printFailure(failedChecks []string) {
	fmt.Printf("%sSome checks failed.%s\n", colorRed, colorReset)
	if len(failedChecks) > 0 {
		fmt.Println()
		checkWord := "check"
		if len(failedChecks) > 1 {
			checkWord = "checks"
		}
		fmt.Printf("To rerun the failed %s: ./scripts/check.sh --check %s\n", checkWord, strings.Join(failedChecks, ","))
	}
}

// needsPnpmInstall returns true if any of the checks require pnpm dependencies.
func needsPnpmInstall(checksToRun []checks.CheckDefinition) bool {
	for _, check := range checksToRun {
		if check.App == checks.AppFrontend {
			return true
		}
	}
	return false
}

// ensurePnpmDependencies runs pnpm install before checks.
func ensurePnpmDependencies(ctx *checks.CheckContext) error {
	fmt.Print("Ensuring pnpm dependencies are installed... ")
	startTime := time.Now()

	if err := checks.EnsurePnpmDependencies(ctx); err != nil {
		fmt.Printf("%sFAILED%s\n", colorRed, colorReset)
		return err
	}

	duration := time.Since(startTime)
	fmt.Printf("%sOK%s (%s)\n\n", colorGreen, colorReset, formatDuration(duration))
	return nil
}

// showUsage displays the help message with dynamically generated check list.
func showUsage() {
	fmt.Println("Usage: ./scripts/check.sh [OPTIONS]")
	fmt.Println()
	fmt.Println("Run code quality checks for the git strata project.")
	fmt.Println()
	fmt.Println("OPTIONS:")
	fmt.Println("    --check ID    Run specific checks by ID (can be repeated or comma-separated)")
	fmt.Println("    --ci          Disable auto-fixing (for CI)")
	fmt.Println("    --verbose     Show detailed output")
	fmt.Println("    --fail-fast   Stop on first failure")
	fmt.Println("    -h, --help    Show this help message")
	fmt.Println()
	fmt.Println("If no options are provided, runs all checks.")
	fmt.Println()
	fmt.Println("EXAMPLES:")
	fmt.Println("    ./scripts/check.sh                        # Run all checks")
	fmt.Println("    ./scripts/check.sh --check prettier       # Run specific check")
	fmt.Println("    ./scripts/check.sh --check gofmt,go-vet   # Run multiple checks")
	fmt.Println("    ./scripts/check.sh --ci --fail-fast        # CI mode, stop on first failure")
	fmt.Println()
	fmt.Println("Available checks:")
	fmt.Println()

	// Group checks by app and tech
	type checkGroup struct {
		app  checks.App
		tech string
		ids  []string
	}

	var groups []checkGroup
	groupMap := make(map[string]int)

	for _, check := range checks.AllChecks {
		key := string(check.App) + "|" + check.Tech
		if idx, ok := groupMap[key]; ok {
			groups[idx].ids = append(groups[idx].ids, check.CLIName())
		} else {
			groupMap[key] = len(groups)
			groups = append(groups, checkGroup{
				app:  check.App,
				tech: check.Tech,
				ids:  []string{check.CLIName()},
			})
		}
	}

	for _, g := range groups {
		fmt.Printf("  %s: %s\n", checks.AppDisplayName(g.app), g.tech)
		for _, id := range g.ids {
			fmt.Printf("    - %s\n", id)
		}
	}
}

package checks

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
)

// RunVitest runs unit tests with Vitest.
func RunVitest(ctx *CheckContext) (CheckResult, error) {
	cmd := exec.Command("pnpm", "exec", "vitest", "run")
	cmd.Dir = ctx.RootDir
	output, err := RunCommand(cmd, true)
	if err != nil {
		return CheckResult{}, fmt.Errorf("vitest failed\n%s", indentOutput(output))
	}

	// Extract test count from output
	testCountRe := regexp.MustCompile(`Tests\s+(\d+) passed`)
	testMatches := testCountRe.FindStringSubmatch(output)
	if len(testMatches) > 1 {
		count, _ := strconv.Atoi(testMatches[1])
		return Success(fmt.Sprintf("%d %s passed", count, Pluralize(count, "test", "tests"))), nil
	}

	return Success("All tests passed"), nil
}

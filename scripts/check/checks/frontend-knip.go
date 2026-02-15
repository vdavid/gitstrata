package checks

import (
	"fmt"
	"os/exec"
)

// RunKnip checks for unused files, dependencies, and exports with knip.
func RunKnip(ctx *CheckContext) (CheckResult, error) {
	cmd := exec.Command("pnpm", "knip")
	cmd.Dir = ctx.RootDir
	output, err := RunCommand(cmd, true)
	if err != nil {
		return CheckResult{}, fmt.Errorf("knip found unused code\n%s", indentOutput(output))
	}

	return Success("No unused files, dependencies, or exports"), nil
}

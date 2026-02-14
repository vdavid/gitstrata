package checks

// RunESLint lints and fixes code with ESLint.
func RunESLint(ctx *CheckContext) (CheckResult, error) {
	return runESLintCheck(ctx, ctx.RootDir, []string{"*.ts", "*.svelte", "*.js"})
}

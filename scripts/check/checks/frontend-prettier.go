package checks

// RunPrettier formats code with Prettier.
func RunPrettier(ctx *CheckContext) (CheckResult, error) {
	return runPrettierCheck(ctx, ctx.RootDir, []string{"*.ts", "*.svelte", "*.css", "*.js"})
}

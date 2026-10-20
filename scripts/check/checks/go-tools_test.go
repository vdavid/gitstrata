package checks

import "testing"

func TestParseGoToolBuildInfo(t *testing.T) {
	output := "/repo/node_modules/.cache/gitstrata-go-tools/staticcheck: go1.27.2\n" +
		"\tpath\thonnef.co/go/tools/cmd/staticcheck\n" +
		"\tmod\thonnef.co/go/tools\tv0.8.2\th1:abc=\n" +
		"\tdep\tgolang.org/x/tools\tv0.49.0\th1:def=\n"

	info, ok := parseGoToolBuildInfo(output)
	if !ok {
		t.Fatalf("expected build info to parse")
	}
	if info.GoVersion != "go1.27.2" {
		t.Errorf("GoVersion = %q, want go1.27.2", info.GoVersion)
	}
	if info.ModuleVersion != "v0.8.2" {
		t.Errorf("ModuleVersion = %q, want v0.8.2", info.ModuleVersion)
	}
}

func TestParseGoToolBuildInfoRejectsIncompleteOutput(t *testing.T) {
	if _, ok := parseGoToolBuildInfo("/bin/staticcheck: go1.27.2\n"); ok {
		t.Errorf("expected output without a mod line to be rejected")
	}
	if _, ok := parseGoToolBuildInfo(""); ok {
		t.Errorf("expected empty output to be rejected")
	}
}

func TestPinnedModuleVersion(t *testing.T) {
	version, err := pinnedModuleVersion("honnef.co/go/tools/cmd/staticcheck@v0.8.2")
	if err != nil || version != "v0.8.2" {
		t.Errorf("got (%q, %v), want (v0.8.2, nil)", version, err)
	}
	for _, unpinned := range []string{"honnef.co/go/tools/cmd/staticcheck", "honnef.co/go/tools/cmd/staticcheck@latest"} {
		if _, err := pinnedModuleVersion(unpinned); err == nil {
			t.Errorf("expected %q to be rejected as unpinned", unpinned)
		}
	}
}

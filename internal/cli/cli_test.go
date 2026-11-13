package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type result struct {
	code   int
	stdout string
	stderr string
}

func run(t *testing.T, args ...string) result {
	t.Helper()
	var out, errOut bytes.Buffer
	code := Run(context.Background(), args, &Env{
		Stdout: &out,
		Stderr: &errOut,
		Getenv: func(string) string { return "" },
	})
	return result{code: code, stdout: out.String(), stderr: errOut.String()}
}

func TestVersion(t *testing.T) {
	for _, args := range [][]string{{"version"}, {"--version"}} {
		r := run(t, args...)
		if r.code != ExitOK {
			t.Fatalf("%v: exit code %d, stderr: %s", args, r.code, r.stderr)
		}
		if !strings.HasPrefix(r.stdout, Name+" ") || !strings.Contains(r.stdout, "commit ") {
			t.Errorf("%v: unexpected output %q", args, r.stdout)
		}
		if r.stderr != "" {
			t.Errorf("%v: unexpected stderr %q", args, r.stderr)
		}
	}
}

func TestVersionShort(t *testing.T) {
	r := run(t, "version", "--short")
	if r.code != ExitOK {
		t.Fatalf("exit code %d, stderr: %s", r.code, r.stderr)
	}
	if got := strings.TrimSpace(r.stdout); got == "" || strings.Contains(got, " ") {
		t.Errorf("short version should be a single word, got %q", r.stdout)
	}
}

func TestUsageErrors(t *testing.T) {
	tests := []struct {
		name       string
		args       []string
		wantStderr string
	}{
		{name: "no command", args: nil, wantStderr: "Usage:"},
		{name: "unknown command", args: []string{"frobnicate"}, wantStderr: `unknown command "frobnicate"`},
		{name: "unknown global flag", args: []string{"--nope", "version"}, wantStderr: "flag provided but not defined"},
		{name: "unknown command flag", args: []string{"version", "--nope"}, wantStderr: "flag provided but not defined"},
		{name: "unexpected argument", args: []string{"version", "extra"}, wantStderr: "takes no arguments"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := run(t, tt.args...)
			if r.code != ExitUsage {
				t.Errorf("exit code %d, want %d", r.code, ExitUsage)
			}
			if !strings.Contains(r.stderr, tt.wantStderr) {
				t.Errorf("stderr does not contain %q:\n%s", tt.wantStderr, r.stderr)
			}
			if r.stdout != "" {
				t.Errorf("unexpected stdout %q", r.stdout)
			}
		})
	}
}

func TestHelp(t *testing.T) {
	for _, args := range [][]string{{"help"}, {"-h"}, {"--help"}} {
		r := run(t, args...)
		if r.code != ExitOK {
			t.Errorf("%v: exit code %d", args, r.code)
		}
		for _, want := range []string{"Usage:", "version", "--config"} {
			if !strings.Contains(r.stdout, want) {
				t.Errorf("%v: help does not mention %q:\n%s", args, want, r.stdout)
			}
		}
	}
}

func TestCommandHelpExitsZero(t *testing.T) {
	r := run(t, "version", "-h")
	if r.code != ExitOK {
		t.Errorf("exit code %d, want %d", r.code, ExitOK)
	}
	if !strings.Contains(r.stdout, "-short") {
		t.Errorf("command help does not list its flags:\n%s", r.stdout)
	}
	if r.stderr != "" {
		t.Errorf("unexpected stderr %q", r.stderr)
	}
}

func TestEveryCommandIsDocumented(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range commands() {
		if c.Name == "" || c.Summary == "" || c.Run == nil {
			t.Errorf("command %+v is incomplete", c)
		}
		if seen[c.Name] {
			t.Errorf("command %q is registered twice", c.Name)
		}
		seen[c.Name] = true
	}
	if seen["help"] {
		t.Error(`"help" is reserved`)
	}
}

func TestLoadConfigUsesTheConfigFlag(t *testing.T) {
	path := filepath.Join(t.TempDir(), "custom.yaml")
	if err := os.WriteFile(path, []byte("http:\n  listen: \":9999\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	env := &Env{Getenv: func(string) string { return "" }, configPath: path}
	cfg, err := env.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.HTTP.Listen != ":9999" {
		t.Errorf("HTTP.Listen = %q, want :9999", cfg.HTTP.Listen)
	}

	env.configPath = filepath.Join(t.TempDir(), "missing.yaml")
	if _, err := env.LoadConfig(); err == nil {
		t.Error("an explicitly named missing file must be an error")
	}
}

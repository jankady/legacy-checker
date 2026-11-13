package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func noEnv(string) string { return "" }

func writeFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "legacy-checker.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadDefaultsWhenDefaultFileIsMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-checker.yaml")

	got, err := Load(path, false, noEnv)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got != Default() {
		t.Errorf("got %+v, want defaults %+v", got, Default())
	}
}

func TestLoadExplicitFileMustExist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.yaml")

	if _, err := Load(path, true, noEnv); err == nil {
		t.Fatal("expected an error for a missing explicit file")
	}
}

func TestLoadFile(t *testing.T) {
	path := writeFile(t, `
version: 1
http:
  listen: "127.0.0.1:9000"
  upstream: http://app:3000
db:
  upstream: db:5432
`)

	got, err := Load(path, true, noEnv)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{
		Version: 1,
		HTTP:    HTTP{Listen: "127.0.0.1:9000", Upstream: "http://app:3000"},
		DB:      DB{Listen: ":5432", Upstream: "db:5432"}, // listen keeps its default
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestLoadEmptyFileGivesDefaults(t *testing.T) {
	for _, content := range []string{"", "\n\n", "# only a comment\n", "http:\ndb:\n"} {
		got, err := Load(writeFile(t, content), true, noEnv)
		if err != nil {
			t.Fatalf("Load(%q): %v", content, err)
		}
		if got != Default() {
			t.Errorf("Load(%q) = %+v, want defaults", content, got)
		}
	}
}

func TestLoadRejectsUnknownKeyWithPosition(t *testing.T) {
	path := writeFile(t, "version: 1\nhttp:\n  lisen: \":8080\"\n") // typo on line 3

	_, err := Load(path, true, noEnv)
	if err == nil {
		t.Fatal("expected an error for an unknown key")
	}
	msg := err.Error()
	for _, want := range []string{path, "lisen", "[3:"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error does not mention %q:\n%s", want, msg)
		}
	}
}

func TestLoadRejectsMalformedYAML(t *testing.T) {
	path := writeFile(t, "http: [unclosed\n")

	if _, err := Load(path, true, noEnv); err == nil {
		t.Fatal("expected an error for malformed YAML")
	}
}

func TestEnvironmentOverridesFile(t *testing.T) {
	path := writeFile(t, "http:\n  upstream: http://from-file:3000\ndb:\n  upstream: from-file:5432\n")
	env := map[string]string{
		"LEGACY_CHECKER_HTTP_LISTEN":   ":18080",
		"LEGACY_CHECKER_HTTP_UPSTREAM": "http://from-env:3000",
		"LEGACY_CHECKER_DB_LISTEN":     ":15432",
	}

	got, err := Load(path, true, func(k string) string { return env[k] })
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Config{
		Version: 1,
		HTTP:    HTTP{Listen: ":18080", Upstream: "http://from-env:3000"},
		DB:      DB{Listen: ":15432", Upstream: "from-file:5432"},
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*Config)
		wantErr string // substring; empty means valid
	}{
		{name: "defaults are valid", mutate: func(*Config) {}},
		{name: "unsupported version", mutate: func(c *Config) { c.Version = 2 }, wantErr: "version: 2 is not supported"},
		{name: "empty http listen", mutate: func(c *Config) { c.HTTP.Listen = "" }, wantErr: "http.listen: must not be empty"},
		{name: "http listen without port", mutate: func(c *Config) { c.HTTP.Listen = "localhost" }, wantErr: "http.listen"},
		{name: "db listen with bad port", mutate: func(c *Config) { c.DB.Listen = ":70000" }, wantErr: "db.listen"},
		{name: "db listen with named port", mutate: func(c *Config) { c.DB.Listen = ":postgres" }, wantErr: "db.listen"},
		{name: "http upstream without scheme", mutate: func(c *Config) { c.HTTP.Upstream = "app:3000" }, wantErr: "http.upstream"},
		{name: "http upstream with other scheme", mutate: func(c *Config) { c.HTTP.Upstream = "ftp://app" }, wantErr: "http.upstream"},
		{name: "http upstream without host", mutate: func(c *Config) { c.HTTP.Upstream = "http://" }, wantErr: "http.upstream"},
		{name: "https upstream is valid", mutate: func(c *Config) { c.HTTP.Upstream = "https://app.internal" }},
		{name: "db upstream without host", mutate: func(c *Config) { c.DB.Upstream = ":5432" }, wantErr: "db.upstream"},
		{name: "db upstream without port", mutate: func(c *Config) { c.DB.Upstream = "db" }, wantErr: "db.upstream"},
		{name: "db upstream ipv6 is valid", mutate: func(c *Config) { c.DB.Upstream = "[::1]:5432" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := Default()
			tt.mutate(&cfg)
			err := cfg.Validate()
			switch {
			case tt.wantErr == "" && err != nil:
				t.Errorf("unexpected error: %v", err)
			case tt.wantErr != "" && err == nil:
				t.Errorf("expected an error containing %q", tt.wantErr)
			case tt.wantErr != "" && !strings.Contains(err.Error(), tt.wantErr):
				t.Errorf("error %q does not contain %q", err, tt.wantErr)
			}
		})
	}
}

func TestValidateReportsEveryProblem(t *testing.T) {
	cfg := Default()
	cfg.HTTP.Listen = ""
	cfg.DB.Upstream = "db"

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"http.listen", "db.upstream"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %q: %v", want, err)
		}
	}
}

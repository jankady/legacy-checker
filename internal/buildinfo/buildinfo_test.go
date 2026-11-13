package buildinfo

import (
	"runtime/debug"
	"strings"
	"testing"
)

func TestResolve(t *testing.T) {
	vcs := &debug.BuildInfo{Settings: []debug.BuildSetting{
		{Key: "vcs.revision", Value: "0123456789abcdef0123"},
		{Key: "vcs.time", Value: "2026-11-11T10:00:00Z"},
		{Key: "vcs.modified", Value: "true"},
	}}

	tests := []struct {
		name                  string
		version, commit, date string
		bi                    *debug.BuildInfo
		wantCommit, wantDate  string
		wantModified          bool
	}{
		{
			name:       "no information at all",
			version:    "dev",
			wantCommit: "unknown",
		},
		{
			name:         "falls back to embedded vcs data",
			version:      "dev",
			bi:           vcs,
			wantCommit:   "0123456789abcdef0123",
			wantDate:     "2026-11-11T10:00:00Z",
			wantModified: true,
		},
		{
			name:         "ldflags win over embedded vcs data",
			version:      "0.1.0",
			commit:       "feedface",
			date:         "2026-12-01T00:00:00Z",
			bi:           vcs,
			wantCommit:   "feedface",
			wantDate:     "2026-12-01T00:00:00Z",
			wantModified: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolve(tt.version, tt.commit, tt.date, tt.bi)
			if got.Version != tt.version {
				t.Errorf("Version = %q, want %q", got.Version, tt.version)
			}
			if got.Commit != tt.wantCommit {
				t.Errorf("Commit = %q, want %q", got.Commit, tt.wantCommit)
			}
			if got.Date != tt.wantDate {
				t.Errorf("Date = %q, want %q", got.Date, tt.wantDate)
			}
			if got.Modified != tt.wantModified {
				t.Errorf("Modified = %v, want %v", got.Modified, tt.wantModified)
			}
			if got.GoVersion == "" || !strings.Contains(got.Platform, "/") {
				t.Errorf("GoVersion/Platform not filled: %q %q", got.GoVersion, got.Platform)
			}
		})
	}
}

func TestString(t *testing.T) {
	i := Info{
		Version:   "0.1.0",
		Commit:    "0123456789abcdef0123",
		Date:      "2026-11-11T10:00:00Z",
		Modified:  true,
		GoVersion: "go1.99.0",
		Platform:  "linux/amd64",
	}
	want := "0.1.0 (commit 0123456789ab, modified, 2026-11-11T10:00:00Z, go1.99.0 linux/amd64)"
	if got := i.String(); got != want {
		t.Errorf("String() =\n  %q\nwant\n  %q", got, want)
	}

	short := Info{Version: "dev", Commit: "unknown", GoVersion: "go1.99.0", Platform: "linux/amd64"}
	want = "dev (commit unknown, go1.99.0 linux/amd64)"
	if got := short.String(); got != want {
		t.Errorf("String() =\n  %q\nwant\n  %q", got, want)
	}
}

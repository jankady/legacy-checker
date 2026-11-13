// Package buildinfo reports which build of the tool is running.
//
// Release builds set version, commit and date through -ldflags. Other builds
// fall back to the version control information the Go toolchain embeds.
package buildinfo

import (
	"fmt"
	"runtime"
	"runtime/debug"
)

// Set at build time with -ldflags "-X .../internal/buildinfo.version=...".
var (
	version = "dev"
	commit  = ""
	date    = ""
)

// Info describes a build.
type Info struct {
	Version   string // release version, or "dev"
	Commit    string // full revision, or "unknown"
	Date      string // build or commit time in RFC 3339, may be empty
	Modified  bool   // built from a working tree with local changes
	GoVersion string
	Platform  string // GOOS/GOARCH
}

// Get returns the build information of the running binary.
func Get() Info {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		bi = nil
	}
	return resolve(version, commit, date, bi)
}

func resolve(version, commit, date string, bi *debug.BuildInfo) Info {
	info := Info{
		Version:   version,
		Commit:    commit,
		Date:      date,
		GoVersion: runtime.Version(),
		Platform:  runtime.GOOS + "/" + runtime.GOARCH,
	}
	if bi != nil {
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision":
				if info.Commit == "" {
					info.Commit = s.Value
				}
			case "vcs.time":
				if info.Date == "" {
					info.Date = s.Value
				}
			case "vcs.modified":
				info.Modified = s.Value == "true"
			}
		}
	}
	if info.Commit == "" {
		info.Commit = "unknown"
	}
	return info
}

// ShortCommit returns the first twelve characters of the revision.
func (i Info) ShortCommit() string {
	if len(i.Commit) > 12 {
		return i.Commit[:12]
	}
	return i.Commit
}

// String renders the one-line form printed by the version command.
func (i Info) String() string {
	c := i.ShortCommit()
	if i.Modified {
		c += ", modified"
	}
	s := fmt.Sprintf("%s (commit %s", i.Version, c)
	if i.Date != "" {
		s += ", " + i.Date
	}
	return s + fmt.Sprintf(", %s %s)", i.GoVersion, i.Platform)
}

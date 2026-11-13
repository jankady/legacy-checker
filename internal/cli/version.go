package cli

import (
	"context"
	"fmt"

	"github.com/jankady/legacy-checker/internal/buildinfo"
)

func versionCommand() *Command {
	return &Command{
		Name:    "version",
		Summary: "Print the version, commit and build platform",
		Run: func(_ context.Context, env *Env, args []string) error {
			fs := newFlagSet("version", "Print the version, commit and build platform.")
			short := fs.Bool("short", false, "print only the version number")
			if err := parseFlags(env, fs, args); err != nil {
				return err
			}
			if fs.NArg() > 0 {
				return usagef("version takes no arguments, got %q", fs.Arg(0))
			}

			info := buildinfo.Get()
			if *short {
				_, err := fmt.Fprintln(env.Stdout, info.Version)
				return err
			}
			_, err := fmt.Fprintf(env.Stdout, "%s %s\n", Name, info)
			return err
		},
	}
}

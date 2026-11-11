// Package cli implements the trowel command line: global flags, command
// dispatch, help and exit codes. Each command lives in its own file and is
// registered in commands().
//
// The standard library flag package is used on purpose (decision D28): the
// tool sits in the data path of other people's systems, so its dependency
// list is kept as short as possible.
package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"

	"github.com/jankady/legacy-checker/internal/config"
)

// Name is the name of the binary as shown in help and messages.
const Name = "trowel"

// Exit codes. Later steps add codes for classes of test failure.
const (
	ExitOK    = 0
	ExitError = 1 // the command ran and failed
	ExitUsage = 2 // the command line was wrong
)

// Env is everything a command may touch outside its arguments. Tests replace
// it; main fills it from the process.
type Env struct {
	Stdout io.Writer
	Stderr io.Writer
	Getenv func(string) string

	// configPath is the value of --config, empty when the flag was not given.
	configPath string
}

// LoadConfig returns the effective configuration for commands that need one.
func (e *Env) LoadConfig() (config.Config, error) {
	if e.configPath != "" {
		return config.Load(e.configPath, true, e.Getenv)
	}
	return config.Load(config.DefaultPath, false, e.Getenv)
}

// Command is one subcommand.
type Command struct {
	Name    string
	Summary string // one line, shown in the command list
	// Experimental marks a command that is reachable but not complete yet
	// (roadmap rule 4). The mark is removed in the step that completes it.
	Experimental bool
	// Run executes the command. Returning a *UsageError makes the exit code 2.
	Run func(ctx context.Context, env *Env, args []string) error
}

// UsageError reports a wrong command line, as opposed to a failed run.
type UsageError struct{ Msg string }

func (e *UsageError) Error() string { return e.Msg }

func usagef(format string, a ...any) error {
	return &UsageError{Msg: fmt.Sprintf(format, a...)}
}

// commands lists every command in the order shown in help.
func commands() []*Command {
	return []*Command{
		versionCommand(),
	}
}

// Run executes the command line and returns the process exit code.
func Run(ctx context.Context, args []string, env *Env) int {
	cmds := commands()

	global := flag.NewFlagSet(Name, flag.ContinueOnError)
	global.SetOutput(io.Discard) // errors and help are printed here, in one place
	global.StringVar(&env.configPath, "config", "", "")
	showVersion := global.Bool("version", false, "")

	if err := global.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			printUsage(env.Stdout, cmds)
			return ExitOK
		}
		return fail(env, usagef("%v", err))
	}
	rest := global.Args()

	if *showVersion {
		rest = []string{"version"}
	}
	if len(rest) == 0 {
		printUsage(env.Stderr, cmds)
		return ExitUsage
	}
	if rest[0] == "help" {
		printUsage(env.Stdout, cmds)
		return ExitOK
	}

	cmd := find(cmds, rest[0])
	if cmd == nil {
		return fail(env, usagef("unknown command %q", rest[0]))
	}

	err := cmd.Run(ctx, env, rest[1:])
	switch {
	case err == nil, errors.Is(err, flag.ErrHelp):
		return ExitOK
	default:
		return fail(env, err)
	}
}

func find(cmds []*Command, name string) *Command {
	for _, c := range cmds {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func fail(env *Env, err error) int {
	fmt.Fprintf(env.Stderr, "%s: %v\n", Name, err)
	var ue *UsageError
	if errors.As(err, &ue) {
		fmt.Fprintf(env.Stderr, "Run '%s help' for usage.\n", Name)
		return ExitUsage
	}
	return ExitError
}

func printUsage(w io.Writer, cmds []*Command) {
	var b strings.Builder
	fmt.Fprintf(&b, "%s observes a web application from the outside and turns what it sees\n", Name)
	b.WriteString("into a behaviour map and replayable tests.\n\n")
	fmt.Fprintf(&b, "Usage:\n  %s [--config FILE] <command> [flags]\n\n", Name)
	b.WriteString("Commands:\n")
	for _, c := range cmds {
		summary := c.Summary
		if c.Experimental {
			summary += " (experimental)"
		}
		fmt.Fprintf(&b, "  %-10s %s\n", c.Name, summary)
	}
	fmt.Fprintf(&b, "  %-10s %s\n", "help", "Show this help")
	b.WriteString("\nGlobal flags:\n")
	fmt.Fprintf(&b, "  --config FILE   Configuration file (default: %s in the current directory)\n", config.DefaultPath)
	b.WriteString("  --version       Print the version and exit\n")
	fmt.Fprintf(&b, "\nRun '%s <command> -h' for the flags of a command.\n", Name)
	_, _ = io.WriteString(w, b.String())
}

// newFlagSet returns a flag set for a command with consistent help output.
// describe is the text shown above the flag list.
func newFlagSet(name, describe string) *flag.FlagSet {
	fs := flag.NewFlagSet(Name+" "+name, flag.ContinueOnError)
	fs.SetOutput(io.Discard) // parseFlags decides what is printed and where
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "%s\n\nUsage:\n  %s %s [flags]\n", describe, Name, name)
		hasFlags := false
		fs.VisitAll(func(*flag.Flag) { hasFlags = true })
		if hasFlags {
			fmt.Fprint(fs.Output(), "\nFlags:\n")
			fs.PrintDefaults()
		}
	}
	return fs
}

// parseFlags parses args. A request for help prints the command's usage to
// stdout and returns flag.ErrHelp, which Run turns into exit code 0. Any other
// flag error becomes a usage error and is printed once, by Run.
func parseFlags(env *Env, fs *flag.FlagSet, args []string) error {
	err := fs.Parse(args)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, flag.ErrHelp):
		fs.SetOutput(env.Stdout)
		fs.Usage()
		return err
	default:
		return &UsageError{Msg: err.Error()}
	}
}

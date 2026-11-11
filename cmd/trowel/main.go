// Command trowel observes a web application from the outside and turns what it
// sees into a behaviour map and replayable tests. See docs/ for the plan.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/jankady/legacy-checker/internal/cli"
)

func main() {
	os.Exit(run())
}

func run() int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	return cli.Run(ctx, os.Args[1:], &cli.Env{
		Stdout: os.Stdout,
		Stderr: os.Stderr,
		Getenv: os.Getenv,
	})
}

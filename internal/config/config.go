// Package config loads and validates legacy-checker.yaml.
//
// Precedence, lowest to highest: built-in defaults, the configuration file,
// LEGACY_CHECKER_* environment variables. Unknown keys are rejected so that a typo
// is reported instead of being silently ignored.
package config

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"strconv"

	"github.com/goccy/go-yaml"
)

const (
	// DefaultPath is where the configuration is looked for when no path is given.
	DefaultPath = "legacy-checker.yaml"
	// SchemaVersion is the only configuration version this build understands.
	SchemaVersion = 1
)

// Config is the content of legacy-checker.yaml. Later steps add sections; a section is
// added in the step that first reads it.
type Config struct {
	Version int  `yaml:"version"`
	HTTP    HTTP `yaml:"http"`
	DB      DB   `yaml:"db"`
}

// HTTP configures the HTTP side: where Legacy Checker listens and which app it fronts.
type HTTP struct {
	Listen   string `yaml:"listen"`
	Upstream string `yaml:"upstream"`
}

// DB configures the database side: where Legacy Checker listens and which database it
// relays to.
type DB struct {
	Listen   string `yaml:"listen"`
	Upstream string `yaml:"upstream"`
}

// Default returns the configuration used when nothing else is specified.
func Default() Config {
	return Config{
		Version: SchemaVersion,
		HTTP:    HTTP{Listen: ":8080"},
		DB:      DB{Listen: ":5432"},
	}
}

// Load builds the effective configuration.
//
// When explicit is false, path is the default location and a missing file is
// not an error. When explicit is true, the user named the file and it must
// exist. getenv supplies environment variables; pass os.Getenv.
func Load(path string, explicit bool, getenv func(string) string) (Config, error) {
	cfg := Default()

	data, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := decode(data, &cfg); err != nil {
			return Config{}, fmt.Errorf("%s: %w", path, err)
		}
	case errors.Is(err, fs.ErrNotExist) && !explicit:
		// No file at the default location: defaults and environment only.
	default:
		return Config{}, fmt.Errorf("reading configuration: %w", err)
	}

	applyEnv(&cfg, getenv)

	if err := cfg.Validate(); err != nil {
		return Config{}, fmt.Errorf("invalid configuration: %w", err)
	}
	return cfg, nil
}

func decode(data []byte, cfg *Config) error {
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	if err := yaml.UnmarshalWithOptions(data, cfg, yaml.DisallowUnknownField()); err != nil {
		// FormatError adds the line, the column and an excerpt of the file.
		return errors.New(yaml.FormatError(err, false, true))
	}
	fillDefaults(cfg)
	return nil
}

// fillDefaults restores defaults for values the file left out or set to null.
// A document that holds only comments, or a section written as "http:" with
// nothing under it, decodes to zero values.
func fillDefaults(cfg *Config) {
	def := Default()
	if cfg.Version == 0 {
		cfg.Version = def.Version
	}
	if cfg.HTTP.Listen == "" {
		cfg.HTTP.Listen = def.HTTP.Listen
	}
	if cfg.DB.Listen == "" {
		cfg.DB.Listen = def.DB.Listen
	}
}

func applyEnv(cfg *Config, getenv func(string) string) {
	if getenv == nil {
		return
	}
	for name, dst := range map[string]*string{
		"LEGACY_CHECKER_HTTP_LISTEN":   &cfg.HTTP.Listen,
		"LEGACY_CHECKER_HTTP_UPSTREAM": &cfg.HTTP.Upstream,
		"LEGACY_CHECKER_DB_LISTEN":     &cfg.DB.Listen,
		"LEGACY_CHECKER_DB_UPSTREAM":   &cfg.DB.Upstream,
	} {
		if v := getenv(name); v != "" {
			*dst = v
		}
	}
}

// Validate checks the format of every value that is set. Whether a value is
// required depends on the command and is checked there.
func (c Config) Validate() error {
	var errs []error

	if c.Version != SchemaVersion {
		errs = append(errs, fmt.Errorf("version: %d is not supported, this build understands version %d",
			c.Version, SchemaVersion))
	}
	if err := checkListen(c.HTTP.Listen); err != nil {
		errs = append(errs, fmt.Errorf("http.listen: %w", err))
	}
	if err := checkListen(c.DB.Listen); err != nil {
		errs = append(errs, fmt.Errorf("db.listen: %w", err))
	}
	if c.HTTP.Upstream != "" {
		if err := checkHTTPUpstream(c.HTTP.Upstream); err != nil {
			errs = append(errs, fmt.Errorf("http.upstream: %w", err))
		}
	}
	if c.DB.Upstream != "" {
		if err := checkHostPort(c.DB.Upstream, true); err != nil {
			errs = append(errs, fmt.Errorf("db.upstream: %w", err))
		}
	}
	return errors.Join(errs...)
}

func checkListen(addr string) error {
	if addr == "" {
		return errors.New("must not be empty")
	}
	return checkHostPort(addr, false)
}

func checkHostPort(addr string, needHost bool) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("%q is not host:port", addr)
	}
	if needHost && host == "" {
		return fmt.Errorf("%q has no host", addr)
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return fmt.Errorf("%q has an invalid port", addr)
	}
	return nil
}

func checkHTTPUpstream(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%q is not a URL", raw)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%q must start with http:// or https://", raw)
	}
	if u.Host == "" {
		return fmt.Errorf("%q has no host", raw)
	}
	return nil
}

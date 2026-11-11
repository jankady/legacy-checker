# Developer entry points. CI runs the same commands directly (see
# .github/workflows/ci.yml) so that it also works on Windows runners.

BINARY  := trowel
PKG     := github.com/jankady/legacy-checker
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse HEAD 2>/dev/null)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

LDFLAGS := -s -w \
	-X $(PKG)/internal/buildinfo.version=$(VERSION) \
	-X $(PKG)/internal/buildinfo.commit=$(COMMIT) \
	-X $(PKG)/internal/buildinfo.date=$(DATE)

TARGETS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64

# The binary must stay free of C dependencies (acceptance criterion A6).
export CGO_ENABLED := 0

.PHONY: all build test lint fmt cross image check clean

all: check build

build: ## Build bin/trowel for this machine
	go build -trimpath -ldflags "$(LDFLAGS)" -o bin/$(BINARY) ./cmd/trowel

test: ## Run unit tests
	go test ./...

lint: ## Run the linters (needs golangci-lint v2)
	golangci-lint run

fmt: ## Format the code
	golangci-lint fmt

cross: ## Build every release target into dist/
	@for t in $(TARGETS); do \
		os=$${t%/*}; arch=$${t#*/}; ext=; \
		[ "$$os" = windows ] && ext=.exe; \
		echo "building $$os/$$arch"; \
		GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" \
			-o dist/$(BINARY)-$$os-$$arch$$ext ./cmd/trowel || exit 1; \
	done

image: ## Build the Docker image trowel:dev
	docker build \
		--build-arg VERSION=$(VERSION) --build-arg COMMIT=$(COMMIT) --build-arg DATE=$(DATE) \
		-t $(BINARY):dev .

check: lint test ## Everything CI checks that can run locally
	go mod tidy
	git diff --exit-code go.mod go.sum

clean:
	rm -rf bin dist

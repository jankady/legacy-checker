# syntax=docker/dockerfile:1

ARG GO_VERSION=1.25
ARG ALPINE_VERSION=3.22

# Build on the builder's own platform and cross-compile, so multi-arch images
# do not need emulation.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=
ARG DATE=
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath \
      -ldflags "-s -w \
        -X github.com/jankady/legacy-checker/internal/buildinfo.version=${VERSION} \
        -X github.com/jankady/legacy-checker/internal/buildinfo.commit=${COMMIT} \
        -X github.com/jankady/legacy-checker/internal/buildinfo.date=${DATE}" \
      -o /out/legacy-checker ./cmd/legacy-checker

# The runtime image keeps /bin/sh: the reset.command hook runs through a shell
# (docs/02-architecture.md, section 3).
FROM alpine:${ALPINE_VERSION}
COPY --from=build /out/legacy-checker /usr/local/bin/legacy-checker
WORKDIR /work
ENTRYPOINT ["legacy-checker"]
CMD ["help"]

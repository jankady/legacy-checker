// Package store is the capture store: one local SQLite file per recording,
// written by a single goroutine so the proxies never block on disk.
//
// Built in roadmap step 4. See docs/02-architecture.md, section 2.4.
package store

// Package dbtap relays database connections byte for byte and hands a copy of
// the traffic to a protocol decoder. It defines the protocol-neutral types the
// rest of the tool works with; decoders live in subpackages.
//
// Built in roadmap steps 7 and 8. See docs/02-architecture.md, section 2.2.
package dbtap

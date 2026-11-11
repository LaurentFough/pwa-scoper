# PWA Scope(Fixe)r development helpers. Run `make` to list targets.
# Requires Make and Bun; packaging also requires zip.
BUN ?= bun
.DEFAULT_GOAL := help

.PHONY: help install build dev debug test typecheck check pack clean usage

help:
	@printf '%s\n' \
	  'PWA Scope(Fixe)r' \
	  '  make install    Install exact locked dependencies' \
	  '  make build      Build the production extension into dist/' \
	  '  make dev        Watch sources and rebuild with source maps' \
	  '  make debug      Alias for dev' \
	  '  make test       Run automated tests' \
	  '  make typecheck  Check TypeScript types' \
	  '  make check      Run tests, type checking, and production build' \
	  '  make pack       Build and create dist/extension.zip (requires zip)' \
	  '  make clean      Remove generated dist/ files' \
	  '  make usage      Show browser loading and debugging instructions' \
	  'Override the Bun executable with: make BUN=/path/to/bun build'

install:
	$(BUN) install --frozen-lockfile

build:
	$(BUN) run build

dev:
	$(BUN) run dev

debug: dev

test:
	$(BUN) test

typecheck:
	$(BUN) run typecheck

# Keep the checks sequential even when invoked with make -j.
check:
	$(BUN) test
	$(BUN) run typecheck
	$(BUN) run build

pack:
	$(BUN) run pack

# Limit cleanup to generated output; installed dependencies and settings remain.
clean:
	rm -rf -- dist

usage:
	@printf '%s\n' \
	  '1. Run make install and make build.' \
	  '2. Open chrome://extensions (or edge://extensions) in the app browser/profile.' \
	  '3. Enable Developer mode, choose Load unpacked, and select the dist folder in this repository.' \
	  '4. Configure Internal navigation in the extension popup; grant site access and reload the app.' \
	  '5. For Omarchy app windows, choose Enable in this window in the extension popup.' \
	  'Debug: run make debug; after each rebuild reload the extension and the app page.' \
	  'Inspect the service worker from the extensions page; inspect popup and page consoles for UI/runtime logs.' \
	  'Guide and remaining browser acceptance checks: docs/navigation.md'

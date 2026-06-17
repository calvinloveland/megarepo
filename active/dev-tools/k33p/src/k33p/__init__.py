"""k33p — typed version control.

A k33p project is a monorepo with one or more subprojects; a "single project"
is a degenerate monorepo with one subproject at the root path. Every channel
is content-addressed, scoped, and projected through role-based views.

The package is organized into:
    - manifest: parse and validate k33p.yaml
    - lock:     parse k33p.lock
    - project:  the in-memory project model
    - channels: typed channel definitions
    - refs:     ref and pointer types
    - store:    content-addressed object store (skeleton)
    - cli:      command-line entry point
    - tui:      terminal user interface
"""

from k33p.__about__ import __version__

__all__ = ["__version__"]

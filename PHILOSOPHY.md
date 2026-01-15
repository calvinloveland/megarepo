# Development Philosophy

These are the principles that guide development in this megarepo.

## Core Values

### 1. Automation Over Manual Work
If you're doing something twice, automate it. Projects like `full-auto-ci` and `lazy_ci` exist because CI should work *for* you, not require constant babysitting. The best systems run in the background and only bother you when something's actually wrong.

### 2. Incremental Improvement (Ratchets)
Perfection isn't the goal on day one—progress is. Use ratchets: set a target, and only require that each change doesn't make things worse. Over time, the floor rises. This applies to test coverage, code quality scores, complexity metrics, and technical debt.

### 3. Plain Text and Simple Formats
Prefer plain text, markdown, YAML, and simple formats over proprietary or complex ones. They're version-controllable, diffable, greppable, and will still work in 20 years. See: `plaintext_project_management`.

### 4. Make It Work, Then Make It Right
Ship something that works first. Polish later. A working prototype teaches you more than a perfect plan ever will. Many projects here started as weekend experiments that grew into useful tools.

### 5. Configuration Over Code
When behavior can be driven by configuration, do that instead of hardcoding. Users (including future-you) shouldn't need to modify source code to change settings. YAML configs, environment variables, and sensible defaults are your friends.

### 6. Reproducibility
Development environments should be reproducible. NixOS configurations (see `calnix`), devcontainers, and lockfiles exist so that "works on my machine" becomes "works on every machine."

## Code Style

### Python (Primary Language)
- **Python 3.8+** minimum for compatibility
- **Type hints** where they add clarity
- **pytest** for testing
- **pyproject.toml** for project configuration (not setup.py)
- **Hatch** or **setuptools** for builds

### General
- Keep functions small and focused
- Prefer composition over inheritance
- Write code that's easy to delete
- Comments explain *why*, code explains *what*

## Project Structure

```
project/
├── src/              # Source code
├── tests/            # Tests mirror src structure
├── pyproject.toml    # Project metadata & dependencies
├── README.md         # What it does, how to use it
└── .github/          # CI workflows
```

## Commit Philosophy

- **Commit often**: Small, atomic commits are easier to review, bisect, and revert
- **Commit messages**: Present tense, imperative mood ("Add feature" not "Added feature")
- **One change per commit**: Don't mix refactoring with feature work

## On Games and Fun Projects

Not everything needs to be "useful." Games (`MancalaAI`, `conway_game_of_war`, `lets-holdem-together`) and experiments are how we learn, stay creative, and remember why we got into programming in the first place. Ship the side project.

---

*"The best code is the code you didn't have to write."*

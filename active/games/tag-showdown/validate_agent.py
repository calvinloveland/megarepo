"""Check an agent file before you compete. The tournament runs exactly this code.

    python validate_agent.py my_agent.json
    python validate_agent.py my_agent.json --no-smoke     skip the short test match
"""
import os
import sys

from agent import check_agent_file


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    path = args[0]
    rep = check_agent_file(path, smoke="--no-smoke" not in argv)
    print(os.path.basename(path))
    if rep.agent:
        a = rep.agent
        print(f"name {a.name} | role {a.role} | color {a.color}")
    if rep.summary:
        print(rep.summary)
    for w in rep.warnings:
        print(f"warning: {w}")
    if rep.ok:
        print("\nPASS: ready to compete.")
        return 0
    print(f"\nFAIL: {len(rep.problems)} problem(s) to fix:")
    for p in rep.problems:
        print(f"  - {p}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Main entry point for the plaintext project management CLI."""

import sys

from ptpm import get_todos


def main():
    """Handle CLI arguments and dispatch to appropriate functions."""
    if len(sys.argv) == 1:
        print("No arguments given. Use -h for help.")
        return
    if sys.argv[1] == "-h":
        print("Dunno, good luck")
    if sys.argv[1] == "todos":
        get_todos.print_todos()

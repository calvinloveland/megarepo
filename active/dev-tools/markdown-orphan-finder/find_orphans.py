#!/usr/bin/env python3
"""
Find orphaned markdown files and isolated islands in a repository.

Orphaned files: Markdown files not linked to by any other markdown files.
Islands: Groups of markdown files that only link to each other, with no incoming links from outside.
"""

import argparse
import re
from pathlib import Path
from typing import Dict, Set, List, Tuple
from collections import defaultdict, deque


def find_markdown_files(root: Path, exclude_patterns: List[str]) -> List[Path]:
    """Find all markdown files in the repository."""
    md_files = []
    exclude_dirs = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '.pytest_cache', '.vscode-test'}
    
    for pattern in ['**/*.md', '**/*.markdown']:
        for path in root.glob(pattern):
            # Check if any parent directory is in exclude list
            if any(excluded in path.parts for excluded in exclude_dirs):
                continue
            
            # Check exclude patterns
            if any(re.search(excl, str(path.relative_to(root))) for excl in exclude_patterns):
                continue
            
            md_files.append(path)
    
    return md_files


def extract_markdown_links(file_path: Path, root: Path) -> Set[Path]:
    """Extract links to other markdown files from a markdown file."""
    links = set()
    
    try:
        content = file_path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, PermissionError):
        return links
    
    # Match markdown links: [text](url) and <url>
    link_patterns = [
        r'\[([^\]]+)\]\(([^)]+)\)',  # [text](url)
        r'<([^>]+\.md[^>]*)>',        # <url.md>
    ]
    
    for pattern in link_patterns:
        matches = re.findall(pattern, content)
        for match in matches:
            # Extract URL (last group in match)
            url = match[-1] if isinstance(match, tuple) else match
            
            # Skip external URLs and anchors
            if url.startswith(('http://', 'https://', '#', 'mailto:')):
                continue
            
            # Remove anchor fragments
            url = url.split('#')[0]
            
            # Skip empty URLs
            if not url:
                continue
            
            # Resolve relative path
            if url.endswith(('.md', '.markdown')):
                linked_path = (file_path.parent / url).resolve()
                
                # Ensure the linked file is within the repository
                try:
                    linked_path.relative_to(root)
                    if linked_path.exists():
                        links.add(linked_path)
                except (ValueError, OSError):
                    pass
    
    return links


def build_link_graph(md_files: List[Path], root: Path) -> Dict[Path, Set[Path]]:
    """Build a directed graph of markdown file links."""
    graph = defaultdict(set)
    
    for file_path in md_files:
        links = extract_markdown_links(file_path, root)
        graph[file_path] = links
    
    return graph


def find_incoming_links(graph: Dict[Path, Set[Path]]) -> Dict[Path, Set[Path]]:
    """Build reverse graph: for each file, which files link to it."""
    incoming = defaultdict(set)
    
    for source, targets in graph.items():
        for target in targets:
            incoming[target].add(source)
    
    return incoming


def find_orphans(md_files: List[Path], incoming: Dict[Path, Set[Path]]) -> List[Path]:
    """Find markdown files with no incoming links."""
    orphans = []
    
    for file_path in md_files:
        if file_path not in incoming or len(incoming[file_path]) == 0:
            orphans.append(file_path)
    
    return orphans


def find_islands(graph: Dict[Path, Set[Path]], incoming: Dict[Path, Set[Path]], 
                 md_files: List[Path]) -> List[List[Path]]:
    """
    Find groups of files that only link to each other (islands).
    
    Uses weakly connected components where the component has no incoming links from outside.
    """
    # Build undirected graph (bidirectional)
    undirected = defaultdict(set)
    for source, targets in graph.items():
        for target in targets:
            undirected[source].add(target)
            undirected[target].add(source)
    
    # Find connected components using BFS
    visited = set()
    components = []
    
    for start_node in md_files:
        if start_node in visited:
            continue
        
        # BFS to find component
        component = []
        queue = deque([start_node])
        visited.add(start_node)
        
        while queue:
            node = queue.popleft()
            component.append(node)
            
            for neighbor in undirected[node]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        
        if len(component) > 1:
            components.append(component)
    
    # Filter to only islands (no external incoming links)
    islands = []
    for component in components:
        component_set = set(component)
        has_external_links = False
        
        for node in component:
            if node in incoming:
                for linker in incoming[node]:
                    if linker not in component_set:
                        has_external_links = True
                        break
            if has_external_links:
                break
        
        if not has_external_links:
            islands.append(component)
    
    return islands


def format_path(path: Path, root: Path) -> str:
    """Format path relative to root."""
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def main():
    parser = argparse.ArgumentParser(
        description='Find orphaned markdown files and isolated islands'
    )
    parser.add_argument(
        'root',
        nargs='?',
        default='.',
        help='Root directory to search (default: current directory)'
    )
    parser.add_argument(
        '--exclude',
        action='append',
        default=[],
        help='Regex patterns to exclude (can be used multiple times)'
    )
    parser.add_argument(
        '--show-links',
        action='store_true',
        help='Show what each orphan links to'
    )
    
    args = parser.parse_args()
    
    root = Path(args.root).resolve()
    
    if not root.is_dir():
        print(f"Error: {root} is not a directory")
        return 1
    
    print(f"Scanning markdown files in: {root}\n")
    
    # Find all markdown files
    md_files = find_markdown_files(root, args.exclude)
    print(f"Found {len(md_files)} markdown files\n")
    
    # Build link graph
    graph = build_link_graph(md_files, root)
    incoming = find_incoming_links(graph)
    
    # Find orphans
    orphans = find_orphans(md_files, incoming)
    orphans.sort()
    
    print(f"=== ORPHANED FILES ({len(orphans)}) ===")
    print("These files are not linked to by any other markdown file:\n")
    
    if orphans:
        for orphan in orphans:
            rel_path = format_path(orphan, root)
            print(f"  • {rel_path}")
            
            if args.show_links and graph[orphan]:
                print(f"    Links to: {', '.join(format_path(p, root) for p in sorted(graph[orphan]))}")
    else:
        print("  (none found)")
    
    print()
    
    # Find islands
    islands = find_islands(graph, incoming, md_files)
    islands.sort(key=lambda x: len(x), reverse=True)
    
    print(f"=== ISOLATED ISLANDS ({len(islands)}) ===")
    print("These groups of files only link to each other:\n")
    
    if islands:
        for i, island in enumerate(islands, 1):
            print(f"Island {i} ({len(island)} files):")
            for file_path in sorted(island):
                rel_path = format_path(file_path, root)
                print(f"  • {rel_path}")
            print()
    else:
        print("  (none found)")
    
    return 0


if __name__ == '__main__':
    exit(main())

"""Textual TUI for k33p.

A three-pane terminal UI:
    - Left sidebar: project tree (project / subprojects / channels)
    - Main panel: details for the selected node
    - Footer: key bindings + active role

The TUI is a *viewer* in the MVP. It loads a k33p.yaml, resolves the
active view for the current role + subproject, and displays the result.
It can switch roles and subprojects, browse channels, view the lock, and
show the CAS stats. It does not (yet) modify the project.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal
from textual.reactive import reactive
from textual.widgets import Footer, Header, Static, Tree

from k33p.project import Project
from k33p.store import ContentStore

# ── sidebar tree ───────────────────────────────────────────────────────


@dataclass
class TreeEntry:
    """A row in the sidebar tree."""

    label: str
    kind: str  # project, subproject, channel, view, role
    detail: str  # secondary text for the main panel


class ProjectTree(Tree[str]):
    """The sidebar tree showing project structure."""

    def __init__(self, project: Project, **kwargs) -> None:
        super().__init__(self._root_label(project), **kwargs)
        self.project = project
        ProjectTree._populate_tree(self.project, self, self.root)

    @staticmethod
    def _root_label(project: Project) -> str:
        kind = "monorepo" if project.is_monorepo else "project"
        return f"● {project.name} ({kind})"

    @staticmethod
    def _populate_tree(project: Project, tree: ProjectTree, root) -> None:
        """Build the tree structure for a project.

        Static so it can be reused by the sidebar refresh path.
        """
        m = project.manifest
        active_role = project.active_role

        # Channels
        ch_node = root.add("📦 channels", expand=True)
        for ch_name, ch in m.channels.items():
            ch_node.add_leaf(f"  {ch_name}  ·  {ch.type.value}")

        # Subprojects (monorepo)
        if m.is_monorepo and m.subprojects:
            sp_node = root.add("🌳 subprojects", expand=True)
            for sp_name, sp in m.subprojects.items():
                sp_leaf = sp_node.add(f"  {sp_name}  ·  {sp.path}", expand=False)
                for ch_name in sp.channels:
                    sp_leaf.add_leaf(f"    {ch_name}  ·  scoped")

        # Views
        if m.views:
            v_node = root.add("🪟 views", expand=False)
            for v_name in m.views:
                v_node.add_leaf(f"  {v_name}")

        # Roles
        if m.roles:
            r_node = root.add("👤 roles", expand=True)
            for r_name, r in m.roles.items():
                view = r.view or "default"
                marker = " ★" if r_name == active_role else ""
                r_node.add_leaf(f"  {r_name}  ·  view={view}{marker}")

        # Lock
        if project.root_lock:
            lk = project.root_lock
            lk_node = root.add("🔒 lock", expand=False)
            lk_node.add_leaf(f"  generated: {lk.generated or 'unknown'}")
            lk_node.add_leaf(f"  channels pinned: {len(lk.channels)}")
            if lk.toolchain:
                t = lk.toolchain
                if t.compiler:
                    lk_node.add_leaf(f"  compiler: {t.compiler}")
                if t.build_system:
                    lk_node.add_leaf(f"  build: {t.build_system}")
            if lk.signature:
                lk_node.add_leaf(f"  signature: {lk.signature.algorithm} ✓")

        # Store
        if project.store_path:
            store = ContentStore(project.store_path)
            stats = store.stats()
            s_node = root.add("🗄️  store", expand=False)
            s_node.add_leaf(f"  objects: {stats.object_count}")
            mb = stats.total_bytes / 1024 / 1024
            s_node.add_leaf(f"  size: {mb:.1f} MB")
            s_node.add_leaf(f"  shards: {stats.shard_count}")


# ── main panel ─────────────────────────────────────────────────────────


class DetailPanel(Static):
    """The main panel showing details for the currently selected node."""

    DEFAULT_CSS = """
    DetailPanel {
        padding: 1 2;
        background: $surface;
        border: solid $primary;
    }
    """

    def __init__(self, project: Project, **kwargs) -> None:
        super().__init__(**kwargs)
        self.project = project

    def show_overview(self) -> None:
        """Show the project overview."""
        m = self.project.manifest
        lock = self.project.root_lock
        view = self.project.resolve_view()

        lines: list[str] = []
        lines.append(f"[bold]● {m.project}[/bold]  [dim]({m.type})[/dim]")
        if m.description:
            lines.append(f"[dim]{m.description}[/dim]")
        if m.org or m.team:
            loc = " / ".join(filter(None, [m.org, m.team]))
            lines.append(f"[dim]org/team:[/dim] {loc}")
        lines.append(f"[dim]manifest:[/dim] {m.path}")
        lines.append("")

        lines.append(
            f"[bold]Channels:[/bold] {len(m.channels)}  "
            f"[bold]Subprojects:[/bold] {len(m.subprojects)}  "
            f"[bold]Views:[/bold] {len(m.views)}  "
            f"[bold]Roles:[/bold] {len(m.roles)}"
        )
        lines.append("")

        active_line = (
            f"[bold]Active view:[/bold] {view.active_view}  "
            f"[bold]Role:[/bold] {self.project.active_role}"
        )
        if self.project.active_subproject:
            active_line += f"  [bold]Subproject:[/bold] {self.project.active_subproject}"
        lines.append(active_line)
        lines.append("")

        if lock:
            lines.append(f"[bold]🔒 Lock:[/bold] {lock.path}")
            if lock.toolchain:
                t = lock.toolchain
                bits = [v for v in (t.compiler, t.build_system, t.linker) if v]
                if bits:
                    lines.append(f"  toolchain: {' · '.join(bits)}")
            if lock.signature:
                lines.append(f"  signature: {lock.signature.algorithm} ✓")
        else:
            lines.append("[dim]No k33p.lock at the project root.[/dim]")

        if self.project.store_path:
            store = ContentStore(self.project.store_path)
            stats = store.stats()
            mb = stats.total_bytes / 1024 / 1024
            lines.append("")
            lines.append(
                f"[bold]🗄️  Store:[/bold] {stats.object_count} objects · "
                f"{mb:.1f} MB · {stats.shard_count} shards"
            )
        else:
            lines.append("")
            lines.append("[dim]No CAS at .k33p/store/ (project not initialized).[/dim]")

        # Subproject list (if monorepo)
        if m.is_monorepo and m.subprojects:
            lines.append("")
            lines.append(f"[bold]Subprojects ({len(m.subprojects)}):[/bold]")
            for sp_name, sp in m.subprojects.items():
                marker = " ◀" if sp_name == self.project.active_subproject else ""
                lines.append(f"  • {sp_name}  [dim]{sp.path}[/dim]{marker}")
        elif not m.is_monorepo:
            lines.append("")
            lines.append("[dim]Single project (no subprojects).[/dim]")

        self.update("\n".join(lines))

    def show_channels(self) -> None:
        """Show all channels at the project level."""
        m = self.project.manifest
        view = self.project.resolve_view()

        lines: list[str] = []
        lines.append(f"[bold]📦 Channels[/bold]  [dim]({len(m.channels)})[/dim]")
        lines.append("")

        for ch_name, ch in m.channels.items():
            ch_view = view.channels.get(ch_name)
            mount = ch_view.mount if ch_view else None
            pinned = ch_view.pinned_ref if ch_view else None
            scope = ch.scope or "(none)"

            lines.append(
                f"[bold]{ch_name}[/bold]  [dim]·[/dim]  "
                f"[cyan]{ch.type.value}[/cyan]  "
                f"[dim]·[/dim]  {ch.transport}"
            )
            lines.append(f"  [dim]scope:[/dim]     {scope}")
            lines.append(f"  [dim]visibility:[/dim] {ch.visibility.value}")
            lines.append(f"  [dim]history:[/dim]    {ch.history.value}")
            if mount:
                lines.append(f"  [dim]mount:[/dim]     {mount}  [dim](view)[/dim]")
            if pinned:
                lines.append(f"  [dim]pinned:[/dim]    {pinned}  [dim](lock)[/dim]")
            lines.append("")

        # Pointers from the live channel
        if m.pointers:
            lines.append("")
            lines.append(f"[bold orange1]🟠 Live channel pointers ({len(m.pointers)}):[/bold orange1]")
            for p_name, p in m.pointers.items():
                lines.append(f"  • {p_name}  →  {p.target}")
            lines.append("")

        self.update("\n".join(lines))

    def show_subprojects(self) -> None:
        """Show subproject details."""
        m = self.project.manifest
        lines: list[str] = []
        lines.append(f"[bold]🌳 Subprojects[/bold]  [dim]({len(m.subprojects)})[/dim]")
        lines.append("")

        for sp_name, sp in m.subprojects.items():
            marker = " ◀ active" if sp_name == self.project.active_subproject else ""
            lines.append(f"[bold]{sp_name}[/bold]  [dim]{sp.path}[/dim]{marker}")
            if sp.description:
                lines.append(f"  [dim]{sp.description}[/dim]")
            if sp.channels:
                lines.append(f"  scoped channels ({len(sp.channels)}):")
                for ch_name, ch in sp.channels.items():
                    scope = ch.scope or sp.path
                    lines.append(f"    • {ch_name}  [dim]scope={scope}[/dim]")
            if sp.daemon and sp.daemon.auto_commit:
                ac = sp.daemon.auto_commit
                lines.append(
                    f"  daemon: auto_commit debounce={ac.debounce} "
                    f"paths={','.join(ac.paths) or '(default)'}"
                )
            lines.append("")

        self.update("\n".join(lines))

    def show_views(self) -> None:
        """Show all views."""
        m = self.project.manifest
        lines: list[str] = []
        lines.append(f"[bold]🪟 Views[/bold]  [dim]({len(m.views)})[/dim]")
        lines.append("")

        for v_name, v in m.views.items():
            extends = f"  [dim]extends {v.extends}[/dim]" if v.extends else ""
            lines.append(f"[bold]{v_name}[/bold]{extends}")
            for ch_name, mount in v.channels.items():
                at = mount.at or "(unset)"
                extras = []
                if mount.history:
                    extras.append(f"history={mount.history}")
                if mount.vendored:
                    extras.append("vendored")
                if mount.install:
                    extras.append("install")
                if mount.mount:
                    extras.append(f"mount={mount.mount}")
                extra_str = f"  [dim][{' · '.join(extras)}][/dim]" if extras else ""
                lines.append(f"  • {ch_name}  →  {at}{extra_str}")
            lines.append("")

        self.update("\n".join(lines))

    def show_roles(self) -> None:
        """Show all roles."""
        m = self.project.manifest
        lines: list[str] = []
        lines.append(f"[bold]👤 Roles[/bold]  [dim]({len(m.roles)})[/dim]")
        lines.append("")

        for r_name, r in m.roles.items():
            marker = "  ★ [green]active[/green]" if r_name == self.project.active_role else ""
            view = r.view or "default"
            lines.append(f"[bold]{r_name}[/bold]{marker}")
            lines.append(f"  [dim]view:[/dim] {view}")
            if r.publish:
                lines.append(f"  [dim]publish:[/dim] {', '.join(r.publish)}")
            if r.verify:
                lines.append(f"  [dim]verify:[/dim] {r.verify}")
            lines.append("")

        self.update("\n".join(lines))

    def show_lock(self) -> None:
        """Show the lockfile contents."""
        lock = self.project.root_lock
        if lock is None:
            self.update("[dim]No k33p.lock at the project root.[/dim]")
            return

        lines: list[str] = []
        lines.append(f"[bold]🔒 Lock[/bold]  [dim]{lock.path}[/dim]")
        if lock.generated:
            lines.append(f"  [dim]generated:[/dim] {lock.generated}")
        lines.append("")

        if lock.channels:
            lines.append(f"[bold]Channel pins ({len(lock.channels)}):[/bold]")
            for ch_name, ch_lock in lock.channels.items():
                lines.append(f"  • {ch_name}  →  {ch_lock.ref}")
            lines.append("")

        if lock.toolchain:
            t = lock.toolchain
            lines.append("[bold]Toolchain:[/bold]")
            for field_name in ("compiler", "build_system", "linker", "codegen_opts", "env_hash"):
                val = getattr(t, field_name)
                if val:
                    lines.append(f"  [dim]{field_name}:[/dim] {val}")
            if t.extras:
                for k, v in t.extras.items():
                    lines.append(f"  [dim]{k}:[/dim] {v}")
            lines.append("")

        if lock.signature:
            lines.append(f"[bold]Signature:[/bold] {lock.signature.algorithm} ✓")
            lines.append(f"  [dim]key:[/dim] {lock.signature.key}")
            lines.append(f"  [dim]sig:[/dim] {lock.signature.sig[:48]}...")
        else:
            lines.append("[dim](no signature)[/dim]")

        self.update("\n".join(lines))

    def show_store(self) -> None:
        """Show the content-addressed store stats."""
        if not self.project.store_path:
            self.update("[dim]No CAS at .k33p/store/ (project not initialized).[/dim]")
            return

        store = ContentStore(self.project.store_path)
        stats = store.stats()
        mb = stats.total_bytes / 1024 / 1024
        lines: list[str] = []
        lines.append(f"[bold]🗄️  Content Store[/bold]  [dim]{store.path}[/dim]")
        lines.append("")
        lines.append(f"  [bold]Objects:[/bold]  {stats.object_count}")
        lines.append(f"  [bold]Size:[/bold]     {mb:.2f} MB")
        lines.append(f"  [bold]Shards:[/bold]   {stats.shard_count}")
        if stats.object_count > 0:
            avg = stats.total_bytes / stats.object_count
            lines.append(f"  [bold]Avg:[/bold]      {avg:.0f} bytes/object")
        self.update("\n".join(lines))


# ── main app ───────────────────────────────────────────────────────────


class K33pApp(App):
    """The k33p TUI."""

    CSS = """
    Screen {
        background: $background;
    }
    #sidebar {
        width: 36;
        border: solid $primary;
        background: $boost;
    }
    #main {
        border: solid $primary;
    }
    ProjectTree {
        padding: 0 1;
        height: 100%;
    }
    """

    BINDINGS: ClassVar[list[Binding]] = [
        Binding("q", "quit", "Quit"),
        Binding("o", "show_overview", "Overview"),
        Binding("c", "show_channels", "Channels"),
        Binding("s", "show_subprojects", "Subprojects"),
        Binding("v", "show_views", "Views"),
        Binding("r", "show_roles", "Roles"),
        Binding("l", "show_lock", "Lock"),
        Binding("t", "show_store", "Store"),
        Binding("1", "set_role('end-user')", "end-user"),
        Binding("2", "set_role('developer')", "developer"),
        Binding("3", "set_role('maintainer')", "maintainer"),
        Binding("4", "set_role('ci')", "ci"),
        Binding("5", "set_role('auditor')", "auditor"),
        Binding("n", "next_subproject", "next subproject"),
    ]

    active_panel: reactive[str] = reactive("overview", init=False)

    def __init__(self, project: Project, **kwargs) -> None:
        super().__init__(**kwargs)
        self.project = project

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Horizontal():
            tree = ProjectTree(self.project, id="sidebar")
            tree.show_root = False
            yield tree
            yield DetailPanel(self.project, id="main")
        yield Footer()

    def on_mount(self) -> None:
        self.title = f"k33p · {self.project.name}"
        self.sub_title = (
            f"{'monorepo' if self.project.is_monorepo else 'project'} · "
            f"role: {self.project.active_role}"
        )
        self._refresh_main()

    def _refresh_main(self) -> None:
        """Re-render the main panel based on the current state."""
        main = self.query_one("#main", DetailPanel)
        if self.active_panel == "overview":
            main.show_overview()
        elif self.active_panel == "channels":
            main.show_channels()
        elif self.active_panel == "subprojects":
            main.show_subprojects()
        elif self.active_panel == "views":
            main.show_views()
        elif self.active_panel == "roles":
            main.show_roles()
        elif self.active_panel == "lock":
            main.show_lock()
        elif self.active_panel == "store":
            main.show_store()

    def _refresh_sidebar(self) -> None:
        """Rebuild the sidebar tree (e.g., after role change)."""
        tree = self.query_one("#sidebar", ProjectTree)
        # Clear all children of the root and re-populate. The Textual Tree
        # API doesn't have a single "reset" method, so we walk and remove.
        root = tree.root
        for child in list(root.children):
            child.remove()
        root.set_label(ProjectTree._root_label(self.project))
        # Re-populate by calling the same logic as __init__
        ProjectTree._populate_tree(self.project, tree, root)

    # ── actions ────────────────────────────────────────────────────

    def action_show_overview(self) -> None:
        self.active_panel = "overview"
        self._refresh_main()

    def action_show_channels(self) -> None:
        self.active_panel = "channels"
        self._refresh_main()

    def action_show_subprojects(self) -> None:
        self.active_panel = "subprojects"
        self._refresh_main()

    def action_show_views(self) -> None:
        self.active_panel = "views"
        self._refresh_main()

    def action_show_roles(self) -> None:
        self.active_panel = "roles"
        self._refresh_main()

    def action_show_lock(self) -> None:
        self.active_panel = "lock"
        self._refresh_main()

    def action_show_store(self) -> None:
        self.active_panel = "store"
        self._refresh_main()

    def action_set_role(self, role: str) -> None:
        if role in self.project.manifest.roles:
            self.project.set_role(role)
            self.sub_title = (
                f"{'monorepo' if self.project.is_monorepo else 'project'} · "
                f"role: {self.project.active_role}"
            )
            self._refresh_sidebar()
            self._refresh_main()
            self.notify(f"role: {role}")

    def action_next_subproject(self) -> None:
        """Cycle through subprojects (monorepo only)."""
        if not self.project.is_monorepo:
            self.notify("not a monorepo")
            return
        names = list(self.project.manifest.subprojects.keys())
        if not names:
            return
        current = self.project.active_subproject
        if current is None:
            self.project.set_subproject(names[0])
        else:
            idx = names.index(current) if current in names else -1
            next_idx = (idx + 1) % len(names)
            self.project.set_subproject(names[next_idx])
        self._refresh_sidebar()
        self._refresh_main()
        self.notify(f"subproject: {self.project.active_subproject or '(root)'}")

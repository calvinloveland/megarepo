"""Smoke test for the `conways_game_of_war.main` entry point.

The entry point used to crash on startup with::

    NameError: name 'threading' is not defined

because the `threading` module was used but not imported. This test
calls `main()` with Flask's blocking `app.run` replaced by a stub, so
the regression is caught immediately on import/startup without needing
a live HTTP server.
"""

from conways_game_of_war import main


def test_main_starts_without_nameerror(monkeypatch):
    """main() must import all modules it references and start Flask.

    Regression guard: catches a missing import in main.py (such as the
    `threading` import that was added when the cleanup thread was
    introduced) by simply running the entry point and asserting it
    reaches `app.run`.
    """
    run_calls = []

    def fake_run(host, port, debug):
        run_calls.append((host, port, debug))

    monkeypatch.setattr(main.app, "run", fake_run)

    # Should not raise NameError or any other exception.
    # Pass an explicit empty argv so pytest's own CLI args (e.g. -q, -v)
    # don't leak into argparse.
    main.main([])

    assert run_calls, "main() never reached app.run"
    host, port, debug = run_calls[0]
    assert host == "127.0.0.1"
    assert port == 5000
    assert debug is True


def test_main_honors_env_overrides(monkeypatch):
    """HOST, PORT, and FLASK_DEBUG env vars flow through to app.run."""
    monkeypatch.setenv("HOST", "0.0.0.0")
    monkeypatch.setenv("PORT", "8080")
    monkeypatch.setenv("FLASK_DEBUG", "false")

    run_calls = []
    monkeypatch.setattr(
        main.app, "run", lambda host, port, debug: run_calls.append((host, port, debug))
    )

    # Pass an explicit empty argv so pytest's own CLI args (e.g. -q, -v)
    # don't leak into argparse.
    main.main([])

    assert run_calls == [("0.0.0.0", 8080, False)]


def test_main_accepts_host_cli_flag(monkeypatch):
    """--host CLI flag binds the server to the given interface."""
    run_calls = []
    monkeypatch.setattr(
        main.app, "run", lambda host, port, debug: run_calls.append((host, port, debug))
    )

    main.main(["--host", "0.0.0.0"])

    assert run_calls == [("0.0.0.0", 5000, True)]


def test_main_accepts_hosts_alias(monkeypatch):
    """--hosts is accepted as a typo-friendly alias for --host."""
    run_calls = []
    monkeypatch.setattr(
        main.app, "run", lambda host, port, debug: run_calls.append((host, port, debug))
    )

    main.main(["--hosts", "0.0.0.0"])

    assert run_calls == [("0.0.0.0", 5000, True)]


def test_main_host_cli_overrides_env(monkeypatch):
    """CLI flags win over the matching environment variables."""
    monkeypatch.setenv("HOST", "127.0.0.1")
    run_calls = []
    monkeypatch.setattr(
        main.app, "run", lambda host, port, debug: run_calls.append((host, port, debug))
    )

    main.main(["--host", "0.0.0.0"])

    assert run_calls[0][0] == "0.0.0.0"


def test_main_accepts_port_cli_flag(monkeypatch):
    """--port CLI flag sets the listening port."""
    run_calls = []
    monkeypatch.setattr(
        main.app, "run", lambda host, port, debug: run_calls.append((host, port, debug))
    )

    main.main(["--port", "8080"])

    assert run_calls[0][1] == 8080


def test_main_no_debug_flag(monkeypatch):
    """--no-debug disables Flask debug mode even if FLASK_DEBUG=true."""
    monkeypatch.setenv("FLASK_DEBUG", "true")
    run_calls = []
    monkeypatch.setattr(
        main.app, "run", lambda host, port, debug: run_calls.append((host, port, debug))
    )

    main.main(["--no-debug"])

    assert run_calls[0][2] is False

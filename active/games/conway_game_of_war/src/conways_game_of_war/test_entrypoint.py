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
    main.main()

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

    main.main()

    assert run_calls == [("0.0.0.0", 8080, False)]

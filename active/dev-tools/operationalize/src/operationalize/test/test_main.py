"""Tests for the operationalize.main Flask app."""

import pytest

from operationalize.main import app


@pytest.fixture
def client():
    """Provide a Flask test client for the application."""
    with app.test_client() as client:
        yield client


def test_index(client):
    response = client.get("/")
    assert response.status_code == 200

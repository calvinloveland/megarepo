"""Tests for webhook handlers."""

import hashlib
import hmac
import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from src.webhook import WebhookHandler


class TestWebhookHandler(unittest.TestCase):
    """Test the webhook handler."""

    def _verify_signature(self, provider, headers, payload, raw_body=None):
        """Invoke the internal signature verifier for targeted tests."""
        verify = getattr(self.webhook_handler, "_verify_signature")
        return verify(provider, headers, payload, raw_body=raw_body)

    def _run_provider_handler(self, provider, headers, payload):
        """Invoke a provider-specific internal webhook handler."""
        handler = getattr(self.webhook_handler, f"_handle_{provider}")
        return handler(headers, payload)

    def setUp(self):
        """Set up the test environment."""
        # Create a temporary database
        with tempfile.NamedTemporaryFile(delete=False) as temp_db:
            self.db_path = temp_db.name

        # Create the test tables
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE repositories (
                id INTEGER PRIMARY KEY,
                url TEXT NOT NULL,
                name TEXT NOT NULL,
                branch TEXT NOT NULL DEFAULT 'main',
                status TEXT NOT NULL DEFAULT 'active',
                last_check INTEGER
            )
        """
        )
        cursor.execute(
            """
            CREATE TABLE test_runs (
                id INTEGER PRIMARY KEY,
                repository_id INTEGER NOT NULL,
                commit_hash TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (repository_id) REFERENCES repositories (id)
            )
        """
        )
        conn.commit()

        # Insert test repository
        cursor.execute(
            "INSERT INTO repositories (url, name, branch) VALUES (?, ?, ?)",
            ("https://github.com/octocat/Hello-World.git", "Hello-World", "main"),
        )
        cursor.execute(
            "INSERT INTO repositories (url, name, branch) VALUES (?, ?, ?)",
            ("https://gitlab.com/example/Project.git", "Project", "main"),
        )
        cursor.execute(
            "INSERT INTO repositories (url, name, branch) VALUES (?, ?, ?)",
            ("https://bitbucket.org/workspace/repo.git", "repo", "main"),
        )
        conn.commit()
        conn.close()

        # Create webhook handler with secret
        self.webhook_secret = "test_secret"
        self.webhook_handler = WebhookHandler(
            db_path=self.db_path, secret=self.webhook_secret
        )

    def tearDown(self):
        """Clean up the test environment."""
        os.unlink(self.db_path)

    def test_verify_signature_github(self):
        """Test GitHub signature verification."""
        # Create test payload
        payload = {"test": "data"}
        payload_bytes = json.dumps(payload).encode("utf-8")

        # Create signature
        hmac_obj = hmac.new(
            self.webhook_secret.encode("utf-8"), payload_bytes, hashlib.sha256
        )
        signature = f"sha256={hmac_obj.hexdigest()}"

        # Test valid signature
        headers = {"X-Hub-Signature-256": signature}
        self.assertTrue(self._verify_signature("github", headers, payload))

        # Test invalid signature
        headers = {"X-Hub-Signature-256": "sha256=invalid"}
        self.assertFalse(self._verify_signature("github", headers, payload))

        # Test missing signature
        headers = {}
        self.assertFalse(self._verify_signature("github", headers, payload))

    def test_verify_signature_github_uses_raw_body_bytes(self):
        """GitHub signs the raw wire bytes, not a re-serialized dict.

        Construct a compact raw body whose ``json.dumps`` re-serialization
        differs (no space after the colon) and confirm verification succeeds
        only when the raw bytes are supplied.
        """
        raw_body = b'{"test":"data"}'  # compact — differs from json.dumps default
        payload = json.loads(raw_body)
        # Sanity: re-serialization would NOT match the raw bytes.
        self.assertNotEqual(json.dumps(payload).encode("utf-8"), raw_body)

        # Signature over the *raw* bytes (what GitHub actually sends).
        sig = hmac.new(
            self.webhook_secret.encode("utf-8"), raw_body, hashlib.sha256
        ).hexdigest()
        headers = {"X-Hub-Signature-256": f"sha256={sig}"}

        # With raw_body supplied: valid.
        self.assertTrue(
            self._verify_signature("github", headers, payload, raw_body=raw_body)
        )
        # Without raw_body (legacy path): the signature computed over raw bytes
        # no longer matches the re-serialized payload, so it must be rejected.
        self.assertFalse(self._verify_signature("github", headers, payload))

    def test_handle_github_rejects_replayed_raw_body_mismatch(self):
        """End-to-end: handle() must reject a signature computed over raw
        bytes when raw_body is supplied and doesn't match."""
        raw_body = b'{"a": 1, "b": 2}'
        payload = json.loads(raw_body)
        bogus_sig = "sha256=" + "0" * 64
        headers = {"X-Hub-Signature-256": bogus_sig, "X-GitHub-Event": "push"}
        result = self.webhook_handler.handle(
            "github", headers, payload, raw_body=raw_body
        )
        self.assertIsNone(result)

    def test_verify_signature_gitlab(self):
        """Test GitLab signature verification."""
        # Create test payload
        payload = {"test": "data"}

        # Test valid token
        headers = {"X-Gitlab-Token": self.webhook_secret}
        self.assertTrue(self._verify_signature("gitlab", headers, payload))

        # Test invalid token
        headers = {"X-Gitlab-Token": "invalid"}
        self.assertFalse(self._verify_signature("gitlab", headers, payload))

        # Test missing token
        headers = {}
        self.assertFalse(self._verify_signature("gitlab", headers, payload))

    def test_handle_github_non_push_event(self):
        """Test handling GitHub non-push event."""
        # Create test payload
        payload = {
            "repository": {
                "full_name": "octocat/Hello-World",
                "clone_url": "https://github.com/octocat/Hello-World.git",
            }
        }

        # Test non-push event
        headers = {"X-GitHub-Event": "issue"}
        result = self._run_provider_handler("github", headers, payload)
        self.assertIsNone(result)

    def test_handle_missing_repository_info(self):
        """Test handling webhook with missing repository info."""
        # Create test payload with missing repository info
        payload = {
            "repository": {},
            "commits": [
                {
                    "id": "0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c",
                    "author": {"name": "Test User", "email": "test@example.com"},
                    "message": "Test commit",
                    "timestamp": "2023-01-01T12:00:00Z",
                }
            ],
        }

        # Test with push event but missing repository info
        headers = {"X-GitHub-Event": "push"}
        result = self._run_provider_handler("github", headers, payload)
        self.assertIsNone(result)

    def test_handle_github_push_success(self):
        """Test handling a GitHub push event."""
        payload = {
            "repository": {
                "full_name": "octocat/Hello-World",
                "clone_url": "https://github.com/octocat/Hello-World.git",
            },
            "commits": [
                {
                    "id": "abc123",
                    "author": {"name": "Octo", "email": "octo@example.com"},
                    "message": "Update README",
                    "timestamp": "2023-01-01T12:00:00Z",
                }
            ],
        }
        headers = {"X-GitHub-Event": "push"}

        result = self._run_provider_handler("github", headers, payload)

        self.assertIsNotNone(result)
        self.assertEqual(result["provider"], "github")
        self.assertEqual(result["hash"], "abc123")
        self.assertEqual(result["author"], "Octo")

    def test_handle_gitlab_push_success(self):
        """Test handling a GitLab push event."""
        payload = {
            "project": {
                "path_with_namespace": "example/Project",
                "git_http_url": "https://gitlab.com/example/Project.git",
            },
            "commits": [
                {
                    "id": "def456",
                    "author": {"name": "GitLab", "email": "gl@example.com"},
                    "message": "Add feature",
                    "timestamp": "2023-01-02T10:00:00Z",
                }
            ],
        }
        headers = {"X-Gitlab-Event": "Push Hook"}

        result = self._run_provider_handler("gitlab", headers, payload)

        self.assertIsNotNone(result)
        self.assertEqual(result["provider"], "gitlab")
        self.assertEqual(result["hash"], "def456")

    def test_handle_bitbucket_push_success(self):
        """Test handling a Bitbucket push event."""
        payload = {
            "repository": {
                "full_name": "workspace/repo",
                "links": {"html": {"href": "https://bitbucket.org/workspace/repo"}},
            },
            "push": {
                "changes": [
                    {
                        "commits": [
                            {
                                "hash": "ff99aa",
                                "author": {
                                    "user": {"display_name": "Bit Bucket"},
                                    "raw": "Bit Bucket <bb@example.com>",
                                },
                                "message": "Fix bug",
                                "date": "2023-01-03T09:30:00Z",
                            }
                        ]
                    }
                ]
            },
        }
        headers = {"X-Event-Key": "repo:push"}

        result = self._run_provider_handler("bitbucket", headers, payload)

        self.assertIsNotNone(result)
        self.assertEqual(result["provider"], "bitbucket")
        self.assertEqual(result["hash"], "ff99aa")
        self.assertEqual(result["author_email"], "bb@example.com")

    @patch("src.webhook.WebhookHandler._handle_github")
    def test_handle_method(self, mock_handle_github):
        """Test the handle method."""
        # Set up the mock
        mock_handle_github.return_value = {"test": "result"}
        self.webhook_handler.handlers["github"] = mock_handle_github

        # Create test payload and headers
        payload = {"test": "data"}
        headers = {"X-GitHub-Event": "push"}

        signature = hmac.new(
            self.webhook_secret.encode("utf-8"),
            json.dumps(payload).encode("utf-8"),
            hashlib.sha256,
        )
        headers["X-Hub-Signature-256"] = f"sha256={signature.hexdigest()}"

        # Call the handle method
        result = self.webhook_handler.handle("github", headers, payload)

        # Check that the correct handler was called
        mock_handle_github.assert_called_once_with(headers, payload)

        # Check that the result is correct
        self.assertEqual(result, {"test": "result"})


if __name__ == "__main__":
    unittest.main()

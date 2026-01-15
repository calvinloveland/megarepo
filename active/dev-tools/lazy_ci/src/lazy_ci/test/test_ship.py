import unittest
from unittest.mock import mock_open, patch

from lazy_ci import ship


class TestBumpVersion(unittest.TestCase):
    @patch("subprocess.run")
    def test_bump_version_success(self, mock_run):
        mock_run.return_value.returncode = 0
        self.assertTrue(ship.bump_version())

    @patch("subprocess.run")
    def test_bump_version_fail_no_version_file(self, mock_run):
        mock_run.return_value.returncode = 1
        with patch("os.walk") as mock_walk:
            mock_walk.return_value = [(".", [], [])]
            self.assertFalse(ship.bump_version())

    @patch("subprocess.run")
    @patch("os.walk")
    @patch("builtins.open", new_callable=mock_open, read_data="1.0.0")
    def test_bump_version_fail_bump_version_file(self, mock_file, mock_walk, mock_run):
        mock_run.return_value.returncode = 1
        mock_walk.return_value = [(".", [], ["version.py"])]
        with patch("builtins.open", mock_file, create=True):
            self.assertTrue(ship.bump_version(should_tag=False))
            mock_file().write.assert_called_once_with("1.0.1")


if __name__ == "__main__":
    unittest.main()

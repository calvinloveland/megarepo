#!/bin/bash
# Fix file permissions after container UID/GID changes

echo "🔧 Fixing file permissions in megarepo..."

# Fix .venv if it exists
if [ -d ".venv" ]; then
    echo "  Fixing .venv ownership..."
    sudo chown -R calvin:users .venv
fi

# Fix .playwright_browsers if it exists
if [ -d ".playwright_browsers" ]; then
    echo "  Fixing .playwright_browsers ownership..."
    sudo chown -R calvin:users .playwright_browsers
fi

# Fix any remaining files owned by old container user (100999)
echo "  Fixing any remaining files from old container user..."
sudo find . -user 100999 -exec chown calvin:users {} + 2>/dev/null || true

echo "✅ Permissions fixed!"
echo ""
echo "Verifying..."
remaining=$(find . -not -user calvin 2>/dev/null | wc -l)
echo "Files not owned by calvin: $remaining"

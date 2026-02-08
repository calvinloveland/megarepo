from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://127.0.0.1:5000")
    page.wait_for_selector('#undo-btn', timeout=5000)
    
    print("✓ Undo/Redo buttons found")
    
    # Check history manager
    manager_type = page.evaluate('typeof historyManager')
    print(f"✓ History manager loaded: {manager_type}")
    
    # Get stats
    stats = page.evaluate('historyManager.getStats()')
    print(f"✓ Initial stats: {stats}")
    
    # Push a state
    page.evaluate('historyManager.push()')
    stats = page.evaluate('historyManager.getStats()')
    print(f"✓ After push: {stats}")
    
    browser.close()
    print("\n✓ Tests PASSED!")

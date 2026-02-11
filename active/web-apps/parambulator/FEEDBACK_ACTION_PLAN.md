# Parambulator Feedback - Action Plan

**Generated**: 2026-02-11
**Total Real Feedback Items**: 13
**Status**: All items unaddressed

## Priority 1: Critical UX Issues

### 1. Feedback System Bugs
**Issue**: Feedback element selector broken
- "The feedback element selector button still says 'click to select element after selecting an option'"
- "Selecting the feedback button with the element selector seems to break the feedback input"

**Action**: 
- Fix button text to update correctly after selection
- Prevent feedback form from breaking when selector is used on feedback button itself
- Add defensive logic to exclude feedback UI elements from selection

**Files to modify**: Feedback JavaScript handler in templates

---

### 2. Duplicate Title Row Bug
**Issue**: "This first row is the title row repeated for some reason"

**Action**:
- Debug table rendering logic
- Check if header row is being duplicated in people table
- Review template partials for table generation

**Files to check**: `templates/partials/people_table.html` or similar

---

## Priority 2: High-Value Feature Requests

### 3. Enhanced Table/Column Configuration
**Issue**: Multiple requests for better column management
- "This table should have a separate column for each item. There should be a dropdown selector for how to treat each column and a plus button to add more columns."
- "For each of the columns make them selectable to edit their behaviour. possible options, weighting in the final score and what type the column is (avoid, mix, group, directional)"
- "there should be a way to add additional constraints or edit existing ones"

**Current State**: Column configuration is hardcoded in `app.py` as `DEFAULT_COLUMN_CONFIG`

**Action**:
- Create UI for dynamic column configuration
- Allow users to:
  - Add new columns
  - Remove existing columns
  - Set column type (mix, avoid, group, directional)
  - Adjust weight per column
- Store column config in state/saves

**Implementation Estimate**: Medium complexity (4-6 hours)
**Files to modify**: 
- `app.py` - Add column config to state
- `templates/` - New UI for column editor
- `scoring.py` - Ensure dynamic column handling works

---

### 4. Grid Layout Improvements
**Issue**: Grid editor needs better UX
- "Make these checkmarks into buttons instead. add the ability to expand the grid in any direction. Remove the text input. Add the ability to duplicate a row or column to make it easier to make patterns"
- "These should be buttons instead of checkboxes maybe even a canvas where you can paint seats"

**Action**:
- Replace checkboxes with button-style toggles
- Add resize controls (add/remove rows/cols from any edge)
- Add row/column duplication feature
- Consider canvas-based "painting" mode for advanced users

**Implementation Estimate**: Medium complexity (6-8 hours)
**Files to modify**: 
- Layout editor template
- Layout editing JavaScript/HTMX handlers
- CSS for button styling

---

## Priority 3: Polish & Metadata

### 5. Design Contrast Issue (Design 4)
**Issue**: "the texture in this background is good but it generally has poor contrast on all the text"

**Action**:
- Review design-4 CSS
- Increase text contrast
- Consider text shadows or background overlays
- Test with accessibility tools

**Files to modify**: `static/design-4.css` or template

---

### 6. Version Tracking in Feedback
**Issue**: "Feedback should automatically come back with the version the feedback is from"

**Action**:
- Add version field to feedback JSON
- Could use git commit hash or version number
- Store in environment variable or auto-generate

**Implementation**:
```python
# In app.py feedback handler
feedback_data = {
    "feedback_text": text,
    "selected_element": element,
    "design": design,
    "timestamp": timestamp,
    "version": os.getenv("APP_VERSION", "unknown"),
    "git_commit": os.getenv("GIT_COMMIT", "unknown"),
    "addressed": False
}
```

---

## Lower Priority: Informational Feedback

### 7-10. Test Feedback (Various)
These appear to be smoke tests confirming the feedback system works. No action needed.

---

## Implementation Order

1. **Fix feedback selector bugs** (30 min) - Highest impact, blocks feedback collection
2. **Fix duplicate title row** (30 min) - Visual bug, easy win
3. **Add version to feedback** (15 min) - Quick metadata improvement
4. **Design 4 contrast fix** (30 min) - Accessibility improvement
5. **Dynamic column configuration** (4-6 hours) - High-value feature
6. **Grid layout improvements** (6-8 hours) - High-value UX enhancement

**Total Estimated Time**: 12-15 hours for all items

---

## Marking Feedback as Addressed

When implementing a fix, update the feedback JSON:
```python
# Move to addressed directory
import shutil
feedback_file = FEEDBACK_DIR / "feedback_TIMESTAMP.json"
addressed_file = ADDRESSED_DIR / feedback_file.name

# Update and move
with open(feedback_file) as f:
    data = json.load(f)
data["addressed"] = True
data["addressed_date"] = datetime.utcnow().isoformat()
data["implementation_notes"] = "Fixed in commit abc123"

with open(addressed_file, "w") as f:
    json.dump(data, f, indent=2)

feedback_file.unlink()
```

---

## Related Documentation
- [Parambulator README](README.md)
- [Security Review](SECURITY_REVIEW.md)
- [Deployment Guide](DEPLOYMENT.md)

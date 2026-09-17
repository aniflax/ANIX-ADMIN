# Frontend Cache & Build Issues - FIX GUIDE

## Issue: Progress Bar & HOD Changes Not Showing

### Quick Fix (Do This First)

**Step 1: Stop both servers**
```bash
# Kill frontend dev server
# Kill backend server
```

**Step 2: Clear Node cache**
```bash
cd frontend
rm -rf node_modules/.vite
npm run dev
```

**Step 3: Full browser cache clear**
- Open DevTools (F12)
- Right-click refresh button → "Empty cache and hard refresh"
- OR: Ctrl+Shift+Delete → Clear browsing data

**Step 4: Restart backend**
```bash
cd backend
python -m app.main
# Or: python app/main.py
```

---

## Changes Applied

### ✅ Progress Bar (EmployeeDirectoryRecordView.jsx)
- **Line 328-329**: Added `width: '100%'` and `gap: 0`
- **Line 374**: Changed `mx: -0.5` → `mx: 0`
- **Expected**: Progress bar should span full width

### ✅ Remove Button (Departments.jsx)
- **Function deactivateEmployee**: Changed from deactivate to remove from department
- **Button**: Changed text from "Deactivate" → "Remove"
- **Action**: Sets `department_id = null` and downgrades to EMPLOYEE if needed

### ✅ HOD Badge
- **Lines 502-507**: Chip badge displays when `viewDept?.hod_id === s.id`
- **Expected**: Red "HOD" badge next to current HOD name

### ✅ Data Fixed
- All HODs now have departments assigned
- Ran fix script - data is clean!

---

## Verification Checklist

After applying fixes:

```
[ ] Progress bar spans full width (edge to edge)
[ ] HOD Badge shows red chip next to department head
[ ] "Remove" button appears instead of "Deactivate" 
[ ] Clicking Remove removes employee from department
[ ] Allocated employees dropdown shows only unassigned
[ ] Dropdown updates immediately after removal
```

---

## If Still Not Working

### Option A: Manual npm rebuild
```bash
cd frontend
npm run build
npm run preview  # Test production build
```

### Option B: Clear .next/.vite completely
```bash
cd frontend
rm -rf .vite dist node_modules/.vite
npm install
npm run dev
```

### Option C: Check for conflicting tabs
- Make sure you're not running multiple frontend instances
- Check port 5173 isn't bound to old process: `lsof -i :5173`

---

## If CSS Isn't Updating

Edit `frontend/vite.config.js` and ensure HMR is configured:
```js
export default {
  server: {
    middlewareMode: false,
    hmr: {
      host: 'localhost',
      port: 5173
    }
  }
}
```

Then restart with: `npm run dev -- --host`

"""
Convert a gym-plan backup JSON from legacy format to compact format.
Usage: python convert_backup.py [input.json]
Writes output to the same directory with '-compact' suffix.
"""
import json, sys, os

def is_empty_set(s):
    return (s.get("s", "") in ("", None)) and s.get("w") is None and s.get("r") is None

def compact_set(s):
    out = {"s": s.get("s", "")}
    if s.get("w") is not None:              out["w"] = s["w"]
    if s.get("r") is not None:              out["r"] = s["r"]
    if s.get("n") not in (None, ""):        out["n"] = s["n"]
    if s.get("rir") is not None:            out["rir"] = s["rir"]
    if s.get("rom") not in (None, "full"):  out["rom"] = s["rom"]
    if s.get("completedAt") is not None:    out["t"] = s["completedAt"]
    return out

def compact_exercises(exercises):
    out = {}
    for key, sets in exercises.items():
        if not isinstance(sets, list):
            continue
        if all(is_empty_set(s) for s in sets):
            continue
        out[key] = [compact_set(s) for s in sets]
    return out

def compact_export(state):
    out = {**state, "format": "compact"}
    out["exercises"] = compact_exercises(state.get("exercises", {}))
    if isinstance(state.get("history"), list):
        out["history"] = [
            {**entry, "exercises": compact_exercises(entry.get("exercises", {}))}
            for entry in state["history"]
        ]
    return out

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "gym-plan-backup_061326.json"
    with open(src, "r", encoding="utf-8") as f:
        data = json.load(f)

    compact = compact_export(data)

    base, ext = os.path.splitext(src)
    dst = f"{base}-compact{ext}"
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(compact, f, indent=2)

    orig_size = os.path.getsize(src)
    new_size = os.path.getsize(dst)
    print(f"Original: {orig_size:,} bytes")
    print(f"Compact:  {new_size:,} bytes")
    print(f"Savings:  {(1 - new_size / orig_size) * 100:.1f}%")
    print(f"Written:  {dst}")

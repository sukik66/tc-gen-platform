import json, sys, os

args_file = r"f:\SuperAI\ai-test-platform\data\_ast_grep_args.json"
with open(args_file, encoding="utf-8") as f:
    d = json.load(f)

sys.argv = [
    "ast_grep_scan.py",
    json.dumps(d["files"]),
    json.dumps(d["classes"]),
]

script_path = r"f:\SuperAI\.cursor\skills\quality-contract-review\scripts\ast_grep_scan.py"
sys.path.insert(0, os.path.dirname(script_path))

# run the script as __main__
import runpy
runpy.run_path(script_path, run_name="__main__")

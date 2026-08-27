import argparse
import json
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


parser = argparse.ArgumentParser(description="Run the real generation flow through the browser UI.")
parser.add_argument("--provider", required=True)
parser.add_argument("--model", required=True)
parser.add_argument("--url", default="http://127.0.0.1:5173/generation")
parser.add_argument("--timeout-seconds", type=int, default=420)
args = parser.parse_args()

requirement = """Login requirements:
- Account length: 1 to 20 characters.
- Password length: 8 to 32 characters.
- Correct credentials open the home page.
- Incorrect credentials show a unified error.
- Lock the account after 5 consecutive failures for 10 minutes.
- Correct credentials are rejected while locked; login is allowed again after 10 minutes.
"""

out_dir = Path(__file__).resolve().parents[1] / ".tmp-ui"
out_dir.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    provider_json = json.dumps(args.provider)
    model_json = json.dumps(args.model)
    context.add_init_script(
        script=(
            f"const provider = {provider_json}; const model = {model_json};"
            "localStorage.setItem('ai-test-platform.llmProvider', provider);"
            "localStorage.setItem('ai-test-platform.llmModel.' + provider, model);"
        )
    )
    page = context.new_page()
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text) if message.type == "error" else None,
    )
    page.goto(args.url, wait_until="networkidle")

    page.get_by_test_id("llm-provider-select").select_option(args.provider)
    page.get_by_test_id("llm-model-select").select_option(args.model)
    page.locator('input[type="file"]').first.set_input_files(
        files=[
            {
                "name": "real-main-flow-requirement.txt",
                "mimeType": "text/plain",
                "buffer": requirement.encode("utf-8"),
            }
        ]
    )

    generate_button = page.get_by_role("button", name="生成测试用例")
    generate_button.wait_for(state="visible")
    assert generate_button.is_enabled(), "Generation button did not become enabled"
    generate_button.click()

    deadline = time.monotonic() + args.timeout_seconds
    completed_button = page.get_by_role(
        "button",
        name=re.compile("覆盖生成完成|继续补充未覆盖用例"),
    )
    error_heading = page.get_by_role("heading", name="生成出错")
    interruption_heading = page.get_by_role("heading", name="生成中断")
    while time.monotonic() < deadline:
        if error_heading.count() and error_heading.is_visible():
            modal = page.locator('[role="dialog"]').last
            detail = modal.inner_text() if modal.count() else page.locator("body").inner_text()
            raise AssertionError(f"Real generation failed in the UI: {detail[:1200]}")
        if interruption_heading.count() and interruption_heading.is_visible():
            modal = page.locator('[role="dialog"]').last
            detail = modal.inner_text() if modal.count() else page.locator("body").inner_text()
            raise AssertionError(f"Real generation was interrupted in the UI: {detail[:1200]}")
        case_count = page.get_by_test_id("generated-case-count")
        if (
            completed_button.count()
            and completed_button.is_visible()
            and case_count.count()
            and int(case_count.inner_text()) > 0
            and page.get_by_test_id("generation-progress").count() == 0
        ):
            break
        page.wait_for_timeout(1000)
    else:
        raise AssertionError("Timed out waiting for the real generation result to reach the UI")

    coverage = page.get_by_test_id("coverage-summary")
    coverage.wait_for(state="visible")
    coverage_text = " ".join((coverage.inner_text() or "").split())
    assert coverage_text, "Coverage summary is empty after generation"
    assert not console_errors, f"Browser console errors: {console_errors}"
    page.screenshot(path=str(out_dir / "generation-real-main-flow.png"), full_page=True)

    print(f"provider={args.provider}")
    print(f"model={args.model}")
    print(f"coverage={coverage_text}")
    print("real browser generation flow: passed")
    context.close()
    browser.close()

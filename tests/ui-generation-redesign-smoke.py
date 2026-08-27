from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".tmp-ui"
OUT.mkdir(exist_ok=True)


def inspect(page, width: int, height: int, name: str):
    errors = []
    page.on(
        "console",
        lambda message: errors.append(f"{message.text} @ {message.location}")
        if message.type == "error"
        else None,
    )
    page.route(
        "**/api/llm-providers",
        lambda route: route.fulfill(
            status=200,
            json={
                "serverDefaultProvider": "smoke-provider",
                "providers": [{
                    "id": "smoke-provider",
                    "label": "Smoke Provider",
                    "ready": True,
                    "model": "smoke-model",
                    "availableModels": ["smoke-model"],
                    "custom": False,
                }],
            },
        ),
    )
    page.route("**/api/rag/health*", lambda route: route.fulfill(status=200, json={"ok": False}))
    page.route("**/api/repos", lambda route: route.fulfill(status=200, json=[]))
    page.route("**/api/repos/init-defaults", lambda route: route.fulfill(status=200, json=[]))
    page.set_viewport_size({"width": width, "height": height})
    page.goto("http://127.0.0.1:5173/generation", wait_until="networkidle")

    assert page.get_by_role("heading", name="测试用例生成").is_visible()
    assert page.get_by_role("button", name="生成测试用例").count() == 1
    assert page.get_by_text("生成测试点（REQ/TP）", exact=True).count() == 0
    assert page.get_by_text("预览完整 Prompt（含代码变更+知识库）", exact=True).count() == 0
    assert page.get_by_text("启用代码预分析（多步 Agent）", exact=True).count() == 0
    assert page.get_by_text("本次会话快照", exact=True).count() == 0

    page.get_by_role("button", name="运行详情").click()
    assert page.get_by_test_id("run-details").is_visible()
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
    assert overflow <= 1, f"horizontal overflow: {overflow}px"
    assert not errors, f"console errors: {errors}"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    inspect(browser.new_page(), 1365, 768, "generation-desktop")
    inspect(browser.new_page(), 390, 844, "generation-mobile")
    browser.close()

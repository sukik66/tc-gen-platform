from pathlib import Path

from playwright.sync_api import Route, sync_playwright


ARTIFACTS = Path("test-artifacts")
ARTIFACTS.mkdir(exist_ok=True)


def main() -> None:
    captured: dict[str, object] = {}
    console_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

        def intercept_config(route: Route) -> None:
            if route.request.method == "PUT":
                captured["config"] = route.request.post_data_json
                route.fulfill(status=200, content_type="application/json", body="{}")
            else:
                route.continue_()

        def intercept_repo(route: Route) -> None:
            if route.request.method == "POST":
                if captured.get("abort_repo_save"):
                    route.abort("connectionrefused")
                    return
                body = route.request.post_data_json
                captured["repo"] = body
                route.fulfill(status=200, content_type="application/json", json=body)
            elif route.request.method == "DELETE":
                captured["repo_deleted"] = route.request.url
                route.fulfill(status=200, content_type="application/json", json={"ok": True})
            else:
                route.continue_()

        def intercept_custom_provider(route: Route) -> None:
            if route.request.method == "GET":
                route.continue_()
            elif route.request.url.endswith("/discover-models"):
                captured["models_discovered"] = route.request.post_data_json
                route.fulfill(status=200, content_type="application/json", json={"models": ["smoke-chat", "smoke-reasoner", "smoke-chat"]})
            elif route.request.url.endswith("/test"):
                captured["provider_tested"] = route.request.url
                route.fulfill(status=200, content_type="application/json", json={"ok": True, "latencyMs": 42, "model": "smoke-model", "reply": "OK"})
            elif route.request.method == "DELETE":
                captured["provider_deleted"] = route.request.url
                route.fulfill(status=200, content_type="application/json", json={"ok": True})
            else:
                body = route.request.post_data_json
                captured["provider"] = body
                configured = bool(body.get("apiKey")) or bool(body.get("apiKeyStatus", {}).get("configured"))
                route.fulfill(status=200, content_type="application/json", json={**body, "apiKey": {"configured": configured, "preview": "••••••••"}})

        def intercept_llm_providers(route: Route) -> None:
            route.fulfill(
                status=200,
                content_type="application/json",
                json={
                    "serverDefaultProvider": "openai",
                    "providers": [
                        {"id": "openai", "label": "OpenAI", "ready": True, "model": "gpt-default", "availableModels": ["gpt-default"]},
                        {"id": "custom-smoke", "label": "Smoke Gateway", "ready": True, "model": "smoke-chat", "availableModels": ["smoke-chat", "smoke-reasoner"]},
                    ],
                },
            )

        page.route("**/api/config", intercept_config)
        page.route("**/api/repos", intercept_repo)
        page.route("**/api/repos/*", intercept_repo)
        page.route("**/api/custom-providers*", intercept_custom_provider)
        page.route("**/api/custom-providers/**", intercept_custom_provider)
        page.route("**/api/llm-providers", intercept_llm_providers)
        page.goto("http://127.0.0.1:5173/generation")
        page.wait_for_load_state("networkidle")

        assert page.get_by_text("保存输入快照").count() == 0
        assert page.get_by_text("应用快照").count() == 0
        assert page.get_by_text("Cursor 辅助", exact=False).count() == 0
        assert page.get_by_text("大模型通道", exact=True).count() == 0

        # Runtime model decision table: single-model and multi-model providers.
        picker = page.get_by_test_id("generation-model-picker")
        assert picker.is_visible()
        provider_select = page.get_by_test_id("llm-provider-select")
        model_select = page.get_by_test_id("llm-model-select")
        assert provider_select.input_value() == "openai"
        assert model_select.input_value() == "gpt-default"
        provider_select.select_option("custom-smoke")
        assert model_select.locator("option").count() == 2
        model_select.select_option("smoke-reasoner")
        page.get_by_text("Smoke Gateway（custom-smoke / smoke-reasoner）", exact=False).wait_for(state="visible")
        assert page.evaluate("localStorage.getItem('ai-test-platform.llmProvider')") == "custom-smoke"
        assert page.evaluate("localStorage.getItem('ai-test-platform.llmModel.custom-smoke')") == "smoke-reasoner"
        page.set_viewport_size({"width": 1800, "height": 1200})
        picker.scroll_into_view_if_needed()
        page.screenshot(path=str(ARTIFACTS / "generation-model-picker.png"), full_page=True)
        picker_bounds = picker.bounding_box()
        assert picker_bounds is not None and picker_bounds["y"] >= 0 and picker_bounds["y"] + picker_bounds["height"] <= 1200
        page.set_viewport_size({"width": 1440, "height": 900})

        page.get_by_test_id("open-runtime-config").click()
        dialog = page.get_by_role("dialog", name="生成配置")
        dialog.wait_for(state="visible")
        page.screenshot(path=str(ARTIFACTS / "runtime-config-desktop.png"), full_page=True)

        assert page.get_by_test_id("runtime-repository-tab").is_visible()
        assert page.get_by_test_id("repo-path-input").is_visible()

        # Repository decision table: create -> save -> delete.
        page.get_by_role("button", name="新增", exact=True).click()
        page.get_by_label("仓库名称").fill("Smoke Repo")
        page.get_by_label("仓库标识").fill("smoke-repo")
        page.get_by_test_id("repo-path-input").fill("F:\\smoke\\repo")
        page.get_by_test_id("save-runtime-config").click()
        page.get_by_text("配置已保存并生效。", exact=True).wait_for(state="visible")
        assert captured["repo"]["id"] == "smoke-repo"
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_test_id("delete-repo").click()
        page.get_by_text("仓库配置已删除。", exact=True).wait_for(state="visible")
        assert "repo_deleted" in captured

        # Repository network equivalence class: disconnected API gives an actionable message.
        captured["abort_repo_save"] = True
        page.get_by_test_id("save-runtime-config").click()
        page.wait_for_timeout(800)
        repo_network_notice = page.get_by_role("status").inner_text()
        assert "保存仓库失败：无法连接 API 服务" in repo_network_notice, repo_network_notice
        assert page.get_by_text("Failed to fetch", exact=False).count() == 0
        console_errors.clear()
        captured["abort_repo_save"] = False

        page.get_by_role("button", name="LLM 模型", exact=True).click()
        assert page.get_by_test_id("runtime-model-tab").is_visible()
        assert page.get_by_test_id("add-provider").is_visible()

        # Provider equivalence classes: built-in and custom; custom supports save/test/delete.
        page.get_by_test_id("add-provider").click()
        assert page.get_by_test_id("custom-provider-editor").is_visible()
        page.get_by_label("供应商名称 *").fill("Smoke Provider")
        page.get_by_label("供应商 URL *").fill("https://models.example.test/v1")
        page.get_by_label("API Key *").fill("smoke-api-key")
        page.get_by_test_id("discover-provider-models").click()
        page.get_by_text("已获取 2 个模型", exact=False).wait_for(state="visible")
        assert captured["models_discovered"]["endpoint"] == "https://models.example.test/v1"
        model_list = page.get_by_test_id("provider-model-list")
        model_list.get_by_text("smoke-chat", exact=True).click()
        model_list.get_by_text("smoke-reasoner", exact=True).click()
        page.screenshot(path=str(ARTIFACTS / "runtime-config-provider.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(ARTIFACTS / "runtime-config-provider-mobile.png"), full_page=True)
        provider_overflow = page.get_by_test_id("custom-provider-editor").evaluate("element => element.scrollWidth - element.clientWidth")
        assert provider_overflow <= 1, provider_overflow
        page.set_viewport_size({"width": 1440, "height": 900})
        page.get_by_test_id("save-runtime-config").click()
        page.get_by_text("配置已保存并生效。", exact=True).wait_for(state="visible")
        assert captured["provider"]["contextWindow"] == 131072
        assert captured["provider"]["models"] == ["smoke-chat", "smoke-reasoner"]
        page.get_by_test_id("test-provider").click()
        page.get_by_text("连接成功", exact=False).wait_for(state="visible")
        assert "provider_tested" in captured
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_test_id("delete-provider").click()
        page.get_by_text("自定义 Provider 已删除。", exact=True).wait_for(state="visible")
        assert "provider_deleted" in captured

        page.get_by_role("button", name="知识库", exact=True).click()
        assert page.get_by_test_id("runtime-knowledge-tab").is_visible()
        assert page.get_by_text("LightRAG 服务地址", exact=True).is_visible()
        page.get_by_role("button", name="本地 llm-wiki", exact=True).click()
        assert page.get_by_text("llm-wiki 本地地址", exact=True).is_visible()
        assert page.get_by_text("查询 API 路径", exact=True).is_visible()

        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(ARTIFACTS / "runtime-config-mobile.png"), full_page=True)
        bounds = dialog.bounding_box()
        assert bounds is not None
        assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 390
        assert bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 844

        page.get_by_test_id("save-runtime-config").click()
        page.get_by_text("配置已保存并生效。", exact=True).wait_for(state="visible")
        assert captured["config"]["knowledgeProvider"] == "llm-wiki"
        assert not console_errors, console_errors

        # Runtime config decision table: changed .env values apply without reloading the page.
        page.unroute("**/api/config", intercept_config)
        original_config = page.evaluate("async () => await (await fetch('/api/config')).json()")
        original_payload = {
            "llmProvider": original_config["llmProvider"],
            "apiPort": original_config["apiPort"],
            "lightRagUrl": original_config["lightRagUrl"],
            "knowledgeProvider": original_config["knowledgeProvider"],
            "llmWikiUrl": original_config["llmWikiUrl"],
            "llmWikiQueryPath": original_config["llmWikiQueryPath"],
            "llmWikiHealthPath": original_config["llmWikiHealthPath"],
            "llmWikiApiKey": "",
            "plasticCmPath": original_config["plasticCmPath"],
            "methodologyPath": original_config["methodologyPath"],
            "providers": [
                {
                    "id": provider["id"],
                    "apiKey": "",
                    "baseUrl": provider["baseUrl"],
                    "model": provider["model"],
                    "models": provider["models"],
                }
                for provider in original_config["providers"]
            ],
        }
        changed_payload = {
            **original_payload,
            "knowledgeProvider": "llm-wiki" if original_payload["knowledgeProvider"] == "lightrag" else "lightrag",
        }
        load_events: list[str] = []
        page.on("load", lambda: load_events.append(page.url))
        try:
            page.evaluate(
                """async (payload) => {
                    const response = await fetch('/api/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    })
                    if (!response.ok) throw new Error(`save failed: ${response.status}`)
                }""",
                changed_payload,
            )
            page.wait_for_timeout(800)
            assert not load_events, f"saving runtime config reloaded the page: {load_events}"
        finally:
            page.evaluate(
                """async (payload) => {
                    await fetch('/api/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    })
                }""",
                original_payload,
            )
            page.wait_for_timeout(800)
        assert not load_events, f"restoring runtime config reloaded the page: {load_events}"

        browser.close()


if __name__ == "__main__":
    main()

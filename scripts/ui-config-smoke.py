from playwright.sync_api import sync_playwright
import os


def main():
    web_url = f"http://127.0.0.1:{os.environ.get('WEB_PORT', '5173')}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(f"{web_url}/", wait_until="networkidle")
        assert page.get_by_test_id("settings-entry").is_visible()
        page.get_by_test_id("settings-entry").click()
        page.wait_for_load_state("networkidle")
        assert page.get_by_text("本地配置").first.is_visible()
        if not page.get_by_test_id("config-path").is_visible():
            print(page.locator("body").inner_text().encode("ascii", "backslashreplace").decode())
        assert page.get_by_test_id("config-path").is_visible()
        page.screenshot(path="previews/settings-page.png", full_page=True)

        response = page.request.get("http://127.0.0.1:8787/api/config")
        assert response.ok
        body = response.json()
        assert "providers" in body and "path" in body
        serialized = str(body)
        assert "OPENAI_API_KEY" not in serialized
        if body["plasticCmPath"] != r"C:\Program Files\PlasticSCM5\client\cm.exe":
            raise AssertionError(repr(body["plasticCmPath"]))

        page.get_by_test_id("save-config").click()
        page.get_by_role("status").wait_for()
        assert "配置已保存" in page.get_by_role("status").inner_text()
        page.screenshot(path="previews/settings-page-saved.png", full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        page.screenshot(path="previews/settings-page-mobile.png", full_page=True)
        browser.close()


if __name__ == "__main__":
    main()

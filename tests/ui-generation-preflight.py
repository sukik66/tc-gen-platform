import json
import re
from pathlib import Path

from playwright.sync_api import Page, Route, sync_playwright


BASE_URL = "http://127.0.0.1:5173/generation"
PROVIDER_ID = "custom-preflight-e2e"
MODEL_ID = "test-model-id"
REQUIREMENT = (
    "Login requirement: account length is 1 to 20 characters; password length is "
    "8 to 32 characters; lock the account after 5 failed attempts."
)
OUT_DIR = Path(__file__).resolve().parents[1] / ".tmp-ui"
OUT_DIR.mkdir(exist_ok=True)


def coverage_plan(covered: list[str], uncovered: list[str]) -> dict:
    test_points = [
        {
            "id": "TP-001",
            "title": "Account length equivalence classes and boundaries",
            "sourceReqIds": ["REQ-001"],
            "coverageType": "Boundary",
            "designMethod": "Equivalence partitioning and boundary value analysis",
            "designBasis": "0, 1, 20, and 21 characters",
            "priority": "P0",
            "isInformationGap": False,
            "agentStage": "test_point_planning",
            "sourceEvidence": ["account length is 1 to 20"],
            "caseIds": ["TC-E2E-001"] if "TP-001" in covered else [],
            "gaps": [],
            "coverageStatus": "covered" if "TP-001" in covered else "planned",
        },
        {
            "id": "TP-002",
            "title": "Lock decision table after failed attempts",
            "sourceReqIds": ["REQ-002"],
            "coverageType": "Decision table",
            "designMethod": "Decision table",
            "designBasis": "attempts below, at, and above five",
            "priority": "P0",
            "isInformationGap": False,
            "agentStage": "test_point_planning",
            "sourceEvidence": ["lock after 5 failed attempts"],
            "caseIds": ["TC-E2E-002"] if "TP-002" in covered else [],
            "gaps": [],
            "coverageStatus": "covered" if "TP-002" in covered else "planned",
        },
    ]
    req_items = [
        {
            "id": f"REQ-00{index}",
            "type": "feature",
            "title": title,
            "module": "Login",
            "parentId": "",
            "source": {"documentName": "login.txt", "heading": "", "excerpt": title},
            "testPointIds": [f"TP-00{index}"],
            "gaps": [],
            "coverageStatus": "covered" if f"TP-00{index}" in covered else "planned",
        }
        for index, title in [(1, "Account validation"), (2, "Failed-attempt lock")]
    ]
    return {
        "reqItems": req_items,
        "testPoints": test_points,
        "coverage": {
            "reqTotal": 2,
            "testPointTotal": 2,
            "uncoveredReqIds": [],
            "informationGapReqIds": [],
            "informationGapTestPointIds": [],
            "coveredTestPointIds": covered,
            "uncoveredTestPointIds": uncovered,
            "coverageRate": round(len(covered) / 2 * 100),
        },
    }


def large_coverage_plan(covered: list[str], total: int = 73) -> dict:
    covered_set = set(covered)
    test_points = []
    req_items = []
    for index in range(1, total + 1):
        tp_id = f"TP-{index:03d}"
        req_id = f"REQ-{index:03d}"
        is_covered = tp_id in covered_set
        test_points.append({
            "id": tp_id,
            "title": f"Generated coverage point {index}",
            "sourceReqIds": [req_id],
            "coverageType": "Boundary",
            "designMethod": "Boundary value analysis",
            "designBasis": "lower, nominal, upper",
            "priority": "P1",
            "isInformationGap": False,
            "agentStage": "test_point_planning",
            "sourceEvidence": [f"requirement {index}"],
            "caseIds": [f"TC-E2E-{index:03d}"] if is_covered else [],
            "gaps": [],
            "coverageStatus": "covered" if is_covered else "planned",
        })
        req_items.append({
            "id": req_id,
            "type": "feature",
            "title": f"Requirement {index}",
            "module": "Large plan",
            "parentId": "",
            "source": {"documentName": "large.txt", "heading": "", "excerpt": f"requirement {index}"},
            "testPointIds": [tp_id],
            "gaps": [],
            "coverageStatus": "covered" if is_covered else "planned",
        })
    uncovered = [f"TP-{index:03d}" for index in range(1, total + 1) if f"TP-{index:03d}" not in covered_set]
    return {
        "reqItems": req_items,
        "testPoints": test_points,
        "coverage": {
            "reqTotal": total,
            "testPointTotal": total,
            "uncoveredReqIds": [],
            "informationGapReqIds": [],
            "informationGapTestPointIds": [],
            "coveredTestPointIds": sorted(covered_set),
            "uncoveredTestPointIds": uncovered,
            "coverageRate": round(len(covered_set) / total * 100),
        },
    }


def install_common_routes(
    page: Page,
    state: dict,
    preflight_ok: bool,
    generation_outcome: str = "complete",
) -> None:
    provider_response = {
        "serverDefaultProvider": PROVIDER_ID,
        "providers": [
            {
                "id": PROVIDER_ID,
                "label": "Preflight E2E Provider",
                "ready": True,
                "model": MODEL_ID,
                "availableModels": [MODEL_ID, "alternate-model"],
                "custom": True,
            }
        ],
    }

    page.route("**/api/llm-providers", lambda route: route.fulfill(status=200, json=provider_response))
    page.route("**/api/rag/health*", lambda route: route.fulfill(status=200, json={"ok": False}))

    def handle_preflight(route: Route) -> None:
        state["preflight_count"] += 1
        if preflight_ok:
            route.fulfill(status=200, json={"ok": True, "latencyMs": 12, "model": MODEL_ID, "reply": "OK"})
        else:
            route.fulfill(status=400, json={"error": "Provider authentication failed (HTTP 401)"})

    page.route(f"**/api/custom-providers/{PROVIDER_ID}/test", handle_preflight)

    def handle_generation(route: Route) -> None:
        state["generation_count"] += 1
        state["generation_payloads"].append(route.request.post_data_json)
        round_number = state["generation_count"]
        if generation_outcome == "auto_complete_many":
            previous = state.get("large_covered", [])
            target_ids = route.request.post_data_json.get("targetTestPointIds") or []
            if not previous:
                target_ids = [f"TP-{index:03d}" for index in range(1, 13)]
            covered = sorted(set(previous + target_ids))
            state["large_covered"] = covered
            cases = [{
                "id": f"TC-E2E-{index[3:]}",
                "priority": "P1",
                "caseType": "Functional",
                "module": "Large plan",
                "subModule": "Coverage",
                "summary": f"Covers {index}",
                "description": "Executable coverage case",
                "preconditions": [],
                "steps": ["Execute the scenario"],
                "expected": "The expected result is observed",
                "remarks": "",
                "sourceReqIds": [f"REQ-{index[3:] }"],
                "testPointIds": [index],
                "designMethod": "Boundary value analysis",
            } for index in target_ids]
            done = {"cases": cases, "testPlan": large_coverage_plan(covered)}
            sse = (
                "event: pipeline_progress\n"
                f"data: {json.dumps({'step': 'final_generation', 'status': 'start', 'round': round_number})}\n\n"
                "event: done\n"
                f"data: {json.dumps(done, ensure_ascii=False)}\n\n"
            )
            route.fulfill(status=200, headers={"Content-Type": "text/event-stream; charset=utf-8"}, body=sse)
            return

        test_point_id = "TP-002" if generation_outcome == "auto_complete" and round_number == 2 else "TP-001"
        case_id = "TC-E2E-002" if test_point_id == "TP-002" else "TC-E2E-001"
        summary = "Account locks on the fifth failure" if test_point_id == "TP-002" else "Account length boundary is enforced"
        extra = {}

        if generation_outcome == "auto_complete" and round_number == 1:
            extra["testPlan"] = coverage_plan(["TP-001"], ["TP-002"])
        elif generation_outcome == "no_progress":
            extra["testPlan"] = coverage_plan([], ["TP-001", "TP-002"])
        elif generation_outcome == "partial":
            extra.update({
                "partial": True,
                "qualityHints": {
                    "actualCases": 1,
                    "partialJson": True,
                    "rawChars": 31694,
                    "provider": PROVIDER_ID,
                },
                "testPlan": coverage_plan(["TP-001", "TP-002"], []),
            })
        elif generation_outcome == "interrupted":
            extra.update({"interrupted": True, "interruptReason": "socket closed"})
        else:
            extra["testPlan"] = coverage_plan(["TP-001", "TP-002"], [])

        done = {
            "cases": [{
                "id": case_id,
                "priority": "P0",
                "caseType": "Functional",
                "module": "Login",
                "subModule": "Authentication",
                "summary": summary,
                "description": "Executable coverage case",
                "preconditions": [],
                "steps": ["Enter the specified credentials"],
                "expected": "The documented validation result is shown",
                "remarks": "",
                "sourceReqIds": ["REQ-002" if test_point_id == "TP-002" else "REQ-001"],
                "testPointIds": [test_point_id],
                "designMethod": "Decision table" if test_point_id == "TP-002" else "Boundary value analysis",
            }],
            **extra,
        }
        sse = (
            "event: pipeline_progress\n"
            f"data: {json.dumps({'step': 'final_generation', 'status': 'start', 'round': round_number})}\n\n"
            "event: done\n"
            f"data: {json.dumps(done, ensure_ascii=False)}\n\n"
        )
        route.fulfill(
            status=200,
            headers={"Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache"},
            body=sse,
        )

    page.route("**/api/generate-enhanced-stream", handle_generation)


def new_state() -> dict:
    return {"preflight_count": 0, "generation_count": 0, "generation_payloads": []}


def prepare_generation(page: Page) -> None:
    page.goto(BASE_URL, wait_until="networkidle")
    page.locator('input[type="file"]').first.set_input_files(files=[{
        "name": "login-requirement.txt",
        "mimeType": "text/plain",
        "buffer": REQUIREMENT.encode("utf-8"),
    }])
    page.get_by_test_id("llm-provider-select").select_option(PROVIDER_ID)
    page.get_by_test_id("llm-model-select").select_option(MODEL_ID)
    button = page.get_by_role("button", name="生成测试用例")
    button.wait_for(state="visible")
    assert button.is_enabled()
    button.click()


def test_preflight_failure(browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    state = new_state()
    install_common_routes(page, state, preflight_ok=False)
    prepare_generation(page)
    page.get_by_role("heading", name="生成出错").wait_for(state="visible")
    assert page.get_by_text("模型连接预检失败", exact=False).is_visible()
    assert state["preflight_count"] == 1 and state["generation_count"] == 0
    context.close()


def test_single_round_complete(browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    state = new_state()
    install_common_routes(page, state, preflight_ok=True)
    prepare_generation(page)
    button = page.get_by_role("button", name="覆盖生成完成")
    button.wait_for(state="visible")
    assert button.is_disabled()
    assert state["generation_count"] == 1
    assert state["generation_payloads"][0]["autoCoverage"] is True
    assert state["generation_payloads"][0]["autoRound"] == 1
    context.close()


def test_partial_result_is_non_blocking(browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    state = new_state()
    install_common_routes(page, state, preflight_ok=True, generation_outcome="partial")
    prepare_generation(page)
    notice = page.get_by_test_id("generation-quality-notice")
    notice.wait_for(state="visible")
    assert page.get_by_role("heading", name="生成中断").count() == 0
    assert "已保留 1 条" in notice.inner_text()
    assert state["generation_count"] == 1
    assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 1
    page.screenshot(path=str(OUT_DIR / "generation-partial-notice-desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert notice.is_visible()
    assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 1
    page.screenshot(path=str(OUT_DIR / "generation-partial-notice-mobile.png"), full_page=True)
    context.close()


def test_real_stream_interruption_remains_blocking(browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    state = new_state()
    install_common_routes(page, state, preflight_ok=True, generation_outcome="interrupted")
    prepare_generation(page)
    page.get_by_role("heading", name="生成中断").wait_for(state="visible")
    assert page.get_by_test_id("generation-quality-notice").count() == 0
    assert state["generation_count"] == 1
    context.close()


def test_automatic_coverage_decision_table_continues_then_completes(browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    state = new_state()
    install_common_routes(page, state, preflight_ok=True, generation_outcome="auto_complete")
    prepare_generation(page)
    button = page.get_by_role("button", name="覆盖生成完成")
    button.wait_for(state="visible")
    assert state["generation_count"] == 2
    second = state["generation_payloads"][1]
    assert second["autoRound"] == 2
    assert second["targetTestPointIds"] == ["TP-002"]
    assert second["reuseTestPlan"]["coverage"]["uncoveredTestPointIds"] == ["TP-002"]
    assert page.get_by_test_id("generated-case-count").inner_text() == "2"
    assert button.is_disabled()
    assert page.get_by_role("heading", name="生成中断").count() == 0
    context.close()


def test_automatic_coverage_decision_table_stops_on_no_progress(browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    state = new_state()
    install_common_routes(page, state, preflight_ok=True, generation_outcome="no_progress")
    prepare_generation(page)
    notice = page.get_by_test_id("generation-quality-notice")
    notice.wait_for(state="visible")
    assert "未能减少未覆盖测试点" in notice.inner_text()
    assert state["generation_count"] == 1
    button = page.get_by_role("button", name=re.compile("继续补充未覆盖用例"))
    assert button.is_enabled()
    context.close()


def test_automatic_coverage_handles_more_than_seventy_two_test_points(browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    state = new_state()
    state["large_covered"] = []
    install_common_routes(page, state, preflight_ok=True, generation_outcome="auto_complete_many")
    prepare_generation(page)
    button = page.get_by_role("button", name="覆盖生成完成")
    button.wait_for(state="visible")
    assert state["generation_count"] == 7
    assert state["generation_payloads"][-1]["autoRound"] == 7
    assert page.get_by_test_id("generated-case-count").inner_text() == "73"
    assert button.is_disabled()
    context.close()


with sync_playwright() as playwright:
    chromium = playwright.chromium.launch(headless=True)
    test_preflight_failure(chromium)
    test_single_round_complete(chromium)
    test_partial_result_is_non_blocking(chromium)
    test_real_stream_interruption_remains_blocking(chromium)
    test_automatic_coverage_decision_table_continues_then_completes(chromium)
    test_automatic_coverage_decision_table_stops_on_no_progress(chromium)
    test_automatic_coverage_handles_more_than_seventy_two_test_points(chromium)
    chromium.close()

print("generation outcome decision table: 7/7 passed")

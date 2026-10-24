"""OpenAI の Responses API の応答（テスト用の JSON）。HTTP を差し替えるテストが共有する。"""

from typing import Any


def api_response(
    output_text: str | None,
    *,
    status: str = "completed",
    refusal: str | None = None,
    incomplete: bool = False,
) -> dict[str, Any]:
    content: list[dict[str, Any]] = []
    if output_text is not None:
        content.append({"type": "output_text", "text": output_text, "annotations": []})
    if refusal is not None:
        content.append({"type": "refusal", "refusal": refusal})
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 1_700_000_000.0,
        "model": "gpt-5.5",
        "status": "incomplete" if incomplete else status,
        "incomplete_details": {"reason": "max_output_tokens"} if incomplete else None,
        "output": [
            {
                "type": "message",
                "id": "msg_test",
                "role": "assistant",
                "status": "completed",
                "content": content,
            }
        ],
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
        "usage": {
            "input_tokens": 1234,
            "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
            "output_tokens": 567,
            "output_tokens_details": {"reasoning_tokens": 100},
            "total_tokens": 1801,
        },
    }

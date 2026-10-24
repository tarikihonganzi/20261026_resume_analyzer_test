"""LLM の呼び出しの抽象。本物（OpenAI）と偽物（テスト・E2E 用）を差し替えられるようにする。"""

from typing import Protocol

from app.llm.requests import EvaluateRequest, ExtractRequest
from app.llm.schemas import ExtractionResult, FinalEvaluation


class LlmClient(Protocol):
    async def extract(self, request: ExtractRequest) -> ExtractionResult:
        """ステップ 1: 条件ごとの有無・年数と、その根拠を抽出する。"""
        ...

    async def evaluate(self, request: EvaluateRequest) -> FinalEvaluation:
        """ステップ 3: 総合スコアと、概要・良かった点・懸念点を、根拠つきで返す。"""
        ...


class ClosableLlmClient(LlmClient, Protocol):
    """使い終わったら閉じる必要がある `LlmClient`（HTTP の接続を持つもの）。"""

    async def aclose(self) -> None: ...

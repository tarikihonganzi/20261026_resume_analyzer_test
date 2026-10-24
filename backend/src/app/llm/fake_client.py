"""テスト・E2E 用の偽の `LlmClient`。環境変数 `APP_LLM_MODE=fake` のときだけ使う（既定では無効）。

固定の規則で抽出結果と評価を返す。遅延（進捗表示・キャンセルのテスト用）、スコアの強制（補正の
表示のテスト用）、エラーの再現ができる。引用は、テキストの職歴書なら原文に含まれる文字列にし、
最終評価には 1 件だけ原文にない引用を入れる（「原文で確認できず」の表示の確認用）。
"""

import asyncio

from app.domain.models import Condition
from app.llm.requests import EvaluateRequest, ExtractRequest
from app.llm.schemas import (
    ConditionExtraction,
    EvaluatedPoint,
    ExtractionResult,
    FinalEvaluation,
    Quote,
)

# 最終評価に 1 件だけ入れる、原文にない引用
UNVERIFIABLE_QUOTE = "この引用は職歴書の原文にありません（偽のクライアントが入れたもの）"
_ACHIEVED_PATTERN = (True, False, False, True)
_PDF_QUOTE = "（PDF の内容の引用）"


class FakeClient:
    def __init__(
        self,
        *,
        delay_sec: float = 0.0,
        score: int | None = None,
        fail_with: Exception | None = None,
    ) -> None:
        self._delay_sec = delay_sec
        self._score = score
        self._fail_with = fail_with
        self.extract_calls: list[ExtractRequest] = []
        self.evaluate_calls: list[EvaluateRequest] = []

    async def _simulate(self) -> None:
        if self._delay_sec > 0:
            await asyncio.sleep(self._delay_sec)
        if self._fail_with is not None:
            raise self._fail_with

    @staticmethod
    def _quote_source(request: ExtractRequest | EvaluateRequest) -> str:
        """引用に使う、原文の一部。テキストの職歴書なら、最初の十分に長い行。"""
        text = request.resume.text
        if text is None:
            return _PDF_QUOTE
        lines = [line.strip() for line in text.splitlines() if len(line.strip()) >= 8]
        return lines[0] if lines else text.strip()[:30]

    @staticmethod
    def _extract_one(
        index: int, condition: Condition, name: str, quote: str
    ) -> ConditionExtraction:
        # boolean にも number にも、達成と未達が混ざるように、決まったパターンを繰り返す
        achieved = _ACHIEVED_PATTERN[index % len(_ACHIEVED_PATTERN)]
        has_skill: bool | None = None
        years: float | None = None
        if condition.kind == "boolean":
            has_skill = achieved
        else:
            minimum = condition.min_value or 0.0
            years = minimum + 1.0 if achieved else max(minimum - 1.0, 0.0)

        if achieved:
            reason = f'"{name}"の位置に「{quote}」という記載があったため。'
            quotes = [Quote(source_name=name, location=None, text=quote)]
        else:
            reason = f'"{name}"に{condition.label}に関する記載が見つからなかったため。'
            quotes = []
        return ConditionExtraction(
            condition_id=condition.id,
            has_skill=has_skill,
            years=years,
            reason=reason,
            quotes=quotes,
        )

    async def extract(self, request: ExtractRequest) -> ExtractionResult:
        self.extract_calls.append(request)
        await self._simulate()
        name = request.resume.source_name
        quote = self._quote_source(request)
        return ExtractionResult(
            results=[
                self._extract_one(index, condition, name, quote)
                for index, condition in enumerate(request.conditions)
            ]
        )

    async def evaluate(self, request: EvaluateRequest) -> FinalEvaluation:
        self.evaluate_calls.append(request)
        await self._simulate()
        name = request.resume.source_name
        quote = self._quote_source(request)
        found = Quote(source_name=name, location=None, text=quote)
        missing = Quote(source_name=name, location=None, text=UNVERIFIABLE_QUOTE)
        score = request.match_rate if self._score is None else self._score
        return FinalEvaluation(
            score=score,
            summary=EvaluatedPoint(
                text=f"**偽の評価**です。マッチ度合いは {request.match_rate}% でした。",
                reason=f'"{name}"の位置に「{quote}」という記載があったため。',
                quotes=[found],
            ),
            strengths=[
                EvaluatedPoint(
                    text="施工管理の経験が**具体的**に書かれています。",
                    reason=f'"{name}"の位置に「{quote}」という記載があったため。',
                    quotes=[found],
                )
            ],
            weaknesses=[
                EvaluatedPoint(
                    text="<u>一部の記載</u>は、原文で確認できませんでした。",
                    reason=f'"{name}"に、確認できる記載が見つからなかったため。',
                    quotes=[missing],
                )
            ],
        )

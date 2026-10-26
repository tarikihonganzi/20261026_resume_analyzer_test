"""テスト・E2E 用の偽の `LlmClient`。環境変数 `APP_LLM_MODE=fake` のときだけ使う（既定では無効）。

固定の規則で抽出結果と評価を返す。遅延（進捗表示・キャンセルのテスト用）、スコアの強制（補正の
表示のテスト用）、エラーの再現ができる。引用は、テキストの職歴書なら原文に含まれる文字列にし、
最終評価には 1 件だけ原文にない引用を入れる（「原文で確認できず」の表示の確認用）。
"""

import asyncio

from app.domain.models import Condition
from app.ingest.resume import ResumeInput
from app.llm.requests import EvaluateRequest, ExtractRequest
from app.llm.schemas import (
    ConditionExtraction,
    EvaluatedPoint,
    ExtractionResult,
    FinalEvaluation,
    Quote,
)

# 最終評価に 1 件だけ入れる、原文にない引用
UNVERIFIABLE_QUOTE = "この引用は書類の原文にありません（偽のクライアントが入れたもの）"
# 偽のクライアントが返す、架空の氏名（結果画面の表示の確認用）
FAKE_APPLICANT_NAME = "架空 太郎"
_ACHIEVED_PATTERN = (True, False, False, True)
_PDF_QUOTE = "（PDF の内容の引用）"
_IMAGE_QUOTE = "（画像の内容の引用）"


class FakeClient:
    """`LlmClient` を満たす偽物。呼び出された内容を `extract_calls`・`evaluate_calls` に残す。"""

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

    async def aclose(self) -> None:
        """閉じるものはない（`ClosableLlmClient` に合わせるため）。"""

    async def _simulate(self) -> None:
        """本物の呼び出しに近づけるための待ち時間と、指定された失敗。"""
        if self._delay_sec > 0:
            await asyncio.sleep(self._delay_sec)
        if self._fail_with is not None:
            raise self._fail_with

    @staticmethod
    def _primary(request: ExtractRequest | EvaluateRequest) -> ResumeInput:
        """引用と出典名に使う書類。テキストを持つ最初の書類（なければ最初の書類）。"""
        return next((r for r in request.resumes if r.text is not None), request.resumes[0])

    @staticmethod
    def _quote_source(resume: ResumeInput) -> str:
        """引用に使う、原文の一部。テキストの職歴書なら、最初の十分に長い行。"""
        text = resume.text
        if text is None:
            return _IMAGE_QUOTE if resume.image is not None else _PDF_QUOTE
        # 短すぎる引用は、原文のどこにでも一致してしまうので、8 文字以上の最初の行を使う
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
            if achieved:
                years = minimum + 1.0
            elif minimum >= 1.0:
                years = minimum - 1.0
            # 最低値が 1 年未満のとき、年数を 0 にすると「達成」になる。記載がないので null（不明）

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
        primary = self._primary(request)
        name = primary.source_name
        quote = self._quote_source(primary)
        return ExtractionResult(
            applicant_name=FAKE_APPLICANT_NAME,
            results=[
                self._extract_one(index, condition, name, quote)
                for index, condition in enumerate(request.conditions)
            ],
        )

    async def evaluate(self, request: EvaluateRequest) -> FinalEvaluation:
        self.evaluate_calls.append(request)
        await self._simulate()
        primary = self._primary(request)
        name = primary.source_name
        quote = self._quote_source(primary)
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

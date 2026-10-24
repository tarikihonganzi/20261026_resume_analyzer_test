"""LLM の Structured Output のスキーマ。

各フィールドの description は LLM への指示として機能する。docs/spec.md の 5.4 章と同じ文言にし、
変更するときは両方を更新する（tests/unit/test_schemas.py が一致を検査する）。
"""

from pydantic import BaseModel, Field


class Quote(BaseModel):
    source_name: str = Field(
        description=(
            "引用元の職歴書の名前。プロンプトで『職歴書の名前』として与えられた文字列を、"
            "一字一句そのまま書く（例: 田中太郎_職務経歴書.pdf）。"
            "貼り付けテキストの場合は『貼り付けテキスト』と書く。"
        )
    )
    location: str | None = Field(
        description=(
            "引用箇所の位置が分かる場合の手がかり。ページ番号、シート名、見出し、"
            "職歴の会社名など（例: 『2ページ目』『職務経歴の株式会社○○』）。"
            "位置が分からない場合は null。"
        )
    )
    text: str = Field(
        description=(
            "職歴書から引き写した原文の一部。要約・言い換え・補完をせず、文字をそのまま写す。"
            "長い場合は判断に必要な箇所に絞り、おおむね 150 文字以内にする。"
            "原文の一続きの部分だけを引用し、途中を『…』で省略してつながない。"
            "離れた箇所を引用したいときは、別の Quote に分ける。"
        )
    )


class ConditionExtraction(BaseModel):
    condition_id: str = Field(description="入力で与えられた条件の id。一字一句そのまま書き写す。")
    has_skill: bool | None = Field(
        description=(
            "kind が boolean の条件でのみ使う。職歴書の記載から保有が読み取れれば true、"
            "読み取れなければ false。関連しそうな別の資格・経験からの類推で true にしない。"
            "kind が number の条件では null。"
        )
    )
    years: float | None = Field(
        description=(
            "kind が number の条件でのみ使う。職歴書の記載から算出した経験年数"
            "（小数可、年単位。半年は 0.5、1 年 3 か月は 1.25 のように、月数を 12 で割って表す。丸めない）。"
            "期間が重なる場合は重複を除いて数える。在籍中で終了日がない期間の終了日は『今日の日付』とする。"
            "期間が読み取れず算出できない場合は null。kind が boolean の条件では null。"
        )
    )
    reason: str = Field(
        description=(
            "判定の根拠を 1〜3 文で書く。必ず出典名を含め、"
            '『"出典名"の位置に「原文の一部」という記載があったため。』の形にする。'
            "記載が見つからず、未保有または算出不能とした場合も、"
            '『"出典名"にxxxに関する記載が見つからなかったため。』と書く。'
            "年数を算出した場合は、使った期間と計算も含める"
            "（例: 2015年4月〜2020年3月の5年0か月と、2021年1月〜2023年6月の2年5か月で、合計7年とした）。"
        )
    )
    quotes: list[Quote] = Field(
        description=(
            "reason の根拠となる職歴書の原文の引用。判定に使った記載を、1 件以上入れる。"
            "記載が見つからないことが根拠の場合のみ、空配列にする。"
        )
    )


class ExtractionResult(BaseModel):
    results: list[ConditionExtraction] = Field(
        description=(
            "入力のすべての条件について 1 件ずつ、入力と同じ順序で返す。"
            "条件を省略・追加・統合しない。"
        )
    )


class EvaluatedPoint(BaseModel):
    text: str = Field(
        description=(
            "評価の内容。Markdown で書く。重要な語句は **太字**、特に強調したい箇所は <u>下線</u> を使ってよい。"
            "1 項目あたり 1〜3 文で、具体的に書く（『経験が豊富』のような抽象的な表現だけにしない）。"
        )
    )
    reason: str = Field(
        description=(
            "この評価の根拠を 1〜3 文で書く。必ず出典名を含め、"
            '『"出典名"の位置に「原文の一部」という記載があったため。』の形にする。'
            "職歴書にない事実を根拠にしない。条件の判定結果を根拠にする場合は、その旨を書く"
            "（例: 『必須条件「1級建築施工管理技士」が未達と判定されたため。』）。"
        )
    )
    quotes: list[Quote] = Field(
        description=(
            "reason の根拠となる職歴書の原文の引用。職歴書の記載を根拠にする場合は 1 件以上入れる。"
            "根拠が条件の判定結果のみの場合、または記載がないこと自体が根拠の場合は、空配列にしてよい。"
        )
    )


class FinalEvaluation(BaseModel):
    score: int = Field(
        ge=0,
        le=100,
        description=(
            "総合スコア（0〜100 の整数）。入力のマッチ度合い（%）を基準にし、"
            "職歴書の内容（実績の具体性、職歴の質、条件の達成度合いからは見えない強み・弱み）を加味して決める。"
            "マッチ度合いから大きく離れる場合は、summary でその理由を説明する。"
            "年齢・性別・国籍・婚姻状況・健康状態など、採用選考に用いるべきでない属性は、スコアに影響させない。"
        ),
    )
    summary: EvaluatedPoint = Field(
        description=(
            "最終評価の概要と、そのスコアにした理由。text には 3〜6 文で、"
            "応募者の全体像、スコアの理由、必須条件が未達の場合はその影響を書く。"
        )
    )
    strengths: list[EvaluatedPoint] = Field(
        min_length=1,
        max_length=5,
        description="良かった点。重要なものから順に 1〜5 件。各項目に根拠を付ける。",
    )
    weaknesses: list[EvaluatedPoint] = Field(
        max_length=5,
        description=(
            "懸念点・不足している点。重要なものから順に 1〜5 件。"
            "必須条件の未達があれば必ず含める。該当がなければ空配列。各項目に根拠を付ける。"
        ),
    )

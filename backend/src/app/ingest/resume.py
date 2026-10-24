"""職歴書の取り込み（仕様 5.3）。種別の判定、サイズ検査、テキスト化、空チェックを行う。

PDF は手元でテキストにせず、バイト列のまま LLM に渡す。それ以外は MarkItDown の
`convert_stream` で、メモリ上の stream だけを使ってテキストにする（ファイルを作らない）。
"""

import asyncio
import functools
import io
from dataclasses import dataclass
from pathlib import PurePath

from markitdown import (
    FileConversionException,
    MarkItDown,
    MissingDependencyException,
    StreamInfo,
    UnsupportedFormatException,
)
from pydantic import BaseModel

from app.domain.errors import (
    ConversionFailedError,
    EmptyResumeError,
    FileTooLargeError,
    InvalidResumeInputError,
    UnsupportedFormatError,
)
from app.domain.quotes import normalize
from app.domain.source_name import PASTED_TEXT_NAME, sanitize

# 変換結果が、空白と Markdown の記号を除いてこの文字数に満たなければ「極端に短い」
# とする（仕様 13.1 #24）
MIN_TEXT_CHARS = 20

_PDF_HEADER = b"%PDF-"
# zip の中身を再帰的に展開する変換器があり、zip 爆弾の危険があるので受け付けない
_REJECTED_EXTENSIONS = frozenset({"zip"})
# 拡張子を信じて、中身をそのまま文字として読んでしまう形式
_TEXT_EXTENSIONS = frozenset({"txt", "md", "csv", "json", "xml", "html", "htm", "log"})
_BINARY_SIGNATURES = (b"PK\x03\x04", b"\xd0\xcf\x11\xe0")  # zip 系（docx など）、旧 Office

_SUPPORTED_FORMATS_HINT = (
    "対応している形式は、PDF、Word（docx）、Excel（xlsx・xls）、PowerPoint（pptx）、"
    "テキスト（txt・md・csv）です。"
)


@dataclass(frozen=True)
class ResumeInput:
    """評価に使う職歴書。`pdf` か `text` のどちらか一方だけを持つ。"""

    source_name: str
    format: str
    pdf: bytes | None = None
    text: str | None = None


class ResumeCheck(BaseModel):
    """`/api/resumes/check` の応答。内容は含めず、概要だけを返す（仕様 7）。"""

    format: str
    source_name: str
    char_count: int | None


def check_of(resume: ResumeInput) -> ResumeCheck:
    return ResumeCheck(
        format=resume.format,
        source_name=resume.source_name,
        char_count=None if resume.text is None else len(resume.text),
    )


@functools.cache
def _markitdown() -> MarkItDown:
    # プラグインは使わない（外部のコードを読み込まない）
    return MarkItDown(enable_plugins=False)


def _convert(content: bytes, extension: str, filename: str) -> str:
    """MarkItDown でテキストにする（同期処理。呼び出し側がスレッドで実行する）。"""
    stream_info = StreamInfo(extension=f".{extension}" if extension else None, filename=filename)
    try:
        result = _markitdown().convert_stream(io.BytesIO(content), stream_info=stream_info)
    except UnsupportedFormatException, MissingDependencyException:
        label = extension or "拡張子なし"
        raise UnsupportedFormatError(
            f"このファイル形式（{label}）は読み取れません。{_SUPPORTED_FORMATS_HINT}"
        ) from None
    except FileConversionException, ValueError, UnicodeError, OSError:
        # 元の例外のメッセージには、内容の一部が含まれうるので連鎖させない
        raise ConversionFailedError(
            "ファイルを読み取れませんでした。ファイルが壊れていないか、"
            "拡張子と内容が一致しているかを確認してください。"
        ) from None
    return result.text_content


def _extension_of(name: str) -> str:
    return PurePath(name).suffix.lower().lstrip(".")


def _check_size(size: int, max_size_mb: int) -> None:
    if max_size_mb > 0 and size > max_size_mb * 1024 * 1024:
        raise FileTooLargeError(max_size_mb)


def _check_text_length(text: str) -> None:
    if len(normalize(text)) < MIN_TEXT_CHARS:
        raise EmptyResumeError(
            "テキスト化できませんでした。内容が空か、極端に短いようです。"
            "スキャン画像の場合は PDF で保存し直してください。"
        )


def _looks_binary(content: bytes) -> bool:
    return content.startswith(_BINARY_SIGNATURES) or b"\x00" in content[:8192]


async def _load_file(filename: str, content: bytes, max_size_mb: int) -> ResumeInput:
    _check_size(len(content), max_size_mb)
    source_name = sanitize(filename)
    extension = _extension_of(source_name)
    has_pdf_header = _PDF_HEADER in content[:1024]

    # 拡張子が違っていても、PDF の見出しがあれば PDF として扱う
    if has_pdf_header:
        return ResumeInput(source_name=source_name, format="pdf", pdf=content)
    if extension == "pdf":
        raise ConversionFailedError(
            "PDF として読み取れませんでした。ファイルが壊れていないかを確認してください。"
        )
    if extension in _REJECTED_EXTENSIONS:
        raise UnsupportedFormatError(
            f"このファイル形式（{extension}）は読み取れません。{_SUPPORTED_FORMATS_HINT}"
        )
    if extension in _TEXT_EXTENSIONS and _looks_binary(content):
        raise ConversionFailedError(
            "テキストファイルとして読み取れませんでした。拡張子と内容が一致しているかを確認してください。"
        )

    text = await asyncio.to_thread(_convert, content, extension, source_name)
    _check_text_length(text)
    return ResumeInput(source_name=source_name, format=extension or "unknown", text=text)


async def _load_pasted_text(text: str, max_size_mb: int) -> ResumeInput:
    _check_size(len(text.encode("utf-8")), max_size_mb)
    _check_text_length(text)
    return ResumeInput(source_name=PASTED_TEXT_NAME, format="text", text=text)


async def load_resume(
    *,
    filename: str | None,
    content: bytes | None,
    pasted_text: str | None,
    max_size_mb: int,
) -> ResumeInput:
    """ファイルか貼り付けテキストのどちらか 1 つを検証し、評価に使う形にする。

    `max_size_mb` が 0 のときは、サイズの上限なし。問題があれば `ResumeError` を送出する。
    """
    has_file = filename is not None or content is not None
    if has_file == (pasted_text is not None):
        raise InvalidResumeInputError(
            "ファイルか貼り付けテキストの、どちらか 1 つを指定してください。"
        )

    if pasted_text is not None:
        return await _load_pasted_text(pasted_text, max_size_mb)
    if filename is None or content is None:
        raise InvalidResumeInputError("ファイル名とファイルの内容の両方が必要です。")
    return await _load_file(filename, content, max_size_mb)

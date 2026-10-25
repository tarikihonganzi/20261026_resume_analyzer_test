"""職歴書の取り込み（仕様 5.3）。種別の判定、サイズ検査、テキスト化、空チェックを行う。

PDF は手元でテキストにせず、バイト列のまま LLM に渡す。それ以外は MarkItDown の
`convert_stream` で、メモリ上の stream だけを使ってテキストにする（ファイルを作らない）。
"""

import asyncio
import codecs
import functools
import io
import re
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import PurePath

from markitdown import (
    PRIORITY_GENERIC_FILE_FORMAT,
    FileConversionException,
    MarkItDown,
    MissingDependencyException,
    StreamInfo,
    UnsupportedFormatException,
)
from markitdown.converters import (
    CsvConverter,
    DocxConverter,
    HtmlConverter,
    PlainTextConverter,
    PptxConverter,
    XlsConverter,
    XlsxConverter,
)
from pydantic import BaseModel

from app.domain.errors import (
    ConversionFailedError,
    EmptyResumeError,
    FileTooLargeError,
    InvalidResumeInputError,
    TooManyResumesError,
    UnsupportedFormatError,
)
from app.domain.quotes import normalize
from app.domain.source_name import PASTED_TEXT_NAME, make_unique, sanitize

# 変換結果が、空白と Markdown の記号を除いてこの文字数に満たなければ「極端に短い」
# とする（仕様 5.3）
MIN_TEXT_CHARS = 20
# 1 回の評価に渡せる書類の数（仕様 5.3）
MAX_RESUMES = 5

# Office 形式。拡張子と内容（zip・旧 Office の署名）が一致するはずの形式
_OFFICE_EXTENSIONS = frozenset({"docx", "xlsx", "xls", "pptx"})
# テキストとして読む拡張子（MarkItDown の PlainText・Html・Csv の変換器が、拡張子だけで受け付ける）
_TEXT_EXTENSIONS = frozenset(
    {"txt", "text", "md", "markdown", "json", "jsonl", "csv", "html", "htm", "log"}
)
# zip の中のファイル名の先頭から、拡張子のないファイルの形式を判定する
_OFFICE_DIRECTORIES = (("word/", "docx"), ("xl/", "xlsx"), ("ppt/", "pptx"))
_ZIP_SIGNATURE = b"PK\x03\x04"
_BINARY_SIGNATURES = (_ZIP_SIGNATURE, b"\xd0\xcf\x11\xe0")  # zip 系、旧 Office（OLE）
# BOM のある Unicode テキストは、NUL バイトを含んでいても正常（UTF-32 を UTF-16 より先に）
_UNICODE_BOMS = (
    codecs.BOM_UTF8,
    codecs.BOM_UTF32_LE,
    codecs.BOM_UTF32_BE,
    codecs.BOM_UTF16_LE,
    codecs.BOM_UTF16_BE,
)

_BYTES_PER_MB = 1024 * 1024
# PDF の見出し（`%PDF-`）を探す先頭のバイト数。PDF の仕様は、先頭 1024 バイト以内を許す
_PDF_HEAD_BYTES = 1024
# テキストかどうかの判定で、NUL バイトを探す先頭のバイト数（全体を調べると、大きなファイルで遅い）
_BINARY_SCAN_BYTES = 8192

# PDF の見出し。ファイルの先頭（BOM・空白は許す）にあれば、拡張子に関わらず PDF とする。
# 拡張子が .pdf のときだけ、先頭 1024 バイト以内の行頭にあれば許す（PDF の仕様の許容範囲）
_PDF_AT_START = re.compile(rb"(?:\xef\xbb\xbf)?\s*%PDF-[12]\.\d")
_PDF_AT_LINE_START = re.compile(rb"(?:^|[\r\n])%PDF-[12]\.\d")

_SUPPORTED_FORMATS_HINT = (
    "対応している形式は、PDF、Word（docx）、Excel（xlsx・xls）、PowerPoint（pptx）、"
    "テキスト（txt・md・csv）です。"
)

# 変換結果から、本文でない行を除くための規則（見出し、水平線、表の区切り）
_HEADING_LINE = re.compile(r"^#{1,6}(?:\s|$)")
_RULE_RUN = re.compile(r"[-=_~:]{3,}")
# 水平線（`- - -`・`___`・`* * *`）や、空の表の行（`| | |`）のように、記号と空白だけの行
_RULE_ONLY_LINE = re.compile(r"[\s|:\-=_*~]*")


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
    """使う変換器だけを登録した MarkItDown を返す。

    組み込みの変換器をすべて有効にすると、zip を再帰的に展開する変換器など、このアプリに
    不要で危険なものが、ファイル名に関わらず内容の推測で選ばれる。許可する形式だけを登録する。
    """
    converter = MarkItDown(enable_builtins=False, enable_plugins=False)
    converter.register_converter(PlainTextConverter(), priority=PRIORITY_GENERIC_FILE_FORMAT)
    converter.register_converter(HtmlConverter(), priority=PRIORITY_GENERIC_FILE_FORMAT)
    for specific in (
        DocxConverter(),
        XlsxConverter(),
        XlsConverter(),
        PptxConverter(),
        CsvConverter(),
    ):
        converter.register_converter(specific)
    return converter


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
    if max_size_mb > 0 and size > max_size_mb * _BYTES_PER_MB:
        raise FileTooLargeError(max_size_mb)


def _content_length(text: str) -> int:
    """本文の文字数。空白・Markdown の記号・見出し・水平線・表の区切りを数えない。

    MarkItDown は、空のシートでもシート名を見出しとして出力し、表の区切り行も作る。
    これらは本文ではないので、数えない。
    """
    total = 0
    for line in text.splitlines():
        stripped = line.strip()
        if _HEADING_LINE.match(stripped) or _RULE_ONLY_LINE.fullmatch(stripped):
            continue
        total += len(normalize(_RULE_RUN.sub("", stripped)))
    return total


def _check_text_length(text: str) -> None:
    if _content_length(text) < MIN_TEXT_CHARS:
        raise EmptyResumeError(
            "テキスト化できませんでした。内容が空か、極端に短いようです。"
            "スキャン画像の場合は PDF で保存し直してください。"
        )


def _is_pdf(content: bytes, extension: str) -> bool:
    head = content[:_PDF_HEAD_BYTES]
    if _PDF_AT_START.match(head):
        return True
    return extension == "pdf" and _PDF_AT_LINE_START.search(head) is not None


def _looks_binary(content: bytes) -> bool:
    """Office や zip の署名、または（BOM のない）NUL バイトを含むなら、テキストではない。"""
    if content.startswith(_BINARY_SIGNATURES):
        return True
    if content.startswith(_UNICODE_BOMS):
        return False
    return b"\x00" in content[:_BINARY_SCAN_BYTES]


def _office_format_of_zip(content: bytes) -> str | None:
    """拡張子のない zip 系のファイルが Office 形式かを、zip の中のファイル名だけで判定する。

    中身は展開しない。Office 形式でなければ None（汎用の zip は受け付けない）。
    """
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = archive.namelist()
    except zipfile.BadZipFile, ValueError, OSError:
        return None
    for directory, format_ in _OFFICE_DIRECTORIES:
        if any(name.startswith(directory) for name in names):
            return format_
    return None


async def _load_file(filename: str, content: bytes, max_size_mb: int) -> ResumeInput:
    """ファイル 1 件を検証して、評価に使う形にする。

    形式は、拡張子だけでなく内容でも確かめる（拡張子と内容が食い違うファイルや、zip を
    取りこぼさず、変換器に壊れたものを渡さないため）。
    """
    _check_size(len(content), max_size_mb)
    source_name = sanitize(filename)
    extension = _extension_of(source_name)

    if _is_pdf(content, extension):
        return ResumeInput(source_name=source_name, format="pdf", pdf=content)
    if extension == "pdf":
        raise ConversionFailedError(
            "PDF として読み取れませんでした。ファイルが壊れていないかを確認してください。"
        )
    if extension == "zip":
        raise UnsupportedFormatError(
            "zip は読み取れません。中のファイルを取り出して選んでください。"
            f"{_SUPPORTED_FORMATS_HINT}"
        )

    if extension == "" and content.startswith(_ZIP_SIGNATURE):
        office_format = _office_format_of_zip(content)
        if office_format is None:
            raise ConversionFailedError(
                "ファイルの形式を判定できませんでした。拡張子（.docx など）を付けてください。"
            )
        extension = office_format
    elif extension not in _OFFICE_EXTENSIONS and _looks_binary(content):
        if extension in _TEXT_EXTENSIONS:
            raise ConversionFailedError(
                "テキストファイルとして読み取れませんでした。"
                "拡張子と内容が一致しているかを確認してください。"
            )
        label = extension or "拡張子なし"
        raise UnsupportedFormatError(
            f"このファイル形式（{label}）は読み取れません。{_SUPPORTED_FORMATS_HINT}"
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


def _uses_pasted_text(file_count: int, pasted_text: str | None) -> bool:
    """貼り付けテキストを、書類として使うか。ファイルがあるときの空の貼り付けは、数えない。"""
    return pasted_text is not None and (file_count == 0 or pasted_text.strip() != "")


def check_document_count(file_count: int, pasted_text: str | None) -> None:
    """書類の数（ファイル + 貼り付けテキスト）が、1 件以上、上限以下かを確かめる。

    ファイルを読み込む前に呼べる（上限を超えるのに、全部を読み込まないため）。
    """
    count = file_count + (1 if _uses_pasted_text(file_count, pasted_text) else 0)
    if count == 0:
        raise InvalidResumeInputError("書類を 1 件以上指定してください。")
    if count > MAX_RESUMES:
        raise TooManyResumesError(MAX_RESUMES)


async def load_resumes(
    *,
    files: Sequence[tuple[str, bytes]],
    pasted_text: str | None,
    max_size_mb: int,
) -> list[ResumeInput]:
    """1 人の応募者の書類（ファイル（複数）と貼り付けテキスト（1 件））を、検証して並べる。

    順序は、ファイル（渡された順）→ 貼り付けテキスト。出典名は、重なったものに ` (2)` を付けて一意に
    する（仕様 5.4）。1 件でも問題があれば、`ResumeError` を送出する。
    """
    check_document_count(len(files), pasted_text)

    loaded = [await _load_file(name, content, max_size_mb) for name, content in files]
    if pasted_text is not None and _uses_pasted_text(len(files), pasted_text):
        loaded.append(await _load_pasted_text(pasted_text, max_size_mb))
    names = make_unique([r.source_name for r in loaded])
    return [replace(r, source_name=name) for r, name in zip(loaded, names, strict=True)]

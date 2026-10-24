"""アップロードの読み込み。サイズの上限を超えるファイルを、全量メモリに読み込まないようにする。"""

from fastapi import UploadFile

_MB = 1024 * 1024


async def read_upload(file: UploadFile, max_size_mb: int) -> bytes:
    """ファイルの内容を読む。上限（MB。0 は無制限）がある場合は、上限 + 1 バイトまでしか読まない。

    上限を 1 バイトでも超えれば、呼び出し側のサイズ検査（`load_resume`）が、413 にする。
    巨大なファイルを選ばれても、全量を確保してから拒否することがない。
    """
    if max_size_mb <= 0:
        return await file.read()
    return await file.read(max_size_mb * _MB + 1)

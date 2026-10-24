from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from app.api.deps import ServicesDep
from app.api.uploads import read_upload
from app.ingest.resume import ResumeCheck, check_of, load_resume

router = APIRouter(prefix="/api/resumes")


@router.post("/check")
async def check_resume(
    services: ServicesDep,
    file: Annotated[UploadFile | None, File()] = None,
    text: Annotated[str | None, Form()] = None,
) -> ResumeCheck:
    """職歴書を、評価を始める前に検証する（形式・サイズ・変換できるか・空でないか）。

    結果（形式・ファイル名・文字数）だけを返す。内容は、サーバーに残さない。
    """
    max_size_mb = services.config_store.load().max_file_size_mb
    content = await read_upload(file, max_size_mb) if file is not None else None
    resume = await load_resume(
        filename=file.filename or "" if file is not None else None,
        content=content,
        pasted_text=text,
        max_size_mb=max_size_mb,
    )
    return check_of(resume)

"""Single-user, loopback-only application. Run one uvicorn worker."""
import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from worker import CONFIG_KEY, write_json

BASE = Path(__file__).resolve().parent
MAX_BYTES = 50 * 1024 * 1024
ACTIVE = {'queued', 'decoding', 'loading', 'separating', 'features'}


class Manager:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = asyncio.Lock()
        self.process = None
        self.active_id = None
        for path in self.root.glob('*/job.json'):
            state = json.loads(path.read_text())
            if state.get('status') in ACTIVE:
                state.update(status='failed', message='이전 분석이 중단되었습니다. 파일을 다시 선택하세요.')
                write_json(path, state)

    def directory(self, jid):
        if not re.fullmatch('[a-f0-9]{64}', jid):
            raise HTTPException(404, '분석 결과를 찾을 수 없습니다.')
        path = self.root / jid
        if not (path / 'job.json').exists():
            raise HTTPException(404, '분석 결과를 찾을 수 없습니다.')
        return path

    def busy(self):
        if self.process is None or self.process.poll() is not None:
            return False
        if self.active_id:
            state_path = self.root / self.active_id / 'job.json'
            if state_path.exists() and json.loads(state_path.read_text()).get('status') in {'ready', 'failed'}:
                try:
                    self.process.wait(timeout=2)
                    return False
                except subprocess.TimeoutExpired:
                    pass
        return True

    def status(self, jid):
        path = self.directory(jid)
        state = json.loads((path / 'job.json').read_text())
        if state['status'] in ACTIVE and jid == self.active_id and not self.busy():
            # The worker may have published a terminal state between our read
            # and poll. Only an active state AFTER exit indicates interruption.
            state = json.loads((path / 'job.json').read_text())
            if state['status'] in ACTIVE:
                state.update(status='failed', message='분석 프로세스가 종료되었습니다. 다시 시도하세요.')
                write_json(path / 'job.json', state)
        if state['status'] == 'ready' and not all((path / f).exists() for f in
                ['audio.wav', 'features.json', 'stems/drums.wav', 'stems/bass.wav', 'stems/other.wav', 'stems/vocals.wav']):
            state.update(status='failed', message='결과 파일이 누락되었습니다. 파일을 다시 선택하세요.')
            write_json(path / 'job.json', state)
        return state

    def stop(self):
        if self.busy():
            self.process.terminate()
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill(); self.process.wait()


def create_app(data_dir=None):
    manager = Manager(data_dir or os.environ.get('RIBBON_DATA', BASE / 'data'))

    @asynccontextmanager
    async def lifespan(app):
        yield
        manager.stop()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.manager = manager

    @app.middleware('http')
    async def local_only(request: Request, call_next):
        host = request.headers.get('host', '')
        try: hostname = urlsplit('http://' + host).hostname
        except ValueError: hostname = ''
        origin = request.headers.get('origin')
        if hostname not in {'localhost', '127.0.0.1'} or (origin and origin != 'http://' + host) or request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'detail':'이 앱은 같은 로컬 주소에서만 사용할 수 있습니다.'}, status_code=403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'"
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        else:
            response.headers['Cache-Control'] = 'no-cache'
        return response

    @app.get('/api/health')
    def health():
        return {'app':'ribbon-music', 'ok': True, 'busy': manager.busy(), 'active_id':manager.active_id if manager.busy() else None}

    @app.post('/api/jobs', status_code=202)
    async def upload(file: UploadFile = File(...)):
        try:
            async with manager.lock:
                if manager.busy(): raise HTTPException(409, '분석 중입니다. 완료 후 다시 선택하세요.')
                ext = Path(file.filename or '').suffix.lower()
                if ext not in {'.mp3', '.wav'}: raise HTTPException(400, 'MP3 또는 WAV 파일을 선택하세요.')
                fd, temp_name = tempfile.mkstemp(prefix='upload-', dir=manager.root)
                tmp = Path(temp_name)
                digest = hashlib.sha256(CONFIG_KEY.encode())
                size = 0
                try:
                    with os.fdopen(fd, 'wb') as out:
                        while chunk := await file.read(1024 * 1024):
                            size += len(chunk)
                            if size > MAX_BYTES: raise HTTPException(413, '최대 50MB까지 선택할 수 있습니다.')
                            digest.update(chunk);out.write(chunk)
                    if not size: raise HTTPException(400, '빈 파일은 분석할 수 없습니다.')
                    jid = digest.hexdigest()
                    directory = manager.root / jid
                    if (directory / 'job.json').exists() and manager.status(jid)['status'] == 'ready':
                        return {**manager.status(jid), 'cached': True}
                    directory.mkdir(exist_ok=True)
                    source = 'input' + ext
                    tmp.replace(directory / source)
                    state = {'id':jid, 'name':Path(file.filename.replace('\\','/')).name[:180],
                             'source':source, 'status':'queued', 'message':'분석 대기 중', 'cached':False}
                    write_json(directory / 'job.json', state)
                    env = os.environ.copy()
                    env['TORCH_HOME'] = str(BASE / 'models')
                    env['HF_HOME'] = str(BASE / 'models' / 'huggingface')
                    try:
                        with (directory / 'worker.log').open('w') as log:
                            manager.process = subprocess.Popen([sys.executable, str(BASE / 'worker.py'), str(directory)],
                                                               stdout=log, stderr=log, env=env)
                        manager.active_id = jid
                    except OSError:
                        state.update(status='failed',message='분석 프로세스를 시작하지 못했습니다.')
                        write_json(directory / 'job.json',state)
                    return state
                finally:
                    tmp.unlink(missing_ok=True)
        finally:
            await file.close()

    @app.get('/api/jobs/{jid}')
    def status(jid: str): return manager.status(jid)

    @app.get('/api/jobs/{jid}/{kind}')
    def artifact(jid: str, kind: str):
        if kind not in {'features', 'audio'}: raise HTTPException(404)
        state = manager.status(jid)
        if state['status'] != 'ready': raise HTTPException(409, '분석이 아직 완료되지 않았습니다.')
        path = manager.directory(jid) / ('features.json' if kind == 'features' else 'audio.wav')
        return FileResponse(path, media_type='application/json' if kind == 'features' else 'audio/wav')

    @app.delete('/api/jobs/{jid}')
    async def delete(jid: str):
        async with manager.lock:
            path = manager.directory(jid)
            if manager.busy() and manager.active_id == jid: raise HTTPException(409, '분석 중에는 삭제할 수 없습니다.')
            shutil.rmtree(path)
            return {'deleted':True}

    @app.get('/samples/carefree-20s.mp3')
    def sample(): return FileResponse(BASE / 'samples/carefree-20s.mp3', media_type='audio/mpeg')

    app.mount('/', StaticFiles(directory=BASE / 'web', html=True), name='web')
    return app


app = create_app()

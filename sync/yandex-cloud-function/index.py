# ==========================================================================
# Yandex Cloud Function: общее хранилище для заметок Max-скрипта
# ==========================================================================
#
# ЧТО ДЕЛАЕТ:
#   GET  -> отдаёт текущий JSON со всеми заметками
#   POST -> перезаписывает JSON (клиент сам присылает уже смёрженную версию)
#
# КАК РАЗВЕРНУТЬ (кратко):
#   1. Создайте бакет в Yandex Object Storage (например: max-notes-sync).
#   2. Создайте сервисный аккаунт с ролью storage.editor на этот бакет,
#      выпустите для него статический ключ доступа (Access Key / Secret Key).
#   3. Создайте Cloud Function (Python 3.12), вставьте этот код как index.py,
#      точка входа: index.handler.
#   4. В переменных окружения функции задайте:
#        SYNC_TOKEN        - произвольный секретный токен, придумайте сами
#        BUCKET            - имя бакета
#        AWS_ACCESS_KEY_ID     - ключ сервисного аккаунта
#        AWS_SECRET_ACCESS_KEY - секрет сервисного аккаунта
#   5. Сделайте функцию публичной (или используйте API Gateway) и включите
#      HTTP-триггер. Скопируйте URL функции - он понадобится в клиентском
#      скрипте (SYNC_URL).
#   6. В requirements.txt функции укажите: boto3
#
# БЕЗОПАСНОСТЬ:
#   Токен передаётся в заголовке X-Sync-Token и просто сверяется строкой.
#   Этого достаточно для внутреннего инструмента 3 сотрудников, но держите
#   токен в секрете (не публикуйте скрипт с токеном никуда наружу).
#
# ФОРМАТ ДАННЫХ:
#   Функция ничего не знает про внутреннюю структуру - она просто хранит и
#   отдаёт обратно тот JSON, который ей прислали (клиент max-notes.js шлёт
#   { notes: {...}, updatedAt: <timestamp> }).
# ==========================================================================

import os
import json
import boto3

TOKEN = os.environ.get('SYNC_TOKEN', '')
BUCKET = os.environ.get('BUCKET', '')
KEY = 'max_notes.json'

_session = boto3.session.Session()
_s3 = _session.client(
    service_name='s3',
    endpoint_url='https://storage.yandexcloud.net',
)


def _response(status, body, extra_headers=None):
    headers = {'Content-Type': 'application/json; charset=utf-8'}
    if extra_headers:
        headers.update(extra_headers)
    return {'statusCode': status, 'headers': headers, 'body': body}


def handler(event, context):
    headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    token = headers.get('x-sync-token', '')

    if not TOKEN or token != TOKEN:
        return _response(401, json.dumps({'error': 'unauthorized'}))

    method = event.get('httpMethod', 'GET')

    if method == 'GET':
        try:
            obj = _s3.get_object(Bucket=BUCKET, Key=KEY)
            body = obj['Body'].read().decode('utf-8')
        except _s3.exceptions.NoSuchKey:
            body = '{}'
        except Exception as e:
            return _response(500, json.dumps({'error': str(e)}))
        return _response(200, body)

    if method == 'POST':
        raw_body = event.get('body', '{}') or '{}'
        if event.get('isBase64Encoded'):
            import base64
            raw_body = base64.b64decode(raw_body).decode('utf-8')
        try:
            json.loads(raw_body)  # валидируем, что это корректный JSON
        except Exception:
            return _response(400, json.dumps({'error': 'invalid json'}))
        try:
            _s3.put_object(
                Bucket=BUCKET,
                Key=KEY,
                Body=raw_body.encode('utf-8'),
                ContentType='application/json',
            )
        except Exception as e:
            return _response(500, json.dumps({'error': str(e)}))
        return _response(200, json.dumps({'ok': True}))

    return _response(405, json.dumps({'error': 'method not allowed'}))

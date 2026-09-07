# ==========================================================================
# Локальный сервер синхронизации заметок Max (без облака, без биллинга)
# ==========================================================================
#
# ЧТО ЭТО:
#   Маленький сервер на Python, который хранит один JSON-файл с заметками
#   и отдаёт/принимает его по HTTP. Работает на ОДНОМ из трёх компьютеров
#   (назовём его "главный"), два других обращаются к нему через сеть.
#
# ТРЕБОВАНИЯ:
#   На "главном" компьютере должен быть установлен Python 3
#   (проверить: откройте командную строку/терминал и наберите: python --version
#    если нет - скачать с https://www.python.org/downloads/, при установке
#    отметить галочку "Add python.exe to PATH").
#
# ЗАПУСК:
#   1. Сохраните этот файл как local_server.py
#   2. Откройте терминал в папке с файлом
#   3. Замените SYNC_TOKEN ниже на свой секрет (любая строка)
#   4. Запустите:  python local_server.py
#   5. Сервер выведет в консоль, что слушает порт 8787 - оставьте окно
#      открытым (сервер работает, пока открыт терминал)
#
# ДАЛЬШЕ нужен публичный https-адрес для этого сервера - см. sync/README.md
# про Cloudflare Tunnel. Просто "IP компьютера в сети" не подойдёт:
# браузер блокирует запросы с https-страницы (web.max.ru) на обычный http.
#
# Сервер ничего не знает про внутренний формат данных - он просто хранит и
# отдаёт обратно тот JSON, который ему прислали (клиент max-notes.js шлёт
# { notes: {...}, updatedAt: <timestamp> }).
# ==========================================================================

import json
import os
import http.server
import socketserver
import threading

PORT = 8787
SYNC_TOKEN = 'ВАШ_СЕКРЕТНЫЙ_ТОКЕН'  # придумайте и впишите то же самое в клиентский скрипт
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'notes_store.json')

_lock = threading.Lock()


def _read_store():
    if not os.path.exists(DATA_FILE):
        return {}
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _write_store(data):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'X-Sync-Token, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def _check_token(self):
        return self.headers.get('X-Sync-Token', '') == SYNC_TOKEN

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if not self._check_token():
            self.send_response(401)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            return
        with _lock:
            data = _read_store()
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self._check_token():
            self.send_response(401)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            return
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length).decode('utf-8') if length else '{}'
        try:
            parsed = json.loads(raw)
        except Exception:
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error":"invalid json"}')
            return
        with _lock:
            _write_store(parsed)
        self.send_response(200)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format, *args):
        print('[%s] %s' % (self.log_date_time_string(), format % args))


if __name__ == '__main__':
    with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), Handler) as httpd:
        print(f'✅ Сервер заметок запущен на порту {PORT}')
        print(f'📁 Данные хранятся в: {DATA_FILE}')
        print('⚠️  Не закрывайте это окно — сервер работает, пока оно открыто')
        httpd.serve_forever()
